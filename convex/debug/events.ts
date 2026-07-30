import { getAuthUserId } from '@convex-dev/auth/server'
import { v } from 'convex/values'

import type { Id } from '../_generated/dataModel'
import { internalMutation, mutation, query, type QueryCtx } from '../_generated/server'
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

async function hasDebugConsoleAccess(ctx: QueryCtx): Promise<boolean> {
  const authUserId = await getAuthUserId(ctx)
  if (authUserId === null) return false
  return (await ctx.db.query('debugConsoleApprovals').withIndex('by_authUserId', (q) => q.eq('authUserId', authUserId)).unique()) !== null
}

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

    const [events, blocks, cards, guideInvocations] = await Promise.all([
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
      cards: cards.sort((left, right) => left.order - right.order),
      guideInvocations,
    }
  },
})
