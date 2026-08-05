import { useRouter } from 'expo-router'
import type { ReactElement } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'

import { colors, typography } from '@/components/ui/theme'

interface ScreenHeaderProps {
  back?: boolean
  title: string
}

export function ScreenHeader({ back = false, title }: ScreenHeaderProps): ReactElement {
  const router = useRouter()
  return (
    <View style={styles.container}>
      {back ? (
        <Pressable accessibilityLabel="Go back" accessibilityRole="button" onPress={() => router.back()} style={({ pressed }) => [styles.back, pressed && styles.pressed]}>
          <Text style={styles.backText}>‹</Text>
        </Pressable>
      ) : null}
      <Text style={styles.title}>{title}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  back: { alignItems: 'center', backgroundColor: colors.surfaceRaised, borderColor: colors.border, borderRadius: 18, borderWidth: 1, height: 36, justifyContent: 'center', left: 12, position: 'absolute', width: 36 },
  backText: { color: colors.textMuted, fontFamily: typography.body, fontSize: 28, lineHeight: 30, marginTop: -2 },
  container: { alignItems: 'center', backgroundColor: colors.background, borderBottomColor: colors.borderSubtle, borderBottomWidth: StyleSheet.hairlineWidth, height: 52, justifyContent: 'center' },
  pressed: { opacity: 0.7 },
  title: { color: colors.text, fontFamily: typography.body, fontSize: 14, fontWeight: '600', letterSpacing: 0.14 },
})
