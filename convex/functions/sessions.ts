import { v } from 'convex/values'

import { internalQuery } from '../_generated/server'

export const getForDate = internalQuery({
  args: { userId: v.id('profiles'), date: v.string() },
  handler: async (ctx, args) =>
    await ctx.db
      .query('sessions')
      .withIndex('by_user_date', (queryBuilder) =>
        queryBuilder.eq('userId', args.userId).eq('date', args.date),
      )
      .take(20),
})
