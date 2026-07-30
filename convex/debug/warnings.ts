export const DEBUG_WARNING = {
  followUpCapReached: 'follow_up_cap_reached',
  repeatedTool: 'repeated_tool',
  redundantDataLookup: 'redundant_data_lookup',
  toolResultError: 'tool_result_error',
  validationFailed: 'validation_failed',
  workoutEvidenceWeak: 'log_workout_without_convincing_evidence',
} as const

const workoutQuantityPattern =
  /\b\d+(?:\.\d+)?\s*(?:x|sets?|reps?|kg|kgs|kilograms?|lb|lbs|pounds?|seconds?|secs?|minutes?|mins?|hours?|km|kilometres?|kilometers?|miles?)\b/i
const completedWorkoutPattern =
  /\b(?:i\s+)?(?:did|done|completed|finished|performed|trained|worked\s+out|hit)\b/i
const negatedWorkoutPattern =
  /\b(?:did(?:n't| not)|didnt|didn’t|could(?:n't| not)|couldnt|couldn’t|skipped|missed|no)\b.{0,48}\b(?:gym|workout|training|train|exercise|session)\b/i

export function workoutEvidenceWarning(userText: string): string[] {
  const hasPositiveEvidence =
    workoutQuantityPattern.test(userText) ||
    (completedWorkoutPattern.test(userText) && !negatedWorkoutPattern.test(userText))

  return hasPositiveEvidence ? [] : [DEBUG_WARNING.workoutEvidenceWeak]
}
