# Eco Track — Phase 10: Polish + Release Prep

> Load alongside: `_context.md`
> Depends on: All previous phases complete and working
> Done when: App handles every error gracefully, feels smooth on a real device, and is ready for friends to use

---

## Objective

Turn a working app into a shippable app. Everything up to this point was about making things work. This phase is about making things feel right — handling the cases that break immersion, smoothing the rough edges, and making sure nothing embarrassing happens when a real user touches it.

This phase is tested entirely on real devices. Simulator is not enough.

---

## What to Cover

### 1. Error States

Every network call can fail. Every UI must handle it gracefully. Go through the app and add error handling everywhere it's missing.

#### Gemini / processTurn failure
If the Convex action throws or times out, the user should see a subtle error — not a crash, not silence.

In `useChat.ts`:
```ts
const sendMessage = useCallback(async (text: string) => {
  setIsLoading(true)
  setError(null)
  try {
    await processTurn({ chatId, userText: text })
  } catch (err) {
    setError("Eco couldn't respond. Tap to retry.")
    // Keep the user's message visible in the list
  } finally {
    setIsLoading(false)
  }
}, [])
```

Show the error as a subtle inline message below the last user bubble, not a modal. Include a "Retry" tap target.

> **Implemented chat recovery (2026-07-30):** Gemini failures render as plain,
> neutral, monospaced console text rather than an Eco bubble, red alert, or
> modal. The centered retry button uses the app's muted green and a 44px touch
> target. It regenerates the failed turn in place; it never duplicates the
> user message or creates an additional `messages` row.

#### Network offline
Detect network state with `@react-native-community/netinfo`. If offline when user tries to send:
```
"You're offline. Eco will respond when you're back."
```

Show this as an inline banner at the top of the chat, not a blocking modal.

#### Card confirm failure
If `confirmCard` mutation fails (rare but possible), the card should stay in `pending` state and show a retry option. Never silently fail.

#### Auth failure / session expiry
If `ctx.auth.getUserIdentity()` returns null mid-session, redirect to sign-in screen. Don't leave the user on a broken chat screen.

### 2. Loading States

Audit every screen for missing loading states:

| Screen / Action | Loading state |
|---|---|
| App launch (checking auth) | Full-screen dark splash, no flash of wrong screen |
| Onboarding "Start training" press | Button spinner, disabled while writing |
| Chat — Eco responding | Typing indicator (Phase 4 — verify it works) |
| Card confirm press | Button spinner, card dims slightly |
| Paywall purchase | Button spinner, entire modal dims |
| RevenueCat restore | Button spinner |

#### Splash screen
Prevent the white flash on launch. In `app.json`:
```json
{
  "splash": {
    "backgroundColor": "#000000"
  }
}
```

Also ensure the root layout doesn't render anything until `isLoading` resolves:
```tsx
if (isLoading) return <View style={{ flex: 1, backgroundColor: "#000" }} />
```

### 3. Empty States

| State | What to show |
|---|---|
| First chat (no messages yet) | Eco's opening line: "Hey [name]. What did you train today?" |
| No workouts logged yet (history screen if built) | "Nothing logged yet. Tell me what you trained." |

The opening message should be generated or hardcoded — do not show a blank white screen.

```tsx
// In MessageList, if messages.length === 0:
<View style={{ flex: 1, justifyContent: "center", alignItems: "center", padding: 32 }}>
  <Text style={{ color: "#555", fontSize: 16, textAlign: "center", lineHeight: 24 }}>
    Hey {profile?.name?.split(" ")[0] ?? "there"}.{"\n"}What did you train today?
  </Text>
</View>
```

### 4. Keyboard Behaviour

Test on both iOS and Android:
- Input bar always visible above keyboard
- No content hidden behind keyboard when scrolling
- Tapping outside keyboard dismisses it (add `ScrollView` with `keyboardShouldPersistTaps="handled"`)
- On Android, back button dismisses keyboard before navigating

### 5. Scroll Behaviour

- Chat auto-scrolls to bottom when new message arrives — but only if user was already at the bottom
- If user scrolled up to read history, don't yank them back down
- Implement a "scroll to bottom" button that appears when user is scrolled up and a new message arrives

```ts
// Track if user is at bottom
const [isAtBottom, setIsAtBottom] = useState(true)

const handleScroll = (event) => {
  const { layoutMeasurement, contentOffset, contentSize } = event.nativeEvent
  const distanceFromBottom = contentSize.height - contentOffset.y - layoutMeasurement.height
  setIsAtBottom(distanceFromBottom < 40)
}

// Only auto-scroll if at bottom
useEffect(() => {
  if (isAtBottom && messages.length > 0) {
    ref.current?.scrollToEnd({ animated: true })
  }
}, [messages.length, isAtBottom])
```

### 6. Typography + Spacing Consistency

Do a visual pass on every screen:
- All body text: 15px, line-height 22
- All secondary/label text: 13px, color `#888`
- All headings: 22px, fontWeight 600
- Consistent horizontal padding: 16px everywhere
- Minimum tap targets: 44×44px on all interactive elements (check the Edit/Ask Eco buttons on cards and the input-area Back to deck control)

### 7. Dark Mode

The app is dark-only for v1. Ensure:
- No white backgrounds flash during navigation transitions
- Status bar is light-coloured on all screens (`<StatusBar style="light" />`)
- Keyboard appearance is dark on iOS (`keyboardAppearance="dark"` on all TextInputs)

### 8. Performance

- Messages list should scroll at 60fps — verify on an older device if possible
- If it stutters: add `windowSize={10}` and `maxToRenderPerBatch={10}` to FlatList
- Card components should not re-render unnecessarily — wrap in `React.memo` if needed

### 9. Sign Out

Add a sign-out option somewhere accessible. Profile tab is the right place:

`app/(app)/profile/index.tsx`:
```tsx
const { signOut } = useAuth()

<Pressable onPress={() => signOut()} style={{ ... }}>
  <Text>Sign out</Text>
</Pressable>
```

After sign out, root layout should redirect to sign-in (auth guard handles this automatically).

### 10. Privacy Policy + Terms

Required for App Store submission. Two options:
- Use a free template service (e.g. privacypolicygenerator.info, termsfeed.com) — 30 minutes
- Host as a simple webpage (GitHub Pages or Vercel)

Add links in the profile screen:
```tsx
<Pressable onPress={() => Linking.openURL("https://your-privacy-policy-url")}>
  <Text style={{ color: "#555" }}>Privacy Policy</Text>
</Pressable>
<Pressable onPress={() => Linking.openURL("https://your-terms-url")}>
  <Text style={{ color: "#555" }}>Terms of Use</Text>
</Pressable>
```

These links are required by both Apple and Google for apps that collect user data.

### 11. App Store / Google Play Prep

**App metadata to prepare:**
- App name: "Eco Track"
- Subtitle (iOS): "Your AI workout companion"
- Description: Write a 170-char and a long-form version
- Keywords (iOS): workout, fitness, AI, logging, tracker, gym
- Screenshots: 3-5 per device size. Record real use — show the chat, show a card appearing, show the onboarding. Use a real iPhone and Android device.
- App icon: 1024×1024px, no transparency, no rounded corners (the stores add them)

**EAS Build setup** (if not already done):
```bash
npm install -g eas-cli
eas login
eas build:configure
```

Build for both platforms before submitting:
```bash
eas build --platform ios
eas build --platform android
```

**Bundle identifier / package name:**
- iOS: `com.yourname.ecotrack`
- Android: `com.yourname.ecotrack`

Set these in `app.json` before first build — they cannot be changed after submission.

### 12. Final QA Checklist (Do This on a Real Device)

Go through the entire user journey:

1. Fresh install → onboarding appears
2. Complete onboarding → land on chat
3. Type "Did 20 pushups" → card appears, marked pending
4. Confirm card → session/exercise written to Convex
5. Type "Did 3 sets of bench at 80kg" → card appears, confirmed (high confidence)
6. Edit a card field → change reps, confirm → exercises updated in Convex
7. Tap Ask Eco on a card → input-area discussion banner appears → type a correction → card updates
8. Tap Back to deck → banner disappears and the card is no longer injected into the next turn
9. Close app, reopen → messages still there (Convex reactive)
10. Kill app, reopen → auth persists, goes straight to chat
11. Send 3 messages quickly → no race conditions, all messages appear in order
12. Turn off wifi, try to send → offline message appears, no crash
13. Turn wifi back on, retry → sends successfully
14. Sign out → lands on sign-in screen
15. Sign back in → lands on chat, no onboarding again

---

## Done Checklist

- [ ] Every error state tested — Gemini failure, network offline, card confirm failure
- [ ] No white flash on app launch
- [ ] Empty chat shows Eco's opening line
- [ ] Keyboard behaviour correct on both iOS and Android
- [ ] Scroll-to-bottom logic works correctly
- [ ] All tap targets pass 44×44px minimum
- [ ] Status bar is light on all screens
- [ ] Sign out works and redirects correctly
- [ ] Privacy Policy and Terms URLs added to profile screen
- [ ] `eas build` succeeds for both platforms
- [ ] Full QA journey completed on a real device (both iOS and Android if possible)
- [ ] `npx tsc --noEmit` reports zero errors

---

## You're Done

When this checklist is complete, the app is ready for friends to use. Submit to TestFlight (iOS) and Google Play internal testing (Android) — both allow you to distribute to specific users without public release.

After real user feedback: iterate, then consider public launch.
