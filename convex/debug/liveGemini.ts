import { getAuthUserId } from '@convex-dev/auth/server'
import { GoogleGenAI } from '@google/genai'
import { makeFunctionReference } from 'convex/server'
import { v } from 'convex/values'

import type { Id } from '../_generated/dataModel'
import { internalAction, internalMutation, internalQuery, mutation, query, type MutationCtx, type QueryCtx } from '../_generated/server'
import { GEMINI_MODEL } from '../lib/geminiConfig'
import { Tier1Compression_Prompt, 'Daily-Cleanup_Prompt' as DAILY_PROMPT, ECO_SYSTEM_PROMPT } from '../lib/prompts/ecoSystem'
import { isDebugConsoleEnabled } from './config'

declare const process: { env: Record<string, string | undefined> }

export type LiveWorkflow = 'chat' | 'daily' | 'session'
export type LiveGeminiRuntimeConfig = { workflow: LiveWorkflow; modelId: string; systemPrompt: string; poolIds: string[]; cacheEnabled: boolean; cacheTtlSeconds: number; source: 'default' | 'published'; configId?: string }
type Context = QueryCtx | MutationCtx
const workflowValidator = v.union(v.literal('chat'), v.literal('daily'), v.literal('session'))
const defaultPrompt = (workflow: LiveWorkflow): string => workflow === 'chat' ? ECO_SYSTEM_PROMPT : workflow === 'daily' ? DAILY_PROMPT : Tier1Compression_Prompt

function keyRegistry(): Record<string, string> {
  try {
    const parsed: unknown = process.env.GEMINI_LIVE_KEYS_JSON === undefined ? undefined : JSON.parse(process.env.GEMINI_LIVE_KEYS_JSON)
    if (typeof parsed === 'object' && parsed !== null && Object.values(parsed).every((value) => typeof value === 'string' && value.length > 0)) return Object.fromEntries(Object.entries(parsed).map(([key, value]) => [key, value as string]))
  } catch { /* fall through to the single development key */ }
  return process.env.GEMINI_API_KEY === undefined ? {} : { 'eco-development': process.env.GEMINI_API_KEY }
}
function dateKey(now: number, timezone: string): string { return new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(now)) }
async function approved(ctx: Context): Promise<Id<'users'> | null> {
  if (!isDebugConsoleEnabled()) return null
  const user = await getAuthUserId(ctx)
  if (user === null) return null
  return (await ctx.db.query('debugConsoleApprovals').withIndex('by_authUserId', (q) => q.eq('authUserId', user)).unique()) === null ? null : user
}
function validConfig(name: string, model: string, prompt: string, ttl: number): boolean { return name.trim().length > 0 && name.length <= 120 && model.trim().length > 0 && model.length <= 200 && prompt.trim().length > 0 && prompt.length <= 100_000 && Number.isInteger(ttl) && ttl >= 60 && ttl <= 86_400 }
function defaultConfig(workflow: LiveWorkflow): LiveGeminiRuntimeConfig { return { workflow, modelId: GEMINI_MODEL, systemPrompt: defaultPrompt(workflow), poolIds: [], cacheEnabled: false, cacheTtlSeconds: 3600, source: 'default' } }

export const dashboard = query({ args: {}, handler: async (ctx) => {
  if (await approved(ctx) === null) return { error: 'Debug access is not approved.' }
  const [states, configs, activations, pools, limits, caches] = await Promise.all([
    ctx.db.query('debugLiveGeminiState').collect(), ctx.db.query('debugLiveGeminiConfigs').order('desc').take(100), ctx.db.query('debugLiveGeminiActivations').order('desc').take(100), ctx.db.query('debugLiveGeminiPools').collect(), ctx.db.query('debugLiveGeminiQuotaLimits').collect(), ctx.db.query('debugLiveGeminiCaches').collect(),
  ])
  const aliases = Object.keys(keyRegistry()).sort()
  return { error: null, defaults: (['chat', 'daily', 'session'] as const).map(defaultConfig), states, configs, activations, pools: pools.map((pool) => ({ ...pool, keyAvailable: aliases.includes(pool.keyAlias) })), limits, caches, keyAliases: aliases }
} })

export const savePool = mutation({ args: { poolId: v.optional(v.id('debugLiveGeminiPools')), name: v.string(), keyAlias: v.string(), resetTimezone: v.string(), enabled: v.boolean(), modelId: v.string(), rpm: v.number(), rpd: v.number(), tpm: v.optional(v.number()) }, handler: async (ctx, args) => {
  const user = await approved(ctx); if (user === null) return { error: 'Debug access is not approved.' }
  if (!keyRegistry()[args.keyAlias] || !args.name.trim() || !args.modelId.trim() || args.rpm < 1 || args.rpd < 1 || (args.tpm !== undefined && args.tpm < 1)) return { error: 'Pool configuration is invalid or its key alias is unavailable.' }
  try { dateKey(Date.now(), args.resetTimezone) } catch { return { error: 'Reset timezone is invalid.' } }
  const now = Date.now(); const poolId = args.poolId ?? await ctx.db.insert('debugLiveGeminiPools', { name: args.name.trim(), keyAlias: args.keyAlias, resetTimezone: args.resetTimezone, enabled: args.enabled, createdBy: user, createdAt: now, updatedAt: now })
  if (args.poolId !== undefined) await ctx.db.patch(poolId, { name: args.name.trim(), keyAlias: args.keyAlias, resetTimezone: args.resetTimezone, enabled: args.enabled, updatedAt: now })
  const limit = await ctx.db.query('debugLiveGeminiQuotaLimits').withIndex('by_pool_and_model', (q) => q.eq('poolId', poolId).eq('modelId', args.modelId.trim())).unique()
  const values = { rpm: Math.floor(args.rpm), rpd: Math.floor(args.rpd), tpm: args.tpm === undefined ? undefined : Math.floor(args.tpm), updatedAt: now }
  if (limit === null) await ctx.db.insert('debugLiveGeminiQuotaLimits', { poolId, modelId: args.modelId.trim(), ...values }); else await ctx.db.patch(limit._id, values)
  return { poolId }
} })

export const saveDraft = mutation({ args: { configId: v.optional(v.id('debugLiveGeminiConfigs')), workflow: workflowValidator, name: v.string(), modelId: v.string(), systemPrompt: v.string(), poolIds: v.array(v.id('debugLiveGeminiPools')), cacheEnabled: v.boolean(), cacheTtlSeconds: v.number() }, handler: async (ctx, args) => {
  const user = await approved(ctx); if (user === null) return { error: 'Debug access is not approved.' }
  const pools = await Promise.all(args.poolIds.map((id) => ctx.db.get(id)))
  if (!validConfig(args.name, args.modelId, args.systemPrompt, args.cacheTtlSeconds) || pools.some((pool) => pool === null)) return { error: 'Live configuration is invalid.' }
  const now = Date.now(); const values = { workflow: args.workflow, name: args.name.trim(), modelId: args.modelId.trim(), systemPrompt: args.systemPrompt, poolIds: args.poolIds, cacheEnabled: args.cacheEnabled, cacheTtlSeconds: args.cacheTtlSeconds, updatedAt: now }
  if (args.configId !== undefined) { const existing = await ctx.db.get(args.configId); if (existing === null || existing.status !== 'draft' || existing.workflow !== args.workflow) return { error: 'Only drafts for this workflow can be edited.' }; await ctx.db.patch(existing._id, values); return { configId: existing._id } }
  return { configId: await ctx.db.insert('debugLiveGeminiConfigs', { ...values, status: 'draft', createdBy: user, createdAt: now }) }
} })

async function activate(ctx: MutationCtx, configId: Id<'debugLiveGeminiConfigs'>, user: Id<'users'>): Promise<void> {
  const config = await ctx.db.get(configId); if (config === null) return
  const workflow = config.workflow ?? 'chat'; const now = Date.now(); const state = await ctx.db.query('debugLiveGeminiState').withIndex('by_workflow', (q) => q.eq('workflow', workflow)).unique()
  if (state === null) await ctx.db.insert('debugLiveGeminiState', { workflow, activeConfigId: configId, activatedBy: user, activatedAt: now }); else await ctx.db.patch(state._id, { activeConfigId: configId, activatedBy: user, activatedAt: now })
  await ctx.db.insert('debugLiveGeminiActivations', { workflow, configId, activatedBy: user, activatedAt: now })
}
export const publishDraft = mutation({ args: { configId: v.id('debugLiveGeminiConfigs'), confirmation: v.literal('PUBLISH LIVE CONFIG') }, handler: async (ctx, args) => { const user = await approved(ctx); if (user === null) return { error: 'Debug access is not approved.' }; const config = await ctx.db.get(args.configId); if (config === null || config.status !== 'draft') return { error: 'Only drafts can be published.' }; await ctx.db.patch(config._id, { status: 'published', publishedAt: Date.now(), updatedAt: Date.now() }); await activate(ctx, config._id, user); return { ok: true } } })
export const activatePublished = mutation({ args: { configId: v.id('debugLiveGeminiConfigs'), confirmation: v.literal('ROLL BACK LIVE CONFIG') }, handler: async (ctx, args) => { const user = await approved(ctx); const config = await ctx.db.get(args.configId); if (user === null || config === null || config.status !== 'published') return { error: 'Published configuration was not found.' }; await activate(ctx, config._id, user); return { ok: true } } })
// One-time migration for records created before workflow and cache fields existed.
// It intentionally has no debug-console control; invoke only if legacy rows are discovered.
export const backfillLegacyRecords = mutation({ args: {}, handler: async (ctx) => {
  if (await approved(ctx) === null) return { error: 'Debug access is not approved.' }
  const [configs, states, activations] = await Promise.all([ctx.db.query('debugLiveGeminiConfigs').collect(), ctx.db.query('debugLiveGeminiState').collect(), ctx.db.query('debugLiveGeminiActivations').collect()])
  let updated = 0
  for (const config of configs) if (config.workflow === undefined || config.poolIds === undefined || config.cacheEnabled === undefined || config.cacheTtlSeconds === undefined) { await ctx.db.patch(config._id, { workflow: config.workflow ?? 'chat', poolIds: config.poolIds ?? [], cacheEnabled: config.cacheEnabled ?? false, cacheTtlSeconds: config.cacheTtlSeconds ?? 3600 }); updated += 1 }
  for (const state of states) if (state.workflow === undefined) { await ctx.db.patch(state._id, { workflow: 'chat' }); updated += 1 }
  for (const activation of activations) if (activation.workflow === undefined) { await ctx.db.patch(activation._id, { workflow: 'chat' }); updated += 1 }
  return { updated }
} })

export const getActiveForWorkflow = internalQuery({ args: { workflow: workflowValidator }, handler: async (ctx, args): Promise<LiveGeminiRuntimeConfig> => {
  if (!isDebugConsoleEnabled()) return defaultConfig(args.workflow)
  const state = await ctx.db.query('debugLiveGeminiState').withIndex('by_workflow', (q) => q.eq('workflow', args.workflow)).unique(); if (state === null) return defaultConfig(args.workflow)
  const config = await ctx.db.get(state.activeConfigId); return config === null || config.status !== 'published' ? defaultConfig(args.workflow) : { workflow: config.workflow ?? 'chat', modelId: config.modelId, systemPrompt: config.systemPrompt, poolIds: config.poolIds ?? [], cacheEnabled: config.cacheEnabled ?? false, cacheTtlSeconds: config.cacheTtlSeconds ?? 3600, source: 'published', configId: config._id }
} })
export const getActiveForTurn = internalQuery({ args: {}, handler: async (ctx): Promise<LiveGeminiRuntimeConfig> => {
  if (!isDebugConsoleEnabled()) return defaultConfig('chat')
  const state = await ctx.db.query('debugLiveGeminiState').withIndex('by_workflow', (q) => q.eq('workflow', 'chat')).unique()
  if (state === null) return defaultConfig('chat')
  const config = await ctx.db.get(state.activeConfigId)
  return config === null || config.status !== 'published' ? defaultConfig('chat') : { workflow: 'chat', modelId: config.modelId, systemPrompt: config.systemPrompt, poolIds: config.poolIds ?? [], cacheEnabled: config.cacheEnabled ?? false, cacheTtlSeconds: config.cacheTtlSeconds ?? 3600, source: 'published', configId: config._id }
} })

const providerRateLimitCooldownMs = 15 * 60_000

export const reserve = internalMutation({ args: { workflow: workflowValidator, modelId: v.string(), poolIds: v.array(v.id('debugLiveGeminiPools')), requestCount: v.number(), excludedPoolIds: v.optional(v.array(v.id('debugLiveGeminiPools'))) }, handler: async (ctx, args): Promise<{ apiKey?: string; reservationId?: Id<'debugLiveGeminiReservations'>; poolId?: Id<'debugLiveGeminiPools'>; poolName?: string; cacheName?: string; error?: string }> => {
  if (!isDebugConsoleEnabled() || args.poolIds.length === 0) return { apiKey: process.env.GEMINI_API_KEY, error: process.env.GEMINI_API_KEY === undefined ? 'No live Gemini key is configured.' : undefined }
  const now = Date.now(); const registry = keyRegistry(); const excludedPoolIds = new Set(args.excludedPoolIds ?? []); const candidates = await Promise.all(args.poolIds.map(async (poolId) => ({ pool: await ctx.db.get(poolId), limit: await ctx.db.query('debugLiveGeminiQuotaLimits').withIndex('by_pool_and_model', (q) => q.eq('poolId', poolId).eq('modelId', args.modelId)).unique() })))
  for (const candidate of candidates) {
    if (candidate.pool === null || candidate.limit === null || excludedPoolIds.has(candidate.pool._id) || !candidate.pool.enabled || registry[candidate.pool.keyAlias] === undefined) continue
    const dayKey = dateKey(now, candidate.pool.resetTimezone); const [recent, today, cooldowns] = await Promise.all([ctx.db.query('debugLiveGeminiReservations').withIndex('by_pool_model_and_requestedAt', (q) => q.eq('poolId', candidate.pool!._id).eq('modelId', args.modelId).gte('requestedAt', now - 60_000)).collect(), ctx.db.query('debugLiveGeminiReservations').withIndex('by_pool_model_day', (q) => q.eq('poolId', candidate.pool!._id).eq('modelId', args.modelId).eq('dayKey', dayKey)).collect(), ctx.db.query('debugLiveGeminiReservations').withIndex('by_pool_model_and_requestedAt', (q) => q.eq('poolId', candidate.pool!._id).eq('modelId', args.modelId).gte('requestedAt', now - providerRateLimitCooldownMs)).collect()])
    if (cooldowns.some((reservation) => reservation.status === 'rate_limited' && (reservation.cooldownUntil ?? 0) > now)) continue
    const recentCount = recent.reduce((sum, item) => sum + (item.status === 'active' ? item.reservedRequests : item.usedRequests), 0); const dayCount = today.reduce((sum, item) => sum + (item.status === 'active' ? item.reservedRequests : item.usedRequests), 0)
    if (recentCount + args.requestCount > candidate.limit.rpm || dayCount + args.requestCount > candidate.limit.rpd) continue
    const reservationId = await ctx.db.insert('debugLiveGeminiReservations', { workflow: args.workflow, poolId: candidate.pool._id, modelId: args.modelId, reservedRequests: args.requestCount, usedRequests: 0, totalTokens: 0, requestedAt: now, dayKey, status: 'active' })
    return { apiKey: registry[candidate.pool.keyAlias], reservationId, poolId: candidate.pool._id, poolName: candidate.pool.name }
  }
  return { error: 'All enabled live Gemini pools are at capacity.' }
} })
export const releaseReservation = internalMutation({ args: { reservationId: v.id('debugLiveGeminiReservations'), usedRequests: v.number(), totalTokens: v.number() }, handler: async (ctx, args) => { const record = await ctx.db.get(args.reservationId); if (record !== null && record.status === 'active') await ctx.db.patch(record._id, { status: 'released', usedRequests: Math.min(record.reservedRequests, Math.max(0, Math.floor(args.usedRequests))), totalTokens: Math.max(0, Math.floor(args.totalTokens)) }); return null } })
export const markReservationRateLimited = internalMutation({ args: { reservationId: v.id('debugLiveGeminiReservations'), usedRequests: v.number(), totalTokens: v.number() }, handler: async (ctx, args) => { const record = await ctx.db.get(args.reservationId); if (record !== null && record.status === 'active') await ctx.db.patch(record._id, { status: 'rate_limited', usedRequests: Math.min(record.reservedRequests, Math.max(1, Math.floor(args.usedRequests))), totalTokens: Math.max(0, Math.floor(args.totalTokens)), cooldownUntil: Date.now() + providerRateLimitCooldownMs }); return null } })

export const saveCache = internalMutation({ args: { configId: v.id('debugLiveGeminiConfigs'), cacheName: v.string(), expiresAt: v.number(), cachedTokens: v.optional(v.number()), lastError: v.optional(v.string()) }, handler: async (ctx, args) => { const existing = await ctx.db.query('debugLiveGeminiCaches').withIndex('by_config', (q) => q.eq('configId', args.configId)).unique(); const values = { cacheName: args.cacheName, expiresAt: args.expiresAt, cachedTokens: args.cachedTokens, lastError: args.lastError, updatedAt: Date.now() }; if (existing === null) await ctx.db.insert('debugLiveGeminiCaches', { configId: args.configId, ...values }); else await ctx.db.patch(existing._id, values); return null } })
const saveCacheRef = makeFunctionReference<'mutation', { configId: Id<'debugLiveGeminiConfigs'>; cacheName: string; expiresAt: number; cachedTokens?: number; lastError?: string }, null>('debug/liveGemini:saveCache')

// Explicit caches are intentionally limited to immutable published prompts. User context,
// histories, cards, and summaries never enter this provider-side resource.
export const ensureCache = internalAction({ args: { configId: v.id('debugLiveGeminiConfigs') }, handler: async (ctx, args): Promise<{ cacheName?: string; error?: string }> => {
  const config = await ctx.runQuery(makeFunctionReference<'query', { configId: Id<'debugLiveGeminiConfigs'> }, { cacheName?: string; expiresAt?: number }>('debug/liveGemini:getCache'), { configId: args.configId })
  if (config.cacheName !== undefined && (config.expiresAt ?? 0) > Date.now() + 10_000) return { cacheName: config.cacheName }
  const active = await ctx.runQuery(makeFunctionReference<'query', { configId: Id<'debugLiveGeminiConfigs'> }, { modelId?: string; systemPrompt?: string; cacheEnabled?: boolean; cacheTtlSeconds?: number; poolIds?: string[]; workflow?: LiveWorkflow; apiKey?: string }>('debug/liveGemini:getCacheConfig'), { configId: args.configId })
  if (active.modelId === undefined || active.systemPrompt === undefined || !active.cacheEnabled) return { error: 'Explicit caching is disabled for this configuration.' }
  const key = active.apiKey
  if (key === undefined) return { error: 'Automatic cache creation requires the default GEMINI_API_KEY.' }
  try {
    const cache = await new GoogleGenAI({ apiKey: key }).caches.create({ model: active.modelId, config: { systemInstruction: active.systemPrompt, ttl: `${active.cacheTtlSeconds ?? 3600}s`, displayName: `Eco ${active.workflow ?? 'chat'} live prompt` } })
    const expiresAt = Date.now() + (active.cacheTtlSeconds ?? 3600) * 1000
    await ctx.runMutation(saveCacheRef, { configId: args.configId, cacheName: cache.name ?? '', expiresAt, cachedTokens: cache.usageMetadata?.totalTokenCount })
    return cache.name === undefined ? { error: 'Gemini did not return a cache name.' } : { cacheName: cache.name }
  } catch (error) { const message = error instanceof Error ? error.message : String(error); await ctx.runMutation(saveCacheRef, { configId: args.configId, cacheName: '', expiresAt: 0, lastError: message }); return { error: message } }
} })
export const getCache = internalQuery({ args: { configId: v.id('debugLiveGeminiConfigs') }, handler: async (ctx, args) => { const cache = await ctx.db.query('debugLiveGeminiCaches').withIndex('by_config', (q) => q.eq('configId', args.configId)).unique(); return cache === null ? {} : { cacheName: cache.cacheName || undefined, expiresAt: cache.expiresAt } } })
export const getCacheConfig = internalQuery({ args: { configId: v.id('debugLiveGeminiConfigs') }, handler: async (ctx, args) => { const config = await ctx.db.get(args.configId); if (config === null) return {}; const poolIds = config.poolIds ?? []; const firstPool = poolIds[0] === undefined ? null : await ctx.db.get(poolIds[0]); return { modelId: config.modelId, systemPrompt: config.systemPrompt, cacheEnabled: config.cacheEnabled, cacheTtlSeconds: config.cacheTtlSeconds, poolIds, workflow: config.workflow, apiKey: firstPool === null ? process.env.GEMINI_API_KEY : keyRegistry()[firstPool.keyAlias] } } })
