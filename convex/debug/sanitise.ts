const redactedKeys = new Set([
  'apikey',
  'api_key',
  'authorization',
  'authuserid',
  'cookie',
  'password',
  'refreshtoken',
  'secret',
  'token',
  'tokenidentifier',
  'userid',
])

const maxDepth = 12
const maxArrayLength = 200
const maxStringLength = 50_000

function sanitiseValue(value: unknown, depth: number): unknown {
  if (depth > maxDepth) return '[depth limit]'
  if (typeof value === 'string') {
    return value.length > maxStringLength
      ? `${value.slice(0, maxStringLength)}… [truncated]`
      : value
  }
  if (typeof value === 'number' || typeof value === 'boolean' || value === null) {
    return value
  }
  if (Array.isArray(value)) {
    return value
      .slice(0, maxArrayLength)
      .map((item) => sanitiseValue(item, depth + 1))
  }
  if (typeof value === 'object') {
    const output: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value)) {
      output[key] = redactedKeys.has(key.toLowerCase())
        ? '[redacted]'
        : sanitiseValue(item, depth + 1)
    }
    return output
  }
  return String(value)
}

export function serialiseDebugDetails(value: unknown): string {
  try {
    return JSON.stringify(sanitiseValue(value, 0), null, 2)
  } catch {
    return JSON.stringify({ error: 'Debug details could not be serialised.' })
  }
}

export function serialiseDebugError(error: unknown): string {
  if (error instanceof Error) {
    return serialiseDebugDetails({
      name: error.name,
      message: error.message,
      stack: error.stack,
    })
  }
  return serialiseDebugDetails({ message: String(error) })
}
