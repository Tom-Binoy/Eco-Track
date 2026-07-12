# Eco Track — Phase 7: Memory + Cron

> Load alongside: `_context.md`, `Turn-Lifecycle-Specification.md`
> Depends on: Phase 5 (Gemini integration — messages written to Convex), Phase 2 (schema — all memory tables exist)
> Done when: sessionSummaries compression runs post-turn, the hourly cron fires at local midnight and writes dailySummaries + updates workoutContext + purges sessionSummaries

---

## Objective

Implement the memory system. This is what makes Eco feel like it knows you over time. Without this phase, Eco starts fresh every chat with no sense of history or progress.

There are two distinct memory mechanisms:

1. **Within-chat compression** (`sessionSummaries`) — keeps long chats from blowing the context window
2. **Cross-chat memory** (`dailySummaries` + `workoutContext`) — nightly cron that builds a persistent picture of the user's training

Read Turn Lifecycle §7 (Memory / Reflection Triggers) carefully before starting.

---

## What to Build

### 1. Session Summaries (Within-Chat Compression)

`convex/functions/sessionSummaries.ts`

Compression fires **post-turn, non-blocking** when the raw messages for a chat exceed a token-size estimate threshold. It summarises older messages into a `sessionSummaries` row and stops injecting those raw messages into the context.

#### Token estimation

A simple character-count proxy: assume ~4 characters per token. Threshold: 6,000 tokens (~24,000 characters) of raw message content before compression triggers.

```ts
export function estimateTokens(messages: Message[]): number {
  const totalChars = messages.reduce((acc, msg) => {
    return acc + (msg.userText?.length ?? 0) + (msg.ecoText?.length ?? 0)
  }, 0)
  return Math.ceil(totalChars / 4)
}
```

#### Compression action

`convex/functions/sessionSummaries.ts`

```ts
export const compressIfNeeded = action({
  args: {
    chatId: v.id("chats"),
    userId: v.id("profiles"),
  },
  handler: async (ctx, { chatId, userId }) => {
    // Get all raw messages for this chat
    const messages = await ctx.runQuery(api.functions.messages.getAllForChat, { chatId })

    // Get existing compression boundary
    const existingSummaries = await ctx.runQuery(
      api.functions.sessionSummaries.getForChat, { chatId }
    )
    const latestTier1 = existingSummaries.filter(s => s.tier === 1).sort((a, b) => b.compressedTill - a.compressedTill)[0]
    const compressedUntil = latestTier1?.compressedTill ?? 0

    // Only consider messages not yet compressed
    const uncompressed = messages.filter(m => m.timestamp > compressedUntil)

    if (estimateTokens(uncompressed) < TOKEN_THRESHOLD) return // nothing to do

    // Messages to compress: everything except the last 5 (keep recent raw for context)
    const toCompress = uncompressed.slice(0, -5)
    if (toCompress.length === 0) return

    // Call Gemini to summarise
    const summary = await summariseMessages(toCompress)

    const order = existingSummaries.filter(s => s.tier === 1).length

    await ctx.runMutation(api.functions.sessionSummaries.writeSummary, {
      chatId,
      content: summary,
      tier: 1,
      compressedTill: toCompress[toCompress.length - 1].timestamp,
      order,
    })
  },
})

const TOKEN_THRESHOLD = 6000

async function summariseMessages(messages: Message[]): Promise<string> {
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!)
  const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" })

  const transcript = messages.map(m =>
    `User: ${m.userText}\nEco: ${m.ecoText}`
  ).join("\n\n")

  const result = await model.generateContent(
    `Summarise this workout conversation concisely. Preserve: exercises logged, weights/reps, anything the user mentioned about how they felt, any corrections made. Be factual and brief.\n\n${transcript}`
  )

  return result.response.text()
}
```

#### Trigger compression post-turn

In `processTurn` (Phase 5), after the write branch completes, fire compression non-blocking:

```ts
// Non-blocking — do not await
ctx.runAction(api.functions.sessionSummaries.compressIfNeeded, {
  chatId,
  userId: context.profile._id,
}).catch(console.error)
```

#### Update context assembly to use summaries

In `assembleContext` (Phase 5), the `sessionSummaries` fetch is already stubbed. Now wire it in:

```ts
// In buildSystemPrompt, include summaries before raw messages:
if (sessionSummaries.length > 0) {
  prompt += `Earlier in this chat (summarised):\n`
  for (const summary of sessionSummaries) {
    prompt += `${summary.content}\n\n`
  }
}
```

Raw messages still follow after the summaries. The model sees: [old summary] → [recent raw messages] → [current user message].

### 2. Hourly Cron

`convex/crons.ts`

```ts
import { cronJobs } from "convex/server"
import { api } from "./_generated/api"

const crons = cronJobs()

crons.hourly(
  "daily-check",
  { minuteOfHour: 0 },
  api.functions.crons.runDailyCheck
)

export default crons
```

### 3. Daily Check Action

`convex/functions/crons.ts`

This is the nightly batch job. It runs every hour but only does meaningful work for users whose local time is currently midnight (±30 minutes).

```ts
export const runDailyCheck = action({
  args: {},
  handler: async (ctx) => {
    // Get all profiles with their timezones
    const profiles = await ctx.runQuery(api.functions.profiles.getAllTimezones)

    const now = Date.now()

    for (const profile of profiles) {
      try {
        await processDailyCheckForUser(ctx, profile, now)
      } catch (err) {
        console.error(`Daily check failed for user ${profile._id}:`, err)
        // Continue — don't let one failure block others
      }
    }
  },
})

async function processDailyCheckForUser(ctx, profile, now: number) {
  const tz = profile.timezone || "UTC"

  // Get local time for this user
  const localDate = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date(now))

  const localHour = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    hour: "numeric",
    hour12: false,
  }).format(new Date(now))

  // Only run for users at local midnight (hour 0)
  if (parseInt(localHour) !== 0) return

  // Idempotency: skip if dailySummaries already exists for today
  const existing = await ctx.runQuery(api.functions.dailySummaries.getForDate, {
    userId: profile._id,
    date: localDate,
  })
  if (existing) return

  // Get yesterday's chats and messages
  const yesterday = getPreviousDate(localDate)
  const chats = await ctx.runQuery(api.functions.chats.getForDate, {
    userId: profile._id,
    date: yesterday,
  })

  if (chats.length === 0) return // Nothing to summarise

  // Get all messages from yesterday's chats
  const allMessages = []
  for (const chat of chats) {
    const messages = await ctx.runQuery(api.functions.messages.getAllForChat, { chatId: chat._id })
    allMessages.push(...messages)
  }

  if (allMessages.length === 0) return

  // Get yesterday's sessions (for workoutContext)
  const sessions = await ctx.runQuery(api.functions.sessions.getForDate, {
    userId: profile._id,
    date: yesterday,
  })

  // Generate daily summary via Gemini
  const { summaryContent, profileUpdateNotes, shouldUpdateProfile } =
    await generateDailySummary(profile, allMessages, sessions)

  // Write dailySummaries
  const primaryChatId = chats[0]._id
  const dailySummaryId = await ctx.runMutation(api.functions.dailySummaries.write, {
    chatId: primaryChatId,
    userId: profile._id,
    date: yesterday,
    content: summaryContent,
    profileUpdated: shouldUpdateProfile,
    profileUpdateNotes: shouldUpdateProfile ? profileUpdateNotes : undefined,
  })

  // Update workoutContext
  const workoutContextContent = await generateWorkoutContext(profile, summaryContent, sessions)
  await ctx.runMutation(api.functions.workoutContext.write, {
    userId: profile._id,
    content: workoutContextContent,
    triggerReason: "daily-check",
    sourceDailySummaryId: dailySummaryId,
    sourceSessionId: sessions[0]?._id,
  })

  // Update profile if Gemini suggested changes
  if (shouldUpdateProfile && profileUpdateNotes) {
    await applyProfileUpdates(ctx, profile._id, profileUpdateNotes)
  }

  // Purge sessionSummaries for yesterday's chats
  for (const chat of chats) {
    await ctx.runMutation(api.functions.sessionSummaries.purgeForChat, { chatId: chat._id })
  }

  // Invalidate cachedContext for today's chats (workoutContext just changed)
  const todayChats = await ctx.runQuery(api.functions.chats.getForDate, {
    userId: profile._id,
    date: localDate,
  })
  for (const chat of todayChats) {
    await ctx.runMutation(api.functions.chats.invalidateCachedContext, { chatId: chat._id })
  }
}
```

### 4. Gemini Calls for Daily Check

`convex/lib/dailyCheck.ts`

```ts
export async function generateDailySummary(profile, messages, sessions) {
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!)
  const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" })

  const transcript = messages.map(m => `User: ${m.userText}\nEco: ${m.ecoText}`).join("\n\n")

  const result = await model.generateContent(`
You are reviewing a day of workout conversations for ${profile.name}.

Write a brief journal entry (2-4 sentences) capturing:
- What they trained
- How it went (tone, effort, any struggles)
- Anything notable

Then on a new line starting with "PROFILE_UPDATE:" suggest any profile field updates if training patterns or goals seem to have meaningfully changed. If no update needed, write "PROFILE_UPDATE: none".

Conversation:
${transcript}
`)

  const text = result.response.text()
  const [summaryContent, profileLine] = text.split("PROFILE_UPDATE:")
  const profileUpdateNotes = profileLine?.trim()
  const shouldUpdateProfile = profileUpdateNotes && profileUpdateNotes !== "none"

  return {
    summaryContent: summaryContent.trim(),
    profileUpdateNotes: profileUpdateNotes ?? "",
    shouldUpdateProfile: !!shouldUpdateProfile,
  }
}

export async function generateWorkoutContext(profile, dailySummary, sessions) {
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!)
  const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" })

  const result = await model.generateContent(`
Based on this training summary, fill in the workout context fields for ${profile.name}.
Respond ONLY in JSON with these exact keys:
{
  "currentFocus": "string",
  "recentProgress": "string",
  "consistency": "string",
  "notableAchievements": "string",
  "considerations": "string"
}

Summary: ${dailySummary}
`)

  const json = result.response.text().replace(/```json|```/g, "").trim()
  return JSON.parse(json)
}
```

### 5. Supporting Mutations/Queries

Several small functions needed across the above:

`convex/functions/profiles.ts` — add:
```ts
export const getAllTimezones = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("profiles").collect()
    // Returns all profiles — only _id and timezone needed by cron
  },
})
```

`convex/functions/dailySummaries.ts`:
```ts
export const getForDate = query({
  args: { userId: v.id("profiles"), date: v.string() },
  handler: async (ctx, { userId, date }) => {
    return await ctx.db
      .query("dailySummaries")
      .withIndex("by_user_date", q => q.eq("userId", userId).eq("date", date))
      .first()
  },
})

export const write = mutation({
  args: {
    chatId: v.id("chats"),
    userId: v.id("profiles"),
    date: v.string(),
    content: v.string(),
    profileUpdated: v.boolean(),
    profileUpdateNotes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("dailySummaries", { ...args, createdAt: Date.now() })
  },
})
```

`convex/functions/workoutContext.ts`:
```ts
export const getLatest = query({
  args: { userId: v.id("profiles") },
  handler: async (ctx, { userId }) => {
    return await ctx.db
      .query("workoutContext")
      .withIndex("by_user", q => q.eq("userId", userId))
      .order("desc")
      .first()
  },
})

export const write = mutation({
  args: {
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
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("workoutContext", { ...args, createdAt: Date.now() })
  },
})
```

`convex/functions/sessionSummaries.ts` — add:
```ts
export const purgeForChat = mutation({
  args: { chatId: v.id("chats") },
  handler: async (ctx, { chatId }) => {
    const summaries = await ctx.db
      .query("sessionSummaries")
      .withIndex("by_chat_and_tier", q => q.eq("chatId", chatId))
      .collect()
    for (const s of summaries) {
      await ctx.db.delete(s._id)
    }
  },
})
```

`convex/functions/chats.ts` — add:
```ts
export const invalidateCachedContext = mutation({
  args: { chatId: v.id("chats") },
  handler: async (ctx, { chatId }) => {
    await ctx.db.patch(chatId, { cachedContext: undefined, cachedContextAt: undefined })
  },
})
```

---

## Done Checklist

- [ ] Send 30+ messages in one chat → `sessionSummaries` row appears in Convex dashboard
- [ ] Next turn's context includes the summary (verify via Gemini prompt logs)
- [ ] Cron is visible in Convex dashboard under "Scheduled Functions"
- [ ] Manually trigger cron with a test user whose timezone is at midnight → `dailySummaries` row written
- [ ] Second trigger for same user/date → idempotency guard fires, no duplicate row
- [ ] `workoutContext` row written after daily check
- [ ] `sessionSummaries` rows purged after daily check
- [ ] `cachedContext` invalidated on open chats after daily check
- [ ] `npx tsc --noEmit` reports zero errors

---

## What Not to Do in This Phase

- Do not build onboarding (Phase 8)
- Do not build the paywall (Phase 9)
- Do not implement tier-2 compression (v2 — only tier-1 is in scope for v1)
- Do not index `blocks.types` (deferred per schema parking lot)

---

## Next Phase

Phase 8 — Onboarding: first-run experience, profile setup, timezone detection.
