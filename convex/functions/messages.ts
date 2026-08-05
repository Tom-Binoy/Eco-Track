import { getAuthUserId } from '@convex-dev/auth/server'
import { makeFunctionReference } from 'convex/server'
import { v } from 'convex/values'

import { internal } from '../_generated/api'
import type { Doc, Id } from '../_generated/dataModel'
import { action, internalMutation, internalQuery, query } from '../_generated/server'
import {
  beginGeminiTurn,
  buildGeminiDebugPayload,
  continueGeminiTurn,
  getNewExerciseGuidance,
  resumeGeminiTurnForFailover,
  type GeminiContext,
  type GeminiResponse,
  type GeminiTurn,
  type LeanContext,
} from '../lib/gemini'
import { EXERCISE_NAMING_GUIDANCE } from '../lib/prompts/ecoSystem'
import { executeCalculate } from '../lib/calculate'
import { toolResultSummary, type ToolTraceStatus } from '../lib/toolSummary'
import { createCustomExerciseSchema, newExerciseGuidanceInputSchema, type ToolCallData, validateToolCall } from '../lib/validation'
import { serialiseDebugDetails, serialiseDebugError } from '../debug/sanitise'
import { createDebugRunId, recordDebugEvent, type DebugEventInput } from '../debug/trace'
import { DEBUG_WARNING, workoutEvidenceWarning } from '../debug/warnings'

const recentMessageLimit = 50
const guideMarker = 'exercise_naming_guide_active'
const responseUnavailableText = 'Eco could not respond right now. Please try again.'
const followUpRequestLimit = 5
const followUpLimitFallback = 'Let’s pause there for now. What would you like to focus on next?'
type TurnContext = GeminiContext & { chat: Doc<'chats'>; cacheIsFresh: boolean }
type TurnResult = { ecoText: string; cardId?: Id<'cards'>; error?: string }
type CachedContext = LeanContext
type LiveRuntimeConfig = { workflow: 'chat'; modelId: string; systemPrompt: string; poolIds: Id<'debugLiveGeminiPools'>[]; cacheEnabled: boolean; cacheTtlSeconds: number; source: 'default' | 'published'; configId?: string }
const getLiveRuntimeConfig = makeFunctionReference<'query', Record<string, never>, LiveRuntimeConfig>('debug/liveGemini:getActiveForTurn')
type LiveReservation = { apiKey?: string; reservationId?: Id<'debugLiveGeminiReservations'>; poolId?: Id<'debugLiveGeminiPools'>; poolName?: string; error?: string }
const reserveLiveGemini = makeFunctionReference<'mutation', { workflow: 'chat'; modelId: string; poolIds: Id<'debugLiveGeminiPools'>[]; requestCount: number; excludedPoolIds?: Id<'debugLiveGeminiPools'>[] }, LiveReservation>('debug/liveGemini:reserve')
const releaseLiveGemini = makeFunctionReference<'mutation', { reservationId: Id<'debugLiveGeminiReservations'>; usedRequests: number; totalTokens: number }, null>('debug/liveGemini:releaseReservation')
const markLiveReservationRateLimited = makeFunctionReference<'mutation', { reservationId: Id<'debugLiveGeminiReservations'>; usedRequests: number; totalTokens: number }, null>('debug/liveGemini:markReservationRateLimited')

function compressionSafeToolBlock(block: Doc<'messageBlocks'>): Doc<'messageBlocks'> {
  return block.toolName === 'search_exercise_library'
    ? { ...block, content: block.content.replace(/Library Exercise \d+ — ([^—;\n]+)(?: — [^;\n]+)?/g, '$1') }
    : block
}

function leanContext(profile: Doc<'profiles'>, workoutContext: Doc<'workoutContext'> | null): LeanContext {
  return { name: profile.name, tonePreference: profile.tonePreference, weightUnit: profile.weightUnit, distanceUnit: profile.distanceUnit, activeInjuries: profile.injuries.filter((injury) => injury.status !== 'resolved'), workoutContext: workoutContext?.content ?? null }
}
function errorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error) }
function isProviderRateLimit(error: unknown): boolean {
  if (typeof error === 'object' && error !== null && 'status' in error && (error as { status?: unknown }).status === 429) return true
  return /(?:^|\D)429(?:\D|$)|resource[_ ]?exhausted|rate limit/i.test(errorMessage(error))
}
function responseDetails(response: GeminiResponse): string {
  return serialiseDebugDetails({
    rawText: response.rawText,
    finalText: response.text,
    functionCalls: response.functionCalls,
    usage: response.usage,
  })
}
function toolResultHasError(value: object): boolean {
  return 'error' in value && value.error !== undefined && value.error !== null
}
function isConcreteGetDataRequest(request: Record<string, unknown>): boolean {
  const hasCollectionPoints = Array.isArray(request.collectionPoints) && request.collectionPoints.some((point) => typeof point === 'string')
  const hasDailySummaryDate = typeof request.dailySummaryDate === 'string' && request.dailySummaryDate.length > 0
  const hasExerciseId = typeof request.exerciseId === 'string' && request.exerciseId.length > 0
  const hasDateRange = typeof request.dateRange === 'object' && request.dateRange !== null
    && 'startDate' in request.dateRange && typeof request.dateRange.startDate === 'string' && request.dateRange.startDate.length > 0
    && 'endDate' in request.dateRange && typeof request.dateRange.endDate === 'string' && request.dateRange.endDate.length > 0
  return hasCollectionPoints || hasDailySummaryDate || hasExerciseId || hasDateRange
}
function dataLookupFallback(result: object): string {
  const profile = 'profile' in result && typeof result.profile === 'object' && result.profile !== null
    ? result.profile
    : null
  const name = profile !== null && 'name' in profile && typeof profile.name === 'string'
    ? profile.name.trim()
    : ''
  return name.length > 0
    ? `Hey ${name}! I’m here. How has your training been feeling lately?`
    : 'I’m here. How has your training been feeling lately?'
}
function withTurnControl(
  result: Record<string, unknown>,
  completedFollowUpRequests: number,
): Record<string, unknown> {
  const remainingFollowUpRequests = Math.max(followUpRequestLimit - completedFollowUpRequests, 0)
  return {
    ...result,
    _ecoTurnControl: {
      freshTurnFollowUpLimit: followUpRequestLimit,
      completedFollowUpRequests,
      remainingFollowUpRequests,
      instruction: remainingFollowUpRequests === 0
        ? 'This is the fifth and final follow-up for this turn. Reply naturally to the user now. Do not request another tool.'
        : `${remainingFollowUpRequests} follow-up request${remainingFollowUpRequests === 1 ? '' : 's'} remain in this fresh turn. Finish within the limit and do not mention it to the user.`,
    },
  }
}
function isCachedContext(value: unknown): value is CachedContext { return typeof value === 'object' && value !== null && 'name' in value && typeof value.name === 'string' && 'tonePreference' in value && 'activeInjuries' in value && 'workoutContext' in value }
function isCacheFresh(cachedAt: number | undefined, timezone: string): boolean { if (cachedAt === undefined) return false; try { const f = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }); return f.format(new Date(cachedAt)) === f.format(new Date()) } catch { return new Date(cachedAt).toISOString().slice(0, 10) === new Date().toISOString().slice(0, 10) } }

export const getTurnContext = internalQuery({
  args: { chatId: v.id('chats'), authUserId: v.id('users'), excludeMessageId: v.optional(v.id('messages')) },
  handler: async (ctx, args): Promise<TurnContext | { error: string }> => {
    const profile = await ctx.db.query('profiles').withIndex('by_userId', (q) => q.eq('userId', args.authUserId)).unique()
    const chat = await ctx.db.get(args.chatId)
    if (profile === null) return { error: 'Profile not found' }
    if (chat === null || chat.userId !== profile._id) return { error: 'Chat not found' }
    const cached = isCachedContext(chat.cachedContext) ? chat.cachedContext : null
    const cacheIsFresh = cached !== null && isCacheFresh(chat.cachedContextAt, profile.timezone)
    const workout = cacheIsFresh ? null : await ctx.db.query('workoutContext').withIndex('by_user', (q) => q.eq('userId', profile._id)).order('desc').first()
    const dailySummary = await ctx.db
      .query('dailySummaries')
      .withIndex('by_user_date', (q) => q.eq('userId', profile._id).lt('date', chat.date))
      .order('desc')
      .first()
    const summaries = await ctx.db.query('sessionSummaries').withIndex('by_chat_and_tier', (q) => q.eq('chatId', chat._id)).take(50)
    const compressedTill = summaries.reduce((latest, summary) => Math.max(latest, summary.compressedTill), 0)
    const rawMessages = (await ctx.db.query('messages').withIndex('by_chat', (q) => q.eq('chatId', chat._id)).order('desc').take(recentMessageLimit))
      .filter((message) => message._id !== args.excludeMessageId && message.timestamp > compressedTill)
      .reverse()
    const messages = await Promise.all(rawMessages.map(async (message) => ({
      ...message,
      messageBlocks: (await ctx.db.query('messageBlocks').withIndex('by_message', (q) => q.eq('messageId', message._id)).take(50))
        .filter((block) => block.type === 'text' || block.type === 'tool_summary')
        .sort((left, right) => left.order - right.order),
    })))
    const pinnedCards = (await ctx.db.query('cards').withIndex('by_chat', (q) => q.eq('chatId', chat._id)).take(50)).filter((card) => card.inDiscussion).map((card) => ({ label: `Card ${card.order + 1}`, card }))
    let guideTurns = 0
    for (const message of [...messages].reverse()) { if (message.usedTools?.includes(guideMarker)) guideTurns += 1; else break }
    return { chat, profile, leanContext: cacheIsFresh ? cached : leanContext(profile, workout), dailySummary, currentChatDate: chat.date, recentMessages: messages, sessionSummaries: summaries, pinnedCards, guideActive: guideTurns > 0 && guideTurns < 10, guideTurns, cacheIsFresh }
  },
})

export const cacheContext = internalMutation({ args: { chatId: v.id('chats'), cachedContext: v.any(), cachedContextAt: v.number() }, handler: async (ctx, args) => { await ctx.db.patch(args.chatId, { cachedContext: args.cachedContext, cachedContextAt: args.cachedContextAt }); return null } })
export const writeMessage = internalMutation({ args: { chatId: v.id('chats'), userText: v.string(), ecoText: v.string(), usedTools: v.optional(v.array(v.string())) }, handler: async (ctx, args): Promise<Id<'messages'>> => await ctx.db.insert('messages', { ...args, timestamp: Date.now() }) })
export const prepareRetryMessage = internalMutation({
  args: { chatId: v.id('chats'), messageId: v.id('messages'), authUserId: v.id('users') },
  handler: async (ctx, args): Promise<{ messageId: Id<'messages'>; userText: string } | { error: string }> => {
    const profile = await ctx.db.query('profiles').withIndex('by_userId', (q) => q.eq('userId', args.authUserId)).unique()
    const chat = await ctx.db.get(args.chatId)
    const message = await ctx.db.get(args.messageId)
    if (profile === null || chat === null || chat.userId !== profile._id || message === null || message.chatId !== chat._id) return { error: 'Message not found' }
    if (message.ecoText !== responseUnavailableText) return { error: 'Only failed messages can be retried' }
    const [blocks, traces] = await Promise.all([
      ctx.db.query('messageBlocks').withIndex('by_message', (q) => q.eq('messageId', message._id)).collect(),
      ctx.db.query('toolTraces').withIndex('by_message', (q) => q.eq('messageId', message._id)).collect(),
    ])
    for (const block of blocks) await ctx.db.delete(block._id)
    for (const trace of traces) await ctx.db.delete(trace._id)
    await ctx.db.patch(message._id, { ecoText: '', usedTools: undefined })
    return { messageId: message._id, userText: message.userText }
  },
})
export const completeMessage = internalMutation({
  args: { messageId: v.id('messages'), ecoText: v.string(), usedTools: v.optional(v.array(v.string())), isFinalGeminiResponse: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    const message = await ctx.db.get(args.messageId)
    if (message === null) return { error: 'Message not found' }
    const chat = await ctx.db.get(message.chatId)
    if (chat === null) return { error: 'Chat not found' }
    await ctx.db.patch(args.messageId, { ecoText: args.ecoText, usedTools: args.usedTools })
    if (args.isFinalGeminiResponse === true) {
      // The Get_data loop never completes a message between tool calls.
      await ctx.scheduler.runAfter(0, internal.functions.sessionSummaries.compressIfNeeded, {
        chatId: chat._id,
        userId: chat.userId,
      })
    }
    return null
  },
})
export const setMessageSession = internalMutation({ args: { messageId: v.id('messages'), sessionId: v.id('sessions') }, handler: async (ctx, args) => { await ctx.db.patch(args.messageId, { sessionId: args.sessionId }); return null } })
export const appendBlock = internalMutation({ args: { messageId: v.id('messages'), order: v.number(), type: v.union(v.literal('text'), v.literal('tool_summary')), content: v.string(), toolName: v.optional(v.string()), cardIds: v.optional(v.array(v.id('cards'))) }, handler: async (ctx, args) => await ctx.db.insert('messageBlocks', { ...args, createdAt: Date.now() }) })
export const startToolTrace = internalMutation({
  args: { messageId: v.id('messages'), userId: v.id('profiles'), order: v.number(), toolName: v.string(), functionCallId: v.optional(v.string()), requestJson: v.string() },
  handler: async (ctx, args): Promise<Id<'toolTraces'> | { error: string }> => {
    const message = await ctx.db.get(args.messageId)
    const chat = message === null ? null : await ctx.db.get(message.chatId)
    if (chat === null || chat.userId !== args.userId) return { error: 'Message not found' }
    return await ctx.db.insert('toolTraces', { ...args, status: 'pending', createdAt: Date.now() })
  },
})
export const completeToolTrace = internalMutation({
  args: { traceId: v.id('toolTraces'), resultJson: v.string(), status: v.union(v.literal('completed'), v.literal('rejected')) },
  handler: async (ctx, args): Promise<null | { error: string }> => {
    const trace = await ctx.db.get(args.traceId)
    if (trace === null) return { error: 'Tool trace not found' }
    await ctx.db.patch(trace._id, { resultJson: args.resultJson, status: args.status, completedAt: Date.now() })
    return null
  },
})

type LibraryReferenceEntry = {
  exerciseLibraryId: Id<'exerciseLibrary'>
  canonicalName: string
  description: string | null
}

function libraryLabel(number: number): string {
  return `Library Exercise ${number}`
}

function libraryLabelNumber(label: string): number | null {
  const match = /^Library Exercise (\d+)$/.exec(label)
  const value = match === null ? NaN : Number(match[1])
  return Number.isSafeInteger(value) && value > 0 ? value : null
}

export const createLibraryReferences = internalMutation({
  args: {
    chatId: v.id('chats'), userId: v.id('profiles'), messageId: v.id('messages'),
    entries: v.array(v.object({ exerciseLibraryId: v.id('exerciseLibrary'), canonicalName: v.string(), description: v.union(v.string(), v.null()) })),
  },
  handler: async (ctx, args): Promise<Array<LibraryReferenceEntry & { label: string }>> => {
    const chat = await ctx.db.get(args.chatId)
    const message = await ctx.db.get(args.messageId)
    if (chat === null || message === null || chat.userId !== args.userId || message.chatId !== chat._id) return []
    const existing = await ctx.db.query('exerciseSearchReferences').withIndex('by_user_and_chat', (q) => q.eq('userId', args.userId).eq('chatId', args.chatId)).collect()
    const byExercise = new Map<Id<'exerciseLibrary'>, { label: string }>(existing.map((entry) => [entry.exerciseLibraryId, { label: entry.label }]))
    let nextNumber = existing.reduce((maximum, entry) => Math.max(maximum, libraryLabelNumber(entry.label) ?? 0), 0) + 1
    const resolved: Array<LibraryReferenceEntry & { label: string }> = []
    for (const entry of args.entries) {
      const known = byExercise.get(entry.exerciseLibraryId)
      if (known !== undefined) {
        resolved.push({ ...entry, label: known.label })
        continue
      }
      const label = libraryLabel(nextNumber)
      nextNumber += 1
      await ctx.db.insert('exerciseSearchReferences', {
        chatId: args.chatId, userId: args.userId, messageId: args.messageId,
        exerciseLibraryId: entry.exerciseLibraryId, label, canonicalName: entry.canonicalName,
        ...(entry.description === null ? {} : { description: entry.description }), createdAt: Date.now(),
      })
      byExercise.set(entry.exerciseLibraryId, { label })
      resolved.push({ ...entry, label })
    }
    return resolved
  },
})

export const resolveLibraryReferences = internalQuery({
  args: { chatId: v.id('chats'), userId: v.id('profiles'), labels: v.array(v.string()) },
  handler: async (ctx, args): Promise<Array<{ label: string; exerciseLibraryId: Id<'exerciseLibrary'> }>> => {
    const chat = await ctx.db.get(args.chatId)
    if (chat === null || chat.userId !== args.userId) return []
    const [references, messages] = await Promise.all([
      ctx.db.query('exerciseSearchReferences').withIndex('by_user_and_chat', (q) => q.eq('userId', args.userId).eq('chatId', args.chatId)).collect(),
      ctx.db.query('messages').withIndex('by_chat', (q) => q.eq('chatId', args.chatId)).order('desc').take(50),
    ])
    const messageIndex = new Map(messages.map((message, index) => [message._id, index]))
    const requested = new Set(args.labels)
    return references.flatMap((reference) => {
      const age = messageIndex.get(reference.messageId)
      return requested.has(reference.label) && age !== undefined && age <= 3
        ? [{ label: reference.label, exerciseLibraryId: reference.exerciseLibraryId }]
        : []
    })
  },
})

export const purgeLibraryReferencesForChat = internalMutation({
  args: { chatId: v.id('chats'), userId: v.id('profiles') },
  handler: async (ctx, args): Promise<number> => {
    const chat = await ctx.db.get(args.chatId)
    if (chat === null || chat.userId !== args.userId) return 0
    const references = await ctx.db
      .query('exerciseSearchReferences')
      .withIndex('by_user_and_chat', (q) => q.eq('userId', args.userId).eq('chatId', args.chatId))
      .collect()
    for (const reference of references) await ctx.db.delete(reference._id)
    return references.length
  },
})

export const purgeExpiredLibraryReferences = internalMutation({
  args: { chatId: v.id('chats'), userId: v.id('profiles') },
  handler: async (ctx, args): Promise<number> => {
    const chat = await ctx.db.get(args.chatId)
    if (chat === null || chat.userId !== args.userId) return 0
    const [references, messages] = await Promise.all([
      ctx.db.query('exerciseSearchReferences').withIndex('by_user_and_chat', (q) => q.eq('userId', args.userId).eq('chatId', args.chatId)).collect(),
      ctx.db.query('messages').withIndex('by_chat', (q) => q.eq('chatId', args.chatId)).order('desc').take(50),
    ])
    const messageIndex = new Map(messages.map((message, index) => [message._id, index]))
    const expired = references.filter((reference) => {
      const age = messageIndex.get(reference.messageId)
      return age === undefined || age > 3
    })
    for (const reference of expired) await ctx.db.delete(reference._id)
    return expired.length
  },
})
export const getBlocks = query({
  args: { messageId: v.id('messages') },
  handler: async (ctx, args) => {
    const auth = await getAuthUserId(ctx)
    const profile = auth === null ? null : await ctx.db.query('profiles').withIndex('by_userId', (q) => q.eq('userId', auth)).unique()
    const message = await ctx.db.get(args.messageId)
    const chat = message === null ? null : await ctx.db.get(message.chatId)
    if (profile === null || message === null || chat?.userId !== profile._id) return { error: 'Message not found', blocks: [] }

    const blocks = (await ctx.db.query('messageBlocks').withIndex('by_message', (q) => q.eq('messageId', args.messageId)).take(50))
      .filter((block) => block.type === 'text' || block.type === 'tool_summary')
      .sort((left, right) => left.order - right.order)
    return { blocks }
  },
})

export const writeLowConfidenceTurn = internalMutation({ args: { chatId: v.id('chats'), messageId: v.id('messages'), parsedData: v.any(), rawOutput: v.string(), order: v.optional(v.number()), correctsBlockId: v.optional(v.id('blocks')) }, handler: async (ctx, args): Promise<{ cardId: Id<'cards'> }> => ({ cardId: await ctx.db.insert('cards', { chatId: args.chatId, messageId: args.messageId, rawOutput: args.rawOutput, parsedData: args.parsedData, state: 'pending', order: args.order ?? 0, inDiscussion: false, correctsBlockId: args.correctsBlockId, createdAt: Date.now() }) }) })

export const getRecent = query({ args: { chatId: v.id('chats'), limit: v.number() }, handler: async (ctx, args) => { const auth = await getAuthUserId(ctx); const profile = auth === null ? null : await ctx.db.query('profiles').withIndex('by_userId', (q) => q.eq('userId', auth)).unique(); const chat = await ctx.db.get(args.chatId); if (profile === null || chat === null || chat.userId !== profile._id) return { error: 'Chat not found', messages: [] }; return { messages: (await ctx.db.query('messages').withIndex('by_chat', (q) => q.eq('chatId', args.chatId)).order('desc').take(Math.min(Math.max(Math.floor(args.limit), 1), recentMessageLimit))).reverse() } } })
export const getAllForCompression = internalQuery({
  args: { chatId: v.id('chats') },
  handler: async (ctx, args) => {
    const messages = await ctx.db.query('messages').withIndex('by_chat', (q) => q.eq('chatId', args.chatId)).order('asc').collect()
    return await Promise.all(messages.map(async (message) => ({
      ...message,
      messageBlocks: (await ctx.db.query('messageBlocks').withIndex('by_message', (q) => q.eq('messageId', message._id)).take(50))
        .filter((block) => block.type === 'text' || block.type === 'tool_summary')
        .map(compressionSafeToolBlock)
        .sort((left, right) => left.order - right.order),
    })))
  },
})

/* Legacy single-function-call turn loop retained temporarily for diff review.
export const processTurn = action({
  args: { chatId: v.id('chats'), userText: v.optional(v.string()), retryMessageId: v.optional(v.id('messages')) },
  handler: async (ctx, args): Promise<TurnResult> => {
    const turnStartedAt = Date.now()
    const authUserId = await getAuthUserId(ctx)
    if (authUserId === null) return { ecoText: '', error: 'Not authenticated' }

    let retry: { messageId: Id<'messages'>; userText: string } | null = null
    if (args.retryMessageId !== undefined) {
      const result: { messageId: Id<'messages'>; userText: string } | { error: string } = await ctx.runMutation(internal.functions.messages.prepareRetryMessage, { chatId: args.chatId, messageId: args.retryMessageId, authUserId })
      if ('error' in result) return { ecoText: '', error: result.error }
      retry = result
    }
    const userText = retry?.userText ?? args.userText?.trim()
    if (userText === undefined || userText.length === 0) return { ecoText: '', error: 'A message is required' }

    const contextStartedAt = Date.now()
    const context: TurnContext | { error: string } = await ctx.runQuery(internal.functions.messages.getTurnContext, { chatId: args.chatId, authUserId, excludeMessageId: retry?.messageId })
    if ('error' in context) return { ecoText: '', error: context.error }
    if (!context.cacheIsFresh) await ctx.runMutation(internal.functions.messages.cacheContext, { chatId: args.chatId, cachedContext: context.leanContext, cachedContextAt: Date.now() })
    const messageId: Id<'messages'> = retry?.messageId ?? await ctx.runMutation(internal.functions.messages.writeMessage, { chatId: args.chatId, userText, ecoText: '' })
    const runId = createDebugRunId(messageId, turnStartedAt)
    const trace = async (
      event: Omit<DebugEventInput, 'userId' | 'chatId' | 'messageId' | 'runId'>,
    ): Promise<void> => {
      await recordDebugEvent(ctx, {
        ...event,
        userId: context.profile._id,
        chatId: args.chatId,
        messageId,
        runId,
      })
    }
    const finishMessage = async (
      ecoText: string,
      tools: string[] | undefined,
      final: boolean,
      status: 'success' | 'error' | 'warning' = 'success',
      summary?: string,
    ): Promise<void> => {
      await ctx.runMutation(internal.functions.messages.completeMessage, {
        messageId,
        ecoText,
        usedTools: tools,
        isFinalGeminiResponse: final ? true : undefined,
      })
      await trace({
        kind: status === 'error' ? 'error' : 'lifecycle',
        status,
        title: 'Final Eco response persisted',
        summary: summary ?? ecoText,
        source: {
          file: 'convex/functions/messages.ts',
          symbol: 'completeMessage',
        },
        details: serialiseDebugDetails({ ecoText, usedTools: tools, final }),
        warningCodes: [],
      })
    }
    const selectedToolCounts = new Map<string, number>()
    const traceToolSelection = async (
      selectedResponse: GeminiResponse,
      callIndex: number,
    ): Promise<void> => {
      const functionCall = selectedResponse.functionCall
      if (functionCall === null) return
      const count = (selectedToolCounts.get(functionCall.name) ?? 0) + 1
      selectedToolCounts.set(functionCall.name, count)
      const warningCodes = [
        ...(count > 1 ? [DEBUG_WARNING.repeatedTool] : []),
        ...(functionCall.name === 'log_workout'
          ? workoutEvidenceWarning(userText)
          : []),
      ]
      await trace({
        kind: 'tool',
        status: warningCodes.length > 0 ? 'warning' : 'info',
        title: `${functionCall.name} selected`,
        summary: count > 1
          ? `Gemini selected ${functionCall.name} for the ${count}th time in this turn.`
          : `Gemini selected ${functionCall.name}.`,
        source: {
          file: 'convex/lib/gemini.ts',
          symbol: 'toGeminiResponse',
        },
        details: serialiseDebugDetails({
          toolName: functionCall.name,
          arguments: functionCall.args,
          selectionCount: count,
        }),
        callIndex,
        toolName: functionCall.name,
        warningCodes,
      })
    }

    await trace({
      kind: 'lifecycle',
      status: 'success',
      title: retry === null ? 'Message received' : 'Message retry received',
      summary: userText,
      source: {
        file: 'convex/functions/messages.ts',
        symbol: 'processTurn',
      },
      details: serialiseDebugDetails({
        userText,
        retry: retry !== null,
        messageId,
        chatId: args.chatId,
      }),
      occurredAt: turnStartedAt,
      warningCodes: [],
    })
    await trace({
      kind: 'context',
      status: 'success',
      title: 'Context assembly completed',
      summary: `${context.recentMessages.length} recent messages, ${context.pinnedCards.length} pinned cards, guide ${context.guideActive ? 'active' : 'inactive'}.`,
      source: {
        file: 'convex/functions/messages.ts',
        symbol: 'getTurnContext',
      },
      details: serialiseDebugDetails({
        assembledContext: context,
        finalGeminiRequest: buildGeminiDebugPayload(context, userText),
      }),
      durationMs: Date.now() - contextStartedAt,
      occurredAt: contextStartedAt,
      warningCodes: [],
    })

    let geminiCallIndex = 0
    const initialCallStartedAt = Date.now()
    await trace({
      kind: 'gemini',
      status: 'running',
      title: 'Gemini call 0 started',
      summary: 'Initial turn request sent to Gemini.',
      source: {
        file: 'convex/lib/gemini.ts',
        symbol: 'beginGeminiTurn',
      },
      details: serialiseDebugDetails(buildGeminiDebugPayload(context, userText)),
      callIndex: 0,
      occurredAt: initialCallStartedAt,
      warningCodes: [],
    })

    let geminiTurn
    try {
      geminiTurn = await beginGeminiTurn(context, userText)
    } catch (error) {
      console.error(`Gemini turn startup failed: ${errorMessage(error)}`)
      await trace({
        kind: 'error',
        status: 'error',
        title: 'Gemini call 0 failed',
        summary: errorMessage(error),
        source: {
          file: 'convex/lib/gemini.ts',
          symbol: 'beginGeminiTurn',
        },
        details: serialiseDebugError(error),
        callIndex: 0,
        durationMs: Date.now() - initialCallStartedAt,
        warningCodes: [],
      })
      await finishMessage(responseUnavailableText, undefined, false, 'error')
      return { ecoText: '', error: responseUnavailableText }
    }

    let response = geminiTurn.response
    await trace({
      kind: 'gemini',
      status: 'success',
      title: 'Gemini call 0 completed',
      summary: response.functionCall === null
        ? 'Gemini returned a text response.'
        : `Gemini returned ${response.functionCall.name}.`,
      source: {
        file: 'convex/lib/gemini.ts',
        symbol: 'beginGeminiTurn',
      },
      details: responseDetails(response),
      callIndex: 0,
      durationMs: Date.now() - initialCallStartedAt,
      tokens: response.usage,
      warningCodes: [],
    })
    await traceToolSelection(response, 0)

    const usedTools: string[] = response.functionCall === null ? [] : [response.functionCall.name]
    if (context.guideActive) usedTools.push(guideMarker)
    let blockOrder = 0
    await ctx.runMutation(internal.functions.messages.appendBlock, { messageId, order: blockOrder, type: response.functionCall === null ? 'text' : 'tool_call', content: response.functionCall === null ? response.text : response.functionCall.name, toolName: response.functionCall?.name })
    let historicalExerciseDetailsFetched = false
    const historicalBlocks = new Map<string, Id<'blocks'>>()
    let lastGetDataResult: object | null = null
    let tokensUsed = response.tokensUsed

    for (let callCount = 0; response.functionCall !== null && ['Get_data', 'search_exercise_library', 'get_new_exercise_guidance', 'create_custom_exercise', 'calculate'].includes(response.functionCall.name) && callCount < 5; callCount += 1) {
      const toolName = response.functionCall.name
      const toolArgs = response.functionCall.args
      const request: Record<string, unknown> = typeof toolArgs === 'object' && toolArgs !== null
        ? toolArgs as Record<string, unknown>
        : {}
      if (toolName === 'Get_data' && (!isConcreteGetDataRequest(request) || (completedGetDataCalls > 0 && !('exerciseId' in request)))) {
        const reply = dataLookupFallback(lastGetDataResult ?? {})
        await trace({
          kind: 'warning',
          status: 'warning',
          title: 'Redundant Get_data call stopped',
          summary: !isConcreteGetDataRequest(request)
            ? 'Gemini attempted Get_data without a concrete request.'
            : 'Gemini attempted a second non-historical Get_data lookup in the same turn.',
          source: { file: 'convex/functions/messages.ts', symbol: 'processTurn' },
          details: serialiseDebugDetails({ arguments: toolArgs, completedGetDataCalls, lastGetDataResult }),
          callIndex: geminiCallIndex,
          toolName,
          warningCodes: [DEBUG_WARNING.redundantDataLookup],
        })
        await ctx.runMutation(internal.functions.messages.appendBlock, { messageId, order: blockOrder + 1, type: 'tool_result', content: JSON.stringify({ error: 'Get_data requires a concrete request and profile lookups must be combined.' }), toolName })
        blockOrder += 2
        await ctx.runMutation(internal.functions.messages.appendBlock, { messageId, order: blockOrder, type: 'text', content: reply })
        response = { ...response, functionCall: null, rawText: '', text: reply }
        break
      }
      const toolStartedAt = Date.now()
      const toolSource = toolName === 'Get_data'
        ? { file: 'convex/functions/exercises.ts', symbol: 'getDataForTurn' }
        : toolName === 'search_exercise_library'
          ? { file: 'convex/functions/exerciseLibrary.ts', symbol: 'searchForTurn' }
          : toolName === 'get_new_exercise_guidance'
            ? { file: 'convex/lib/gemini.ts', symbol: 'getNewExerciseGuidance' }
            : toolName === 'create_custom_exercise'
              ? { file: 'convex/functions/exerciseLibrary.ts', symbol: 'createCustomExerciseAction' }
              : { file: 'convex/lib/calculate.ts', symbol: 'executeCalculate' }
      await trace({
        kind: 'tool',
        status: 'running',
        title: `${toolName} execution started`,
        summary: `Executing follow-up tool ${callCount + 1} of at most 5.`,
        source: toolSource,
        details: serialiseDebugDetails({ arguments: toolArgs }),
        callIndex: geminiCallIndex,
        toolName,
        occurredAt: toolStartedAt,
        warningCodes: [],
      })

      let dataForModel: object
      if (toolName === 'calculate') {
        dataForModel = executeCalculate(toolArgs)
      } else if (toolName === 'Get_data') {
        const dateRange = 'dateRange' in request && typeof request.dateRange === 'object' && request.dateRange !== null ? request.dateRange : null
        const startDate = dateRange !== null && 'startDate' in dateRange && typeof dateRange.startDate === 'string' ? dateRange.startDate : undefined
        const endDate = dateRange !== null && 'endDate' in dateRange && typeof dateRange.endDate === 'string' ? dateRange.endDate : undefined
        const exerciseId = 'exerciseId' in request && typeof request.exerciseId === 'string' ? request.exerciseId : undefined
        const dailySummaryDate = 'dailySummaryDate' in request && typeof request.dailySummaryDate === 'string' ? request.dailySummaryDate : undefined
        const collectionPoints = 'collectionPoints' in request && Array.isArray(request.collectionPoints) ? request.collectionPoints.filter((point): point is string => typeof point === 'string') : undefined
        const data: { profile: unknown; dailySummary: unknown; exercises?: Array<{ exerciseId: string; blockId: string; name: string; date: string; sets: ToolCallData['blocks'][number]['exercises'][number]['sets'] }> } = await ctx.runQuery(internal.functions.exercises.getDataForTurn, { userId: context.profile._id, startDate, endDate, exerciseId, dailySummaryDate, collectionPoints })
        const historicalExercises = data.exercises ?? []
        for (const item of historicalExercises) historicalBlocks.set(item.exerciseId, item.blockId as Id<'blocks'>)
        dataForModel = { profile: data.profile, dailySummary: data.dailySummary, exercises: historicalExercises.map(({ exerciseId: label, name, date, sets }) => exerciseId === undefined ? { exerciseId: label, name, date } : { exerciseId: label, name, date, sets }) }
        historicalExerciseDetailsFetched = historicalExerciseDetailsFetched || exerciseId !== undefined
        completedGetDataCalls += 1
        lastGetDataResult = dataForModel
      } else if (toolName === 'search_exercise_library') {
        const rawInput = 'rawInput' in request && typeof request.rawInput === 'string' ? request.rawInput : ''
        const search: { autoResolved: { exerciseId: Id<'exerciseLibrary'>; canonicalName: string; score: number } | null; candidates: Array<{ _id: Id<'exerciseLibrary'>; canonicalName: string; description: string | null; score: number }> } | null = rawInput.length === 0 ? null : await ctx.runAction(internal.functions.exerciseLibrary.searchForTurn, { userId: context.profile._id, rawInput })
        dataForModel = search === null ? { error: 'A concrete exercise name is required.' } : { rawInput, autoResolved: search.autoResolved, candidates: search.candidates.map((candidate: { _id: Id<'exerciseLibrary'>; canonicalName: string; description: string | null; score: number }) => ({ exerciseId: candidate._id, canonicalName: candidate.canonicalName, description: candidate.description, score: candidate.score })) }
        if (search !== null && search.autoResolved === null && !usedTools.includes(guideMarker)) usedTools.push(guideMarker)
      } else if (toolName === 'get_new_exercise_guidance') {
        const parsed = newExerciseGuidanceInputSchema.safeParse(toolArgs)
        if (!parsed.success) dataForModel = { outcome: 'still_ambiguous', exerciseNamingGuidance: EXERCISE_NAMING_GUIDANCE }
        else {
          const guideCallStartedAt = Date.now()
          geminiCallIndex += 1
          await trace({
            kind: 'gemini',
            status: 'running',
            title: `Gemini call ${geminiCallIndex} started`,
            summary: 'Exercise-name guidance request sent to Gemini.',
            source: {
              file: 'convex/lib/gemini.ts',
              symbol: 'getNewExerciseGuidance',
            },
            details: serialiseDebugDetails(parsed.data),
            callIndex: geminiCallIndex,
            occurredAt: guideCallStartedAt,
            warningCodes: [],
          })
          try {
            const guidance = await getNewExerciseGuidance(
              parsed.data,
              context.leanContext.activeInjuries,
            )
            dataForModel = {
              ...guidance.output,
              exerciseNamingGuidance: EXERCISE_NAMING_GUIDANCE,
            }
            await trace({
              kind: 'gemini',
              status: 'success',
              title: `Gemini call ${geminiCallIndex} completed`,
              summary: `Exercise guidance returned ${guidance.output.outcome}.`,
              source: {
                file: 'convex/lib/gemini.ts',
                symbol: 'getNewExerciseGuidance',
              },
              details: serialiseDebugDetails(guidance.output),
              callIndex: geminiCallIndex,
              durationMs: Date.now() - guideCallStartedAt,
              tokens: guidance.usage,
              warningCodes: [],
            })
          } catch (error) {
            dataForModel = {
              outcome: 'still_ambiguous',
              exerciseNamingGuidance: EXERCISE_NAMING_GUIDANCE,
            }
            await trace({
              kind: 'error',
              status: 'error',
              title: `Gemini call ${geminiCallIndex} failed`,
              summary: errorMessage(error),
              source: {
                file: 'convex/lib/gemini.ts',
                symbol: 'getNewExerciseGuidance',
              },
              details: serialiseDebugError(error),
              callIndex: geminiCallIndex,
              durationMs: Date.now() - guideCallStartedAt,
              warningCodes: [],
            })
          }
          await ctx.runMutation(internal.functions.exerciseLibrary.recordGuideInvocation, { userId: context.profile._id, messageId })
          if ('outcome' in dataForModel && dataForModel.outcome !== 'still_ambiguous') {
            const markerIndex = usedTools.lastIndexOf(guideMarker)
            if (markerIndex !== -1) usedTools.splice(markerIndex, 1)
          }
        }
      } else {
        const parsed = createCustomExerciseSchema.safeParse(toolArgs)
        if (!parsed.success) dataForModel = { error: 'Custom exercise details are invalid.' }
        else dataForModel = await ctx.runAction(internal.functions.exerciseLibrary.createCustomExerciseAction, {
          userId: context.profile._id,
          messageId,
          input: parsed.data,
        })
      }

      const resultWarnings = toolResultHasError(dataForModel)
        ? [DEBUG_WARNING.toolResultError]
        : []
      await trace({
        kind: 'tool',
        status: resultWarnings.length > 0 ? 'error' : 'success',
        title: `${toolName} execution completed`,
        summary: resultWarnings.length > 0
          ? `${toolName} returned an error.`
          : `${toolName} returned a result.`,
        source: toolSource,
        details: serialiseDebugDetails({
          arguments: toolArgs,
          result: dataForModel,
        }),
        callIndex: geminiCallIndex,
        toolName,
        durationMs: Date.now() - toolStartedAt,
        warningCodes: resultWarnings,
      })

      blockOrder += 1
      await ctx.runMutation(internal.functions.messages.appendBlock, { messageId, order: blockOrder, type: 'tool_result', content: JSON.stringify(dataForModel), toolName })
      geminiCallIndex += 1
      const continuationStartedAt = Date.now()
      await trace({
        kind: 'gemini',
        status: 'running',
        title: `Gemini call ${geminiCallIndex} started`,
        summary: `Follow-up after ${toolName}.`,
        source: {
          file: 'convex/lib/gemini.ts',
          symbol: 'continueGeminiTurn',
        },
        details: serialiseDebugDetails({
          functionResponse: { name: toolName, response: dataForModel },
        }),
        callIndex: geminiCallIndex,
        occurredAt: continuationStartedAt,
        warningCodes: [],
      })
      try {
        response = await continueGeminiTurn(geminiTurn.chat, toolName, dataForModel)
      } catch (error) {
        console.error(`Gemini tool continuation failed for ${toolName}: ${errorMessage(error)}`)
        await trace({
          kind: 'error',
          status: 'error',
          title: `Gemini call ${geminiCallIndex} failed`,
          summary: errorMessage(error),
          source: {
            file: 'convex/lib/gemini.ts',
            symbol: 'continueGeminiTurn',
          },
          details: serialiseDebugError(error),
          callIndex: geminiCallIndex,
          durationMs: Date.now() - continuationStartedAt,
          warningCodes: [],
        })
        await finishMessage(responseUnavailableText, usedTools, false, 'error')
        return { ecoText: '', error: responseUnavailableText }
      }
      await trace({
        kind: 'gemini',
        status: 'success',
        title: `Gemini call ${geminiCallIndex} completed`,
        summary: response.functionCall === null
          ? 'Gemini returned a text response.'
          : `Gemini returned ${response.functionCall.name}.`,
        source: {
          file: 'convex/lib/gemini.ts',
          symbol: 'continueGeminiTurn',
        },
        details: responseDetails(response),
        callIndex: geminiCallIndex,
        durationMs: Date.now() - continuationStartedAt,
        tokens: response.usage,
        warningCodes: [],
      })
      if (toolName === 'get_new_exercise_guidance' && 'outcome' in dataForModel && dataForModel.outcome === 'still_ambiguous' && response.functionCall !== null) response = { ...response, functionCall: null, rawText: '', text: 'Tell me a little more about how you do it—or whether you made it up or learned it from someone—so I can place it properly.' }
      if (toolName === 'get_new_exercise_guidance' && 'outcome' in dataForModel && dataForModel.outcome === 'declined_unsafe' && response.functionCall !== null) response = { ...response, functionCall: null, rawText: '', text: 'I can’t help add that movement to the library because it is broadly unsafe. Let’s find a safer way to train the same area.' }
      tokensUsed += response.tokensUsed
      if (response.functionCall !== null) {
        usedTools.push(response.functionCall.name)
        await traceToolSelection(response, geminiCallIndex)
      }
      blockOrder += 1
      await ctx.runMutation(internal.functions.messages.appendBlock, { messageId, order: blockOrder, type: response.functionCall === null ? 'text' : 'tool_call', content: response.functionCall === null ? response.text : response.functionCall.name, toolName: response.functionCall?.name })
    }

    await ctx.runMutation(internal.functions.apiUsage.logUsage, { userId: context.profile._id, tokensUsed, timestamp: Date.now() })
    await trace({
      kind: 'database',
      status: 'success',
      title: 'Main-turn API usage persisted',
      summary: `${tokensUsed} total tokens recorded for the main turn loop.`,
      source: {
        file: 'convex/functions/apiUsage.ts',
        symbol: 'logUsage',
      },
      details: serialiseDebugDetails({
        tokensUsed,
        note: 'This preserves existing accounting behavior; nested guidance usage is shown in debug events but is not added to apiUsage.',
      }),
      warningCodes: [],
    })

    const storedTools = usedTools.length === 0 ? undefined : usedTools
    if (response.functionCall === null) {
      await finishMessage(response.text, storedTools, true)
      return { ecoText: response.text }
    }
    if (['Get_data', 'search_exercise_library', 'get_new_exercise_guidance', 'create_custom_exercise', 'calculate'].includes(response.functionCall.name)) {
      const reply = 'I need a little more detail before I can resolve that.'
      await trace({
        kind: 'warning',
        status: 'warning',
        title: 'Follow-up cap reached',
        summary: `${response.functionCall.name} remained unresolved after five follow-up executions.`,
        source: {
          file: 'convex/functions/messages.ts',
          symbol: 'processTurn',
        },
        details: serialiseDebugDetails({
          pendingFunctionCall: response.functionCall,
          executedFollowUps: 5,
        }),
        callIndex: geminiCallIndex,
        toolName: response.functionCall.name,
        warningCodes: [DEBUG_WARNING.followUpCapReached],
      })
      await finishMessage(reply, storedTools, true, 'warning')
      return { ecoText: reply }
    }

    if (response.functionCall.name === 'Correct_log') {
      const correction = response.functionCall.args
      const validation = typeof correction === 'object' && correction !== null && 'parsedData' in correction
        ? validateToolCall(correction.parsedData)
        : {
            isValid: false as const,
            parsedData: {},
            issues: [{
              code: 'missing_parsed_data',
              message: 'Correct_log did not include parsedData.',
              path: 'parsedData',
            }],
          }
      await trace({
        kind: 'validation',
        status: validation.isValid ? 'success' : 'error',
        title: validation.isValid
          ? 'Correct_log validation passed'
          : 'Correct_log validation failed',
        summary: validation.isValid
          ? 'The correction payload passed deterministic validation.'
          : validation.issues.map((issue) => `${issue.path || 'root'}: ${issue.message}`).join('; '),
        source: {
          file: 'convex/lib/validation.ts',
          symbol: 'validateToolCall',
        },
        details: serialiseDebugDetails({
          arguments: correction,
          validation,
        }),
        toolName: 'Correct_log',
        warningCodes: validation.isValid ? [] : [DEBUG_WARNING.validationFailed],
      })
      if (!validation.isValid || typeof correction !== 'object' || correction === null || !('target' in correction)) {
        await finishMessage(response.text, storedTools, true, 'warning')
        return { ecoText: response.text }
      }
      if (correction.target === 'card' && 'cardLabel' in correction && typeof correction.cardLabel === 'string') {
        const card = context.pinnedCards.find((item) => item.label === correction.cardLabel)?.card
        if (card !== undefined) {
          const writeResult = await ctx.runMutation(internal.functions.cards.applyDiscussionCorrection, { cardId: card._id, parsedData: validation.parsedData, rawOutput: JSON.stringify(correction) })
          await trace({
            kind: 'database',
            status: 'success',
            title: 'Discussion card correction persisted',
            summary: 'The pinned card was patched and returned to pending.',
            source: {
              file: 'convex/functions/cards.ts',
              symbol: 'applyDiscussionCorrection',
            },
            details: serialiseDebugDetails(writeResult),
            toolName: 'Correct_log',
            warningCodes: [],
          })
          await finishMessage(response.text, storedTools, true)
          return { ecoText: response.text, cardId: card._id }
        }
      }
      if (correction.target === 'historical' && historicalExerciseDetailsFetched && 'exerciseId' in correction && typeof correction.exerciseId === 'string') {
        const blockId = historicalBlocks.get(correction.exerciseId)
        const block = blockId === undefined ? null : await ctx.runQuery(internal.functions.exercises.getHistoricalBlock, { userId: context.profile._id, blockId })
        if (block !== null) {
          const card = await ctx.runMutation(internal.functions.messages.writeLowConfidenceTurn, { chatId: args.chatId, messageId, parsedData: validation.parsedData, rawOutput: JSON.stringify(correction), correctsBlockId: block._id })
          await trace({
            kind: 'database',
            status: 'success',
            title: 'Historical correction card created',
            summary: 'A pending correction card was written; the historical block was not changed.',
            source: {
              file: 'convex/functions/messages.ts',
              symbol: 'writeLowConfidenceTurn',
            },
            details: serialiseDebugDetails({
              cardId: card.cardId,
              correctsBlockId: block._id,
            }),
            toolName: 'Correct_log',
            warningCodes: [],
          })
          await finishMessage(response.text, storedTools, true)
          return { ecoText: response.text, cardId: card.cardId }
        }
      }
      if (correction.target === 'historical' && !historicalExerciseDetailsFetched) {
        const reply = 'I need to look up that exercise’s details before I can prepare the correction.'
        await finishMessage(reply, storedTools, false, 'warning')
        return { ecoText: reply }
      }
      await finishMessage(response.text, storedTools, true, 'warning')
      return { ecoText: response.text }
    }

    if (response.functionCall.name !== 'log_workout') {
      await finishMessage(response.text, storedTools, true, 'warning')
      return { ecoText: response.text }
    }

    const validation = validateToolCall(response.functionCall.args)
    await trace({
      kind: 'validation',
      status: validation.isValid ? 'success' : 'error',
      title: validation.isValid
        ? 'log_workout validation passed'
        : 'log_workout validation failed',
      summary: validation.isValid
        ? 'The workout payload passed deterministic validation.'
        : validation.issues.map((issue) => `${issue.path || 'root'}: ${issue.message}`).join('; '),
      source: {
        file: 'convex/lib/validation.ts',
        symbol: 'validateToolCall',
      },
      details: serialiseDebugDetails({
        arguments: response.functionCall.args,
        validation,
      }),
      toolName: 'log_workout',
      warningCodes: validation.isValid ? [] : [DEBUG_WARNING.validationFailed],
    })
    if (!validation.isValid) {
      await trace({
        kind: 'database',
        status: 'skipped',
        title: 'Workout write skipped',
        summary: 'No card, session, block, exercise, or alias write was attempted because validation failed.',
        source: {
          file: 'convex/functions/messages.ts',
          symbol: 'processTurn',
        },
        details: serialiseDebugDetails({ validationIssues: validation.issues }),
        toolName: 'log_workout',
        warningCodes: [DEBUG_WARNING.validationFailed],
      })
      await finishMessage(response.text, storedTools, true, 'warning')
      return { ecoText: response.text }
    }

    const parsedData = validation.parsedData
    const resolvedBlocks = parsedData.blocks.filter((block) => block.exercises.every((exercise) => exercise.exerciseId !== undefined || exercise.proposedName !== undefined))
    if (resolvedBlocks.length === 0) {
      const reply = 'Which exercise did you mean?'
      await trace({
        kind: 'database',
        status: 'skipped',
        title: 'Workout write skipped',
        summary: 'No fully resolved exercise block was available.',
        source: {
          file: 'convex/functions/messages.ts',
          symbol: 'processTurn',
        },
        details: serialiseDebugDetails({ parsedData }),
        toolName: 'log_workout',
        warningCodes: [],
      })
      await finishMessage(reply, [guideMarker], true, 'warning')
      return { ecoText: reply }
    }

    let cardId: Id<'cards'> | undefined
    for (const [blockIndex, block] of resolvedBlocks.entries()) {
      const blockData: ToolCallData = { ...parsedData, blocks: [block] }
      if (!blockData.needsClarification) {
        const result: {
          cardId?: Id<'cards'>
          sessionId?: Id<'sessions'>
          sessionCreated?: boolean
          blockIds?: Id<'blocks'>[]
          exerciseRowIds?: Id<'exercises'>[]
          aliasIds?: Id<'userExerciseAliases'>[]
          error?: string
        } = await ctx.runMutation(internal.functions.cards.writeHighConfidenceCard, { chatId: args.chatId, messageId, userId: context.profile._id, parsedData: blockData, rawOutput: JSON.stringify(blockData), order: blockIndex })
        if (result.error !== undefined || result.cardId === undefined || result.sessionId === undefined) {
          await trace({
            kind: 'error',
            status: 'error',
            title: 'Confirmed workout write failed',
            summary: result.error ?? 'Could not save workout',
            source: {
              file: 'convex/functions/cards.ts',
              symbol: 'writeHighConfidenceCard',
            },
            details: serialiseDebugDetails(result),
            toolName: 'log_workout',
            warningCodes: [],
          })
          await finishMessage(response.text, storedTools, true, 'error')
          return { ecoText: response.text, error: result.error ?? 'Could not save workout' }
        }
        await ctx.runMutation(internal.functions.messages.setMessageSession, { messageId, sessionId: result.sessionId })
        await trace({
          kind: 'database',
          status: 'success',
          title: 'Confirmed workout rows persisted',
          summary: `${result.blockIds?.length ?? 0} block(s) and ${result.exerciseRowIds?.length ?? 0} exercise row(s) written.`,
          source: {
            file: 'convex/functions/cards.ts',
            symbol: 'writeHighConfidenceCard',
          },
          details: serialiseDebugDetails(result),
          toolName: 'log_workout',
          warningCodes: [],
        })
        cardId = result.cardId
      } else {
        const result: { cardId: Id<'cards'> } = await ctx.runMutation(internal.functions.messages.writeLowConfidenceTurn, { chatId: args.chatId, messageId, parsedData: blockData, rawOutput: JSON.stringify(blockData), order: blockIndex })
        await trace({
          kind: 'database',
          status: 'success',
          title: 'Pending workout card persisted',
          summary: 'Clarification was required, so no permanent workout rows were written.',
          source: {
            file: 'convex/functions/messages.ts',
            symbol: 'writeLowConfidenceTurn',
          },
          details: serialiseDebugDetails(result),
          toolName: 'log_workout',
          warningCodes: [],
        })
        cardId = result.cardId
      }
    }
    await finishMessage(response.text, storedTools, true)
    return { ecoText: response.text, cardId }
  },
})
*/

type ToolRequest = { name: string; args: object; id?: string; traceId?: Id<'toolTraces'>; timelineOrder: number }
type ToolExecution = { request: ToolRequest; result: Record<string, unknown>; cardIds: Id<'cards'>[] }

function requestRecord(args: object): Record<string, unknown> {
  return args as Record<string, unknown>
}

function serialiseToolPayload(value: unknown): string {
  return JSON.stringify(value) ?? 'null'
}

function canRunTogether(request: ToolRequest): boolean {
  return ['search_exercise_library', 'calculate'].includes(request.name)
}

function libraryExerciseLabels(args: object): string[] {
  const value = requestRecord(args)
  const blocks = Array.isArray(value.blocks) ? value.blocks : []
  return blocks.flatMap((block) => {
    const blockValue = typeof block === 'object' && block !== null ? block as Record<string, unknown> : null
    const exercises = blockValue === null || !Array.isArray(blockValue.exercises) ? [] : blockValue.exercises
    return exercises.flatMap((exercise) => {
      const entry = typeof exercise === 'object' && exercise !== null ? exercise as Record<string, unknown> : null
      return entry !== null && typeof entry.exerciseId === 'string' && entry.exerciseId.startsWith('Library Exercise ')
        ? [entry.exerciseId]
        : []
    })
  })
}

function replaceLibraryExerciseLabels(args: object, resolved: Map<string, Id<'exerciseLibrary'>>): object {
  const value = requestRecord(args)
  const blocks = Array.isArray(value.blocks) ? value.blocks : []
  return {
    ...value,
    blocks: blocks.map((block) => {
      const blockValue = typeof block === 'object' && block !== null ? block as Record<string, unknown> : {}
      const exercises = Array.isArray(blockValue.exercises) ? blockValue.exercises : []
      return {
        ...blockValue,
        exercises: exercises.map((exercise) => {
          const entry = typeof exercise === 'object' && exercise !== null ? exercise as Record<string, unknown> : {}
          const label = typeof entry.exerciseId === 'string' ? entry.exerciseId : ''
          const exerciseId = resolved.get(label)
          return exerciseId === undefined ? entry : { ...entry, exerciseId }
        }),
      }
    }),
  }
}

export const processTurn = action({
  args: { chatId: v.id('chats'), userText: v.optional(v.string()), retryMessageId: v.optional(v.id('messages')) },
  handler: async (ctx, args): Promise<TurnResult> => {
    const turnStartedAt = Date.now()
    const authUserId = await getAuthUserId(ctx)
    if (authUserId === null) return { ecoText: '', error: 'Not authenticated' }
    const retry = args.retryMessageId === undefined
      ? null
      : await ctx.runMutation(internal.functions.messages.prepareRetryMessage, { chatId: args.chatId, messageId: args.retryMessageId, authUserId })
    if (retry !== null && 'error' in retry) return { ecoText: '', error: retry.error }
    const userText = retry === null ? args.userText?.trim() : retry.userText
    if (userText === undefined || userText.length === 0) return { ecoText: '', error: 'A message is required' }
    // Snapshot once per turn. A later admin publication cannot change an
    // already-running chat or its tool continuations.
    const runtimeConfig = await ctx.runQuery(getLiveRuntimeConfig, {})
    // Reserve admission for the initial request only. Low-RPM Flash pools can
    // therefore accept a new chat turn and fail over to the next key once full.
    // The selected key remains pinned for this turn's SDK chat/tool loop.
    const liveReservation = await ctx.runMutation(reserveLiveGemini, { workflow: 'chat', modelId: runtimeConfig.modelId, poolIds: runtimeConfig.poolIds, requestCount: 1 })
    if (liveReservation.apiKey === undefined) return { ecoText: '', error: responseUnavailableText }
    let activeLiveReservation = liveReservation
    let modelRuntimeConfig = { ...runtimeConfig, apiKey: liveReservation.apiKey }
    let reservedRequestsUsed = 0
    const releaseLiveReservation = async (tokens: number): Promise<void> => {
      if (activeLiveReservation.reservationId !== undefined) await ctx.runMutation(releaseLiveGemini, { reservationId: activeLiveReservation.reservationId, usedRequests: reservedRequestsUsed, totalTokens: tokens })
    }

    const contextStartedAt = Date.now()
    const context = await ctx.runQuery(internal.functions.messages.getTurnContext, {
      chatId: args.chatId,
      authUserId,
      excludeMessageId: retry?.messageId,
    })
    if ('error' in context) return { ecoText: '', error: context.error }
    if (!context.cacheIsFresh) await ctx.runMutation(internal.functions.messages.cacheContext, { chatId: args.chatId, cachedContext: context.leanContext, cachedContextAt: Date.now() })
    const messageId = retry?.messageId ?? await ctx.runMutation(internal.functions.messages.writeMessage, { chatId: args.chatId, userText, ecoText: '' })
    await ctx.runMutation(internal.functions.messages.purgeExpiredLibraryReferences, { chatId: args.chatId, userId: context.profile._id })
    const runId = createDebugRunId(messageId, Date.now())
    const initialDebugPayload = buildGeminiDebugPayload(context, userText, modelRuntimeConfig)
    await ctx.runMutation(internal.debug.events.recordReplaySnapshot, {
      userId: context.profile._id,
      messageId,
      runId,
      payload: JSON.stringify(initialDebugPayload),
    })
    const trace = async (event: Omit<DebugEventInput, 'userId' | 'chatId' | 'messageId' | 'runId'>): Promise<void> => {
      await recordDebugEvent(ctx, { ...event, userId: context.profile._id, chatId: args.chatId, messageId, runId })
    }
    await trace({
      kind: 'lifecycle',
      status: 'success',
      title: retry === null ? 'Message received' : 'Message retry received',
      summary: userText,
      source: { file: 'convex/functions/messages.ts', symbol: 'processTurn' },
      details: serialiseDebugDetails({ userText, retry: retry !== null, messageId, chatId: args.chatId }),
      occurredAt: turnStartedAt,
      warningCodes: [],
    })
    await trace({
      kind: 'context',
      status: 'success',
      title: 'Context assembly completed',
      summary: `${context.recentMessages.length} recent messages, ${context.pinnedCards.length} pinned cards, guide ${context.guideActive ? 'active' : 'inactive'}.`,
      source: { file: 'convex/functions/messages.ts', symbol: 'getTurnContext' },
      details: serialiseDebugDetails({
        assembledContext: context,
        finalGeminiRequest: initialDebugPayload,
      }),
      durationMs: Date.now() - contextStartedAt,
      occurredAt: contextStartedAt,
      warningCodes: [],
    })
    const usedTools: string[] = context.guideActive ? [guideMarker] : []
    let blockOrder = 0
    let tokensUsed = 0
    let lastCardId: Id<'cards'> | undefined
    const ecoTextSegments: string[] = []
    let historicalExerciseDetailsFetched = false
    const historicalBlocks = new Map<string, Id<'blocks'>>()
    let completedGetDataCalls = 0
    let lastGetDataResult: Record<string, unknown> | null = null
    let toolTraceOrder = 0

    const append = async (type: 'text' | 'tool_summary', content: string, toolName?: string, cardIds?: Id<'cards'>[], order = blockOrder): Promise<void> => {
      await ctx.runMutation(internal.functions.messages.appendBlock, { messageId, order, type, content, toolName, cardIds })
      if (order === blockOrder) blockOrder += 1
    }
    const reserveResponseTimeline = async (nextResponse: GeminiResponse): Promise<ToolRequest[]> => {
      const requests: ToolRequest[] = []
      for (const part of nextResponse.parts) {
        if (part.kind === 'text') {
          ecoTextSegments.push(part.text)
          await append('text', part.text)
        } else {
          requests.push({ name: part.call.name ?? '', args: part.call.args ?? {}, id: part.call.id, timelineOrder: blockOrder })
          blockOrder += 1
        }
      }
      return requests
    }
    const beginToolTrace = async (request: ToolRequest): Promise<void> => {
      const trace = await ctx.runMutation(internal.functions.messages.startToolTrace, {
        messageId,
        userId: context.profile._id,
        order: toolTraceOrder,
        toolName: request.name,
        functionCallId: request.id,
        requestJson: serialiseToolPayload(request.args),
      })
      toolTraceOrder += 1
      if (typeof trace !== 'object') request.traceId = trace
    }
    const finishToolTrace = async (
      execution: ToolExecution,
      status: ToolTraceStatus,
    ): Promise<void> => {
      if (execution.request.traceId !== undefined) {
        await ctx.runMutation(internal.functions.messages.completeToolTrace, {
          traceId: execution.request.traceId,
          resultJson: serialiseToolPayload(execution.result),
          status,
        })
      }
      await append('tool_summary', toolResultSummary({
        toolName: execution.request.name,
        args: execution.request.args,
        result: execution.result,
        status,
      }), execution.request.name, execution.cardIds, execution.request.timelineOrder)
    }
    const execute = async (request: ToolRequest): Promise<ToolExecution> => {
      const toolName = request.name
      const requestArgs = requestRecord(request.args)
      let result: Record<string, unknown>
      const cardIds: Id<'cards'>[] = []
      if (toolName === 'calculate') result = executeCalculate(request.args)
      else if (toolName === 'Get_data') {
        if (!isConcreteGetDataRequest(requestArgs)) result = { error: 'Get_data requires at least one concrete collection point, date range, daily summary date, or previously returned Exercise label.' }
        else if (typeof requestArgs.exerciseId === 'string' && !historicalBlocks.has(requestArgs.exerciseId)) result = {
          error: 'Get_data exerciseId must be an Exercise label returned by an earlier historical lookup in this turn.',
        }
        else {
          const dateRange = typeof requestArgs.dateRange === 'object' && requestArgs.dateRange !== null ? requestArgs.dateRange as Record<string, unknown> : null
          const startDate = typeof dateRange?.startDate === 'string' ? dateRange.startDate : undefined
          const endDate = typeof dateRange?.endDate === 'string' ? dateRange.endDate : undefined
          const exerciseId = typeof requestArgs.exerciseId === 'string' ? requestArgs.exerciseId : undefined
          const dailySummaryDate = typeof requestArgs.dailySummaryDate === 'string' ? requestArgs.dailySummaryDate : undefined
          const collectionPoints = Array.isArray(requestArgs.collectionPoints) ? requestArgs.collectionPoints.filter((point): point is string => typeof point === 'string') : undefined
          const data: { profile: unknown; dailySummary: unknown; exercises?: Array<{ exerciseId: string; blockId: string; name: string; date: string; sets: ToolCallData['blocks'][number]['exercises'][number]['sets'] }> } = await ctx.runQuery(internal.functions.exercises.getDataForTurn, { userId: context.profile._id, startDate, endDate, exerciseId, dailySummaryDate, collectionPoints })
          for (const item of data.exercises ?? []) historicalBlocks.set(item.exerciseId, item.blockId as Id<'blocks'>)
          historicalExerciseDetailsFetched = historicalExerciseDetailsFetched || exerciseId !== undefined
          result = { profile: data.profile, dailySummary: data.dailySummary, exercises: (data.exercises ?? []).map((item) => exerciseId === undefined ? { exerciseId: item.exerciseId, name: item.name, date: item.date } : { exerciseId: item.exerciseId, name: item.name, date: item.date, sets: item.sets }) }
          lastGetDataResult = result
        }
      } else if (toolName === 'search_exercise_library') {
        const rawQueries = Array.isArray(requestArgs.queries)
          ? requestArgs.queries
          : []
        const queries = rawQueries
          .filter((query): query is string => typeof query === 'string').map((query) => query.trim()).filter((query) => query.length > 0)
        if (rawQueries.length > 5 || queries.length === 0 || queries.length > 5) result = { error: 'search_exercise_library requires one to five concrete exercise names.' }
        else {
          const searches: Array<{ autoResolved: { exerciseId: Id<'exerciseLibrary'>; canonicalName: string; description: string | null; score: number } | null; candidates: Array<{ _id: Id<'exerciseLibrary'>; canonicalName: string; description: string | null; score: number }> }> = await Promise.all(queries.map((rawInput) => ctx.runAction(internal.functions.exerciseLibrary.searchForTurn, { userId: context.profile._id, rawInput })))
          const entries: LibraryReferenceEntry[] = searches.flatMap((search) => [
            ...(search.autoResolved === null ? [] : [{ exerciseLibraryId: search.autoResolved.exerciseId, canonicalName: search.autoResolved.canonicalName, description: search.autoResolved.description }]),
            ...search.candidates.map((candidate) => ({ exerciseLibraryId: candidate._id, canonicalName: candidate.canonicalName, description: candidate.description })),
          ])
          const references = await ctx.runMutation(internal.functions.messages.createLibraryReferences, { chatId: args.chatId, userId: context.profile._id, messageId, entries })
          const labels = new Map(references.map((reference) => [reference.exerciseLibraryId, reference.label]))
          result = { searches: searches.map((search, index) => ({
            query: queries[index],
            autoResolved: search.autoResolved === null ? null : { exerciseId: labels.get(search.autoResolved.exerciseId) ?? '', canonicalName: search.autoResolved.canonicalName, description: search.autoResolved.description, score: search.autoResolved.score },
            candidates: search.candidates.map((candidate) => ({ exerciseId: labels.get(candidate._id) ?? '', canonicalName: candidate.canonicalName, description: candidate.description, score: candidate.score })),
          })) }
          if (searches.some((search) => search.autoResolved === null) && !usedTools.includes(guideMarker)) usedTools.push(guideMarker)
        }
      } else if (toolName === 'get_new_exercise_guidance') {
        const parsed = newExerciseGuidanceInputSchema.safeParse(request.args)
        if (!parsed.success) result = { error: 'get_new_exercise_guidance needs a concrete raw phrase and the exact candidate list returned by search_exercise_library.' }
        else {
          try {
            const guidance = await getNewExerciseGuidance(parsed.data, context.leanContext.activeInjuries, modelRuntimeConfig.modelId, modelRuntimeConfig.apiKey)
            reservedRequestsUsed += 1
            tokensUsed += guidance.usage.total
            result = { ...guidance.output, exerciseNamingGuidance: EXERCISE_NAMING_GUIDANCE }
            await ctx.runMutation(internal.functions.exerciseLibrary.recordGuideInvocation, { userId: context.profile._id, messageId })
            if (guidance.output.outcome !== 'still_ambiguous') {
              const markerIndex = usedTools.lastIndexOf(guideMarker)
              if (markerIndex !== -1) usedTools.splice(markerIndex, 1)
            }
          } catch (error) { result = { error: `Exercise-name guidance could not run: ${errorMessage(error)}` } }
        }
      } else if (toolName === 'create_custom_exercise') {
        const parsed = createCustomExerciseSchema.safeParse(request.args)
        if (!parsed.success) result = { error: 'Custom exercise details are invalid. Provide a name and a concrete description.' }
        else {
          const created = await ctx.runAction(internal.functions.exerciseLibrary.createCustomExerciseAction, { userId: context.profile._id, messageId, input: parsed.data })
          if (created.exerciseId === undefined) result = { error: created.error ?? 'Could not create the custom exercise.' }
          else {
            const references = await ctx.runMutation(internal.functions.messages.createLibraryReferences, {
              chatId: args.chatId,
              userId: context.profile._id,
              messageId,
              entries: [{ exerciseLibraryId: created.exerciseId, canonicalName: parsed.data.name, description: parsed.data.description }],
            })
            const reference = references[0]
            result = reference === undefined
              ? { error: 'Could not create a reference for the custom exercise.' }
              : { exerciseId: reference.label, canonicalName: reference.canonicalName, description: reference.description }
          }
        }
      } else if (toolName === 'Correct_log') {
        const correction = requestArgs
        const validation = 'parsedData' in correction ? validateToolCall(correction.parsedData) : { isValid: false as const, parsedData: {}, issues: [{ code: 'missing_parsed_data', message: 'Correct_log did not include parsedData.', path: 'parsedData' }] }
        if (!validation.isValid || typeof correction.target !== 'string') result = {
          error: 'Correct_log payload is invalid.',
          validationIssues: validation.isValid ? [] : validation.issues,
        }
        else if (correction.target === 'card' && typeof correction.cardLabel === 'string') {
          const card = context.pinnedCards.find((item) => item.label === correction.cardLabel)?.card
          if (card === undefined) result = { error: 'The requested active card label was not found.' }
          else {
            const write = await ctx.runMutation(internal.functions.cards.applyDiscussionCorrection, { cardId: card._id, parsedData: validation.parsedData, rawOutput: JSON.stringify(correction) })
            result = write
            if ('cardId' in write && write.cardId !== undefined) cardIds.push(write.cardId as Id<'cards'>)
          }
        } else if (correction.target === 'historical' && typeof correction.exerciseId === 'string' && historicalExerciseDetailsFetched) {
          const blockId = historicalBlocks.get(correction.exerciseId)
          const block = blockId === undefined ? null : await ctx.runQuery(internal.functions.exercises.getHistoricalBlock, { userId: context.profile._id, blockId })
          result = block === null ? { error: 'The requested historical exercise was not found after lookup.' } : await ctx.runMutation(internal.functions.messages.writeLowConfidenceTurn, { chatId: args.chatId, messageId, parsedData: validation.parsedData, rawOutput: JSON.stringify(correction), correctsBlockId: block._id })
          if ('cardId' in result && result.cardId !== undefined) cardIds.push(result.cardId as Id<'cards'>)
        } else result = { error: 'Correct_log needs a valid active Card label, or a historical Exercise label whose full details were returned by Get_data earlier in this turn.' }
      } else if (toolName === 'log_workout') {
        const labels = libraryExerciseLabels(request.args)
        const references = await ctx.runQuery(internal.functions.messages.resolveLibraryReferences, { chatId: args.chatId, userId: context.profile._id, labels })
        const resolved = new Map(references.map((reference) => [reference.label, reference.exerciseLibraryId]))
        const missingLabels = labels.filter((label) => !resolved.has(label))
        const validation = missingLabels.length > 0
          ? { isValid: false as const, parsedData: {}, issues: missingLabels.map((label) => ({ code: 'expired_library_reference', message: `${label} is no longer available. Search the exercise library again before logging.`, path: 'blocks.exercises.exerciseId' })) }
          : validateToolCall(replaceLibraryExerciseLabels(request.args, resolved))
        if (!validation.isValid) result = { error: 'log_workout validation failed. Correct the payload and resolve every exercise before retrying.', validationIssues: validation.issues }
        else {
          const writes: object[] = []
          for (const [index, block] of validation.parsedData.blocks.entries()) {
            const blockData: ToolCallData = { ...validation.parsedData, blocks: [block] }
            const write = blockData.needsClarification
              ? await ctx.runMutation(internal.functions.messages.writeLowConfidenceTurn, { chatId: args.chatId, messageId, parsedData: blockData, rawOutput: JSON.stringify(blockData), order: index })
              : await ctx.runMutation(internal.functions.cards.writeHighConfidenceCard, { chatId: args.chatId, messageId, userId: context.profile._id, parsedData: blockData, rawOutput: JSON.stringify(blockData), order: index })
            writes.push(write)
            if ('cardId' in write && write.cardId !== undefined) cardIds.push(write.cardId as Id<'cards'>)
            if ('error' in write && write.error !== undefined) { result = { error: write.error, writes }; return { request, result, cardIds } }
            if ('sessionId' in write && write.sessionId !== undefined) await ctx.runMutation(internal.functions.messages.setMessageSession, { messageId, sessionId: write.sessionId as Id<'sessions'> })
          }
          result = { logged: true, needsClarification: validation.parsedData.needsClarification, writes }
        }
      } else result = { error: `Unknown tool ${toolName}.` }
      return { request, result, cardIds }
    }

    let failoverCount = 0
    const failedPoolIds: Id<'debugLiveGeminiPools'>[] = []
    const failOverAfterRateLimit = async (error: unknown, callIndex: number): Promise<boolean> => {
      if (!isProviderRateLimit(error) || failoverCount >= 1) return false
      if (activeLiveReservation.reservationId !== undefined) {
        await ctx.runMutation(markLiveReservationRateLimited, {
          reservationId: activeLiveReservation.reservationId,
          usedRequests: Math.max(reservedRequestsUsed, 1),
          totalTokens: tokensUsed,
        })
      }
      if (activeLiveReservation.poolId !== undefined) failedPoolIds.push(activeLiveReservation.poolId)
      await trace({
        kind: 'warning', status: 'warning', title: 'Gemini pool returned 429',
        summary: `Pool ${activeLiveReservation.poolName ?? 'default'} was rate-limited and placed on cooldown.`,
        source: { file: 'convex/functions/messages.ts', symbol: 'processTurn' },
        details: serialiseDebugDetails({ callIndex, poolId: activeLiveReservation.poolId, poolName: activeLiveReservation.poolName, error: errorMessage(error) }),
        callIndex, warningCodes: [],
      })
      const replacement = await ctx.runMutation(reserveLiveGemini, {
        workflow: 'chat', modelId: runtimeConfig.modelId, poolIds: runtimeConfig.poolIds, requestCount: 1, excludedPoolIds: failedPoolIds,
      })
      if (replacement.apiKey === undefined) return false
      activeLiveReservation = replacement
      modelRuntimeConfig = { ...runtimeConfig, apiKey: replacement.apiKey }
      reservedRequestsUsed = 0
      failoverCount += 1
      await trace({
        kind: 'lifecycle', status: 'success', title: 'Gemini failed over to pool',
        summary: `Retrying Gemini call ${callIndex} with pool ${replacement.poolName ?? 'default'}.`,
        source: { file: 'convex/functions/messages.ts', symbol: 'processTurn' },
        details: serialiseDebugDetails({ callIndex, failedPoolIds, poolId: replacement.poolId, poolName: replacement.poolName }),
        callIndex, warningCodes: [],
      })
      return true
    }

    await trace({
      kind: 'lifecycle', status: 'success', title: 'Gemini pool selected',
      summary: `Sending the turn to pool ${activeLiveReservation.poolName ?? 'default'}.`,
      source: { file: 'convex/functions/messages.ts', symbol: 'processTurn' },
      details: serialiseDebugDetails({ poolId: activeLiveReservation.poolId, poolName: activeLiveReservation.poolName }),
      warningCodes: [],
    })

    const initialCallStartedAt = Date.now()
    await trace({
      kind: 'gemini',
      status: 'running',
      title: 'Gemini call 0 started',
      summary: 'Initial turn request sent to Gemini.',
      source: { file: 'convex/lib/gemini.ts', symbol: 'beginGeminiTurn' },
      details: serialiseDebugDetails(initialDebugPayload),
      callIndex: 0,
      occurredAt: initialCallStartedAt,
      warningCodes: [],
    })
    let geminiTurn: GeminiTurn | undefined
    let initialError: unknown | null = null
    for (let attempt = 0; attempt < 2 && geminiTurn === undefined; attempt += 1) {
      try { geminiTurn = await beginGeminiTurn(context, userText, modelRuntimeConfig); reservedRequestsUsed += 1 } catch (error) {
        initialError = error
        await trace({
          kind: 'error', status: 'error', title: `Gemini call 0${attempt === 0 ? '' : ' failover retry'} failed`, summary: errorMessage(error),
          source: { file: 'convex/lib/gemini.ts', symbol: 'beginGeminiTurn' }, details: serialiseDebugError(error), callIndex: 0,
          durationMs: Date.now() - initialCallStartedAt, warningCodes: [],
        })
        if (!await failOverAfterRateLimit(error, 0)) break
      }
    }
    if (geminiTurn === undefined) {
      const error = initialError ?? new Error('Gemini did not start a chat turn.')
      await trace({
        kind: 'error',
        status: 'error',
        title: 'Gemini call 0 ended without a response',
        summary: errorMessage(error),
        source: { file: 'convex/lib/gemini.ts', symbol: 'beginGeminiTurn' },
        details: serialiseDebugError(error),
        callIndex: 0,
        durationMs: Date.now() - initialCallStartedAt,
        warningCodes: [],
      })
      await ctx.runMutation(internal.functions.messages.completeMessage, { messageId, ecoText: responseUnavailableText })
      await releaseLiveReservation(tokensUsed)
      return { ecoText: '', error: `${responseUnavailableText} ${errorMessage(error)}` }
    }
    let response = geminiTurn.response
    await trace({
      kind: 'gemini',
      status: 'success',
      title: 'Gemini call 0 completed',
      summary: response.functionCalls.length === 0
        ? 'Gemini returned a text response.'
        : `Gemini returned ${response.functionCalls.length} function request${response.functionCalls.length === 1 ? '' : 's'}.`,
      source: { file: 'convex/lib/gemini.ts', symbol: 'beginGeminiTurn' },
      details: responseDetails(response),
      callIndex: 0,
      durationMs: Date.now() - initialCallStartedAt,
      tokens: response.usage,
      warningCodes: [],
    })
    tokensUsed += response.tokensUsed
    let pendingRequests = await reserveResponseTimeline(response)
    let geminiCallIndex = 0
    for (let followUpRequests = 0; pendingRequests.length > 0; followUpRequests += 1) {
      const requests = pendingRequests
      if (followUpRequests >= followUpRequestLimit) {
        for (const request of requests) {
          usedTools.push(request.name)
          await beginToolTrace(request)
          const result = {
            error: 'This request was not executed because the turn reached its five follow-up model-request safety limit.',
            _ecoTurnControl: {
              freshTurnFollowUpLimit: followUpRequestLimit,
              completedFollowUpRequests: followUpRequestLimit,
              remainingFollowUpRequests: 0,
              instruction: 'The final follow-up opportunity was already used. End this turn conversationally without claiming this request ran.',
            },
          }
          await finishToolTrace({ request, result, cardIds: [] }, 'rejected')
        }
        ecoTextSegments.push(followUpLimitFallback)
        await append('text', followUpLimitFallback)
        response = { ...response, functionCalls: [], rawText: '', text: followUpLimitFallback, parts: [{ kind: 'text', text: followUpLimitFallback }] }
        break
      }
      for (const request of requests) {
        usedTools.push(request.name)
        await beginToolTrace(request)
      }
      const executions: ToolExecution[] = []
      let redundantGetDataDetected = false
      for (let index = 0; index < requests.length;) {
        const next = requests[index]
        if (next === undefined) break
        const nextArgs = requestRecord(next.args)
        if (next.name === 'Get_data' && typeof nextArgs.exerciseId !== 'string') {
          if (completedGetDataCalls > 0) {
            const result = { error: 'Get_data profile, date-range, and daily-summary lookups must be combined into the first general lookup of the turn.' }
            executions.push({ request: next, result, cardIds: [] })
            redundantGetDataDetected = true
            await trace({
              kind: 'warning',
              status: 'warning',
              title: 'Redundant Get_data call stopped',
              summary: 'Gemini attempted another general Get_data lookup after the turn had already completed one.',
              source: { file: 'convex/functions/messages.ts', symbol: 'processTurn' },
              details: serialiseDebugDetails({
                arguments: next.args,
                completedGetDataCalls,
                lastGetDataResult,
              }),
              callIndex: geminiCallIndex,
              toolName: next.name,
              warningCodes: [DEBUG_WARNING.redundantDataLookup],
            })
            index += 1
            continue
          }
          completedGetDataCalls += 1
        }
        if (!canRunTogether(next)) { executions.push(await execute(next)); index += 1; continue }
        const group: ToolRequest[] = []
        while (index < requests.length) {
          const candidate = requests[index]
          if (candidate === undefined || !canRunTogether(candidate)) break
          group.push(candidate)
          index += 1
        }
        executions.push(...await Promise.all(group.map(execute)))
      }
      const completedFollowUpRequests = followUpRequests + 1
      const controlledExecutions = executions.map((execution) => ({
        ...execution,
        result: withTurnControl(execution.result, completedFollowUpRequests),
      }))
      for (const execution of controlledExecutions) {
        const latestCardId = execution.cardIds.at(-1)
        if (latestCardId !== undefined) lastCardId = latestCardId
        await finishToolTrace(execution, 'completed')
        await trace({ kind: 'tool', status: toolResultHasError(execution.result) ? 'error' : 'success', title: `${execution.request.name} executed`, summary: toolResultHasError(execution.result) ? 'The tool returned a recoverable error for Gemini.' : 'The tool returned a result for Gemini.', source: { file: 'convex/functions/messages.ts', symbol: 'processTurn' }, details: serialiseDebugDetails({ arguments: execution.request.args, result: execution.result }), toolName: execution.request.name, warningCodes: toolResultHasError(execution.result) ? [DEBUG_WARNING.toolResultError] : [] })
      }
      if (redundantGetDataDetected) {
        const fallbackContext = lastGetDataResult ?? { profile: { name: context.leanContext.name } }
        const fallback = dataLookupFallback(fallbackContext)
        ecoTextSegments.push(fallback)
        await append('text', fallback)
        response = { ...response, functionCalls: [], rawText: '', text: fallback, parts: [{ kind: 'text', text: fallback }] }
        break
      }
      const toolResponses = controlledExecutions.map(({ request, result }) => ({ name: request.name, response: result, id: request.id }))
      geminiCallIndex += 1
      const continuationStartedAt = Date.now()
      await trace({
        kind: 'gemini',
        status: 'running',
        title: `Gemini call ${geminiCallIndex} started`,
        summary: 'Returning tool results to Gemini.',
        source: { file: 'convex/lib/gemini.ts', symbol: 'continueGeminiTurn' },
        details: serialiseDebugDetails({ functionResponses: toolResponses }),
        callIndex: geminiCallIndex,
        occurredAt: continuationStartedAt,
        warningCodes: [],
      })
      let continuationError: unknown | null = null
      try { response = await continueGeminiTurn(geminiTurn.chat, toolResponses); reservedRequestsUsed += 1 } catch (error) {
        continuationError = error
        await trace({
          kind: 'error',
          status: 'error',
          title: `Gemini call ${geminiCallIndex} failed`,
          summary: errorMessage(error),
          source: { file: 'convex/lib/gemini.ts', symbol: 'continueGeminiTurn' },
          details: serialiseDebugError(error),
          callIndex: geminiCallIndex,
          durationMs: Date.now() - continuationStartedAt,
          warningCodes: [],
        })
        if (await failOverAfterRateLimit(error, geminiCallIndex)) {
          geminiTurn.chat = resumeGeminiTurnForFailover(geminiTurn.chat, context, modelRuntimeConfig)
          try { response = await continueGeminiTurn(geminiTurn.chat, toolResponses); reservedRequestsUsed += 1; continuationError = null } catch (retryError) {
            continuationError = retryError
            await trace({
              kind: 'error', status: 'error', title: `Gemini call ${geminiCallIndex} failover retry failed`, summary: errorMessage(retryError),
              source: { file: 'convex/lib/gemini.ts', symbol: 'continueGeminiTurn' }, details: serialiseDebugError(retryError), callIndex: geminiCallIndex,
              durationMs: Date.now() - continuationStartedAt, warningCodes: [],
            })
          }
        }
      }
      if (continuationError !== null) {
        await ctx.runMutation(internal.functions.apiUsage.logUsage, { userId: context.profile._id, tokensUsed, timestamp: Date.now() })
        await ctx.runMutation(internal.functions.messages.completeMessage, { messageId, ecoText: responseUnavailableText, usedTools })
        await releaseLiveReservation(tokensUsed)
        return { ecoText: '', error: `${responseUnavailableText} ${errorMessage(continuationError)}` }
      }
      await trace({
        kind: 'gemini',
        status: 'success',
        title: `Gemini call ${geminiCallIndex} completed`,
        summary: response.functionCalls.length === 0
          ? 'Gemini returned a text response.'
          : `Gemini returned ${response.functionCalls.length} function request${response.functionCalls.length === 1 ? '' : 's'}.`,
        source: { file: 'convex/lib/gemini.ts', symbol: 'continueGeminiTurn' },
        details: responseDetails(response),
        callIndex: geminiCallIndex,
        durationMs: Date.now() - continuationStartedAt,
        tokens: response.usage,
        warningCodes: [],
      })
      tokensUsed += response.tokensUsed
      pendingRequests = await reserveResponseTimeline(response)
    }
    await ctx.runMutation(internal.functions.apiUsage.logUsage, { userId: context.profile._id, tokensUsed, timestamp: Date.now() })
    await releaseLiveReservation(tokensUsed)
    const ecoText = ecoTextSegments.join('\n\n') || response.text
    await ctx.runMutation(internal.functions.messages.completeMessage, { messageId, ecoText, usedTools: usedTools.length === 0 ? undefined : usedTools, isFinalGeminiResponse: true })
    return { ecoText, cardId: lastCardId }
  },
})
