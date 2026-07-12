# Eco Track — Phase 3: Auth

> Load alongside: `_context.md`
> Depends on: Phase 1 (scaffolding), Phase 2 (schema deployed — `profiles` table must exist)
> Done when: User can sign in with Google, a `profiles` row is created on first login, and the app routes correctly based on auth state

---

## Objective

Implement Google OAuth via Convex Auth. On first login, create a `profiles` row with sensible defaults. On subsequent logins, load the existing profile. Route the user to onboarding if their profile is incomplete, or to the chat screen if it is complete.

Onboarding UI is Phase 8 — this phase just establishes the routing logic and the profile creation mutation. Onboarding will slot in cleanly when the time comes.

---

## What to Build

### 1. Convex Auth Config

Install Convex Auth:
```bash
npx convex auth add google
```

Configure `convex/auth.config.ts`:
```ts
import Google from "@auth/core/providers/google"
import { convexAuth } from "@convex-dev/auth/server"

export const { auth, signIn, signOut, store } = convexAuth({
  providers: [Google],
})
```

Add Google OAuth credentials to Convex environment variables (via dashboard):
- `AUTH_GOOGLE_CLIENT_ID`
- `AUTH_GOOGLE_CLIENT_SECRET`

### 2. Profile Creation Mutation

`convex/functions/profiles.ts`

Write a mutation `createProfile` that:
- Takes `userId: Id<"users">` (Convex Auth user id) and `name: string`
- Checks if a `profiles` row already exists for this `userId`
- If it does: return the existing profile id (idempotent)
- If it doesn't: insert a new row with these defaults:

```ts
{
  userId,           // from Convex Auth
  name,             // from Google account display name
  createdAt: Date.now(),
  injuries: [],
  equipment: "",
  goals: "",
  trainingAvailability: { daysPerWeek: 3, sessionLength: 60 },
  tonePreference: "friendly",
  weightUnit: "kg",
  distanceUnit: "km",
  darkMode: false,
  timezone: "UTC",  // placeholder — overwritten during onboarding (Phase 8)
  skillLevel: {
    strength: "",
    flexibility: "",
    endurance: "",
    calisthenicsSkills: "",
    sportSpecific: "",
    bodyComposition: "",
  },
  trainingPattern: "",
}
```

Write a query `getProfileByUserId` that:
- Takes `userId: Id<"users">`
- Returns the profile row or null

Write a query `getMyProfile` that:
- Uses `ctx.auth.getUserIdentity()` to get the current user
- Returns their profile or null
- This is the primary hook for the rest of the app

### 3. Auth Hook

`hooks/useAuth.ts`

```ts
import { useAuthActions } from "@convex-dev/auth/react"
import { useQuery } from "convex/react"
import { api } from "@/convex/_generated/api"

export function useAuth() {
  const { signIn, signOut } = useAuthActions()
  const profile = useQuery(api.functions.profiles.getMyProfile)

  const isLoading = profile === undefined
  const isSignedIn = profile !== null && profile !== undefined
  const isOnboarded = isSignedIn && profile.timezone !== "UTC" && profile.goals !== ""

  return { signIn, signOut, profile, isLoading, isSignedIn, isOnboarded }
}
```

`isOnboarded` is a simple heuristic — timezone set + goals set means onboarding completed. Phase 8 can refine this if needed.

### 4. Root Layout — Auth Guard

`app/_layout.tsx`

The root layout is responsible for:
1. Wrapping the app in `ConvexAuthProvider` and `ConvexProvider`
2. Redirecting based on auth state:
   - Not signed in → `/(auth)/sign-in`
   - Signed in, not onboarded → `/(auth)/onboarding` (placeholder route for now)
   - Signed in and onboarded → `/(app)/chat`

```tsx
import { ConvexAuthProvider } from "@convex-dev/auth/react"
import { ConvexReactClient } from "convex/react"
import { Slot, useRouter, useSegments } from "expo-router"
import { useEffect } from "react"
import { useAuth } from "@/hooks/useAuth"

const convex = new ConvexReactClient(process.env.EXPO_PUBLIC_CONVEX_URL!)

function AuthGuard() {
  const { isLoading, isSignedIn, isOnboarded } = useAuth()
  const segments = useSegments()
  const router = useRouter()

  useEffect(() => {
    if (isLoading) return

    const inAuth = segments[0] === "(auth)"

    if (!isSignedIn && !inAuth) {
      router.replace("/(auth)/sign-in")
    } else if (isSignedIn && !isOnboarded && segments[1] !== "onboarding") {
      router.replace("/(auth)/onboarding")
    } else if (isSignedIn && isOnboarded && inAuth) {
      router.replace("/(app)/chat")
    }
  }, [isLoading, isSignedIn, isOnboarded, segments])

  return <Slot />
}

export default function RootLayout() {
  return (
    <ConvexAuthProvider client={convex}>
      <AuthGuard />
    </ConvexAuthProvider>
  )
}
```

### 5. Sign-In Screen

`app/(auth)/sign-in.tsx`

Simple screen with a "Continue with Google" button. On press, call `signIn("google")`. No other UI needed for v1.

```tsx
import { useAuthActions } from "@convex-dev/auth/react"
import { Pressable, Text, View } from "react-native"

export default function SignInScreen() {
  const { signIn } = useAuthActions()

  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
      <Text style={{ fontSize: 24, marginBottom: 32 }}>Welcome to Eco Track</Text>
      <Pressable
        onPress={() => signIn("google")}
        style={{ backgroundColor: "#000", padding: 16, borderRadius: 8 }}
      >
        <Text style={{ color: "#fff" }}>Continue with Google</Text>
      </Pressable>
    </View>
  )
}
```

### 6. Onboarding Placeholder

`app/(auth)/onboarding.tsx`

Placeholder only — Phase 8 will replace this entirely:

```tsx
import { Text, View } from "react-native"

export default function OnboardingScreen() {
  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
      <Text>Onboarding (Phase 8)</Text>
    </View>
  )
}
```

### 7. Profile Creation on Login

After Google sign-in succeeds, the app must call `createProfile` with the user's name from their Google account. 

The best place to do this is in the root layout after `isSignedIn` becomes true and before checking `isOnboarded`. Use a `useMutation` call in `AuthGuard`:

```tsx
const createProfile = useMutation(api.functions.profiles.createProfile)

useEffect(() => {
  if (isSignedIn && !profile) {
    // profile is null = first login
    createProfile({ name: identity?.name ?? "Athlete" })
  }
}, [isSignedIn, profile])
```

Get `identity` via `useQuery(api.auth.currentUser)` or Convex Auth's identity hook — use whichever is idiomatic for the installed version of Convex Auth.

---

## Done Checklist

- [ ] Google sign-in works on a real device (opens Google OAuth, returns to app)
- [ ] First login creates a `profiles` row in Convex dashboard
- [ ] Second login does NOT create a duplicate row
- [ ] Unauthenticated user is redirected to sign-in screen
- [ ] Authenticated + not onboarded → onboarding placeholder
- [ ] Authenticated + onboarded (manually set in dashboard for testing) → chat screen
- [ ] `useAuth()` hook returns correct values in all three states
- [ ] `npx tsc --noEmit` reports zero errors

---

## What Not to Do in This Phase

- Do not build onboarding UI (Phase 8)
- Do not build the chat screen (Phase 4)
- Do not add any fields to `profiles` beyond what the schema defines
- Do not implement sign-out UI yet (add it to the profile screen in a later phase)

---

## Next Phase

Phase 4 — Chat UI: message list, input bar, basic layout. No AI yet.
