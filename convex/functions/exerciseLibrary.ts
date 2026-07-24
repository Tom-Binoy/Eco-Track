import { getAuthUserId } from '@convex-dev/auth/server'
import { v } from 'convex/values'

import { internalMutation, internalQuery, query } from '../_generated/server'

export function normalizeExerciseInput(value: string): string {
  return value.trim().toLocaleLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

export const findForResolution = internalQuery({
  args: { userId: v.id('profiles'), rawInput: v.string() },
  handler: async (ctx, args) => {
    const normalized = normalizeExerciseInput(args.rawInput)
    const alias = await ctx.db.query('userExerciseAliases').withIndex('by_user_and_raw', (q) => q.eq('userId', args.userId).eq('rawInputNormalized', normalized)).unique()
    if (alias !== null) {
      const exercise = await ctx.db.get(alias.exerciseId)
      return { normalized, aliasExercise: exercise, candidates: exercise === null ? [] : [exercise] }
    }
    const search = (userId: typeof args.userId | undefined) => ctx.db.query('exerciseLibrary').withSearchIndex('search_name', (q) => q.search('searchBlob', normalized).eq('userId', userId)).take(8)
    const [global, personal] = await Promise.all([search(undefined), search(args.userId)])
    return { normalized, aliasExercise: null, candidates: [...global, ...personal] }
  },
})

export const search = query({
  args: { query: v.string(), equipment: v.optional(v.string()), muscleGroup: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const auth = await getAuthUserId(ctx)
    const profile = auth === null ? null : await ctx.db.query('profiles').withIndex('by_userId', (q) => q.eq('userId', auth)).unique()
    if (profile === null) return { error: 'Not authenticated', results: [] }
    const search = (userId: typeof profile._id | undefined) => ctx.db.query('exerciseLibrary').withSearchIndex('search_name', (q) => {
      let search = q.search('searchBlob', normalizeExerciseInput(args.query))
      search = search.eq('userId', userId)
      if (args.equipment !== undefined) search = search.eq('equipment', args.equipment)
      if (args.muscleGroup !== undefined) search = search.eq('muscleGroup', args.muscleGroup)
      return search
    }).take(10)
    const [global, personal] = await Promise.all([search(undefined), search(profile._id)])
    return { results: [...global, ...personal] }
  },
})

export const addConfirmedAlias = internalMutation({
  args: { userId: v.id('profiles'), rawInput: v.string(), exerciseId: v.id('exerciseLibrary') },
  handler: async (ctx, args) => {
    const normalized = normalizeExerciseInput(args.rawInput)
    const existing = await ctx.db.query('userExerciseAliases').withIndex('by_user_and_raw', (q) => q.eq('userId', args.userId).eq('rawInputNormalized', normalized)).unique()
    if (existing !== null) {
      await ctx.db.patch(existing._id, { exerciseId: args.exerciseId, source: 'confirmed', lastUsedAt: Date.now() })
      return existing._id
    }
    return await ctx.db.insert('userExerciseAliases', { userId: args.userId, rawInputNormalized: normalized, exerciseId: args.exerciseId, source: 'confirmed', createdAt: Date.now(), lastUsedAt: Date.now() })
  },
})

export const upsertWgerBatch = internalMutation({
  args: { exercises: v.array(v.object({ wgerId: v.number(), canonicalName: v.string(), aliases: v.array(v.string()), searchBlob: v.string(), category: v.optional(v.string()), equipment: v.optional(v.string()), muscleGroup: v.optional(v.string()), allMuscles: v.optional(v.array(v.string())), description: v.optional(v.string()) })) },
  handler: async (ctx, args) => {
    for (const exercise of args.exercises) {
      const existing = await ctx.db.query('exerciseLibrary').withIndex('by_wgerId', (q) => q.eq('wgerId', exercise.wgerId)).unique()
      const value = { ...exercise, source: 'wger' as const, createdAt: Date.now() }
      if (existing === null) await ctx.db.insert('exerciseLibrary', value)
      else await ctx.db.patch(existing._id, value)
    }
    return null
  },
})
