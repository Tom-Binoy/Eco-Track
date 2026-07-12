# Eco Track — Phase 4: Chat UI

> Load alongside: `_context.md`
> Depends on: Phase 1 (scaffolding), Phase 3 (auth — user must be signed in to reach this screen)
> Done when: Chat screen renders a message list and input bar, sends and displays messages locally (no AI), and feels right on a real device

---

## Objective

Build the chat screen UI. This is the core screen — the entire app lives here. At the end of this phase, the screen looks and feels right, but AI is not connected yet. Messages are stored locally in component state and displayed in a scrollable list.

The design for this screen has already been created. Build to that design. Priority is: correct structure, correct behavior, mobile feel. Do not invent UI that wasn't designed.

---

## What to Build

### 1. Screen Structure

`app/(app)/chat/index.tsx`

The chat screen has three parts:
- **Header** — Eco's name/avatar, minimal
- **Message list** — scrollable, grows from bottom up (newest at bottom)
- **Input bar** — fixed at bottom, above keyboard

```tsx
import { KeyboardAvoidingView, Platform, View } from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"
import { ChatHeader } from "@/components/chat/ChatHeader"
import { MessageList } from "@/components/chat/MessageList"
import { ChatInput } from "@/components/chat/ChatInput"
import { useChat } from "@/hooks/useChat"

export default function ChatScreen() {
  const { messages, sendMessage, isLoading } = useChat()

  return (
    <SafeAreaView style={{ flex: 1 }} edges={["top"]}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        keyboardVerticalOffset={0}
      >
        <ChatHeader />
        <MessageList messages={messages} />
        <ChatInput onSend={sendMessage} isLoading={isLoading} />
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}
```

### 2. Types

`types/chat.ts`

```ts
export type MessageRole = "user" | "eco"

export interface ChatMessage {
  id: string
  role: MessageRole
  text: string
  timestamp: number
  cardId?: string       // set when this message has an associated card (Phase 6)
}
```

### 3. `useChat` Hook

`hooks/useChat.ts`

For this phase: local state only. No Convex writes, no Gemini calls.

```ts
import { useState, useCallback } from "react"
import type { ChatMessage } from "@/types/chat"

export function useChat() {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [isLoading, setIsLoading] = useState(false)

  const sendMessage = useCallback(async (text: string) => {
    const userMessage: ChatMessage = {
      id: Date.now().toString(),
      role: "user",
      text,
      timestamp: Date.now(),
    }

    setMessages(prev => [...prev, userMessage])
    setIsLoading(true)

    // Placeholder AI response — replaced in Phase 5
    await new Promise(resolve => setTimeout(resolve, 800))

    const ecoMessage: ChatMessage = {
      id: (Date.now() + 1).toString(),
      role: "eco",
      text: "Got it! (AI coming in Phase 5)",
      timestamp: Date.now(),
    }

    setMessages(prev => [...prev, ecoMessage])
    setIsLoading(false)
  }, [])

  return { messages, sendMessage, isLoading }
}
```

### 4. Components

#### `components/chat/ChatHeader.tsx`

Minimal header — Eco's name and a subtle indicator that this is a fresh session.

```tsx
import { Text, View } from "react-native"

export function ChatHeader() {
  return (
    <View style={{ paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: "#1a1a1a" }}>
      <Text style={{ color: "#fff", fontSize: 16, fontWeight: "600" }}>Eco</Text>
      <Text style={{ color: "#666", fontSize: 12 }}>Your workout companion</Text>
    </View>
  )
}
```

#### `components/chat/MessageList.tsx`

Scrollable list of messages. Newest at bottom. Auto-scrolls to bottom when a new message arrives.

```tsx
import { FlatList, View } from "react-native"
import { useRef, useEffect } from "react"
import type { ChatMessage } from "@/types/chat"
import { MessageBubble } from "./MessageBubble"

interface Props {
  messages: ChatMessage[]
}

export function MessageList({ messages }: Props) {
  const ref = useRef<FlatList>(null)

  useEffect(() => {
    if (messages.length > 0) {
      ref.current?.scrollToEnd({ animated: true })
    }
  }, [messages.length])

  return (
    <FlatList
      ref={ref}
      data={messages}
      keyExtractor={item => item.id}
      renderItem={({ item }) => <MessageBubble message={item} />}
      contentContainerStyle={{ padding: 16, gap: 12 }}
      showsVerticalScrollIndicator={false}
    />
  )
}
```

#### `components/chat/MessageBubble.tsx`

Renders a single message. User messages right-aligned, Eco messages left-aligned.

```tsx
import { Text, View } from "react-native"
import type { ChatMessage } from "@/types/chat"

interface Props {
  message: ChatMessage
}

export function MessageBubble({ message }: Props) {
  const isUser = message.role === "user"

  return (
    <View style={{ alignItems: isUser ? "flex-end" : "flex-start" }}>
      <View
        style={{
          maxWidth: "80%",
          backgroundColor: isUser ? "#fff" : "#1a1a1a",
          borderRadius: 16,
          borderBottomRightRadius: isUser ? 4 : 16,
          borderBottomLeftRadius: isUser ? 16 : 4,
          paddingHorizontal: 14,
          paddingVertical: 10,
        }}
      >
        <Text style={{ color: isUser ? "#000" : "#fff", fontSize: 15, lineHeight: 22 }}>
          {message.text}
        </Text>
      </View>
    </View>
  )
}
```

#### `components/chat/ChatInput.tsx`

Fixed input bar at the bottom. Send on button press or return key. Disabled while loading.

```tsx
import { Pressable, TextInput, View } from "react-native"
import { useState } from "react"

interface Props {
  onSend: (text: string) => void
  isLoading: boolean
}

export function ChatInput({ onSend, isLoading }: Props) {
  const [text, setText] = useState("")

  const handleSend = () => {
    const trimmed = text.trim()
    if (!trimmed || isLoading) return
    onSend(trimmed)
    setText("")
  }

  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "flex-end",
        paddingHorizontal: 12,
        paddingVertical: 12,
        borderTopWidth: 1,
        borderTopColor: "#1a1a1a",
        gap: 8,
      }}
    >
      <TextInput
        value={text}
        onChangeText={setText}
        onSubmitEditing={handleSend}
        placeholder="Message Eco..."
        placeholderTextColor="#666"
        multiline
        style={{
          flex: 1,
          backgroundColor: "#1a1a1a",
          borderRadius: 20,
          paddingHorizontal: 16,
          paddingVertical: 10,
          color: "#fff",
          fontSize: 15,
          maxHeight: 120,
        }}
        returnKeyType="send"
        blurOnSubmit={false}
        editable={!isLoading}
      />
      <Pressable
        onPress={handleSend}
        disabled={!text.trim() || isLoading}
        style={{
          width: 44,
          height: 44,
          borderRadius: 22,
          backgroundColor: text.trim() && !isLoading ? "#fff" : "#333",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Text style={{ color: text.trim() && !isLoading ? "#000" : "#666", fontSize: 18 }}>↑</Text>
      </Pressable>
    </View>
  )
}
```

### 5. Loading Indicator

When `isLoading` is true, show a typing indicator in the message list after the last user message. This is a simple animated dots component:

`components/chat/TypingIndicator.tsx`

Three dots that animate in sequence (opacity pulse). Show this as the last item in `MessageList` when `isLoading` is true. Implementation detail left to Codex — keep it subtle.

---

## Done Checklist

- [ ] Chat screen is the first screen after auth (signed-in + onboarded user lands here)
- [ ] User can type a message and press send
- [ ] Message appears in the list immediately (user bubble, right-aligned)
- [ ] Typing indicator appears while "loading"
- [ ] Eco placeholder response appears after ~800ms
- [ ] List auto-scrolls to the latest message
- [ ] Keyboard does not cover the input bar (KeyboardAvoidingView works on both iOS and Android)
- [ ] Input clears after sending
- [ ] Send button is disabled when input is empty or loading
- [ ] Tested on a real device — scrolling is smooth, keyboard behavior is correct
- [ ] `npx tsc --noEmit` reports zero errors

---

## What Not to Do in This Phase

- Do not connect Gemini (Phase 5)
- Do not write messages to Convex (Phase 5)
- Do not build workout cards (Phase 6)
- Do not add navigation to history or profile screens yet
- Do not build any settings or profile UI

---

## Next Phase

Phase 5 — Gemini Integration: replace the placeholder response with the full turn lifecycle. Messages written to Convex. AI parses workout data.
