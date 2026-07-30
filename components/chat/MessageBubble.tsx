import { useState, type ReactElement } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { useQuery } from 'convex/react'

import { WorkoutCard } from '@/components/cards/WorkoutCard'
import { api } from '@/convex/_generated/api'
import type { Id } from '@/convex/_generated/dataModel'
import type { ChatMessage } from '@/types/chat'

interface MessageBubbleProps {
  message: ChatMessage
  isLoading: boolean
  onAskEco: (cardId: Id<'cards'>) => Promise<void>
  onRetry: (messageId: Id<'messages'>) => Promise<void>
  previousMessageId?: Id<'messages'>
}

export function MessageBubble({ isLoading, message, onAskEco, onRetry, previousMessageId }: MessageBubbleProps): ReactElement {
  const isUser = message.role === 'user'
  const isError = message.role === 'error'
  const [showTrace, setShowTrace] = useState(false)
  const cards = useQuery(api.functions.cards.getByMessage, { messageId: message.messageId })
  const trace = useQuery(api.functions.messages.getBlocks, isUser ? 'skip' : { messageId: message.messageId, previousMessageId })
  const time = new Intl.DateTimeFormat([], {
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(message.timestamp))

  return (
    <View style={[styles.row, isUser ? styles.userRow : styles.ecoRow, isError ? styles.errorRow : undefined]}>
      <View style={[isUser ? styles.userWrap : styles.ecoWrap, isError ? styles.errorWrap : undefined]}>
        <View style={isUser ? styles.userBubble : undefined}>
          <Text style={[styles.message, isUser ? styles.userMessage : isError ? styles.errorMessage : styles.ecoMessage]}>
            {message.text}
          </Text>
        </View>
        {!isUser && !isError && (trace?.blocks.length ?? 0) > 0 ? (
          <View style={styles.traceWrap}>
            <Pressable accessibilityRole="button" onPress={() => setShowTrace((value) => !value)} style={styles.traceToggle}>
              <Text style={styles.traceLabel}>{showTrace ? 'Hide activity' : 'Show activity'}</Text>
            </Pressable>
            {showTrace ? trace?.blocks.map((block) => <Text key={block._id} style={styles.traceText}>{block.content}</Text>) : null}
          </View>
        ) : null}
        <Text style={[styles.time, isUser ? styles.userTime : styles.ecoTime, isError ? styles.errorTime : undefined]}>{time}</Text>
        {isError ? (
          <Pressable
            accessibilityLabel="Try sending your message again"
            accessibilityRole="button"
            disabled={isLoading}
            onPress={() => void onRetry(message.messageId)}
            style={[styles.retryButton, isLoading ? styles.retryButtonDisabled : undefined]}
          >
            <Text style={styles.retryText}>try again.</Text>
          </Pressable>
        ) : null}
        {!isUser && !isError ? cards?.map((card) => <WorkoutCard key={card._id} card={card} onAskEco={onAskEco} />) : null}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  ecoMessage: { color: '#eeeeee', lineHeight: 26 },
  ecoRow: { alignItems: 'flex-start', marginBottom: 8 },
  ecoTime: { textAlign: 'left' },
  ecoWrap: { maxWidth: '100%' },
  errorMessage: { color: '#b9b7b2', fontFamily: 'monospace', fontSize: 12, letterSpacing: 0.2, lineHeight: 18 },
  errorRow: { marginBottom: 12, marginTop: 4 },
  errorTime: { color: '#807e78', fontFamily: 'monospace' },
  errorWrap: { width: '100%' },
  message: { fontFamily: 'serif', fontSize: 15 },
  row: { width: '100%' },
  retryButton: { alignSelf: 'center', backgroundColor: '#3d8055', borderColor: '#5d9d71', borderRadius: 10, borderWidth: 1, justifyContent: 'center', marginTop: 8, minHeight: 44, width: '50%' },
  retryButtonDisabled: { opacity: 0.55 },
  retryText: { color: '#f1f8f2', fontFamily: 'serif', fontSize: 14, fontWeight: '700', lineHeight: 20, textAlign: 'center' },
  time: { color: '#696762', fontFamily: 'serif', fontSize: 10, letterSpacing: 0.1, marginTop: 5 },
  traceLabel: { color: '#92908b', fontFamily: 'serif', fontSize: 11 },
  traceText: { color: '#92908b', fontFamily: 'serif', fontSize: 11, marginTop: 3 },
  traceToggle: { minHeight: 44, justifyContent: 'center' },
  traceWrap: { marginTop: 2 },
  userBubble: { backgroundColor: '#3a3936', borderBottomRightRadius: 4, borderRadius: 18, paddingHorizontal: 16, paddingVertical: 11 },
  userMessage: { color: '#eeeeee', lineHeight: 25 },
  userRow: { alignItems: 'flex-end', marginBottom: 10 },
  userTime: { paddingRight: 4, textAlign: 'right' },
  userWrap: { maxWidth: '78%' },
})
