import type { ReactElement } from 'react'
import { useRouter } from 'expo-router'
import type { Href } from 'expo-router'
import { Pressable, StyleSheet, Text, View } from 'react-native'

import { colors, shadows, typography } from '@/components/ui/theme'

export function ChatHeader(): ReactElement {
  const router = useRouter()

  return (
    <View style={styles.container}>
      <Pressable
        accessibilityHint="Opens your Eco Track settings"
        accessibilityLabel="Open settings"
        accessibilityRole="button"
        onPress={() => router.push('/(app)/profile' as Href)}
        style={({ pressed }) => [styles.avatar, pressed && styles.avatarPressed]}
      >
        <Text style={styles.avatarLabel}>E</Text>
      </Pressable>
      <Text style={styles.title}>Today&apos;s Session</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  avatar: {
    alignItems: 'center',
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.accent,
    borderRadius: 19,
    borderWidth: 2,
    height: 38,
    justifyContent: 'center',
    left: 12,
    position: 'absolute',
    width: 38,
    ...shadows.glow,
  },
  avatarLabel: { color: colors.text, fontFamily: typography.body, fontSize: 13, fontStyle: 'italic', fontWeight: '700' },
  avatarPressed: { opacity: 0.72, transform: [{ scale: 0.96 }] },
  container: {
    alignItems: 'center',
    backgroundColor: 'rgba(43, 42, 39, 0.96)',
    borderBottomColor: 'rgba(255, 255, 255, 0.06)',
    borderBottomWidth: StyleSheet.hairlineWidth,
    height: 52,
    justifyContent: 'center',
  },
  title: { color: colors.text, fontFamily: typography.body, fontSize: 14, fontWeight: '600', letterSpacing: 0.14 },
})
