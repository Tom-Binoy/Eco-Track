import { internal } from '../_generated/api'
import { internalAction } from '../_generated/server'

type WgerPage<T> = { next: string | null; results: T[] }
type Translation = { language: number; name: string; description?: string; aliases?: Array<{ alias: string }> }
type Exercise = { id: number; category?: { name?: string }; equipment?: Array<{ name?: string }>; muscles?: Array<{ name_en?: string; name?: string }>; muscles_secondary?: Array<{ name_en?: string; name?: string }>; translations: Translation[]; status?: string }

const API = 'https://wger.de/api/v2/'
const ENGLISH_LANGUAGE_ID = 2 // Confirmed from the live /language/ endpoint.

function normalize(value: string): string { return value.trim().toLocaleLowerCase().replace(/[^a-z0-9]+/g, ' ').trim() }

async function fetchAll<T>(url: string): Promise<T[]> {
  const results: T[] = []
  let next: string | null = url
  while (next !== null) {
    const response = await fetch(next)
    if (!response.ok) throw new Error(`wger request failed: ${response.status}`)
    const page = await response.json() as WgerPage<T>
    results.push(...page.results)
    next = page.next
  }
  return results
}

export const seed = internalAction({
  args: {},
  handler: async (ctx): Promise<{ imported: number }> => {
    const source = await fetchAll<Exercise>(`${API}exerciseinfo/?language=${ENGLISH_LANGUAGE_ID}&limit=100`)
    const mapped = source.flatMap((exercise) => {
      if (exercise.status !== undefined && exercise.status !== 'approved') return []
      const translation = exercise.translations.find((item) => item.language === ENGLISH_LANGUAGE_ID && item.name.trim() !== '')
      if (translation === undefined) return []
      const aliases = (translation.aliases ?? []).map((item) => item.alias).filter(Boolean)
      const muscles = [...(exercise.muscles ?? []), ...(exercise.muscles_secondary ?? [])].map((item) => item.name_en || item.name).filter((item): item is string => item !== undefined && item !== '')
      return [{ wgerId: exercise.id, canonicalName: translation.name, aliases, searchBlob: normalize([translation.name, ...aliases].join(' ')), category: exercise.category?.name, equipment: (exercise.equipment ?? []).map((item) => item.name).filter((item): item is string => item !== undefined && item !== '').join(', ') || undefined, muscleGroup: muscles[0], allMuscles: muscles.length > 0 ? muscles : undefined, description: translation.description }]
    })
    for (let start = 0; start < mapped.length; start += 50) await ctx.runMutation(internal.functions.exerciseLibrary.upsertWgerBatch, { exercises: mapped.slice(start, start + 50) })
    return { imported: mapped.length }
  },
})
