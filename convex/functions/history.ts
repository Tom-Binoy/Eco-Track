import { getAuthUserId } from '@convex-dev/auth/server'
import { paginationOptsValidator } from 'convex/server'

import type { Id } from '../_generated/dataModel'
import { query } from '../_generated/server'
import { normalizeExerciseInput } from '../lib/exerciseNormalization'

export const listMySessions = query({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (ctx, args) => {
    const authUserId = await getAuthUserId(ctx)
    const profile = authUserId === null ? null : await ctx.db.query('profiles').withIndex('by_userId', (q) => q.eq('userId', authUserId)).unique()
    if (profile === null) return { continueCursor: '', isDone: true, page: [] }

    const result = await ctx.db.query('sessions').withIndex('by_user_date', (q) => q.eq('userId', profile._id)).order('desc').paginate(args.paginationOpts)
    const page = await Promise.all(result.page.map(async (session) => {
      const blocks = (await ctx.db.query('blocks').withIndex('by_session', (q) => q.eq('sessionId', session._id)).take(50)).sort((a, b) => a.order - b.order)
      const hydratedBlocks = await Promise.all(blocks.map(async (block) => {
        const exercises = (await ctx.db.query('exercises').withIndex('by_block', (q) => q.eq('blockId', block._id)).take(100)).sort((a, b) => a.order - b.order)
        const hydratedExercises = await Promise.all(exercises.map(async (exercise) => {
          const library = await ctx.db.get(exercise.exerciseId)
          const alias = await ctx.db.query('userExerciseAliases').withIndex('by_user_and_raw', (q) => q.eq('userId', profile._id).eq('rawInputNormalized', normalizeExerciseInput(exercise.name))).unique()
          return {
            _id: exercise._id,
            canonicalName: library?.canonicalName ?? null,
            displayedName: alias?.exerciseId === exercise.exerciseId ? exercise.name : library?.canonicalName ?? exercise.name,
            order: exercise.order,
            sets: exercise.sets,
            weightUnit: exercise.weightUnit ?? profile.weightUnit,
          }
        }))
        return { _id: block._id, exercises: hydratedExercises, intervalSeconds: block.intervalSeconds, order: block.order, types: block.types }
      }))
      return { _id: session._id as Id<'sessions'>, blocks: hydratedBlocks, date: session.date, notes: session.notes }
    }))
    return { ...result, page }
  },
})
