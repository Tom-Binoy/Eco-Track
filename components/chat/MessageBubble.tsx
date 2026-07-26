import { useState, type ReactElement } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { useQuery } from 'convex/react'

import { WorkoutCard } from '@/components/cards/WorkoutCard'
import { api } from '@/convex/_generated/api'
import type { Id } from '@/convex/_generated/dataModel'
import type { ChatMessage } from '@/types/chat'

interface MessageBubbleProps {
  message: ChatMessage
  onAskEco: (cardId: Id<'cards'>) => Promise<void>
}

export function MessageBubble({ message, onAskEco }: MessageBubbleProps): ReactElement {
  const isUser = message.role === 'user'
  const [showTrace, setShowTrace] = useState(false)
  const cards = useQuery(api.functions.cards.getByMessage, { messageId: message.messageId })
  const trace = useQuery(api.functions.messages.getBlocks, isUser ? 'skip' : { messageId: message.messageId })
  const time = new Intl.DateTimeFormat([], {
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(message.timestamp))

  return (
    <View style={[styles.row, isUser ? styles.userRow : styles.ecoRow]}>
      <View style={isUser ? styles.userWrap : styles.ecoWrap}>
        <View style={isUser ? styles.userBubble : undefined}>
          <Text style={[styles.message, isUser ? styles.userMessage : styles.ecoMessage]}>
            {message.text}
          </Text>
        </View>
        {!isUser && (trace?.blocks.length ?? 0) > 0 ? (
          <View style={styles.traceWrap}>
            <Pressable accessibilityRole="button" onPress={() => setShowTrace((value) => !value)} style={styles.traceToggle}>
              <Text style={styles.traceLabel}>{showTrace ? 'Hide activity' : 'Show activity'}</Text>
            </Pressable>
            {showTrace ? trace?.blocks.map((block) => <Text key={block._id} style={styles.traceText}>{block.content}</Text>) : null}
          </View>
        ) : null}
        <Text style={[styles.time, isUser ? styles.userTime : styles.ecoTime]}>{time}</Text>
        {!isUser ? cards?.map((card) => <WorkoutCard key={card._id} card={card} onAskEco={onAskEco} />) : null}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  ecoMessage: { color: '#eeeeee', lineHeight: 26 },
  ecoRow: { alignItems: 'flex-start', marginBottom: 8 },
  ecoTime: { textAlign: 'left' },
  ecoWrap: { maxWidth: '100%' },
  message: { fontFamily: 'serif', fontSize: 15 },
  row: { width: '100%' },
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
