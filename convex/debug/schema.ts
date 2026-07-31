import { defineTable } from 'convex/server'
import { v } from 'convex/values'

export const debugTables = {
  debugConsoleApprovals: defineTable({
    authUserId: v.id('users'),
    approvedAt: v.number(),
  }).index('by_authUserId', ['authUserId']),
  debugTurnEvents: defineTable({
    userId: v.id('profiles'),
    chatId: v.id('chats'),
    messageId: v.id('messages'),
    runId: v.string(),
    sequence: v.number(),
    kind: v.union(
      v.literal('lifecycle'),
      v.literal('context'),
      v.literal('gemini'),
      v.literal('tool'),
      v.literal('validation'),
      v.literal('database'),
      v.literal('error'),
      v.literal('warning'),
    ),
    status: v.union(
      v.literal('info'),
      v.literal('running'),
      v.literal('success'),
      v.literal('warning'),
      v.literal('error'),
      v.literal('skipped'),
    ),
    title: v.string(),
    summary: v.optional(v.string()),
    source: v.object({
      file: v.string(),
      symbol: v.string(),
    }),
    details: v.optional(v.string()),
    callIndex: v.optional(v.number()),
    toolName: v.optional(v.string()),
    durationMs: v.optional(v.number()),
    tokens: v.optional(
      v.object({
        prompt: v.optional(v.number()),
        output: v.optional(v.number()),
        total: v.number(),
      }),
    ),
    warningCodes: v.array(v.string()),
    occurredAt: v.number(),
    createdAt: v.number(),
  })
    .index('by_message_and_sequence', ['messageId', 'sequence'])
    .index('by_user_and_createdAt', ['userId', 'createdAt']),
  debugReplaySnapshots: defineTable({
    userId: v.id('profiles'),
    messageId: v.id('messages'),
    runId: v.string(),
    payload: v.string(),
    capturedAt: v.number(),
  })
    .index('by_message', ['messageId'])
    .index('by_user_and_capturedAt', ['userId', 'capturedAt']),
  debugReplayExperiments: defineTable({
    userId: v.id('profiles'),
    messageId: v.id('messages'),
    status: v.union(v.literal('running'), v.literal('completed'), v.literal('failed')),
    snapshotSource: v.union(v.literal('captured'), v.literal('reconstructed')),
    createdAt: v.number(),
    completedAt: v.optional(v.number()),
    error: v.optional(v.string()),
    critique: v.optional(v.string()),
    critiqueTokens: v.optional(v.number()),
  })
    .index('by_message_and_createdAt', ['messageId', 'createdAt'])
    .index('by_user_and_createdAt', ['userId', 'createdAt']),
  debugReplayResults: defineTable({
    experimentId: v.id('debugReplayExperiments'),
    variant: v.string(),
    sampleIndex: v.number(),
    rawText: v.string(),
    finalText: v.string(),
    functionCalls: v.string(),
    getDataSelected: v.boolean(),
    requestedFields: v.array(v.string()),
    promptTokens: v.optional(v.number()),
    outputTokens: v.optional(v.number()),
    totalTokens: v.number(),
    durationMs: v.number(),
    error: v.optional(v.string()),
  }).index('by_experiment_and_variant', ['experimentId', 'variant']),
}
