import {
  FunctionCallingConfigMode,
  GoogleGenAI,
  Type,
  type Chat,
  type Content,
  type FunctionCall,
  type FunctionDeclaration,
  type GenerateContentResponse,
  type Schema,
  type ThinkingLevel,
} from '@google/genai'

import type { Doc, Id } from '../_generated/dataModel'
import { GEMINI_MODEL } from './geminiConfig'
import { buildEcoSystemPrompt, buildExerciseNameResolutionPrompt } from './prompts/ecoSystem'
import { newExerciseGuidanceOutputSchema, type NewExerciseGuidanceInput, type NewExerciseGuidanceOutput } from './validation'

declare const process: { env: Record<string, string | undefined> }

const modelRequestTimeoutMs = 30_000
const legacyFabricatedReplies = new Set([
  'I’ve got that.',
  'Understood. I will use this as background context.',
])

const setSchema: Schema = { type: Type.OBJECT, properties: { reps: { type: Type.NUMBER }, weight: { type: Type.NUMBER }, duration: { type: Type.NUMBER }, distance: { type: Type.NUMBER } } }
const exerciseSchema: Schema = {
  type: Type.OBJECT,
  properties: { name: { type: Type.STRING }, exerciseId: { type: Type.STRING, description: 'A returned Library Exercise N label; never a database ID.' }, aliasText: { type: Type.STRING, description: 'Only for a genuine alternate name; omit canonical, vague, or descriptive wording.' }, sets: { type: Type.ARRAY, items: setSchema }, order: { type: Type.NUMBER } },
  required: ['name', 'exerciseId', 'sets', 'order'],
}

const logWorkoutTool: FunctionDeclaration = {
  name: 'log_workout', description: 'Create new workout data only; never correct a card or past workout.',
  parameters: { type: Type.OBJECT, properties: { blocks: { type: Type.ARRAY, items: { type: Type.OBJECT, properties: { type: { type: Type.STRING, format: 'enum', enum: ['standard', 'superset', 'dropset', 'emom', 'pyramid', 'circuit', 'amrap'] }, exercises: { type: Type.ARRAY, items: exerciseSchema }, intervalSeconds: { type: Type.NUMBER }, order: { type: Type.NUMBER } }, required: ['type', 'exercises', 'order'] } }, needsClarification: { type: Type.BOOLEAN } }, required: ['blocks', 'needsClarification'] },
}
const getDataTool: FunctionDeclaration = { name: 'Get_data', description: 'Read missing profile fields, one daily summary, or workout history. For historical corrections, request dateRange, then use one returned History Exercise N label as exerciseId. Never use database IDs.', parameters: { type: Type.OBJECT, properties: { dateRange: { type: Type.OBJECT, properties: { startDate: { type: Type.STRING }, endDate: { type: Type.STRING } }, required: ['startDate', 'endDate'] }, exerciseId: { type: Type.STRING }, dailySummaryDate: { type: Type.STRING, description: 'Local date: YYYY-MM-DD.' }, collectionPoints: { type: Type.ARRAY, items: { type: Type.STRING, format: 'enum', enum: ['name', 'injuries', 'equipment', 'goals', 'trainingPattern', 'skillLevel', 'weightUnit', 'distanceUnit'] } } } } }
const correctLogTool: FunctionDeclaration = { name: 'Correct_log', description: 'Correct one Card N or returned History Exercise N; parsedData is the complete replacement block.', parameters: { type: Type.OBJECT, properties: { target: { type: Type.STRING, format: 'enum', enum: ['card', 'historical'] }, cardLabel: { type: Type.STRING }, exerciseId: { type: Type.STRING }, parsedData: { type: Type.OBJECT, properties: {} } }, required: ['target', 'parsedData'] } }
const searchExerciseLibraryTool: FunctionDeclaration = { name: 'search_exercise_library', description: 'Resolve one to five uncertain exercise names before logging. Results use temporary Library Exercise N labels; use those labels in log_workout, never database IDs.', parameters: { type: Type.OBJECT, properties: { queries: { type: Type.ARRAY, description: 'One to five concrete exercise names, in workout order.', items: { type: Type.STRING } } }, required: ['queries'] } }
const getNewExerciseGuidanceTool: FunctionDeclaration = { name: 'get_new_exercise_guidance', description: 'Resolve an active naming conversation from the original phrase, gathered detail, and exact search candidates. Read-only outcomes: resolved_existing, resolved_custom, still_ambiguous, declined_unsafe. Existing: use its returned Library Exercise N label and carry aliasText only when returned. Custom: call create_custom_exercise, then log its returned Library Exercise N label. For still_ambiguous, continue conversationally; for declined_unsafe, close conversationally. Call no further tool for either.', parameters: { type: Type.OBJECT, properties: { rawPhrase: { type: Type.STRING }, conversationDetail: { type: Type.STRING, description: 'Known execution, origin, equipment, or safety details; omit if none.' }, candidates: { type: Type.ARRAY, items: { type: Type.OBJECT, properties: { exerciseId: { type: Type.STRING, description: 'A Library Exercise N label.' }, canonicalName: { type: Type.STRING }, description: { type: Type.STRING, nullable: true }, score: { type: Type.NUMBER } }, required: ['exerciseId', 'canonicalName', 'description', 'score'] } } }, required: ['rawPhrase', 'candidates'] } }
const createCustomExerciseTool: FunctionDeclaration = { name: 'create_custom_exercise', description: 'Create a personal exercise during active naming guidance only after confirming it is genuinely new and the user wants it kept as custom. It returns a Library Exercise N label for log_workout, never a database ID.', parameters: { type: Type.OBJECT, properties: { name: { type: Type.STRING }, description: { type: Type.STRING }, category: { type: Type.STRING }, equipment: { type: Type.STRING }, muscleGroup: { type: Type.STRING }, allMuscles: { type: Type.ARRAY, items: { type: Type.STRING } }, aliases: { type: Type.ARRAY, items: { type: Type.STRING } } }, required: ['name', 'description'] } }
const calculateTool: FunctionDeclaration = {
  name: 'calculate',
  description: 'Deterministic PT math. Use a named operation whenever one applies; use expression only for unsupported pure arithmetic, never formula recall.',
  parameters: { type: Type.OBJECT, properties: {
    operation: { type: Type.STRING, format: 'enum', enum: ['oneRepMax', 'percentOf1RM', 'convertUnit', 'plateMath', 'volumeTotal', 'paceConvert', 'expression'] }, formula: { type: Type.STRING, format: 'enum', enum: ['epley', 'brzycki'] }, weight: { type: Type.NUMBER }, reps: { type: Type.NUMBER }, weightUnit: { type: Type.STRING, format: 'enum', enum: ['kg', 'lbs'] }, oneRepMax: { type: Type.NUMBER }, percent: { type: Type.NUMBER }, value: { type: Type.NUMBER }, from: { type: Type.STRING, format: 'enum', enum: ['kg', 'lbs', 'km', 'miles'] }, to: { type: Type.STRING, format: 'enum', enum: ['kg', 'lbs', 'km', 'miles'] }, targetWeight: { type: Type.NUMBER }, barWeight: { type: Type.NUMBER, description: 'Required; never assume.' }, availablePlates: { type: Type.ARRAY, items: { type: Type.NUMBER } }, sets: { type: Type.ARRAY, items: { type: Type.OBJECT, properties: { reps: { type: Type.NUMBER }, weight: { type: Type.NUMBER } }, required: ['reps', 'weight'] } }, distance: { type: Type.NUMBER }, distanceUnit: { type: Type.STRING, format: 'enum', enum: ['km', 'miles'] }, duration: { type: Type.NUMBER, description: 'Seconds.' }, expression: { type: Type.STRING, description: 'Numbers, parentheses, + - * / %, and only sqrt, round, floor, ceil, min, max, pow, abs.' },
  }, required: ['operation'] },
}
const replySchema: Schema = { type: Type.OBJECT, properties: { reply: { type: Type.STRING } }, required: ['reply'] }

export interface LeanContext { name: string; tonePreference: string; weightUnit: 'kg' | 'lbs'; distanceUnit: string; activeInjuries: Array<{ description: string; status: string; notedAt: number }>; workoutContext: Doc<'workoutContext'>['content'] | null }
type MessageWithBlocks = Doc<'messages'> & {
  messageBlocks: Array<Pick<Doc<'messageBlocks'>, 'content' | 'order' | 'toolName' | 'type'>>
}
export interface GeminiContext { profile: Doc<'profiles'>; leanContext: LeanContext; dailySummary: Doc<'dailySummaries'> | null; currentChatDate: string; recentMessages: MessageWithBlocks[]; sessionSummaries: Doc<'sessionSummaries'>[]; pinnedCards: Array<{ label: string; card: Doc<'cards'> }>; guideActive: boolean; guideTurns: number }
export interface GeminiUsage { prompt?: number; output?: number; total: number }
export type GeminiFunctionCall = FunctionCall
export interface GeminiResponse {
  functionCalls: GeminiFunctionCall[]
  parts: GeminiResponsePart[]
  rawText: string
  text: string
  tokensUsed: number
  usage: GeminiUsage
}
export type GeminiResponsePart =
  | { kind: 'text'; text: string }
  | { kind: 'functionCall'; call: GeminiFunctionCall }
export interface GeminiTurn { chat: Chat; response: GeminiResponse }
export interface GeminiRuntimeConfig { modelId: string; systemPrompt: string; apiKey?: string; cachedContent?: string }
export interface GeminiEvaluationTurnInput {
  apiKey: string
  model: string
  systemInstruction: string
  history: Content[]
  userText: string
  guideActive: boolean
  thinkingLevel?: ThinkingLevel
}
export type GeminiReplayVariant =
  | 'baseline'
  | 'without_get_data'
  | 'without_daily_summary'
  | 'explicit_greeting_rule'
  | 'hardened_get_data'
  | 'unambiguous_greeting'
export interface GeminiDebugPayload {
  model: string
  systemInstruction: string
  history: Content[]
  currentUserMessage: string
  availableTools: FunctionDeclaration[]
}
export interface GeminiReplaySample {
  functionCalls: GeminiFunctionCall[]
  rawText: string
  text: string
  usage: GeminiUsage
}
export interface NewExerciseGuidanceResult {
  output: NewExerciseGuidanceOutput
  usage: GeminiUsage
}

function buildHistory(
  messages: MessageWithBlocks[],
): Content[] {
  return [
    ...messages.flatMap((message, messageIndex) => {
      const toolHistory = [...message.messageBlocks]
        .sort((left, right) => left.order - right.order)
        .map(({ type, toolName, content }) => ({
          type,
          toolName,
          content: toolName === 'search_exercise_library' && messageIndex < messages.length - 4
            ? content.replace(/Library Exercise \d+ — ([^—;\n]+)(?: — [^;\n]+)?/g, '$1')
            : content,
        }))
      const assistantText = legacyFabricatedReplies.has(message.ecoText.trim())
        ? ''
        : message.ecoText
      return [
        { role: 'user' as const, parts: [{ text: message.userText }] },
        { role: 'model' as const, parts: [{ text: `${assistantText}\n<tool_history>\n${JSON.stringify(toolHistory)}\n</tool_history>` }] },
      ]
    }),
  ]
}
function textReply(text: string, fallback: string): string { try { const value: unknown = JSON.parse(text); if (typeof value === 'object' && value !== null && 'reply' in value && typeof value.reply === 'string') return value.reply } catch { /* tool calls commonly have no text */ } return text || fallback }
function toGeminiResponse(response: GenerateContentResponse): GeminiResponse {
  const rawParts = response.candidates?.[0]?.content?.parts ?? []
  const parts: GeminiResponsePart[] = []
  for (const part of rawParts) {
    if (part.thought === true) continue
    if (part.functionCall !== undefined) parts.push({ kind: 'functionCall', call: part.functionCall })
    else if (typeof part.text === 'string' && part.text.length > 0) parts.push({ kind: 'text', text: part.text })
  }
  const parsedFunctionCalls = parts.flatMap((part) => part.kind === 'functionCall' ? [part.call] : [])
  const functionCalls = parsedFunctionCalls.length > 0 ? parsedFunctionCalls : response.functionCalls ?? []
  if (parsedFunctionCalls.length === 0) {
    parts.push(...functionCalls.map((call) => ({ kind: 'functionCall' as const, call })))
  }
  const rawText = parts.flatMap((part) => part.kind === 'text' ? [part.text] : []).join('')
  const usage = {
    prompt: response.usageMetadata?.promptTokenCount,
    output: response.usageMetadata?.candidatesTokenCount,
    total: response.usageMetadata?.totalTokenCount ?? 0,
  }
  return {
    functionCalls,
    parts: parts.map((part) => part.kind === 'text'
      ? { kind: 'text' as const, text: textReply(part.text, '') }
      : part).filter((part) => part.kind !== 'text' || part.text.length > 0),
    rawText,
    text: textReply(rawText, functionCalls.length > 0 ? '' : 'I’m here — could you say that another way?'),
    tokensUsed: usage.total,
    usage,
  }
}

function toolsForContext(context: GeminiContext): FunctionDeclaration[] {
  const tools = [logWorkoutTool, getDataTool, correctLogTool, searchExerciseLibraryTool, calculateTool]
  if (context.guideActive) tools.push(getNewExerciseGuidanceTool, createCustomExerciseTool)
  return tools
}

export function buildGeminiDebugPayload(
  context: GeminiContext,
  userText: string,
  runtimeConfig: GeminiRuntimeConfig = { modelId: GEMINI_MODEL, systemPrompt: '' },
): GeminiDebugPayload {
  return {
    model: runtimeConfig.modelId,
    systemInstruction: buildEcoSystemPrompt(context, runtimeConfig.systemPrompt || undefined),
    history: buildHistory(
      context.recentMessages,
    ),
    currentUserMessage: userText,
    availableTools: toolsForContext(context),
  }
}

export function currentReplayTools(guideActive: boolean): FunctionDeclaration[] {
  return toolsForContext({ guideActive } as GeminiContext)
}

function replayVariantPayload(
  snapshot: GeminiDebugPayload,
  variant: GeminiReplayVariant,
): GeminiDebugPayload {
  const payload: GeminiDebugPayload = {
    ...snapshot,
    history: [...snapshot.history],
    availableTools: snapshot.availableTools.map((tool) => ({
      ...tool,
      parameters: tool.parameters === undefined ? undefined : { ...tool.parameters },
    })),
  }
  if (variant === 'without_get_data') {
    payload.availableTools = payload.availableTools.filter((tool) => tool.name !== 'Get_data')
  } else if (variant === 'without_daily_summary') {
    payload.systemInstruction = payload.systemInstruction.replace(
      /\n\n<latest_daily_summary>[\s\S]*?<\/latest_daily_summary>/,
      '',
    )
  } else if (variant === 'explicit_greeting_rule') {
    payload.systemInstruction += "\n\nDiagnostic instruction: A greeting, acknowledgement, or open-ended conversational message never needs 'Get_data'. Reply naturally from supplied context and never fetch data speculatively."
  } else if (variant === 'hardened_get_data') {
    payload.availableTools = payload.availableTools.map((tool) => tool.name === 'Get_data'
      ? {
          ...tool,
          description: 'Read a specific missing fact only when the user request cannot be answered from the system instruction, conversation, or supplied summaries. Never call for greetings, acknowledgements, open-ended check-ins, or values already present. Combine every needed profile field, date range, and daily summary in one request.',
        }
      : tool)
  } else if (variant === 'unambiguous_greeting') {
    payload.currentUserMessage = 'Good morning Eco! Nice to see you.'
  }
  return payload
}

export async function replayGeminiCall(
  snapshot: GeminiDebugPayload,
  variant: GeminiReplayVariant,
): Promise<GeminiReplaySample> {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) throw new Error('GEMINI_API_KEY is not configured')
  const payload = replayVariantPayload(snapshot, variant)
  const response = await new GoogleGenAI({ apiKey }).models.generateContent({
    model: payload.model,
    contents: [
      ...payload.history,
      { role: 'user', parts: [{ text: payload.currentUserMessage }] },
    ],
    config: {
      httpOptions: { timeout: modelRequestTimeoutMs },
      responseMimeType: 'application/json',
      responseSchema: replySchema,
      systemInstruction: payload.systemInstruction,
      tools: [{ functionDeclarations: payload.availableTools }],
      toolConfig: { functionCallingConfig: { mode: FunctionCallingConfigMode.AUTO } },
    },
  })
  return toGeminiResponse(response)
}

export async function critiqueReplayResults(summary: string): Promise<{
  critique: string
  usage: GeminiUsage
}> {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) throw new Error('GEMINI_API_KEY is not configured')
  const response = await new GoogleGenAI({ apiKey }).models.generateContent({
    model: GEMINI_MODEL,
    contents: `You are reviewing function-call diagnostics, not revealing hidden reasoning. Judge whether each requested Get_data field was actually absent from the supplied request snapshot. Identify likely prompt or wording triggers and distinguish evidence from speculation.\n\n${summary}`,
    config: { httpOptions: { timeout: modelRequestTimeoutMs } },
  })
  return {
    critique: response.text ?? 'No critique was returned.',
    usage: {
      prompt: response.usageMetadata?.promptTokenCount,
      output: response.usageMetadata?.candidatesTokenCount,
      total: response.usageMetadata?.totalTokenCount ?? 0,
    },
  }
}

export async function beginGeminiTurn(context: GeminiContext, userText: string, runtimeConfig: GeminiRuntimeConfig = { modelId: GEMINI_MODEL, systemPrompt: '' }): Promise<GeminiTurn> {
  const apiKey = runtimeConfig.apiKey ?? process.env.GEMINI_API_KEY
  if (!apiKey) throw new Error('GEMINI_API_KEY is not configured')
  const tools = toolsForContext(context)
  const chat = new GoogleGenAI({ apiKey }).chats.create({
    model: runtimeConfig.modelId,
    history: buildHistory(context.recentMessages),
    config: {
      httpOptions: { timeout: modelRequestTimeoutMs },
      responseMimeType: 'application/json',
      responseSchema: replySchema,
      systemInstruction: buildEcoSystemPrompt(context, runtimeConfig.systemPrompt || undefined),
      tools: [{ functionDeclarations: tools }],
      toolConfig: { functionCallingConfig: { mode: FunctionCallingConfigMode.AUTO } },
      ...(runtimeConfig.cachedContent === undefined ? {} : { cachedContent: runtimeConfig.cachedContent }),
    },
  })
  const response = await chat.sendMessage({ message: userText })
  return { chat, response: toGeminiResponse(response) }
}

// Development diagnostics only. This intentionally accepts an explicit key,
// model, and immutable prompt snapshot so it cannot alter the live turn path.
export async function beginGeminiEvaluationTurn(input: GeminiEvaluationTurnInput): Promise<GeminiTurn> {
  const chat = new GoogleGenAI({ apiKey: input.apiKey }).chats.create({
    model: input.model,
    history: input.history,
    config: {
      httpOptions: { timeout: modelRequestTimeoutMs },
      responseMimeType: 'application/json',
      responseSchema: replySchema,
      systemInstruction: input.systemInstruction,
      tools: [{ functionDeclarations: currentReplayTools(input.guideActive) }],
      toolConfig: { functionCallingConfig: { mode: FunctionCallingConfigMode.AUTO } },
      ...(input.thinkingLevel === undefined ? {} : { thinkingConfig: { thinkingLevel: input.thinkingLevel } }),
    },
  })
  const response = await chat.sendMessage({ message: input.userText })
  return { chat, response: toGeminiResponse(response) }
}

export async function continueGeminiTurn(
  chat: Chat,
  toolResults: Array<{ name: string; response: Record<string, unknown>; id?: string }>,
): Promise<GeminiResponse> {
  const response = await chat.sendMessage({
    message: toolResults.map(({ name, response, id }) => ({
      functionResponse: id === undefined ? { name, response } : { name, response, id },
    })),
  })
  return toGeminiResponse(response)
}

// A provider-429 cannot be retried through the original Chat because its
// client is bound to the failed key. Recreate the SDK chat with its typed
// curated history, which includes the preceding model function calls and
// their opaque thought signatures, then continue with the alternate key.
export function resumeGeminiTurnForFailover(chat: Chat, context: GeminiContext, runtimeConfig: GeminiRuntimeConfig): Chat {
  const apiKey = runtimeConfig.apiKey ?? process.env.GEMINI_API_KEY
  if (!apiKey) throw new Error('GEMINI_API_KEY is not configured')
  return new GoogleGenAI({ apiKey }).chats.create({
    model: runtimeConfig.modelId,
    history: chat.getHistory(true),
    config: {
      httpOptions: { timeout: modelRequestTimeoutMs },
      responseMimeType: 'application/json',
      responseSchema: replySchema,
      systemInstruction: buildEcoSystemPrompt(context, runtimeConfig.systemPrompt || undefined),
      tools: [{ functionDeclarations: toolsForContext(context) }],
      toolConfig: { functionCallingConfig: { mode: FunctionCallingConfigMode.AUTO } },
    },
  })
}

export async function getNewExerciseGuidance(input: NewExerciseGuidanceInput, activeInjuries: LeanContext['activeInjuries'], modelId = GEMINI_MODEL, apiKeyOverride?: string): Promise<NewExerciseGuidanceResult> {
  const apiKey = apiKeyOverride ?? process.env.GEMINI_API_KEY
  if (!apiKey) throw new Error('GEMINI_API_KEY is not configured')
  const schema: Schema = { type: Type.OBJECT, properties: { outcome: { type: Type.STRING, format: 'enum', enum: ['resolved_existing', 'resolved_custom', 'still_ambiguous', 'declined_unsafe'] }, exerciseId: { type: Type.STRING, description: 'One supplied Library Exercise N label for resolved_existing.' }, aliasText: { type: Type.STRING, description: 'Only for resolved_existing when the raw user wording is a genuine alternate name worth saving.' } }, required: ['outcome'] }
  const instructions = buildExerciseNameResolutionPrompt(
    input,
    activeInjuries,
  )
  const response = await new GoogleGenAI({ apiKey }).models.generateContent({ model: modelId, contents: instructions, config: { httpOptions: { timeout: modelRequestTimeoutMs }, responseMimeType: 'application/json', responseSchema: schema } })
  const parsed: unknown = JSON.parse(response.text ?? '')
  const result = newExerciseGuidanceOutputSchema.safeParse(parsed)
  const usage: GeminiUsage = {
    prompt: response.usageMetadata?.promptTokenCount,
    output: response.usageMetadata?.candidatesTokenCount,
    total: response.usageMetadata?.totalTokenCount ?? 0,
  }
  if (!result.success) return { output: { outcome: 'still_ambiguous' }, usage }
  const outcome = result.data
  if (outcome.outcome === 'resolved_existing' && !input.candidates.some((candidate) => candidate.exerciseId === outcome.exerciseId)) {
    return { output: { outcome: 'still_ambiguous' }, usage }
  }
  return { output: outcome, usage }
}
