# Eco Track — Phase 9: RevenueCat + Paywall

> Load alongside: `_context.md`
> Depends on: Phase 2 (schema — `apiUsage` table exists), Phase 3 (auth — userId available), Phase 5 (Gemini — `apiUsage` rows being written per turn)
> Done when: Free users are gated after their trial token limit, paywall screen appears, RevenueCat handles purchase, pro users have unlimited access

---

## Objective

Implement the paywall. Free users get a token-limited trial (full features, limited turns). Pro users get unlimited access. RevenueCat handles all payment logic for both iOS and Android.

**Do not gate the app heavily.** The goal is to let users experience Eco properly before hitting a wall. The wall exists to convert, not to annoy.

---

## Free vs Pro

| | Free Trial | Pro |
|---|---|---|
| Access | Full features | Full features |
| Token limit | ~50,000 tokens total (roughly 30-50 conversations) | Unlimited |
| Price | Free | Set in RevenueCat dashboard (e.g. £4.99/month) |
| After limit | Paywall shown | Never |

Token limit is a one-time trial allowance — not per-day. Once the user exhausts it, they see the paywall until they subscribe.

50,000 tokens is the starting point — adjust based on real usage data post-launch.

---

## What to Build

### 1. Install RevenueCat

```bash
npx expo install react-native-purchases
```

RevenueCat requires a development build (not Expo Go). Ensure `eas build` is configured before testing this phase on device.

Configure for both platforms:
```ts
// lib/revenuecat/index.ts
import Purchases, { LOG_LEVEL } from "react-native-purchases"
import { Platform } from "react-native"

const API_KEYS = {
  ios: process.env.EXPO_PUBLIC_REVENUECAT_API_KEY_IOS!,
  android: process.env.EXPO_PUBLIC_REVENUECAT_API_KEY_ANDROID!,
}

export function initRevenueCat(userId: string) {
  if (__DEV__) {
    Purchases.setLogLevel(LOG_LEVEL.DEBUG)
  }

  const apiKey = Platform.OS === "ios" ? API_KEYS.ios : API_KEYS.android
  Purchases.configure({ apiKey, appUserID: userId })
}

export async function getSubscriptionStatus(): Promise<{ isPro: boolean }> {
  const customerInfo = await Purchases.getCustomerInfo()
  const isPro = customerInfo.entitlements.active["pro"] !== undefined
  return { isPro }
}

export async function purchasePro(): Promise<{ success: boolean; error?: string }> {
  try {
    const offerings = await Purchases.getOfferings()
    const monthlyPackage = offerings.current?.monthly
    if (!monthlyPackage) return { success: false, error: "No offering found" }

    await Purchases.purchasePackage(monthlyPackage)
    return { success: true }
  } catch (error: any) {
    if (error.userCancelled) return { success: false, error: "cancelled" }
    return { success: false, error: error.message }
  }
}

export async function restorePurchases(): Promise<{ isPro: boolean }> {
  const customerInfo = await Purchases.restorePurchases()
  const isPro = customerInfo.entitlements.active["pro"] !== undefined
  return { isPro }
}
```

### 2. Initialise RevenueCat on Login

In the root layout, after the user is signed in, call `initRevenueCat` with their Convex profile ID:

```tsx
// In AuthGuard, after isSignedIn is true:
useEffect(() => {
  if (isSignedIn && profile) {
    initRevenueCat(profile._id)
  }
}, [isSignedIn, profile?._id])
```

### 3. Token Gate Hook

`hooks/useTokenGate.ts`

This hook is called before every Gemini turn. It checks:
1. Is the user already pro? → allow
2. Is the user under their free trial limit? → allow
3. Otherwise → block and return `shouldShowPaywall: true`

```ts
import { useQuery } from "convex/react"
import { api } from "@/convex/_generated/api"
import { useState, useEffect } from "react"
import { getSubscriptionStatus } from "@/lib/revenuecat"

const FREE_TRIAL_TOKEN_LIMIT = 50000

export function useTokenGate(userId: string | undefined) {
  const [isPro, setIsPro] = useState(false)
  const [isCheckingPro, setIsCheckingPro] = useState(true)

  // Check RevenueCat subscription status
  useEffect(() => {
    if (!userId) return
    getSubscriptionStatus().then(({ isPro }) => {
      setIsPro(isPro)
      setIsCheckingPro(false)
    }).catch(() => setIsCheckingPro(false))
  }, [userId])

  // Sum tokens from apiUsage
  const totalTokensUsed = useQuery(
    api.functions.apiUsage.getTotalForUser,
    userId ? { userId } : "skip"
  )

  const isUnderLimit = (totalTokensUsed ?? 0) < FREE_TRIAL_TOKEN_LIMIT
  const shouldShowPaywall = !isCheckingPro && !isPro && !isUnderLimit

  return { isPro, isUnderLimit, shouldShowPaywall, isCheckingPro }
}
```

### 4. `apiUsage` Query

`convex/functions/apiUsage.ts` — add:

```ts
export const getTotalForUser = query({
  args: { userId: v.id("profiles") },
  handler: async (ctx, { userId }): Promise<number> => {
    const rows = await ctx.db
      .query("apiUsage")
      .withIndex("by_user_time", q => q.eq("userId", userId))
      .collect()
    return rows.reduce((sum, row) => sum + row.tokensUsed, 0)
  },
})
```

Note: For large user bases this query will get expensive. For v1 (trial phase), this is fine. Optimise in v2 with a running total field on `profiles` if needed.

### 5. Wire Token Gate into Chat

In `hooks/useChat.ts`, check the gate before calling `processTurn`:

```ts
import { useTokenGate } from "./useTokenGate"

export function useChat(chatId: string, userId: string | undefined) {
  const { shouldShowPaywall } = useTokenGate(userId)
  const [paywallVisible, setPaywallVisible] = useState(false)

  const sendMessage = useCallback(async (text: string) => {
    if (shouldShowPaywall) {
      setPaywallVisible(true)
      return
    }
    // ... rest of sendMessage
  }, [shouldShowPaywall, chatId])

  return { messages, sendMessage, isLoading, paywallVisible, setPaywallVisible }
}
```

In `ChatScreen`, render the paywall modal when `paywallVisible` is true:

```tsx
<PaywallModal
  visible={paywallVisible}
  onClose={() => setPaywallVisible(false)}
  onSuccess={() => {
    setPaywallVisible(false)
    // RevenueCat customer info will update, isPro will flip true
  }}
/>
```

### 6. Paywall Screen

`components/ui/PaywallModal.tsx`

A bottom sheet modal — not a full screen. Shows what pro includes, the price, and the purchase button.

```tsx
import { Modal, View, Text, Pressable, ActivityIndicator } from "react-native"
import { useState } from "react"
import { purchasePro, restorePurchases } from "@/lib/revenuecat"

interface Props {
  visible: boolean
  onClose: () => void
  onSuccess: () => void
}

export function PaywallModal({ visible, onClose, onSuccess }: Props) {
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handlePurchase = async () => {
    setIsLoading(true)
    setError(null)
    const result = await purchasePro()
    setIsLoading(false)
    if (result.success) {
      onSuccess()
    } else if (result.error !== "cancelled") {
      setError("Something went wrong. Try again.")
    }
  }

  const handleRestore = async () => {
    setIsLoading(true)
    const { isPro } = await restorePurchases()
    setIsLoading(false)
    if (isPro) onSuccess()
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.7)" }} onPress={onClose} />
      <View style={{
        backgroundColor: "#0d0d0d",
        borderTopLeftRadius: 24,
        borderTopRightRadius: 24,
        padding: 28,
        paddingBottom: 44,
      }}>
        <Text style={{ color: "#fff", fontSize: 22, fontWeight: "700", marginBottom: 8 }}>
          Your trial has ended
        </Text>
        <Text style={{ color: "#888", fontSize: 15, lineHeight: 22, marginBottom: 28 }}>
          You've used your free messages. Upgrade to keep training with Eco — unlimited conversations, full memory, everything.
        </Text>

        {/* Feature list */}
        {["Unlimited messages", "Full workout memory", "Daily summaries", "Eco learns your style"].map(feature => (
          <View key={feature} style={{ flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 10 }}>
            <Text style={{ color: "#fff", fontSize: 16 }}>✓</Text>
            <Text style={{ color: "#ccc", fontSize: 15 }}>{feature}</Text>
          </View>
        ))}

        <Pressable
          onPress={handlePurchase}
          disabled={isLoading}
          style={{
            backgroundColor: "#fff",
            borderRadius: 14,
            padding: 16,
            alignItems: "center",
            marginTop: 24,
          }}
        >
          {isLoading ? (
            <ActivityIndicator color="#000" />
          ) : (
            <Text style={{ color: "#000", fontWeight: "700", fontSize: 16 }}>
              Continue with Pro
            </Text>
          )}
        </Pressable>

        {error && (
          <Text style={{ color: "#f55", textAlign: "center", marginTop: 12, fontSize: 14 }}>
            {error}
          </Text>
        )}

        <Pressable onPress={handleRestore} style={{ alignItems: "center", marginTop: 16, padding: 8 }}>
          <Text style={{ color: "#555", fontSize: 14 }}>Restore purchases</Text>
        </Pressable>
      </View>
    </Modal>
  )
}
```

### 7. RevenueCat Dashboard Setup

Before testing, configure in the RevenueCat dashboard:
- Create a project
- Add iOS app (Bundle ID) and Android app (Package Name)
- Create an entitlement: `pro`
- Create a product in App Store Connect / Google Play Console: monthly subscription
- Create an offering in RevenueCat with that product as the `monthly` package
- Add both platform API keys to `.env.local`

This is a manual step outside of Codex — do it before running phase tests.

---

## Done Checklist

- [ ] RevenueCat initialises on login (check debug logs in dev)
- [ ] Free user with `apiUsage` total under 50,000 → can send messages normally
- [ ] Free user with `apiUsage` total over 50,000 → paywall modal appears on next message
- [ ] Paywall shows correctly — copy, features, purchase button
- [ ] Purchase flow opens App Store / Google Play sheet
- [ ] Successful purchase → paywall closes, user can message again
- [ ] "Restore purchases" works for users who reinstalled
- [ ] Pro user (active entitlement in RevenueCat) → never sees paywall
- [ ] `npx tsc --noEmit` reports zero errors
- [ ] Tested on real device with RevenueCat sandbox environment

---

## What Not to Do in This Phase

- Do not implement per-day token limits — the current model is a one-time trial allowance, keep it simple
- Do not build a subscription management screen (v2 — for now, users manage via App Store/Google Play settings)
- Do not add annual pricing yet — monthly only for v1
- Do not show the paywall proactively (e.g. on app open) — only trigger it when the user tries to send a message

---

## Next Phase

Phase 10 — Polish + Release Prep: error states, loading states, edge cases, final QA.
