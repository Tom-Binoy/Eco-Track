import { getAuthUserId } from '@convex-dev/auth/server'
import { v } from 'convex/values'

import { internal } from '../_generated/api'
import type { Doc, Id } from '../_generated/dataModel'
import { action, internalMutation, internalQuery, query } from '../_generated/server'
import { beginGeminiTurn, continueGeminiTurn, decideExerciseName, type GeminiContext, type LeanContext } from '../lib/gemini'
import { type ToolCallData, validateToolCall } from '../lib/validation'

const recentMessageLimit = 50
const guideMarker = 'exercise_naming_guide_active'
type TurnContext = GeminiContext & { chat: Doc<'chats'>; cacheIsFresh: boolean }
type TurnResult = { ecoText: string; cardId?: Id<'cards'>; error?: string }
type CachedContext = LeanContext

function leanContext(profile: Doc<'profiles'>, workoutContext: Doc<'workoutContext'> | null): LeanContext {
  return { tonePreference: profile.tonePreference, weightUnit: profile.weightUnit, distanceUnit: profile.distanceUnit, activeInjuries: profile.injuries.filter((injury) => injury.status !== 'resolved'), workoutContext: workoutContext?.content ?? null }
}
function isCachedContext(value: unknown): value is CachedContext { return typeof value === 'object' && value !== null && 'tonePreference' in value && 'activeInjuries' in value && 'workoutContext' in value }
function isCacheFresh(cachedAt: number | undefined, timezone: string): boolean { if (cachedAt === undefined) return false; try { const f = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }); return f.format(new Date(cachedAt)) === f.format(new Date()) } catch { return new Date(cachedAt).toISOString().slice(0, 10) === new Date().toISOString().slice(0, 10) } }

export const getTurnContext = internalQuery({
  args: { chatId: v.id('chats'), authUserId: v.id('users') },
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
    const rawMessages = (await ctx.db.query('messages').withIndex('by_chat', (q) => q.eq('chatId', chat._id)).order('desc').take(recentMessageLimit)).filter((message) => message.timestamp > compressedTill).reverse()
    const messages = await Promise.all(rawMessages.map(async (message) => ({
      ...message,
      messageBlocks: (await ctx.db.query('messageBlocks').withIndex('by_message', (q) => q.eq('messageId', message._id)).take(50))
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
export const appendBlock = internalMutation({ args: { messageId: v.id('messages'), order: v.number(), type: v.union(v.literal('text'), v.literal('tool_call'), v.literal('tool_result')), content: v.string(), toolName: v.optional(v.string()) }, handler: async (ctx, args) => await ctx.db.insert('messageBlocks', { ...args, createdAt: Date.now() }) })
export const getBlocks = query({ args: { messageId: v.id('messages') }, handler: async (ctx, args) => { const auth = await getAuthUserId(ctx); const profile = auth === null ? null : await ctx.db.query('profiles').withIndex('by_userId', (q) => q.eq('userId', auth)).unique(); const message = await ctx.db.get(args.messageId); const chat = message === null ? null : await ctx.db.get(message.chatId); if (profile === null || message === null || chat?.userId !== profile._id) return { error: 'Message not found', blocks: [] }; return { blocks: await ctx.db.query('messageBlocks').withIndex('by_message', (q) => q.eq('messageId', args.messageId)).take(50) } } })

export const writeLowConfidenceTurn = internalMutation({ args: { chatId: v.id('chats'), messageId: v.id('messages'), parsedData: v.any(), rawOutput: v.string(), correctsBlockId: v.optional(v.id('blocks')) }, handler: async (ctx, args): Promise<{ cardId: Id<'cards'> }> => ({ cardId: await ctx.db.insert('cards', { chatId: args.chatId, messageId: args.messageId, rawOutput: args.rawOutput, parsedData: args.parsedData, state: 'pending', order: 0, inDiscussion: false, correctsBlockId: args.correctsBlockId, createdAt: Date.now() }) }) })

export const getRecent = query({ args: { chatId: v.id('chats'), limit: v.number() }, handler: async (ctx, args) => { const auth = await getAuthUserId(ctx); const profile = auth === null ? null : await ctx.db.query('profiles').withIndex('by_userId', (q) => q.eq('userId', auth)).unique(); const chat = await ctx.db.get(args.chatId); if (profile === null || chat === null || chat.userId !== profile._id) return { error: 'Chat not found', messages: [] }; return { messages: (await ctx.db.query('messages').withIndex('by_chat', (q) => q.eq('chatId', args.chatId)).order('desc').take(Math.min(Math.max(Math.floor(args.limit), 1), recentMessageLimit))).reverse() } } })
export const getAllForCompression = internalQuery({
  args: { chatId: v.id('chats') },
  handler: async (ctx, args) => {
    const messages = await ctx.db.query('messages').withIndex('by_chat', (q) => q.eq('chatId', args.chatId)).order('asc').collect()
    return await Promise.all(messages.map(async (message) => ({
      ...message,
      messageBlocks: (await ctx.db.query('messageBlocks').withIndex('by_message', (q) => q.eq('messageId', message._id)).take(50))
        .sort((left, right) => left.order - right.order),
    })))
  },
})

export const processTurn = action({
  args: { chatId: v.id('chats'), userText: v.string() },
  handler: async (ctx, args): Promise<TurnResult> => {
    const authUserId = await getAuthUserId(ctx)
    if (authUserId === null) return { ecoText: '', error: 'Not authenticated' }
    const context: TurnContext | { error: string } = await ctx.runQuery(internal.functions.messages.getTurnContext, { chatId: args.chatId, authUserId })
    if ('error' in context) return { ecoText: '', error: context.error }
    if (!context.cacheIsFresh) await ctx.runMutation(internal.functions.messages.cacheContext, { chatId: args.chatId, cachedContext: context.leanContext, cachedContextAt: Date.now() })
    const messageId: Id<'messages'> = await ctx.runMutation(internal.functions.messages.writeMessage, { chatId: args.chatId, userText: args.userText, ecoText: '' })
    let geminiTurn
    try { geminiTurn = await beginGeminiTurn(context, args.userText) } catch { await ctx.runMutation(internal.functions.messages.completeMessage, { messageId, ecoText: 'Eco could not respond right now. Please try again.' }); return { ecoText: '', error: 'Eco could not respond right now. Please try again.' } // TODO: recover incomplete message rows after action crashes.
    }
    let response = geminiTurn.response
    const usedTools: string[] = response.functionCall === null ? [] : [response.functionCall.name]
    let blockOrder = 0
    await ctx.runMutation(internal.functions.messages.appendBlock, { messageId, order: blockOrder, type: response.functionCall === null ? 'text' : 'tool_call', content: response.functionCall === null ? response.text : response.functionCall.name, toolName: response.functionCall?.name })
    let historicalExerciseDetailsFetched = false
    const historicalBlocks = new Map<string, Id<'blocks'>>()
    let tokensUsed = response.tokensUsed
    for (let callCount = 0; response.functionCall?.name === 'Get_data' && callCount < 2; callCount += 1) {
      const toolArgs = response.functionCall.args
      const request = typeof toolArgs === 'object' && toolArgs !== null ? toolArgs : {}
      const dateRange = 'dateRange' in request && typeof request.dateRange === 'object' && request.dateRange !== null ? request.dateRange : null
      const startDate = dateRange !== null && 'startDate' in dateRange && typeof dateRange.startDate === 'string' ? dateRange.startDate : undefined
      const endDate = dateRange !== null && 'endDate' in dateRange && typeof dateRange.endDate === 'string' ? dateRange.endDate : undefined
      const exerciseId = 'exerciseId' in request && typeof request.exerciseId === 'string' ? request.exerciseId : undefined
      const dailySummaryDate = 'dailySummaryDate' in request && typeof request.dailySummaryDate === 'string' ? request.dailySummaryDate : undefined
      const collectionPoints = 'collectionPoints' in request && Array.isArray(request.collectionPoints) ? request.collectionPoints.filter((point): point is string => typeof point === 'string') : undefined
      const data = await ctx.runQuery(internal.functions.exercises.getDataForTurn, { userId: context.profile._id, startDate, endDate, exerciseId, dailySummaryDate, collectionPoints })
      const historicalExercises = data.exercises ?? []
      for (const item of historicalExercises) historicalBlocks.set(item.exerciseId, item.blockId as Id<'blocks'>)
      const dataForModel = { profile: data.profile, dailySummary: data.dailySummary, exercises: historicalExercises.map(({ exerciseId: label, name, date, sets }) => exerciseId === undefined ? { exerciseId: label, name, date } : { exerciseId: label, name, date, sets }) }
      historicalExerciseDetailsFetched = historicalExerciseDetailsFetched || exerciseId !== undefined
      blockOrder += 1
      await ctx.runMutation(internal.functions.messages.appendBlock, { messageId, order: blockOrder, type: 'tool_result', content: JSON.stringify(dataForModel), toolName: 'Get_data' })
      try { response = await continueGeminiTurn(geminiTurn.chat, 'Get_data', dataForModel) } catch { await ctx.runMutation(internal.functions.messages.completeMessage, { messageId, ecoText: 'Eco could not respond right now. Please try again.', usedTools }); return { ecoText: '', error: 'Eco could not respond right now. Please try again.' } }
      tokensUsed += response.tokensUsed
      if (response.functionCall !== null) usedTools.push(response.functionCall.name)
      blockOrder += 1
      await ctx.runMutation(internal.functions.messages.appendBlock, { messageId, order: blockOrder, type: response.functionCall === null ? 'text' : 'tool_call', content: response.functionCall === null ? response.text : response.functionCall.name, toolName: response.functionCall?.name })
    }
    await ctx.runMutation(internal.functions.apiUsage.logUsage, { userId: context.profile._id, tokensUsed, timestamp: Date.now() })
    const storedTools = usedTools.length === 0 ? undefined : usedTools
    if (response.functionCall === null) { await ctx.runMutation(internal.functions.messages.completeMessage, { messageId, ecoText: response.text, usedTools, isFinalGeminiResponse: true }); return { ecoText: response.text } }
    if (response.functionCall.name === 'Get_data') { await ctx.runMutation(internal.functions.messages.completeMessage, { messageId, ecoText: 'I need a little more detail before I can make that correction.', usedTools: storedTools }); return { ecoText: 'I need a little more detail before I can make that correction.' } }
    if (response.functionCall.name === 'Correct_log') {
      const correction = response.functionCall.args
      const validation = typeof correction === 'object' && correction !== null && 'parsedData' in correction ? validateToolCall(correction.parsedData) : { isValid: false as const, parsedData: {} }
      if (!validation.isValid || typeof correction !== 'object' || correction === null || !('target' in correction)) { await ctx.runMutation(internal.functions.messages.completeMessage, { messageId, ecoText: response.text, usedTools, isFinalGeminiResponse: true }); return { ecoText: response.text } }
      if (correction.target === 'card' && 'cardLabel' in correction && typeof correction.cardLabel === 'string') {
        const card = context.pinnedCards.find((item) => item.label === correction.cardLabel)?.card
        if (card !== undefined) { await ctx.runMutation(internal.functions.cards.applyDiscussionCorrection, { cardId: card._id, parsedData: validation.parsedData, rawOutput: JSON.stringify(correction) }); await ctx.runMutation(internal.functions.messages.completeMessage, { messageId, ecoText: response.text, usedTools, isFinalGeminiResponse: true }); return { ecoText: response.text, cardId: card._id } }
      }
      if (correction.target === 'historical' && historicalExerciseDetailsFetched && 'exerciseId' in correction && typeof correction.exerciseId === 'string') {
        const blockId = historicalBlocks.get(correction.exerciseId)
        const block = blockId === undefined ? null : await ctx.runQuery(internal.functions.exercises.getHistoricalBlock, { userId: context.profile._id, blockId })
        if (block !== null) { const card = await ctx.runMutation(internal.functions.messages.writeLowConfidenceTurn, { chatId: args.chatId, messageId, parsedData: validation.parsedData, rawOutput: JSON.stringify(correction), correctsBlockId: block._id }); await ctx.runMutation(internal.functions.messages.completeMessage, { messageId, ecoText: response.text, usedTools, isFinalGeminiResponse: true }); return { ecoText: response.text, cardId: card.cardId } }
      }
      if (correction.target === 'historical' && !historicalExerciseDetailsFetched) { const reply = 'I need to look up that exercise’s details before I can prepare the correction.'; await ctx.runMutation(internal.functions.messages.completeMessage, { messageId, ecoText: reply, usedTools: storedTools }); return { ecoText: reply } }
      await ctx.runMutation(internal.functions.messages.completeMessage, { messageId, ecoText: response.text, usedTools, isFinalGeminiResponse: true })
      return { ecoText: response.text }
    }
    if (response.functionCall.name !== 'log_workout') { await ctx.runMutation(internal.functions.messages.completeMessage, { messageId, ecoText: response.text, usedTools, isFinalGeminiResponse: true }); return { ecoText: response.text } }
    const validation = validateToolCall(response.functionCall.args)
    if (!validation.isValid) { await ctx.runMutation(internal.functions.messages.completeMessage, { messageId, ecoText: response.text, usedTools, isFinalGeminiResponse: true }); return { ecoText: response.text } }
    const resolved: Array<{ exerciseId?: Id<'exerciseLibrary'>; proposedName?: string }> = []
    for (const exercise of validation.parsedData.blocks.flatMap((block) => block.exercises)) {
      const lookup = await ctx.runQuery(internal.functions.exerciseLibrary.findForResolution, { userId: context.profile._id, rawInput: exercise.name })
      if (lookup.aliasExercise !== null) { resolved.push({ exerciseId: lookup.aliasExercise._id }); continue }
      await ctx.runMutation(internal.functions.messages.appendBlock, { messageId, order: resolved.length + 1, type: 'tool_result', content: 'Searching your exercise library…', toolName: 'search_exercise_library' })
      let decision
      try { decision = await decideExerciseName(exercise.name, lookup.candidates) } catch { decision = { decision: 'still_ambiguous' as const, candidateIds: lookup.candidates.map((candidate) => candidate._id), reply: 'Which exercise did you mean?' } }
      if (decision.decision === 'still_ambiguous') { await ctx.runMutation(internal.functions.messages.completeMessage, { messageId, ecoText: decision.reply, usedTools: [guideMarker], isFinalGeminiResponse: true }); return { ecoText: decision.reply } }
      if (decision.decision === 'matched' && decision.exerciseId !== undefined) { resolved.push({ exerciseId: decision.exerciseId as Id<'exerciseLibrary'> }); continue }
      resolved.push({ proposedName: decision.proposedName ?? exercise.name })
    }
    const parsedData = { ...validation.parsedData, blocks: validation.parsedData.blocks.map((block, blockIndex) => ({ ...block, exercises: block.exercises.map((exercise, exerciseIndex) => ({ ...exercise, ...resolved[validation.parsedData.blocks.slice(0, blockIndex).reduce((count, previous) => count + previous.exercises.length, 0) + exerciseIndex] })) })) }
    if (!parsedData.needsClarification) {
      const result: { cardId?: Id<'cards'>; sessionId?: Id<'sessions'>; error?: string } = await ctx.runMutation(internal.functions.cards.writeHighConfidenceCard, { chatId: args.chatId, messageId, userId: context.profile._id, parsedData, rawOutput: JSON.stringify(parsedData) })
      if (result.error !== undefined || result.cardId === undefined || result.sessionId === undefined) { await ctx.runMutation(internal.functions.messages.completeMessage, { messageId, ecoText: response.text, usedTools: storedTools, isFinalGeminiResponse: true }); return { ecoText: response.text, error: result.error ?? 'Could not save workout' } }
      await ctx.runMutation(internal.functions.messages.setMessageSession, { messageId, sessionId: result.sessionId })
      await ctx.runMutation(internal.functions.messages.completeMessage, { messageId, ecoText: response.text, usedTools: storedTools, isFinalGeminiResponse: true })
      return { ecoText: response.text, cardId: result.cardId }
    }
    const result: { cardId: Id<'cards'> } = await ctx.runMutation(internal.functions.messages.writeLowConfidenceTurn, { chatId: args.chatId, messageId, parsedData, rawOutput: JSON.stringify(parsedData) })
    await ctx.runMutation(internal.functions.messages.completeMessage, { messageId, ecoText: response.text, usedTools: storedTools, isFinalGeminiResponse: true })
    return { ecoText: response.text, cardId: result.cardId }
  },
})
