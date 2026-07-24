import { getAuthUserId } from '@convex-dev/auth/server'
import { v } from 'convex/values'

import type { Doc, Id } from '../_generated/dataModel'
import { internalMutation, mutation, query, type MutationCtx, type QueryCtx } from '../_generated/server'
import { toolCallSchema, type ToolCallData } from '../lib/validation'

type CardAccess = { card: Doc<'cards'>; profile: Doc<'profiles'> } | { error: string }
function normalized(value: string): string { return value.trim().toLocaleLowerCase().replace(/[^a-z0-9]+/g, ' ').trim() }
async function accessCard(ctx: QueryCtx | MutationCtx, cardId: Id<'cards'>): Promise<CardAccess> { const auth = await getAuthUserId(ctx); const profile = auth === null ? null : await ctx.db.query('profiles').withIndex('by_userId', (q) => q.eq('userId', auth)).unique(); const card = await ctx.db.get(cardId); if (profile === null || card === null) return { error: 'Card not found' }; const chat = await ctx.db.get(card.chatId); return chat?.userId === profile._id ? { card, profile } : { error: 'Card not found' } }

async function resolveExerciseId(ctx: MutationCtx, exercise: ToolCallData['blocks'][number]['exercises'][number], userId: Id<'profiles'>): Promise<Id<'exerciseLibrary'> | null> {
  if (exercise.exerciseId !== undefined) { const entry = await ctx.db.get(exercise.exerciseId as Id<'exerciseLibrary'>); if (entry !== null) return entry._id }
  const name = exercise.proposedName ?? exercise.name
  if (name.length === 0) return null
  return await ctx.db.insert('exerciseLibrary', { canonicalName: name, aliases: [], searchBlob: normalized(name), userId, source: 'custom', createdAt: Date.now() })
}
async function writeBlockExercises(ctx: MutationCtx, blockId: Id<'blocks'>, data: ToolCallData, userId: Id<'profiles'>, weightUnit: 'kg' | 'lbs'): Promise<{ error?: string }> {
  for (const block of data.blocks) for (const exercise of block.exercises) { const exerciseId = await resolveExerciseId(ctx, exercise, userId); if (exerciseId === null) return { error: 'Exercise naming must be resolved before confirmation' }; await ctx.db.insert('exercises', { blockId, userId, exerciseId, name: exercise.name, weightUnit, order: exercise.order, sets: exercise.sets, createdAt: Date.now() }); const raw = normalized(exercise.name); const existing = await ctx.db.query('userExerciseAliases').withIndex('by_user_and_raw', (q) => q.eq('userId', userId).eq('rawInputNormalized', raw)).unique(); if (existing === null) await ctx.db.insert('userExerciseAliases', { userId, rawInputNormalized: raw, exerciseId, source: 'confirmed', createdAt: Date.now(), lastUsedAt: Date.now() }); else await ctx.db.patch(existing._id, { exerciseId, source: 'confirmed', lastUsedAt: Date.now() }) }
  return {}
}

export const getByMessage = query({ args: { messageId: v.id('messages') }, handler: async (ctx, args) => { const auth = await getAuthUserId(ctx); const profile = auth === null ? null : await ctx.db.query('profiles').withIndex('by_userId', (q) => q.eq('userId', auth)).unique(); const card = await ctx.db.query('cards').withIndex('by_message', (q) => q.eq('messageId', args.messageId)).first(); if (profile === null || card === null) return null; const chat = await ctx.db.get(card.chatId); return chat?.userId === profile._id ? card : null } })

export const getDiscussionCard = query({ args: { chatId: v.id('chats') }, handler: async (ctx, args) => { const auth = await getAuthUserId(ctx); const profile = auth === null ? null : await ctx.db.query('profiles').withIndex('by_userId', (q) => q.eq('userId', auth)).unique(); const chat = await ctx.db.get(args.chatId); if (profile === null || chat?.userId !== profile._id) return null; return (await ctx.db.query('cards').withIndex('by_chat', (q) => q.eq('chatId', args.chatId)).take(50)).find((card) => card.inDiscussion) ?? null } })

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
  args: { chatId: v.id('chats'), messageId: v.id('messages'), userId: v.id('profiles'), parsedData: v.any(), rawOutput: v.string() },
  handler: async (ctx, args) => {
    const validation = toolCallSchema.safeParse(args.parsedData)
    if (!validation.success) return { error: 'The workout data is invalid' }
    const profile = await ctx.db.get(args.userId)
    const chat = await ctx.db.get(args.chatId)
    if (profile === null || chat === null || chat.userId !== profile._id) return { error: 'Chat not found' }
    const session = await ctx.db.query('sessions').withIndex('by_user_date', (q) => q.eq('userId', profile._id).eq('date', chat.date)).unique()
    const sessionId = session?._id ?? await ctx.db.insert('sessions', { userId: profile._id, date: chat.date, createdAt: Date.now() })
    for (const block of validation.data.blocks) {
      const blockId = await ctx.db.insert('blocks', { sessionId, userId: profile._id, types: [block.type], intervalSeconds: block.intervalSeconds, order: block.order, createdAt: Date.now() })
      const write = await writeBlockExercises(ctx, blockId, { ...validation.data, blocks: [block] }, profile._id, profile.weightUnit)
      if (write.error !== undefined) return write
    }
    const cardId = await ctx.db.insert('cards', { chatId: args.chatId, messageId: args.messageId, sessionId, rawOutput: args.rawOutput, parsedData: validation.data, state: 'confirmed', order: 0, inDiscussion: false, createdAt: Date.now() })
    return { cardId, sessionId }
  },
})

export const setInDiscussion = mutation({ args: { cardId: v.id('cards'), inDiscussion: v.boolean() }, handler: async (ctx, args) => { const access = await accessCard(ctx, args.cardId); if ('error' in access) return access; await ctx.db.patch(args.cardId, { inDiscussion: args.inDiscussion }); return { cardId: args.cardId, inDiscussion: args.inDiscussion } } })

export const applyDiscussionCorrection = internalMutation({ args: { cardId: v.id('cards'), parsedData: v.any(), rawOutput: v.string() }, handler: async (ctx, args) => { const card = await ctx.db.get(args.cardId); if (card === null) return { error: 'Card not found' }; await ctx.db.patch(args.cardId, { inDiscussion: false, parsedData: args.parsedData, rawOutput: args.rawOutput, state: 'pending' }); return { cardId: args.cardId } } })

// The UI may close a pinned card only through this mutation; model output never closes discussions.
export const bringCardBackToDeck = mutation({ args: { cardId: v.id('cards'), messageId: v.id('messages') }, handler: async (ctx, args) => { const access = await accessCard(ctx, args.cardId); if ('error' in access) return access; const message = await ctx.db.get(args.messageId); if (message === null || message.chatId !== access.card.chatId) return { error: 'Message not found' }; await ctx.db.patch(args.cardId, { inDiscussion: false }); await ctx.db.patch(args.messageId, { cardContext: [{ cardId: args.cardId, order: access.card.order + 1, closed: true }] }); return { cardId: args.cardId } } })

export const patchCardData = mutation({ args: { cardId: v.id('cards'), parsedData: v.any(), rawOutput: v.string() }, handler: async (ctx, args) => { const access = await accessCard(ctx, args.cardId); if ('error' in access) return access; await ctx.db.patch(args.cardId, { parsedData: args.parsedData, rawOutput: args.rawOutput, state: access.card.state === 'confirmed' ? 'pending' : access.card.state }); return { cardId: args.cardId } } })
