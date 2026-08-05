import type { ReactElement } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import Svg, { Path } from 'react-native-svg'

import { ScreenHeader } from '@/components/ui/ScreenHeader'
import { colors, shadows, typography } from '@/components/ui/theme'

export default function ReportScreen(): ReactElement {
  return (
    <SafeAreaView edges={['top']} style={styles.safeArea}>
      <ScreenHeader title="Report" />
      <View style={styles.content}>
        <View style={styles.mark}><Svg height={35} viewBox="0 0 40 40" width={35}><Path d="M5 32h30M9 28V17h6v11m5 0V8h6v20m5 0v-7h4v7" fill="none" stroke={colors.accent} strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.6} /></Svg></View>
        <Text style={styles.kicker}>Your training story</Text>
        <Text style={styles.title}>Reports are taking shape.</Text>
        <Text style={styles.copy}>Keep logging with Eco. When reports arrive, they’ll be built from the workouts you have actually confirmed—not guesses.</Text>
        <View style={styles.note}><Text style={styles.noteText}>Coming after the workout journal is established.</Text></View>
      </View>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  content: { alignItems: 'center', flex: 1, justifyContent: 'center', paddingBottom: 80, paddingHorizontal: 34 },
  copy: { color: colors.textMuted, fontFamily: typography.body, fontSize: 13, lineHeight: 21, maxWidth: 310, textAlign: 'center' },
  kicker: { color: colors.faint, fontFamily: typography.body, fontSize: 10, fontWeight: '700', letterSpacing: 1.4, marginBottom: 8, textTransform: 'uppercase' },
  mark: { alignItems: 'center', backgroundColor: colors.surface, borderColor: 'rgba(34, 197, 94, 0.28)', borderRadius: 38, borderWidth: 1, height: 76, justifyContent: 'center', marginBottom: 24, width: 76, ...shadows.glow },
  note: { backgroundColor: 'rgba(34, 197, 94, 0.06)', borderColor: 'rgba(34, 197, 94, 0.16)', borderRadius: 10, borderWidth: 1, marginTop: 22, paddingHorizontal: 13, paddingVertical: 10 },
  noteText: { color: colors.accentMuted, fontFamily: typography.body, fontSize: 11, textAlign: 'center' },
  safeArea: { backgroundColor: colors.background, flex: 1 },
  title: { color: colors.text, fontFamily: typography.body, fontSize: 25, fontWeight: '500', lineHeight: 31, marginBottom: 10, textAlign: 'center' },
})
