import type { Card } from '@/types/db'

export interface ExerciseDisplay {
  exerciseId: string
  displayedName: string
  canonicalName: string | null
}

export type PresentedCard = Card & { exerciseDisplay: ExerciseDisplay[] }

export interface HistoryExercise {
  _id: string
  canonicalName: string | null
  displayedName: string
  order: number
  sets: Array<{ reps?: number; weight?: number; duration?: number; distance?: number }>
  weightUnit: 'kg' | 'lbs'
}

export interface HistoryBlock {
  _id: string
  exercises: HistoryExercise[]
  intervalSeconds?: number
  order: number
  types: string[]
}

export interface HistorySession {
  _id: string
  blocks: HistoryBlock[]
  date: string
  notes?: string
}
