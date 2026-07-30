import { getAuthUserId } from '@convex-dev/auth/server'
import { v } from 'convex/values'

import { internal } from '../_generated/api'
import type { Doc, Id } from '../_generated/dataModel'
import { internalMutation, mutation, query, type MutationCtx, type QueryCtx } from '../_generated/server'
import { normalizeExerciseInput } from '../lib/exerciseNormalization'
import { toolCallSchema, type ToolCallData } from '../lib/validation'

type CardAccess = { card: Doc<'cards'>; profile: Doc<'profiles'> } | { error: string }
type CardExerciseDisplay = { exerciseId: string; displayedName: string; canonicalName: string | null }
async function accessCard(ctx: QueryCtx | MutationCtx, cardId: Id<'cards'>): Promise<CardAccess> { const auth = await getAuthUserId(ctx); const profile = auth === null ? null : await ctx.db.query('profiles').withIndex('by_userId', (q) => q.eq('userId', auth)).unique(); const card = await ctx.db.get(cardId); if (profile === null || card === null) return { error: 'Card not found' }; const chat = await ctx.db.get(card.chatId); return chat?.userId === profile._id ? { card, profile } : { error: 'Card not found' } }

async function resolveExerciseId(ctx: MutationCtx, exercise: ToolCallData['blocks'][number]['exercises'][number]): Promise<Id<'exerciseLibrary'> | null> {
  const entry = await ctx.db.get(exercise.exerciseId as Id<'exerciseLibrary'>)
  return entry?._id ?? null
}
type ExerciseWriteReceipt = {
  error?: string
  exerciseRowIds: Id<'exercises'>[]
  aliasIds: Id<'userExerciseAliases'>[]
}

async function writeBlockExercises(
  ctx: MutationCtx,
  blockId: Id<'blocks'>,
  data: ToolCallData,
  userId: Id<'profiles'>,
  weightUnit: 'kg' | 'lbs',
): Promise<ExerciseWriteReceipt> {
  const exerciseRowIds: Id<'exercises'>[] = []
  const aliasIds: Id<'userExerciseAliases'>[] = []

  for (const block of data.blocks) {
    for (const exercise of block.exercises) {
      const exerciseId = await resolveExerciseId(ctx, exercise)
      if (exerciseId === null) {
        return {
          error: 'Exercise naming must be resolved before confirmation',
          exerciseRowIds,
          aliasIds,
        }
      }
      exerciseRowIds.push(await ctx.db.insert('exercises', {
        blockId,
        userId,
        exerciseId,
        name: exercise.name,
        weightUnit,
        order: exercise.order,
        sets: exercise.sets,
        createdAt: Date.now(),
      }))
      if (exercise.aliasText !== undefined && exercise.aliasText.length > 0) {
        const raw = normalizeExerciseInput(exercise.aliasText)
        const existing = await ctx.db
          .query('userExerciseAliases')
          .withIndex('by_user_and_raw', (q) =>
            q.eq('userId', userId).eq('rawInputNormalized', raw),
          )
          .unique()
        const aliasId = existing === null
          ? await ctx.db.insert('userExerciseAliases', {
              userId,
              rawInputNormalized: raw,
              exerciseId,
              source: 'confirmed',
              createdAt: Date.now(),
              lastUsedAt: Date.now(),
            })
          : existing._id
        if (existing !== null) {
          await ctx.db.patch(existing._id, {
            exerciseId,
            source: 'confirmed',
            lastUsedAt: Date.now(),
          })
        }
        aliasIds.push(aliasId)
        await ctx.scheduler.runAfter(
          0,
          internal.functions.exerciseLibrary.embedConfirmedEntries,
          { exerciseIds: [exerciseId], aliasIds: [aliasId] },
        )
      }
    }
  }
  return { exerciseRowIds, aliasIds }
}

async function addExerciseDisplay(ctx: QueryCtx, cards: Doc<'cards'>[], userId: Id<'profiles'>): Promise<Array<Doc<'cards'> & { exerciseDisplay: CardExerciseDisplay[] }>> {
  return await Promise.all(cards.map(async (card) => {
    const parsed = toolCallSchema.safeParse(card.parsedData)
    if (!parsed.success) return { ...card, exerciseDisplay: [] }
    const exerciseDisplay = await Promise.all(parsed.data.blocks.flatMap((block) => block.exercises).map(async (exercise) => {
      const library = await ctx.db.get(exercise.exerciseId as Id<'exerciseLibrary'>)
      const canonicalName = library?.canonicalName ?? null
      const alias = await ctx.db.query('userExerciseAliases').withIndex('by_user_and_raw', (q) => q.eq('userId', userId).eq('rawInputNormalized', normalizeExerciseInput(exercise.name))).unique()
      return { exerciseId: exercise.exerciseId, displayedName: alias?.exerciseId === exercise.exerciseId ? exercise.name : canonicalName ?? exercise.name, canonicalName }
    }))
    return { ...card, exerciseDisplay }
  }))
}

export const getByMessage = query({ args: { messageId: v.id('messages') }, handler: async (ctx, args) => { const auth = await getAuthUserId(ctx); const profile = auth === null ? null : await ctx.db.query('profiles').withIndex('by_userId', (q) => q.eq('userId', auth)).unique(); const cards = await ctx.db.query('cards').withIndex('by_message', (q) => q.eq('messageId', args.messageId)).take(50); const firstCard = cards[0]; if (profile === null || firstCard === undefined) return []; const chat = await ctx.db.get(firstCard.chatId); return chat?.userId === profile._id ? await addExerciseDisplay(ctx, cards.sort((left, right) => left.order - right.order), profile._id) : [] } })

export const getDiscussionCard = query({ args: { chatId: v.id('chats') }, handler: async (ctx, args) => { const auth = await getAuthUserId(ctx); const profile = auth === null ? null : await ctx.db.query('profiles').withIndex('by_userId', (q) => q.eq('userId', auth)).unique(); const chat = await ctx.db.get(args.chatId); if (profile === null || chat?.userId !== profile._id) return null; const card = (await ctx.db.query('cards').withIndex('by_chat', (q) => q.eq('chatId', args.chatId)).take(50)).find((item) => item.inDiscussion); return card === undefined ? null : (await addExerciseDisplay(ctx, [card], profile._id))[0] ?? null } })

export const confirmCard = mutation({
  args: { cardId: v.id('cards'), parsedData: v.any() },
  handler: async (ctx, args) => {
    const access = await accessCard(ctx, args.cardId)
    if ('error' in access) return access
    if (access.card.state !== 'pending') return { error: 'Card is already confirmed' }
    const validation = toolCallSchema.safeParse(args.parsedData)
    if (!validation.success) return { error: 'The edited workout data is invalid' }
    const data = validation.data
    if (access.card.correctsBlockId !== undefined) {
      const target = await ctx.db.get(access.card.correctsBlockId)
      if (target === null || target.userId !== access.profile._id) return { error: 'Historical workout could not be found' }
      for (const existing of await ctx.db.query('exercises').withIndex('by_block', (q) => q.eq('blockId', target._id)).take(100)) await ctx.db.delete(existing._id)
      const write = await writeBlockExercises(ctx, target._id, data, access.profile._id, access.profile.weightUnit)
      if (write.error) return write
      await ctx.db.patch(args.cardId, { parsedData: data, sessionId: target.sessionId, state: 'confirmed' })
      return { cardId: args.cardId, sessionId: target.sessionId }
    }
    const chat = await ctx.db.get(access.card.chatId)
    if (chat === null) return { error: 'Chat not found' }
    const existingSession = await ctx.db.query('sessions').withIndex('by_user_date', (q) => q.eq('userId', access.profile._id).eq('date', chat.date)).unique()
    const sessionId = existingSession?._id ?? await ctx.db.insert('sessions', { userId: access.profile._id, date: chat.date, createdAt: Date.now() })
    for (const block of data.blocks) { const blockId = await ctx.db.insert('blocks', { sessionId, userId: access.profile._id, types: [block.type], intervalSeconds: block.intervalSeconds, order: block.order, createdAt: Date.now() }); const write = await writeBlockExercises(ctx, blockId, { ...data, blocks: [block] }, access.profile._id, access.profile.weightUnit); if (write.error) return write }
    await ctx.db.patch(args.cardId, { parsedData: data, sessionId, state: 'confirmed' })
    return { cardId: args.cardId, sessionId }
  },
})

export const writeHighConfidenceCard = internalMutation({
  args: { chatId: v.id('chats'), messageId: v.id('messages'), userId: v.id('profiles'), parsedData: v.any(), rawOutput: v.string(), order: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const validation = toolCallSchema.safeParse(args.parsedData)
    if (!validation.success) return { error: 'The workout data is invalid' }
    const profile = await ctx.db.get(args.userId)
    const chat = await ctx.db.get(args.chatId)
    if (profile === null || chat === null || chat.userId !== profile._id) return { error: 'Chat not found' }
    const session = await ctx.db.query('sessions').withIndex('by_user_date', (q) => q.eq('userId', profile._id).eq('date', chat.date)).unique()
    const sessionId = session?._id ?? await ctx.db.insert('sessions', { userId: profile._id, date: chat.date, createdAt: Date.now() })
    const blockIds: Id<'blocks'>[] = []
    const exerciseRowIds: Id<'exercises'>[] = []
    const aliasIds: Id<'userExerciseAliases'>[] = []
    for (const block of validation.data.blocks) {
      const blockId = await ctx.db.insert('blocks', { sessionId, userId: profile._id, types: [block.type], intervalSeconds: block.intervalSeconds, order: block.order, createdAt: Date.now() })
      blockIds.push(blockId)
      const write = await writeBlockExercises(ctx, blockId, { ...validation.data, blocks: [block] }, profile._id, profile.weightUnit)
      if (write.error !== undefined) return write
      exerciseRowIds.push(...write.exerciseRowIds)
      aliasIds.push(...write.aliasIds)
    }
    const cardId = await ctx.db.insert('cards', { chatId: args.chatId, messageId: args.messageId, sessionId, rawOutput: args.rawOutput, parsedData: validation.data, state: 'confirmed', order: args.order ?? 0, inDiscussion: false, createdAt: Date.now() })
    return {
      cardId,
      sessionId,
      sessionCreated: session === null,
      blockIds,
      exerciseRowIds,
      aliasIds,
    }
  },
})

export const setInDiscussion = mutation({ args: { cardId: v.id('cards'), inDiscussion: v.boolean() }, handler: async (ctx, args) => { const access = await accessCard(ctx, args.cardId); if ('error' in access) return access; await ctx.db.patch(args.cardId, { inDiscussion: args.inDiscussion }); return { cardId: args.cardId, inDiscussion: args.inDiscussion } } })

export const applyDiscussionCorrection = internalMutation({ args: { cardId: v.id('cards'), parsedData: v.any(), rawOutput: v.string() }, handler: async (ctx, args) => { const card = await ctx.db.get(args.cardId); if (card === null) return { error: 'Card not found' }; await ctx.db.patch(args.cardId, { inDiscussion: false, parsedData: args.parsedData, rawOutput: args.rawOutput, state: 'pending' }); return { cardId: args.cardId } } })

// The UI may close a pinned card only through this mutation; model output never closes discussions.
export const bringCardBackToDeck = mutation({ args: { cardId: v.id('cards'), messageId: v.id('messages') }, handler: async (ctx, args) => { const access = await accessCard(ctx, args.cardId); if ('error' in access) return access; const message = await ctx.db.get(args.messageId); if (message === null || message.chatId !== access.card.chatId) return { error: 'Message not found' }; await ctx.db.patch(args.cardId, { inDiscussion: false }); await ctx.db.patch(args.messageId, { cardContext: [{ cardId: args.cardId, order: access.card.order + 1, closed: true }] }); return { cardId: args.cardId } } })

export const patchCardData = mutation({ args: { cardId: v.id('cards'), parsedData: v.any(), rawOutput: v.string() }, handler: async (ctx, args) => { const access = await accessCard(ctx, args.cardId); if ('error' in access) return access; await ctx.db.patch(args.cardId, { parsedData: args.parsedData, rawOutput: args.rawOutput, state: access.card.state === 'confirmed' ? 'pending' : access.card.state }); return { cardId: args.cardId } } })
