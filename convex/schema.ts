import { defineSchema, defineTable } from 'convex/server'
import { authTables } from '@convex-dev/auth/server'
import { v } from 'convex/values'

export default defineSchema({
  ...authTables,
  profiles: defineTable({
    userId: v.id('users'),
    name: v.string(),
    createdAt: v.number(),
    injuries: v.array(
      v.object({
        injuryId: v.string(),
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
    usedTools: v.optional(v.array(v.string())),
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
    correctsBlockId: v.optional(v.id('blocks')),
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
    exerciseId: v.id('exerciseLibrary'),
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
  })
    .index('by_block', ['blockId'])
    .index('by_exercise', ['exerciseId'])
    .index('by_user_and_name', ['userId', 'name']),

  exerciseLibrary: defineTable({
    canonicalName: v.string(),
    aliases: v.array(v.string()),
    searchBlob: v.string(),
    userId: v.optional(v.id('profiles')),
    category: v.optional(v.string()),
    equipment: v.optional(v.string()),
    muscleGroup: v.optional(v.string()),
    allMuscles: v.optional(v.array(v.string())),
    description: v.optional(v.string()),
    source: v.union(v.literal('wger'), v.literal('custom')),
    wgerId: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index('by_user', ['userId'])
    .index('by_wgerId', ['wgerId']),

  exerciseLibraryEmbeddings: defineTable({
    exerciseId: v.id('exerciseLibrary'),
    userId: v.optional(v.id('profiles')),
    equipment: v.optional(v.string()),
    muscleGroup: v.optional(v.string()),
    embedding: v.array(v.float64()),
    createdAt: v.number(),
  })
    .index('by_exercise', ['exerciseId'])
    .vectorIndex('by_embedding', {
      vectorField: 'embedding',
      dimensions: 768,
      filterFields: ['userId', 'equipment', 'muscleGroup'],
    }),

  userExerciseAliases: defineTable({
    userId: v.id('profiles'),
    rawInputNormalized: v.string(),
    exerciseId: v.id('exerciseLibrary'),
    source: v.union(v.literal('confirmed'), v.literal('auto')),
    createdAt: v.number(),
    lastUsedAt: v.number(),
  }).index('by_user_and_raw', ['userId', 'rawInputNormalized']),

  userExerciseAliasEmbeddings: defineTable({
    aliasId: v.id('userExerciseAliases'),
    userId: v.id('profiles'),
    embedding: v.array(v.float64()),
    createdAt: v.number(),
  })
    .index('by_alias', ['aliasId'])
    .vectorIndex('by_embedding', {
      vectorField: 'embedding',
      dimensions: 768,
      filterFields: ['userId'],
    }),

  messageBlocks: defineTable({
    messageId: v.id('messages'),
    order: v.number(),
    type: v.union(v.literal('text'), v.literal('tool_call'), v.literal('tool_result')),
    content: v.string(),
    toolName: v.optional(v.string()),
    createdAt: v.number(),
  }).index('by_message', ['messageId']),

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

  // Backend-only: never sent to Gemini, following the apiUsage exception pattern.
  // Written once after get_new_exercise_guidance executes; not model-invoked or returned by a tool.
  // Safety/tuning review log, not live naming-guide state; messages.usedTools remains the state source.
  guideInvocations: defineTable({
    userId: v.id('profiles'),
    messageId: v.id('messages'),
    reviewed: v.boolean(), // Write false when creating the record.
    createdAt: v.number(),
  })
    .index('by_user', ['userId'])
    .index('by_message', ['messageId']),

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
