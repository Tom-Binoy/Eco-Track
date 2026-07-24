import { useRouter } from 'expo-router'
import { useState } from 'react'
import type { ReactElement } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { EcoMarkMotion } from '@/components/branding/EcoMarkMotion'
import type { EcoMarkMotionMode } from '@/components/branding/EcoMarkMotion'

const modes: { detail: string; label: string; value: EcoMarkMotionMode }[] = [
  { detail: 'The full arrival and activation story.', label: 'Launch', value: 'launch' },
  { detail: 'A slow wind moves through the ivory path.', label: 'Breeze', value: 'breeze' },
  { detail: 'A contained wake-up pulse through the mark.', label: 'Pulse', value: 'pulse' },
]

export default function MotionLabScreen(): ReactElement {
  const router = useRouter()
  const [mode, setMode] = useState<EcoMarkMotionMode>('launch')
  const [runKey, setRunKey] = useState(0)

  const selectMode = (nextMode: EcoMarkMotionMode): void => {
    setMode(nextMode)
    setRunKey((currentKey) => currentKey + 1)
  }

  const activeMode = modes.find((candidate) => candidate.value === mode)

  return (
    <SafeAreaView edges={['bottom', 'top']} style={styles.safeArea}>
      <View style={styles.header}>
        <Text style={styles.eyebrow}>Eco motion lab</Text>
        <Pressable accessibilityRole="button" onPress={() => router.back()} style={styles.closeButton}>
          <Text style={styles.closeLabel}>Back to chat</Text>
        </Pressable>
      </View>
      <View style={styles.preview}>
        <EcoMarkMotion key={runKey} mode={mode} runKey={runKey} />
      </View>
      <View style={styles.controls}>
        <Text style={styles.modeLabel}>{activeMode?.label}</Text>
        <Text style={styles.modeDetail}>{activeMode?.detail}</Text>
        <View style={styles.modeList}>
          {modes.map((candidate) => {
            const isSelected = candidate.value === mode

            return (
              <Pressable
                key={candidate.value}
                accessibilityRole="button"
                accessibilityState={{ selected: isSelected }}
                onPress={() => selectMode(candidate.value)}
                style={[styles.modeButton, isSelected && styles.modeButtonSelected]}
              >
                <Text style={[styles.modeButtonLabel, isSelected && styles.modeButtonLabelSelected]}>
                  {candidate.label}
                </Text>
              </Pressable>
            )
          })}
        </View>
        <Pressable accessibilityRole="button" onPress={() => setRunKey((currentKey) => currentKey + 1)} style={styles.replayButton}>
          <Text style={styles.replayLabel}>Replay {activeMode?.label}</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  closeButton: { alignItems: 'center', justifyContent: 'center', minHeight: 44, paddingHorizontal: 8 },
  closeLabel: { color: '#9a9893', fontFamily: 'serif', fontSize: 13 },
  controls: { gap: 12, paddingHorizontal: 24, paddingTop: 28 },
  eyebrow: { color: '#22c55e', fontFamily: 'serif', fontSize: 10, fontWeight: '700', letterSpacing: 1.4, textTransform: 'uppercase' },
  header: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', minHeight: 52, paddingHorizontal: 16 },
  modeButton: { alignItems: 'center', borderColor: 'rgba(255, 255, 255, 0.08)', borderRadius: 10, borderWidth: 1, flex: 1, justifyContent: 'center', minHeight: 44 },
  modeButtonLabel: { color: '#9a9893', fontFamily: 'serif', fontSize: 13, fontWeight: '600' },
  modeButtonLabelSelected: { color: '#ffffff' },
  modeButtonSelected: { backgroundColor: '#22c55e', borderColor: '#22c55e' },
  modeDetail: { color: '#9a9893', fontFamily: 'serif', fontSize: 14, lineHeight: 21, textAlign: 'center' },
  modeLabel: { color: '#eeeeee', fontFamily: 'serif', fontSize: 24, fontWeight: '500', textAlign: 'center' },
  modeList: { flexDirection: 'row', gap: 8, marginTop: 12 },
  preview: { alignItems: 'center', flex: 1, justifyContent: 'center', paddingBottom: 12 },
  replayButton: { alignItems: 'center', borderColor: 'rgba(34, 197, 94, 0.4)', borderRadius: 10, borderWidth: 1, justifyContent: 'center', marginTop: 8, minHeight: 48 },
  replayLabel: { color: '#eeeeee', fontFamily: 'serif', fontSize: 14, fontWeight: '700' },
  safeArea: { backgroundColor: '#2b2a27', flex: 1 },
})
