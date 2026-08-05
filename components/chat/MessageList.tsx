import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactElement } from 'react'
import { FlatList, Pressable, StyleSheet, Text, View, type ViewToken } from 'react-native'

import type { ChatMessage } from '@/types/chat'
import type { Id } from '@/convex/_generated/dataModel'
import type { PresentedCard } from '@/types/presentation'
import { colors, shadows, typography } from '@/components/ui/theme'

import { EmptyChatState } from './EmptyChatState'
import { MessageBubble } from './MessageBubble'
import { TypingIndicator } from './TypingIndicator'
import { WorkoutCard } from '@/components/cards/WorkoutCard'

interface MessageListProps {
  distanceUnit: 'km' | 'miles'
  isLoading: boolean
  messagesReady: boolean
  messages: ChatMessage[]
  onAskEco: (cardId: Id<'cards'>) => Promise<void>
  onRetry: (messageId: Id<'messages'>) => Promise<void>
  onSelectStarter: (text: string) => void
  pendingCards: PresentedCard[]
  turnStatus: string | null
  weightUnit: 'kg' | 'lbs'
}

export function MessageList({ distanceUnit, isLoading, messages, messagesReady, onAskEco, onRetry, onSelectStarter, pendingCards, turnStatus, weightUnit }: MessageListProps): ReactElement {
  const listRef = useRef<FlatList<ChatMessage>>(null)
  const [selectedCardId, setSelectedCardId] = useState<Id<'cards'> | null>(null)
  const [hasVisiblePendingCard, setHasVisiblePendingCard] = useState(true)
  const [isAtBottom, setIsAtBottom] = useState(true)
  const [hasNewBelow, setHasNewBelow] = useState(false)
  const [sessionEcoMessageIds, setSessionEcoMessageIds] = useState<Set<string>>(new Set())
  const initialEcoMessageIds = useRef(new Set<string>())
  const hasCapturedHistory = useRef(false)
  const pendingMessageIdsRef = useRef(new Set(pendingCards.map((card) => card.messageId)))
  const onViewableItemsChanged = useRef(({ viewableItems }: { viewableItems: ViewToken<ChatMessage>[] }): void => {
    setHasVisiblePendingCard(viewableItems.some((token) => token.item.role === 'eco' && pendingMessageIdsRef.current.has(token.item.messageId)))
  })

  useEffect(() => {
    pendingMessageIdsRef.current = new Set(pendingCards.map((card) => card.messageId))
    if (pendingCards.length === 0) setHasVisiblePendingCard(true)
  }, [pendingCards])

  useEffect(() => {
    if (!messagesReady || hasCapturedHistory.current) return
    initialEcoMessageIds.current = new Set(messages.filter((message) => message.role === 'eco').map((message) => message.id))
    hasCapturedHistory.current = true
  }, [messages, messagesReady])

  useEffect(() => {
    if (!hasCapturedHistory.current) return
    const nextIds = messages.filter((message) => message.role === 'eco' && !initialEcoMessageIds.current.has(message.id)).map((message) => message.id)
    setSessionEcoMessageIds((current) => nextIds.every((id) => current.has(id)) && current.size === nextIds.length ? current : new Set(nextIds))
  }, [messages])

  const handleRevealProgress = useCallback((): void => {
    if (isAtBottom) listRef.current?.scrollToEnd({ animated: true })
  }, [isAtBottom])

  useEffect(() => {
    if ((messages.length > 0 || isLoading) && isAtBottom) {
      listRef.current?.scrollToEnd({ animated: true })
    } else if (messages.length > 0) {
      setHasNewBelow(true)
    }
  }, [isAtBottom, isLoading, messages.length])

  return (
    <View style={styles.root}>
      <FlatList
      ref={listRef}
      data={messages}
      keyExtractor={(item) => item.id}
      renderItem={({ item }) => <MessageBubble animateReply={sessionEcoMessageIds.has(item.id)} distanceUnit={distanceUnit} isLoading={isLoading} message={item} onAskEco={onAskEco} onCardClose={() => setSelectedCardId(null)} onCardOpen={setSelectedCardId} onRetry={onRetry} onRevealComplete={handleRevealProgress} selectedCardId={selectedCardId} weightUnit={weightUnit} />}
      ListEmptyComponent={<EmptyChatState onSelectStarter={onSelectStarter} />}
      ListFooterComponent={
        isLoading || turnStatus !== null ? (
          <View style={styles.footer}>
            {isLoading ? <TypingIndicator /> : null}
            {turnStatus !== null ? <Text style={styles.turnStatus}>{turnStatus}</Text> : null}
          </View>
        ) : null
      }
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
      onViewableItemsChanged={onViewableItemsChanged.current}
      onScroll={(event) => {
        const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent
        const atBottom = contentSize.height - contentOffset.y - layoutMeasurement.height < 48
        setIsAtBottom(atBottom)
        if (atBottom) setHasNewBelow(false)
      }}
      scrollEventThrottle={32}
      showsVerticalScrollIndicator={false}
      style={styles.list}
      viewabilityConfig={{ itemVisiblePercentThreshold: 35 }}
      />
      {pendingCards.length > 0 && !hasVisiblePendingCard ? (
        <Pressable accessibilityLabel="Open pending exercise" accessibilityRole="button" onPress={() => setSelectedCardId(pendingCards[0]?._id ?? null)} style={({ pressed }) => [styles.sticky, pressed && styles.stickyPressed]}>
          <View style={styles.stickyDot} />
          <Text style={styles.stickyLabel}>{pendingCards.reduce((total, card) => total + (typeof card.parsedData === 'object' && card.parsedData !== null && 'blocks' in card.parsedData && Array.isArray(card.parsedData.blocks) ? card.parsedData.blocks.reduce((sum: number, block: { exercises?: unknown[] }) => sum + (block.exercises?.length ?? 0), 0) : 0), 0)} exercises ready to confirm</Text>
          <Text style={styles.stickyChevron}>›</Text>
        </Pressable>
      ) : null}
      {hasNewBelow ? <Pressable accessibilityLabel="Scroll to newest message" accessibilityRole="button" onPress={() => { listRef.current?.scrollToEnd({ animated: true }); setHasNewBelow(false) }} style={styles.scrollButton}><Text style={styles.scrollButtonText}>↓</Text></Pressable> : null}
      {!hasVisiblePendingCard && selectedCardId !== null ? (() => {
        const selected = pendingCards.find((card) => card._id === selectedCardId)
        return selected === undefined ? null : <WorkoutCard card={selected} distanceUnit={distanceUnit} hideRow isOpen onAskEco={onAskEco} onClose={() => setSelectedCardId(null)} weightUnit={weightUnit} />
      })() : null}
    </View>
  )
}

const styles = StyleSheet.create({
  content: { flexGrow: 1, paddingBottom: 42, paddingHorizontal: 16, paddingTop: 32 },
  footer: { width: '100%' },
  list: { flex: 1 },
  root: { flex: 1 },
  scrollButton: { alignItems: 'center', backgroundColor: colors.surface, borderColor: colors.border, borderRadius: 22, borderWidth: 1, bottom: 10, height: 44, justifyContent: 'center', position: 'absolute', right: 16, width: 44, ...shadows.card },
  scrollButtonText: { color: colors.accent, fontFamily: typography.body, fontSize: 18 },
  sticky: { alignItems: 'center', backgroundColor: 'rgba(48, 47, 44, 0.98)', borderColor: 'rgba(34, 197, 94, 0.22)', borderRadius: 12, borderWidth: 1, flexDirection: 'row', gap: 11, left: 12, minHeight: 48, paddingHorizontal: 13, position: 'absolute', right: 12, top: 8, zIndex: 25, ...shadows.card },
  stickyChevron: { color: colors.faint, fontFamily: typography.body, fontSize: 18 },
  stickyDot: { backgroundColor: colors.accent, borderRadius: 5, height: 10, width: 10 },
  stickyLabel: { color: colors.text, flex: 1, fontFamily: typography.body, fontSize: 13, fontWeight: '600' },
  stickyPressed: { opacity: 0.78, transform: [{ scale: 0.99 }] },
  turnStatus: { color: '#b9b7b2', fontFamily: typography.mono, fontSize: 12, letterSpacing: 0.2, lineHeight: 18, marginTop: 8, textAlign: 'center' },
})
