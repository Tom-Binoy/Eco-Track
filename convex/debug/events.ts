import { getAuthUserId } from '@convex-dev/auth/server'
import { v } from 'convex/values'

import type { Id } from '../_generated/dataModel'
import { internalMutation, internalQuery, mutation, query, type MutationCtx, type QueryCtx } from '../_generated/server'
import { isDebugConsoleEnabled } from './config'

const sourceValidator = v.object({
  file: v.string(),
  symbol: v.string(),
})

const tokensValidator = v.object({
  prompt: v.optional(v.number()),
  output: v.optional(v.number()),
  total: v.number(),
})

export const recordEvent = internalMutation({
  args: {
    userId: v.id('profiles'),
    chatId: v.id('chats'),
    messageId: v.id('messages'),
    runId: v.string(),
    kind: v.union(
      v.literal('lifecycle'),
      v.literal('context'),
      v.literal('gemini'),
      v.literal('tool'),
      v.literal('validation'),
      v.literal('database'),
      v.literal('error'),
      v.literal('warning'),
    ),
    status: v.union(
      v.literal('info'),
      v.literal('running'),
      v.literal('success'),
      v.literal('warning'),
      v.literal('error'),
      v.literal('skipped'),
    ),
    title: v.string(),
    summary: v.optional(v.string()),
    source: sourceValidator,
    details: v.optional(v.string()),
    callIndex: v.optional(v.number()),
    toolName: v.optional(v.string()),
    durationMs: v.optional(v.number()),
    tokens: v.optional(tokensValidator),
    warningCodes: v.array(v.string()),
    occurredAt: v.number(),
  },
  handler: async (ctx, args): Promise<number | null> => {
    if (!isDebugConsoleEnabled()) return null

    const [profile, chat, message] = await Promise.all([
      ctx.db.get(args.userId),
      ctx.db.get(args.chatId),
      ctx.db.get(args.messageId),
    ])
    if (
      profile === null ||
      chat === null ||
      message === null ||
      chat.userId !== profile._id ||
      message.chatId !== chat._id
    ) {
      return null
    }

    const latest = await ctx.db
      .query('debugTurnEvents')
      .withIndex('by_message_and_sequence', (q) => q.eq('messageId', args.messageId))
      .order('desc')
      .first()
    const sequence = (latest?.sequence ?? 0) + 1

    await ctx.db.insert('debugTurnEvents', {
      ...args,
      sequence,
      createdAt: Date.now(),
    })
    return sequence
  },
})

export const recordReplaySnapshot = internalMutation({
  args: {
    userId: v.id('profiles'),
    messageId: v.id('messages'),
    runId: v.string(),
    payload: v.string(),
  },
  handler: async (ctx, args): Promise<null> => {
    if (!isDebugConsoleEnabled()) return null
    const message = await ctx.db.get(args.messageId)
    const chat = message === null ? null : await ctx.db.get(message.chatId)
    if (message === null || chat === null || chat.userId !== args.userId) return null
    const existing = await ctx.db
      .query('debugReplaySnapshots')
      .withIndex('by_message', (q) => q.eq('messageId', args.messageId))
      .filter((q) => q.eq(q.field('runId'), args.runId))
      .unique()
    if (existing === null) {
      await ctx.db.insert('debugReplaySnapshots', {
        ...args,
        capturedAt: Date.now(),
      })
    }
    return null
  },
})

async function hasDebugConsoleAccess(ctx: QueryCtx): Promise<boolean> {
  const authUserId = await getAuthUserId(ctx)
  if (authUserId === null) return false
  return (await ctx.db.query('debugConsoleApprovals').withIndex('by_authUserId', (q) => q.eq('authUserId', authUserId)).unique()) !== null
}

async function hasDebugConsoleMutationAccess(ctx: MutationCtx): Promise<boolean> {
  const authUserId = await getAuthUserId(ctx)
  if (authUserId === null) return false
  return (await ctx.db.query('debugConsoleApprovals').withIndex('by_authUserId', (q) => q.eq('authUserId', authUserId)).unique()) !== null
}

async function deleteReplayArtifacts(ctx: MutationCtx, messageId: Id<'messages'>): Promise<void> {
  const [snapshots, experiments] = await Promise.all([
    ctx.db.query('debugReplaySnapshots').withIndex('by_message', (q) => q.eq('messageId', messageId)).collect(),
    ctx.db.query('debugReplayExperiments').withIndex('by_message_and_createdAt', (q) => q.eq('messageId', messageId)).collect(),
  ])
  for (const snapshot of snapshots) await ctx.db.delete(snapshot._id)
  for (const experiment of experiments) {
    const results = await ctx.db
      .query('debugReplayResults')
      .withIndex('by_experiment_and_variant', (q) => q.eq('experimentId', experiment._id))
      .collect()
    for (const result of results) await ctx.db.delete(result._id)
    await ctx.db.delete(experiment._id)
  }
}

async function deleteMessageForDebug(
  ctx: MutationCtx,
  message: { _id: Id<'messages'>; chatId: Id<'chats'> },
  removeCardReferences: boolean,
): Promise<{ cardsDeleted: number }> {
  const [blocks, toolTraces, cards, feedback, guideInvocations, events, references] = await Promise.all([
    ctx.db.query('messageBlocks').withIndex('by_message', (q) => q.eq('messageId', message._id)).collect(),
    ctx.db.query('toolTraces').withIndex('by_message', (q) => q.eq('messageId', message._id)).collect(),
    ctx.db.query('cards').withIndex('by_message', (q) => q.eq('messageId', message._id)).collect(),
    ctx.db.query('messageFeedback').withIndex('by_message', (q) => q.eq('messageId', message._id)).collect(),
    ctx.db.query('guideInvocations').withIndex('by_message', (q) => q.eq('messageId', message._id)).collect(),
    ctx.db.query('debugTurnEvents').withIndex('by_message_and_sequence', (q) => q.eq('messageId', message._id)).collect(),
    ctx.db.query('exerciseSearchReferences').withIndex('by_message', (q) => q.eq('messageId', message._id)).collect(),
  ])
  const cardIds = new Set(cards.map((card) => card._id))

  if (removeCardReferences && cardIds.size > 0) {
    const chatMessages = await ctx.db.query('messages').withIndex('by_chat', (q) => q.eq('chatId', message.chatId)).collect()
    for (const chatMessage of chatMessages) {
      const cardContext = chatMessage.cardContext?.filter((item) => !cardIds.has(item.cardId))
      if (cardContext !== undefined && cardContext.length !== chatMessage.cardContext?.length) {
        await ctx.db.patch(chatMessage._id, { cardContext: cardContext.length === 0 ? undefined : cardContext })
      }
    }
  }

  for (const block of blocks) await ctx.db.delete(block._id)
  for (const trace of toolTraces) await ctx.db.delete(trace._id)
  for (const card of cards) await ctx.db.delete(card._id)
  for (const item of feedback) await ctx.db.delete(item._id)
  for (const invocation of guideInvocations) await ctx.db.delete(invocation._id)
  for (const event of events) await ctx.db.delete(event._id)
  for (const reference of references) await ctx.db.delete(reference._id)
  await deleteReplayArtifacts(ctx, message._id)
  await ctx.db.delete(message._id)
  return { cardsDeleted: cards.length }
}

export const getReplaySource = internalQuery({
  args: {
    authUserId: v.id('users'),
    messageId: v.id('messages'),
  },
  handler: async (ctx, args) => {
    if (!isDebugConsoleEnabled()) return { error: 'Eco Debug Console is disabled.' }
    const approval = await ctx.db
      .query('debugConsoleApprovals')
      .withIndex('by_authUserId', (q) => q.eq('authUserId', args.authUserId))
      .unique()
    const message = await ctx.db.get(args.messageId)
    if (approval === null || message === null) return { error: 'Turn not found.' }
    const snapshot = await ctx.db
      .query('debugReplaySnapshots')
      .withIndex('by_message', (q) => q.eq('messageId', args.messageId))
      .order('desc')
      .first()
    if (snapshot !== null) {
      return { payload: snapshot.payload, source: 'captured' as const }
    }
    const events = await ctx.db
      .query('debugTurnEvents')
      .withIndex('by_message_and_sequence', (q) => q.eq('messageId', args.messageId))
      .take(200)
    const callZero = events.find((event) => event.title === 'Gemini call 0 started')
    if (callZero?.details === undefined) return { error: 'No Call 0 request snapshot is available.' }
    return { payload: callZero.details, source: 'reconstructed' as const }
  },
})

export const reserveReplayExperiment = internalMutation({
  args: {
    authUserId: v.id('users'),
    messageId: v.id('messages'),
    snapshotSource: v.union(v.literal('captured'), v.literal('reconstructed')),
  },
  handler: async (ctx, args) => {
    if (!isDebugConsoleEnabled()) return { error: 'Eco Debug Console is disabled.' }
    const approval = await ctx.db
      .query('debugConsoleApprovals')
      .withIndex('by_authUserId', (q) => q.eq('authUserId', args.authUserId))
      .unique()
    const message = await ctx.db.get(args.messageId)
    const chat = message === null ? null : await ctx.db.get(message.chatId)
    if (approval === null || message === null || chat === null) return { error: 'Turn not found.' }
    const profile = await ctx.db.get(chat.userId)
    if (profile === null) return { error: 'Turn not found.' }
    const recent = await ctx.db
      .query('debugReplayExperiments')
      .withIndex('by_message_and_createdAt', (q) => q.eq('messageId', args.messageId))
      .order('desc')
      .take(20)
    const running = recent.find((experiment) => experiment.status === 'running')
    if (running !== undefined) {
      if (Date.now() - running.createdAt < 15 * 60 * 1_000) {
        return { error: 'A replay experiment is already running for this turn.' }
      }
      await ctx.db.patch(running._id, {
        status: 'failed',
        completedAt: Date.now(),
        error: 'The replay experiment did not finish within 15 minutes.',
      })
    }
    return {
      experimentId: await ctx.db.insert('debugReplayExperiments', {
        userId: profile._id,
        messageId: args.messageId,
        status: 'running',
        snapshotSource: args.snapshotSource,
        createdAt: Date.now(),
      }),
    }
  },
})

export const recordReplayResult = internalMutation({
  args: {
    experimentId: v.id('debugReplayExperiments'),
    variant: v.string(),
    sampleIndex: v.number(),
    rawText: v.string(),
    finalText: v.string(),
    functionCalls: v.string(),
    getDataSelected: v.boolean(),
    requestedFields: v.array(v.string()),
    promptTokens: v.optional(v.number()),
    outputTokens: v.optional(v.number()),
    totalTokens: v.number(),
    durationMs: v.number(),
    error: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<null> => {
    const experiment = await ctx.db.get(args.experimentId)
    if (experiment?.status !== 'running') return null
    await ctx.db.insert('debugReplayResults', args)
    return null
  },
})

export const finishReplayExperiment = internalMutation({
  args: {
    experimentId: v.id('debugReplayExperiments'),
    status: v.union(v.literal('completed'), v.literal('failed')),
    error: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<null> => {
    const experiment = await ctx.db.get(args.experimentId)
    if (experiment === null) return null
    await ctx.db.patch(args.experimentId, {
      status: args.status,
      completedAt: Date.now(),
      error: args.error,
    })
    return null
  },
})

export const saveReplayCritique = internalMutation({
  args: {
    experimentId: v.id('debugReplayExperiments'),
    critique: v.string(),
    critiqueTokens: v.number(),
  },
  handler: async (ctx, args): Promise<null> => {
    const experiment = await ctx.db.get(args.experimentId)
    if (experiment === null) return null
    await ctx.db.patch(args.experimentId, {
      critique: args.critique,
      critiqueTokens: args.critiqueTokens,
    })
    return null
  },
})

export const getReplayCritiqueSource = internalQuery({
  args: {
    authUserId: v.id('users'),
    experimentId: v.id('debugReplayExperiments'),
  },
  handler: async (ctx, args) => {
    const approval = await ctx.db
      .query('debugConsoleApprovals')
      .withIndex('by_authUserId', (q) => q.eq('authUserId', args.authUserId))
      .unique()
    const experiment = await ctx.db.get(args.experimentId)
    if (!isDebugConsoleEnabled() || approval === null || experiment === null) {
      return { error: 'Replay experiment not found.' }
    }
    const snapshot = await ctx.db
      .query('debugReplaySnapshots')
      .withIndex('by_message', (q) => q.eq('messageId', experiment.messageId))
      .order('desc')
      .first()
    const results = await ctx.db
      .query('debugReplayResults')
      .withIndex('by_experiment_and_variant', (q) => q.eq('experimentId', args.experimentId))
      .take(100)
    return {
      snapshot: snapshot?.payload ?? 'Original snapshot was reconstructed from the sanitized Call 0 trace.',
      variants: results.map((result) => ({
        variant: result.variant,
        sampleIndex: result.sampleIndex,
        functionCalls: result.functionCalls,
        requestedFields: result.requestedFields,
      })),
    }
  },
})

export const getAccess = query({
  args: {},
  handler: async (ctx, args) => {
    if (!isDebugConsoleEnabled()) {
      return { enabled: false as const, approved: false, setupAvailable: false }
    }
    const authUserId = await getAuthUserId(ctx)
    const approved = await hasDebugConsoleAccess(ctx)
    const firstApproval = await ctx.db.query('debugConsoleApprovals').first()
    return { enabled: true as const, approved, setupAvailable: authUserId !== null && firstApproval === null }
  },
})

export const claimFirstAccess = mutation({
  args: {},
  handler: async (ctx) => {
    if (!isDebugConsoleEnabled()) return { error: 'Eco Debug Console is disabled.' }
    const authUserId = await getAuthUserId(ctx)
    if (authUserId === null) return { error: 'Not authenticated.' }
    const existing = await ctx.db.query('debugConsoleApprovals').withIndex('by_authUserId', (q) => q.eq('authUserId', authUserId)).unique()
    if (existing !== null) return { approved: true }
    if (await ctx.db.query('debugConsoleApprovals').first() !== null) return { error: 'This account is not approved for the Eco Debug Console.' }
    await ctx.db.insert('debugConsoleApprovals', { authUserId, approvedAt: Date.now() })
    return { approved: true }
  },
})

export const deleteMessage = mutation({
  args: {
    messageId: v.id('messages'),
    confirmation: v.literal('DELETE MESSAGE'),
  },
  handler: async (ctx, args): Promise<{ deleted?: boolean; cardsDeleted?: number; error?: string }> => {
    if (!isDebugConsoleEnabled()) return { error: 'Eco Debug Console is disabled.' }
    if (!await hasDebugConsoleMutationAccess(ctx)) return { error: 'Debug access is not approved.' }
    const message = await ctx.db.get(args.messageId)
    const chat = message === null ? null : await ctx.db.get(message.chatId)
    if (message === null || chat === null) return { error: 'Message not found.' }
    const result = await deleteMessageForDebug(ctx, message, true)
    return { deleted: true, cardsDeleted: result.cardsDeleted }
  },
})

export const forceDeleteChat = mutation({
  args: {
    chatId: v.id('chats'),
    confirmation: v.literal('DELETE CHAT'),
  },
  handler: async (ctx, args): Promise<{ deleted?: boolean; messagesDeleted?: number; cardsDeleted?: number; error?: string }> => {
    if (!isDebugConsoleEnabled()) return { error: 'Eco Debug Console is disabled.' }
    if (!await hasDebugConsoleMutationAccess(ctx)) return { error: 'Debug access is not approved.' }
    const chat = await ctx.db.get(args.chatId)
    if (chat === null) return { error: 'Chat not found.' }

    const [messages, sessionSummaries, dailySummaries, references] = await Promise.all([
      ctx.db.query('messages').withIndex('by_chat', (q) => q.eq('chatId', chat._id)).collect(),
      ctx.db.query('sessionSummaries').withIndex('by_chat_and_tier', (q) => q.eq('chatId', chat._id)).collect(),
      ctx.db.query('dailySummaries').withIndex('by_chat', (q) => q.eq('chatId', chat._id)).collect(),
      ctx.db.query('exerciseSearchReferences').withIndex('by_chat', (q) => q.eq('chatId', chat._id)).collect(),
    ])
    let cardsDeleted = 0
    for (const message of messages) {
      const result = await deleteMessageForDebug(ctx, message, false)
      cardsDeleted += result.cardsDeleted
    }
    for (const summary of sessionSummaries) await ctx.db.delete(summary._id)
    for (const summary of dailySummaries) await ctx.db.delete(summary._id)
    for (const reference of references) await ctx.db.delete(reference._id)
    await ctx.db.delete(chat._id)
    return { deleted: true, messagesDeleted: messages.length, cardsDeleted }
  },
})

export const listUsers = query({
  args: {},
  handler: async (ctx) => {
    if (!isDebugConsoleEnabled()) return { error: 'Eco Debug Console is disabled.', users: [] }
    if (!await hasDebugConsoleAccess(ctx)) return { error: 'Debug access is not approved.', users: [] }
    const profiles = (await ctx.db.query('profiles').collect()).sort((left, right) => left.createdAt - right.createdAt)
    return {
      error: null,
      users: await Promise.all(profiles.map(async (profile, index) => ({
        profileId: profile._id,
        label: `user_${index + 1}`,
        dayCount: (await ctx.db.query('chats').withIndex('by_user_date', (q) => q.eq('userId', profile._id)).collect()).length,
      }))),
    }
  },
})

export const listDays = query({
  args: { profileId: v.id('profiles') },
  handler: async (ctx, args) => {
    if (!isDebugConsoleEnabled()) return { error: 'Eco Debug Console is disabled.', days: [] }
    if (!await hasDebugConsoleAccess(ctx)) return { error: 'Debug access is not approved.', days: [] }
    const chats = await ctx.db.query('chats').withIndex('by_user_date', (q) => q.eq('userId', args.profileId)).order('desc').collect()
    return { error: null, days: chats.map((chat) => ({ date: chat.date })) }
  },
})

export const listTurns = query({
  args: { profileId: v.id('profiles'), date: v.string(), limit: v.number() },
  handler: async (ctx, args) => {
    if (!isDebugConsoleEnabled()) return { enabled: false as const, error: 'Eco Debug Console is disabled.', turns: [] }
    if (!await hasDebugConsoleAccess(ctx)) return { enabled: true as const, error: 'Debug access is not approved.', turns: [] }

    const chats = await ctx.db
      .query('chats')
      .withIndex('by_user_date', (q) => q.eq('userId', args.profileId).eq('date', args.date))
      .collect()
    const requestedLimit = Math.min(Math.max(Math.floor(args.limit), 1), 100)
    const turns = []

    for (const chat of chats) {
      const remaining = requestedLimit - turns.length
      if (remaining <= 0) break
      const messages = await ctx.db
        .query('messages')
        .withIndex('by_chat', (q) => q.eq('chatId', chat._id))
        .order('desc')
        .take(remaining)

      for (const message of messages) {
        const events = await ctx.db
          .query('debugTurnEvents')
          .withIndex('by_message_and_sequence', (q) => q.eq('messageId', message._id))
          .take(200)
        const warningCodes = [...new Set(events.flatMap((event) => event.warningCodes))]
        turns.push({
          chatDate: chat.date,
          chatId: chat._id,
          eventCount: events.length,
          messageId: message._id,
          timestamp: message.timestamp,
          userText: message.userText,
          ecoText: message.ecoText,
          usedTools: message.usedTools ?? [],
          warningCodes,
          hasError: events.some((event) => event.status === 'error'),
        })
      }
    }

    return { enabled: true as const, error: null, turns: turns.sort((left, right) => right.timestamp - left.timestamp) }
  },
})

export const getTurnDetail = query({
  args: { messageId: v.id('messages') },
  handler: async (ctx, args) => {
    if (!isDebugConsoleEnabled()) {
      return { error: 'Eco Debug Console is disabled.' }
    }
    const approved = await hasDebugConsoleAccess(ctx)
    const message = await ctx.db.get(args.messageId)
    const chat = message === null ? null : await ctx.db.get(message.chatId)
    if (!approved || message === null || chat === null) {
      return { error: 'Turn not found' }
    }

    const [events, blocks, toolTraces, cards, guideInvocations] = await Promise.all([
      ctx.db
        .query('debugTurnEvents')
        .withIndex('by_message_and_sequence', (q) => q.eq('messageId', message._id))
        .order('asc')
        .take(500),
      ctx.db
        .query('messageBlocks')
        .withIndex('by_message', (q) => q.eq('messageId', message._id))
        .take(100),
      ctx.db
        .query('toolTraces')
        .withIndex('by_message', (q) => q.eq('messageId', message._id))
        .take(100),
      ctx.db
        .query('cards')
        .withIndex('by_message', (q) => q.eq('messageId', message._id))
        .take(50),
      ctx.db
        .query('guideInvocations')
        .withIndex('by_message', (q) => q.eq('messageId', message._id))
        .take(50),
    ])

    return {
      message,
      chat: { date: chat.date },
      events,
      messageBlocks: blocks.sort((left, right) => left.order - right.order),
      toolTraces: toolTraces.sort((left, right) => left.order - right.order),
      cards: cards.sort((left, right) => left.order - right.order),
      guideInvocations,
    }
  },
})

export const getReplayExperiment = query({
  args: { messageId: v.id('messages') },
  handler: async (ctx, args) => {
    if (!isDebugConsoleEnabled()) return { error: 'Eco Debug Console is disabled.' }
    if (!await hasDebugConsoleAccess(ctx)) return { error: 'Debug access is not approved.' }
    const message = await ctx.db.get(args.messageId)
    if (message === null) return { error: 'Turn not found.' }
    const experiment = await ctx.db
      .query('debugReplayExperiments')
      .withIndex('by_message_and_createdAt', (q) => q.eq('messageId', args.messageId))
      .order('desc')
      .first()
    if (experiment === null) return { experiment: null, results: [] }
    const results = await ctx.db
      .query('debugReplayResults')
      .withIndex('by_experiment_and_variant', (q) => q.eq('experimentId', experiment._id))
      .take(100)
    return {
      experiment,
      results: results.sort((left, right) => left.variant.localeCompare(right.variant) || left.sampleIndex - right.sampleIndex),
    }
  },
})
