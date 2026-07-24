import type { Doc, Id } from '../convex/_generated/dataModel'

export type Profile = Doc<'profiles'>
export type Chat = Doc<'chats'>
export type Message = Doc<'messages'>
export type Card = Doc<'cards'>
export type Session = Doc<'sessions'>
export type Block = Doc<'blocks'>
export type Exercise = Doc<'exercises'>
export type ExerciseLibrary = Doc<'exerciseLibrary'>
export type UserExerciseAlias = Doc<'userExerciseAliases'>
export type MessageBlock = Doc<'messageBlocks'>
export type DailySummary = Doc<'dailySummaries'>
export type WorkoutContext = Doc<'workoutContext'>
export type SessionSummary = Doc<'sessionSummaries'>
export type ApiUsage = Doc<'apiUsage'>
export type MessageFeedback = Doc<'messageFeedback'>
export type UserReport = Doc<'userReports'>

export type { Id }
