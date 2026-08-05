import { useEffect, useMemo, useState, type ReactElement } from 'react'
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { useMutation } from 'convex/react'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import Animated, { runOnJS, useAnimatedStyle, useReducedMotion, useSharedValue, withRepeat, withSequence, withSpring, withTiming } from 'react-native-reanimated'

import { colors, shadows, typography } from '@/components/ui/theme'
import { api } from '@/convex/_generated/api'
import type { Card } from '@/types/db'
import type { ParsedData, ParsedExercise, ParsedSet } from '@/types/cards'
import type { PresentedCard } from '@/types/presentation'
import { useMotion } from '@/hooks/useMotion'

interface WorkoutCardProps {
  card: PresentedCard
  distanceUnit?: 'km' | 'miles'
  hideRow?: boolean
  isOpen?: boolean
  onAskEco: (cardId: Card['_id']) => Promise<void>
  onClose?: () => void
  onOpen?: (cardId: Card['_id']) => void
  weightUnit?: 'kg' | 'lbs'
}

type MetricType = 'reps' | 'distance' | 'none'

function isParsedData(value: unknown): value is ParsedData {
  return typeof value === 'object' && value !== null && 'blocks' in value && Array.isArray(value.blocks)
}

function countExercises(data: ParsedData): number {
  return data.blocks.reduce((total, block) => total + block.exercises.length, 0)
}

function countSets(data: ParsedData): number {
  return data.blocks.reduce((total, block) => total + block.exercises.reduce((sum, exercise) => sum + exercise.sets.length, 0), 0)
}

function formatDuration(seconds: number | undefined): string {
  if (seconds === undefined) return ''
  const minutes = Math.floor(seconds / 60)
  return `${minutes}:${String(Math.round(seconds % 60)).padStart(2, '0')}`
}

function parseDuration(value: string): number | undefined {
  if (value.trim() === '') return undefined
  const parts = value.split(':').map((part) => Number.parseFloat(part))
  if (parts.some(Number.isNaN)) return undefined
  return parts.length === 2 ? (parts[0] ?? 0) * 60 + (parts[1] ?? 0) : parts[0]
}

function paceFor(exercise: ParsedExercise, distanceUnit: string): string | null {
  const set = exercise.sets.find((candidate) => candidate.distance !== undefined && candidate.duration !== undefined)
  if (set?.distance === undefined || set.duration === undefined || set.distance <= 0) return null
  const pace = set.duration / set.distance
  return `${Math.floor(pace / 60)}:${String(Math.round(pace % 60)).padStart(2, '0')} / ${distanceUnit}`
}

interface MetricSelectorProps {
  exercise: ParsedExercise
  onMetricChange: (type: MetricType) => void
  onTimeChange: (enabled: boolean) => void
}

function MetricSelector({ exercise, onMetricChange, onTimeChange }: MetricSelectorProps): ReactElement {
  const metric: MetricType = exercise.sets.some((set) => set.distance !== undefined) ? 'distance' : exercise.sets.some((set) => set.reps !== undefined) ? 'reps' : 'none'
  const timeOn = exercise.sets.some((set) => set.duration !== undefined)
  return (
    <View style={styles.metricSelector}>
      <Pressable accessibilityRole="button" accessibilityState={{ selected: timeOn }} onPress={() => onTimeChange(!timeOn)} style={[styles.timeButton, timeOn && styles.selectorSelected]}><Text style={[styles.selectorText, timeOn && styles.selectorTextSelected]}>Time</Text></Pressable>
      <Text style={styles.plus}>+</Text>
      <View style={styles.metricChoices}>
        {(['reps', 'distance', 'none'] as const).map((type) => <Pressable key={type} accessibilityRole="button" accessibilityState={{ selected: metric === type }} onPress={() => onMetricChange(type)} style={[styles.metricButton, metric === type && styles.selectorSelected]}><Text style={[styles.selectorText, metric === type && styles.selectorTextSelected]}>{type}</Text></Pressable>)}
      </View>
    </View>
  )
}

interface SetEditorProps {
  distanceUnit: 'km' | 'miles'
  index: number
  onChange: (field: keyof ParsedSet, value: number | undefined) => void
  onMove: (direction: -1 | 1) => void
  set: ParsedSet
  weightUnit: 'kg' | 'lbs'
}

function SetEditor({ distanceUnit, index, onChange, onMove, set, weightUnit }: SetEditorProps): ReactElement {
  const drag = Gesture.Pan().activeOffsetY([-8, 8]).onEnd((event) => {
    if (Math.abs(event.translationY) > 34) runOnJS(onMove)(event.translationY < 0 ? -1 : 1)
  })
  const fields: Array<{ field: keyof ParsedSet; label: string; value: string }> = []
  if (set.reps !== undefined) fields.push({ field: 'reps', label: 'Reps', value: String(set.reps) })
  if (set.distance !== undefined) fields.push({ field: 'distance', label: distanceUnit, value: String(set.distance) })
  if (set.duration !== undefined) fields.push({ field: 'duration', label: 'Time', value: formatDuration(set.duration) })
  fields.push({ field: 'weight', label: `Wt · ${weightUnit}`, value: set.weight === undefined || set.weight === 0 ? '' : String(set.weight) })

  return (
    <View style={styles.setRow}>
      <GestureDetector gesture={drag}>
        <Animated.View accessibilityLabel={`Drag set ${index + 1} to reorder`} style={styles.dragHandle}><Text style={styles.dragText}>⋮⋮</Text></Animated.View>
      </GestureDetector>
      <Text style={styles.setIndex}>{index + 1}</Text>
      <View style={styles.tileGroup}>
        {fields.map(({ field, label, value }) => (
          <View key={field} style={styles.tile}>
            <Text style={styles.tileLabel}>{label}</Text>
            <TextInput
              accessibilityLabel={`Set ${index + 1} ${label}`}
              keyboardAppearance="dark"
              keyboardType={field === 'duration' ? 'numbers-and-punctuation' : 'decimal-pad'}
              onChangeText={(text) => onChange(field, field === 'duration' ? parseDuration(text) : text.trim() === '' ? undefined : Number.parseFloat(text))}
              selectTextOnFocus
              style={styles.tileInput}
              value={value}
            />
          </View>
        ))}
      </View>
    </View>
  )
}

export function WorkoutCard({ card, distanceUnit = 'km', hideRow = false, isOpen, onAskEco, onClose, onOpen, weightUnit = 'kg' }: WorkoutCardProps): ReactElement | null {
  const parsedData = isParsedData(card.parsedData) ? card.parsedData : null
  const [localData, setLocalData] = useState<ParsedData | null>(parsedData)
  const [internalOpen, setInternalOpen] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const confirmCard = useMutation(api.functions.cards.confirmCard)
  const discardCard = useMutation(api.functions.cards.discardPendingCard)
  const translateX = useSharedValue(0)
  const translateY = useSharedValue(0)
  const pulse = useSharedValue(0.25)
  const reducedMotion = useReducedMotion()
  const motion = useMotion()
  const open = isOpen ?? internalOpen

  useEffect(() => {
    setLocalData(parsedData)
  }, [card._id, card.parsedData])

  useEffect(() => {
    if (card.state === 'pending' && !reducedMotion && !motion.reducedMotion) pulse.value = withRepeat(withSequence(withTiming(0.05, { duration: Math.round(motion.tokens.ambient * 0.45) }), withTiming(0.26, { duration: Math.round(motion.tokens.ambient * 0.55) })), -1, true)
    else pulse.value = 0
  }, [card.state, motion.reducedMotion, motion.tokens.ambient, pulse, reducedMotion])

  const close = (): void => {
    setError(null)
    if (onClose !== undefined) onClose()
    else setInternalOpen(false)
  }
  const show = (): void => {
    if (onOpen !== undefined) onOpen(card._id)
    else setInternalOpen(true)
  }

  const updateExercise = (blockIndex: number, exerciseIndex: number, updater: (exercise: ParsedExercise) => ParsedExercise): void => {
    setLocalData((current) => current === null ? current : ({ ...current, blocks: current.blocks.map((block, index) => index === blockIndex ? { ...block, exercises: block.exercises.map((exercise, itemIndex) => itemIndex === exerciseIndex ? updater(exercise) : exercise) } : block) }))
  }

  const setMetric = (blockIndex: number, exerciseIndex: number, type: MetricType): void => updateExercise(blockIndex, exerciseIndex, (exercise) => ({
    ...exercise,
    sets: exercise.sets.map((set) => {
      if (type === 'reps') return { ...set, distance: undefined, reps: set.reps ?? 1 }
      if (type === 'distance') return { ...set, distance: set.distance ?? 0, reps: undefined }
      return { ...set, distance: undefined, duration: set.duration ?? 0, reps: undefined }
    }),
  }))

  const setTime = (blockIndex: number, exerciseIndex: number, enabled: boolean): void => updateExercise(blockIndex, exerciseIndex, (exercise) => {
    const hasPrimaryMetric = exercise.sets.some((set) => set.reps !== undefined || set.distance !== undefined)
    if (!enabled && !hasPrimaryMetric) return exercise
    return { ...exercise, sets: exercise.sets.map((set) => ({ ...set, duration: enabled ? set.duration ?? 0 : undefined })) }
  })

  const updateSet = (blockIndex: number, exerciseIndex: number, setIndex: number, field: keyof ParsedSet, value: number | undefined): void => updateExercise(blockIndex, exerciseIndex, (exercise) => ({ ...exercise, sets: exercise.sets.map((set, index) => index === setIndex ? { ...set, [field]: value } : set) }))

  const moveSet = (blockIndex: number, exerciseIndex: number, setIndex: number, direction: -1 | 1): void => updateExercise(blockIndex, exerciseIndex, (exercise) => {
    const nextIndex = setIndex + direction
    if (nextIndex < 0 || nextIndex >= exercise.sets.length) return exercise
    const sets = [...exercise.sets]
    const current = sets[setIndex]
    const target = sets[nextIndex]
    if (current === undefined || target === undefined) return exercise
    sets[setIndex] = target
    sets[nextIndex] = current
    return { ...exercise, sets }
  })

  const handleConfirm = async (): Promise<void> => {
    if (localData === null || card.state !== 'pending') return
    setIsSubmitting(true)
    setError(null)
    try {
      const result = await confirmCard({ cardId: card._id, parsedData: localData })
      if ('error' in result) setError(result.error ?? 'Unable to confirm this workout')
      else close()
    } finally { setIsSubmitting(false) }
  }

  const handleDiscard = async (): Promise<void> => {
    setIsSubmitting(true)
    setError(null)
    try {
      const result = await discardCard({ cardId: card._id })
      if ('error' in result) setError(result.error ?? 'Unable to discard this card')
      else close()
    } finally { setIsSubmitting(false) }
  }

  const handleAskEco = async (): Promise<void> => {
    setIsSubmitting(true)
    try { await onAskEco(card._id); close() } finally { setIsSubmitting(false) }
  }

  const resetPosition = (): void => {
    translateX.value = reducedMotion ? 0 : withSpring(0, { damping: 18, stiffness: 190 })
    translateY.value = reducedMotion ? 0 : withSpring(0, { damping: 18, stiffness: 190 })
  }
  const finishGesture = (x: number, y: number): void => {
    if (x > 105 && Math.abs(y) < 85) void handleDiscard()
    else if (y < -95 && Math.abs(x) < 85) void handleConfirm()
    resetPosition()
  }
  const canGesture = card.state === 'pending' && !card.inDiscussion && !isSubmitting
  const cardGesture = Gesture.Pan().enabled(canGesture).activeOffsetX([-14, 14]).activeOffsetY([-14, 14]).onUpdate((event) => {
    translateX.value = Math.max(0, event.translationX * 0.55)
    translateY.value = Math.min(0, event.translationY * 0.42)
  }).onEnd((event) => runOnJS(finishGesture)(event.translationX, event.translationY))
  const sheetMotion = useAnimatedStyle(() => ({ transform: [{ translateX: translateX.value }, { translateY: translateY.value }, { rotate: `${translateX.value * 0.018}deg` }] }))
  const discardTint = useAnimatedStyle(() => ({ opacity: Math.min(0.22, translateX.value / 460) }))
  const confirmTint = useAnimatedStyle(() => ({ opacity: Math.min(0.18, Math.abs(translateY.value) / 390) }))
  const pulseStyle = useAnimatedStyle(() => ({ opacity: pulse.value, transform: [{ scale: 1 + pulse.value * 1.7 }] }))

  const firstExercise = localData?.blocks[0]?.exercises[0]
  const firstName = card.exerciseDisplay[0]?.displayedName ?? firstExercise?.name ?? 'Workout'
  const exerciseCount = localData === null ? 0 : countExercises(localData)
  const setCount = localData === null ? 0 : countSets(localData)
  const confirmedMeta = exerciseCount > 1 ? `${exerciseCount} exercises · ${setCount} sets` : `${setCount} ${setCount === 1 ? 'set' : 'sets'}`

  if (localData === null) return null

  return (
    <View style={styles.container}>
      {!hideRow ? <Pressable accessibilityLabel={card.state === 'pending' ? 'Open exercise confirmation' : `Open logged workout: ${firstName}`} accessibilityRole="button" onPress={show} style={({ pressed }) => [card.state === 'pending' ? styles.notification : styles.historyRow, pressed && styles.rowPressed]}>
        {card.state === 'pending' ? <View style={styles.dotWrap}><Animated.View style={[styles.dotPulse, pulseStyle]} /><View style={styles.notificationDot} /></View> : <Text style={styles.historyCheck}>✓</Text>}
        <Text numberOfLines={1} style={card.state === 'pending' ? styles.notificationLabel : styles.historyName}>{card.inDiscussion ? 'Discussing with Eco…' : card.state === 'pending' ? `${exerciseCount} ${exerciseCount === 1 ? 'exercise' : 'exercises'} ready to confirm` : firstName}</Text>
        {card.state === 'pending' ? <Text style={styles.chevron}>›</Text> : <Text style={styles.historyMeta}>{confirmedMeta}</Text>}
      </Pressable> : null}

      <Modal animationType={motion.reducedMotion ? 'none' : 'fade'} onRequestClose={close} transparent visible={open}>
        <View style={styles.modalRoot}>
          <Pressable accessibilityLabel="Close workout card" onPress={close} style={styles.backdrop} />
          <GestureDetector gesture={cardGesture}>
            <Animated.View style={[styles.sheet, card.state === 'pending' && styles.pendingSheet, sheetMotion]}>
              <Animated.View pointerEvents="none" style={[styles.swipeTint, styles.discardTint, discardTint]} />
              <Animated.View pointerEvents="none" style={[styles.swipeTint, styles.confirmTint, confirmTint]} />
              <View style={styles.sheetHandle} />
              <View style={styles.sheetHeader}>
                <Text style={styles.sheetLabel}>{card.state === 'pending' ? 'Confirm workout' : 'Logged workout'}</Text>
                {card.inDiscussion ? <Text style={styles.discussion}>Discussing with Eco…</Text> : null}
              </View>
              <ScrollView contentContainerStyle={styles.editorContent} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
                {localData.blocks.map((block, blockIndex) => block.exercises.map((exercise, exerciseIndex) => {
                  const displayIndex = localData.blocks.slice(0, blockIndex).reduce((total, item) => total + item.exercises.length, 0) + exerciseIndex
                  const display = card.exerciseDisplay[displayIndex]
                  const displayName = display?.displayedName ?? exercise.name
                  const pace = paceFor(exercise, distanceUnit)
                  return (
                    <View key={`${block.order}-${exercise.order}-${exerciseIndex}`} style={styles.exercise}>
                      <View style={styles.exerciseHeader}>
                        <View style={styles.exerciseCopy}>
                          <Text style={styles.exerciseLabel}>Exercise</Text>
                          {card.state === 'pending' ? <TextInput keyboardAppearance="dark" onChangeText={(name) => updateExercise(blockIndex, exerciseIndex, (item) => ({ ...item, name }))} style={styles.nameInput} value={exercise.name} /> : <Text style={styles.exerciseName}>{displayName}</Text>}
                          {display?.canonicalName !== null && display?.canonicalName !== undefined && display.canonicalName !== displayName ? <Text style={styles.canonicalName}>{display.canonicalName}</Text> : null}
                        </View>
                        <View style={styles.blockChip}><Text style={styles.blockChipText}>{block.exercises.length > 1 ? `${String.fromCharCode(65 + blockIndex)}${exerciseIndex + 1}` : String.fromCharCode(65 + blockIndex)}</Text></View>
                      </View>
                      {card.state === 'pending' ? <MetricSelector exercise={exercise} onMetricChange={(type) => setMetric(blockIndex, exerciseIndex, type)} onTimeChange={(enabled) => setTime(blockIndex, exerciseIndex, enabled)} /> : null}
                      {pace !== null ? <Text style={styles.pace}>Average pace · {pace}</Text> : null}
                      {card.state === 'pending' ? exercise.sets.map((set, setIndex) => <SetEditor key={setIndex} distanceUnit={distanceUnit} index={setIndex} onChange={(field, value) => updateSet(blockIndex, exerciseIndex, setIndex, field, value)} onMove={(direction) => moveSet(blockIndex, exerciseIndex, setIndex, direction)} set={set} weightUnit={weightUnit} />) : exercise.sets.map((set, setIndex) => <View key={setIndex} style={styles.readSet}><Text style={styles.setIndex}>{setIndex + 1}</Text><Text style={styles.readSetText}>{[set.reps === undefined ? null : `${set.reps} reps`, set.weight === undefined ? null : `${set.weight} ${weightUnit}`, set.distance === undefined ? null : `${set.distance} ${distanceUnit}`, set.duration === undefined ? null : formatDuration(set.duration)].filter(Boolean).join(' · ')}</Text></View>)}
                    </View>
                  )
                }))}
              </ScrollView>
              {error !== null ? <Text style={styles.error}>{error}</Text> : null}
              <View style={styles.actions}>
                {card.state === 'pending' && !card.inDiscussion ? <Pressable disabled={isSubmitting} onPress={() => void handleDiscard()} style={styles.discardButton}><Text style={styles.secondaryText}>Discard</Text></Pressable> : null}
                {!card.inDiscussion ? <Pressable disabled={isSubmitting} onPress={() => void handleAskEco()} style={styles.secondaryButton}><Text style={styles.secondaryText}>Ask Eco</Text></Pressable> : null}
                {card.state === 'pending' && !card.inDiscussion ? <Pressable disabled={isSubmitting} onPress={() => void handleConfirm()} style={[styles.confirmButton, isSubmitting && styles.disabled]}>{isSubmitting ? <ActivityIndicator color="#ffffff" /> : <Text style={styles.confirmText}>Confirm ✓</Text>}</Pressable> : null}
              </View>
              {canGesture ? <Text style={styles.gestureHint}>Swipe up to confirm · right to discard</Text> : null}
            </Animated.View>
          </GestureDetector>
        </View>
      </Modal>
    </View>
  )
}

const styles = StyleSheet.create({
  actions: { flexDirection: 'row', gap: 8, marginTop: 11 },
  backdrop: { ...StyleSheet.absoluteFill },
  blockChip: { alignItems: 'center', backgroundColor: colors.inset, borderColor: colors.border, borderRadius: 8, borderWidth: 1, height: 28, justifyContent: 'center', width: 30 },
  blockChipText: { color: colors.textMuted, fontFamily: typography.body, fontSize: 12, fontWeight: '700' },
  canonicalName: { color: colors.textMuted, fontFamily: typography.body, fontSize: 12, marginTop: 2 },
  chevron: { color: colors.faint, fontFamily: typography.body, fontSize: 18 },
  confirmButton: { alignItems: 'center', backgroundColor: colors.accent, borderRadius: 10, flex: 1, justifyContent: 'center', minHeight: 48, paddingHorizontal: 13, ...shadows.glow },
  confirmText: { color: '#ffffff', fontFamily: typography.body, fontSize: 14, fontWeight: '700' },
  confirmTint: { backgroundColor: colors.accent },
  container: { marginTop: 10, width: '100%' },
  disabled: { opacity: 0.58 },
  discardButton: { alignItems: 'center', borderColor: colors.border, borderRadius: 10, borderWidth: 1, justifyContent: 'center', minHeight: 48, paddingHorizontal: 13 },
  discardTint: { backgroundColor: colors.danger },
  discussion: { color: colors.accentMuted, fontFamily: typography.body, fontSize: 11 },
  dotPulse: { backgroundColor: colors.accent, borderRadius: 10, height: 20, position: 'absolute', width: 20 },
  dotWrap: { alignItems: 'center', height: 20, justifyContent: 'center', width: 20 },
  dragHandle: { alignItems: 'center', height: 44, justifyContent: 'center', width: 28 },
  dragText: { color: colors.faint, fontSize: 14, letterSpacing: -1 },
  editorContent: { paddingBottom: 2 },
  error: { color: '#fca5a5', fontFamily: typography.body, fontSize: 12, marginTop: 5 },
  exercise: { marginBottom: 18 },
  exerciseCopy: { flex: 1 },
  exerciseHeader: { alignItems: 'flex-start', flexDirection: 'row', gap: 10, justifyContent: 'space-between', marginBottom: 12 },
  exerciseLabel: { color: colors.faint, fontFamily: typography.body, fontSize: 10, fontWeight: '700', letterSpacing: 1.2, marginBottom: 3, textTransform: 'uppercase' },
  exerciseName: { color: colors.text, fontFamily: typography.body, fontSize: 28, fontWeight: '500', letterSpacing: 0.5 },
  gestureHint: { color: colors.faint, fontFamily: typography.body, fontSize: 10, marginTop: 9, textAlign: 'center' },
  historyCheck: { color: colors.accent, fontFamily: typography.body, fontSize: 13 },
  historyMeta: { color: '#2f8550', fontFamily: typography.body, fontSize: 11 },
  historyName: { color: colors.accentMuted, flex: 1, fontFamily: typography.body, fontSize: 14, fontWeight: '600' },
  historyRow: { alignItems: 'center', backgroundColor: '#0d1f13', borderColor: colors.accentDark, borderRadius: 10, borderWidth: 1, flexDirection: 'row', gap: 8, minHeight: 46, paddingHorizontal: 14 },
  metricButton: { alignItems: 'center', borderRadius: 7, flex: 1, justifyContent: 'center', minHeight: 38, paddingHorizontal: 4 },
  metricChoices: { backgroundColor: colors.inset, borderRadius: 10, flex: 1, flexDirection: 'row', gap: 4, padding: 4 },
  metricSelector: { alignItems: 'center', flexDirection: 'row', gap: 8, marginBottom: 11 },
  modalRoot: { backgroundColor: 'rgba(0, 0, 0, 0.58)', flex: 1, justifyContent: 'flex-end', padding: 12 },
  nameInput: { borderBottomColor: colors.accent, borderBottomWidth: 1, color: colors.text, fontFamily: typography.body, fontSize: 28, fontWeight: '500', minHeight: 44, paddingHorizontal: 0, paddingVertical: 2 },
  notification: { alignItems: 'center', backgroundColor: colors.surface, borderColor: colors.border, borderRadius: 12, borderWidth: 1, flexDirection: 'row', gap: 10, minHeight: 54, paddingHorizontal: 14, ...shadows.card },
  notificationDot: { backgroundColor: colors.accent, borderRadius: 5, height: 10, width: 10 },
  notificationLabel: { color: colors.text, flex: 1, fontFamily: typography.body, fontSize: 14, fontWeight: '600' },
  pace: { color: colors.accentMuted, fontFamily: typography.body, fontSize: 11, marginBottom: 8, marginTop: -3 },
  pendingSheet: { borderColor: 'rgba(34, 197, 94, 0.28)' },
  plus: { color: colors.faint, fontFamily: typography.body, fontSize: 20 },
  readSet: { alignItems: 'center', backgroundColor: colors.inset, borderRadius: 10, flexDirection: 'row', gap: 8, marginBottom: 7, minHeight: 44, paddingHorizontal: 10 },
  readSetText: { color: colors.textMuted, flex: 1, fontFamily: typography.body, fontSize: 13 },
  rowPressed: { opacity: 0.76, transform: [{ scale: 0.99 }] },
  secondaryButton: { alignItems: 'center', backgroundColor: colors.inset, borderRadius: 10, justifyContent: 'center', minHeight: 48, paddingHorizontal: 13 },
  secondaryText: { color: colors.textMuted, fontFamily: typography.body, fontSize: 13, fontWeight: '600' },
  selectorSelected: { backgroundColor: colors.accent },
  selectorText: { color: colors.textMuted, fontFamily: typography.body, fontSize: 10, fontWeight: '700', textTransform: 'uppercase' },
  selectorTextSelected: { color: '#ffffff' },
  setIndex: { color: colors.faint, fontFamily: typography.body, fontSize: 11, width: 17 },
  setRow: { alignItems: 'center', backgroundColor: colors.inset, borderRadius: 10, flexDirection: 'row', gap: 4, marginBottom: 8, padding: 6 },
  sheet: { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: 20, borderWidth: 1, maxHeight: '88%', overflow: 'hidden', padding: 20, ...shadows.card },
  sheetHandle: { alignSelf: 'center', backgroundColor: colors.faint, borderRadius: 2, height: 4, marginBottom: 16, width: 36 },
  sheetHeader: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', marginBottom: 13 },
  sheetLabel: { color: colors.faint, fontFamily: typography.body, fontSize: 10, fontWeight: '700', letterSpacing: 1.1, textTransform: 'uppercase' },
  swipeTint: { ...StyleSheet.absoluteFill, borderRadius: 20 },
  tile: { backgroundColor: colors.surface, borderRadius: 8, flex: 1, minHeight: 48, paddingHorizontal: 7, paddingVertical: 5 },
  tileGroup: { flex: 1, flexDirection: 'row', gap: 5 },
  tileInput: { color: colors.text, fontFamily: typography.body, fontSize: 16, fontWeight: '600', minHeight: 27, padding: 0 },
  tileLabel: { color: colors.faint, fontFamily: typography.body, fontSize: 7, fontWeight: '700', letterSpacing: 0.7, textTransform: 'uppercase' },
  timeButton: { alignItems: 'center', backgroundColor: colors.inset, borderRadius: 9, justifyContent: 'center', minHeight: 46, minWidth: 64, paddingHorizontal: 12 },
})
