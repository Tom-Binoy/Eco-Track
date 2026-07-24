export const BLOCK_TYPES = [
  'standard',
  'superset',
  'dropset',
  'emom',
  'pyramid',
  'circuit',
  'amrap',
] as const

export type BlockType = (typeof BLOCK_TYPES)[number]
