/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as functions_apiUsage from "../functions/apiUsage.js";
import type * as functions_blocks from "../functions/blocks.js";
import type * as functions_cards from "../functions/cards.js";
import type * as functions_chats from "../functions/chats.js";
import type * as functions_crons from "../functions/crons.js";
import type * as functions_exercises from "../functions/exercises.js";
import type * as functions_messages from "../functions/messages.js";
import type * as functions_profiles from "../functions/profiles.js";
import type * as functions_sessions from "../functions/sessions.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  "functions/apiUsage": typeof functions_apiUsage;
  "functions/blocks": typeof functions_blocks;
  "functions/cards": typeof functions_cards;
  "functions/chats": typeof functions_chats;
  "functions/crons": typeof functions_crons;
  "functions/exercises": typeof functions_exercises;
  "functions/messages": typeof functions_messages;
  "functions/profiles": typeof functions_profiles;
  "functions/sessions": typeof functions_sessions;
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

export declare const components: {};
