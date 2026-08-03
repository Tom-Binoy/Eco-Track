import { v } from 'convex/values'

import { internal } from '../_generated/api'
import type { Doc, Id } from '../_generated/dataModel'
import { internalAction, internalMutation, internalQuery } from '../_generated/server'
import { embedExerciseText } from './embedExerciseLibrary'
import { buildExerciseSearchBlob, normalizeExerciseInput } from '../lib/exerciseNormalization'
import { createCustomExerciseSchema, type CreateCustomExerciseData } from '../lib/validation'

declare const process: { env: Record<string, string | undefined> }

const autoResolveThreshold = 0.82
const vectorSearchLimit = 5

type CandidateSource = 'personal' | 'global'
type ResolutionSource = 'exact_alias' | 'user_alias_vector' | 'personal_library_vector' | 'global_library_vector'
type VectorMatch = {
  exerciseId: Id<'exerciseLibrary'>
  canonicalName: string
  description: string | null
  score: number
  source: CandidateSource
  // Kept temporarily for the existing Call 1 follow-up loop, which already
  // consumes this action but is intentionally out of scope for this change.
  _id: Id<'exerciseLibrary'>
}
type EmbeddingSources = { exercises: Doc<'exerciseLibrary'>[]; aliases: Doc<'userExerciseAliases'>[] }
type SearchTurnResult = {
  resolved: boolean
  exerciseId?: Id<'exerciseLibrary'>
  canonicalName?: string
  confidence?: number
  source?: ResolutionSource
  candidates: VectorMatch[]
  error?: string
  // Compatibility fields for the already-existing tool loop. They can be
  // removed when that wiring is deliberately migrated to the new shape.
  normalized: string
  autoResolved: { exerciseId: Id<'exerciseLibrary'>; canonicalName: string; description: string | null; score: number } | null
}

function unresolved(normalized: string, candidates: VectorMatch[] = [], error?: string): SearchTurnResult {
  return { resolved: false, candidates, error, normalized, autoResolved: null }
}

function resolved(
  normalized: string,
  exercise: Doc<'exerciseLibrary'>,
  confidence: number,
  source: ResolutionSource,
): SearchTurnResult {
  return {
    resolved: true,
    exerciseId: exercise._id,
    canonicalName: exercise.canonicalName,
    confidence,
    source,
    candidates: [],
    normalized,
    autoResolved: { exerciseId: exercise._id, canonicalName: exercise.canonicalName, description: exercise.description ?? null, score: confidence },
  }
}

function rankCandidates(candidates: VectorMatch[]): VectorMatch[] {
  const byExercise = new Map<Id<'exerciseLibrary'>, VectorMatch>()
  for (const candidate of candidates) {
    const current = byExercise.get(candidate.exerciseId)
    if (
      current === undefined
      || candidate.score > current.score
      || (candidate.score === current.score && candidate.source === 'personal' && current.source === 'global')
    ) byExercise.set(candidate.exerciseId, candidate)
  }
  return [...byExercise.values()].sort((left, right) => {
    if (right.score !== left.score) return right.score - left.score
    if (left.source === right.source) return 0
    return left.source === 'personal' ? -1 : 1
  })
}

export const findExactAlias = internalQuery({
  args: { userId: v.id('profiles'), rawInput: v.string() },
  handler: async (ctx, args) => {
    const normalized = normalizeExerciseInput(args.rawInput)
    const alias = await ctx.db.query('userExerciseAliases').withIndex('by_user_and_raw', (q) => q.eq('userId', args.userId).eq('rawInputNormalized', normalized)).unique()
    const exercise = alias === null ? null : await ctx.db.get(alias.exerciseId)
    return { normalized, exercise }
  },
})

export const getEmbeddingSources = internalQuery({
  args: { exerciseIds: v.array(v.id('exerciseLibrary')), aliasIds: v.array(v.id('userExerciseAliases')) },
  handler: async (ctx, args) => ({
    exercises: (await Promise.all(args.exerciseIds.map((id) => ctx.db.get(id)))).filter((entry): entry is Doc<'exerciseLibrary'> => entry !== null),
    aliases: (await Promise.all(args.aliasIds.map((id) => ctx.db.get(id)))).filter((entry): entry is Doc<'userExerciseAliases'> => entry !== null),
  }),
})

export const getEmbeddingDocuments = internalQuery({
  args: { libraryEmbeddingIds: v.array(v.id('exerciseLibraryEmbeddings')), aliasEmbeddingIds: v.array(v.id('userExerciseAliasEmbeddings')) },
  handler: async (ctx, args) => ({
    library: (await Promise.all(args.libraryEmbeddingIds.map((id) => ctx.db.get(id)))).filter((entry): entry is Doc<'exerciseLibraryEmbeddings'> => entry !== null),
    aliases: (await Promise.all(args.aliasEmbeddingIds.map((id) => ctx.db.get(id)))).filter((entry): entry is Doc<'userExerciseAliasEmbeddings'> => entry !== null),
  }),
})

export const upsertEmbeddings = internalMutation({
  args: {
    exercises: v.array(v.object({ exerciseId: v.id('exerciseLibrary'), userId: v.optional(v.id('profiles')), equipment: v.optional(v.string()), muscleGroup: v.optional(v.string()), embedding: v.array(v.float64()) })),
    aliases: v.array(v.object({ aliasId: v.id('userExerciseAliases'), userId: v.id('profiles'), embedding: v.array(v.float64()) })),
  },
  handler: async (ctx, args) => {
    for (const entry of args.exercises) {
      const existing = await ctx.db.query('exerciseLibraryEmbeddings').withIndex('by_exercise', (q) => q.eq('exerciseId', entry.exerciseId)).unique()
      const value = { ...entry, createdAt: Date.now() }
      if (existing === null) await ctx.db.insert('exerciseLibraryEmbeddings', value)
      else await ctx.db.patch(existing._id, value)
    }
    for (const entry of args.aliases) {
      const existing = await ctx.db.query('userExerciseAliasEmbeddings').withIndex('by_alias', (q) => q.eq('aliasId', entry.aliasId)).unique()
      const value = { ...entry, createdAt: Date.now() }
      if (existing === null) await ctx.db.insert('userExerciseAliasEmbeddings', value)
      else await ctx.db.patch(existing._id, value)
    }
    return null
  },
})

export const createCustomExercise = internalMutation({
  args: {
    userId: v.id('profiles'),
    messageId: v.id('messages'),
    input: v.object({
      name: v.string(),
      description: v.string(),
      category: v.optional(v.string()),
      equipment: v.optional(v.string()),
      muscleGroup: v.optional(v.string()),
      allMuscles: v.optional(v.array(v.string())),
      aliases: v.optional(v.array(v.string())),
    }),
    embedding: v.array(v.float64()),
  },
  handler: async (ctx, args): Promise<{ exerciseId: Id<'exerciseLibrary'> } | { error: string }> => {
    const message = await ctx.db.get(args.messageId)
    const chat = message === null ? null : await ctx.db.get(message.chatId)
    if (chat === null || chat.userId !== args.userId) return { error: 'Message not found' }

    const aliases = args.input.aliases ?? []
    const exerciseId = await ctx.db.insert('exerciseLibrary', {
      canonicalName: args.input.name,
      aliases,
      searchBlob: buildExerciseSearchBlob(args.input.name, aliases, args.input.description),
      userId: args.userId,
      category: args.input.category,
      equipment: args.input.equipment,
      muscleGroup: args.input.muscleGroup,
      allMuscles: args.input.allMuscles,
      description: args.input.description,
      source: 'custom',
      createdAt: Date.now(),
    })
    await ctx.db.insert('exerciseLibraryEmbeddings', {
      exerciseId,
      userId: args.userId,
      equipment: args.input.equipment,
      muscleGroup: args.input.muscleGroup,
      embedding: args.embedding,
      createdAt: Date.now(),
    })
    return { exerciseId }
  },
})

export const recordGuideInvocation = internalMutation({
  args: { userId: v.id('profiles'), messageId: v.id('messages') },
  handler: async (ctx, args): Promise<null | { error: string }> => {
    const message = await ctx.db.get(args.messageId)
    const chat = message === null ? null : await ctx.db.get(message.chatId)
    if (chat === null || chat.userId !== args.userId) return { error: 'Message not found' }
    await ctx.db.insert('guideInvocations', { userId: args.userId, messageId: args.messageId, reviewed: false, createdAt: Date.now() })
    return null
  },
})

export const createCustomExerciseAction = internalAction({
  args: { userId: v.id('profiles'), messageId: v.id('messages'), input: v.any() },
  handler: async (ctx, args): Promise<{ exerciseId?: Id<'exerciseLibrary'>; error?: string }> => {
    const parsed = createCustomExerciseSchema.safeParse(args.input)
    if (!parsed.success) return { error: 'Custom exercise details are invalid' }

    const apiKey = process.env.GEMINI_API_KEY
    if (apiKey === undefined) return { error: 'Exercise search is temporarily unavailable' }

    const input: CreateCustomExerciseData = parsed.data
    const aliases = input.aliases ?? []
    let embedding: number[]
    try {
      embedding = await embedExerciseText(
        buildExerciseSearchBlob(input.name, aliases, input.description),
        apiKey,
        'RETRIEVAL_DOCUMENT',
      )
    } catch {
      return { error: 'Could not create exercise embedding' }
    }

    return await ctx.runMutation(internal.functions.exerciseLibrary.createCustomExercise, {
      userId: args.userId,
      messageId: args.messageId,
      input,
      embedding,
    })
  },
})

export const embedConfirmedEntries = internalAction({
  args: { exerciseIds: v.array(v.id('exerciseLibrary')), aliasIds: v.array(v.id('userExerciseAliases')) },
  handler: async (ctx, args): Promise<{ embeddedExercises: number; embeddedAliases: number; error?: string }> => {
    try {
      const sources: EmbeddingSources = await ctx.runQuery(internal.functions.exerciseLibrary.getEmbeddingSources, args)
      const apiKey = process.env.GEMINI_API_KEY
      if (apiKey === undefined) return { embeddedExercises: 0, embeddedAliases: 0, error: 'GEMINI_API_KEY is not configured' }
      const exercises = await Promise.all(sources.exercises.map(async (entry) => ({ exerciseId: entry._id, userId: entry.userId, equipment: entry.equipment, muscleGroup: entry.muscleGroup, embedding: await embedExerciseText(entry.searchBlob, apiKey, 'RETRIEVAL_DOCUMENT') })))
      const aliases = await Promise.all(sources.aliases.map(async (entry) => ({ aliasId: entry._id, userId: entry.userId, embedding: await embedExerciseText(entry.rawInputNormalized, apiKey, 'RETRIEVAL_DOCUMENT') })))
      await ctx.runMutation(internal.functions.exerciseLibrary.upsertEmbeddings, { exercises, aliases })
      return { embeddedExercises: exercises.length, embeddedAliases: aliases.length }
    } catch {
      return { embeddedExercises: 0, embeddedAliases: 0, error: 'Could not create exercise embeddings' }
    }
  },
})

export const searchForTurn = internalAction({
  args: { userId: v.id('profiles'), rawInput: v.string() },
  handler: async (ctx, args): Promise<SearchTurnResult> => {
    const exact: { normalized: string; exercise: Doc<'exerciseLibrary'> | null } = await ctx.runQuery(internal.functions.exerciseLibrary.findExactAlias, args)
    if (exact.exercise !== null) return resolved(exact.normalized, exact.exercise, 1, 'exact_alias')

    const apiKey = process.env.GEMINI_API_KEY
    if (apiKey === undefined) return unresolved(exact.normalized, [], 'Exercise search is temporarily unavailable')

    let vector: number[]
    try { vector = await embedExerciseText(args.rawInput, apiKey, 'RETRIEVAL_QUERY') } catch { return unresolved(exact.normalized, [], 'Exercise search is temporarily unavailable') }

    try {
      const aliasMatches = await ctx.vectorSearch('userExerciseAliasEmbeddings', 'by_embedding', {
        vector,
        limit: vectorSearchLimit,
        filter: (q) => q.eq('userId', args.userId),
      })
      const aliasDocuments = await ctx.runQuery(internal.functions.exerciseLibrary.getEmbeddingDocuments, {
        libraryEmbeddingIds: [],
        aliasEmbeddingIds: aliasMatches.map((match) => match._id),
      })
      const aliasesOnly: EmbeddingSources = await ctx.runQuery(internal.functions.exerciseLibrary.getEmbeddingSources, {
        exerciseIds: [],
        aliasIds: [...new Set(aliasDocuments.aliases.map((entry) => entry.aliasId))],
      })
      const aliasSources: EmbeddingSources = await ctx.runQuery(internal.functions.exerciseLibrary.getEmbeddingSources, {
        exerciseIds: [...new Set(aliasesOnly.aliases.map((alias) => alias.exerciseId))],
        aliasIds: [...new Set(aliasesOnly.aliases.map((alias) => alias._id))],
      })
      const aliasById = new Map(aliasSources.aliases.map((alias) => [alias._id, alias]))
      const exerciseById = new Map(aliasSources.exercises.map((exercise) => [exercise._id, exercise]))
      const aliasEmbeddingById = new Map(aliasDocuments.aliases.map((entry) => [entry._id, entry]))
      const aliasCandidates = aliasMatches.flatMap((match) => {
        const embedding = aliasEmbeddingById.get(match._id)
        const alias = embedding === undefined ? undefined : aliasById.get(embedding.aliasId)
        const exercise = alias === undefined ? undefined : exerciseById.get(alias.exerciseId)
        return exercise === undefined ? [] : [{ exerciseId: exercise._id, canonicalName: exercise.canonicalName, description: exercise.description ?? null, score: match._score, source: 'personal' as const, _id: exercise._id }]
      })
      const bestAlias = rankCandidates(aliasCandidates)[0]
      if (bestAlias !== undefined && bestAlias.score >= autoResolveThreshold) {
        const exercise = exerciseById.get(bestAlias.exerciseId)
        if (exercise !== undefined) return resolved(exact.normalized, exercise, bestAlias.score, 'user_alias_vector')
      }

      const [personalMatches, globalMatches] = await Promise.all([
        ctx.vectorSearch('exerciseLibraryEmbeddings', 'by_embedding', { vector, limit: vectorSearchLimit, filter: (q) => q.eq('userId', args.userId) }),
        ctx.vectorSearch('exerciseLibraryEmbeddings', 'by_embedding', { vector, limit: vectorSearchLimit, filter: (q) => q.eq('userId', undefined) }),
      ])
      const libraryDocuments = await ctx.runQuery(internal.functions.exerciseLibrary.getEmbeddingDocuments, {
        libraryEmbeddingIds: [...personalMatches, ...globalMatches].map((match) => match._id),
        aliasEmbeddingIds: [],
      })
      const librarySources: EmbeddingSources = await ctx.runQuery(internal.functions.exerciseLibrary.getEmbeddingSources, {
        exerciseIds: [...new Set(libraryDocuments.library.map((entry) => entry.exerciseId))],
        aliasIds: [],
      })
      const libraryExerciseById = new Map(librarySources.exercises.map((exercise) => [exercise._id, exercise]))
      const libraryEmbeddingById = new Map(libraryDocuments.library.map((entry) => [entry._id, entry]))
      const toCandidates = (matches: typeof personalMatches, source: CandidateSource): VectorMatch[] => matches.flatMap((match) => {
        const embedding = libraryEmbeddingById.get(match._id)
        const exercise = embedding === undefined ? undefined : libraryExerciseById.get(embedding.exerciseId)
        return exercise === undefined ? [] : [{ exerciseId: exercise._id, canonicalName: exercise.canonicalName, description: exercise.description ?? null, score: match._score, source, _id: exercise._id }]
      })
      const personalCandidates = toCandidates(personalMatches, 'personal')
      const globalCandidates = toCandidates(globalMatches, 'global')
      const bestLibrary = rankCandidates([...personalCandidates, ...globalCandidates])[0]
      if (bestLibrary !== undefined && bestLibrary.score >= autoResolveThreshold) {
        const exercise = libraryExerciseById.get(bestLibrary.exerciseId)
        if (exercise !== undefined) return resolved(exact.normalized, exercise, bestLibrary.score, bestLibrary.source === 'personal' ? 'personal_library_vector' : 'global_library_vector')
      }

      return unresolved(exact.normalized, rankCandidates([...aliasCandidates, ...personalCandidates, ...globalCandidates]).slice(0, vectorSearchLimit))
    } catch {
      return unresolved(exact.normalized, [], 'Exercise search is temporarily unavailable')
    }
  },
})

export const upsertWgerBatch = internalMutation({
  args: { exercises: v.array(v.object({ wgerId: v.number(), canonicalName: v.string(), aliases: v.array(v.string()), searchBlob: v.string(), category: v.optional(v.string()), equipment: v.optional(v.string()), muscleGroup: v.optional(v.string()), allMuscles: v.optional(v.array(v.string())), description: v.optional(v.string()) })) },
  handler: async (ctx, args) => {
    const ids: Id<'exerciseLibrary'>[] = []
    for (const exercise of args.exercises) {
      const existing = await ctx.db.query('exerciseLibrary').withIndex('by_wgerId', (q) => q.eq('wgerId', exercise.wgerId)).unique()
      const value = { ...exercise, searchBlob: buildExerciseSearchBlob(exercise.canonicalName, exercise.aliases, exercise.description), source: 'wger' as const, createdAt: Date.now() }
      if (existing === null) ids.push(await ctx.db.insert('exerciseLibrary', value))
      else { await ctx.db.patch(existing._id, value); ids.push(existing._id) }
    }
    return ids
  },
})
