import { z } from 'zod'

import { BLOCK_TYPES } from '../../lib/blockTypes'

const setSchema = z.object({
  reps: z.number().int().min(1).max(10000).optional(),
  weight: z.number().min(0).max(10000).optional(),
  duration: z.number().min(0).max(86400).optional(),
  distance: z.number().min(0).max(1000000).optional(),
})

const exerciseSchema = z.object({
  name: z.string().trim().min(1).max(200),
  exerciseId: z.string().min(1),
  proposedName: z.string().trim().min(1).max(200).optional(),
  sets: z.array(setSchema).min(1).max(100),
  order: z.number().int().min(0),
})

const blockSchema = z.object({
  type: z.enum(BLOCK_TYPES),
  exercises: z.array(exerciseSchema).min(1).max(50),
  intervalSeconds: z.number().int().min(1).max(86400).optional(),
  order: z.number().int().min(0),
})

export const toolCallSchema = z.object({
  blocks: z.array(blockSchema).min(1).max(50),
  needsClarification: z.boolean(),
})

export const createCustomExerciseSchema = z.object({
  name: z.string(),
  description: z.string(),
  category: z.string().optional(),
  equipment: z.string().optional(),
  muscleGroup: z.string().optional(),
  allMuscles: z.array(z.string()).optional(),
  aliases: z.array(z.string()).optional(),
})

export const newExerciseGuidanceInputSchema = z.object({
  rawPhrase: z.string().trim().min(1).max(200),
  candidates: z.array(z.object({
    exerciseId: z.string().min(1),
    canonicalName: z.string().trim().min(1).max(200),
    score: z.number(),
  })).max(5),
})

export const newExerciseGuidanceOutputSchema = z.discriminatedUnion('outcome', [
  z.object({ outcome: z.literal('resolved_existing'), exerciseId: z.string().min(1) }),
  z.object({ outcome: z.literal('resolved_custom') }),
  z.object({ outcome: z.literal('still_ambiguous') }),
])

const finiteNumber = z.number().finite()

export const calculateInputSchema = z.discriminatedUnion('operation', [
  z.object({
    operation: z.literal('oneRepMax'),
    formula: z.enum(['epley', 'brzycki']),
    weight: finiteNumber,
    reps: finiteNumber.int().min(1),
    weightUnit: z.enum(['kg', 'lbs']),
  }),
  z.object({
    operation: z.literal('percentOf1RM'),
    oneRepMax: finiteNumber,
    percent: finiteNumber.min(0).max(100),
  }),
  z.object({
    operation: z.literal('convertUnit'),
    value: finiteNumber,
    from: z.enum(['kg', 'lbs', 'km', 'miles']),
    to: z.enum(['kg', 'lbs', 'km', 'miles']),
  }),
  z.object({
    operation: z.literal('plateMath'),
    targetWeight: finiteNumber,
    barWeight: finiteNumber,
    weightUnit: z.enum(['kg', 'lbs']),
    availablePlates: z.array(finiteNumber.positive()).optional(),
  }),
  z.object({
    operation: z.literal('volumeTotal'),
    sets: z.array(z.object({ reps: finiteNumber, weight: finiteNumber })).min(1),
  }),
  z.object({
    operation: z.literal('paceConvert'),
    distance: finiteNumber,
    distanceUnit: z.enum(['km', 'miles']),
    duration: finiteNumber,
  }),
  z.object({
    operation: z.literal('expression'),
    expression: z.string().trim().min(1).max(500),
  }),
])

export type ToolCallData = z.infer<typeof toolCallSchema>
export type CreateCustomExerciseData = z.infer<typeof createCustomExerciseSchema>
export type NewExerciseGuidanceInput = z.infer<typeof newExerciseGuidanceInputSchema>
export type NewExerciseGuidanceOutput = z.infer<typeof newExerciseGuidanceOutputSchema>
export type CalculateInput = z.infer<typeof calculateInputSchema>

export type ToolCallValidation =
  | { isValid: true; parsedData: ToolCallData }
  | { isValid: false; parsedData: Record<string, unknown> }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function validateToolCall(args: unknown): ToolCallValidation {
  const result = toolCallSchema.safeParse(args)

  if (result.success) {
    return { isValid: true, parsedData: result.data }
  }

  return { isValid: false, parsedData: isRecord(args) ? args : {} }
}
