import { v } from 'convex/values'

import { internalMutation, internalQuery } from '../_generated/server'

const workoutContextContent = v.object({
  currentFocus: v.string(),
  recentProgress: v.string(),
  consistency: v.string(),
  notableAchievements: v.string(),
  considerations: v.string(),
})

export const getLatest = internalQuery({
  args: { userId: v.id('profiles') },
  handler: async (ctx, args) =>
    await ctx.db
      .query('workoutContext')
      .withIndex('by_user', (queryBuilder) => queryBuilder.eq('userId', args.userId))
      .order('desc')
      .first(),
})

export const write = internalMutation({
  args: {
    userId: v.id('profiles'),
    content: workoutContextContent,
    triggerReason: v.literal('daily-check'),
    sourceSessionId: v.optional(v.id('sessions')),
    sourceDailySummaryId: v.optional(v.id('dailySummaries')),
  },
  handler: async (ctx, args) => await ctx.db.insert('workoutContext', { ...args, createdAt: Date.now() }),
})
