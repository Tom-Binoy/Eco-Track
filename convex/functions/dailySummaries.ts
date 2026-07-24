import { v } from 'convex/values'

import { internalMutation, internalQuery } from '../_generated/server'

const injury = v.object({
  injuryId: v.string(),
  description: v.string(),
  status: v.string(),
  notedAt: v.number(),
})

const trainingAvailability = v.object({
  daysPerWeek: v.number(),
  sessionLength: v.number(),
})

const skillLevel = v.object({
  strength: v.string(),
  flexibility: v.string(),
  endurance: v.string(),
  calisthenicsSkills: v.string(),
  sportSpecific: v.string(),
  bodyComposition: v.string(),
})

const profileUpdate = v.object({
  goals: v.optional(v.string()),
  equipment: v.optional(v.string()),
  trainingPattern: v.optional(v.string()),
  trainingAvailability: v.optional(trainingAvailability),
  skillLevel: v.optional(skillLevel),
  injuries: v.optional(v.array(injury)),
})

const workoutContextContent = v.object({
  currentFocus: v.string(),
  recentProgress: v.string(),
  consistency: v.string(),
  notableAchievements: v.string(),
  considerations: v.string(),
})

const MINIMUM_DAILY_SUMMARIES_FOR_CLEANUP = 2

export const getForDate = internalQuery({
  args: { userId: v.id('profiles'), date: v.string() },
  handler: async (ctx, args) =>
    await ctx.db
      .query('dailySummaries')
      .withIndex('by_user_date', (queryBuilder) =>
        queryBuilder.eq('userId', args.userId).eq('date', args.date),
      )
      .first(),
})

export const write = internalMutation({
  args: {
    chatId: v.id('chats'),
    userId: v.id('profiles'),
    date: v.string(),
    content: v.string(),
    profileUpdated: v.boolean(),
    profileUpdateNotes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query('dailySummaries')
      .withIndex('by_user_date', (queryBuilder) =>
        queryBuilder.eq('userId', args.userId).eq('date', args.date),
      )
      .first()
    if (existing !== null) {
      return { dailySummaryId: existing._id, created: false }
    }

    return {
      dailySummaryId: await ctx.db.insert('dailySummaries', { ...args, createdAt: Date.now() }),
      created: true,
    }
  },
})

export const getSinceWorkoutContext = internalQuery({
  args: {
    userId: v.id('profiles'),
    sourceDailySummaryId: v.optional(v.id('dailySummaries')),
  },
  handler: async (ctx, args) => {
    const summaries = []
    const query = ctx.db
      .query('dailySummaries')
      .withIndex('by_user_date', (queryBuilder) => queryBuilder.eq('userId', args.userId))
      .order('asc')
    for await (const summary of query) summaries.push(summary)

    if (args.sourceDailySummaryId === undefined) return summaries
    const sourceIndex = summaries.findIndex((summary) => summary._id === args.sourceDailySummaryId)
    if (sourceIndex === -1) return summaries

    const summariesSinceWorkoutContextStart = sourceIndex + 1
    const minimumHistoryStart = Math.max(0, summaries.length - MINIMUM_DAILY_SUMMARIES_FOR_CLEANUP)
    return summaries.slice(Math.min(summariesSinceWorkoutContextStart, minimumHistoryStart))
  },
})

export const commitDailyCleanup = internalMutation({
  args: {
    chatId: v.id('chats'),
    userId: v.id('profiles'),
    date: v.string(),
    content: v.string(),
    profileUpdate: v.union(v.null(), profileUpdate),
    profileUpdateNotes: v.optional(v.string()),
    workoutContext: v.union(v.null(), workoutContextContent),
    sourceSessionId: v.optional(v.id('sessions')),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query('dailySummaries')
      .withIndex('by_user_date', (queryBuilder) =>
        queryBuilder.eq('userId', args.userId).eq('date', args.date),
      )
      .first()
    if (existing !== null) return { dailySummaryId: existing._id, created: false }

    const profile = await ctx.db.get(args.userId)
    if (profile === null) return { created: false, error: 'Profile not found' }

    if (args.profileUpdate !== null) {
      await ctx.db.patch(profile._id, args.profileUpdate)
    }

    const dailySummaryId = await ctx.db.insert('dailySummaries', {
      chatId: args.chatId,
      userId: args.userId,
      date: args.date,
      content: args.content,
      profileUpdated: args.profileUpdate !== null,
      profileUpdateNotes: args.profileUpdateNotes,
      createdAt: Date.now(),
    })

    if (args.workoutContext !== null) {
      await ctx.db.insert('workoutContext', {
        userId: args.userId,
        content: args.workoutContext,
        triggerReason: 'daily-check',
        sourceDailySummaryId: dailySummaryId,
        sourceSessionId: args.sourceSessionId,
        createdAt: Date.now(),
      })
    }

    return { dailySummaryId, created: true }
  },
})
