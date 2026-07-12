# Eco Track — Phase 1: Scaffolding

> Load alongside: `_context.md`
> Depends on: nothing — this is the foundation everything else builds on
> Done when: Expo app runs on a real device, Convex is connected and live, TypeScript is strict, folder structure matches the spec exactly

---

## Objective

Stand up the full project skeleton. No features, no UI, no AI. Just the bones — correctly configured from day one so every future phase builds on a solid foundation.

This phase is about **configuration, not code**. Get it wrong here and you'll be fighting your own setup for the next 9 phases.

---

## What to Build

### 1. Expo Project

Initialise a new Expo project with the following:

- Expo SDK (latest stable)
- TypeScript template (strict mode — `"strict": true` in `tsconfig.json`)
- Expo Router (file-based routing)
- NativeWind (Tailwind for React Native — for styling)

```bash
npx create-expo-app eco-track --template expo-template-blank-typescript
```

Then install:
```bash
npx expo install expo-router nativewind tailwindcss react-native-safe-area-context react-native-screens
```

Configure NativeWind per its Expo setup docs. Tailwind config should include the `/app` and `/components` directories.

### 2. Folder Structure

Create the exact folder structure from `_context.md`. Every folder must exist even if empty — Codex in future phases will assume these paths exist.

```
/app
  /(auth)
    _layout.tsx       # auth stack layout
    sign-in.tsx       # placeholder screen
  /(app)
    _layout.tsx       # tab layout (placeholder tabs)
    /chat
      index.tsx       # placeholder screen
    /history
      index.tsx       # placeholder screen
    /profile
      index.tsx       # placeholder screen
  _layout.tsx         # root layout

/components
  /chat               # empty, folder only
  /cards              # empty, folder only
  /ui                 # empty, folder only

/convex
  schema.ts           # empty export for now (Phase 2 fills this)
  auth.config.ts      # placeholder
  /functions
    messages.ts       # empty
    cards.ts          # empty
    sessions.ts       # empty
    blocks.ts         # empty
    exercises.ts      # empty
    chats.ts          # empty
    profiles.ts       # empty
    crons.ts          # empty
    apiUsage.ts       # empty

/lib
  /gemini             # empty
  /validation         # empty
  /revenuecat         # empty

/hooks                # empty
/types                # empty
```

Every placeholder screen should render a single `<Text>` with its own name so you can verify routing works. Example:

```tsx
// app/(app)/chat/index.tsx
import { Text, View } from 'react-native'

export default function ChatScreen() {
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
      <Text>Chat Screen</Text>
    </View>
  )
}
```

### 3. Convex Setup

- Install Convex: `npx convex dev` to initialise
- Connect to a new Convex project
- `convex/schema.ts` stays empty (just `import { defineSchema } from 'convex/server'; export default defineSchema({})`) — Phase 2 populates it
- Confirm the Convex dashboard is live and the dev tunnel is running

### 4. TypeScript Config

`tsconfig.json` must have:
```json
{
  "extends": "expo/tsconfig.base",
  "compilerOptions": {
    "strict": true,
    "noImplicitAny": true,
    "strictNullChecks": true,
    "paths": {
      "@/*": ["./*"]
    }
  }
}
```

Path alias `@/` must work — every import in future phases will use it.

### 5. Environment Variables

Create `.env.local` with placeholders (values filled in per service setup):
```
EXPO_PUBLIC_CONVEX_URL=
EXPO_PUBLIC_GEMINI_API_KEY=
EXPO_PUBLIC_REVENUECAT_API_KEY_IOS=
EXPO_PUBLIC_REVENUECAT_API_KEY_ANDROID=
```

Create `.env.example` with the same keys but no values — this gets committed.
`.env.local` goes in `.gitignore`.

### 6. Git Setup

- Initialise git repo
- `.gitignore` must include: `node_modules`, `.env.local`, `.expo`, `dist`
- Initial commit: "Phase 1: scaffolding"

---

## Done Checklist

- [ ] `npx expo start` runs without errors
- [ ] App loads on a real device (Expo Go or dev build)
- [ ] All 3 tab screens are reachable and show their placeholder text
- [ ] Auth screens are reachable via routing
- [ ] `npx convex dev` runs without errors, dashboard is live
- [ ] TypeScript reports zero errors (`npx tsc --noEmit`)
- [ ] Path alias `@/` resolves correctly in at least one test import
- [ ] `.env.example` is committed, `.env.local` is gitignored
- [ ] Folder structure matches the spec exactly — no missing folders

---

## What Not to Do in This Phase

- Do not write any real UI
- Do not deploy the Convex schema
- Do not touch auth logic
- Do not install RevenueCat yet
- Do not write any Gemini code

---

## Next Phase

Phase 2 — Schema: deploy the full Convex schema with all tables and indexes.
