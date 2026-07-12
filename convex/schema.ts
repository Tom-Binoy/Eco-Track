import { defineSchema, defineTable } from 'convex/server'
import { v } from 'convex/values'

export default defineSchema({
  profiles: defineTable({
    userId: v.id('users'),
    name: v.string(),
    createdAt: v.number(),
    injuries: v.array(
      v.object({
        description: v.string(),
        status: v.string(),
        notedAt: v.number(),
      }),
    ),
    equipment: v.string(),
    goals: v.string(),
    trainingAvailability: v.object({
      daysPerWeek: v.number(),
      sessionLength: v.number(),
    }),
    tonePreference: v.string(),
    weightUnit: v.union(v.literal('kg'), v.literal('lbs')),
    distanceUnit: v.union(v.literal('miles'), v.literal('km')),
    darkMode: v.boolean(),
    timezone: v.string(),
    skillLevel: v.object({
      strength: v.string(),
      flexibility: v.string(),
      endurance: v.string(),
      calisthenicsSkills: v.string(),
      sportSpecific: v.string(),
      bodyComposition: v.string(),
    }),
    trainingPattern: v.string(),
  }).index('by_userId', ['userId']),

  chats: defineTable({
    userId: v.id('profiles'),
    date: v.string(),
    createdAt: v.number(),
    cachedContext: v.optional(v.any()),
    cachedContextAt: v.optional(v.number()),
  }).index('by_user_date', ['userId', 'date']),

  messages: defineTable({
    chatId: v.id('chats'),
    userText: v.string(),
    ecoText: v.string(),
    sessionId: v.optional(v.id('sessions')),
    timestamp: v.number(),
    cardContext: v.optional(
      v.array(
        v.object({
          cardId: v.id('cards'),
          order: v.number(),
          closed: v.boolean(),
        }),
      ),
    ),
  })
    .index('by_chat', ['chatId'])
    .index('by_session', ['sessionId']),

  cards: defineTable({
    chatId: v.id('chats'),
    messageId: v.id('messages'),
    sessionId: v.optional(v.id('sessions')),
    rawOutput: v.string(),
    parsedData: v.any(),
    state: v.union(v.literal('pending'), v.literal('confirmed')),
    order: v.number(),
    inDiscussion: v.boolean(),
    createdAt: v.number(),
  })
    .index('by_chat', ['chatId'])
    .index('by_session', ['sessionId'])
    .index('by_message', ['messageId']),

  sessions: defineTable({
    userId: v.id('profiles'),
    date: v.string(),
    notes: v.optional(v.string()),
    createdAt: v.number(),
  }).index('by_user_date', ['userId', 'date']),

  blocks: defineTable({
    sessionId: v.id('sessions'),
    userId: v.id('profiles'),
    types: v.array(
      v.union(
        v.literal('standard'),
        v.literal('superset'),
        v.literal('dropset'),
        v.literal('emom'),
        v.literal('pyramid'),
        v.literal('circuit'),
        v.literal('amrap'),
      ),
    ),
    intervalSeconds: v.optional(v.number()),
    order: v.number(),
    createdAt: v.number(),
  }).index('by_session', ['sessionId']),

  exercises: defineTable({
    blockId: v.id('blocks'),
    userId: v.id('profiles'),
    name: v.string(),
    weightUnit: v.optional(v.union(v.literal('kg'), v.literal('lbs'))),
    order: v.number(),
    sets: v.array(
      v.object({
        reps: v.optional(v.number()),
        weight: v.optional(v.number()),
        duration: v.optional(v.number()),
        distance: v.optional(v.number()),
      }),
    ),
    createdAt: v.number(),
  }).index('by_block', ['blockId']),

  dailySummaries: defineTable({
    chatId: v.id('chats'),
    userId: v.id('profiles'),
    date: v.string(),
    content: v.string(),
    profileUpdated: v.boolean(),
    profileUpdateNotes: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index('by_chat', ['chatId'])
    .index('by_user_date', ['userId', 'date'])
    .index('by_profileUpdated', ['profileUpdated']),

  workoutContext: defineTable({
    userId: v.id('profiles'),
    content: v.object({
      currentFocus: v.string(),
      recentProgress: v.string(),
      consistency: v.string(),
      notableAchievements: v.string(),
      considerations: v.string(),
    }),
    triggerReason: v.literal('daily-check'),
    sourceSessionId: v.optional(v.id('sessions')),
    sourceDailySummaryId: v.optional(v.id('dailySummaries')),
    createdAt: v.number(),
  }).index('by_user', ['userId']),

  sessionSummaries: defineTable({
    chatId: v.id('chats'),
    content: v.string(),
    tier: v.union(v.literal(1), v.literal(2)),
    compressedTill: v.number(),
    order: v.number(),
    createdAt: v.number(),
  }).index('by_chat_and_tier', ['chatId', 'tier']),

  apiUsage: defineTable({
    userId: v.id('profiles'),
    timestamp: v.number(),
    tokensUsed: v.number(),
  }).index('by_user_time', ['userId', 'timestamp']),

  messageFeedback: defineTable({
    messageId: v.id('messages'),
    userId: v.id('profiles'),
    rating: v.union(v.literal('up'), v.literal('down')),
    comment: v.optional(v.string()),
    timestamp: v.number(),
  }).index('by_rating', ['rating']),

  userReports: defineTable({
    userId: v.id('profiles'),
    type: v.union(
      v.literal('bug'),
      v.literal('feature'),
      v.literal('other'),
    ),
    message: v.string(),
    timestamp: v.number(),
  }).index('by_type_timestamp', ['type', 'timestamp']),
})
