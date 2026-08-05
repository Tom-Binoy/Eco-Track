import { getAuthUserId } from '@convex-dev/auth/server'
import { v } from 'convex/values'

import type { Id } from '../_generated/dataModel'
import { mutation, query, type MutationCtx, type QueryCtx } from '../_generated/server'

async function ownedMessage(ctx: QueryCtx | MutationCtx, messageId: Id<'messages'>) {
  const authUserId = await getAuthUserId(ctx)
  const profile = authUserId === null ? null : await ctx.db.query('profiles').withIndex('by_userId', (q) => q.eq('userId', authUserId)).unique()
  const message = await ctx.db.get(messageId)
  const chat = message === null ? null : await ctx.db.get(message.chatId)
  return profile !== null && message !== null && chat?.userId === profile._id ? { message, profile } : null
}

export const getForMessage = query({
  args: { messageId: v.id('messages') },
  handler: async (ctx, args) => {
    const access = await ownedMessage(ctx, args.messageId)
    if (access === null) return null
    return await ctx.db.query('messageFeedback').withIndex('by_message', (q) => q.eq('messageId', args.messageId)).first()
  },
})

export const setForMessage = mutation({
  args: { messageId: v.id('messages'), rating: v.union(v.literal('up'), v.literal('down')) },
  handler: async (ctx, args) => {
    const access = await ownedMessage(ctx, args.messageId)
    if (access === null) return { error: 'Message not found' }
    const existing = await ctx.db.query('messageFeedback').withIndex('by_message', (q) => q.eq('messageId', args.messageId)).first()
    if (existing?.rating === args.rating) {
      await ctx.db.delete(existing._id)
      return { rating: null }
    }
    if (existing === null) {
      await ctx.db.insert('messageFeedback', { messageId: args.messageId, rating: args.rating, timestamp: Date.now(), userId: access.profile._id })
    } else {
      await ctx.db.patch(existing._id, { rating: args.rating, timestamp: Date.now() })
    }
    return { rating: args.rating }
  },
})
