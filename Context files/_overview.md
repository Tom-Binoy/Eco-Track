# Eco Track — Build Roadmap (Bird's Eye View)

A plain-English overview of every phase. Read this to orient yourself before opening a phase doc, or when you want to remember where you are and what's next.

---

## The Two Halves

**Phases 1–7: Internal build.** You test this yourself. No onboarding, rough edges allowed. The goal is a working core loop on your phone.

**Phases 8–10: Release prep.** Onboarding, paywall, polish. Friends will see this version.

---

## Phase 1 — Scaffolding
**What it is:** Create the project. Nothing works yet, but everything exists.

Sets up the Expo app, connects Convex, creates the full folder structure, configures TypeScript strict mode, and creates placeholder screens for every route. Also sets up environment variables and git.

**You know it's done when:** `npx expo start` runs, the app loads on your phone, and TypeScript reports zero errors.

**Time estimate:** 2–3 hours.

---

## Phase 2 — Schema
**What it is:** Deploy the database. All 19 tables, all indexes, all fields — exactly right from day one.

This is the most important phase for long-term consistency. Getting the schema wrong here means painful migrations later. Codex works directly from `Final-Schema.txt` and translates it into Convex syntax. Also generates TypeScript types for every table.

**You know it's done when:** All 19 tables are visible in the Convex dashboard with the correct indexes.

**Time estimate:** 2–4 hours.

---

## Phase 3 — Auth
**What it is:** Google sign-in. Create a profile on first login. Route users based on auth state.

Implements Google OAuth via Convex Auth. On first login, creates a `profiles` row with default values. The app then routes: not signed in → sign-in screen, signed in + not onboarded → onboarding placeholder, signed in + onboarded → chat screen.

**You know it's done when:** You can sign in with Google, your profile appears in the Convex dashboard, and the routing works correctly in all three states.

**Time estimate:** 3–4 hours.

---

## Phase 4 — Chat UI
**What it is:** Build the chat screen. Messages display, input works — but no AI yet.

The core screen of the entire app. User and Eco messages render in a scrollable list. Input bar sticks above the keyboard. A placeholder "AI coming soon" response fires after a short delay. Everything is wired with local state only — no Convex writes in this phase.

**You know it's done when:** You can type a message, see it in the list, see a fake Eco reply, and the keyboard doesn't cover the input on your phone.

**Time estimate:** 3–5 hours.

---

## Phase 5 — Gemini Integration
**What it is:** Connect the AI. The full turn lifecycle runs end to end.

This is the most complex phase. Replaces the Phase 4 placeholder with the real Gemini call. Assembles context (profile, workout history, recent messages), calls Gemini, validates the response with Zod, then either writes a full session (high confidence) or a pending card (low confidence). Messages are now written to Convex and appear reactively. Token usage is logged to `apiUsage` after every call.

**You know it's done when:** "Did 20 pushups" creates session/blocks/exercises rows in Convex. A conversational message gets a text reply with no database write. Ambiguous input creates a pending card. A repeated broad data lookup is stopped after one request and still ends with a reply. Chat history shows ordered Eco text, cards, and generated tool summaries rather than raw payloads; activity expands from one per-turn control into its original positions. Private raw traces remain available only to approved debugging. Tool results persist the five-follow-up countdown, and the development Debug Console can replay a captured Call 0 safely without executing tools or type-confirm deletion of test messages/chats.

**Time estimate:** 6–10 hours. Take your time here.

---

## Phase 6 — Cards
**What it is:** The workout card UI. Pending → confirmed flow, editable fields, Ask Eco.

Workout cards appear below Eco's message after a logged workout. Pending cards have a Confirm button. Confirmed cards show "Logged". Users can edit any field inline and tap confirm. Ask Eco sets the card into discussion mode — the next turn includes the card in Gemini's context and a visual banner above the text input exposes **Back to deck**. Only that explicit user action ends the discussion. Correcting a confirmed card flips it back to pending for explicit re-confirmation.

**You know it's done when:** Full end-to-end: log a workout → card appears → edit reps → confirm → check Convex dashboard → exercises row shows the edited value.

**Time estimate:** 5–8 hours.

---

## Phase 7 — Memory + Cron
**What it is:** Eco's memory system. Compression keeps long chats fast. The nightly cron builds cross-session memory.

Two separate systems: (1) Within-chat compression — when a chat gets long, old messages are summarised into `sessionSummaries` so the context window doesn't blow up. (2) Daily cleanup — runs every hour, finds users at local midnight, and for a day with chat activity makes one Gemini call to write a `dailySummaries` journal entry plus optional profile and `workoutContext` updates, then purges the day's session summaries. This is what makes Eco feel like it actually knows you over time.

**You know it's done when:** The cron appears in the Convex dashboard. Triggering it manually writes a `dailySummaries` row. A very long chat produces a `sessionSummaries` row.

**Time estimate:** 5–8 hours.

---

## — Internal Testing Checkpoint —

**At this point, the core app is complete. Test it yourself:**
- Log workouts in real training sessions
- Verify cards appear correctly for different exercise types (supersets, dropsets, etc.)
- Let the cron run overnight and check that `workoutContext` updates
- Break things. Find edge cases. Fix them.

**Only move to Phase 8 when you're happy with the core loop.**

---

## Phase 8 — Onboarding
**What it is:** The first-run experience. Eco introduces itself and collects basic info.

Three steps: (1) Goals — what are you training for? (2) Equipment — multi-select chips. (3) Units + tone — auto-detected from device locale, confirm or change. Conversational in style, skip-friendly. Completing onboarding updates the `profiles` row and routes the user to the chat screen. Returning users never see it again.

**You know it's done when:** A new user (profile manually cleared in dashboard) sees all 3 steps, completes them, and lands on a personalised chat screen. Their profile in Convex shows the correct values.

**Time estimate:** 4–6 hours.

---

## Phase 9 — RevenueCat + Paywall
**What it is:** The business model. Free trial is token-limited. Pro is unlimited. RevenueCat handles everything.

Installs RevenueCat and initialises it on login. Sums `apiUsage` tokens to check if the user has exhausted their free trial (~50,000 tokens). If they have, a paywall bottom sheet appears when they try to send a message. The paywall handles purchase and restore. Pro users (active RevenueCat entitlement) are never gated.

**You know it's done when:** A test user with >50,000 tokens in `apiUsage` sees the paywall. A sandbox purchase goes through and they can message again.

**Time estimate:** 4–6 hours. Note: requires a development build (not Expo Go) and RevenueCat sandbox setup.

---

## Phase 10 — Polish + Release Prep
**What it is:** Make it shippable. Error handling, loading states, visual consistency, App Store prep.

Goes through the entire app and adds what was deferred: error states for every failure point, loading spinners everywhere, the empty chat opening message, correct keyboard behaviour on both platforms, scroll-to-bottom logic, sign out, privacy policy and terms links, and app store metadata (screenshots, description, icon). Ends with a full QA run on a real device.

**You know it's done when:** You've gone through the 14-step QA checklist on a real phone and nothing breaks. `eas build` succeeds for both platforms.

**Time estimate:** 6–10 hours.

---

## After Phase 10

Submit to **TestFlight** (iOS) and **Google Play internal testing** (Android). Share with your friends. Collect feedback. Iterate. Then consider public launch.

---

## Files in the Working Directory

| File | Purpose |
|---|---|
| `_context.md` | Master context — loaded alongside every phase doc |
| `Final-Schema.txt` | Full Convex schema — source of truth for all tables |
| `Turn-Lifecycle-Specification.txt` | Turn-by-turn AI behavior — referenced by Phases 5, 6, 7 |
| `phase-01-scaffolding.md` | Phase 1 detail |
| `phase-02-schema.md` | Phase 2 detail |
| `phase-03-auth.md` | Phase 3 detail |
| `phase-04-chat-ui.md` | Phase 4 detail |
| `phase-05-gemini.md` | Phase 5 detail |
| `phase-06-cards.md` | Phase 6 detail |
| `phase-07-memory-cron.md` | Phase 7 detail |
| `phase-08-onboarding.md` | Phase 8 detail |
| `phase-09-revenuecat.md` | Phase 9 detail |
| `phase-10-polish.md` | Phase 10 detail |

The active server-side Gemini model is defined once in `convex/lib/geminiConfig.ts` as `GEMINI_MODEL`. It currently uses `gemini-3.6-flash` for main turns, exercise guidance, replay diagnostics, compression, and daily memory.

---

## How to Use These With Codex

Start each Codex session by saying:

> "Load `_context.md` and `phase-0X-[name].md`. Let's work on Phase X."

Codex will read both files and have everything it needs. You don't need to paste anything manually.

When a phase is complete, move to the next. Don't skip phases — the dependency order is deliberate.
