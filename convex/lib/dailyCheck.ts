import { GoogleGenerativeAI, SchemaType, type GenerationConfig, type Schema } from '@google/generative-ai'

import type { Doc } from '../_generated/dataModel'
import { buildChatCompressionPrompt, buildSessionSummaryCompressionPrompt, 'Daily-Cleanup_Prompt' as DailyCleanupPrompt } from './prompts/ecoSystem'

declare const process: { env: Record<string, string | undefined> }

const modelName = 'gemini-3.1-flash-lite'

export type WorkoutContextContent = Doc<'workoutContext'>['content']

export type DailyCleanupProfileUpdate = Partial<Pick<
  Doc<'profiles'>,
  'goals' | 'equipment' | 'trainingPattern' | 'trainingAvailability' | 'skillLevel' | 'injuries'
>>

export type DailyCleanupInput = {
  profile: Doc<'profiles'>
  workoutContext: Doc<'workoutContext'> | null
  dailySummaries: Doc<'dailySummaries'>[]
  sessionSummaries: Doc<'sessionSummaries'>[]
  rawMessages: Doc<'messages'>[]
  daysSinceLastWorkoutContextUpdate: number | null
}

export type DailyCleanupResult = {
  summaryContent: string
  profileUpdate: DailyCleanupProfileUpdate | null
  profileUpdateNotes?: string
  workoutContext: WorkoutContextContent | null
  tokensUsed: number
}

type GeminiTextResult = { content: string; tokensUsed: number }

function getModel(generationConfig?: GenerationConfig, systemInstruction?: string) {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not configured')
  }

  return new GoogleGenerativeAI(apiKey).getGenerativeModel({ model: modelName, generationConfig, systemInstruction })
}

type CompressionMessage = Doc<'messages'> & {
  messageBlocks: Array<Pick<Doc<'messageBlocks'>, 'content' | 'order' | 'toolName' | 'type'>>
}

function transcript(messages: CompressionMessage[]): string {
  return messages.map((message) => {
    const blocks = [...message.messageBlocks]
      .sort((left, right) => left.order - right.order)
      .map(({ type, toolName, content }) => ({ type, toolName, content }))
    return [
      `User: ${message.userText}`,
      `Eco: ${message.ecoText}`,
      `<tool_history>\n${JSON.stringify(blocks)}\n</tool_history>`,
    ].join('\n')
  }).join('\n\n')
}

function getTokensUsed(result: Awaited<ReturnType<ReturnType<typeof getModel>['generateContent']>>): number {
  return result.response.usageMetadata?.totalTokenCount ?? 0
}

export async function summariseMessages(messages: CompressionMessage[]): Promise<GeminiTextResult> {
  const result = await getModel().generateContent(buildChatCompressionPrompt(transcript(messages)))

  return { content: result.response.text().trim(), tokensUsed: getTokensUsed(result) }
}

export async function summariseSessionSummaries(
  summaries: Array<Pick<Doc<'sessionSummaries'>, 'content' | 'order'>>,
): Promise<GeminiTextResult> {
  const source = summaries
    .sort((left, right) => left.order - right.order)
    .map((summary) => `[Summary ${summary.order + 1}]\n${summary.content}`)
    .join('\n\n')
  const result = await getModel().generateContent(buildSessionSummaryCompressionPrompt(source))

  return { content: result.response.text().trim(), tokensUsed: getTokensUsed(result) }
}

export async function generateDailySummary(
  input: DailyCleanupInput,
): Promise<DailyCleanupResult> {
  const model = getModel({
    responseMimeType: 'application/json',
    responseSchema: dailyCleanupSchema,
  }, DailyCleanupPrompt)
  const result = await model.generateContent(buildDailyCleanupInput(input))
  const parsed: unknown = JSON.parse(result.response.text())
  if (!isDailyCleanupResult(parsed)) throw new Error('Gemini returned an invalid daily cleanup result')
  return {
    summaryContent: parsed.dailySummary,
    profileUpdate: parsed.profileUpdate,
    profileUpdateNotes: parsed.profileUpdateNote ?? undefined,
    workoutContext: parsed.workoutContext,
    tokensUsed: getTokensUsed(result),
  }
}

function isWorkoutContextContent(value: unknown): value is WorkoutContextContent {
  if (typeof value !== 'object' || value === null) return false
  const record = value as Record<string, unknown>
  const requiredKeys: Array<keyof WorkoutContextContent> = [
    'currentFocus',
    'recentProgress',
    'consistency',
    'notableAchievements',
    'considerations',
  ]
  return requiredKeys.every((key) => typeof record[key] === 'string')
}

function buildDailyCleanupInput(input: DailyCleanupInput): string {
  const sessionSummaries = [...input.sessionSummaries]
    .sort((left, right) => left.compressedTill - right.compressedTill || left.tier - right.tier || left.order - right.order)
    .map((summary) => ({ tier: summary.tier, order: summary.order, content: summary.content }))
  const rawMessages = [...input.rawMessages]
    .sort((left, right) => left.timestamp - right.timestamp)
    .map((message) => ({ timestamp: message.timestamp, userText: message.userText, ecoText: message.ecoText }))

  return [
    `<profile>\n${JSON.stringify(input.profile)}\n</profile>`,
    `<workout_context>\n${JSON.stringify(input.workoutContext?.content ?? null)}\n</workout_context>`,
    `<days_since_last_workout_context_update>\n${JSON.stringify(input.daysSinceLastWorkoutContextUpdate)}\n</days_since_last_workout_context_update>`,
    `<daily_summaries>\n${JSON.stringify(input.dailySummaries.map(({ date, content }) => ({ date, content })))}\n</daily_summaries>`,
    `<session_summaries>\n${JSON.stringify(sessionSummaries)}\n</session_summaries>`,
    `<raw_message_tail>\n${JSON.stringify(rawMessages)}\n</raw_message_tail>`,
  ].join('\n\n')
}

const injurySchema: Schema = {
  type: SchemaType.OBJECT,
  properties: {
    description: { type: SchemaType.STRING },
    status: { type: SchemaType.STRING },
    notedAt: { type: SchemaType.NUMBER },
  },
  required: ['description', 'status', 'notedAt'],
}

const workoutContextSchema: Schema = {
  type: SchemaType.OBJECT,
  nullable: true,
  properties: {
    currentFocus: { type: SchemaType.STRING },
    recentProgress: { type: SchemaType.STRING },
    consistency: { type: SchemaType.STRING },
    notableAchievements: { type: SchemaType.STRING },
    considerations: { type: SchemaType.STRING },
  },
  required: ['currentFocus', 'recentProgress', 'consistency', 'notableAchievements', 'considerations'],
}

const dailyCleanupSchema: Schema = {
  type: SchemaType.OBJECT,
  properties: {
    dailySummary: { type: SchemaType.STRING },
    profileUpdate: {
      type: SchemaType.OBJECT,
      nullable: true,
      properties: {
        goals: { type: SchemaType.STRING },
        equipment: { type: SchemaType.STRING },
        trainingPattern: { type: SchemaType.STRING },
        trainingAvailability: {
          type: SchemaType.OBJECT,
          properties: { daysPerWeek: { type: SchemaType.NUMBER }, sessionLength: { type: SchemaType.NUMBER } },
          required: ['daysPerWeek', 'sessionLength'],
        },
        skillLevel: {
          type: SchemaType.OBJECT,
          properties: {
            strength: { type: SchemaType.STRING }, flexibility: { type: SchemaType.STRING }, endurance: { type: SchemaType.STRING },
            calisthenicsSkills: { type: SchemaType.STRING }, sportSpecific: { type: SchemaType.STRING }, bodyComposition: { type: SchemaType.STRING },
          },
          required: ['strength', 'flexibility', 'endurance', 'calisthenicsSkills', 'sportSpecific', 'bodyComposition'],
        },
        injuries: { type: SchemaType.ARRAY, items: injurySchema },
      },
    },
    profileUpdateNote: { type: SchemaType.STRING, nullable: true },
    workoutContext: workoutContextSchema,
  },
  required: ['dailySummary', 'profileUpdate', 'profileUpdateNote', 'workoutContext'],
}

function isDailyCleanupProfileUpdate(value: unknown): value is DailyCleanupProfileUpdate {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const update = value as Record<string, unknown>
  const allowedKeys = new Set(['goals', 'equipment', 'trainingPattern', 'trainingAvailability', 'skillLevel', 'injuries'])
  if (Object.keys(update).some((key) => !allowedKeys.has(key))) return false
  if (update.goals !== undefined && typeof update.goals !== 'string') return false
  if (update.equipment !== undefined && typeof update.equipment !== 'string') return false
  if (update.trainingPattern !== undefined && typeof update.trainingPattern !== 'string') return false
  if (update.trainingAvailability !== undefined && !isTrainingAvailability(update.trainingAvailability)) return false
  if (update.skillLevel !== undefined && !isSkillLevel(update.skillLevel)) return false
  if (update.injuries !== undefined && (!Array.isArray(update.injuries) || !update.injuries.every(isInjury))) return false
  return Object.keys(update).length > 0
}

function isTrainingAvailability(value: unknown): value is Doc<'profiles'>['trainingAvailability'] {
  if (typeof value !== 'object' || value === null) return false
  const availability = value as Record<string, unknown>
  return typeof availability.daysPerWeek === 'number' && typeof availability.sessionLength === 'number'
}

function isSkillLevel(value: unknown): value is Doc<'profiles'>['skillLevel'] {
  if (typeof value !== 'object' || value === null) return false
  const skillLevel = value as Record<string, unknown>
  return ['strength', 'flexibility', 'endurance', 'calisthenicsSkills', 'sportSpecific', 'bodyComposition']
    .every((key) => typeof skillLevel[key] === 'string')
}

function isInjury(value: unknown): value is Doc<'profiles'>['injuries'][number] {
  if (typeof value !== 'object' || value === null) return false
  const injury = value as Record<string, unknown>
  return typeof injury.description === 'string' && typeof injury.status === 'string' && typeof injury.notedAt === 'number'
}

type ParsedDailyCleanupResult = {
  dailySummary: string
  profileUpdate: DailyCleanupProfileUpdate | null
  profileUpdateNote: string | null
  workoutContext: WorkoutContextContent | null
}

function isDailyCleanupResult(value: unknown): value is ParsedDailyCleanupResult {
  if (typeof value !== 'object' || value === null) return false
  const result = value as Record<string, unknown>
  return typeof result.dailySummary === 'string'
    && (result.profileUpdate === null || isDailyCleanupProfileUpdate(result.profileUpdate))
    && (result.profileUpdateNote === null || typeof result.profileUpdateNote === 'string')
    && (result.profileUpdate === null || result.profileUpdateNote !== null)
    && (result.workoutContext === null || isWorkoutContextContent(result.workoutContext))
}
