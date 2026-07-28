export type CardState = 'pending' | 'confirmed'

export interface ParsedSet {
  reps?: number
  weight?: number
  duration?: number
  distance?: number
}

export interface ParsedExercise {
  name: string
  exerciseId?: string
  aliasText?: string
  proposedName?: string
  sets: ParsedSet[]
  order: number
}

export interface ParsedBlock {
  type: 'standard' | 'superset' | 'dropset' | 'emom' | 'pyramid' | 'circuit' | 'amrap'
  exercises: ParsedExercise[]
  intervalSeconds?: number
  order: number
}

export interface ParsedData {
  blocks: ParsedBlock[]
  needsClarification: boolean
}
