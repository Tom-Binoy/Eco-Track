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

declare const process: { env: Record<string, string | undefined> }

const setSchema: Schema = { type: SchemaType.OBJECT, properties: { reps: { type: SchemaType.NUMBER }, weight: { type: SchemaType.NUMBER }, duration: { type: SchemaType.NUMBER }, distance: { type: SchemaType.NUMBER } } }
const exerciseSchema: Schema = {
  type: SchemaType.OBJECT,
  properties: { name: { type: SchemaType.STRING }, sets: { type: SchemaType.ARRAY, items: setSchema }, order: { type: SchemaType.NUMBER } },
  required: ['name', 'sets', 'order'],
}

const logWorkoutTool: FunctionDeclaration = {
  name: 'log_workout', description: 'Create a new workout extraction only. Never use this to correct a card or historical workout.',
  parameters: { type: SchemaType.OBJECT, properties: { blocks: { type: SchemaType.ARRAY, items: { type: SchemaType.OBJECT, properties: { type: { type: SchemaType.STRING, format: 'enum', enum: ['standard', 'superset', 'dropset', 'emom', 'pyramid', 'circuit', 'amrap'] }, exercises: { type: SchemaType.ARRAY, items: exerciseSchema }, intervalSeconds: { type: SchemaType.NUMBER }, order: { type: SchemaType.NUMBER } }, required: ['type', 'exercises', 'order'] } }, needsClarification: { type: SchemaType.BOOLEAN } }, required: ['blocks', 'needsClarification'] },
}
const getDataTool: FunctionDeclaration = { name: 'Get_data', description: 'Read only the profile collection points, a specific daily summary, and/or historical workouts needed to answer the user. Use dailySummaryDate (YYYY-MM-DD) to read that day’s daily summary. For historical corrections, first request a dateRange to receive chronologically ordered exercises labeled Exercise 1, Exercise 2, etc. Use that returned exerciseId label in a second Get_data call for the selected exercise details. Never request or use database IDs.', parameters: { type: SchemaType.OBJECT, properties: { dateRange: { type: SchemaType.OBJECT, properties: { startDate: { type: SchemaType.STRING }, endDate: { type: SchemaType.STRING } }, required: ['startDate', 'endDate'] }, exerciseId: { type: SchemaType.STRING }, dailySummaryDate: { type: SchemaType.STRING, description: 'The local calendar date of the requested daily summary, formatted YYYY-MM-DD.' }, collectionPoints: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING, format: 'enum', enum: ['name', 'injuries', 'equipment', 'goals', 'trainingPattern', 'skillLevel', 'weightUnit', 'distanceUnit'] } } } } }
const correctLogTool: FunctionDeclaration = { name: 'Correct_log', description: 'Correct an active Card N or a historical Exercise N returned by Get_data. parsedData must be complete, never a partial diff.', parameters: { type: SchemaType.OBJECT, properties: { target: { type: SchemaType.STRING, format: 'enum', enum: ['card', 'historical'] }, cardLabel: { type: SchemaType.STRING }, exerciseId: { type: SchemaType.STRING }, parsedData: { type: SchemaType.OBJECT, properties: {} } }, required: ['target', 'parsedData'] } }
const replySchema: Schema = { type: SchemaType.OBJECT, properties: { reply: { type: SchemaType.STRING } }, required: ['reply'] }

export interface LeanContext { tonePreference: string; weightUnit: 'kg' | 'lbs'; distanceUnit: string; activeInjuries: Array<{ description: string; status: string; notedAt: number }>; workoutContext: Doc<'workoutContext'>['content'] | null }
type MessageWithBlocks = Doc<'messages'> & {
  messageBlocks: Array<Pick<Doc<'messageBlocks'>, 'content' | 'order' | 'toolName' | 'type'>>
}
export interface GeminiContext { profile: Doc<'profiles'>; leanContext: LeanContext; dailySummary: Doc<'dailySummaries'> | null; currentChatDate: string; recentMessages: MessageWithBlocks[]; sessionSummaries: Doc<'sessionSummaries'>[]; pinnedCards: Array<{ label: string; card: Doc<'cards'> }>; guideActive: boolean; guideTurns: number }
export interface GeminiResponse { functionCall: FunctionCall | null; text: string; tokensUsed: number }
export interface GeminiTurn { chat: ChatSession; response: GeminiResponse }
export interface NamingDecision { decision: 'matched' | 'new_custom' | 'still_ambiguous'; exerciseId?: string; proposedName?: string; candidateIds?: string[]; reply: string }

function buildHistory(
  messages: MessageWithBlocks[],
  dailySummary: Doc<'dailySummaries'> | null,
  currentChatDate: string,
): Content[] {
  const dailySummaryContext: Content[] = dailySummary === null
    ? []
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
  const functionCall = response.functionCalls()?.[0] ?? null
  return { functionCall, text: textReply(response.text(), functionCall ? 'I’ve got that.' : 'I’m here — could you say that another way?'), tokensUsed: response.usageMetadata?.totalTokenCount ?? 0 }
}

export async function beginGeminiTurn(context: GeminiContext, userText: string): Promise<GeminiTurn> {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) throw new Error('GEMINI_API_KEY is not configured')
  const model = new GoogleGenerativeAI(apiKey).getGenerativeModel({ model: 'gemini-1.5-flash', tools: [{ functionDeclarations: [logWorkoutTool, getDataTool, correctLogTool] }], toolConfig: { functionCallingConfig: { mode: FunctionCallingMode.AUTO } }, generationConfig: { responseMimeType: 'application/json', responseSchema: replySchema }, systemInstruction: buildEcoSystemPrompt(context) })
  const chat = model.startChat({
    history: buildHistory(context.recentMessages, context.dailySummary, context.currentChatDate),
  })
  const result = await chat.sendMessage(userText)
  return { chat, response: toGeminiResponse(result.response) }
}

export async function continueGeminiTurn(chat: ChatSession, toolName: string, toolResult: object): Promise<GeminiResponse> {
  const result = await chat.sendMessage([{ functionResponse: { name: toolName, response: toolResult } }])
  return toGeminiResponse(result.response)
}

export async function decideExerciseName(name: string, candidates: Array<{ _id: Id<'exerciseLibrary'>; canonicalName: string }>): Promise<NamingDecision> {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) throw new Error('GEMINI_API_KEY is not configured')
  const schema: Schema = { type: SchemaType.OBJECT, properties: { decision: { type: SchemaType.STRING, format: 'enum', enum: ['matched', 'new_custom', 'still_ambiguous'] }, exerciseId: { type: SchemaType.STRING }, proposedName: { type: SchemaType.STRING }, candidateIds: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING } }, reply: { type: SchemaType.STRING } }, required: ['decision', 'reply'] }
  const instructions = buildExerciseNameResolutionPrompt(
    name,
    candidates.map((candidate) => ({ id: candidate._id, name: candidate.canonicalName })),
  )
  const model = new GoogleGenerativeAI(apiKey).getGenerativeModel({ model: 'gemini-1.5-flash', generationConfig: { responseMimeType: 'application/json', responseSchema: schema } })
  const response = await model.generateContent(instructions)
  const parsed: unknown = JSON.parse(response.response.text())
  if (typeof parsed !== 'object' || parsed === null || !('decision' in parsed) || !('reply' in parsed)) return { decision: 'still_ambiguous', candidateIds: candidates.map((candidate) => candidate._id), reply: 'Which exercise did you mean?' }
  return parsed as NamingDecision
}
