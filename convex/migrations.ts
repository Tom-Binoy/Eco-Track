import { Migrations } from '@convex-dev/migrations'

import { components } from './_generated/api'
import schema from './schema'

const migrations = new Migrations(components.migrations, { schema })

export const backfillMotionPreferences = migrations.define({
  table: 'profiles',
  migrateOne: async (_ctx, profile) => ({
    ecoRevealPreference: profile.ecoRevealPreference ?? 'natural',
    motionPreference: profile.motionPreference ?? 'responsive',
  }),
})
