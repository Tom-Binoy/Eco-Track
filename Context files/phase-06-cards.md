# Eco Track — Phase 6: Cards

> Load alongside: `_context.md`, `Turn-Lifecycle-Specification.md`
> Depends on: Phase 4 (chat UI), Phase 5 (Gemini writes cards to DB)
> Done when: Workout cards render in the chat, pending cards can be confirmed or edited, confirmed cards show correctly, Ask Eco sets `inDiscussion`, and the active discussion can be explicitly returned to the deck from the chat input

---

## Objective

Build the workout card UI and wire up all card behavior. Cards appear inline in the chat — attached to the message that generated them. The design for cards has already been created. Build to that design.

Read Turn Lifecycle §5 (Cards behavior) carefully before starting. The state transitions are specific and must not be improvised.

---

## Card States (locked)

| State | Meaning | User actions available |
|---|---|---|
| `pending` | Gemini wasn't confident — needs user confirmation | Confirm, Edit, Ask Eco |
| `confirmed` | Logged and saved | Ask Eco (triggers re-confirm on correction) |
| `inDiscussion: true` | Ask Eco is active on this card | Reply in chat; use the input-area **Back to deck** banner to close it |

There is no "editing" state. Manual edits are instant and local — user edits a field, taps confirm, done. No intermediate state.

---

## What to Build

### 1. Types

`types/cards.ts`

```ts
export type CardState = "pending" | "confirmed"

export interface ParsedSet {
  reps?: number
  weight?: number
  duration?: number
  distance?: number
}

export interface ParsedExercise {
  name: string
  sets: ParsedSet[]
  order: number
}

export interface ParsedBlock {
  type: "standard" | "superset" | "dropset" | "emom" | "pyramid" | "circuit" | "amrap"
  exercises: ParsedExercise[]
  intervalSeconds?: number
  order: number
}

export interface ParsedData {
  blocks: ParsedBlock[]
  needsClarification: boolean
}
```

### 2. Card Component

`components/cards/WorkoutCard.tsx`

This is the main card component. It renders all blocks and exercises from `parsedData`, and handles confirm/edit/Ask Eco actions.

```tsx
import { View, Text, Pressable, TextInput } from "react-native"
import { useState } from "react"
import type { Card } from "@/types/db"
import type { ParsedData, ParsedExercise, ParsedSet } from "@/types/cards"
import { useMutation } from "convex/react"
import { api } from "@/convex/_generated/api"

interface Props {
  card: Card
  onAskEco: (cardId: string) => void
}

export function WorkoutCard({ card, onAskEco }: Props) {
  const parsedData = card.parsedData as ParsedData
  const [localData, setLocalData] = useState<ParsedData>(parsedData)
  const [isEditing, setIsEditing] = useState(false)

  const confirmCard = useMutation(api.functions.cards.confirmCard)
  const patchCard = useMutation(api.functions.cards.patchCard)

  const isPending = card.state === "pending"
  const isConfirmed = card.state === "confirmed"
  const inDiscussion = card.inDiscussion

  const handleConfirm = async () => {
    await confirmCard({ cardId: card._id, parsedData: localData })
  }

  const handleExerciseNameChange = (blockIdx: number, exIdx: number, name: string) => {
    setLocalData(prev => {
      const next = { ...prev }
      next.blocks[blockIdx].exercises[exIdx].name = name
      return next
    })
  }

  const handleSetChange = (blockIdx: number, exIdx: number, setIdx: number, field: keyof ParsedSet, value: string) => {
    const num = parseFloat(value)
    setLocalData(prev => {
      const next = { ...prev }
      next.blocks[blockIdx].exercises[exIdx].sets[setIdx] = {
        ...next.blocks[blockIdx].exercises[exIdx].sets[setIdx],
        [field]: isNaN(num) ? undefined : num,
      }
      return next
    })
  }

  return (
    <View style={{
      backgroundColor: "#111",
      borderRadius: 12,
      padding: 14,
      marginTop: 8,
      borderWidth: isPending ? 1 : 0,
      borderColor: isPending ? "#444" : "transparent",
    }}>
      {/* Header */}
      <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 12 }}>
        <Text style={{ color: "#888", fontSize: 12, textTransform: "uppercase", letterSpacing: 0.5 }}>
          {isPending ? "Confirm workout" : "Logged"}
        </Text>
        {inDiscussion && (
          <Text style={{ color: "#888", fontSize: 12 }}>Discussing with Eco...</Text>
        )}
      </View>

      {/* Blocks */}
      {localData.blocks.map((block, blockIdx) => (
        <View key={blockIdx} style={{ marginBottom: 12 }}>
          {block.type !== "standard" && (
            <Text style={{ color: "#666", fontSize: 11, marginBottom: 6, textTransform: "uppercase" }}>
              {block.type}
            </Text>
          )}
          {block.exercises.map((exercise, exIdx) => (
            <ExerciseRow
              key={exIdx}
              exercise={exercise}
              isEditing={isEditing}
              onNameChange={(name) => handleExerciseNameChange(blockIdx, exIdx, name)}
              onSetChange={(setIdx, field, value) => handleSetChange(blockIdx, exIdx, setIdx, field, value)}
            />
          ))}
        </View>
      ))}

      {/* Actions */}
      <View style={{ flexDirection: "row", gap: 8, marginTop: 8 }}>
        {isPending && (
          <Pressable
            onPress={handleConfirm}
            style={{ flex: 1, backgroundColor: "#fff", borderRadius: 8, padding: 10, alignItems: "center" }}
          >
            <Text style={{ color: "#000", fontWeight: "600", fontSize: 14 }}>Confirm</Text>
          </Pressable>
        )}
        <Pressable
          onPress={() => setIsEditing(!isEditing)}
          style={{ paddingHorizontal: 14, paddingVertical: 10, borderRadius: 8, backgroundColor: "#1a1a1a" }}
        >
          <Text style={{ color: "#fff", fontSize: 14 }}>{isEditing ? "Done" : "Edit"}</Text>
        </Pressable>
        {!inDiscussion && (
          <Pressable
            onPress={() => onAskEco(card._id)}
            style={{ paddingHorizontal: 14, paddingVertical: 10, borderRadius: 8, backgroundColor: "#1a1a1a" }}
          >
            <Text style={{ color: "#fff", fontSize: 14 }}>Ask Eco</Text>
          </Pressable>
        )}
      </View>
    </View>
  )
}
```

#### `ExerciseRow` sub-component

Renders one exercise with its sets. In editing mode, fields are editable. In normal mode, they're read-only.

```tsx
interface ExerciseRowProps {
  exercise: ParsedExercise
  isEditing: boolean
  onNameChange: (name: string) => void
  onSetChange: (setIdx: number, field: keyof ParsedSet, value: string) => void
}

function ExerciseRow({ exercise, isEditing, onNameChange, onSetChange }: ExerciseRowProps) {
  return (
    <View style={{ marginBottom: 8 }}>
      {isEditing ? (
        <TextInput
          value={exercise.name}
          onChangeText={onNameChange}
          style={{ color: "#fff", fontSize: 15, fontWeight: "600", borderBottomWidth: 1, borderBottomColor: "#333", paddingVertical: 4, marginBottom: 6 }}
        />
      ) : (
        <Text style={{ color: "#fff", fontSize: 15, fontWeight: "600", marginBottom: 6 }}>
          {exercise.name}
        </Text>
      )}

      {exercise.sets.map((set, setIdx) => (
        <SetRow
          key={setIdx}
          set={set}
          setNumber={setIdx + 1}
          isEditing={isEditing}
          onChange={(field, value) => onSetChange(setIdx, field, value)}
        />
      ))}
    </View>
  )
}
```

#### `SetRow` sub-component

Renders one set. Shows reps, weight, duration, or distance depending on what's present.

```tsx
interface SetRowProps {
  set: ParsedSet
  setNumber: number
  isEditing: boolean
  onChange: (field: keyof ParsedSet, value: string) => void
}

function SetRow({ set, setNumber, isEditing, onChange }: SetRowProps) {
  const parts = []
  if (set.reps !== undefined) parts.push({ field: "reps" as const, value: set.reps, suffix: "reps" })
  if (set.weight !== undefined) parts.push({ field: "weight" as const, value: set.weight, suffix: "kg" })
  if (set.duration !== undefined) parts.push({ field: "duration" as const, value: set.duration, suffix: "s" })
  if (set.distance !== undefined) parts.push({ field: "distance" as const, value: set.distance, suffix: "km" })

  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 4 }}>
      <Text style={{ color: "#666", fontSize: 13, width: 20 }}>{setNumber}</Text>
      {parts.map(({ field, value, suffix }) => (
        <View key={field} style={{ flexDirection: "row", alignItems: "center", gap: 2 }}>
          {isEditing ? (
            <TextInput
              value={String(value)}
              onChangeText={(v) => onChange(field, v)}
              keyboardType="numeric"
              style={{ color: "#fff", fontSize: 14, borderBottomWidth: 1, borderBottomColor: "#444", minWidth: 32, textAlign: "center" }}
            />
          ) : (
            <Text style={{ color: "#ccc", fontSize: 14 }}>{value}</Text>
          )}
          <Text style={{ color: "#555", fontSize: 13 }}>{suffix}</Text>
        </View>
      ))}
    </View>
  )
}
```

### 3. Card Mutations

`convex/functions/cards.ts`

**`confirmCard`** — promotes a pending card to confirmed, writes sessions/blocks/exercises:

```ts
export const confirmCard = mutation({
  args: {
    cardId: v.id("cards"),
    parsedData: v.any(),
  },
  handler: async (ctx, { cardId, parsedData }) => {
    const card = await ctx.db.get(cardId)
    if (!card || card.state !== "pending") return

    const identity = await ctx.auth.getUserIdentity()
    if (!identity) throw new Error("Not authenticated")

    const profile = await ctx.db
      .query("profiles")
      .withIndex("by_userId", q => q.eq("userId", identity.subject as any))
      .first()
    if (!profile) throw new Error("Profile not found")

    const today = new Date().toISOString().split("T")[0]

    // Find or create session
    let session = await ctx.db
      .query("sessions")
      .withIndex("by_user_date", q => q.eq("userId", profile._id).eq("date", today))
      .first()

    if (!session) {
      const sid = await ctx.db.insert("sessions", {
        userId: profile._id,
        date: today,
        createdAt: Date.now(),
      })
      session = await ctx.db.get(sid)
    }

    const sessionId = session!._id

    // Write blocks + exercises
    for (const block of parsedData.blocks) {
      const blockId = await ctx.db.insert("blocks", {
        sessionId,
        userId: profile._id,
        types: [block.type],
        intervalSeconds: block.intervalSeconds,
        order: block.order,
        createdAt: Date.now(),
      })
      for (const exercise of block.exercises) {
        await ctx.db.insert("exercises", {
          blockId,
          userId: profile._id,
          name: exercise.name,
          order: exercise.order,
          sets: exercise.sets,
          createdAt: Date.now(),
        })
      }
    }

    // Flip card to confirmed, backfill sessionId, update parsedData
    await ctx.db.patch(cardId, {
      state: "confirmed",
      sessionId,
      parsedData,
    })
  },
})
```

**`setInDiscussion`** — called when Ask Eco is tapped:

```ts
export const setInDiscussion = mutation({
  args: {
    cardId: v.id("cards"),
    inDiscussion: v.boolean(),
  },
  handler: async (ctx, { cardId, inDiscussion }) => {
    await ctx.db.patch(cardId, { inDiscussion })
  },
})
```

**`patchCardData`** — called when Eco corrects a card mid-discussion:

```ts
export const patchCardData = mutation({
  args: {
    cardId: v.id("cards"),
    parsedData: v.any(),
    rawOutput: v.string(),
  },
  handler: async (ctx, { cardId, parsedData, rawOutput }) => {
    const card = await ctx.db.get(cardId)
    if (!card) return

    await ctx.db.patch(cardId, { parsedData, rawOutput })

    // If card was confirmed, flip back to pending (re-confirm required)
    if (card.state === "confirmed") {
      await ctx.db.patch(cardId, { state: "pending" })
      // Note: do NOT rewrite exercises here — that happens on re-confirm
    }
  },
})
```

### 4. Wire Cards into MessageBubble

`components/chat/MessageBubble.tsx` — update to render a card below the Eco message if one exists:

```tsx
import { WorkoutCard } from "@/components/cards/WorkoutCard"
import { useQuery } from "convex/react"
import { api } from "@/convex/_generated/api"

export function MessageBubble({ message, onAskEco }: Props) {
  const isUser = message.role === "user"

  // Fetch card for this message if it exists
  const card = useQuery(
    api.functions.cards.getByMessage,
    message.messageId ? { messageId: message.messageId } : "skip"
  )

  return (
    <View style={{ alignItems: isUser ? "flex-end" : "flex-start" }}>
      <View ...>
        <Text ...>{message.text}</Text>
      </View>
      {card && !isUser && (
        <WorkoutCard card={card} onAskEco={onAskEco} />
      )}
    </View>
  )
}
```

### 5. Ask Eco Flow

In `ChatScreen`, handle `onAskEco`:

```tsx
const setInDiscussion = useMutation(api.functions.cards.setInDiscussion)

const handleAskEco = async (cardId: string) => {
  await setInDiscussion({ cardId, inDiscussion: true })
  // Card is now pinned — next user message will include it in context
  // The turn lifecycle handles the rest
}
```

The turn lifecycle already handles injecting the pinned card into the next Gemini call (Phase 5, context assembly). A discussion remains active through pure clarification. It closes only when the user explicitly selects **Back to deck** in the input-area discussion banner; that action calls `bringCardBackToDeck`, flips `inDiscussion` to `false`, and writes the one-time `cardContext.closed` UI decoration.

### 6. Bring Card Back to Deck

When a card has `inDiscussion: true`, show a persistent banner directly above the chat text input. It is the sole close affordance for the active discussion card, not a control inside the workout-card sheet.

- Use a clear visual status treatment as well as copy: a tinted banner and active indicator make it obvious that Eco is focused on the card.
- The banner explains that the card is in discussion and exposes a 44×44 px minimum **Back to deck** button.
- The button calls `api.functions.cards.bringCardBackToDeck` with the active card and its source message. Disable it while the mutation is in flight and show a retryable error if the mutation returns one.
- Convex reactivity removes the banner after the mutation writes `inDiscussion: false`; the card returns to its normal deck presentation.

---

## Done Checklist

- [ ] Workout card renders below Eco's message after a logged workout
- [ ] Pending card shows "Confirm workout" header and Confirm button
- [ ] Confirmed card shows "Logged" and no Confirm button
- [ ] Edit button toggles editable fields — name, reps, weight, duration, distance all editable
- [ ] Confirming a pending card writes session/blocks/exercises to Convex
- [ ] Confirming an edited card uses the locally modified data
- [ ] Ask Eco button sets `inDiscussion: true` on the card
- [ ] `inDiscussion` card shows "Discussing with Eco..." and hides Ask Eco button
- [ ] Active discussion shows the visually distinct input-area banner with a Back to deck action
- [ ] Back to deck sets `inDiscussion: false`, writes its one-time `cardContext.closed` entry, and removes the banner
- [ ] Correcting a confirmed card via Ask Eco flips it back to pending
- [ ] `npx tsc --noEmit` reports zero errors
- [ ] Tested end to end: log workout → card appears → edit → confirm → check Convex dashboard

---

## What Not to Do in This Phase

- Do not implement multi-card pinning (v2+)
- Do not build the history screen
- Do not add swipe gestures or animations yet (Phase 10)
- Do not add multi-card discussion controls; V1 supports the single active discussion-card banner only

---

## Next Phase

Phase 7 — Memory + Cron: sessionSummaries compression, daily-check cron, workoutContext updates.
