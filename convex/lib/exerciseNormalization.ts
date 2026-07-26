export function normalizeExerciseInput(value: string): string {
  return value.trim().toLocaleLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

export function buildExerciseSearchBlob(canonicalName: string, aliases: string[], description?: string): string {
  return normalizeExerciseInput([canonicalName, ...aliases, description ?? ''].join(' '))
}
