# Eco Track — Master Context

> This file is loaded alongside every phase doc. It gives Codex the full picture of what Eco Track is, how it's built, and what decisions are already locked. Do not deviate from anything marked locked.

---

## What Eco Track Is

A native iOS + Android app (React Native / Expo) where users log workouts by talking to an AI companion called **Eco**. There are no forms, no menus, no navigation. The AI is the entire interface. Users type (or speak) naturally — "did 3 sets of bench at 80kg" — and Eco handles everything: parsing, logging, responding conversationally.

**Core loop:**
1. User sends a message
2. Gemini parses it — extracts structured workout data if present
3. A workout card appears (editable)
4. User confirms or edits → saved to database
5. Eco responds conversationally, noticing something real

**Habit framework:** Hooked (Trigger → Action → Variable Reward → Investment). Every product decision is filtered through this lens.

---

## Stack (locked)

| Layer | Technology |
|---|---|
| Frontend | React Native + Expo |
| Backend / DB | Convex (serverless + reactive) |
| Auth | Convex Auth (Google OAuth) |
| AI | Gemini API |
| Validation | Zod |
| Payments | RevenueCat |
| Language | TypeScript (strict mode) |

---

## Folder Structure (locked)

```
/app                    # Expo Router screens
  /(auth)               # Auth screens
  /(app)                # Main app screens (tab layout)
    /chat               # Chat screen (main screen)
    /history            # Workout history
    /profile            # User profile
/components
  /chat                 # Chat UI components
  /cards                # Workout card components
  /ui                   # Shared UI primitives
/convex
  /schema.ts            # Single source of truth for DB shape
  /auth.config.ts       # Convex Auth config
  /functions            # Mutations, queries, actions
    /messages.ts
    /cards.ts
    /sessions.ts
    /blocks.ts
    /exercises.ts
    /chats.ts
    /profiles.ts
    /crons.ts
    /apiUsage.ts
/lib
  /gemini               # Gemini call + prompt assembly
  /validation           # Zod schemas
  /revenuecat           # RevenueCat integration
/hooks                  # Custom React hooks
/types                  # Shared TypeScript types
```

---

## Schema (locked — Phase 7 final)

Full schema lives in `Final-Schema.md` in the working directory. Key facts Codex must know:

- `userId` is `v.id("profiles")` everywhere **except** `profiles.userId` which is the FK to Convex Auth
- All tables cascade on `profiles` deletion **except** `userReports`
- `chats` has **two** deletion paths with different cascade lists — `sweepOldChats` vs `forceDeleteChat` — never collapse them
- `cards.state` is only `"pending" | "confirmed"` — no editing state
- `cards.sessionId` is optional — unset on low-confidence cards until user confirms
- `apiUsage` tracks `tokensUsed` per turn — used by paywall to gate free users

### Tables at a glance

`profiles` · `chats` · `messages` · `cards` · `sessions` · `blocks` · `exercises` · `dailySummaries` · `workoutContext` · `sessionSummaries` · `apiUsage` · `messageFeedback` · `userReports`

---

## Turn Lifecycle (locked)

Full spec lives in `Turn-Lifecycle-Specification.md` in the working directory. Key facts:

1. **Context assembly** — fetch `profiles`, `workoutContext`, `chats.cachedContext`, recent `messages`, `sessionSummaries` before every Gemini call
2. **Gemini call** — one request, `tools: [log_workout]`, `responseSchema` set
3. **Response branches** — `functionCall` present → logging turn; text only → conversational turn
4. **Zod validation** — runs after every tool call; failure = low confidence (not an error state)
5. **High confidence write** — creates `sessions` + `blocks` + `exercises` + confirmed `cards`
6. **Low confidence write** — creates only `cards` (pending); full write happens on user confirm
7. **Cards behavior** — Ask Eco sets `inDiscussion: true`; correction on confirmed card requires explicit re-confirm before `exercises` are rewritten
8. **Memory** — hourly cron buckets users by timezone, runs daily-check at local midnight: writes `dailySummaries`, updates `workoutContext`, purges `sessionSummaries`
9. **Compression** — token-size threshold on raw `messages` triggers `sessionSummaries` write, non-blocking, post-turn

---

## V1 Scope (locked)

**In:**
- Google OAuth
- Onboarding
- Chat with Eco (full natural language parsing — supersets, dropsets, complex sets)
- Workout cards (pending → confirmed flow, Ask Eco, manual edits)
- Memory system (cron, daily summaries, workout context)
- RevenueCat paywall (free trial = token limit via `apiUsage`; pro = full access)

**Out (v2+):**
- Workout planning
- Progress tracking / analytics
- Shareable images
- Tribe / social features
- Premium AI model tier
- Voice input
- Multi-card free-text Ask Eco

---

## Coding Standards (locked)

- TypeScript strict mode — no `any`, explicit return types
- Functional components only, no class components
- Custom hooks for all shared logic
- Convex mutations for writes, queries for reads, actions for external calls (Gemini, RevenueCat)
- Always filter by `userId` — never return cross-user data
- Handle errors by returning error objects, never throw from Convex functions
- Mobile-first — minimum tap target 44×44px
- No inline styles — use StyleSheet or NativeWind

---

## Deferred — Do Not Implement in V1

- Gemini-side prompt caching
- Multi-card free-text Ask Eco
- Message editing beyond most recent
- Git-style chat history
- `aiFeedback` table (dropped entirely)
- `blocks.types` indexing
- Vector/semantic search
- `retainChatHistory` toggle

---

*This file is the single source of app-wide context. If anything here conflicts with a phase doc, the phase doc wins for its own scope — but flag the conflict rather than silently resolving it.*
