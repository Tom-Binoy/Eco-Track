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
  exerciseId: z.string().optional(),
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

export type ToolCallData = z.infer<typeof toolCallSchema>

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
