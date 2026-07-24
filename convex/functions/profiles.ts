import { getAuthUserId } from '@convex-dev/auth/server'
import { v } from 'convex/values'

import { internalQuery, mutation, query } from '../_generated/server'

export const createProfile = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx)

    if (userId === null) {
      return { error: 'Not authenticated' }
    }

    const existingProfile = await ctx.db
      .query('profiles')
      .withIndex('by_userId', (queryBuilder) => queryBuilder.eq('userId', userId))
      .unique()

    if (existingProfile !== null) {
      return { profileId: existingProfile._id }
    }

    const user = await ctx.db.get(userId)
    const profileId = await ctx.db.insert('profiles', {
      userId,
      name: user?.name ?? 'Athlete',
      createdAt: Date.now(),
      injuries: [],
      equipment: '',
      goals: '',
      trainingAvailability: { daysPerWeek: 3, sessionLength: 60 },
      tonePreference: 'friendly',
      weightUnit: 'kg',
      distanceUnit: 'km',
      darkMode: false,
      timezone: 'UTC',
      skillLevel: {
        strength: '',
        flexibility: '',
        endurance: '',
        calisthenicsSkills: '',
        sportSpecific: '',
        bodyComposition: '',
      },
      trainingPattern: '',
    })

    return { profileId }
  },
})

export const getProfileByUserId = internalQuery({
  args: { userId: v.id('users') },
  handler: async (ctx, args) => {
    return await ctx.db
      .query('profiles')
      .withIndex('by_userId', (queryBuilder) =>
        queryBuilder.eq('userId', args.userId),
      )
      .unique()
  },
})

export const getMyProfile = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx)

    if (userId === null) {
      return null
    }

    return await ctx.db
      .query('profiles')
      .withIndex('by_userId', (queryBuilder) => queryBuilder.eq('userId', userId))
      .unique()
  },
})

export const getAllTimezones = internalQuery({
  args: {},
  handler: async (ctx) => await ctx.db.query('profiles').collect(),
})
