import {
  FunctionCallingMode,
  GoogleGenerativeAI,
  SchemaType,
  type ChatSession,
  type Content,
  type FunctionCall,
  type FunctionDeclaration,
  type Schema,
} from '@google/generative-ai'

import type { Doc, Id } from '../_generated/dataModel'
import { buildEcoSystemPrompt, buildExerciseNameResolutionPrompt } from './prompts/ecoSystem'
import { newExerciseGuidanceOutputSchema, type NewExerciseGuidanceInput, type NewExerciseGuidanceOutput } from './validation'

declare const process: { env: Record<string, string | undefined> }

const modelName = 'gemini-3.1-flash-lite'

const setSchema: Schema = { type: SchemaType.OBJECT, properties: { reps: { type: SchemaType.NUMBER }, weight: { type: SchemaType.NUMBER }, duration: { type: SchemaType.NUMBER }, distance: { type: SchemaType.NUMBER } } }
const exerciseSchema: Schema = {
  type: SchemaType.OBJECT,
  properties: { name: { type: SchemaType.STRING }, exerciseId: { type: SchemaType.STRING }, aliasText: { type: SchemaType.STRING, description: 'Only for a genuine alternate name; omit canonical, vague, or descriptive wording.' }, sets: { type: SchemaType.ARRAY, items: setSchema }, order: { type: SchemaType.NUMBER } },
  required: ['name', 'exerciseId', 'sets', 'order'],
}

const logWorkoutTool: FunctionDeclaration = {
  name: 'log_workout', description: 'Create new workout data only; never correct a card or past workout.',
  parameters: { type: SchemaType.OBJECT, properties: { blocks: { type: SchemaType.ARRAY, items: { type: SchemaType.OBJECT, properties: { type: { type: SchemaType.STRING, format: 'enum', enum: ['standard', 'superset', 'dropset', 'emom', 'pyramid', 'circuit', 'amrap'] }, exercises: { type: SchemaType.ARRAY, items: exerciseSchema }, intervalSeconds: { type: SchemaType.NUMBER }, order: { type: SchemaType.NUMBER } }, required: ['type', 'exercises', 'order'] } }, needsClarification: { type: SchemaType.BOOLEAN } }, required: ['blocks', 'needsClarification'] },
}
const getDataTool: FunctionDeclaration = { name: 'Get_data', description: 'Read missing profile fields, one daily summary, or workout history. For historical corrections, request dateRange, then use one returned Exercise N label as exerciseId. Never use database IDs.', parameters: { type: SchemaType.OBJECT, properties: { dateRange: { type: SchemaType.OBJECT, properties: { startDate: { type: SchemaType.STRING }, endDate: { type: SchemaType.STRING } }, required: ['startDate', 'endDate'] }, exerciseId: { type: SchemaType.STRING }, dailySummaryDate: { type: SchemaType.STRING, description: 'Local date: YYYY-MM-DD.' }, collectionPoints: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING, format: 'enum', enum: ['name', 'injuries', 'equipment', 'goals', 'trainingPattern', 'skillLevel', 'weightUnit', 'distanceUnit'] } } } } }
const correctLogTool: FunctionDeclaration = { name: 'Correct_log', description: 'Correct one Card N or returned Exercise N; parsedData is the complete replacement block.', parameters: { type: SchemaType.OBJECT, properties: { target: { type: SchemaType.STRING, format: 'enum', enum: ['card', 'historical'] }, cardLabel: { type: SchemaType.STRING }, exerciseId: { type: SchemaType.STRING }, parsedData: { type: SchemaType.OBJECT, properties: {} } }, required: ['target', 'parsedData'] } }
const searchExerciseLibraryTool: FunctionDeclaration = { name: 'search_exercise_library', description: 'Resolve one uncertain exercise name before logging. Use autoResolved.exerciseId when returned; otherwise continue from the candidates—never guess.', parameters: { type: SchemaType.OBJECT, properties: { rawInput: { type: SchemaType.STRING } }, required: ['rawInput'] } }
const getNewExerciseGuidanceTool: FunctionDeclaration = { name: 'get_new_exercise_guidance', description: 'Resolve an active naming conversation from the original phrase, gathered detail, and exact search candidates. Read-only outcomes: resolved_existing, resolved_custom, still_ambiguous, declined_unsafe. Existing: use exerciseId and carry aliasText only when returned. Custom: call create_custom_exercise, then log_workout. For still_ambiguous, continue conversationally; for declined_unsafe, close conversationally. Call no further tool for either.', parameters: { type: SchemaType.OBJECT, properties: { rawPhrase: { type: SchemaType.STRING }, conversationDetail: { type: SchemaType.STRING, description: 'Known execution, origin, equipment, or safety details; omit if none.' }, candidates: { type: SchemaType.ARRAY, items: { type: SchemaType.OBJECT, properties: { exerciseId: { type: SchemaType.STRING }, canonicalName: { type: SchemaType.STRING }, description: { type: SchemaType.STRING, nullable: true }, score: { type: SchemaType.NUMBER } }, required: ['exerciseId', 'canonicalName', 'description', 'score'] } } }, required: ['rawPhrase', 'candidates'] } }
const createCustomExerciseTool: FunctionDeclaration = { name: 'create_custom_exercise', description: 'Create a personal exercise during active naming guidance only after confirming it is genuinely new and the user wants it kept as custom. Use its exerciseId before log_workout.', parameters: { type: SchemaType.OBJECT, properties: { name: { type: SchemaType.STRING }, description: { type: SchemaType.STRING }, category: { type: SchemaType.STRING }, equipment: { type: SchemaType.STRING }, muscleGroup: { type: SchemaType.STRING }, allMuscles: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING } }, aliases: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING } } }, required: ['name', 'description'] } }
const calculateTool: FunctionDeclaration = {
  name: 'calculate',
  description: 'Deterministic PT math. Use a named operation whenever one applies; use expression only for unsupported pure arithmetic, never formula recall.',
  parameters: { type: SchemaType.OBJECT, properties: {
    operation: { type: SchemaType.STRING, format: 'enum', enum: ['oneRepMax', 'percentOf1RM', 'convertUnit', 'plateMath', 'volumeTotal', 'paceConvert', 'expression'] }, formula: { type: SchemaType.STRING, format: 'enum', enum: ['epley', 'brzycki'] }, weight: { type: SchemaType.NUMBER }, reps: { type: SchemaType.NUMBER }, weightUnit: { type: SchemaType.STRING, format: 'enum', enum: ['kg', 'lbs'] }, oneRepMax: { type: SchemaType.NUMBER }, percent: { type: SchemaType.NUMBER }, value: { type: SchemaType.NUMBER }, from: { type: SchemaType.STRING, format: 'enum', enum: ['kg', 'lbs', 'km', 'miles'] }, to: { type: SchemaType.STRING, format: 'enum', enum: ['kg', 'lbs', 'km', 'miles'] }, targetWeight: { type: SchemaType.NUMBER }, barWeight: { type: SchemaType.NUMBER, description: 'Required; never assume.' }, availablePlates: { type: SchemaType.ARRAY, items: { type: SchemaType.NUMBER } }, sets: { type: SchemaType.ARRAY, items: { type: SchemaType.OBJECT, properties: { reps: { type: SchemaType.NUMBER }, weight: { type: SchemaType.NUMBER } }, required: ['reps', 'weight'] } }, distance: { type: SchemaType.NUMBER }, distanceUnit: { type: SchemaType.STRING, format: 'enum', enum: ['km', 'miles'] }, duration: { type: SchemaType.NUMBER, description: 'Seconds.' }, expression: { type: SchemaType.STRING, description: 'Numbers, parentheses, + - * / %, and only sqrt, round, floor, ceil, min, max, pow, abs.' },
  }, required: ['operation'] },
}
const replySchema: Schema = { type: SchemaType.OBJECT, properties: { reply: { type: SchemaType.STRING } }, required: ['reply'] }

export interface LeanContext { name: string; tonePreference: string; weightUnit: 'kg' | 'lbs'; distanceUnit: string; activeInjuries: Array<{ description: string; status: string; notedAt: number }>; workoutContext: Doc<'workoutContext'>['content'] | null }
type MessageWithBlocks = Doc<'messages'> & {
  messageBlocks: Array<Pick<Doc<'messageBlocks'>, 'content' | 'order' | 'toolName' | 'type'>>
}
export interface GeminiContext { profile: Doc<'profiles'>; leanContext: LeanContext; dailySummary: Doc<'dailySummaries'> | null; currentChatDate: string; recentMessages: MessageWithBlocks[]; sessionSummaries: Doc<'sessionSummaries'>[]; pinnedCards: Array<{ label: string; card: Doc<'cards'> }>; guideActive: boolean; guideTurns: number }
export interface GeminiUsage { prompt?: number; output?: number; total: number }
export interface GeminiResponse {
  functionCalls: FunctionCall[]
  rawText: string
  text: string
  tokensUsed: number
  usage: GeminiUsage
}
export interface GeminiTurn { chat: ChatSession; response: GeminiResponse }
export interface NewExerciseGuidanceResult {
  output: NewExerciseGuidanceOutput
  usage: GeminiUsage
}

function buildHistory(
  messages: MessageWithBlocks[],
  dailySummary: Doc<'dailySummaries'> | null,
  currentChatDate: string,
): Content[] {
  const dailySummaryContext: Content[] = dailySummary === null
    ? [
        {
          role: 'user' as const,
          parts: [{ text: `<latest_daily_summary>\nstatus: none exists yet\ncurrent_chat_date: ${currentChatDate}\n</latest_daily_summary>\n\nThis is background context, not a request for a reply.` }],
        },
        {
          role: 'model' as const,
          parts: [{ text: 'Understood. I will use this as background context.' }],
        },
      ]
    : [
        {
          role: 'user' as const,
          parts: [{ text: `<latest_daily_summary>\nsummary_date: ${dailySummary.date}\ncurrent_chat_date: ${currentChatDate}\n${dailySummary.content}\n</latest_daily_summary>\n\nThis is background context, not a request for a reply.` }],
        },
        {
          role: 'model' as const,
          parts: [{ text: 'Understood. I will use this as background context.' }],
        },
      ]

  return [
    ...dailySummaryContext,
    ...messages.flatMap((message) => {
      const toolHistory = [...message.messageBlocks]
        .sort((left, right) => left.order - right.order)
        .map(({ type, toolName, content }) => ({ type, toolName, content }))
      return [
        { role: 'user' as const, parts: [{ text: message.userText }] },
        { role: 'model' as const, parts: [{ text: `${message.ecoText}\n<tool_history>\n${JSON.stringify(toolHistory)}\n</tool_history>` }] },
      ]
    }),
  ]
}
function textReply(text: string, fallback: string): string { try { const value: unknown = JSON.parse(text); if (typeof value === 'object' && value !== null && 'reply' in value && typeof value.reply === 'string') return value.reply } catch { /* tool calls commonly have no text */ } return text || fallback }
function toGeminiResponse(response: Awaited<ReturnType<ChatSession['sendMessage']>>['response']): GeminiResponse {
  const functionCalls = response.functionCalls() ?? []
  const rawText = response.text()
  const usage = {
    prompt: response.usageMetadata?.promptTokenCount,
    output: response.usageMetadata?.candidatesTokenCount,
    total: response.usageMetadata?.totalTokenCount ?? 0,
  }
  return {
    functionCalls,
    rawText,
    text: textReply(rawText, functionCalls.length > 0 ? 'I’ve got that.' : 'I’m here — could you say that another way?'),
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
): object {
  return {
    model: modelName,
    systemInstruction: buildEcoSystemPrompt(context),
    history: buildHistory(
      context.recentMessages,
      context.dailySummary,
      context.currentChatDate,
    ),
    currentUserMessage: userText,
    availableTools: toolsForContext(context),
  }
}

export async function beginGeminiTurn(context: GeminiContext, userText: string): Promise<GeminiTurn> {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) throw new Error('GEMINI_API_KEY is not configured')
  const tools = toolsForContext(context)
  const model = new GoogleGenerativeAI(apiKey).getGenerativeModel({ model: modelName, tools: [{ functionDeclarations: tools }], toolConfig: { functionCallingConfig: { mode: FunctionCallingMode.AUTO } }, generationConfig: { responseMimeType: 'application/json', responseSchema: replySchema }, systemInstruction: buildEcoSystemPrompt(context) })
  const chat = model.startChat({
    history: buildHistory(context.recentMessages, context.dailySummary, context.currentChatDate),
  })
  const result = await chat.sendMessage(userText)
  return { chat, response: toGeminiResponse(result.response) }
}

export async function continueGeminiTurn(
  chat: ChatSession,
  toolResults: Array<{ name: string; response: object }>,
): Promise<GeminiResponse> {
  const result = await chat.sendMessage(toolResults.map(({ name, response }) => ({ functionResponse: { name, response } })))
  return toGeminiResponse(result.response)
}

export async function getNewExerciseGuidance(input: NewExerciseGuidanceInput, activeInjuries: LeanContext['activeInjuries']): Promise<NewExerciseGuidanceResult> {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) throw new Error('GEMINI_API_KEY is not configured')
  const schema: Schema = { type: SchemaType.OBJECT, properties: { outcome: { type: SchemaType.STRING, format: 'enum', enum: ['resolved_existing', 'resolved_custom', 'still_ambiguous', 'declined_unsafe'] }, exerciseId: { type: SchemaType.STRING }, aliasText: { type: SchemaType.STRING, description: 'Only for resolved_existing when the raw user wording is a genuine alternate name worth saving.' } }, required: ['outcome'] }
  const instructions = buildExerciseNameResolutionPrompt(
    input,
    activeInjuries,
  )
  const model = new GoogleGenerativeAI(apiKey).getGenerativeModel({ model: modelName, generationConfig: { responseMimeType: 'application/json', responseSchema: schema } })
  const response = await model.generateContent(instructions)
  const parsed: unknown = JSON.parse(response.response.text())
  const result = newExerciseGuidanceOutputSchema.safeParse(parsed)
  const usage: GeminiUsage = {
    prompt: response.response.usageMetadata?.promptTokenCount,
    output: response.response.usageMetadata?.candidatesTokenCount,
    total: response.response.usageMetadata?.totalTokenCount ?? 0,
  }
  if (!result.success) return { output: { outcome: 'still_ambiguous' }, usage }
  const outcome = result.data
  if (outcome.outcome === 'resolved_existing' && !input.candidates.some((candidate) => candidate.exerciseId === outcome.exerciseId)) {
    return { output: { outcome: 'still_ambiguous' }, usage }
  }
  return { output: outcome, usage }
}
