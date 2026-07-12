# Eco Track — Agent Guide

## Project purpose

Eco Track is an iOS and Android Expo app where users log workouts conversationally with an AI companion, Eco. The product is intentionally conversational: no conventional forms or menu-led flows in V1.

## Authority and planning

- Read `Context files/_context.md` with every implementation phase.
- Follow the relevant `Context files/phase-*.md` file before changing code.
- Locked decisions in `_context.md`, `Turn-Lifecycle-Specification.txt`, `Final-Schema.txt`, and `Architectural Decisions.md` must not be changed without explicit product direction.
- If sources conflict, the current phase document wins within its scope. Flag the conflict in the handoff or PR rather than resolving it silently.
- The Phase 1 routing tree is `(auth)` and `(app)`. `Architectural Decisions.md` describes a later refined onboarding / `(authenticated)` tree; do not migrate to it until the relevant phase explicitly calls for that reconciliation.
- Keep V1 scope constrained to the documented plan. Do not add deferred features.

## Stack and conventions

- React Native + Expo + Expo Router; TypeScript in strict mode.
- NativeWind or `StyleSheet` only. Do not use inline styles.
- Use `@/` imports for project-root modules.
- Functional components only, with explicit return types; never use `any`.
- Put screens in `app/`, reusable chat UI in `components/chat/`, workout cards in `components/cards/`, shared primitives in `components/ui/`, hooks in `hooks/`, and shared types in `types/`.
- Keep secrets exclusively in `.env.local`; update `.env.example` whenever public environment keys change.

## Backend rules

- Convex is the state manager for all persisted data. Use queries for reads, mutations for transactional writes, and actions for external calls.
- Every Convex function must scope data by `userId`; never expose cross-user data.
- Return error objects from Convex functions rather than throwing.
- Gemini calls run only in Convex actions, never in the client or mutations, and every call records `apiUsage`.
- `sessions`, `blocks`, and `exercises` are internal-write-only. Never create client-facing write paths for them.
- Preserve the two distinct chat deletion paths, `sweepOldChats` and `forceDeleteChat`.

## Quality checks

- Before handing off a code change, run the relevant checks: `npx tsc --noEmit`, Expo startup/routing validation, and Convex code generation or validation where applicable.
- Maintain 44×44 px minimum touch targets.
- Do not make unrelated cleanup changes. Preserve existing user changes.

<!-- convex-ai-start -->

This project uses [Convex](https://convex.dev) as its backend.

When working on Convex code, **always read
`convex/_generated/ai/guidelines.md` first** for important guidelines on
how to correctly use Convex APIs and patterns. The file contains rules that
override what you may have learned about Convex from training data.

Convex agent skills for common tasks can be installed by running
`npx convex ai-files install`.

<!-- convex-ai-end -->
