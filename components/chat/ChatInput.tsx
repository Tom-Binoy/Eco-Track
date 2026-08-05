import { useState } from 'react'
import type { ReactElement } from 'react'
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native'

import type { Card } from '@/types/db'
import { colors, shadows, typography } from '@/components/ui/theme'

interface ChatInputProps {
  discussionCard: Card | null | undefined
  discussionError: string | null
  hasFailedTurn: boolean
  isLoading: boolean
  isClosingDiscussion: boolean
  onBringCardBackToDeck: () => void | Promise<void>
  onSend: (text: string) => void | Promise<void>
}

export function ChatInput({ discussionCard, discussionError, hasFailedTurn, isClosingDiscussion, isLoading, onBringCardBackToDeck, onSend }: ChatInputProps): ReactElement {
  const [text, setText] = useState('')
  const canSend = text.trim().length > 0 && !isLoading && !hasFailedTurn

  const handleSend = (): void => {
    const trimmedText = text.trim()

    if (!trimmedText || isLoading || hasFailedTurn) {
      return
    }

    setText('')
    void onSend(trimmedText)
  }

  return (
    <View style={styles.inputArea}>
      {discussionCard !== null && discussionCard !== undefined ? (
        <View style={styles.discussionBanner}>
          <View style={styles.discussionCopy}>
            <View style={styles.discussionIndicator} />
            <View style={styles.discussionTextWrap}>
              <Text style={styles.discussionTitle}>Card in discussion</Text>
              <Text style={[styles.discussionDescription, discussionError !== null && styles.discussionError]}>
                {discussionError ?? 'Eco is focused on this workout card'}
              </Text>
            </View>
          </View>
          <Pressable
            accessibilityHint="Returns the workout card to your deck and ends its discussion"
            accessibilityLabel="Bring card back to deck"
            accessibilityRole="button"
            disabled={isLoading || isClosingDiscussion}
            onPress={() => void onBringCardBackToDeck()}
            style={[styles.backToDeckButton, (isLoading || isClosingDiscussion) && styles.backToDeckButtonDisabled]}
          >
            <Text style={styles.backToDeckText}>{isClosingDiscussion ? 'Returning…' : 'Back to deck'}</Text>
          </Pressable>
        </View>
      ) : null}
      <View style={styles.container}>
        <TextInput
          value={text}
          onChangeText={setText}
          onSubmitEditing={handleSend}
          placeholder={hasFailedTurn ? 'Retry Eco’s failed response to continue' : 'What did you train today?'}
          placeholderTextColor="#9a9893"
          keyboardAppearance="dark"
          multiline
          style={styles.input}
          returnKeyType="send"
          blurOnSubmit={false}
          editable={!isLoading && !hasFailedTurn}
        />
        <Pressable
          accessibilityLabel="Send message"
          accessibilityRole="button"
          disabled={!canSend}
          onPress={handleSend}
          style={({ pressed }) => [styles.sendButton, canSend ? styles.sendButtonEnabled : styles.sendButtonDisabled, pressed && canSend && styles.sendButtonPressed]}
        >
          <Text style={[styles.sendIcon, canSend ? styles.sendIconEnabled : styles.sendIconDisabled]}>↑</Text>
        </Pressable>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  backToDeckButton: { alignItems: 'center', borderColor: 'rgba(74, 222, 128, 0.42)', borderRadius: 9, borderWidth: 1, justifyContent: 'center', minHeight: 44, paddingHorizontal: 12 },
  backToDeckButtonDisabled: { opacity: 0.55 },
  backToDeckText: { color: '#86efac', fontFamily: typography.body, fontSize: 12, fontWeight: '700' },
  container: {
    alignItems: 'flex-end',
    backgroundColor: colors.inset,
    borderColor: colors.border,
    borderRadius: 16,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 8,
    minHeight: 58,
    paddingBottom: 10,
    paddingLeft: 15,
    paddingRight: 10,
    paddingTop: 10,
    ...shadows.composer,
  },
  discussionBanner: { alignItems: 'center', backgroundColor: '#102a1a', borderColor: 'rgba(74, 222, 128, 0.36)', borderRadius: 14, borderWidth: 1, flexDirection: 'row', gap: 10, justifyContent: 'space-between', marginBottom: 8, paddingHorizontal: 12, paddingVertical: 10 },
  discussionCopy: { alignItems: 'center', flex: 1, flexDirection: 'row', gap: 9 },
  discussionDescription: { color: '#a7c7af', fontFamily: typography.body, fontSize: 11, lineHeight: 15 },
  discussionError: { color: '#fca5a5' },
  discussionIndicator: { backgroundColor: '#4ade80', borderColor: '#bbf7d0', borderRadius: 6, borderWidth: 2, height: 12, width: 12 },
  discussionTextWrap: { flex: 1 },
  discussionTitle: { color: '#dcfce7', fontFamily: typography.body, fontSize: 13, fontWeight: '700', lineHeight: 17 },
  inputArea: { backgroundColor: colors.background, paddingBottom: 14, paddingHorizontal: 16, paddingTop: 8 },
  input: {
    color: colors.text,
    flex: 1,
    fontFamily: typography.body,
    fontSize: 15,
    maxHeight: 120,
    minHeight: 36,
    paddingHorizontal: 0,
    paddingVertical: 5,
  },
  sendButton: { alignItems: 'center', borderRadius: 11, height: 38, justifyContent: 'center', width: 38 },
  sendButtonDisabled: { backgroundColor: colors.surface },
  sendButtonEnabled: { backgroundColor: colors.accent, ...shadows.glow },
  sendButtonPressed: { transform: [{ scale: 0.94 }] },
  sendIcon: { fontSize: 18, lineHeight: 22 },
  sendIconDisabled: { color: colors.faint },
  sendIconEnabled: { color: '#ffffff' },
})
