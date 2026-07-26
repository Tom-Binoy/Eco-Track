import { v } from 'convex/values'
import { paginationOptsValidator } from 'convex/server'

import { internal } from '../_generated/api'
import type { Doc, Id } from '../_generated/dataModel'
import { action, internalMutation, internalQuery, mutation } from '../_generated/server'
import { buildExerciseSearchBlob } from '../lib/exerciseNormalization'

declare const process: { env: Record<string, string | undefined> }

const embeddingModel = 'gemini-embedding-001'
const embeddingDimensions = 768
const pageSize = 10
const requestDelayMs = 700
const maxRetries = 5

type Failure = { exerciseId: Id<'exerciseLibrary'>; error: string }
type ExerciseLibraryPage = { page: Doc<'exerciseLibrary'>[]; isDone: boolean; continueCursor: string }

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

function retryAfterMilliseconds(value: string | null): number | null {
  if (value === null) return null
  const seconds = Number(value)
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000
  const timestamp = Date.parse(value)
  return Number.isNaN(timestamp) ? null : Math.max(0, timestamp - Date.now())
}

export type EmbeddingTaskType = 'RETRIEVAL_DOCUMENT' | 'RETRIEVAL_QUERY'

export async function embedExerciseText(
  text: string,
  apiKey: string,
  taskType: EmbeddingTaskType,
): Promise<number[]> {
  let retryCount = 0

  while (true) {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${embeddingModel}:embedContent?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: `models/${embeddingModel}`,
        content: { parts: [{ text }] },
        taskType,
        outputDimensionality: embeddingDimensions,
      }),
    })

    if (response.status === 429 && retryCount < maxRetries) {
      const delay = retryAfterMilliseconds(response.headers.get('Retry-After')) ?? 1000 * 2 ** retryCount
      retryCount += 1
      await sleep(delay)
      continue
    }

    if (!response.ok) throw new Error(`Embedding request failed: ${response.status}`)

    const body: unknown = await response.json()
    if (typeof body !== 'object' || body === null || !('embedding' in body)) throw new Error('Embedding response was malformed')
    const embedding = body.embedding
    if (typeof embedding !== 'object' || embedding === null || !('values' in embedding) || !Array.isArray(embedding.values) || embedding.values.length !== embeddingDimensions || !embedding.values.every((value): value is number => typeof value === 'number')) throw new Error('Embedding response had an invalid vector')
    return embedding.values
  }
}

export const getPage = internalQuery({
  args: { paginationOpts: paginationOptsValidator },
  handler: (ctx, args) => ctx.db.query('exerciseLibrary').paginate(args.paginationOpts),
})

export const getExistingEmbedding = internalQuery({
  args: { exerciseId: v.id('exerciseLibrary') },
  handler: (ctx, args) => ctx.db.query('exerciseLibraryEmbeddings').withIndex('by_exercise', (q) => q.eq('exerciseId', args.exerciseId)).unique(),
})

export const insertEmbedding = internalMutation({
  args: {
    exerciseId: v.id('exerciseLibrary'),
    userId: v.optional(v.id('profiles')),
    equipment: v.optional(v.string()),
    muscleGroup: v.optional(v.string()),
    embedding: v.array(v.float64()),
  },
  handler: async (ctx, args) => ctx.db.insert('exerciseLibraryEmbeddings', { ...args, createdAt: Date.now() }),
})

// Temporary administrative endpoint for the one-time description-inclusive re-embedding.
export const clearAllForReembedding = mutation({
  args: {},
  handler: async (ctx): Promise<{ deleted: number }> => {
    const embeddings = await ctx.db.query('exerciseLibraryEmbeddings').collect()
    for (const embedding of embeddings) await ctx.db.delete(embedding._id)
    return { deleted: embeddings.length }
  },
})

// Temporary administrative endpoint for the one-time description-inclusive re-embedding.
export const refreshSearchBlobsForReembedding = mutation({
  args: {},
  handler: async (ctx): Promise<{ updated: number }> => {
    const exercises = await ctx.db.query('exerciseLibrary').collect()
    for (const exercise of exercises) {
      await ctx.db.patch(exercise._id, {
        searchBlob: buildExerciseSearchBlob(exercise.canonicalName, exercise.aliases, exercise.description),
      })
    }
    return { updated: exercises.length }
  },
})

// Temporary administrative endpoint for the one-time description-inclusive re-embedding.
export const backfillBatchForReembedding = action({
  args: { offset: v.number() },
  handler: async (ctx, args): Promise<{ newlyEmbedded: number; failed: Failure[] }> => {
    const apiKey = process.env.GEMINI_API_KEY
    if (apiKey === undefined) throw new Error('GEMINI_API_KEY is not configured')
    const page: ExerciseLibraryPage = await ctx.runQuery(internal.functions.embedExerciseLibrary.getPage, {
      paginationOpts: { cursor: null, numItems: 1000 },
    })
    const exercises = page.page.slice(args.offset, args.offset + 25)
    const failures: Failure[] = []
    let newlyEmbedded = 0

    for (const exercise of exercises) {
      try {
        const existing = await ctx.runQuery(internal.functions.embedExerciseLibrary.getExistingEmbedding, { exerciseId: exercise._id })
        if (existing !== null) continue
        const embedding = await embedExerciseText(exercise.searchBlob, apiKey, 'RETRIEVAL_DOCUMENT')
        await ctx.runMutation(internal.functions.embedExerciseLibrary.insertEmbedding, {
          exerciseId: exercise._id,
          userId: exercise.userId,
          equipment: exercise.equipment,
          muscleGroup: exercise.muscleGroup,
          embedding,
        })
        newlyEmbedded += 1
      } catch (error: unknown) {
        failures.push({ exerciseId: exercise._id, error: error instanceof Error ? error.message : String(error) })
      }
      await sleep(requestDelayMs)
    }

    return { newlyEmbedded, failed: failures }
  },
})

export const backfill = action({
  args: {},
  handler: async (ctx): Promise<{ totalRows: number; alreadyEmbedded: number; newlyEmbedded: number; failed: Failure[] }> => {
    const apiKey = process.env.GEMINI_API_KEY
    if (apiKey === undefined) throw new Error('GEMINI_API_KEY is not configured')

    let cursor: string | null = null
    let totalRows = 0
    let alreadyEmbedded = 0
    let newlyEmbedded = 0
    const failures: Failure[] = []

    do {
      const page: ExerciseLibraryPage = await ctx.runQuery(internal.functions.embedExerciseLibrary.getPage, {
        paginationOpts: { cursor, numItems: pageSize },
      })

      for (const exercise of page.page) {
        totalRows += 1
        try {
          const existing = await ctx.runQuery(internal.functions.embedExerciseLibrary.getExistingEmbedding, { exerciseId: exercise._id })
          if (existing !== null) {
            alreadyEmbedded += 1
            continue
          }

          const embedding = await embedExerciseText(exercise.searchBlob, apiKey, 'RETRIEVAL_DOCUMENT')
          await ctx.runMutation(internal.functions.embedExerciseLibrary.insertEmbedding, {
            exerciseId: exercise._id,
            userId: exercise.userId,
            equipment: exercise.equipment,
            muscleGroup: exercise.muscleGroup,
            embedding,
          })
          newlyEmbedded += 1
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : String(error)
          failures.push({ exerciseId: exercise._id, error: message })
          console.error('Exercise library embedding failed', { exerciseId: exercise._id, error: message })
        }

        await sleep(requestDelayMs)
      }

      cursor = page.isDone ? null : page.continueCursor
    } while (cursor !== null)

    const summary = { totalRows, alreadyEmbedded, newlyEmbedded, failed: failures }
    console.log('Exercise library embedding backfill complete', summary)
    return summary
  },
})
