import { v } from 'convex/values'

import { internal } from '../_generated/api'
import type { Doc } from '../_generated/dataModel'
import { internalAction, internalMutation, internalQuery } from '../_generated/server'
import { summariseMessages, summariseSessionSummaries } from '../lib/dailyCheck'

const COMPRESSIBLE_CHARACTER_THRESHOLD = 10_000
const RECENT_MESSAGES_TO_KEEP = 5

type CompressionMessage = Doc<'messages'> & {
  messageBlocks: Array<Pick<Doc<'messageBlocks'>, 'content' | 'order' | 'toolName' | 'type'>>
}

export function estimateTokens(messages: CompressionMessage[]): number {
  return Math.ceil(estimateCharacters(messages) / 4)
}

export function estimateCharacters(messages: CompressionMessage[]): number {
  return messages.reduce(
    (total, message) => total
      + message.userText.length
      + message.ecoText.length
      + message.messageBlocks.reduce((blockTotal, block) => blockTotal + block.content.length + (block.toolName?.length ?? 0), 0),
    0,
  )
}

function getCompressionCandidate(messages: CompressionMessage[]): CompressionMessage[] {
  return messages.slice(0, Math.max(0, messages.length - RECENT_MESSAGES_TO_KEEP))
}

export const getForChat = internalQuery({
  args: { chatId: v.id('chats') },
  handler: async (ctx, args) =>
    await ctx.db
      .query('sessionSummaries')
      .withIndex('by_chat_and_tier', (queryBuilder) => queryBuilder.eq('chatId', args.chatId))
      .order('asc')
      .take(50),
})

export const writeSummary = internalMutation({
  args: {
    chatId: v.id('chats'),
    content: v.string(),
    tier: v.literal(1),
    compressedTill: v.number(),
    order: v.number(),
  },
  handler: async (ctx, args) => await ctx.db.insert('sessionSummaries', { ...args, createdAt: Date.now() }),
})

export const writeTierTwoAndRemoveTierOne = internalMutation({
  args: {
    chatId: v.id('chats'),
    sourceSummaryIds: v.array(v.id('sessionSummaries')),
    retainedSummaryId: v.id('sessionSummaries'),
    content: v.string(),
    compressedTill: v.number(),
  },
  handler: async (ctx, args) => {
    const summaries = await ctx.db
      .query('sessionSummaries')
      .withIndex('by_chat_and_tier', (queryBuilder) => queryBuilder.eq('chatId', args.chatId))
      .take(50)
    const tierOne = summaries.filter((summary) => summary.tier === 1)
    const orderedTierOne = [...tierOne].sort((left, right) => left.compressedTill - right.compressedTill)
    const oldestFive = orderedTierOne.slice(0, 5)
    const retained = orderedTierOne[5]
    const sourceIds = new Set(args.sourceSummaryIds)
    const sourcesAreCurrent = args.sourceSummaryIds.length === 5
      && orderedTierOne.length >= 6
      && retained !== undefined
      && args.retainedSummaryId === retained._id
      && args.sourceSummaryIds.every((id, index) => id === oldestFive[index]?._id)
    if (!sourcesAreCurrent) return { created: false }

    for (const summary of tierOne) {
      if (sourceIds.has(summary._id)) await ctx.db.delete(summary._id)
    }
    const order = summaries.filter((summary) => summary.tier === 2).length
    await ctx.db.insert('sessionSummaries', {
      chatId: args.chatId,
      content: args.content,
      tier: 2,
      compressedTill: args.compressedTill,
      order,
      createdAt: Date.now(),
    })
    return { created: true }
  },
})

export const purgeForChat = internalMutation({
  args: { chatId: v.id('chats') },
  handler: async (ctx, args) => {
    const summaries = await ctx.db
      .query('sessionSummaries')
      .withIndex('by_chat_and_tier', (queryBuilder) => queryBuilder.eq('chatId', args.chatId))
      .take(50)

    for (const summary of summaries) {
      await ctx.db.delete(summary._id)
    }

    return null
  },
})

export const compressIfNeeded = internalAction({
  args: { chatId: v.id('chats'), userId: v.id('profiles') },
  handler: async (ctx, args): Promise<{ compressed: boolean; error?: string }> => {
    const chat = await ctx.runQuery(internal.functions.chats.getForCompression, { chatId: args.chatId })
    if (chat === null || chat.userId !== args.userId) {
      return { compressed: false, error: 'Chat not found' }
    }

    const messages = await ctx.runQuery(internal.functions.messages.getAllForCompression, {
      chatId: args.chatId,
    })
    const summaries = await ctx.runQuery(internal.functions.sessionSummaries.getForChat, {
      chatId: args.chatId,
    })
    const latestCompressedTill = summaries.reduce(
      (latest, summary) => Math.max(latest, summary.compressedTill),
      0,
    )
    const uncompressed = messages.filter((message) => message.timestamp > latestCompressedTill)
    const candidate = getCompressionCandidate(uncompressed)

    // The newest five messages remain raw. Only the content that would actually
    // be replaced by a summary counts toward the compression threshold.
    if (candidate.length === 0 || estimateCharacters(candidate) < COMPRESSIBLE_CHARACTER_THRESHOLD) {
      return { compressed: false }
    }

    try {
      const result = await summariseMessages(candidate)
      await ctx.runMutation(internal.functions.apiUsage.logUsage, {
        userId: args.userId,
        tokensUsed: result.tokensUsed,
        timestamp: Date.now(),
      })
      await ctx.runMutation(internal.functions.sessionSummaries.writeSummary, {
        chatId: args.chatId,
        content: result.content,
        tier: 1,
        compressedTill: candidate[candidate.length - 1]!.timestamp,
        order: summaries.filter((summary) => summary.tier === 1).length,
      })
      const summariesAfterTierOne = await ctx.runQuery(internal.functions.sessionSummaries.getForChat, {
        chatId: args.chatId,
      })
      const tierOne = summariesAfterTierOne
        .filter((summary) => summary.tier === 1)
        .sort((left, right) => left.compressedTill - right.compressedTill)
      const retainedTierOne = tierOne[5]

      // Wait for six Tier-1 rows, then compact exactly the five oldest. The
      // sixth and any newer rows stay available as the fresh Tier-1 tail.
      if (tierOne.length >= 6 && retainedTierOne !== undefined) {
        const tierTwoSources = tierOne.slice(0, 5)
        const tierTwo = await summariseSessionSummaries(tierTwoSources)
        const tierTwoWrite = await ctx.runMutation(
          internal.functions.sessionSummaries.writeTierTwoAndRemoveTierOne,
          {
            chatId: args.chatId,
            sourceSummaryIds: tierTwoSources.map((summary) => summary._id),
            retainedSummaryId: retainedTierOne._id,
            content: tierTwo.content,
            compressedTill: tierTwoSources.at(-1)!.compressedTill,
          },
        )
        if (tierTwoWrite.created) {
          await ctx.runMutation(internal.functions.apiUsage.logUsage, {
            userId: args.userId,
            tokensUsed: tierTwo.tokensUsed,
            timestamp: Date.now(),
          })
        }
      }
      return { compressed: true }
    } catch {
      return { compressed: false, error: 'Could not compress this chat' }
    }
  },
})
