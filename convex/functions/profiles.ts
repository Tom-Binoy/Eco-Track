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
      motionPreference: 'responsive',
      ecoRevealPreference: 'natural',
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

function dateInTimezone(timezone: string): string {
  try {
    return new Intl.DateTimeFormat('en-CA', { day: '2-digit', month: '2-digit', timeZone: timezone, year: 'numeric' }).format(new Date())
  } catch {
    return new Date().toISOString().slice(0, 10)
  }
}

export const updateUnits = mutation({
  args: {
    distanceUnit: v.union(v.literal('km'), v.literal('miles')),
    weightUnit: v.union(v.literal('kg'), v.literal('lbs')),
  },
  handler: async (ctx, args) => {
    const authUserId = await getAuthUserId(ctx)
    if (authUserId === null) return { error: 'Not authenticated' }
    const profile = await ctx.db.query('profiles').withIndex('by_userId', (q) => q.eq('userId', authUserId)).unique()
    if (profile === null) return { error: 'Profile not found' }
    await ctx.db.patch(profile._id, args)
    const chat = await ctx.db.query('chats').withIndex('by_user_date', (q) => q.eq('userId', profile._id).eq('date', dateInTimezone(profile.timezone))).unique()
    if (chat !== null) await ctx.db.patch(chat._id, { cachedContext: undefined, cachedContextAt: undefined })
    return { profileId: profile._id }
  },
})

export const updateMotionPreferences = mutation({
  args: {
    ecoRevealPreference: v.union(v.literal('natural'), v.literal('random')),
    motionPreference: v.union(v.literal('responsive'), v.literal('cinematic')),
  },
  handler: async (ctx, args) => {
    const authUserId = await getAuthUserId(ctx)
    if (authUserId === null) return { error: 'Not authenticated' }
    const profile = await ctx.db.query('profiles').withIndex('by_userId', (q) => q.eq('userId', authUserId)).unique()
    if (profile === null) return { error: 'Profile not found' }
    await ctx.db.patch(profile._id, args)
    return { profileId: profile._id }
  },
})
