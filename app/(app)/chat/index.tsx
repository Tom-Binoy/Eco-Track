import { useState, type ReactElement } from 'react'
import { KeyboardAvoidingView, Platform, StyleSheet } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useMutation } from 'convex/react'
import NetInfo, { useNetInfo } from '@react-native-community/netinfo'

import { ChatHeader } from '@/components/chat/ChatHeader'
import { ChatInput } from '@/components/chat/ChatInput'
import { MessageList } from '@/components/chat/MessageList'
import { OfflineOverlay } from '@/components/chat/OfflineOverlay'
import { colors } from '@/components/ui/theme'
import { useChat } from '@/hooks/useChat'
import { useAuth } from '@/hooks/useAuth'
import { api } from '@/convex/_generated/api'
import type { Id } from '@/convex/_generated/dataModel'

export default function ChatScreen(): ReactElement {
  const { profile } = useAuth()
  const network = useNetInfo()
  const { discussionCard, hasFailedTurn, isLoading, messages, messagesReady, pendingCards, retryMessage, sendMessage, turnStatus } = useChat()
  const [discussionError, setDiscussionError] = useState<string | null>(null)
  const [isClosingDiscussion, setIsClosingDiscussion] = useState(false)
  const setInDiscussion = useMutation(api.functions.cards.setInDiscussion)
  const bringCardBackToDeck = useMutation(api.functions.cards.bringCardBackToDeck)
  const isOffline = network.isConnected === false

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
          distanceUnit={profile?.distanceUnit ?? 'km'}
          isLoading={isLoading}
          messages={messages}
          messagesReady={messagesReady}
          onAskEco={handleAskEco}
          onRetry={retryMessage}
          onSelectStarter={sendMessage}
          pendingCards={pendingCards}
          turnStatus={turnStatus}
          weightUnit={profile?.weightUnit ?? 'kg'}
        />
        <ChatInput
          discussionCard={discussionCard}
          discussionError={discussionError}
          hasFailedTurn={hasFailedTurn}
          isClosingDiscussion={isClosingDiscussion}
          isLoading={isLoading}
          onBringCardBackToDeck={handleBringCardBackToDeck}
          onSend={sendMessage}
        />
        {isOffline ? <OfflineOverlay onRetry={() => void NetInfo.refresh()} /> : null}
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  keyboardAvoidingView: { flex: 1 },
  safeArea: { backgroundColor: colors.background, flex: 1 },
})
