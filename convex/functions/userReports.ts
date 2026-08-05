import { getAuthUserId } from '@convex-dev/auth/server'
import { v } from 'convex/values'

import { mutation } from '../_generated/server'

export const submit = mutation({
  args: {
    message: v.string(),
    type: v.union(v.literal('bug'), v.literal('feature'), v.literal('other')),
  },
  handler: async (ctx, args) => {
    const authUserId = await getAuthUserId(ctx)
    const profile = authUserId === null ? null : await ctx.db.query('profiles').withIndex('by_userId', (q) => q.eq('userId', authUserId)).unique()
    const message = args.message.trim()
    if (profile === null) return { error: 'Not authenticated' }
    if (message.length < 3 || message.length > 4000) return { error: 'Feedback must be between 3 and 4,000 characters' }
    const reportId = await ctx.db.insert('userReports', { message, timestamp: Date.now(), type: args.type, userId: profile._id })
    return { reportId }
  },
})
