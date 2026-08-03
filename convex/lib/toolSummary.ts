type UnknownRecord = Record<string, unknown>

export type ToolTraceStatus = 'completed' | 'rejected'

export type ToolSummaryInput = {
  toolName: string
  args: unknown
  result: unknown
  status: ToolTraceStatus
}

function record(value: unknown): UnknownRecord | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as UnknownRecord
    : null
}

function string(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function number(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function title(value: string): string {
  return value.replace(/([A-Z])/g, ' $1').replace(/^./, (letter) => letter.toUpperCase())
}

function displayValue(value: unknown): string {
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (Array.isArray(value)) return value.length === 0 ? 'none recorded' : value.map(displayValue).join(', ')
  const valueRecord = record(value)
  if (valueRecord === null) return 'not available'
  return Object.entries(valueRecord)
    .map(([key, entry]) => `${title(key)}: ${displayValue(entry)}`)
    .join('; ')
}

function errorNote(toolName: string, result: UnknownRecord, status: ToolTraceStatus): string | null {
  const message = string(result.error)
  if (message !== null) return `Couldn’t complete ${toolName}: ${message}`
  if (status === 'rejected') return `Couldn’t complete ${toolName}.`
  return null
}

function formatSet(value: unknown): string {
  const set = record(value)
  if (set === null) return 'details unavailable'
  const reps = number(set.reps)
  const weight = number(set.weight)
  const duration = number(set.duration)
  const distance = number(set.distance)
  const parts: string[] = []
  if (reps !== null) parts.push(`${reps} reps`)
  if (weight !== null) parts.push(`at ${weight}`)
  if (duration !== null) parts.push(`${duration}s`)
  if (distance !== null) parts.push(`${distance} distance`)
  return parts.length === 0 ? 'details unavailable' : parts.join(' ')
}

function getDataSummary(result: UnknownRecord): string {
  const lines: string[] = []
  const profile = record(result.profile)
  if (profile !== null) {
    for (const [key, value] of Object.entries(profile)) {
      lines.push(`${title(key)}: ${displayValue(value)}`)
    }
  }
  const dailySummary = record(result.dailySummary)
  if (dailySummary !== null) {
    const date = string(dailySummary.date)
    const content = string(dailySummary.content)
    lines.push(`Daily summary${date === null ? '' : ` (${date})`}: ${content ?? 'not available'}`)
  }
  const exercises = Array.isArray(result.exercises) ? result.exercises : []
  for (const item of exercises) {
    const exercise = record(item)
    if (exercise === null) continue
    const label = string(exercise.exerciseId) ?? 'Exercise'
    const name = string(exercise.name) ?? 'Unnamed exercise'
    const date = string(exercise.date)
    const sets = Array.isArray(exercise.sets) ? exercise.sets.map(formatSet).join(', ') : null
    lines.push(`${label}: ${name}${date === null ? '' : ` (${date})`}${sets === null ? '' : ` — ${sets}`}`)
  }
  return lines.length === 0 ? 'Fetched data: no matching data found.' : `Fetched data:\n${lines.map((line) => `• ${line}`).join('\n')}`
}

function calculationSummary(args: UnknownRecord, result: UnknownRecord): string {
  const operation = string(result.operation) ?? string(args.operation) ?? 'calculation'
  const error = record(result.error)
  if (error !== null) return `Couldn’t calculate ${title(operation)}: ${string(error.message) ?? 'invalid values'}`
  const output = number(result.result)
  if (output === null) return `Couldn’t calculate ${title(operation)}.`
  if (operation === 'oneRepMax') {
    const weight = number(args.weight)
    const reps = number(args.reps)
    const unit = string(args.weightUnit) ?? ''
    const formula = string(args.formula)
    return `Calculated 1RM${formula === null ? '' : ` (${formula})`}: ${weight ?? '?'}${unit} × ${reps ?? '?'} → ${output}${unit}`
  }
  if (operation === 'convertUnit') return `Converted ${number(args.value) ?? '?'} ${string(args.from) ?? ''} → ${output} ${string(args.to) ?? ''}`.trim()
  if (operation === 'percentOf1RM') return `Calculated ${number(args.percent) ?? '?'}% of 1RM: ${output}`
  if (operation === 'paceConvert') return `Calculated pace: ${string(result.formatted) ?? String(output)}`
  if (operation === 'volumeTotal') return `Calculated volume: ${output}${number(result.setCount) === null ? '' : ` across ${number(result.setCount)} sets`}`
  if (operation === 'plateMath') return `Calculated plate loading: ${number(result.actualTotal) ?? output} ${string(result.weightUnit) ?? ''}`.trim()
  return `Calculated ${title(operation)}: ${output}`
}

function searchSummary(args: UnknownRecord, result: UnknownRecord): string {
  const searches = Array.isArray(result.searches) ? result.searches.map(record).filter((search): search is UnknownRecord => search !== null) : []
  if (searches.length === 0) return 'Looked up exercise: no matching data found.'
  return searches.map((search) => {
    const query = string(search.query) ?? 'exercise'
    const autoResolved = record(search.autoResolved)
    const entries = autoResolved === null
      ? (Array.isArray(search.candidates) ? search.candidates.map(record).filter((entry): entry is UnknownRecord => entry !== null).slice(0, 3) : [])
      : [autoResolved]
    const details = entries.map((entry) => {
      const label = string(entry.exerciseId) ?? 'Library Exercise'
      const name = string(entry.canonicalName) ?? 'Unnamed exercise'
      const description = string(entry.description)
      return `${label} — ${name}${description === null ? '' : ` — ${description}`}`
    })
    return entries.length === 0 ? `Looked up “${query}”: no confident match.` : `Looked up “${query}”: ${details.join('; ')}`
  }).join('\n')
}

function workoutDetails(args: UnknownRecord): string {
  const parsed = record(args.parsedData) ?? args
  const blocks = Array.isArray(parsed.blocks) ? parsed.blocks : []
  const exercises = blocks.flatMap((block) => {
    const item = record(block)
    return item !== null && Array.isArray(item.exercises) ? item.exercises : []
  }).map(record).filter((exercise): exercise is UnknownRecord => exercise !== null)
  const details = exercises.map((exercise) => {
    const name = string(exercise.name)
    if (name === null) return null
    const sets = Array.isArray(exercise.sets) ? exercise.sets.map(formatSet).join(', ') : ''
    return sets.length === 0 ? name : `${name} — ${sets}`
  }).filter((detail): detail is string => detail !== null)
  return details.length === 0 ? 'workout details updated' : details.join('; ')
}

export function toolStartSummary(toolName: string): string | null {
  return toolName === 'get_new_exercise_guidance' ? '[used new_exercise_guide]' : null
}

export function toolResultSummary(input: ToolSummaryInput): string {
  const args = record(input.args) ?? {}
  const result = record(input.result) ?? {}
  const error = errorNote(input.toolName, result, input.status)
  if (error !== null) return error

  switch (input.toolName) {
    case 'log_workout': {
      const writes = Array.isArray(result.writes) ? result.writes.length : 0
      const count = writes > 0 ? writes : Array.isArray(args.blocks) ? args.blocks.length : 0
      const pending = result.needsClarification === true
      return pending ? `Created ${count} workout card${count === 1 ? '' : 's'} for review.` : `Logged ${count} workout${count === 1 ? '' : 's'}.`
    }
    case 'Get_data': return getDataSummary(result)
    case 'calculate': return calculationSummary(args, result)
    case 'search_exercise_library': return searchSummary(args, result)
    case 'get_new_exercise_guidance': return `[returned new_exercise_guide: ${string(result.outcome) ?? 'unavailable'}]`
    case 'create_custom_exercise': return `Created personal exercise: ${string(args.name) ?? 'Unnamed exercise'}.`
    case 'Correct_log': {
      if (result.confirmed === true) return `Updated ${string(args.cardLabel) ?? string(args.exerciseId) ?? 'workout'}: confirmed.`
      const target = string(args.cardLabel) ?? string(args.exerciseId) ?? 'workout'
      return `Updated ${target}: ${workoutDetails(args)}. Ready to confirm.`
    }
    default: return `Completed ${input.toolName}.`
  }
}
