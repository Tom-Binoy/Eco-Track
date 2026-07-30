import { useState, type ReactElement } from 'react'
import { KeyboardAvoidingView, Platform, StyleSheet } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useMutation } from 'convex/react'

import { ChatHeader } from '@/components/chat/ChatHeader'
import { ChatInput } from '@/components/chat/ChatInput'
import { MessageList } from '@/components/chat/MessageList'
import { useChat } from '@/hooks/useChat'
import { api } from '@/convex/_generated/api'
import type { Id } from '@/convex/_generated/dataModel'

export default function ChatScreen(): ReactElement {
  const { discussionCard, isLoading, messages, retryMessage, sendMessage } = useChat()
  const [discussionError, setDiscussionError] = useState<string | null>(null)
  const [isClosingDiscussion, setIsClosingDiscussion] = useState(false)
  const setInDiscussion = useMutation(api.functions.cards.setInDiscussion)
  const bringCardBackToDeck = useMutation(api.functions.cards.bringCardBackToDeck)

  const handleAskEco = async (cardId: Id<'cards'>): Promise<void> => {
    setDiscussionError(null)
    await setInDiscussion({ cardId, inDiscussion: true })
  }

  const handleBringCardBackToDeck = async (): Promise<void> => {
    if (discussionCard === null || discussionCard === undefined) return
    setIsClosingDiscussion(true)
    setDiscussionError(null)
    try {
      const result = await bringCardBackToDeck({ cardId: discussionCard._id, messageId: discussionCard.messageId })
      if ('error' in result) setDiscussionError(result.error ?? 'Could not return this card to your deck')
    } finally {
      setIsClosingDiscussion(false)
    }
  }

  return (
    <SafeAreaView edges={['top', 'bottom']} style={styles.safeArea}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.keyboardAvoidingView}
      >
        <ChatHeader />
        <MessageList
          isLoading={isLoading}
          messages={messages}
          onAskEco={handleAskEco}
          onRetry={retryMessage}
          onSelectStarter={sendMessage}
        />
        <ChatInput
          discussionCard={discussionCard}
          discussionError={discussionError}
          isClosingDiscussion={isClosingDiscussion}
          isLoading={isLoading}
          onBringCardBackToDeck={handleBringCardBackToDeck}
          onSend={sendMessage}
        />
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  keyboardAvoidingView: { flex: 1 },
  safeArea: { backgroundColor: '#2b2a27', flex: 1 },
})
