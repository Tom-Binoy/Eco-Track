import { internal } from '../_generated/api'
import { makeFunctionReference } from 'convex/server'
import type { Doc } from '../_generated/dataModel'
import { internalAction, type ActionCtx } from '../_generated/server'
import { generateDailySummary } from '../lib/dailyCheck'

type BackgroundRuntime = { workflow: 'daily'; modelId: string; systemPrompt: string; poolIds: string[]; cacheEnabled: boolean; configId?: string }
const dailyRuntime = makeFunctionReference<'query', { workflow: 'daily' }, BackgroundRuntime>('debug/liveGemini:getActiveForWorkflow')
const reserveLive = makeFunctionReference<'mutation', { workflow: 'daily'; modelId: string; poolIds: string[]; requestCount: number }, { apiKey?: string; reservationId?: string; error?: string }>('debug/liveGemini:reserve')
const releaseLive = makeFunctionReference<'mutation', { reservationId: string; usedRequests: number; totalTokens: number }, null>('debug/liveGemini:releaseReservation')
const ensureLiveCache = makeFunctionReference<'action', { configId: string }, { cacheName?: string; error?: string }>('debug/liveGemini:ensureCache')

function getLocalDate(timestamp: number, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(timestamp))
  const part = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((item) => item.type === type)?.value ?? ''
  return `${part('year')}-${part('month')}-${part('day')}`
}

function getLocalHour(timestamp: number, timezone: string): number {
  const hour = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    hour: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(timestamp)).find((part) => part.type === 'hour')?.value
  return Number(hour)
}

function previousDate(date: string): string {
  const [year, month, day] = date.split('-').map(Number)
  if (year === undefined || month === undefined || day === undefined) {
    return date
  }
  return new Date(Date.UTC(year, month - 1, day - 1)).toISOString().slice(0, 10)
}

function daysSince(timestamp: number | undefined, now: number): number | null {
  return timestamp === undefined ? null : Math.max(0, Math.floor((now - timestamp) / 86_400_000))
}

async function processDailyCheckForUser(
  ctx: ActionCtx,
  profile: Doc<'profiles'>,
  now: number,
): Promise<void> {
  let localDate: string
  let localHour: number
  try {
    localDate = getLocalDate(now, profile.timezone)
    localHour = getLocalHour(now, profile.timezone)
  } catch {
    localDate = getLocalDate(now, 'UTC')
    localHour = getLocalHour(now, 'UTC')
  }

  if (localHour !== 0) return

  const yesterday = previousDate(localDate)
  const chats = await ctx.runQuery(internal.functions.chats.getForDate, {
    userId: profile._id,
    date: yesterday,
  })
  if (chats.length === 0) return

  const purgeReferences = async (): Promise<void> => {
    await Promise.all(chats.map((chat) => ctx.runMutation(
      internal.functions.messages.purgeLibraryReferencesForChat,
      { chatId: chat._id, userId: profile._id },
    )))
  }
  const existing = await ctx.runQuery(internal.functions.dailySummaries.getForDate, {
    userId: profile._id,
    date: yesterday,
  })
  if (existing !== null) {
    await purgeReferences()
    return
  }

  const [latestWorkoutContext, chatMemory] = await Promise.all([
    ctx.runQuery(internal.functions.workoutContext.getLatest, { userId: profile._id }),
    Promise.all(chats.map(async (chat) => {
      const [messages, sessionSummaries] = await Promise.all([
        ctx.runQuery(internal.functions.messages.getAllForCompression, { chatId: chat._id }),
        ctx.runQuery(internal.functions.sessionSummaries.getForChat, { chatId: chat._id }),
      ])
      const compressedTill = sessionSummaries.reduce((latest, summary) => Math.max(latest, summary.compressedTill), 0)
      return { messages: messages.filter((message) => message.timestamp > compressedTill), sessionSummaries }
    })),
  ])
  const rawMessages = chatMemory.flatMap((memory) => memory.messages)
  if (rawMessages.length === 0) {
    await purgeReferences()
    return
  }

  const dailySummariesSinceWorkoutContext = latestWorkoutContext === null
    ? await ctx.runQuery(internal.functions.dailySummaries.getSinceWorkoutContext, { userId: profile._id })
    : await ctx.runQuery(internal.functions.dailySummaries.getSinceWorkoutContext, {
      userId: profile._id,
      sourceDailySummaryId: latestWorkoutContext.sourceDailySummaryId,
    })

  const sessions = await ctx.runQuery(internal.functions.sessions.getForDate, {
    userId: profile._id,
    date: yesterday,
  })
  const runtime = await ctx.runQuery(dailyRuntime, { workflow: 'daily' })
  const reservation = await ctx.runMutation(reserveLive, { workflow: 'daily', modelId: runtime.modelId, poolIds: runtime.poolIds, requestCount: 1 })
  if (reservation.apiKey === undefined) throw new Error(reservation.error ?? 'No daily-summary Gemini capacity is available.')
  const cache = !runtime.cacheEnabled || runtime.configId === undefined ? {} : await ctx.runAction(ensureLiveCache, { configId: runtime.configId })
  const dailyCleanup = await generateDailySummary({
    profile,
    workoutContext: latestWorkoutContext,
    dailySummaries: dailySummariesSinceWorkoutContext,
    sessionSummaries: chatMemory.flatMap((memory) => memory.sessionSummaries),
    rawMessages,
    daysSinceLastWorkoutContextUpdate: daysSince(latestWorkoutContext?._creationTime, now),
  }, { modelId: runtime.modelId, systemPrompt: runtime.systemPrompt, apiKey: reservation.apiKey, cachedContent: cache.cacheName })
  if (reservation.reservationId !== undefined) await ctx.runMutation(releaseLive, { reservationId: reservation.reservationId, usedRequests: 1, totalTokens: dailyCleanup.tokensUsed })

  await ctx.runMutation(internal.functions.apiUsage.logUsage, {
    userId: profile._id,
    tokensUsed: dailyCleanup.tokensUsed,
    timestamp: Date.now(),
  })

  const writeResult = await ctx.runMutation(internal.functions.dailySummaries.commitDailyCleanup, {
    chatId: chats[0]!._id,
    userId: profile._id,
    date: yesterday,
    content: dailyCleanup.summaryContent,
    profileUpdate: dailyCleanup.profileUpdate,
    profileUpdateNotes: dailyCleanup.profileUpdateNotes,
    workoutContext: dailyCleanup.workoutContext,
    sourceSessionId: sessions[0]?._id,
  })
  if (!writeResult.created) return

  for (const chat of chats) {
    await Promise.all([
      ctx.runMutation(internal.functions.sessionSummaries.purgeForChat, { chatId: chat._id }),
      ctx.runMutation(internal.functions.messages.purgeLibraryReferencesForChat, { chatId: chat._id, userId: profile._id }),
    ])
  }

  const todayChats = await ctx.runQuery(internal.functions.chats.getForDate, {
    userId: profile._id,
    date: localDate,
  })
  for (const chat of todayChats) {
    await ctx.runMutation(internal.functions.chats.invalidateCachedContext, { chatId: chat._id })
  }
}

export const runDailyCheck = internalAction({
  args: {},
  handler: async (ctx): Promise<{ processedProfiles: number }> => {
    const profiles = await ctx.runQuery(internal.functions.profiles.getAllTimezones, {})
    const now = Date.now()
    let processedProfiles = 0

    for (const profile of profiles) {
      try {
        await processDailyCheckForUser(ctx, profile, now)
        processedProfiles += 1
      } catch (error) {
        console.error(`Daily check failed for user ${profile._id}`, error)
      }
    }

    return { processedProfiles }
  },
})
