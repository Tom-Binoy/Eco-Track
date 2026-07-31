import { useAction, useMutation, useQuery } from 'convex/react'
import { useCallback, useEffect, useMemo, useState } from 'react'

import { api } from '@/convex/_generated/api'
import type { Id } from '@/convex/_generated/dataModel'
import type { Card } from '@/types/db'
import type { ChatMessage } from '@/types/chat'

const responseUnavailableText = 'Eco could not respond right now. Please try again.'

interface UseChatResult {
  discussionCard: Card | null | undefined
  hasFailedTurn: boolean
  isLoading: boolean
  messages: ChatMessage[]
  turnStatus: string | null
  retryMessage: (messageId: Id<'messages'>) => Promise<void>
  sendMessage: (text: string) => Promise<void>
}

export function useChat(): UseChatResult {
  const [isLoading, setIsLoading] = useState(false)
  const [connectionRecovery, setConnectionRecovery] = useState<{ messageId?: Id<'messages'>; startedAt: number } | null>(null)
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
        role: message.ecoText === responseUnavailableText ? 'error' as const : 'eco' as const,
        text: message.ecoText,
        timestamp: message.timestamp,
      },
    ])
  }, [messageResult])
  const hasFailedTurn = (messageResult?.messages.at(-1)?.ecoText ?? '') === responseUnavailableText

  useEffect(() => {
    if (connectionRecovery === null) return
    const hasCompletedResponse = messages.some((message) =>
      message.role !== 'user'
      && message.text.length > 0
      && (connectionRecovery.messageId === undefined
        ? message.timestamp >= connectionRecovery.startedAt
        : message.messageId === connectionRecovery.messageId),
    )
    if (hasCompletedResponse) setConnectionRecovery(null)
  }, [connectionRecovery, messages])

  const turnStatus = connectionRecovery === null
    ? null
    : 'Connection lost. Eco may still be responding — please wait a moment.'

  const sendMessage = useCallback(async (text: string): Promise<void> => {
    setIsLoading(true)
    setConnectionRecovery(null)
    const startedAt = Date.now()

    try {
      const result = await getOrCreateTodayChat({})
      if ('error' in result) {
        return
      }

      await processTurn({ chatId: result.chatId, userText: text })
    } catch {
      setConnectionRecovery({ startedAt })
    } finally {
      setIsLoading(false)
    }
  }, [getOrCreateTodayChat, processTurn])

  const retryMessage = useCallback(async (messageId: Id<'messages'>): Promise<void> => {
    if (chat === null || chat === undefined) return
    setIsLoading(true)
    setConnectionRecovery(null)
    const startedAt = Date.now()
    try {
      await processTurn({ chatId: chat._id, retryMessageId: messageId })
    } catch {
      setConnectionRecovery({ messageId, startedAt })
    } finally {
      setIsLoading(false)
    }
  }, [chat, processTurn])

  return { discussionCard, hasFailedTurn, isLoading, messages, retryMessage, sendMessage, turnStatus }
}
