# Eco Debug Console

## Model evaluations

The separate **Model evaluations** screen runs synthetic, versioned Gemini
fixtures. It never reads or writes product chats, workouts, cards, memory, or
`apiUsage`. It is protected by the same development-only debug-admin gate as
turn diagnostics.

Evaluation keys are server-only. Set `GEMINI_EVALUATION_KEYS_JSON` on the
Convex development deployment to a JSON object of aliases and keys, for
example `{"eco-development":"...","prototype-project":"..."}`. The UI
can select only aliases; it never receives key values. When this variable is
absent, the existing `GEMINI_API_KEY` is available only as `eco-development`.

Gemini quotas are per Cloud project, not per key. Configure one quota pool per
project, attach its model-specific RPM/RPD limits, and use multiple pools only
when their keys are associated with separate projects.

## Live Gemini controls

The separate **Live Gemini Controls** screen is for development-only manual
testing. Approved debug admins can save a complete main Eco system prompt and
model ID as a draft, then type-confirm publication. A published version affects
new chat turns and exercise-name guidance only; daily cleanup and compression
continue to use the code default. Each turn snapshots the selected version at
its start, so publishing does not alter an in-progress turn.

Published versions are immutable. The history allows an approved admin to
type-confirm rollback to any prior version. Until the first version is
published, the code defaults (`GEMINI_MODEL` and `ECO_SYSTEM_PROMPT`) remain in
use. The screen never exposes API keys, quota aliases, tool schemas, product
data, or the separate guidance/memory prompts.

Development-only React website for inspecting Eco Track turns in strict event
order. It is intentionally separate from the Expo interface and runs only on
localhost.

## Local use

The website reads the parent project's `EXPO_PUBLIC_CONVEX_URL`. You may
override it with `VITE_CONVEX_URL` in `debug-console/.env.local`.

The Convex development deployment must have:

```text
ECO_DEBUG_CONSOLE_ENABLED=true
```

When that flag is missing or false:

- turn instrumentation is a no-op;
- debug queries return disabled;
- the website cannot expose trace data.

Run the website:

```bash
npm run dev
```

Then open `http://127.0.0.1:5173` and sign in with the same Google test account
used in Eco Track. The first signed-in account can approve itself as the
development Debug Console admin. After that, only accounts with a row in
`debugConsoleApprovals` can open the console. Add any later admin rows through
the Convex development dashboard; there is intentionally no public approval
API.

The console is a focused drill-down: choose an anonymous test user, then a
date, then inspect only that date's turns. User names are not displayed.

## What is captured

- stable message-wide event sequences that continue across retries;
- assembled context and the final Gemini request payload;
- a dedicated **MODEL INPUT · CALL 0** panel with the sanitized system prompt,
  assembled history, current user message, and available tools exactly as sent;
- every main and nested Gemini call;
- tool selections, arguments, results, and errors;
- Zod validation results and issue paths;
- database write receipts;
- per-call model token usage and useful durations;
- persisted message blocks, cards, and guide invocations.
- an approved-admin-only Call 0 replay lab with fixed diagnostic variants,
  five samples per variant, token totals, and an optional post-hoc critique.
- typed-confirmation controls to delete one message or force-delete one chat.

Replay experiments never execute returned tools or write product messages,
cards, workouts, aliases, or user `apiUsage`. Future debug turns store an exact
server-side Call 0 snapshot; older turns are reconstructed from their sanitized
trace and labelled accordingly.

Debug payloads are sanitized before insertion. API keys, authorization values,
tokens, cookies, passwords, and authentication user identifiers are redacted.

## Production removal

The isolated surfaces are:

- `debug-console/`
- `convex/debug/`

The marked integration points outside those folders are:

- `convex/schema.ts`: imports and spreads `debugTables`;
- `convex/functions/messages.ts`: emits debug turn events;
- `convex/functions/cards.ts`: returns write receipts to the debug trace;
- `convex/lib/gemini.ts`: exposes debug request/usage metadata;
- `convex/lib/validation.ts`: preserves validation issue details.

Removing those surfaces and integration points restores the non-debug build.
Do not enable `ECO_DEBUG_CONSOLE_ENABLED` on a production deployment.

## Explicitly deferred

This development surface does not change Eco's tool selection, block
evidence-poor `log_workout` calls, or provide the future production
feedback/major-error monitoring screen. Its only permitted product-data
mutation is a typed-confirmation deletion by an approved debug admin. That
removes chat/message records, cards, summaries, and diagnostics; confirmed
workout sessions, blocks, and exercises remain intact.
