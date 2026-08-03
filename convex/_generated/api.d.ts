/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as auth from "../auth.js";
import type * as crons from "../crons.js";
import type * as debug_config from "../debug/config.js";
import type * as debug_evaluations from "../debug/evaluations.js";
import type * as debug_events from "../debug/events.js";
import type * as debug_liveGemini from "../debug/liveGemini.js";
import type * as debug_replay from "../debug/replay.js";
import type * as debug_sanitise from "../debug/sanitise.js";
import type * as debug_trace from "../debug/trace.js";
import type * as debug_warnings from "../debug/warnings.js";
import type * as functions_apiUsage from "../functions/apiUsage.js";
import type * as functions_blocks from "../functions/blocks.js";
import type * as functions_cards from "../functions/cards.js";
import type * as functions_chats from "../functions/chats.js";
import type * as functions_crons from "../functions/crons.js";
import type * as functions_dailySummaries from "../functions/dailySummaries.js";
import type * as functions_embedExerciseLibrary from "../functions/embedExerciseLibrary.js";
import type * as functions_exerciseLibrary from "../functions/exerciseLibrary.js";
import type * as functions_exercises from "../functions/exercises.js";
import type * as functions_messages from "../functions/messages.js";
import type * as functions_profiles from "../functions/profiles.js";
import type * as functions_seedWger from "../functions/seedWger.js";
import type * as functions_sessionSummaries from "../functions/sessionSummaries.js";
import type * as functions_sessions from "../functions/sessions.js";
import type * as functions_workoutContext from "../functions/workoutContext.js";
import type * as http from "../http.js";
import type * as lib_calculate from "../lib/calculate.js";
import type * as lib_dailyCheck from "../lib/dailyCheck.js";
import type * as lib_exerciseNormalization from "../lib/exerciseNormalization.js";
import type * as lib_gemini from "../lib/gemini.js";
import type * as lib_geminiConfig from "../lib/geminiConfig.js";
import type * as lib_prompts_candidates_gemini35FlashLite from "../lib/prompts/candidates/gemini35FlashLite.js";
import type * as lib_prompts_candidates_gemini36Flash from "../lib/prompts/candidates/gemini36Flash.js";
import type * as lib_prompts_ecoSystem from "../lib/prompts/ecoSystem.js";
import type * as lib_toolSummary from "../lib/toolSummary.js";
import type * as lib_validation from "../lib/validation.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  auth: typeof auth;
  crons: typeof crons;
  "debug/config": typeof debug_config;
  "debug/evaluations": typeof debug_evaluations;
  "debug/events": typeof debug_events;
  "debug/liveGemini": typeof debug_liveGemini;
  "debug/replay": typeof debug_replay;
  "debug/sanitise": typeof debug_sanitise;
  "debug/trace": typeof debug_trace;
  "debug/warnings": typeof debug_warnings;
  "functions/apiUsage": typeof functions_apiUsage;
  "functions/blocks": typeof functions_blocks;
  "functions/cards": typeof functions_cards;
  "functions/chats": typeof functions_chats;
  "functions/crons": typeof functions_crons;
  "functions/dailySummaries": typeof functions_dailySummaries;
  "functions/embedExerciseLibrary": typeof functions_embedExerciseLibrary;
  "functions/exerciseLibrary": typeof functions_exerciseLibrary;
  "functions/exercises": typeof functions_exercises;
  "functions/messages": typeof functions_messages;
  "functions/profiles": typeof functions_profiles;
  "functions/seedWger": typeof functions_seedWger;
  "functions/sessionSummaries": typeof functions_sessionSummaries;
  "functions/sessions": typeof functions_sessions;
  "functions/workoutContext": typeof functions_workoutContext;
  http: typeof http;
  "lib/calculate": typeof lib_calculate;
  "lib/dailyCheck": typeof lib_dailyCheck;
  "lib/exerciseNormalization": typeof lib_exerciseNormalization;
  "lib/gemini": typeof lib_gemini;
  "lib/geminiConfig": typeof lib_geminiConfig;
  "lib/prompts/candidates/gemini35FlashLite": typeof lib_prompts_candidates_gemini35FlashLite;
  "lib/prompts/candidates/gemini36Flash": typeof lib_prompts_candidates_gemini36Flash;
  "lib/prompts/ecoSystem": typeof lib_prompts_ecoSystem;
  "lib/toolSummary": typeof lib_toolSummary;
  "lib/validation": typeof lib_validation;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {
  migrations: import("@convex-dev/migrations/_generated/component.js").ComponentApi<"migrations">;
};
