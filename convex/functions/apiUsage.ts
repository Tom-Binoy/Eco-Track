import { v } from 'convex/values'

import { internalMutation } from '../_generated/server'

export const logUsage = internalMutation({
  args: {
    userId: v.id('profiles'),
    tokensUsed: v.number(),
    timestamp: v.number(),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert('apiUsage', args)
    return null
  },
})
