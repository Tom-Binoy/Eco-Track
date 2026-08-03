import { v } from 'convex/values'

import { internalQuery } from '../_generated/server'

type HistoricalExercise = { exerciseId: string; name: string; date: string; blockId: string; sets: Array<{ reps?: number; weight?: number; duration?: number; distance?: number }> }
type DailySummaryForTurn = { date: string; content: string }

export const getDataForTurn = internalQuery({
  args: { userId: v.id('profiles'), startDate: v.optional(v.string()), endDate: v.optional(v.string()), exerciseId: v.optional(v.string()), dailySummaryDate: v.optional(v.string()), collectionPoints: v.optional(v.array(v.string())) },
  handler: async (ctx, args) => {
    const profile = await ctx.db.get(args.userId)
    if (profile === null) return { error: 'Profile not found', profile: {}, exercises: [] as HistoricalExercise[], dailySummary: null as DailySummaryForTurn | null }
    const selected = new Set(args.collectionPoints ?? [])
    const profileData: Record<string, unknown> = {}
    const profileFields: Record<string, unknown> = {
      name: profile.name, injuries: profile.injuries, equipment: profile.equipment, goals: profile.goals,
      trainingPattern: profile.trainingPattern, skillLevel: profile.skillLevel, weightUnit: profile.weightUnit, distanceUnit: profile.distanceUnit,
    }
    for (const point of selected) if (point in profileFields) profileData[point] = profileFields[point]

    const dailySummary = args.dailySummaryDate === undefined
      ? null
      : await ctx.db
          .query('dailySummaries')
          .withIndex('by_user_date', (q) => q.eq('userId', args.userId).eq('date', args.dailySummaryDate!))
          .first()
    const dailySummaryForTurn: DailySummaryForTurn | null = dailySummary === null
      ? null
      : { date: dailySummary.date, content: dailySummary.content }

    if (args.startDate === undefined || args.endDate === undefined) return { profile: profileData, exercises: [] as HistoricalExercise[], dailySummary: dailySummaryForTurn }
    const sessions = await ctx.db.query('sessions').withIndex('by_user_date', (q) => q.eq('userId', args.userId).gte('date', args.startDate!).lte('date', args.endDate!)).order('asc').take(50)
    const exercises: HistoricalExercise[] = []
    for (const session of sessions) {
      const blocks = await ctx.db.query('blocks').withIndex('by_session', (q) => q.eq('sessionId', session._id)).take(50)
      for (const block of blocks) {
        if (block.userId !== args.userId) continue
        const blockExercises = await ctx.db.query('exercises').withIndex('by_block', (q) => q.eq('blockId', block._id)).order('asc').take(50)
        for (const exercise of blockExercises) exercises.push({ exerciseId: `History Exercise ${exercises.length + 1}`, name: exercise.name, date: session.date, blockId: block._id, sets: exercise.sets })
      }
    }
    if (args.exerciseId === undefined) return { profile: profileData, exercises, dailySummary: dailySummaryForTurn }
    const selectedExercise = exercises.find((exercise) => exercise.exerciseId === args.exerciseId)
    return { profile: profileData, exercises: selectedExercise === undefined ? [] : [selectedExercise], dailySummary: dailySummaryForTurn }
  },
})

export const getHistoricalBlock = internalQuery({
  args: { userId: v.id('profiles'), blockId: v.id('blocks') },
  handler: async (ctx, args) => {
    const block = await ctx.db.get(args.blockId)
    return block !== null && block.userId === args.userId ? block : null
  },
})
