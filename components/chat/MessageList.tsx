import { useEffect, useRef } from 'react'
import type { ReactElement } from 'react'
import { FlatList, StyleSheet, View } from 'react-native'

import type { ChatMessage } from '@/types/chat'
import type { Id } from '@/convex/_generated/dataModel'

import { EmptyChatState } from './EmptyChatState'
import { MessageBubble } from './MessageBubble'
import { TypingIndicator } from './TypingIndicator'

interface MessageListProps {
  isLoading: boolean
  messages: ChatMessage[]
  onAskEco: (cardId: Id<'cards'>) => Promise<void>
  onSelectStarter: (text: string) => void
}

export function MessageList({ isLoading, messages, onAskEco, onSelectStarter }: MessageListProps): ReactElement {
  const listRef = useRef<FlatList<ChatMessage>>(null)

  useEffect(() => {
    if (messages.length > 0 || isLoading) {
      listRef.current?.scrollToEnd({ animated: true })
    }
  }, [isLoading, messages.length])

  return (
    <FlatList
      ref={listRef}
      data={messages}
      keyExtractor={(item) => item.id}
      renderItem={({ item }) => <MessageBubble message={item} onAskEco={onAskEco} />}
      ListEmptyComponent={<EmptyChatState onSelectStarter={onSelectStarter} />}
      ListFooterComponent={isLoading ? <TypingIndicator /> : null}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
      onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: true })}
      showsVerticalScrollIndicator={false}
      style={styles.list}
    />
  )
}

const styles = StyleSheet.create({
  content: { flexGrow: 1, paddingBottom: 32, paddingHorizontal: 16, paddingTop: 32 },
  list: { flex: 1 },
})
