import { getAuthUserId } from '@convex-dev/auth/server'
import { v } from 'convex/values'

import { internal } from '../_generated/api'
import type { Id } from '../_generated/dataModel'
import { action } from '../_generated/server'
import {
  critiqueReplayResults,
  currentReplayTools,
  replayGeminiCall,
  type GeminiDebugPayload,
  type GeminiFunctionCall,
  type GeminiReplayVariant,
} from '../lib/gemini'
import { isDebugConsoleEnabled } from './config'

const replayVariants: GeminiReplayVariant[] = [
  'baseline',
  'without_get_data',
  'without_daily_summary',
  'explicit_greeting_rule',
  'hardened_get_data',
  'unambiguous_greeting',
]
const samplesPerVariant = 5
const experimentTokenBudget = 150_000

type ReplaySource =
  | { error: string }
  | { payload: string; source: 'captured' | 'reconstructed' }
type ReplayReservation =
  | { error: string }
  | { experimentId: Id<'debugReplayExperiments'> }
type RunExperimentResult =
  | { error: string }
  | { experimentId: Id<'debugReplayExperiments'> }
type ReplayCritiqueSource =
  | { error: string }
  | { snapshot: string; variants: Array<{ variant: string; sampleIndex: number; functionCalls: string; requestedFields: string[] }> }
type RunCritiqueResult = { error: string } | { critique: string }

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function parseSnapshot(payload: string, reconstructed: boolean): GeminiDebugPayload | null {
  try {
    const parsed: unknown = JSON.parse(payload)
    if (
      typeof parsed !== 'object'
      || parsed === null
      || !('model' in parsed)
      || typeof parsed.model !== 'string'
      || !('systemInstruction' in parsed)
      || typeof parsed.systemInstruction !== 'string'
      || !('history' in parsed)
      || !Array.isArray(parsed.history)
      || !('currentUserMessage' in parsed)
      || typeof parsed.currentUserMessage !== 'string'
      || !('availableTools' in parsed)
      || !Array.isArray(parsed.availableTools)
    ) return null
    const snapshot = parsed as GeminiDebugPayload
    if (!reconstructed) return snapshot
    const guideActive = snapshot.availableTools.some((tool) => tool.name === 'get_new_exercise_guidance')
    return { ...snapshot, availableTools: currentReplayTools(guideActive) }
  } catch {
    return null
  }
}

function requestedFields(functionCalls: GeminiFunctionCall[]): string[] {
  const fields = new Set<string>()
  for (const call of functionCalls) {
    if (call.name !== 'Get_data' || typeof call.args !== 'object' || call.args === null) continue
    const args = call.args as Record<string, unknown>
    for (const [key, value] of Object.entries(args)) {
      if (key === 'collectionPoints' && Array.isArray(value)) {
        for (const point of value) {
          if (typeof point === 'string') fields.add(`collectionPoints:${point}`)
        }
      } else if (typeof value === 'string') {
        fields.add(`${key}:${value}`)
      } else {
        fields.add(key)
      }
    }
  }
  return [...fields].sort()
}

export const runExperiment = action({
  args: { messageId: v.id('messages') },
  handler: async (ctx, args): Promise<RunExperimentResult> => {
    if (!isDebugConsoleEnabled()) return { error: 'Eco Debug Console is disabled.' }
    const authUserId = await getAuthUserId(ctx)
    if (authUserId === null) return { error: 'Not authenticated.' }
    const source: ReplaySource = await ctx.runQuery(internal.debug.events.getReplaySource, {
      authUserId,
      messageId: args.messageId,
    })
    if ('error' in source) return { error: source.error }
    const snapshot = parseSnapshot(source.payload, source.source === 'reconstructed')
    if (snapshot === null) return { error: 'The Call 0 request snapshot could not be reconstructed.' }
    const reservation: ReplayReservation = await ctx.runMutation(internal.debug.events.reserveReplayExperiment, {
      authUserId,
      messageId: args.messageId,
      snapshotSource: source.source,
    })
    if ('error' in reservation) return { error: reservation.error }
    const experimentId = reservation.experimentId
    let experimentTokens = 0
    try {
      for (const variant of replayVariants) {
        const samples = await Promise.all(
          Array.from({ length: samplesPerVariant }, async (_, sampleIndex) => {
            const startedAt = Date.now()
            try {
              const response = await replayGeminiCall(snapshot, variant)
              return {
                experimentId,
                variant,
                sampleIndex,
                rawText: response.rawText,
                finalText: response.text,
                functionCalls: JSON.stringify(response.functionCalls),
                getDataSelected: response.functionCalls.some((call) => call.name === 'Get_data'),
                requestedFields: requestedFields(response.functionCalls),
                promptTokens: response.usage.prompt,
                outputTokens: response.usage.output,
                totalTokens: response.usage.total,
                durationMs: Date.now() - startedAt,
              }
            } catch (error) {
              return {
                experimentId,
                variant,
                sampleIndex,
                rawText: '',
                finalText: '',
                functionCalls: '[]',
                getDataSelected: false,
                requestedFields: [],
                totalTokens: 0,
                durationMs: Date.now() - startedAt,
                error: errorMessage(error),
              }
            }
          }),
        )
        for (const sample of samples) {
          await ctx.runMutation(internal.debug.events.recordReplayResult, sample)
          experimentTokens += sample.totalTokens
        }
        if (experimentTokens >= experimentTokenBudget) {
          await ctx.runMutation(internal.debug.events.finishReplayExperiment, {
            experimentId,
            status: 'failed',
            error: `The replay suite stopped at its ${experimentTokenBudget.toLocaleString()}-token development budget.`,
          })
          return { error: `Replay stopped at the ${experimentTokenBudget.toLocaleString()}-token budget.` }
        }
      }
      await ctx.runMutation(internal.debug.events.finishReplayExperiment, {
        experimentId,
        status: 'completed',
      })
      return { experimentId }
    } catch (error) {
      const message = errorMessage(error)
      await ctx.runMutation(internal.debug.events.finishReplayExperiment, {
        experimentId,
        status: 'failed',
        error: message,
      })
      return { error: message }
    }
  },
})

export const runCritique = action({
  args: { experimentId: v.id('debugReplayExperiments') },
  handler: async (ctx, args): Promise<RunCritiqueResult> => {
    if (!isDebugConsoleEnabled()) return { error: 'Eco Debug Console is disabled.' }
    const authUserId = await getAuthUserId(ctx)
    if (authUserId === null) return { error: 'Not authenticated.' }
    const source: ReplayCritiqueSource = await ctx.runQuery(internal.debug.events.getReplayCritiqueSource, {
      authUserId,
      experimentId: args.experimentId,
    })
    if ('error' in source) return { error: source.error }
    const critique = await critiqueReplayResults(JSON.stringify(source))
    await ctx.runMutation(internal.debug.events.saveReplayCritique, {
      experimentId: args.experimentId,
      critique: critique.critique,
      critiqueTokens: critique.usage.total,
    })
    return { critique: critique.critique }
  },
})
