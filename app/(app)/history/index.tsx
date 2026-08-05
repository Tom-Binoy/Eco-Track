import { usePaginatedQuery } from 'convex/react'
import { useState, type ReactElement } from 'react'
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { ScreenHeader } from '@/components/ui/ScreenHeader'
import { colors, shadows, typography } from '@/components/ui/theme'
import { api } from '@/convex/_generated/api'
import type { HistorySession } from '@/types/presentation'

function sessionSummary(session: HistorySession): string {
  const exercises = session.blocks.flatMap((block) => block.exercises)
  const sets = exercises.reduce((total, exercise) => total + exercise.sets.length, 0)
  return `${exercises.length} ${exercises.length === 1 ? 'exercise' : 'exercises'} · ${sets} ${sets === 1 ? 'set' : 'sets'}`
}

function formatSet(set: HistorySession['blocks'][number]['exercises'][number]['sets'][number], unit: string): string {
  return [set.reps === undefined ? null : `${set.reps} reps`, set.weight === undefined ? null : `${set.weight} ${unit}`, set.distance === undefined ? null : `${set.distance} distance`, set.duration === undefined ? null : `${Math.floor(set.duration / 60)}:${String(set.duration % 60).padStart(2, '0')}`].filter(Boolean).join(' · ')
}

export default function HistoryScreen(): ReactElement {
  const { isLoading, loadMore, results, status } = usePaginatedQuery(api.functions.history.listMySessions, {}, { initialNumItems: 10 })
  const [selected, setSelected] = useState<HistorySession | null>(null)
  const sessions = results as HistorySession[]

  return (
    <SafeAreaView edges={['top']} style={styles.safeArea}>
      <ScreenHeader title="History" />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {isLoading ? <ActivityIndicator color={colors.accent} style={styles.loader} /> : null}
        {!isLoading && sessions.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.kicker}>Your journal</Text>
            <Text style={styles.emptyTitle}>Nothing logged yet.</Text>
            <Text style={styles.emptyCopy}>Tell Eco what you trained and confirmed workouts will collect here.</Text>
          </View>
        ) : null}
        {sessions.map((session) => {
          const first = session.blocks.flatMap((block) => block.exercises)[0]
          return (
            <Pressable key={session._id} accessibilityRole="button" onPress={() => setSelected(session)} style={({ pressed }) => [styles.session, pressed && styles.pressed]}>
              <View style={styles.check}><Text style={styles.checkText}>✓</Text></View>
              <View style={styles.sessionCopy}>
                <Text style={styles.sessionDate}>{new Date(`${session.date}T12:00:00`).toLocaleDateString([], { day: 'numeric', month: 'long', year: 'numeric' })}</Text>
                <Text style={styles.sessionName}>{first?.displayedName ?? 'Workout'}</Text>
              </View>
              <Text style={styles.sessionMeta}>{sessionSummary(session)}</Text>
            </Pressable>
          )
        })}
        {status === 'CanLoadMore' ? <Pressable accessibilityRole="button" onPress={() => loadMore(10)} style={styles.loadMore}><Text style={styles.loadMoreText}>Load older workouts</Text></Pressable> : null}
        {status === 'LoadingMore' ? <ActivityIndicator color={colors.accent} style={styles.loader} /> : null}
      </ScrollView>
      <Modal animationType="slide" onRequestClose={() => setSelected(null)} transparent visible={selected !== null}>
        <View style={styles.modalRoot}>
          <Pressable accessibilityLabel="Close workout details" onPress={() => setSelected(null)} style={styles.backdrop} />
          <View style={styles.sheet}>
            <View style={styles.handle} />
            <Text style={styles.kicker}>Logged workout</Text>
            <Text style={styles.sheetTitle}>{selected === null ? '' : new Date(`${selected.date}T12:00:00`).toLocaleDateString([], { day: 'numeric', month: 'long' })}</Text>
            <ScrollView contentContainerStyle={styles.sheetContent} showsVerticalScrollIndicator={false}>
              {selected?.blocks.map((block, blockIndex) => (
                <View key={block._id} style={styles.block}>
                  {block.types[0] !== 'standard' ? <Text style={styles.blockType}>{block.types.join(' · ')}</Text> : null}
                  {block.exercises.map((exercise) => (
                    <View key={exercise._id} style={styles.exercise}>
                      <Text style={styles.exerciseName}>{exercise.displayedName}</Text>
                      {exercise.canonicalName !== null && exercise.canonicalName !== exercise.displayedName ? <Text style={styles.canonical}>{exercise.canonicalName}</Text> : null}
                      {exercise.sets.map((set, index) => <Text key={`${exercise._id}-${index}`} style={styles.setText}>{index + 1}  {formatSet(set, exercise.weightUnit)}</Text>)}
                    </View>
                  ))}
                  {selected.blocks.length > 1 ? <Text style={styles.blockIndex}>Block {blockIndex + 1}</Text> : null}
                </View>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFill },
  block: { marginBottom: 18 },
  blockIndex: { color: colors.faint, fontFamily: typography.body, fontSize: 10, marginTop: 6 },
  blockType: { color: colors.faint, fontFamily: typography.body, fontSize: 10, fontWeight: '700', letterSpacing: 1.1, marginBottom: 8, textTransform: 'uppercase' },
  canonical: { color: colors.textMuted, fontFamily: typography.body, fontSize: 12, marginBottom: 8 },
  check: { alignItems: 'center', backgroundColor: 'rgba(34, 197, 94, 0.09)', borderRadius: 16, height: 32, justifyContent: 'center', width: 32 },
  checkText: { color: colors.accent, fontSize: 13 },
  content: { gap: 8, padding: 16, paddingBottom: 36 },
  empty: { alignSelf: 'center', marginTop: 110, maxWidth: 290 },
  emptyCopy: { color: colors.textMuted, fontFamily: typography.body, fontSize: 13, lineHeight: 21, textAlign: 'center' },
  emptyTitle: { color: colors.text, fontFamily: typography.body, fontSize: 24, fontWeight: '500', marginBottom: 9, textAlign: 'center' },
  exercise: { marginBottom: 12 },
  exerciseName: { color: colors.text, fontFamily: typography.body, fontSize: 21, fontWeight: '600', marginBottom: 3 },
  handle: { alignSelf: 'center', backgroundColor: colors.faint, borderRadius: 2, height: 4, marginBottom: 18, width: 36 },
  kicker: { color: colors.faint, fontFamily: typography.body, fontSize: 10, fontWeight: '700', letterSpacing: 1.3, marginBottom: 7, textAlign: 'center', textTransform: 'uppercase' },
  loadMore: { alignItems: 'center', borderColor: colors.border, borderRadius: 10, borderWidth: 1, justifyContent: 'center', marginTop: 8, minHeight: 46 },
  loadMoreText: { color: colors.textMuted, fontFamily: typography.body, fontSize: 13, fontWeight: '600' },
  loader: { marginVertical: 28 },
  modalRoot: { backgroundColor: 'rgba(0, 0, 0, 0.58)', flex: 1, justifyContent: 'flex-end', padding: 12 },
  pressed: { opacity: 0.74, transform: [{ scale: 0.99 }] },
  safeArea: { backgroundColor: colors.background, flex: 1 },
  session: { alignItems: 'center', backgroundColor: colors.surface, borderColor: colors.border, borderRadius: 13, borderWidth: 1, flexDirection: 'row', gap: 11, minHeight: 68, paddingHorizontal: 13, ...shadows.card },
  sessionCopy: { flex: 1 },
  sessionDate: { color: colors.faint, fontFamily: typography.body, fontSize: 9, fontWeight: '700', letterSpacing: 0.7, marginBottom: 3, textTransform: 'uppercase' },
  sessionMeta: { color: colors.accentMuted, fontFamily: typography.body, fontSize: 11 },
  sessionName: { color: colors.text, fontFamily: typography.body, fontSize: 14, fontWeight: '600' },
  setText: { backgroundColor: colors.inset, borderRadius: 8, color: colors.textMuted, fontFamily: typography.body, fontSize: 13, marginBottom: 5, paddingHorizontal: 10, paddingVertical: 8 },
  sheet: { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: 20, borderWidth: 1, maxHeight: '82%', padding: 20, ...shadows.card },
  sheetContent: { paddingBottom: 8 },
  sheetTitle: { color: colors.text, fontFamily: typography.body, fontSize: 28, fontWeight: '500', marginBottom: 16, textAlign: 'center' },
})
