import type { ReactElement } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'

interface EmptyChatStateProps {
  onSelectStarter: (text: string) => void
}

const starters = [
  { label: 'Log a strength workout', text: 'I completed a strength workout today.' },
  { label: 'Log a run or walk', text: 'I went for a run this morning.' },
  { label: 'Review recent progress', text: 'Show me my recent progress.' },
]

export function EmptyChatState({ onSelectStarter }: EmptyChatStateProps): ReactElement {
  return (
    <View style={styles.container}>
      <View style={styles.mark}>
        <Text style={styles.markLabel}>E</Text>
      </View>
      <Text style={styles.kicker}>Today&apos;s session</Text>
      <Text style={styles.heading}>Ready when you are.</Text>
      <Text style={styles.copy}>
        Tell Eco what you trained in your own words. Short, messy, or detailed all work.
      </Text>
      <View style={styles.starters}>
        {starters.map((starter) => (
          <Pressable
            key={starter.label}
            accessibilityRole="button"
            onPress={() => onSelectStarter(starter.text)}
            style={styles.starter}
          >
            <Text style={styles.starterLabel}>{starter.label}</Text>
            <Text style={styles.chevron}>›</Text>
          </Pressable>
        ))}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  chevron: { color: '#696762', fontFamily: 'serif', fontSize: 18 },
  container: { alignSelf: 'center', marginTop: 30, maxWidth: 300, width: '100%' },
  copy: { color: '#9a9893', fontFamily: 'serif', fontSize: 13, lineHeight: 21, marginBottom: 24, textAlign: 'center' },
  heading: { color: '#eeeeee', fontFamily: 'serif', fontSize: 24, fontWeight: '500', lineHeight: 29, marginBottom: 9, textAlign: 'center' },
  kicker: { color: '#696762', fontFamily: 'serif', fontSize: 10, fontWeight: '700', letterSpacing: 1.4, marginBottom: 8, textAlign: 'center', textTransform: 'uppercase' },
  mark: { alignItems: 'center', borderColor: 'rgba(34, 197, 94, 0.28)', borderRadius: 34, borderWidth: 1, height: 68, justifyContent: 'center', marginBottom: 22, marginLeft: 'auto', marginRight: 'auto', width: 68 },
  markLabel: { color: '#22c55e', fontFamily: 'serif', fontSize: 21, fontStyle: 'italic' },
  starter: { alignItems: 'center', backgroundColor: 'rgba(255, 255, 255, 0.018)', borderColor: 'rgba(255, 255, 255, 0.08)', borderRadius: 10, borderWidth: 1, flexDirection: 'row', justifyContent: 'space-between', minHeight: 44, paddingHorizontal: 13 },
  starterLabel: { color: '#9a9893', fontFamily: 'serif', fontSize: 12 },
  starters: { gap: 7 },
})
