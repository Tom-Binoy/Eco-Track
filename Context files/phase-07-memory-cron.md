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

> **Runtime model update (2026-07-30):** All daily-cleanup and
> memory-compression generations in `convex/lib/dailyCheck.ts` now use
> `gemini-3.1-flash-lite` through the shared model helper. This changes only
> the provider model; the locked cleanup, compression, and write lifecycle is
> unchanged.

---

## What to Build

### 1. Session Summaries (Within-Chat Compression)

`convex/functions/sessionSummaries.ts`

Compression fires **post-turn, non-blocking** when the compressible raw
messages for a chat, including their persisted `messageBlocks`, exceed a
token-size estimate threshold. Tier 1 receives each message’s ordered text,
tool-call, and tool-result trace, including failed or invalid tool results.
It summarises older messages into a `sessionSummaries` row and stops injecting
those raw messages into the context. `apiUsage` is never included.

#### Token estimation

A simple character-count proxy: assume ~4 characters per token. The current
implementation triggers at 10,000 characters of **compressible** message text
plus ordered block content, while keeping the newest five messages raw.

```ts
export function estimateTokens(messages: Message[]): number {
  const totalChars = messages.reduce((acc, msg) => {
    return acc
      + (msg.userText?.length ?? 0)
      + (msg.ecoText?.length ?? 0)
      + msg.messageBlocks.reduce((blockTotal, block) =>
        blockTotal + block.content.length + (block.toolName?.length ?? 0), 0)
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

    // Fetch each candidate message’s ordered messageBlocks, then call Gemini
    // to summarise. Tool calls/results, including failed or invalid results,
    // are part of the Tier 1 source; apiUsage is excluded.
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
  const model = genAI.getGenerativeModel({ model: "gemini-3.1-flash-lite" })

  const transcript = messages.map(m =>
    `User: ${m.userText}\nEco: ${m.ecoText}`
  ).join("\n\n")

  const result = await model.generateContent(
    `Summarise this workout conversation concisely. Preserve: exercises logged, weights/reps, anything the user mentioned about how they felt, any corrections made. Be factual and brief.\n\n${transcript}`
  )

  return result.response.text()
}
```

#### Trigger compression after a completed Gemini turn

Schedule compression non-blocking from the message-completion path. Every
completed Gemini message is eligible; the active `Get_data` loop does not mark
the message complete, so compression never runs between tool calls:

```ts
await ctx.scheduler.runAfter(0, internal.functions.sessionSummaries.compressIfNeeded, {
  chatId: chat._id,
  userId: chat.userId,
})
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

#### Tier 2 roll-up

After a Tier 1 write, once at least six Tier 1 rows exist, Tier 2 compresses
exactly the five oldest Tier 1 rows into one denser Tier 2 row and removes those
source rows atomically. The sixth and any newer Tier 1 rows remain raw summary
tail. It does not reread raw messages or `messageBlocks`; it
receives the Tier 1 summaries, which must retain material tool outcomes and
unresolved failures. `apiUsage` remains excluded.

### 2. Hourly Cron

`convex/crons.ts`

```ts
import { cronJobs } from "convex/server"
import { api } from "./_generated/api"

const crons = cronJobs()

crons.hourly(
  "daily-cleanup",
  { minuteOfHour: 0 },
  api.functions.crons.runDailyCheck
)

export default crons
```

### 3. Daily Cleanup Action

`convex/functions/crons.ts`

The hourly action only performs cleanup for a user at local midnight. It skips
only when no `chats` row exists for `(userId, today's local date)`, so inactive
days do not create `dailySummaries`. An existing `dailySummaries` row for that
date is retry-safety only, not the real app gate.

For an eligible chat, it fetches:

1. the complete profile and the latest `workoutContext` row;
2. the larger of every `dailySummaries` row after that context row's
   `sourceDailySummaryId` and the three most recent available daily summaries
   (or every existing daily summary if no context row exists); and
3. all remaining `sessionSummaries` plus only raw messages with a timestamp
   after the greatest `compressedTill` value.

The summary rows are chronological by `compressedTill` (with tier/order as
tie-breakers); the raw tail is chronological by message timestamp. Tier 2 and
remaining tier 1 summaries are both included. This means the model sees every
piece of the current day's conversation exactly once: compressed history,
then its uncompressed tail.

### 4. One Gemini Daily-Cleanup Call

`convex/lib/dailyCheck.ts`

Daily cleanup makes exactly one Gemini call. Its system instruction is the
`daily-cleanup` prompt; the request content is injected in this fixed order:

1. full profile data;
2. latest workout context, or `null`;
3. the daily-summary window: all summaries accumulated since that workout
   context was written, with the three most recent available summaries always
   retained as a minimum;
4. remaining tier 1 and tier 2 session summaries, in chronological order;
5. the uncompressed raw-message tail, in chronological order.

The response is schema-validated JSON:

```ts
{
  dailySummary: string,
  profileUpdate: {
    goals?: string,
    equipment?: string,
    trainingPattern?: string,
    trainingAvailability?: { daysPerWeek: number, sessionLength: number },
    skillLevel?: {
      strength: string, flexibility: string, endurance: string,
      calisthenicsSkills: string, sportSpecific: string, bodyComposition: string,
    },
    injuries?: Array<{ description: string, status: string, notedAt: number }>,
  } | null,
  profileUpdateNote: string | null,
  workoutContext: {
    currentFocus: string,
    recentProgress: string,
    consistency: string,
    notableAchievements: string,
    considerations: string,
  } | null,
}
```

The model returns `profileUpdate: null` unless the user explicitly supplied a
durable training-profile change. It may change only the listed training fields;
identity, units, timezone, tone, and display preferences are never model
updated. It returns `workoutContext: null` unless the combined evidence
materially changes the ongoing context. A null response deliberately leaves
the existing context row untouched, so the next run receives this day's daily
summary as part of the accumulated history.

### 5. Persistence and Supporting Functions

`dailySummaries.getSinceWorkoutContext` reads chronological daily summaries
after a supplied `sourceDailySummaryId`, but always returns at least the three
most recent available rows. If no source is supplied—or that source was
force-deleted with its chat—it returns every retained summary for the profile.

`dailySummaries.commitDailyCleanup` is one internal mutation. Subject to its
idempotency check, it writes the daily summary, patches the optional typed
profile update, and appends the optional workout-context row in the same
transaction. When a context row is written, its `sourceDailySummaryId` is the
new daily-summary ID. The action logs the single call's token usage once.

Only after that commit succeeds does the cron purge the processed chat's
`sessionSummaries` and invalidate today's cached chat context. This preserves
the raw/session source material if generation or persistence fails.

---

## Done Checklist

- [ ] Send 30+ messages in one chat → `sessionSummaries` row appears in Convex dashboard
- [ ] Next turn's context includes the summary (verify via Gemini prompt logs)
- [ ] Cron is visible in Convex dashboard under "Scheduled Functions"
- [ ] Manually trigger cron with a test user whose timezone is at midnight → `dailySummaries` row written
- [ ] Second trigger for same user/date → idempotency guard fires, no duplicate row
- [ ] `workoutContext` row is written only when the daily-cleanup response includes one
- [ ] `sessionSummaries` rows purged after daily check
- [ ] `cachedContext` invalidated on open chats after daily check
- [ ] `npx tsc --noEmit` reports zero errors

---

## What Not to Do in This Phase

- Do not build onboarding (Phase 8)
- Do not build the paywall (Phase 9)
- Do not add a tier beyond the existing tier-1 / tier-2 compression model
- Do not index `blocks.types` (deferred per schema parking lot)

---

## Next Phase

Phase 8 — Onboarding: first-run experience, profile setup, timezone detection.
