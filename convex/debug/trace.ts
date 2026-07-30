import { makeFunctionReference } from 'convex/server'

import type { Id } from '../_generated/dataModel'
import type { ActionCtx } from '../_generated/server'
import { isDebugConsoleEnabled } from './config'

export type DebugEventInput = {
  userId: Id<'profiles'>
  chatId: Id<'chats'>
  messageId: Id<'messages'>
  runId: string
  kind:
    | 'lifecycle'
    | 'context'
    | 'gemini'
    | 'tool'
    | 'validation'
    | 'database'
    | 'error'
    | 'warning'
  status: 'info' | 'running' | 'success' | 'warning' | 'error' | 'skipped'
  title: string
  summary?: string
  source: { file: string; symbol: string }
  details?: string
  callIndex?: number
  toolName?: string
  durationMs?: number
  tokens?: { prompt?: number; output?: number; total: number }
  warningCodes?: string[]
  occurredAt?: number
}

type DebugRecordArgs = DebugEventInput & {
  warningCodes: string[]
  occurredAt: number
}

const recordEventReference = makeFunctionReference<
  'mutation',
  DebugRecordArgs,
  number | null
>('debug/events:recordEvent')

export async function recordDebugEvent(
  ctx: ActionCtx,
  event: DebugEventInput,
): Promise<number | null> {
  if (!isDebugConsoleEnabled()) return null
  try {
    return await ctx.runMutation(recordEventReference, {
      ...event,
      warningCodes: event.warningCodes ?? [],
      occurredAt: event.occurredAt ?? Date.now(),
    })
  } catch (error) {
    console.error('Eco Debug Console could not record an event.', error)
    return null
  }
}

export function createDebugRunId(
  messageId: Id<'messages'>,
  startedAt: number,
): string {
  return `${messageId}:${startedAt}`
}
