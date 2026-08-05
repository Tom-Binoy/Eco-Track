import type { ReactElement } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import Svg, { Path } from 'react-native-svg'

import { colors, shadows, typography } from '@/components/ui/theme'

interface OfflineOverlayProps { onRetry: () => void }

export function OfflineOverlay({ onRetry }: OfflineOverlayProps): ReactElement {
  return (
    <View accessibilityRole="alert" style={styles.overlay}>
      <View style={styles.content}>
        <View style={styles.mark}><Svg height={36} viewBox="0 0 40 40" width={36}><Path d="M5 14c8.4-7.2 21.6-7.2 30 0M10 20c5.6-4.8 14.4-4.8 20 0M15.5 26c2.6-2.2 6.4-2.2 9 0M20 32h.01M6 5l28 30" fill="none" stroke={colors.textMuted} strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} /></Svg></View>
        <Text style={styles.kicker}>Connection interrupted</Text>
        <Text style={styles.title}>You&apos;re offline.</Text>
        <Text style={styles.copy}>Eco needs an internet connection to reply. Check your connection and try again when you&apos;re ready.</Text>
        <Pressable accessibilityRole="button" onPress={onRetry} style={({ pressed }) => [styles.button, pressed && styles.pressed]}><Text style={styles.buttonText}>Try again</Text></Pressable>
        <Text style={styles.note}>Your typed workout and pending exercises are still here.</Text>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  button: { alignItems: 'center', backgroundColor: colors.accent, borderRadius: 10, justifyContent: 'center', minHeight: 48, width: '100%', ...shadows.glow },
  buttonText: { color: '#ffffff', fontFamily: typography.body, fontSize: 13, fontWeight: '700' },
  content: { alignItems: 'center', maxWidth: 300, width: '100%' },
  copy: { color: colors.textMuted, fontFamily: typography.body, fontSize: 13, lineHeight: 21, marginBottom: 22, textAlign: 'center' },
  kicker: { color: colors.faint, fontFamily: typography.body, fontSize: 9, fontWeight: '700', letterSpacing: 1.4, marginBottom: 8, textTransform: 'uppercase' },
  mark: { alignItems: 'center', backgroundColor: colors.surface, borderColor: colors.border, borderRadius: 38, borderWidth: 1, height: 76, justifyContent: 'center', marginBottom: 24, width: 76, ...shadows.card },
  note: { color: colors.faint, fontFamily: typography.body, fontSize: 10, lineHeight: 15, marginTop: 14, textAlign: 'center' },
  overlay: { ...StyleSheet.absoluteFill, alignItems: 'center', backgroundColor: colors.background, justifyContent: 'center', padding: 30, zIndex: 80 },
  pressed: { opacity: 0.78, transform: [{ scale: 0.98 }] },
  title: { color: colors.text, fontFamily: typography.body, fontSize: 25, fontWeight: '500', marginBottom: 10 },
})
