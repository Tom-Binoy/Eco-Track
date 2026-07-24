# Eco Track — Phase 5: Gemini Integration

> Load alongside: `_context.md`, `Turn-Lifecycle-Specification.md`, `Final-Schema.md`
> Depends on: Phase 2 (schema), Phase 3 (auth — userId available), Phase 4 (chat UI — sendMessage exists)
> Done when: User sends a workout message, Gemini parses it, message is written to Convex, and Eco responds conversationally. The full turn lifecycle runs end to end.

---

## Objective

Replace the Phase 4 placeholder response with the full Gemini turn lifecycle. This is the most complex phase. Read the Turn Lifecycle Specification in full before writing any code. Every section of that spec maps directly to code in this phase.

The turn lifecycle runs as a **Convex action** (not a mutation) because it calls an external API (Gemini). Actions can call mutations internally.

---

## What to Build

### Overview of the call chain

```
ChatInput (user sends message)
  → useChat.sendMessage()
    → Convex action: processTurn()
      → 1. Context assembly (queries)
      → 2. Gemini API call
      → 3. Zod validation
      → 4. Write branch (mutation)
        → High confidence: sessions + blocks + exercises + confirmed card
        → Low confidence: pending card only
      → 5. Return { ecoText, cardId? }
    → useChat updates messages state
```

---

### 1. Convex Action: `processTurn`

`convex/functions/messages.ts`

This is the heart of the app. It must follow the Turn Lifecycle Specification exactly.

```ts
// convex/functions/messages.ts
import { action } from "../_generated/server"
import { v } from "convex/values"
import { api } from "../_generated/api"
import { assembleContext } from "../lib/context"
import { callGemini } from "../lib/gemini"
import { validateToolCall } from "../lib/validation"
import { writeHighConfidence, writeLowConfidence } from "./writeHelpers"

export const processTurn = action({
  args: {
    chatId: v.id("chats"),
    userText: v.string(),
  },
  handler: async (ctx, { chatId, userText }): Promise<{
    ecoText: string
    cardId?: string
  }> => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) throw new Error("Not authenticated")

    // Step 1: Context assembly
    const context = await assembleContext(ctx, chatId, identity.subject)

    // Step 2: Gemini call
    const geminiResponse = await callGemini(context, userText)

    // Step 3: Determine branch
    const hasFunctionCall = geminiResponse.functionCall !== null

    // Write the message row (always, regardless of branch)
    const messageId = await ctx.runMutation(api.functions.messages.writeMessage, {
      chatId,
      userText,
      ecoText: geminiResponse.text,
      // sessionId set later if high confidence
    })

    if (!hasFunctionCall) {
      // Conversational turn — done
      return { ecoText: geminiResponse.text }
    }

    // Step 3: Zod validation
    const { isValid, parsedData } = validateToolCall(geminiResponse.functionCall.args)
    const needsClarification = geminiResponse.functionCall.args.needsClarification ?? false

    // Effective confidence: pass + !needsClarification = high; everything else = low
    const isHighConfidence = isValid && !needsClarification

    if (isHighConfidence) {
      const { sessionId, cardId } = await ctx.runMutation(
        api.functions.messages.writeHighConfidenceTurn,
        { chatId, messageId, parsedData, userId: context.profile._id }
      )
      await ctx.runMutation(api.functions.messages.setMessageSession, {
        messageId,
        sessionId,
      })
      return { ecoText: geminiResponse.text, cardId }
    } else {
      const { cardId } = await ctx.runMutation(
        api.functions.messages.writeLowConfidenceTurn,
        { chatId, messageId, parsedData, rawOutput: JSON.stringify(geminiResponse.functionCall.args) }
      )
      return { ecoText: geminiResponse.text, cardId }
    }
  },
})
```

### 2. Context Assembly

`convex/lib/context.ts`

Assembles everything Gemini needs before the call. Follows Turn Lifecycle §1 exactly.

```ts
export async function assembleContext(ctx, chatId, authUserId) {
  // 1. Get profile
  const profile = await ctx.runQuery(api.functions.profiles.getByAuthUserId, { authUserId })
  if (!profile) throw new Error("Profile not found")

  // 2. Check cached context on the chat
  const chat = await ctx.runQuery(api.functions.chats.getById, { chatId })
  let cachedContext = null
  if (chat.cachedContext && chat.cachedContextAt) {
    const today = new Date().toISOString().split("T")[0]
    const cachedDate = new Date(chat.cachedContextAt).toISOString().split("T")[0]
    if (cachedDate === today) {
      cachedContext = chat.cachedContext
    }
  }

  // 3. Get workoutContext (use cache if fresh, else query)
  const workoutContext = cachedContext?.workoutContext
    ?? await ctx.runQuery(api.functions.workoutContext.getLatest, { userId: profile._id })

  // 4. Get recent messages (always fresh)
  const recentMessages = await ctx.runQuery(api.functions.messages.getRecent, { chatId, limit: 20 })

  // 5. Get ordered message blocks for every raw message in the turn window.
  // Include text, tool calls, and tool results when constructing Gemini history,
  // even if a prior tool failed or its output was invalid. Never query apiUsage
  // for prompt assembly.
  const messageBlocks = await ctx.runQuery(
    api.functions.messageBlocks.getForMessages,
    { messageIds: recentMessages.map(message => message._id) }
  )

  // 6. Get sessionSummaries if needed (check token estimate)
  const sessionSummaries = await ctx.runQuery(
    api.functions.sessionSummaries.getForChat, { chatId }
  )

  // 7. Get pinned cards (from latest message's cardContext)
  const latestMessage = recentMessages[recentMessages.length - 1]
  const pinnedCards = []
  if (latestMessage?.cardContext) {
    const openCards = latestMessage.cardContext.filter(c => !c.closed)
    for (const entry of openCards) {
      const card = await ctx.runQuery(api.functions.cards.getById, { cardId: entry.cardId })
      if (card) pinnedCards.push({ label: `Card ${entry.order}`, card })
    }
  }

  // 8. Build and cache if no cache existed
  if (!cachedContext) {
    await ctx.runMutation(api.functions.chats.setCachedContext, {
      chatId,
      cachedContext: { workoutContext },
      cachedContextAt: Date.now(),
    })
  }

  return {
    profile,
    workoutContext,
    recentMessages,
    messageBlocks,
    sessionSummaries,
    pinnedCards,
  }
}
```

### 3. Gemini Call

`convex/lib/gemini.ts`

The Gemini call uses function calling with a `log_workout` tool. `responseSchema` is set to constrain the text response format.

```ts
import { GoogleGenerativeAI, FunctionCallingMode } from "@google/generative-ai"

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!)

const LOG_WORKOUT_TOOL = {
  name: "log_workout",
  description: "Extract and log structured workout data from the user's message",
  parameters: {
    type: "object",
    properties: {
      blocks: {
        type: "array",
        items: {
          type: "object",
          properties: {
            type: {
              type: "string",
              enum: ["standard", "superset", "dropset", "emom", "pyramid", "circuit", "amrap"]
            },
            exercises: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  name: { type: "string" },
                  sets: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        reps: { type: "number" },
                        weight: { type: "number" },
                        duration: { type: "number" },
                        distance: { type: "number" },
                      }
                    }
                  },
                  order: { type: "number" }
                },
                required: ["name", "sets", "order"]
              }
            },
            intervalSeconds: { type: "number" },
            order: { type: "number" }
          },
          required: ["type", "exercises", "order"]
        }
      },
      needsClarification: {
        type: "boolean",
        description: "true if the model is uncertain about the parse and wants user confirmation"
      }
    },
    required: ["blocks", "needsClarification"]
  }
}

export async function callGemini(context, userText: string) {
  const model = genAI.getGenerativeModel({
    model: "gemini-1.5-flash",
    tools: [{ functionDeclarations: [LOG_WORKOUT_TOOL] }],
    toolConfig: { functionCallingMode: FunctionCallingMode.AUTO },
  })

  const systemPrompt = buildSystemPrompt(context)
  const history = buildHistory(context.recentMessages)

  const chat = model.startChat({
    history,
    systemInstruction: systemPrompt,
  })

  const result = await chat.sendMessage(userText)
  const response = result.response

  const functionCall = response.functionCalls()?.[0] ?? null
  const text = response.text()

  return { functionCall, text }
}

function buildSystemPrompt(context) {
  const { profile, workoutContext, pinnedCards } = context

  let prompt = `You are Eco, a conversational workout companion. You are direct, warm, and observant — you notice real things, not generic things.

User profile:
- Name: ${profile.name}
- Equipment: ${profile.equipment || "not set"}
- Goals: ${profile.goals || "not set"}
- Training pattern: ${profile.trainingPattern || "not set"}
- Weight unit preference: ${profile.weightUnit}
- Tone preference: ${profile.tonePreference}

`

  if (workoutContext) {
    prompt += `Recent context:
- Current focus: ${workoutContext.content.currentFocus}
- Recent progress: ${workoutContext.content.recentProgress}
- Consistency: ${workoutContext.content.consistency}
- Notable achievements: ${workoutContext.content.notableAchievements}
- Considerations: ${workoutContext.content.considerations}

`
  }

  if (pinnedCards.length > 0) {
    prompt += `Active workout cards:\n`
    for (const { label, card } of pinnedCards) {
      prompt += `${label}: ${card.rawOutput}\n`
    }
    prompt += "\n"
  }

  prompt += `Rules:
- If the user's message contains workout data, call log_workout to extract it
- If uncertain about the parse, set needsClarification: true
- Keep responses short — this is a chat, not an essay
- Never be generic. Notice something specific about what they did or said.
- All weights in ${profile.weightUnit}`

  return prompt
}

function buildHistory(recentMessages) {
  return recentMessages.map(msg => ({
    role: msg.userText ? "user" : "model",
    parts: [{ text: msg.userText || msg.ecoText }]
  }))
}
```

### 4. Zod Validation

`convex/lib/validation.ts`

```ts
import { z } from "zod"

const SetSchema = z.object({
  reps: z.number().int().min(1).max(10000).optional(),
  weight: z.number().min(0).max(10000).optional(),
  duration: z.number().min(0).optional(),
  distance: z.number().min(0).optional(),
})

const ExerciseSchema = z.object({
  name: z.string().min(1).max(200),
  sets: z.array(SetSchema).min(1),
  order: z.number().int().min(0),
})

const BlockSchema = z.object({
  type: z.enum(["standard", "superset", "dropset", "emom", "pyramid", "circuit", "amrap"]),
  exercises: z.array(ExerciseSchema).min(1),
  intervalSeconds: z.number().optional(),
  order: z.number().int().min(0),
})

const ToolCallSchema = z.object({
  blocks: z.array(BlockSchema).min(1),
  needsClarification: z.boolean(),
})

export function validateToolCall(args: unknown): { isValid: boolean; parsedData: any } {
  const result = ToolCallSchema.safeParse(args)
  if (result.success) {
    return { isValid: true, parsedData: result.data }
  }
  return { isValid: false, parsedData: args } // pass raw args through even on failure
}
```

### 5. Write Mutations

`convex/functions/messages.ts` (continued)

**`writeMessage`** — writes the `messages` row:
```ts
export const writeMessage = mutation({
  args: {
    chatId: v.id("chats"),
    userText: v.string(),
    ecoText: v.string(),
  },
  handler: async (ctx, args): Promise<Id<"messages">> => {
    return await ctx.db.insert("messages", {
      ...args,
      timestamp: Date.now(),
    })
  },
})
```

**`writeHighConfidenceTurn`** — creates session + blocks + exercises + confirmed card:
```ts
export const writeHighConfidenceTurn = mutation({
  args: {
    chatId: v.id("chats"),
    messageId: v.id("messages"),
    parsedData: v.any(),
    userId: v.id("profiles"),
  },
  handler: async (ctx, { chatId, messageId, parsedData, userId }) => {
    const today = new Date().toISOString().split("T")[0]

    // Find or create session
    let session = await ctx.db
      .query("sessions")
      .withIndex("by_user_date", q => q.eq("userId", userId).eq("date", today))
      .first()

    if (!session) {
      const sessionId = await ctx.db.insert("sessions", {
        userId,
        date: today,
        createdAt: Date.now(),
      })
      session = await ctx.db.get(sessionId)
    }

    const sessionId = session!._id
    let cardOrder = 0

    // Write blocks + exercises
    for (const block of parsedData.blocks) {
      const blockId = await ctx.db.insert("blocks", {
        sessionId,
        userId,
        types: [block.type],
        intervalSeconds: block.intervalSeconds,
        order: block.order,
        createdAt: Date.now(),
      })

      for (const exercise of block.exercises) {
        await ctx.db.insert("exercises", {
          blockId,
          userId,
          name: exercise.name,
          order: exercise.order,
          sets: exercise.sets,
          createdAt: Date.now(),
        })
      }
    }

    // Write confirmed card
    const cardId = await ctx.db.insert("cards", {
      chatId,
      messageId,
      sessionId,
      rawOutput: JSON.stringify(parsedData),
      parsedData,
      state: "confirmed",
      order: cardOrder,
      inDiscussion: false,
      createdAt: Date.now(),
    })

    return { sessionId, cardId }
  },
})
```

**`writeLowConfidenceTurn`** — creates pending card only:
```ts
export const writeLowConfidenceTurn = mutation({
  args: {
    chatId: v.id("chats"),
    messageId: v.id("messages"),
    parsedData: v.any(),
    rawOutput: v.string(),
  },
  handler: async (ctx, { chatId, messageId, parsedData, rawOutput }) => {
    const cardId = await ctx.db.insert("cards", {
      chatId,
      messageId,
      rawOutput,
      parsedData,
      state: "pending",
      order: 0,
      inDiscussion: false,
      createdAt: Date.now(),
    })
    return { cardId }
  },
})
```

### 6. Update `useChat` Hook

`hooks/useChat.ts` — replace the placeholder with the real action call:

```ts
import { useAction, useQuery } from "convex/react"
import { api } from "@/convex/_generated/api"
import { useState, useCallback } from "react"
import { useAuth } from "./useAuth"

export function useChat(chatId: string) {
  const [isLoading, setIsLoading] = useState(false)
  const processTurn = useAction(api.functions.messages.processTurn)
  const messages = useQuery(api.functions.messages.getRecent, { chatId, limit: 50 })

  const sendMessage = useCallback(async (text: string) => {
    setIsLoading(true)
    try {
      await processTurn({ chatId, userText: text })
    } finally {
      setIsLoading(false)
    }
  }, [chatId, processTurn])

  return { messages: messages ?? [], sendMessage, isLoading }
}
```

Messages now come from Convex reactively — the list updates automatically when the action writes to the DB.

### 7. `apiUsage` Logging

Every Gemini call must log token usage. These records are exclusively for
backend cost/paywall accounting and must never be passed to Gemini in a later
turn. After the Gemini response, in `processTurn`:

```ts
// Log token usage
const usageMetadata = result.response.usageMetadata
if (usageMetadata) {
  await ctx.runMutation(api.functions.apiUsage.logUsage, {
    userId: context.profile._id,
    tokensUsed: usageMetadata.totalTokenCount ?? 0,
    timestamp: Date.now(),
  })
}
```

`convex/functions/apiUsage.ts`:
```ts
export const logUsage = mutation({
  args: {
    userId: v.id("profiles"),
    tokensUsed: v.number(),
    timestamp: v.number(),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("apiUsage", args)
  },
})
```

---

## Done Checklist

- [ ] "Did 20 pushups" → Gemini parses it → `sessions`, `blocks`, `exercises`, confirmed `cards` row all written to Convex dashboard
- [ ] "How many pushups did I do?" → text-only response, no tool call fired, no card written
- [ ] Ambiguous input → pending `cards` row written, no `sessions`/`blocks`/`exercises`
- [ ] Eco's response appears in the message list (reactive from Convex)
- [ ] `apiUsage` row written after every Gemini call
- [ ] Context assembly pulls from `cachedContext` on second message of same chat
- [ ] `npx tsc --noEmit` reports zero errors
- [ ] Gemini API key is in Convex environment variables (not in code)

---

## What Not to Do in This Phase

- Do not build card UI (Phase 6) — cards are written to DB but not shown in UI yet
- Do not build the cron system (Phase 7)
- Do not add the paywall token gate (Phase 9)
- Do not add sessionSummaries compression yet — stub it out, implement in Phase 7

---

## Next Phase

Phase 6 — Cards: workout card UI, pending → confirmed flow, manual edits, Ask Eco.
