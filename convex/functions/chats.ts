import { getAuthUserId } from '@convex-dev/auth/server'
import { v } from 'convex/values'

import { internalMutation, internalQuery, mutation, query, type MutationCtx, type QueryCtx } from '../_generated/server'

function dateInTimezone(timezone: string): string {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date())
  } catch {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'UTC',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date())
  }
}

async function getProfileForAuthenticatedUser(
  ctx: QueryCtx | MutationCtx,
) {
  const authUserId = await getAuthUserId(ctx)
  if (authUserId === null) {
    return null
  }

  return await ctx.db
    .query('profiles')
    .withIndex('by_userId', (queryBuilder) => queryBuilder.eq('userId', authUserId))
    .unique()
}

export const getMyTodayChat = query({
  args: {},
  handler: async (ctx) => {
    const profile = await getProfileForAuthenticatedUser(ctx)
    if (profile === null) {
      return null
    }

    return await ctx.db
      .query('chats')
      .withIndex('by_user_date', (queryBuilder) =>
        queryBuilder.eq('userId', profile._id).eq('date', dateInTimezone(profile.timezone)),
      )
      .unique()
  },
})

export const getOrCreateTodayChat = mutation({
  args: {},
  handler: async (ctx) => {
    const profile = await getProfileForAuthenticatedUser(ctx)
    if (profile === null) {
      return { error: 'Not authenticated' }
    }

    const date = dateInTimezone(profile.timezone)
    const existing = await ctx.db
      .query('chats')
      .withIndex('by_user_date', (queryBuilder) =>
        queryBuilder.eq('userId', profile._id).eq('date', date),
      )
      .unique()

    if (existing !== null) {
      return { chatId: existing._id }
    }

    const chatId = await ctx.db.insert('chats', {
      userId: profile._id,
      date,
      createdAt: Date.now(),
    })

    return { chatId }
  },
})

export const getForCompression = internalQuery({
  args: { chatId: v.id('chats') },
  handler: async (ctx, args) => await ctx.db.get(args.chatId),
})

export const getForDate = internalQuery({
  args: { userId: v.id('profiles'), date: v.string() },
  handler: async (ctx, args) =>
    await ctx.db
      .query('chats')
      .withIndex('by_user_date', (queryBuilder) =>
        queryBuilder.eq('userId', args.userId).eq('date', args.date),
      )
      .take(1),
})

export const invalidateCachedContext = internalMutation({
  args: { chatId: v.id('chats') },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.chatId, { cachedContext: undefined, cachedContextAt: undefined })
    return null
  },
})
