
# Eco Track — Architecture Decision Document (Final)

**Status:** Locked, pre-implementation
**Audience:** Codex (code generation) + solo dev
**Tech stack:** React Native (Expo) + Convex (DB/functions/auth) + Convex Auth (Google OAuth) + Gemini API + TypeScript strict
**Schema authority:** `Final-Schema.txt` — includes the lean
`chats.cachedContext`, `messages.usedTools`, `messageBlocks`, `guideInvocations`,
`exerciseLibrary`, its separate embedding tables, `userExerciseAliases`,
`exercises.exerciseId`, and
`cards.correctsBlockId` in addition to the established chat and memory fields.
**Behavioral authority:** Turn Lifecycle Specification (Phase 1, consolidated) + Onboarding Progress Summary (Phase 2 handoff) — this document does not restate their field-level detail, it wires them into the app.

---

## 1. Folder / File Structure

```
eco-track/
├── app/                                # Expo Router — file-based routing
│   ├── _layout.tsx                     # ConvexProvider + ConvexAuthProvider wrap here
│   ├── index.tsx                       # Auth check -> /onboarding or /(authenticated)/chat
│   ├── onboarding/
│   │   ├── _layout.tsx
│   │   └── index.tsx                   # Google OAuth entry, then hands off to the task-queue chat UI
│   └── (authenticated)/
│       ├── _layout.tsx                 # Auth guard
│       └── chat/
│           └── index.tsx               # The one screen — resolves/creates today's single chat
│
├── components/
│   ├── chat/
│   │   ├── MessageBubble.tsx           # messages.userText / messages.ecoText
│   │   ├── ChatInput.tsx               # No forms, no menus — text in, tap to send
│   │   └── TypingIndicator.tsx
│   ├── cards/
│   │   ├── CardStackModal.tsx          # Stacked popup, blur background, animated — the review surface
│   │   ├── Card.tsx                    # Single card, renders by cards.state (pending/confirmed/editing)
│   │   └── CardDiffView.tsx            # Shown on re-confirm after a correction to an already-confirmed card
│   ├── onboarding/
│   │   └── TaskCard.tsx                # Renders the atomic "settings" confirm card (Option B, non-persisted)
│   └── ui/
│
├── convex/
│   ├── schema.ts                       # LOCKED — Phase 7, verbatim, plus onboardingProgress table
│   ├── auth.ts
│   ├── auth.config.ts
│   │
│   ├── profiles.ts                     # createFromOnboarding (atomic insert at queue-empty), getByAuthUser
│   ├── chats.ts                        # getOrCreateTodayChat split into query+mutation, sweepOldChats, forceDeleteChat
│   ├── messages.ts                     # send (mutation) — schedules the turn action
│   ├── cards.ts                        # confirm, editAndReconfirm, askEco (sets inDiscussion), discard
│   ├── sessions.ts / blocks.ts / exercises.ts   # internal only, no client-facing mutations
│   ├── dailySummaries.ts
│   ├── workoutContext.ts
│   ├── sessionSummaries.ts             # compression writes + purge-on-dailySummary-write
│   ├── apiUsage.ts                     # internal mutation, called from every Gemini-calling action
│   ├── guideInvocations.ts             # internal, write-once post-guidance review log
│   ├── messageFeedback.ts
│   ├── userReports.ts
│   ├── onboardingProgress.ts           # get/set (pointer, completedResults), delete on queue-empty
│   │
│   ├── actions/
│   │   ├── runTurn.ts                  # THE core action — context assembly -> Gemini -> validate -> write branch
│   │   └── runOnboardingTask.ts        # Per-task Gemini call (task-scoped tool schema, thin carry-forward context)
│   │
│   ├── crons.ts                        # hourly: daily-check bucketed by profiles.timezone
│   └── lib/
│       ├── gemini.ts                   # Gemini client + prompt templates (one per onboarding task + main turn)
│       ├── validation.ts               # Zod schemas mirroring log_workout's responseSchema
│       └── blockTypes.ts               # BLOCK_TYPES union, single source of truth for TS side
│
├── hooks/
│   ├── useTodayChat.ts
│   ├── useCardStack.ts                 # Derives ordered "Card N" labels from stack position — no stored labels
│   └── useOnboardingProgress.ts
│
├── tsconfig.json                       # strict: true, noUncheckedIndexedAccess: true
└── package.json
```

**Rule for Codex:** `sessions`, `blocks`, and `exercises` have no
client-facing mutations. A resolved workout remains a pending card until the
user confirms it; only that confirm path writes the permanent workout rows.
`exercises.exerciseId` is required, so unresolved names can never be logged.
Post-call Zod validation also requires a non-empty resolved `exerciseId` on
every extracted exercise before either card-write path can run; confirmation
never creates a fallback exercise-library row.

---

## 2. Data Flow

Server-side flow is fully specified by the Turn Lifecycle Spec and is not re-derived here — it is:

```
messages.send() [mutation]
   → writes messages row
   → schedules actions/runTurn.ts (async, non-blocking)

actions/runTurn.ts [action]
   1. Context assembly (Turn Lifecycle §1):
      - fresh lean cached context, otherwise workoutContext plus the small
        tone/unit/active-injury bundle
      - recent messages (always fresh)
      - ordered messageBlocks for those raw messages; every persisted text,
        tool-call, and tool-result trace is included, even after an invalid or
        failed tool result. apiUsage is never part of prompt context.
      - sessionSummaries if raw messages exceed token threshold
      - cards where inDiscussion=true — pinned and injected,
        labeled "Card 1" / "Card 2" by stack position (ephemeral, request-scoped only)
   2. Call 1 — tools: [log_workout, Get_data, Correct_log,
      search_exercise_library, calculate], plus `get_new_exercise_guidance` and
      `create_custom_exercise` only while the trailing guide-marker streak is
      active; responseSchema: { reply }. Tool calls are sequential and share
      the five-follow-up cap.
      `Get_data` selects its read by optional arguments rather than a collection
      type: `collectionPoints` for profile fields, `dailySummaryDate`
      (`YYYY-MM-DD`) for one daily summary, and `dateRange` / `exerciseId` for
      historical exercises. It returns no database IDs.
   3. Resolve each concrete exercise identity through exact user aliases, then
      user-alias vectors, then separate global and personal library vectors.
      `gemini-embedding-001` uses 768 dimensions; 0.82 is the provisional
      auto-resolution threshold. Below-threshold results remain conversational;
      no-match resolution may call naming guidance without a consent flag.
   4. Write each fully resolved block atomically. One message may therefore
      create multiple cards while an unresolved sibling remains conversational.
      Confirm is the normal path that persists custom exercise-library entries
      and confirmed aliases. The guide-active `create_custom_exercise` tool is
      the deliberate exception: it writes and embeds a personal,
      description-required library row before `log_workout`, but never writes a
      confirmed alias. Historical corrections carry
      `correctsBlockId` and are also re-confirmed.
   5. The Eco message row is created at processing start; its final text and
      ordered messageBlocks are updated reactively as the turn proceeds.
```

**Client-side half (the piece explicitly left open until this session):**

| Data | Client mechanism |
|---|---|
| Messages, cards, everything schema-backed | `useQuery` — reactive, updates automatically when `runTurn` writes finish, no polling/refetch |
| Card stack ordering / which card is expanded / animation state | Local component state in `CardStackModal.tsx` — derived from `useQuery(cards.listPending)` order, not separately persisted |
| `"Card N"` labels shown to the user | Computed client-side from array index of the pending-cards query result — **not** the same mechanism as the server's ephemeral Gemini-facing labels, but intentionally the same numbering convention so what the user sees matches what "Ask Eco" resolves server-side |
| In-flight chat input | `useState`, local only, cleared on send |
| Onboarding queue position | `useQuery(onboardingProgress.get)` — reactive, so resuming onboarding after app kill just re-renders the current task, no local reconciliation logic needed |

No Redux/Zustand. Convex is the only state manager for anything schema-backed; local state is reserved for pure UI ephemera (animation, expansion, in-flight text).

---

## 3. Auth Flow (cold open → authenticated chat)

```
1. Cold open → app/index.tsx checks useConvexAuth()
   false → /onboarding      true → /(authenticated)/chat

2. /onboarding/index.tsx → Google OAuth via Convex Auth (signIn("google"))

3. On success: NO profiles row is created yet.
   Device timezone (Intl.DateTimeFormat().resolvedOptions().timeZone) is captured
   client-side, held for onboarding task 2 ("settings"), not written yet.

4. Onboarding runs as its own turn logic, OUTSIDE the normal runTurn context-assembly
   path (Onboarding Handoff §5) — it does not need a profiles row to exist first.

   Task queue (locked, 7 tasks, linear, no branching):
     1. identity        (atomic, text-only)        -> name
     2. settings         (atomic, card - Option B)   -> weightUnit, distanceUnit, timezone, darkMode
     3. goals            (extractive)                -> goals
     4. equipment        (extractive)                -> equipment
     5. injuries         (extractive, safety-flagged) -> injuries ([] if declined)
     6. background_general (compound, soft)          -> trainingPattern + 4 skillLevel dims
     7. background_explicit (compound, hard)         -> skillLevel.sportSpecific, bodyComposition

   Each task 3-7 fires its own tool call (save_goals, save_equipment, etc.) and its
   own inline confirm chip AT THE MOMENT captured — no end-of-flow recap screen.
   Task results stack in ephemeral-but-persisted queue state (see below), profiles
   row is written ONCE, atomically, when the queue empties.

5. Resume/persistence (resolved this session — Option A):
   convex/onboardingProgress: { userId, pointer, completedResults }
   - written/patched after each task completes
   - read on app relaunch mid-onboarding to restore (pointer, completedResults)
   - deleted the moment the queue empties and profiles.createFromOnboarding fires
   This is a genuine Convex table, not device-local storage — chosen so onboarding
   survives an app kill or device switch mid-flow.

6. profiles.createFromOnboarding [mutation]:
   - single atomic insert, all 7 tasks' results + device timezone folded in
   - trainingAvailability is NOT collected here — seeded with a placeholder,
     out of v1 scope entirely (kept in schema for future analytics/planner
     features per solo-dev's own Phase 7 addition — dead field for v1, not a bug)

7. Redirect to /(authenticated)/chat → chat/index.tsx resolves today's single chat
   (query for existing chats row by (userId, today's date); if none, mutation creates it)

8. Login side-effect, every successful auth resolution (not just first-login):
   check retention-sweep eligibility (7+ days since last check) → fire chats.sweepOldChats
   if due. This remains login-triggered, not cron-triggered, per original schema intent.
```

---

## 4. AI Parsing in the Convex Action Layer

This section is the Turn Lifecycle Spec, wired into files rather than re-derived:

- **`functions/messages.processTurn`** implements the main turn: lean context
  assembly, Call 1 with five always-available tools and the two guide-active
  tools (including sequential exercise search, naming guidance, and custom
  creation), block-level identity resolution before card creation,
  reactive trace writes to `messageBlocks`,
  and reinjection of those ordered blocks on later main turns. Gemini runs only
  in this Convex action layer. `apiUsage` and `guideInvocations` remain excluded
  from model context. Each executed `get_new_exercise_guidance` call writes one
  backend-only `guideInvocations` record after execution; it is a safety/tuning
  review log, not the
  naming-guide active-state source.
- **`lib/calculate.ts`** implements the always-available, pure PT-math tool.
  It has no Convex DB access, never reads profile unit preferences, and uses a
  closed allowlisted arithmetic parser rather than `eval()` or `Function()`.
- **`actions/runOnboardingTask.ts`** is the same shape at a smaller scale: one task-scoped tool call (`save_goals`, `save_injuries`, etc.) per turn, with only that task's prompt fragment plus a thin "already have: X, Y" carry-forward — never the full onboarding script, never prior tasks' full transcripts (Onboarding Handoff §1).
- **Cards behavior** (§5 of Turn Lifecycle) is implemented in `convex/cards.ts`:
  - Direct manual edit on a pending card → local, instant, same confirm path as normal.
  - "Ask Eco" on either pending or confirmed → sets `inDiscussion: true`, card pins open in the stack modal regardless of state.
  - Correction on a `confirmed` card → patches `cards` only; does **not** silently rewrite `exercises` — shows a diff (`CardDiffView.tsx`), only writes through to `exercises` on explicit re-confirm.
- **`cards.inDiscussion`** is the sole prompt-injection source. The explicit
  “bring card back to deck” mutation is the only writer that flips it false
  and writes `messages.cardContext.closed: true`; that context field is for
  the one-time UI closure chip only. The client presents this action in the
  visually distinct banner directly above the chat input, not in the card
  sheet; the reactive card query removes the banner after a successful close.
- **Compression and reflection triggers** (§7): `sessionSummaries` compression
  is size/token-threshold-based (not count or time), is scheduled non-blocking
  only after a Gemini-completed message (never mid-tool loop), and gives Tier 1
  the ordered `messageBlocks` for its source messages. Tier 2 waits for six
  Tier 1 rows and compacts exactly the five oldest;
  both tiers retain material tool outcomes but exclude `apiUsage`. Daily cleanup
  runs from one hourly cron, bucketed by `profiles.timezone`; it uses one Gemini
  request to generate the daily summary and optional profile/workout-context
  updates from accumulated daily, compressed, and raw chat memory. No separate
  session-close trigger exists. The daily summary plus optional updates commit
  together before purge/cache invalidation.

**Every Gemini call — main turn or onboarding task — logs to `apiUsage` without exception.** Given the £20/month Gemini budget, this is the only cost-visibility mechanism in v1 and must not be skippable by any code path. These token/cost records are backend-only and are never included in Gemini prompts.

---

## 5. State Management

Covered inline in Section 2's table above. Summary principle: **Convex is the state manager for everything the schema represents; local React state is reserved for UI-only ephemera** (card stack animation/expansion, in-flight input, computed "Card N" display labels). No global client-side store. `onboardingProgress` is the one exception worth naming explicitly — it looks like it could be local/ephemeral, but is deliberately a real Convex table so onboarding survives app kills and device switches.

---

## 6. Gotchas and Constraints for the Solo Dev

1. **Two separate `chats` deletion mutations (`sweepOldChats`, `forceDeleteChat`), never one parameterized `deleteChat(hard: boolean)`.** Different cascade lists (sweep skips `dailySummaries`, force-delete includes it) — collapsing these is the single most likely accidental regression in a future refactor.

2. **`cards.by_session` and `cards.by_message` indexes are TEMPORARY**, flagged safe-to-drop post-growth-phase **three times now** across design sessions. Don't build new features against them; schedule an actual removal date instead of leaving this as a perpetual "temporary."

3. **Budget and time reality check, keep visible during implementation:** £20/month Gemini budget, 5–7 hrs/week solo-dev time, sub-2-second response target on mobile. Normal turns use one Gemini call; the exercise naming resolver is the deliberate exception, capped at five tool calls. Do not add further model calls without re-checking cost and latency.

4. **`dailySummaries` intentionally outlives its `chatId`** post-sweep — any UI/query joining back to `chats` must handle a dangling parent gracefully.

5. **`userReports` is the sole exception to profile-deletion cascade** — repeat-reporter tracking survives account deletion by design, don't include it in a future account-deletion flow.

6. **Denormalized `userId` on `blocks`/`exercises` has no repair path** — write-once by design, no mutation reassigns `sessionId`/`blockId`. A future "move block to different session" feature needs new mutations plus a userId-propagation step; don't assume one exists.

7. **`profiles.timezone` is schema-required and populated via device auto-detect at onboarding task 2** — never asked conversationally, never left blank. Needed by both per-turn context assembly and the hourly daily-check cron's bucketing logic.

8. **`profiles.trainingAvailability` is a known dead field for v1** — schema-required, seeded with a placeholder at onboarding, never read by any turn logic, kept deliberately for a future analytics/planner feature that is explicitly out of v1 scope. Not an oversight — don't "fix" it by wiring it into onboarding.

9. **Unit storage semantics:** `weightUnit`/`distanceUnit` are *storage* preferences, not just display formatting. `log_workout` parsing must normalize spoken units to the stored preference, with a one-time-per-mismatch light confirm (not a confirm on every single logged set) when a user's spoken unit diverges from their profile setting.

10. **Injuries re-asking is a standing, cross-cutting behavior** (periodic re-ask over time), not a one-time onboarding task — must live in the main Turn Lifecycle logic, not just onboarding task 5.

11. **`chats.cachedContext` mid-day staleness is resolved by construction, not by extra logic** — because it's one chat per user per day, there is no "second same-day chat" that could inherit a stale cache. No code needs to handle that case; don't add defensive logic for a scenario the one-chat-per-day rule already rules out.

12. **BLOCK_TYPES is a locked 7-value enum** (`standard | superset | dropset | emom | pyramid | circuit | amrap`) — single TypeScript source of truth in `lib/blockTypes.ts`, validated against on every `log_workout` response before any `blocks.types` write.

13. **Gemini is called only from Convex actions**, never from mutations (Convex's transactional model forbids it) and never directly from the Expo client (leaks API keys, bypasses `apiUsage` logging). This applies equally to the main turn action and the onboarding task action.

14. **No forms, no menus is a hard product constraint** — applies inside the card stack modal too. The modal/blur/stacking/animation is fine and in fact central to the product's "delight" surface; what must stay conversational is the *content* of edits within a card (tap-to-adjust chips, inline corrections via "Ask Eco"), not labeled text-input forms.

15. **`onboardingProgress` is deleted the moment the queue empties** — it should never be treated as a durable record of "how a user answered onboarding," only as in-progress resume state. If historical onboarding-answer analytics are ever wanted, that's a new, separate design — don't repurpose this table's lifecycle to serve it.

16. **TypeScript strict mode + Convex codegen**: run `npx convex dev` before writing any client code that imports `api`/`internal`. `noUncheckedIndexedAccess` matters given how many optional fields exist in `exercises.sets` (`reps?`, `weight?`, `duration?`, `distance?`).
