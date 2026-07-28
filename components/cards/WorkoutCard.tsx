import { useEffect, useState, type ReactElement } from 'react'
import { Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import { useMutation } from 'convex/react'

import { api } from '@/convex/_generated/api'
import type { Card } from '@/types/db'
import type { ParsedData, ParsedExercise, ParsedSet } from '@/types/cards'

interface WorkoutCardProps {
  card: Card & { exerciseDisplay: ExerciseDisplay[] }
  onAskEco: (cardId: Card['_id']) => Promise<void>
}

interface ExerciseDisplay {
  displayedName: string
  canonicalName: string | null
}

interface ExerciseRowProps {
  exercise: ParsedExercise
  exerciseDisplay?: ExerciseDisplay
  isEditing: boolean
  onNameChange: (name: string) => void
  onSetChange: (setIndex: number, field: keyof ParsedSet, value: string) => void
}

interface SetRowProps {
  set: ParsedSet
  setNumber: number
  isEditing: boolean
  onChange: (field: keyof ParsedSet, value: string) => void
}

function isParsedData(value: unknown): value is ParsedData {
  return typeof value === 'object' && value !== null && 'blocks' in value && Array.isArray(value.blocks)
}

function SetRow({ set, setNumber, isEditing, onChange }: SetRowProps): ReactElement {
  const parts: Array<{ field: keyof ParsedSet; label: string; value: number }> = []
  if (set.reps !== undefined) parts.push({ field: 'reps', label: 'Reps', value: set.reps })
  if (set.weight !== undefined) parts.push({ field: 'weight', label: 'Wt · kg', value: set.weight })
  if (set.duration !== undefined) parts.push({ field: 'duration', label: 'Time · s', value: set.duration })
  if (set.distance !== undefined) parts.push({ field: 'distance', label: 'Km', value: set.distance })

  return (
    <View style={styles.setRow}>
      <Text style={styles.setNumber}>{setNumber}</Text>
      <View style={styles.tileGroup}>
        {parts.map((part) => (
          <View key={part.field} style={styles.tile}>
            <Text style={styles.tileLabel}>{part.label}</Text>
          {isEditing ? (
            <TextInput
              keyboardType="numeric"
              onChangeText={(value) => onChange(part.field, value)}
              style={styles.setInput}
              value={String(part.value)}
            />
          ) : (
            <Text style={styles.tileValue}>{part.value}</Text>
          )}
          </View>
        ))}
      </View>
    </View>
  )
}

function ExerciseRow({ exercise, exerciseDisplay, isEditing, onNameChange, onSetChange }: ExerciseRowProps): ReactElement {
  const displayedName = exerciseDisplay?.displayedName ?? exercise.name
  const canonicalName = exerciseDisplay?.canonicalName
  const showsCanonicalName = canonicalName !== null && canonicalName !== undefined && displayedName !== canonicalName

  return (
    <View style={styles.exercise}>
      {isEditing ? (
        <TextInput onChangeText={onNameChange} style={styles.nameInput} value={exercise.name} />
      ) : (
        <>
          <Text style={styles.exerciseName}>{displayedName}</Text>
          {showsCanonicalName ? <Text style={styles.canonicalName}>{canonicalName}</Text> : null}
        </>
      )}
      {exercise.sets.map((set, setIndex) => (
        <SetRow
          key={setIndex}
          isEditing={isEditing}
          onChange={(field, value) => onSetChange(setIndex, field, value)}
          set={set}
          setNumber={setIndex + 1}
        />
      ))}
    </View>
  )
}

export function WorkoutCard({ card, onAskEco }: WorkoutCardProps): ReactElement | null {
  const parsedData = isParsedData(card.parsedData) ? card.parsedData : null
  const [localData, setLocalData] = useState<ParsedData | null>(parsedData)
  const [isEditing, setIsEditing] = useState(false)
  const [isSheetOpen, setIsSheetOpen] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const confirmCard = useMutation(api.functions.cards.confirmCard)

  useEffect(() => {
    setLocalData(parsedData)
    setIsEditing(false)
  }, [card._id, card.parsedData])

  if (localData === null) return null

  const updateExerciseName = (blockIndex: number, exerciseIndex: number, name: string): void => {
    setLocalData((current) => {
      if (current === null) return current
      return {
        ...current,
        blocks: current.blocks.map((block, index) =>
          index !== blockIndex
            ? block
            : { ...block, exercises: block.exercises.map((exercise, itemIndex) => itemIndex === exerciseIndex ? { ...exercise, name } : exercise) },
        ),
      }
    })
  }

  const updateSet = (blockIndex: number, exerciseIndex: number, setIndex: number, field: keyof ParsedSet, value: string): void => {
    const number = Number.parseFloat(value)
    setLocalData((current) => {
      if (current === null) return current
      return {
        ...current,
        blocks: current.blocks.map((block, index) =>
          index !== blockIndex
            ? block
            : {
                ...block,
                exercises: block.exercises.map((exercise, itemIndex) =>
                  itemIndex !== exerciseIndex
                    ? exercise
                    : { ...exercise, sets: exercise.sets.map((set, itemSetIndex) => itemSetIndex === setIndex ? { ...set, [field]: Number.isNaN(number) ? undefined : number } : set) },
                ),
              },
        ),
      }
    })
  }

  const handleConfirm = async (): Promise<void> => {
    setIsSubmitting(true)
    setError(null)
    try {
      const result = await confirmCard({ cardId: card._id, parsedData: localData })
      if ('error' in result) setError(result.error ?? 'Unable to confirm this workout')
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleAskEco = async (): Promise<void> => {
    setIsSubmitting(true)
    setError(null)
    try {
      await onAskEco(card._id)
    } finally {
      setIsSubmitting(false)
    }
  }

  const isPending = card.state === 'pending'
  const firstExercise = localData.blocks[0]?.exercises[0]
  const firstExerciseDisplayName = card.exerciseDisplay[0]?.displayedName ?? firstExercise?.name
  const setCount = localData.blocks.reduce((count, block) =>
    count + block.exercises.reduce((exerciseCount, exercise) => exerciseCount + exercise.sets.length, 0), 0)
  const summary = firstExercise === undefined
    ? 'Workout'
    : `${firstExerciseDisplayName} · ${setCount} ${setCount === 1 ? 'set' : 'sets'}`
  return (
    <View style={styles.container}>
      <Pressable
        accessibilityLabel={isPending ? 'Open exercise confirmation' : `Open logged workout: ${summary}`}
        accessibilityRole="button"
        onPress={() => setIsSheetOpen(true)}
        style={isPending ? styles.notification : styles.historyRow}
      >
        {isPending ? <View style={styles.notificationDot} /> : <Text style={styles.historyCheck}>✓</Text>}
        <Text style={isPending ? styles.notificationLabel : styles.historyName}>
          {card.inDiscussion ? 'Discussing with Eco…' : isPending ? '1 exercise ready to confirm' : firstExerciseDisplayName ?? 'Workout'}
        </Text>
        {isPending ? <Text style={styles.chevron}>›</Text> : <Text style={styles.historyMeta}>{summary.split(' · ')[1] ?? ''}</Text>}
      </Pressable>
      <Modal animationType="slide" onRequestClose={() => setIsSheetOpen(false)} transparent visible={isSheetOpen}>
        <View style={styles.modalRoot}>
          <Pressable onPress={() => setIsSheetOpen(false)} style={styles.backdrop} />
          <View style={[styles.card, isPending && styles.pendingCard]}>
            <View style={styles.sheetHandle} />
            <View style={styles.header}>
              <Text style={styles.label}>{isPending ? 'Confirm workout' : 'Logged'}</Text>
              {card.inDiscussion ? <Text style={styles.discussion}>Discussing with Eco...</Text> : null}
            </View>
            {localData.blocks.map((block, blockIndex) => (
              <View key={`${block.order}-${blockIndex}`} style={styles.block}>
                {block.type !== 'standard' ? <Text style={styles.blockType}>{block.type}</Text> : null}
                {block.exercises.map((exercise, exerciseIndex) => (
                  <ExerciseRow
                    key={`${exercise.order}-${exerciseIndex}`}
                    exercise={exercise}
                    exerciseDisplay={card.exerciseDisplay[localData.blocks.slice(0, blockIndex).reduce((count, previousBlock) => count + previousBlock.exercises.length, 0) + exerciseIndex]}
                    isEditing={isEditing}
                    onNameChange={(name) => updateExerciseName(blockIndex, exerciseIndex, name)}
                    onSetChange={(setIndex, field, value) => updateSet(blockIndex, exerciseIndex, setIndex, field, value)}
                  />
                ))}
              </View>
            ))}
            {error ? <Text style={styles.error}>{error}</Text> : null}
            <View style={styles.actions}>
              {isPending ? <Pressable disabled={isSubmitting} onPress={handleConfirm} style={[styles.confirmButton, isSubmitting && styles.disabledButton]}><Text style={styles.confirmText}>Confirm ✓</Text></Pressable> : null}
              {isPending ? <Pressable disabled={isSubmitting} onPress={() => setIsEditing((current) => !current)} style={styles.secondaryButton}><Text style={styles.secondaryText}>{isEditing ? 'Done' : 'Edit'}</Text></Pressable> : null}
              {!card.inDiscussion ? <Pressable disabled={isSubmitting} onPress={handleAskEco} style={styles.secondaryButton}><Text style={styles.secondaryText}>Ask Eco</Text></Pressable> : null}
            </View>
          </View>
        </View>
      </Modal>
    </View>
  )
}

const styles = StyleSheet.create({
  actions: { flexDirection: 'row', gap: 8, marginTop: 8 },
  block: { marginBottom: 8 },
  blockType: { color: '#92908b', fontFamily: 'serif', fontSize: 11, letterSpacing: 0.7, marginBottom: 6, textTransform: 'uppercase' },
  backdrop: { ...StyleSheet.absoluteFill },
  card: { backgroundColor: '#302f2c', borderColor: 'rgba(255, 255, 255, 0.08)', borderRadius: 20, borderWidth: 1, padding: 20, width: '100%' },
  chevron: { color: '#696762', fontFamily: 'serif', fontSize: 18 },
  confirmButton: { alignItems: 'center', backgroundColor: '#22c55e', borderRadius: 10, flex: 1, justifyContent: 'center', minHeight: 44, paddingHorizontal: 14 },
  confirmText: { color: '#ffffff', fontFamily: 'serif', fontSize: 14, fontWeight: '700' },
  container: { marginTop: 10, width: '100%' },
  canonicalName: { color: '#b0aea8', fontFamily: 'serif', fontSize: 12, marginBottom: 5, marginTop: -3 },
  disabledButton: { opacity: 0.6 },
  discussion: { color: '#b0aea8', fontFamily: 'serif', fontSize: 12 },
  error: { color: '#ec9c91', fontFamily: 'serif', fontSize: 12, marginTop: 4 },
  exercise: { marginBottom: 8 },
  exerciseName: { color: '#f0efeb', fontFamily: 'serif', fontSize: 15, fontWeight: '600', marginBottom: 5 },
  header: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 12 },
  historyCheck: { color: '#4ade80', fontFamily: 'serif', fontSize: 13 },
  historyMeta: { color: '#4ade80', fontFamily: 'serif', fontSize: 12 },
  historyName: { color: '#4ade80', flex: 1, fontFamily: 'serif', fontSize: 14, fontWeight: '600' },
  historyRow: { alignItems: 'center', backgroundColor: '#0d1f13', borderColor: '#14532d', borderRadius: 10, borderWidth: 1, flexDirection: 'row', gap: 8, minHeight: 44, paddingHorizontal: 14 },
  label: { color: '#b0aea8', fontFamily: 'serif', fontSize: 11, letterSpacing: 0.7, textTransform: 'uppercase' },
  nameInput: { borderBottomColor: '#55534d', borderBottomWidth: 1, color: '#f0efeb', fontFamily: 'serif', fontSize: 15, fontWeight: '600', marginBottom: 5, minHeight: 36, paddingVertical: 3 },
  modalRoot: { backgroundColor: 'rgba(0, 0, 0, 0.45)', flex: 1, justifyContent: 'flex-end', padding: 12 },
  notification: { alignItems: 'center', backgroundColor: '#302f2c', borderColor: 'rgba(255, 255, 255, 0.08)', borderRadius: 12, borderWidth: 1, flexDirection: 'row', gap: 12, minHeight: 52, paddingHorizontal: 16 },
  notificationDot: { backgroundColor: '#22c55e', borderRadius: 5, height: 10, width: 10 },
  notificationLabel: { color: '#eeeeee', flex: 1, fontFamily: 'serif', fontSize: 14, fontWeight: '600' },
  pendingCard: { borderColor: 'rgba(34, 197, 94, 0.32)' },
  secondaryButton: { alignItems: 'center', backgroundColor: '#35332f', borderRadius: 8, justifyContent: 'center', minHeight: 44, paddingHorizontal: 14 },
  secondaryText: { color: '#f0efeb', fontFamily: 'serif', fontSize: 14 },
  setInput: { borderBottomColor: '#5e5b54', borderBottomWidth: 1, color: '#f0efeb', fontFamily: 'serif', fontSize: 16, minWidth: 34, paddingVertical: 2, textAlign: 'center' },
  setNumber: { color: '#87847d', fontFamily: 'serif', fontSize: 13, width: 20 },
  setRow: { alignItems: 'center', backgroundColor: '#252420', borderRadius: 10, flexDirection: 'row', gap: 8, marginBottom: 6, padding: 8 },
  tile: { backgroundColor: '#302f2c', borderRadius: 8, flex: 1, minHeight: 44, paddingHorizontal: 8, paddingVertical: 6 },
  tileGroup: { flex: 1, flexDirection: 'row', gap: 6 },
  tileLabel: { color: '#a8a5a0', fontFamily: 'serif', fontSize: 8, fontWeight: '700', letterSpacing: 0.8, textTransform: 'uppercase' },
  tileValue: { color: '#eeeeee', fontFamily: 'serif', fontSize: 17, fontWeight: '600' },
  sheetHandle: { alignSelf: 'center', backgroundColor: '#696762', borderRadius: 2, height: 4, marginBottom: 16, width: 36 },
})
