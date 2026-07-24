import { useAction, useMutation, useQuery } from 'convex/react'
import { useCallback, useMemo, useState } from 'react'

import { api } from '@/convex/_generated/api'
import type { Card } from '@/types/db'
import type { ChatMessage } from '@/types/chat'

interface UseChatResult {
  discussionCard: Card | null | undefined
  isLoading: boolean
  messages: ChatMessage[]
  sendMessage: (text: string) => Promise<void>
}

export function useChat(): UseChatResult {
  const [isLoading, setIsLoading] = useState(false)
  const getOrCreateTodayChat = useMutation(api.functions.chats.getOrCreateTodayChat)
  const processTurn = useAction(api.functions.messages.processTurn)
  const chat = useQuery(api.functions.chats.getMyTodayChat)
  const messageResult = useQuery(
    api.functions.messages.getRecent,
    chat === undefined || chat === null ? 'skip' : { chatId: chat._id, limit: 50 },
  )
  const discussionCard = useQuery(
    api.functions.cards.getDiscussionCard,
    chat === undefined || chat === null ? 'skip' : { chatId: chat._id },
  )
  const messages = useMemo<ChatMessage[]>(() => {
    const storedMessages = messageResult?.messages ?? []

    return storedMessages.flatMap((message) => [
      {
        id: `${message._id}-user`,
        messageId: message._id,
        role: 'user' as const,
        text: message.userText,
        timestamp: message.timestamp,
      },
      {
        id: `${message._id}-eco`,
        messageId: message._id,
        role: 'eco' as const,
        text: message.ecoText,
        timestamp: message.timestamp,
      },
    ])
  }, [messageResult])

  const sendMessage = useCallback(async (text: string): Promise<void> => {
    setIsLoading(true)

    try {
      const result = await getOrCreateTodayChat({})
      if ('error' in result) {
        return
      }

      await processTurn({ chatId: result.chatId, userText: text })
    } finally {
      setIsLoading(false)
    }
  }, [getOrCreateTodayChat, processTurn])

  return { discussionCard, isLoading, messages, sendMessage }
}
