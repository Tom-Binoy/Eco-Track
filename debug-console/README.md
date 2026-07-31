# Eco Debug Console

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
