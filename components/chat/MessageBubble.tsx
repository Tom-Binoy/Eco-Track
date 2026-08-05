import { useEffect, useState, type ReactElement } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { useMutation, useQuery } from 'convex/react'
import Svg, { Path } from 'react-native-svg'

import { WorkoutCard } from '@/components/cards/WorkoutCard'
import { api } from '@/convex/_generated/api'
import type { Id } from '@/convex/_generated/dataModel'
import type { ChatMessage } from '@/types/chat'
import { colors, typography } from '@/components/ui/theme'
import { EcoTextReveal } from '@/components/chat/EcoTextReveal'

interface MessageBubbleProps {
  animateReply: boolean
  distanceUnit: 'km' | 'miles'
  message: ChatMessage
  isLoading: boolean
  onAskEco: (cardId: Id<'cards'>) => Promise<void>
  onCardClose: () => void
  onCardOpen: (cardId: Id<'cards'>) => void
  onRetry: (messageId: Id<'messages'>) => Promise<void>
  onRevealComplete: () => void
  selectedCardId: Id<'cards'> | null
  weightUnit: 'kg' | 'lbs'
}

function FeedbackControls({ messageId }: { messageId: Id<'messages'> }): ReactElement {
  const feedback = useQuery(api.functions.messageFeedback.getForMessage, { messageId })
  const setFeedback = useMutation(api.functions.messageFeedback.setForMessage)
  return (
    <View accessibilityLabel="Rate Eco's reply" style={styles.feedback}>
      {(['up', 'down'] as const).map((rating) => {
        const selected = feedback?.rating === rating
        return (
          <Pressable key={rating} accessibilityLabel={rating === 'up' ? 'Good response' : 'Could be better'} accessibilityRole="button" accessibilityState={{ selected }} onPress={() => void setFeedback({ messageId, rating })} style={({ pressed }) => [styles.feedbackButton, selected && styles.feedbackSelected, pressed && styles.feedbackPressed]}>
            <Svg height={16} viewBox="0 0 24 24" width={16}>
              <Path d={rating === 'up' ? 'M7 10v11H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3Zm0 10h10.1a2 2 0 0 0 1.9-1.4l2.2-7A2 2 0 0 0 19.3 9H15l.7-3.5A2.1 2.1 0 0 0 11.8 4L7 10Z' : 'M7 14V3H4a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h3Zm0-10h10.1A2 2 0 0 1 19 5.4l2.2 7a2 2 0 0 1-1.9 2.6H15l.7 3.5a2.1 2.1 0 0 1-3.9 1.5L7 14Z'} fill="none" stroke={selected ? colors.textMuted : colors.faint} strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.6} />
            </Svg>
          </Pressable>
        )
      })}
    </View>
  )
}

export function MessageBubble({ animateReply, distanceUnit, isLoading, message, onAskEco, onCardClose, onCardOpen, onRetry, onRevealComplete, selectedCardId, weightUnit }: MessageBubbleProps): ReactElement {
  const isUser = message.role === 'user'
  const isError = message.role === 'error'
  const [showActivity, setShowActivity] = useState(false)
  const presentation = useQuery(api.functions.cards.getPresentation, isUser || isError ? 'skip' : { messageId: message.messageId })
  const cardsById = new Map((presentation?.cards ?? []).map((card) => [card._id, card]))
  const hasTimeline = (presentation?.blocks.length ?? 0) > 0
  const hasActivity = presentation?.blocks.some((block) => block.type === 'tool_summary') ?? false
  const hasCardReferences = presentation?.blocks.some((block) => (block.cardIds?.length ?? 0) > 0) ?? false
  const [visibleBlockIndex, setVisibleBlockIndex] = useState(animateReply ? 0 : Number.MAX_SAFE_INTEGER)
  const timeline = presentation?.blocks ?? []
  const timelineComplete = !animateReply || visibleBlockIndex >= timeline.length

  useEffect(() => {
    setVisibleBlockIndex(animateReply ? 0 : Number.MAX_SAFE_INTEGER)
  }, [animateReply, message.messageId])

  useEffect(() => {
    if (!animateReply || visibleBlockIndex >= timeline.length) return
    const current = timeline[visibleBlockIndex]
    if (current?.type !== 'tool_summary') return
    const timer = setTimeout(() => setVisibleBlockIndex((index) => index + 1), 0)
    return (): void => clearTimeout(timer)
  }, [animateReply, timeline, visibleBlockIndex])

  useEffect(() => {
    if (timelineComplete) onRevealComplete()
  }, [onRevealComplete, timelineComplete])
  const time = new Intl.DateTimeFormat([], {
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(message.timestamp))

  return (
    <View style={[styles.row, isUser ? styles.userRow : styles.ecoRow, isError ? styles.errorRow : undefined]}>
      <View style={[isUser ? styles.userWrap : styles.ecoWrap, isError ? styles.errorWrap : undefined]}>
        {isUser ? (
          <View style={styles.userBubble}>
            <Text style={[styles.message, styles.userMessage]}>{message.text}</Text>
          </View>
        ) : isError ? (
          <Text style={[styles.message, styles.errorMessage]}>{message.text}</Text>
        ) : (
          <>
            {hasTimeline ? timeline.map((block, index) => (
              index > visibleBlockIndex ? null : <View key={block._id}>
                {block.type === 'text' ? <EcoTextReveal animate={animateReply && index === visibleBlockIndex} onComplete={() => setVisibleBlockIndex((current) => Math.max(current, index + 1))} text={block.content} /> : null}
                {block.type === 'tool_summary' && showActivity ? <Text style={styles.activityText}>{block.content}</Text> : null}
                {block.type === 'tool_summary' ? (block.cardIds ?? []).map((cardId) => {
                  const card = cardsById.get(cardId)
                  return card === undefined ? null : <WorkoutCard card={card} distanceUnit={distanceUnit} isOpen={selectedCardId === card._id} key={card._id} onAskEco={onAskEco} onClose={onCardClose} onOpen={onCardOpen} weightUnit={weightUnit} />
                }) : null}
              </View>
            )) : message.text.length > 0 ? <EcoTextReveal animate={animateReply} onComplete={onRevealComplete} text={message.text} /> : null}
            {!hasCardReferences && timelineComplete ? presentation?.cards.map((card) => <WorkoutCard card={card} distanceUnit={distanceUnit} isOpen={selectedCardId === card._id} key={card._id} onAskEco={onAskEco} onClose={onCardClose} onOpen={onCardOpen} weightUnit={weightUnit} />) : null}
            {hasActivity && timelineComplete ? (
              <Pressable accessibilityRole="button" onPress={() => setShowActivity((value) => !value)} style={styles.activityToggle}>
                <Text style={styles.activityLabel}>{showActivity ? 'Hide activity' : 'Show activity'}</Text>
              </Pressable>
            ) : null}
          </>
        )}
        <View style={[styles.messageTools, isUser && styles.userTools]}>
          <Text style={[styles.time, isUser ? styles.userTime : styles.ecoTime, isError ? styles.errorTime : undefined]}>{time}</Text>
          {!isUser && !isError && message.text.length > 0 && timelineComplete ? <FeedbackControls messageId={message.messageId} /> : null}
        </View>
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
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  activityLabel: { color: '#92908b', fontFamily: typography.body, fontSize: 11 },
  activityText: { color: '#92908b', fontFamily: typography.body, fontSize: 11, lineHeight: 17, marginTop: 4 },
  activityToggle: { justifyContent: 'center', marginTop: 4, minHeight: 44 },
  ecoMessage: { color: colors.text, lineHeight: 26, marginBottom: 4 },
  ecoRow: { alignItems: 'flex-start', marginBottom: 14 },
  ecoTime: { textAlign: 'left' },
  ecoWrap: { maxWidth: '100%' },
  errorMessage: { color: '#b9b7b2', fontFamily: 'monospace', fontSize: 12, letterSpacing: 0.2, lineHeight: 18 },
  errorRow: { marginBottom: 12, marginTop: 4 },
  errorTime: { color: '#807e78', fontFamily: 'monospace' },
  errorWrap: { width: '100%' },
  feedback: { alignItems: 'center', flexDirection: 'row', gap: 2 },
  feedbackButton: { alignItems: 'center', borderRadius: 9, height: 44, justifyContent: 'center', width: 44 },
  feedbackPressed: { opacity: 0.6 },
  feedbackSelected: { backgroundColor: 'rgba(255, 255, 255, 0.05)' },
  message: { fontFamily: typography.body, fontSize: 15 },
  messageTools: { alignItems: 'center', flexDirection: 'row', gap: 2, minHeight: 34 },
  retryButton: { alignSelf: 'center', backgroundColor: '#3d8055', borderColor: '#5d9d71', borderRadius: 10, borderWidth: 1, justifyContent: 'center', marginTop: 8, minHeight: 44, width: '50%' },
  retryButtonDisabled: { opacity: 0.55 },
  retryText: { color: '#f1f8f2', fontFamily: 'serif', fontSize: 14, fontWeight: '700', lineHeight: 20, textAlign: 'center' },
  row: { width: '100%' },
  time: { color: colors.faint, fontFamily: typography.body, fontSize: 10, letterSpacing: 0.1 },
  userBubble: { backgroundColor: colors.surfaceRaised, borderBottomRightRadius: 4, borderRadius: 18, paddingHorizontal: 16, paddingVertical: 11 },
  userMessage: { color: colors.text, lineHeight: 25 },
  userRow: { alignItems: 'flex-end', marginBottom: 10 },
  userTime: { paddingRight: 4, textAlign: 'right' },
  userTools: { justifyContent: 'flex-end' },
  userWrap: { maxWidth: '78%' },
})
