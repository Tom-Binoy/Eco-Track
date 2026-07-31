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
| AI | Gemini API via `@google/genai` |
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

Full schema lives in `Final-Schema.txt` in the working directory. Key facts Codex must know:

- `userId` is `v.id("profiles")` everywhere **except** `profiles.userId` which is the FK to Convex Auth
- All tables cascade on `profiles` deletion **except** `userReports`
- `chats` has **two** deletion paths with different cascade lists — `sweepOldChats` vs `forceDeleteChat` — never collapse them
- `cards.state` is only `"pending" | "confirmed"` — no editing state
- `cards.sessionId` is optional — unset on low-confidence cards until user confirms
- `apiUsage` tracks `tokensUsed` per turn — used by paywall to gate free users
- `guideInvocations` is a backend-only, write-once safety/tuning review log
  for executed `get_new_exercise_guidance` calls only.
  It is never sent to Gemini,
  never answers whether naming guidance is active, and cascades through its
  parent message under both chat-deletion paths.
- Main-turn Gemini context includes persisted `messageBlocks` (text and
  system-generated `tool_summary` notes) for the raw messages in the turn
  context. Raw requests/results, including invalid or failed results, live only
  in internal `toolTraces` for authorized debugging and never reach Gemini,
  compression, or normal chat clients.

### Tables at a glance

`profiles` · `chats` · `messages` · `cards` · `sessions` · `blocks` · `exercises` · `exerciseLibrary` · `exerciseLibraryEmbeddings` · `userExerciseAliases` · `userExerciseAliasEmbeddings` · `messageBlocks` · `toolTraces` · `dailySummaries` · `workoutContext` · `sessionSummaries` · `apiUsage` · `guideInvocations` · `messageFeedback` · `userReports`

---

## Turn Lifecycle (locked)

Full spec lives in `Turn-Lifecycle-Specification.txt` in the working directory. Key facts:

1. **Context assembly** — fetch `profiles`, `workoutContext`, `chats.cachedContext`, recent `messages`, `sessionSummaries` before every Gemini call
2. **Gemini call** — Call 1 always exposes `log_workout`, `Get_data`,
   `Correct_log`, `search_exercise_library`, and `calculate`. `calculate` is
   pure PT-scope math: it reads no profile preferences and makes no writes;
   Eco must use it, rather than free-text reasoning, for user-checkable numeric
   results and must reserve `expression` for pure arithmetic outside a named
   operation. Before logging an exercise not confidently resolved through a
   known alias, Eco proactively performs the read-only exercise-library search;
   this does not require mid-turn consent.
   While the existing trailing
   `messages.usedTools` guide-marker streak is active, it also exposes
   `get_new_exercise_guidance` and `create_custom_exercise`; a Gemini response
   may request multiple tools. Independent read-only requests run together,
   while writes and work that relies on an earlier result remain ordered. All
   executed results return together to the next model request. The
   five-follow-up cap counts those follow-up model requests, not individual
   tools in a batch. Every executed result persists and returns
   `_ecoTurnControl` with the fresh-turn limit and remaining-request countdown;
   Gemini must finish naturally when it reaches zero and never mention that
   internal limit to the user. A request beyond the limit is retained as a
   rejected trace and ends with a conversational fallback, not Retry. Guidance receives the
   unresolved `rawPhrase`, optional concrete `conversationDetail` gathered by
   Eco, and up to five exact `search_exercise_library` candidates (each with
   its description). Its full behavioral guide is injected only in that
   function-result/resolver exchange, never prepended to the active-guide
   window or retained as a permanent main system-prompt block. It returns exactly
   `resolved_existing` (with an `exerciseId`), `resolved_custom`,
   `still_ambiguous`, or `declined_unsafe`. It never creates an exercise or
   alias; Eco guides near-miss candidates conversationally. A resolved existing
   result goes directly into the next `log_workout`; a resolved custom result
   requires `create_custom_exercise` and its returned ID first, while
   still-ambiguous stays conversational. `declined_unsafe` is a pure
   conversational close: no card, library write, or alias, while the executed
   guidance call still receives its usual `guideInvocations` review row.
3. **Response branches** — a response may contain a batch of function requests
   or text only. `log_workout` and `Correct_log` are ordinary tool steps:
   validate, persist truthfully when valid, return their result to Gemini, and
   let Gemini produce the one final natural reply.
   Main-turn function-call and function-response IDs are preserved and matched
   through the typed `@google/genai` SDK. The same SDK `Chat` instance carries
   Gemini 3 thought signatures through a tool loop; never manually add a
   `thoughtSignature` to a function response. One general `Get_data` lookup
   (profile fields, a daily summary, or date range) may run per turn, with only
   the documented `Exercise N` detail lookup allowed after a historical range.
   A repeated general lookup is traced and stopped locally, then Eco receives
   the existing conversational fallback instead of a failed turn.
4. **Zod validation** — runs after every tool call; `log_workout` requires a
   non-empty resolved `exerciseId` on every extracted exercise in addition to
   its type, range, and enum checks. A failure returns a specific result to
   Gemini for recovery and no card is created.
5. **High confidence write** — creates `sessions` + `blocks` + `exercises` + confirmed `cards`
6. **Low confidence write** — creates only `cards` (pending); full write happens on user confirm
7. **Cards behavior** — Ask Eco sets `inDiscussion: true`; the active discussion is visibly signalled above the chat input and only its explicit **Back to deck** action flips it false; correction on confirmed card requires explicit re-confirm before `exercises` are rewritten
8. **Memory** — the hourly `daily-cleanup` cron buckets users by timezone and runs at local midnight. One Gemini call writes a `dailySummaries` row plus optional typed profile and `workoutContext` updates, then purges that day's `sessionSummaries`; no-chat days write nothing. Its context always includes at least the two most recent available daily summaries, or all summaries since the last workout-context update when that is larger. Cleanup receives the full profile, latest context, that window, chronological tier-1/tier-2 summaries, and the uncompressed raw tail.
9. **Compression** — token-size threshold on raw messages plus their persisted
   text and `tool_summary` `messageBlocks` triggers a non-blocking, post-turn
   `sessionSummaries` write. Tier 1 receives each message’s ordered text/note history;
   Tier 2 receives the resulting Tier 1 summaries. Both tiers preserve material
   tool outcomes, including failed or invalid results that require recovery, but
   never receive `apiUsage`. Compression is scheduled once every Gemini turn
   has completed, never between tool calls. When six Tier 1 rows exist, Tier 2
   compacts exactly the five oldest and retains the sixth/newer Tier 1 tail;
   existing Tier 2 rows remain chronological inputs, not Tier-2-to-Tier-2
   roll-up sources. `Tier1Compression_Prompt` and
   `Tier2Compression_Prompt` must preserve achievements, injuries, mood/tone,
   corrections, and meaningful emotional or life-context disclosures, including
   work stress and mental health-adjacent topics. `Daily-Cleanup_Prompt` is the
   daily memory instruction export.
10. **Exercise library** — global wger exercises are seeded through the internal `functions/seedWger:seed` action. The public wger API needs no key; English is language ID `2`, and reruns upsert by `wgerId`. Existing library rows are embedded by the manually invoked public `functions/embedExerciseLibrary:backfill` action (never a cron or app call): it paginates 10 rows at a time, skips rows already present in `exerciseLibraryEmbeddings` by `by_exercise`, embeds each row's `searchBlob`, and copies the source `userId`, `equipment`, and `muscleGroup`. It uses a 700ms baseline delay and retries 429s up to five times with `Retry-After` when supplied or exponential backoff otherwise; exhausted rows are logged and reported without aborting the run. The read-only resolver is `functions/exerciseLibrary:searchForTurn`: it normalizes through the shared `lib/exerciseNormalization:normalizeExerciseInput` helper used by confirmed-alias writes, then performs the exact-alias → user-alias vector → personal/global library vector waterfall. It creates one `RETRIEVAL_QUERY` embedding with `gemini-embedding-001` at 768 dimensions and searches five hits per vector source; personal wins exact library-score ties. A 0.82 cosine similarity is the provisional auto-resolution threshold. Below threshold, it returns at most five ranked near-miss candidates; it never persists an alias or library row. The guide resolver may return optional `aliasText` with `resolved_existing` only for a genuine alternate name; the following confirmed write creates or updates `userExerciseAliases` only when that value is non-empty. The name-plus-aliases `searchBlob` is document-embedded; full-text `search_name` is intentionally absent. `create_custom_exercise` is the deliberate exception to confirmation-only creation: it creates and immediately embeds a personal custom row with a required description; it never creates a global row or a user alias. Exercise display defaults to `exerciseLibrary.canonicalName`; card-query results carry both that canonical name and a displayed name, using the raw wording only when it matches that user's confirmed alias. Workout cards render `displayedName` as the primary label and, only when it differs from `canonicalName`, render the canonical name beneath it as a clearly legible secondary label. `exercises.name` remains the unchanged raw extracted string.

---

> **Exercise-embedding update (2026-07-26):** `exerciseLibrary.searchBlob`
> is the normalized concatenation of `canonicalName`, aliases, and
> `description` when present. It is the document-embedding input for
> `exerciseLibraryEmbeddings`; therefore, changing any of those source fields
> requires re-embedding every affected library row. This supersedes the
> earlier name-plus-aliases-only embedding note above. `userExerciseAliasEmbeddings`
> remain unchanged because aliases have no description field.

`create_custom_exercise` is prompt-enforced to run only after Eco has established
the user consents to retaining a genuinely custom movement and ruled out a real
exercise under another name; this precondition is intentionally not backend
validation. No schema field is needed for safety triage: injury-specific risk
uses the existing lean `profiles.injuries` context, and universal risk is model
judgment.

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
- Vector/semantic search over messages or daily summaries (exercise-library
  resolution is implemented in V1)
- `retainChatHistory` toggle

---

## Development-only Gemini diagnostics (2026-07-31)

When `ECO_DEBUG_CONSOLE_ENABLED=true`, the development Debug Console records
ordered turn traces and exact Call 0 replay snapshots. Approved debug admins can
run a fixed 30-request, Call-0-only replay suite: five samples each of the
baseline, no-`Get_data`, no-daily-summary, explicit greeting rule, hardened
`Get_data` description, and unambiguous-greeting variants. Replays never
execute tools or write product messages, workouts, cards, aliases, or user
`apiUsage`; their results and token use are isolated in debug-only tables. An
optional model critique is diagnostic commentary, not access to hidden model
reasoning. Older traces may be reconstructed from their sanitized Call 0 event
and must be labelled as reconstructed.
Approved debug admins can type-confirm deletion of a message or force deletion
of a chat. These development-only actions delete the associated diagnostics and
chat/card data but retain confirmed workout sessions, blocks, and exercises.

---

*This file is the single source of app-wide context. If anything here conflicts with a phase doc, the phase doc wins for its own scope — but flag the conflict rather than silently resolving it.*
