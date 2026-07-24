import { cronJobs } from 'convex/server'

import { internal } from './_generated/api'

const crons = cronJobs()

crons.hourly('daily-cleanup', { minuteUTC: 0 }, internal.functions.crons.runDailyCheck)

export default crons
