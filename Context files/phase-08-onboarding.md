# Eco Track — Phase 8: Onboarding

> Load alongside: `_context.md`
> Depends on: Phase 3 (auth — profile exists, onboarding placeholder in place), Phase 5 (Gemini — Eco can respond conversationally)
> Done when: A new user completes onboarding, their profile is fully populated, and they land on the chat screen ready to use the app

---

## Objective

Build the first-run onboarding experience. This is what new users see before they reach the chat screen. It must feel like meeting Eco for the first time — not filling out a form.

The onboarding collects the information Eco needs to give personalised responses from day one: name (already from Google), goals, equipment, skill level, weight/distance units, and timezone.

This replaces the placeholder `app/(auth)/onboarding.tsx` from Phase 3.

---

## Design Principles for Onboarding

- **Conversational, not form-like.** Eco asks questions. The user answers. It should feel like the chat screen — because it is the chat screen, but guided.
- **Short.** Maximum 4-5 questions. Everything else Eco learns over time.
- **Skip-friendly.** Users can skip anything they don't want to answer. Eco fills in defaults.
- **No back button confusion.** Onboarding is a linear flow. No going back mid-flow.

---

## What to Collect

| Field | How | Example |
|---|---|---|
| `goals` | Free text question | "What are you training for?" |
| `equipment` | Multi-select chips | Barbell, Dumbbells, Cables, Bodyweight, Kettlebells, Rings |
| `weightUnit` / `distanceUnit` | Auto-detected from locale, confirm | "You're in the UK — using kg and km?" |
| `timezone` | Auto-detected from device | `Intl.DateTimeFormat().resolvedOptions().timeZone` |
| `tonePreference` | Optional single question | "How do you want Eco to talk to you?" → Chill / Motivating / Direct |

`skillLevel` and `trainingPattern` are **not** asked during onboarding — Eco infers these over time from actual workouts. Leave them as empty strings.

---

## What to Build

### 1. Onboarding Screen Structure

`app/(auth)/onboarding.tsx`

The onboarding flow has 3 steps. Each step is a screen within the onboarding layout. Use a simple step counter at the top (e.g. "1 of 3") — no progress bar needed.

```tsx
import { useState } from "react"
import { View } from "react-native"
import { useRouter } from "expo-router"
import { useMutation } from "convex/react"
import { api } from "@/convex/_generated/api"
import { OnboardingStep1 } from "@/components/onboarding/OnboardingStep1"
import { OnboardingStep2 } from "@/components/onboarding/OnboardingStep2"
import { OnboardingStep3 } from "@/components/onboarding/OnboardingStep3"

export default function OnboardingScreen() {
  const router = useRouter()
  const updateProfile = useMutation(api.functions.profiles.updateOnboarding)

  const [step, setStep] = useState(1)
  const [answers, setAnswers] = useState({
    goals: "",
    equipment: [] as string[],
    weightUnit: "kg" as "kg" | "lbs",
    distanceUnit: "km" as "km" | "miles",
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    tonePreference: "friendly",
  })

  const handleNext = (updates: Partial<typeof answers>) => {
    setAnswers(prev => ({ ...prev, ...updates }))
    if (step < 3) {
      setStep(s => s + 1)
    } else {
      handleComplete({ ...answers, ...updates })
    }
  }

  const handleComplete = async (finalAnswers: typeof answers) => {
    await updateProfile({
      goals: finalAnswers.goals,
      equipment: finalAnswers.equipment.join(", "),
      weightUnit: finalAnswers.weightUnit,
      distanceUnit: finalAnswers.distanceUnit,
      timezone: finalAnswers.timezone,
      tonePreference: finalAnswers.tonePreference,
    })
    router.replace("/(app)/chat")
  }

  return (
    <View style={{ flex: 1, backgroundColor: "#000" }}>
      {step === 1 && <OnboardingStep1 onNext={handleNext} />}
      {step === 2 && <OnboardingStep2 onNext={handleNext} />}
      {step === 3 && <OnboardingStep3 answers={answers} onNext={handleNext} />}
    </View>
  )
}
```

### 2. Step Components

`components/onboarding/OnboardingStep1.tsx` — Goals

Eco asks: "What are you training for?" Free text input. Skip option ("I'll figure it out").

```tsx
interface Props {
  onNext: (updates: { goals: string }) => void
}

export function OnboardingStep1({ onNext }: Props) {
  const [goals, setGoals] = useState("")

  return (
    <SafeAreaView style={{ flex: 1, padding: 24 }}>
      <Text style={{ color: "#666", fontSize: 13, marginBottom: 32 }}>1 of 3</Text>

      {/* Eco's "message" */}
      <View style={{ marginBottom: 32 }}>
        <Text style={{ color: "#fff", fontSize: 22, fontWeight: "600", lineHeight: 30 }}>
          Hey! I'm Eco.{"\n"}What are you training for?
        </Text>
        <Text style={{ color: "#666", fontSize: 15, marginTop: 8 }}>
          Build muscle, lose weight, get stronger — anything goes.
        </Text>
      </View>

      <TextInput
        value={goals}
        onChangeText={setGoals}
        placeholder="e.g. Build muscle and get stronger"
        placeholderTextColor="#444"
        multiline
        style={{
          backgroundColor: "#111",
          borderRadius: 12,
          padding: 16,
          color: "#fff",
          fontSize: 16,
          minHeight: 80,
        }}
      />

      <View style={{ marginTop: 24, gap: 12 }}>
        <Pressable
          onPress={() => onNext({ goals })}
          style={{ backgroundColor: "#fff", borderRadius: 12, padding: 16, alignItems: "center" }}
        >
          <Text style={{ color: "#000", fontWeight: "600", fontSize: 16 }}>Continue</Text>
        </Pressable>
        <Pressable onPress={() => onNext({ goals: "" })} style={{ alignItems: "center", padding: 12 }}>
          <Text style={{ color: "#555", fontSize: 15 }}>Skip for now</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  )
}
```

`components/onboarding/OnboardingStep2.tsx` — Equipment

Multi-select chips. User taps what they have access to.

```tsx
const EQUIPMENT_OPTIONS = [
  "Barbell", "Dumbbells", "Cables", "Bodyweight",
  "Kettlebells", "Rings", "Resistance Bands", "Pull-up Bar"
]

interface Props {
  onNext: (updates: { equipment: string[] }) => void
}

export function OnboardingStep2({ onNext }: Props) {
  const [selected, setSelected] = useState<string[]>([])

  const toggle = (item: string) => {
    setSelected(prev =>
      prev.includes(item) ? prev.filter(i => i !== item) : [...prev, item]
    )
  }

  return (
    <SafeAreaView style={{ flex: 1, padding: 24 }}>
      <Text style={{ color: "#666", fontSize: 13, marginBottom: 32 }}>2 of 3</Text>

      <Text style={{ color: "#fff", fontSize: 22, fontWeight: "600", marginBottom: 8 }}>
        What equipment do you have?
      </Text>
      <Text style={{ color: "#666", fontSize: 15, marginBottom: 32 }}>
        Select all that apply. Eco uses this to understand your workouts better.
      </Text>

      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
        {EQUIPMENT_OPTIONS.map(item => (
          <Pressable
            key={item}
            onPress={() => toggle(item)}
            style={{
              paddingHorizontal: 16,
              paddingVertical: 10,
              borderRadius: 20,
              borderWidth: 1,
              borderColor: selected.includes(item) ? "#fff" : "#333",
              backgroundColor: selected.includes(item) ? "#fff" : "transparent",
            }}
          >
            <Text style={{ color: selected.includes(item) ? "#000" : "#888", fontSize: 14 }}>
              {item}
            </Text>
          </Pressable>
        ))}
      </View>

      <View style={{ marginTop: "auto", gap: 12 }}>
        <Pressable
          onPress={() => onNext({ equipment: selected })}
          style={{ backgroundColor: "#fff", borderRadius: 12, padding: 16, alignItems: "center" }}
        >
          <Text style={{ color: "#000", fontWeight: "600", fontSize: 16 }}>Continue</Text>
        </Pressable>
        <Pressable onPress={() => onNext({ equipment: [] })} style={{ alignItems: "center", padding: 12 }}>
          <Text style={{ color: "#555", fontSize: 15 }}>Skip</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  )
}
```

`components/onboarding/OnboardingStep3.tsx` — Units + Tone

Auto-detect units from locale. Show what was detected and let user confirm or switch. Then ask tone preference.

```tsx
interface Props {
  answers: { weightUnit: "kg" | "lbs"; distanceUnit: "km" | "miles"; tonePreference: string; timezone: string }
  onNext: (updates: { weightUnit: "kg" | "lbs"; distanceUnit: "km" | "miles"; tonePreference: string }) => void
}

export function OnboardingStep3({ answers, onNext }: Props) {
  const [weightUnit, setWeightUnit] = useState<"kg" | "lbs">(answers.weightUnit)
  const [distanceUnit, setDistanceUnit] = useState<"km" | "miles">(answers.distanceUnit)
  const [tone, setTone] = useState(answers.tonePreference)

  const TONE_OPTIONS = [
    { value: "friendly", label: "Chill & friendly" },
    { value: "motivating", label: "Push me harder" },
    { value: "direct", label: "Just the facts" },
  ]

  return (
    <SafeAreaView style={{ flex: 1, padding: 24 }}>
      <Text style={{ color: "#666", fontSize: 13, marginBottom: 32 }}>3 of 3</Text>

      <Text style={{ color: "#fff", fontSize: 22, fontWeight: "600", marginBottom: 32 }}>
        A couple more things
      </Text>

      {/* Units */}
      <Text style={{ color: "#888", fontSize: 13, marginBottom: 12, textTransform: "uppercase", letterSpacing: 0.5 }}>
        Units
      </Text>
      <View style={{ flexDirection: "row", gap: 10, marginBottom: 28 }}>
        {(["kg", "lbs"] as const).map(unit => (
          <Pressable
            key={unit}
            onPress={() => setWeightUnit(unit)}
            style={{
              paddingHorizontal: 20, paddingVertical: 10, borderRadius: 20,
              borderWidth: 1,
              borderColor: weightUnit === unit ? "#fff" : "#333",
              backgroundColor: weightUnit === unit ? "#fff" : "transparent",
            }}
          >
            <Text style={{ color: weightUnit === unit ? "#000" : "#888" }}>{unit}</Text>
          </Pressable>
        ))}
        {(["km", "miles"] as const).map(unit => (
          <Pressable
            key={unit}
            onPress={() => setDistanceUnit(unit)}
            style={{
              paddingHorizontal: 20, paddingVertical: 10, borderRadius: 20,
              borderWidth: 1,
              borderColor: distanceUnit === unit ? "#fff" : "#333",
              backgroundColor: distanceUnit === unit ? "#fff" : "transparent",
            }}
          >
            <Text style={{ color: distanceUnit === unit ? "#000" : "#888" }}>{unit}</Text>
          </Pressable>
        ))}
      </View>

      {/* Tone */}
      <Text style={{ color: "#888", fontSize: 13, marginBottom: 12, textTransform: "uppercase", letterSpacing: 0.5 }}>
        How should Eco talk to you?
      </Text>
      <View style={{ gap: 10, marginBottom: 32 }}>
        {TONE_OPTIONS.map(option => (
          <Pressable
            key={option.value}
            onPress={() => setTone(option.value)}
            style={{
              padding: 14, borderRadius: 12,
              borderWidth: 1,
              borderColor: tone === option.value ? "#fff" : "#222",
              backgroundColor: tone === option.value ? "#111" : "transparent",
            }}
          >
            <Text style={{ color: tone === option.value ? "#fff" : "#666", fontSize: 15 }}>
              {option.label}
            </Text>
          </Pressable>
        ))}
      </View>

      <Pressable
        onPress={() => onNext({ weightUnit, distanceUnit, tonePreference: tone })}
        style={{ backgroundColor: "#fff", borderRadius: 12, padding: 16, alignItems: "center" }}
      >
        <Text style={{ color: "#000", fontWeight: "600", fontSize: 16 }}>Start training</Text>
      </Pressable>
    </SafeAreaView>
  )
}
```

### 3. Profile Update Mutation

`convex/functions/profiles.ts` — add:

```ts
export const updateOnboarding = mutation({
  args: {
    goals: v.string(),
    equipment: v.string(),
    weightUnit: v.union(v.literal("kg"), v.literal("lbs")),
    distanceUnit: v.union(v.literal("km"), v.literal("miles")),
    timezone: v.string(),
    tonePreference: v.string(),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) throw new Error("Not authenticated")

    const profile = await ctx.db
      .query("profiles")
      .withIndex("by_userId", q => q.eq("userId", identity.subject as any))
      .first()
    if (!profile) throw new Error("Profile not found")

    await ctx.db.patch(profile._id, args)
  },
})
```

### 4. Auto-Detect Units from Locale

In the onboarding screen's initial state, detect the user's locale to pre-select units:

```ts
function detectUnitsFromLocale(): { weightUnit: "kg" | "lbs"; distanceUnit: "km" | "miles" } {
  const locale = Intl.DateTimeFormat().resolvedOptions().locale
  const isUS = locale.includes("US") || locale.includes("us")
  return {
    weightUnit: isUS ? "lbs" : "kg",
    distanceUnit: isUS ? "miles" : "km",
  }
}
```

Use this to initialise the `answers` state in the onboarding screen.

### 5. Update `isOnboarded` Check

In `hooks/useAuth.ts`, the `isOnboarded` check from Phase 3 may need updating now that we know what onboarding actually sets. Update:

```ts
const isOnboarded = isSignedIn && profile.timezone !== "UTC"
// timezone is set during onboarding step 3 — if it's still "UTC", onboarding hasn't completed
```

---

## Done Checklist

- [ ] New user (clear profile in dashboard) → sees onboarding, not chat screen
- [ ] Step 1: Can type goals and continue, or skip
- [ ] Step 2: Can select equipment chips and continue, or skip
- [ ] Step 3: Units pre-populated from locale (UK phone shows kg/km, US phone shows lbs/miles)
- [ ] Step 3: Tone selection works
- [ ] Completing step 3 → `profiles` row updated in Convex dashboard with all fields
- [ ] After completion → lands on chat screen
- [ ] Returning user (timezone !== "UTC") → goes straight to chat, never sees onboarding
- [ ] `npx tsc --noEmit` reports zero errors

---

## What Not to Do in This Phase

- Do not add more than 3 steps — it will kill conversion
- Do not make any step mandatory (skip buttons everywhere)
- Do not ask for `skillLevel` or `trainingPattern` — Eco learns these
- Do not build a back button in the onboarding flow

---

## Next Phase

Phase 9 — RevenueCat + Paywall: token gate, subscription state, paywall UI.
