import { useAuthActions } from '@convex-dev/auth/react'
import { useAction, useConvexAuth, useMutation, useQuery } from 'convex/react'
import { makeFunctionReference } from 'convex/server'
import { useMemo, useState, type ReactElement } from 'react'

import type { Doc, Id } from '../../convex/_generated/dataModel'

type TurnSummary = {
  chatDate: string
  chatId: Id<'chats'>
  eventCount: number
  messageId: Id<'messages'>
  timestamp: number
  userText: string
  ecoText: string
  usedTools: string[]
  warningCodes: string[]
  hasError: boolean
}

type Filter = 'all' | 'warnings' | 'errors'

type DebugEvent = Doc<'debugTurnEvents'>

type ListTurnsResult = {
  enabled: boolean
  error: string | null
  turns: TurnSummary[]
}
type AccessResult = { enabled: boolean; approved: boolean; setupAvailable: boolean }
type DebugUser = { profileId: Id<'profiles'>; label: string; dayCount: number }
type DebugUsersResult = { error: string | null; users: DebugUser[] }
type DebugDaysResult = { error: string | null; days: Array<{ date: string }> }

type TurnDetailResult =
  | { error: string }
  | {
      message: Doc<'messages'>
      chat: { date: string }
      events: DebugEvent[]
      messageBlocks: Doc<'messageBlocks'>[]
      toolTraces: Doc<'toolTraces'>[]
      cards: Doc<'cards'>[]
      guideInvocations: Doc<'guideInvocations'>[]
    }

type ReplayExperimentResult =
  | { error: string }
  | {
      experiment: Doc<'debugReplayExperiments'> | null
      results: Doc<'debugReplayResults'>[]
    }

const listTurnsQuery = makeFunctionReference<
  'query',
  { profileId: Id<'profiles'>; date: string; limit: number },
  ListTurnsResult
>('debug/events:listTurns')
const getAccessQuery = makeFunctionReference<'query', Record<string, never>, AccessResult>('debug/events:getAccess')
const claimFirstAccessMutation = makeFunctionReference<'mutation', Record<string, never>, { approved?: boolean; error?: string }>('debug/events:claimFirstAccess')
const listUsersQuery = makeFunctionReference<'query', Record<string, never>, DebugUsersResult>('debug/events:listUsers')
const listDaysQuery = makeFunctionReference<'query', { profileId: Id<'profiles'> }, DebugDaysResult>('debug/events:listDays')

const getTurnDetailQuery = makeFunctionReference<
  'query',
  { messageId: Id<'messages'> },
  TurnDetailResult
>('debug/events:getTurnDetail')
const getReplayExperimentQuery = makeFunctionReference<
  'query',
  { messageId: Id<'messages'> },
  ReplayExperimentResult
>('debug/events:getReplayExperiment')
const runReplayExperimentAction = makeFunctionReference<
  'action',
  { messageId: Id<'messages'> },
  { experimentId?: Id<'debugReplayExperiments'>; error?: string }
>('debug/replay:runExperiment')
const runReplayCritiqueAction = makeFunctionReference<
  'action',
  { experimentId: Id<'debugReplayExperiments'> },
  { critique?: string; error?: string }
>('debug/replay:runCritique')
const deleteMessageMutation = makeFunctionReference<
  'mutation',
  { messageId: Id<'messages'>; confirmation: 'DELETE MESSAGE' },
  { deleted?: boolean; cardsDeleted?: number; error?: string }
>('debug/events:deleteMessage')
const forceDeleteChatMutation = makeFunctionReference<
  'mutation',
  { chatId: Id<'chats'>; confirmation: 'DELETE CHAT' },
  { deleted?: boolean; messagesDeleted?: number; cardsDeleted?: number; error?: string }
>('debug/events:forceDeleteChat')

const warningLabels: Record<string, string> = {
  follow_up_cap_reached: 'Follow-up cap reached',
  log_workout_without_convincing_evidence: 'Weak workout evidence',
  repeated_tool: 'Repeated tool',
  redundant_data_lookup: 'Redundant data lookup stopped',
  tool_result_error: 'Tool returned an error',
  validation_failed: 'Validation failed',
}

function formatTime(timestamp: number): string {
  return new Intl.DateTimeFormat([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(new Date(timestamp))
}

function formatDuration(durationMs: number | undefined): string | null {
  if (durationMs === undefined) return null
  if (durationMs < 1_000) return `${durationMs} ms`
  return `${(durationMs / 1_000).toFixed(2)} s`
}

function prettySequence(sequence: number): string {
  return String(sequence).padStart(3, '0')
}

function safeExportValue(value: unknown): unknown {
  const sensitiveKeys = new Set([
    '_id',
    'aliasId',
    'authUserId',
    'blockId',
    'cardId',
    'chatId',
    'exerciseId',
    'messageId',
    'sessionId',
    'tokenIdentifier',
    'userId',
  ])

  if (Array.isArray(value)) return value.map(safeExportValue)
  if (typeof value === 'object' && value !== null) {
    const output: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value)) {
      output[key] = sensitiveKeys.has(key)
        ? '[redacted]'
        : safeExportValue(item)
    }
    return output
  }
  if (typeof value === 'string') {
    try {
      return safeExportValue(JSON.parse(value))
    } catch {
      return value
    }
  }
  return value
}

function systemInstructionFromDetails(details: string | undefined): string | null {
  if (details === undefined) return null
  try {
    const parsed: unknown = JSON.parse(details)
    if (
      typeof parsed === 'object'
      && parsed !== null
      && 'systemInstruction' in parsed
      && typeof parsed.systemInstruction === 'string'
    ) return parsed.systemInstruction
  } catch {
    // Keep the raw diagnostic payload available when it is not JSON.
  }
  return null
}

function SignIn({ access }: { access: AccessResult | undefined }): ReactElement {
  const { signIn } = useAuthActions()
  const [isStarting, setIsStarting] = useState(false)

  const handleSignIn = async (): Promise<void> => {
    setIsStarting(true)
    try {
      await signIn('google', { redirectTo: window.location.origin })
    } finally {
      setIsStarting(false)
    }
  }

  return (
    <main className="auth-shell">
      <section className="auth-card">
        <div className="brand-lockup">
          <span className="brand-mark">E</span>
          <div>
            <p className="eyebrow">DEVELOPMENT ONLY</p>
            <h1>Eco Debug Console</h1>
          </div>
        </div>
        <p className="auth-copy">
          Sign in with the same test account used by Eco Track. The console can
          only read traces owned by that authenticated profile.
        </p>
        <button
          className="primary-button"
          disabled={isStarting}
          onClick={() => void handleSignIn()}
          type="button"
        >
          {isStarting ? 'Opening Google…' : 'Continue with Google'}
        </button>
        <p className="localhost-note">Localhost · read-only · private test data</p>
      </section>
    </main>
  )
}

function EventTimeline({
  events,
}: {
  events: DebugEvent[]
}): ReactElement {
  let previousRunId: string | null = null
  let attempt = 0

  return (
    <div className="timeline">
      {events.map((event) => {
        const isNewAttempt = event.runId !== previousRunId
        if (isNewAttempt) {
          previousRunId = event.runId
          attempt += 1
        }
        return (
          <div key={event._id}>
            {isNewAttempt ? (
              <div className="attempt-divider">
                <span>Attempt {attempt}</span>
                <span>{formatTime(event.occurredAt)}</span>
              </div>
            ) : null}
            <details className={`event-row status-${event.status}`}>
              <summary className="event-summary">
                <span className="event-sequence">
                  {prettySequence(event.sequence)}
                </span>
                <span className={`event-dot event-dot-${event.status}`} />
                <span className="event-heading">
                  <span className="event-title">{event.title}</span>
                  <span className="event-description">
                    {event.summary ?? event.kind}
                  </span>
                </span>
                <span className="event-meta">
                  {event.callIndex !== undefined ? (
                    <span>Call {event.callIndex}</span>
                  ) : null}
                  {formatDuration(event.durationMs) !== null ? (
                    <span>{formatDuration(event.durationMs)}</span>
                  ) : null}
                  <span>{formatTime(event.occurredAt)}</span>
                </span>
              </summary>
              <div className="event-detail">
                <div className="source-line">
                  <span className="detail-label">SOURCE</span>
                  <code>{event.source.file} → {event.source.symbol}</code>
                </div>
                <div className="detail-grid">
                  <div>
                    <span className="detail-label">KIND</span>
                    <span>{event.kind}</span>
                  </div>
                  <div>
                    <span className="detail-label">STATUS</span>
                    <span>{event.status}</span>
                  </div>
                  {event.toolName !== undefined ? (
                    <div>
                      <span className="detail-label">TOOL</span>
                      <span>{event.toolName}</span>
                    </div>
                  ) : null}
                  {event.tokens !== undefined ? (
                    <div>
                      <span className="detail-label">TOKENS</span>
                      <span>
                        {event.tokens.total} total
                        {event.tokens.prompt !== undefined
                          ? ` · ${event.tokens.prompt} in`
                          : ''}
                        {event.tokens.output !== undefined
                          ? ` · ${event.tokens.output} out`
                          : ''}
                      </span>
                    </div>
                  ) : null}
                </div>
                {event.warningCodes.length > 0 ? (
                  <div className="inline-warnings">
                    {event.warningCodes.map((warning) => (
                      <span className="warning-chip" key={warning}>
                        {warningLabels[warning] ?? warning}
                      </span>
                    ))}
                  </div>
                ) : null}
                {event.details !== undefined ? (
                  <div className="raw-panel">
                    <div className="raw-heading">
                      <span className="detail-label">RAW DETAILS</span>
                      <span>sanitized at capture</span>
                    </div>
                    <pre>{event.details}</pre>
                  </div>
                ) : (
                  <p className="empty-detail">No additional payload was recorded.</p>
                )}
              </div>
            </details>
          </div>
        )
      })}
    </div>
  )
}

function TurnDetail({ messageId, chatId }: { messageId: Id<'messages'>; chatId: Id<'chats'> }): ReactElement {
  const detail = useQuery(getTurnDetailQuery, { messageId })
  const replay = useQuery(getReplayExperimentQuery, { messageId })
  const runReplay = useAction(runReplayExperimentAction)
  const runCritique = useAction(runReplayCritiqueAction)
  const deleteMessage = useMutation(deleteMessageMutation)
  const forceDeleteChat = useMutation(forceDeleteChatMutation)
  const [copyLabel, setCopyLabel] = useState('Copy safe JSON')
  const [replayBusy, setReplayBusy] = useState(false)
  const [replayError, setReplayError] = useState<string | null>(null)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  if (detail === undefined) {
    return <div className="detail-loading">Loading ordered trace…</div>
  }
  if ('error' in detail) {
    return <div className="detail-error">{detail.error}</div>
  }

  const exportPayload = safeExportValue({
    privacyNotice:
      'Authentication and database identifiers were removed. Conversation and health-related test content remain.',
    exportedAt: new Date().toISOString(),
    chatDate: detail.chat.date,
    message: detail.message,
    events: detail.events,
    messageBlocks: detail.messageBlocks,
    toolTraces: detail.toolTraces,
    cards: detail.cards,
    guideInvocations: detail.guideInvocations,
    replay: replay !== undefined && !('error' in replay) ? replay : undefined,
  })
  const exportJson = JSON.stringify(exportPayload, null, 2)
  const initialModelRequest = detail.events.find(
    (event) => event.title === 'Gemini call 0 started',
  )?.details
  const initialSystemInstruction = systemInstructionFromDetails(initialModelRequest)

  const copyExport = async (): Promise<void> => {
    await navigator.clipboard.writeText(exportJson)
    setCopyLabel('Copied')
    window.setTimeout(() => setCopyLabel('Copy safe JSON'), 1_500)
  }

  const downloadExport = (): void => {
    const blob = new Blob([exportJson], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `eco-turn-${detail.chat.date}-${detail.message.timestamp}.json`
    anchor.click()
    URL.revokeObjectURL(url)
  }

  const startReplay = async (): Promise<void> => {
    if (!window.confirm('Run the fixed replay suite? This makes at most 30 development-only Gemini requests and executes no tools.')) return
    setReplayBusy(true)
    setReplayError(null)
    try {
      const result = await runReplay({ messageId })
      if (result.error !== undefined) setReplayError(result.error)
    } catch (error) {
      setReplayError(error instanceof Error ? error.message : String(error))
    } finally {
      setReplayBusy(false)
    }
  }

  const startCritique = async (): Promise<void> => {
    if (replay === undefined || 'error' in replay || replay.experiment === null) return
    setReplayBusy(true)
    setReplayError(null)
    try {
      const result = await runCritique({ experimentId: replay.experiment._id })
      if (result.error !== undefined) setReplayError(result.error)
    } catch (error) {
      setReplayError(error instanceof Error ? error.message : String(error))
    } finally {
      setReplayBusy(false)
    }
  }

  const removeMessage = async (): Promise<void> => {
    const confirmation = window.prompt(
      'Delete this message, its cards, and all debug/replay records? Confirmed workout-session history remains. Type DELETE MESSAGE to continue.',
    )
    if (confirmation !== 'DELETE MESSAGE') return
    setDeleteBusy(true)
    setDeleteError(null)
    try {
      const result = await deleteMessage({ messageId, confirmation })
      if (result.error !== undefined) setDeleteError(result.error)
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : String(error))
    } finally {
      setDeleteBusy(false)
    }
  }

  const removeChat = async (): Promise<void> => {
    const confirmation = window.prompt(
      'Force-delete this whole chat, its messages, cards, summaries, and debug/replay records? Confirmed workout-session history remains. Type DELETE CHAT to continue.',
    )
    if (confirmation !== 'DELETE CHAT') return
    setDeleteBusy(true)
    setDeleteError(null)
    try {
      const result = await forceDeleteChat({ chatId, confirmation })
      if (result.error !== undefined) setDeleteError(result.error)
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : String(error))
    } finally {
      setDeleteBusy(false)
    }
  }

  const replayGroups = replay === undefined || 'error' in replay
    ? []
    : [...new Set(replay.results.map((result) => result.variant))].map((variant) => {
        const results = replay.results.filter((result) => result.variant === variant)
        return {
          variant,
          results,
          getDataCount: results.filter((result) => result.getDataSelected).length,
          totalTokens: results.reduce((total, result) => total + result.totalTokens, 0),
          requestedFields: [...new Set(results.flatMap((result) => result.requestedFields))],
        }
      })

  return (
    <div className="turn-detail">
      <div className="detail-toolbar">
        <div>
          <p className="section-kicker">ORDERED EVENT STREAM</p>
          <p className="toolbar-note">
            Click any sequence number to inspect its raw payload and source.
          </p>
        </div>
        <div className="export-actions">
          <button
            className="quiet-button"
            onClick={() => void copyExport()}
            type="button"
          >
            {copyLabel}
          </button>
          <button className="quiet-button" onClick={downloadExport} type="button">
            Download
          </button>
          <button className="danger-button" disabled={deleteBusy} onClick={() => void removeMessage()} type="button">
            Delete message
          </button>
          <button className="danger-button" disabled={deleteBusy} onClick={() => void removeChat()} type="button">
            Delete chat
          </button>
        </div>
      </div>
      {deleteError !== null ? <p className="detail-error">{deleteError}</p> : null}

      {detail.events.length > 0 ? (
        <EventTimeline events={detail.events} />
      ) : (
        <div className="partial-trace">
          No debug events were captured for this turn.
        </div>
      )}

      {initialModelRequest !== undefined ? (
        <section className="persisted-section">
          <p className="section-kicker">MODEL INPUT · CALL 0</p>
          <details className="record-card">
            <summary>System prompt, assembled history, current message, and available tools</summary>
            {initialSystemInstruction !== null ? (
              <div className="raw-panel">
                <div className="raw-heading">
                  <span className="detail-label">SYSTEM INSTRUCTION · RENDERED</span>
                  <span>newlines shown as sent to Gemini</span>
                </div>
                <pre>{initialSystemInstruction}</pre>
              </div>
            ) : null}
            <pre>{initialModelRequest}</pre>
          </details>
        </section>
      ) : null}

      <section className="persisted-section replay-lab">
        <div className="replay-heading">
          <div>
            <p className="section-kicker">CALL 0 REPLAY LAB</p>
            <p className="toolbar-note">
              Six fixed variants · five samples each · no tool execution or user-turn writes
            </p>
          </div>
          <button
            className="primary-button"
            disabled={replayBusy || (replay !== undefined && !('error' in replay) && replay.experiment?.status === 'running')}
            onClick={() => void startReplay()}
            type="button"
          >
            {replayBusy ? 'Running…' : 'Run 30-request suite'}
          </button>
        </div>
        {replayError !== null ? <p className="detail-error">{replayError}</p> : null}
        {replay !== undefined && 'error' in replay ? <p className="detail-error">{replay.error}</p> : null}
        {replay !== undefined && !('error' in replay) && replay.experiment !== null ? (
          <>
            <div className="replay-status">
              <span className={`status-${replay.experiment.status}`}>{replay.experiment.status}</span>
              <span>{replay.experiment.snapshotSource} snapshot</span>
              <span>{replay.results.length}/30 samples</span>
            </div>
            <div className="replay-grid">
              {replayGroups.map((group) => (
                <details className="record-card" key={group.variant}>
                  <summary>
                    {group.variant}
                    <span>{group.getDataCount}/{group.results.length} Get_data</span>
                  </summary>
                  <div className="replay-summary">
                    <span>{group.totalTokens.toLocaleString()} tokens</span>
                    <span>{group.requestedFields.join(', ') || 'No Get_data fields'}</span>
                  </div>
                  <pre>{JSON.stringify(group.results, null, 2)}</pre>
                </details>
              ))}
            </div>
            {replay.experiment.status === 'completed' ? (
              <button
                className="quiet-button"
                disabled={replayBusy}
                onClick={() => void startCritique()}
                type="button"
              >
                {replay.experiment.critique === undefined ? 'Run post-hoc critique' : 'Refresh post-hoc critique'}
              </button>
            ) : null}
            {replay.experiment.critique !== undefined ? (
              <div className="critique-panel">
                <strong>POST-HOC CRITIQUE · NOT HIDDEN REASONING</strong>
                <p>{replay.experiment.critique}</p>
                <span>{replay.experiment.critiqueTokens ?? 0} tokens</span>
              </div>
            ) : null}
          </>
        ) : (
          <p className="empty-detail">No replay experiment has been run for this turn.</p>
        )}
      </section>

      <section className="persisted-section">
        <p className="section-kicker">PERSISTED RECORDS</p>
        <div className="record-grid">
          <details className="record-card">
            <summary>messageBlocks <span>{detail.messageBlocks.length}</span></summary>
            <pre>{JSON.stringify(detail.messageBlocks, null, 2)}</pre>
          </details>
          <details className="record-card">
            <summary>private toolTraces <span>{detail.toolTraces.length}</span></summary>
            <pre>{JSON.stringify(detail.toolTraces, null, 2)}</pre>
          </details>
          <details className="record-card">
            <summary>cards <span>{detail.cards.length}</span></summary>
            <pre>{JSON.stringify(detail.cards, null, 2)}</pre>
          </details>
          <details className="record-card">
            <summary>guideInvocations <span>{detail.guideInvocations.length}</span></summary>
            <pre>{JSON.stringify(detail.guideInvocations, null, 2)}</pre>
          </details>
        </div>
      </section>
    </div>
  )
}

function TurnRow({ turn }: { turn: TurnSummary }): ReactElement {
  const [expanded, setExpanded] = useState(false)
  const hasWarnings = turn.warningCodes.length > 0

  return (
    <article className={`turn-card ${expanded ? 'turn-card-expanded' : ''}`}>
      <button
        aria-expanded={expanded}
        className="turn-toggle"
        onClick={() => setExpanded((value) => !value)}
        type="button"
      >
        <span className="turn-chevron">{expanded ? '−' : '+'}</span>
        <span className="turn-number">
          {formatTime(turn.timestamp)}
          <small>{turn.chatDate}</small>
        </span>
        <span className="conversation-preview">
          <span className="message-preview">
            <span className="speaker user-speaker">USER</span>
            <span>{turn.userText}</span>
          </span>
          <span className="message-preview">
            <span className="speaker eco-speaker">ECO</span>
            <span>{turn.ecoText || 'Processing…'}</span>
          </span>
        </span>
        <span className="turn-signals">
          {turn.hasError ? <span className="error-signal">ERROR</span> : null}
          {hasWarnings ? (
            <span className="warning-signal">{turn.warningCodes.length} WARN</span>
          ) : null}
          <span>{turn.eventCount} EVENTS</span>
        </span>
      </button>
      {hasWarnings ? (
        <div className="turn-warnings">
          {turn.warningCodes.map((warning) => (
            <span className="warning-chip" key={warning}>
              {warningLabels[warning] ?? warning}
            </span>
          ))}
        </div>
      ) : null}
      {expanded ? <TurnDetail chatId={turn.chatId} messageId={turn.messageId} /> : null}
    </article>
  )
}

function AccessDenied({
  setupAvailable,
  onClaim,
}: {
  setupAvailable: boolean
  onClaim: () => void
}): ReactElement {
  return (
    <main className="auth-shell">
      <section className="auth-card">
        <p className="eyebrow">DEVELOPMENT ONLY</p>
        <h2>Debug access required</h2>
        <p className="auth-copy">
          This account is not approved to view Eco debug traces.
        </p>
        {setupAvailable ? <button className="primary-button" onClick={onClaim} type="button">Approve this first admin account</button> : null}
      </section>
    </main>
  )
}

function Console(): ReactElement {
  const { signOut } = useAuthActions()
  const usersResult = useQuery(listUsersQuery, {})
  const [selectedUser, setSelectedUser] = useState<DebugUser | null>(null)
  const [selectedDate, setSelectedDate] = useState<string | null>(null)
  const daysResult = useQuery(listDaysQuery, selectedUser === null ? 'skip' : { profileId: selectedUser.profileId })
  const result = useQuery(listTurnsQuery, selectedUser === null || selectedDate === null ? 'skip' : { profileId: selectedUser.profileId, date: selectedDate, limit: 50 })
  const [filter, setFilter] = useState<Filter>('all')
  const [search, setSearch] = useState('')

  const turns = (result?.turns ?? []) as TurnSummary[]
  const filteredTurns = useMemo(() => {
    const query = search.trim().toLowerCase()
    return turns.filter((turn) => {
      const matchesFilter =
        filter === 'all' ||
        (filter === 'warnings' && turn.warningCodes.length > 0) ||
        (filter === 'errors' && turn.hasError)
      const matchesSearch =
        query.length === 0 ||
        turn.userText.toLowerCase().includes(query) ||
        turn.ecoText.toLowerCase().includes(query) ||
        turn.usedTools.some((tool) => tool.toLowerCase().includes(query))
      return matchesFilter && matchesSearch
    })
  }, [filter, search, turns])

  const warningCount = turns.filter((turn) => turn.warningCodes.length > 0).length
  const errorCount = turns.filter((turn) => turn.hasError).length
  const eventCount = turns.reduce((total, turn) => total + turn.eventCount, 0)

  return (
    <main className="console-shell">
      <header className="console-header">
        <div className="brand-lockup">
          <span className="brand-mark">E</span>
          <div>
            <p className="eyebrow">DEVELOPMENT ONLY</p>
            <h1>Eco Debug Console</h1>
          </div>
        </div>
        <div className="header-actions">
          <span className="connection-state"><i /> LIVE</span>
          <button className="text-button" onClick={() => void signOut()} type="button">
            Sign out
          </button>
        </div>
      </header>

      {usersResult === undefined ? (
        <div className="console-loading">Reading debug users…</div>
      ) : usersResult.error !== null ? (
        <section className="disabled-panel"><h2>Could not read debug users</h2><p>{usersResult.error}</p></section>
      ) : selectedUser === null ? (
        <section className="navigator"><p className="section-kicker">ALL TEST USERS</p><h2>Choose a user</h2><div className="navigator-list">{usersResult.users.map((user) => <button className="navigator-item" key={user.profileId} onClick={() => setSelectedUser(user)} type="button"><span>{user.label}</span><small>{user.dayCount} days</small></button>)}</div></section>
      ) : selectedDate === null ? (
        <section className="navigator"><button className="back-button" onClick={() => setSelectedUser(null)} type="button">← All users</button><p className="section-kicker">USER: {selectedUser.label}</p><h2>Choose a day</h2><div className="navigator-list">{daysResult === undefined ? <div className="console-loading">Reading days…</div> : daysResult.days.map((day) => <button className="navigator-item" key={day.date} onClick={() => setSelectedDate(day.date)} type="button"><span>{day.date}</span></button>)}</div></section>
      ) : result === undefined ? (
        <div className="console-loading">Reading turns…</div>
      ) : !result.enabled ? (
        <section className="disabled-panel">
          <p className="eyebrow">SERVER FLAG REQUIRED</p>
          <h2>Debug capture is disabled</h2>
          <p>
            Enable <code>ECO_DEBUG_CONSOLE_ENABLED=true</code> on the Convex
            development deployment. Production remains disabled.
          </p>
        </section>
      ) : result.error !== null ? (
        <section className="disabled-panel">
          <h2>Could not read traces</h2>
          <p>{result.error}</p>
        </section>
      ) : (
        <>
          <section className="overview">
            <div>
              <button className="back-button" onClick={() => setSelectedDate(null)} type="button">← {selectedUser.label}</button>
              <p className="section-kicker">USER: {selectedUser.label} · {selectedDate}</p>
              <h2>Chronological diagnostics</h2>
              <p>
                Newest first. Expand a turn, then expand any numbered event for
                its exact source, raw context, arguments, result, or error.
              </p>
            </div>
            <div className="metrics">
              <div><strong>{turns.length}</strong><span>turns</span></div>
              <div><strong>{eventCount}</strong><span>events</span></div>
              <div className={warningCount > 0 ? 'metric-warning' : ''}>
                <strong>{warningCount}</strong><span>warnings</span>
              </div>
              <div className={errorCount > 0 ? 'metric-error' : ''}>
                <strong>{errorCount}</strong><span>errors</span>
              </div>
            </div>
          </section>

          <section className="controls" aria-label="Turn filters">
            <div className="filter-tabs">
              {(['all', 'warnings', 'errors'] as const).map((value) => (
                <button
                  className={filter === value ? 'filter-active' : ''}
                  key={value}
                  onClick={() => setFilter(value)}
                  type="button"
                >
                  {value}
                </button>
              ))}
            </div>
            <label className="search-field">
              <span>SEARCH</span>
              <input
                onChange={(event) => setSearch(event.target.value)}
                placeholder="message, response, or tool"
                type="search"
                value={search}
              />
            </label>
          </section>

          <section className="turn-list">
            <div className="list-heading">
              <span>TIME</span>
              <span>CONVERSATION</span>
              <span>DIAGNOSTICS</span>
            </div>
            {filteredTurns.length > 0 ? (
              filteredTurns.map((turn) => (
                <TurnRow key={turn.messageId} turn={turn} />
              ))
            ) : (
              <div className="empty-state">
                <p>No matching captured turns.</p>
                <span>Send a new message in the Eco Track development app.</span>
              </div>
            )}
          </section>
        </>
      )}
    </main>
  )
}

export function App(): ReactElement {
  const { isAuthenticated, isLoading } = useConvexAuth()
  const access = useQuery(getAccessQuery, isAuthenticated ? {} : 'skip')
  const claimFirstAccess = useMutation(claimFirstAccessMutation)

  if (isLoading) {
    return <main className="auth-shell"><div className="console-loading">Checking access…</div></main>
  }
  if (!isAuthenticated) return <SignIn access={access} />
  if (access === undefined) return <main className="auth-shell"><div className="console-loading">Checking debug access…</div></main>
  if (!access.enabled) return <main className="auth-shell"><section className="auth-card"><h2>Debug capture is disabled</h2><p>Enable <code>ECO_DEBUG_CONSOLE_ENABLED=true</code> on the development deployment.</p></section></main>
  if (!access.approved) return <AccessDenied setupAvailable={access.setupAvailable} onClaim={() => void claimFirstAccess()} />
  return <Console />
}
