declare const process: { env: Record<string, string | undefined> }

export function isDebugConsoleEnabled(): boolean {
  return process.env.ECO_DEBUG_CONSOLE_ENABLED === 'true'
}
