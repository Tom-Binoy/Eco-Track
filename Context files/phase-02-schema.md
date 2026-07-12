# Eco Track — Phase 2: Schema

> Load alongside: `_context.md`, `Final-Schema.md`
> Depends on: Phase 1 (Convex connected, `convex/schema.ts` exists)
> Done when: Full schema is deployed to Convex, all tables and indexes are live, TypeScript types are generated and error-free

---

## Objective

Deploy the complete Convex schema. Every table, every field, every index — exactly as defined in `Final-Schema.md`. This is the single most important phase for long-term consistency. A schema mistake here means a migration later, which is painful in a live app.

**Read `Final-Schema.md` in full before writing a single line.** Every field has a comment explaining why it exists. Those comments matter.

---

## What to Build

### 1. `convex/schema.ts`

Translate the full schema from `Final-Schema.md` into Convex's `defineSchema` / `defineTable` / `v.*` validator syntax.

Key rules:
- `v.id("profiles")` for all `userId` fields **except** `profiles.userId` which is `v.id("users")` (FK to Convex Auth)
- Optional fields use `v.optional(...)` 
- Arrays use `v.array(...)`
- Union types use `v.union(v.literal("a"), v.literal("b"), ...)`
- Objects use `v.object({ ... })`

#### Table list (all must be present):

**`profiles`**
```ts
defineTable({
  userId: v.id("users"),                    // FK -> Convex Auth
  name: v.string(),
  createdAt: v.number(),
  injuries: v.array(v.object({
    description: v.string(),
    status: v.string(),
    notedAt: v.number(),
  })),
  equipment: v.string(),
  goals: v.string(),
  trainingAvailability: v.object({
    daysPerWeek: v.number(),
    sessionLength: v.number(),
  }),
  tonePreference: v.string(),
  weightUnit: v.union(v.literal("kg"), v.literal("lbs")),
  distanceUnit: v.union(v.literal("miles"), v.literal("km")),
  darkMode: v.boolean(),
  timezone: v.string(),                     // IANA string e.g. "Europe/London"
  skillLevel: v.object({
    strength: v.string(),
    flexibility: v.string(),
    endurance: v.string(),
    calisthenicsSkills: v.string(),
    sportSpecific: v.string(),
    bodyComposition: v.string(),
  }),
  trainingPattern: v.string(),
}).index("by_userId", ["userId"])
```

**`chats`**
```ts
defineTable({
  userId: v.id("profiles"),
  date: v.string(),                         // "2026-06-29"
  createdAt: v.number(),
  cachedContext: v.optional(v.any()),       // snapshot of profiles+workoutContext
  cachedContextAt: v.optional(v.number()),
}).index("by_user_date", ["userId", "date"])
```

**`messages`**
```ts
defineTable({
  chatId: v.id("chats"),
  userText: v.string(),
  ecoText: v.string(),
  sessionId: v.optional(v.id("sessions")),
  timestamp: v.number(),
  cardContext: v.optional(v.array(v.object({
    cardId: v.id("cards"),
    order: v.number(),
    closed: v.boolean(),
  }))),
}).index("by_chat", ["chatId"])
 .index("by_session", ["sessionId"])
```

**`cards`**
```ts
defineTable({
  chatId: v.id("chats"),
  messageId: v.id("messages"),
  sessionId: v.optional(v.id("sessions")), // unset until low-confidence card is confirmed
  rawOutput: v.string(),                   // exact Gemini JSON
  parsedData: v.any(),                     // structured interpretation
  state: v.union(v.literal("pending"), v.literal("confirmed")),
  order: v.number(),
  inDiscussion: v.boolean(),
  createdAt: v.number(),
}).index("by_chat", ["chatId"])
 .index("by_session", ["sessionId"])
 .index("by_message", ["messageId"])
```

**`sessions`**
```ts
defineTable({
  userId: v.id("profiles"),
  date: v.string(),
  notes: v.optional(v.string()),
  createdAt: v.number(),
}).index("by_user_date", ["userId", "date"])
```

**`blocks`**
```ts
defineTable({
  sessionId: v.id("sessions"),
  userId: v.id("profiles"),               // denormalized, write-once
  types: v.array(v.union(
    v.literal("standard"),
    v.literal("superset"),
    v.literal("dropset"),
    v.literal("emom"),
    v.literal("pyramid"),
    v.literal("circuit"),
    v.literal("amrap"),
  )),
  intervalSeconds: v.optional(v.number()),
  order: v.number(),
  createdAt: v.number(),
}).index("by_session", ["sessionId"])
```

**`exercises`**
```ts
defineTable({
  blockId: v.id("blocks"),
  userId: v.id("profiles"),              // denormalized, write-once
  name: v.string(),
  weightUnit: v.optional(v.union(v.literal("kg"), v.literal("lbs"))),
  order: v.number(),
  sets: v.array(v.object({
    reps: v.optional(v.number()),
    weight: v.optional(v.number()),
    duration: v.optional(v.number()),
    distance: v.optional(v.number()),
  })),
  createdAt: v.number(),
}).index("by_block", ["blockId"])
```

**`dailySummaries`**
```ts
defineTable({
  chatId: v.id("chats"),
  userId: v.id("profiles"),
  date: v.string(),
  content: v.string(),
  profileUpdated: v.boolean(),
  profileUpdateNotes: v.optional(v.string()),
  createdAt: v.number(),
}).index("by_chat", ["chatId"])
 .index("by_user_date", ["userId", "date"])
 .index("by_profileUpdated", ["profileUpdated"])
```

**`workoutContext`**
```ts
defineTable({
  userId: v.id("profiles"),
  content: v.object({
    currentFocus: v.string(),
    recentProgress: v.string(),
    consistency: v.string(),
    notableAchievements: v.string(),
    considerations: v.string(),
  }),
  triggerReason: v.literal("daily-check"),
  sourceSessionId: v.optional(v.id("sessions")),
  sourceDailySummaryId: v.optional(v.id("dailySummaries")),
  createdAt: v.number(),
}).index("by_user", ["userId"])
```

**`sessionSummaries`**
```ts
defineTable({
  chatId: v.id("chats"),
  content: v.string(),
  tier: v.union(v.literal(1), v.literal(2)),
  compressedTill: v.number(),            // timestamp of last raw message covered
  order: v.number(),
  createdAt: v.number(),
}).index("by_chat_and_tier", ["chatId", "tier"])
```

**`apiUsage`**
```ts
defineTable({
  userId: v.id("profiles"),
  timestamp: v.number(),
  tokensUsed: v.number(),
}).index("by_user_time", ["userId", "timestamp"])
```

**`messageFeedback`**
```ts
defineTable({
  messageId: v.id("messages"),
  userId: v.id("profiles"),
  rating: v.union(v.literal("up"), v.literal("down")),
  comment: v.optional(v.string()),
  timestamp: v.number(),
}).index("by_rating", ["rating"])
```

**`userReports`**
```ts
defineTable({
  userId: v.id("profiles"),             // intentionally left dangling on profile deletion
  type: v.union(v.literal("bug"), v.literal("feature"), v.literal("other")),
  message: v.string(),
  timestamp: v.number(),
}).index("by_type_timestamp", ["type", "timestamp"])
```

---

### 2. `types/db.ts`

After the schema is deployed and Convex generates types, create a `types/db.ts` file that re-exports the inferred types for use across the app:

```ts
import type { Doc, Id } from '../convex/_generated/dataModel'

export type Profile = Doc<'profiles'>
export type Chat = Doc<'chats'>
export type Message = Doc<'messages'>
export type Card = Doc<'cards'>
export type Session = Doc<'sessions'>
export type Block = Doc<'blocks'>
export type Exercise = Doc<'exercises'>
export type DailySummary = Doc<'dailySummaries'>
export type WorkoutContext = Doc<'workoutContext'>
export type SessionSummary = Doc<'sessionSummaries'>
export type ApiUsage = Doc<'apiUsage'>
export type MessageFeedback = Doc<'messageFeedback'>
export type UserReport = Doc<'userReports'>

// Re-export Id for convenience
export type { Id }
```

---

## Done Checklist

- [ ] `npx convex dev` deploys schema with zero errors
- [ ] All 13 tables are visible in the Convex dashboard
- [ ] All indexes are present and named correctly
- [ ] `npx tsc --noEmit` reports zero errors
- [ ] `types/db.ts` exists and all types resolve
- [ ] No table is missing, no field is missing, no index is missing

---

## Critical Rules for This Phase

- Do not add any fields not in the schema — "just in case" fields are banned
- Do not change any field name — downstream phases reference these exactly
- Do not collapse the two cascade paths into schema logic — cascade behavior lives in mutations (Phases 3–7), not here
- `cards.state` has exactly two values: `"pending"` and `"confirmed"` — do not add `"editing"`
- `blocks.userId` and `exercises.userId` are denormalized intentionally — do not remove them

---

## Next Phase

Phase 3 — Auth: Google OAuth via Convex Auth, profile creation on first login.
