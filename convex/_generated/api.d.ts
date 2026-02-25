/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as admin from "../admin.js";
import type * as auth from "../auth.js";
import type * as billParsing from "../billParsing.js";
import type * as bills from "../bills.js";
import type * as categories from "../categories.js";
import type * as contacts from "../contacts.js";
import type * as customSubcategories from "../customSubcategories.js";
import type * as horses from "../horses.js";
import type * as http from "../http.js";
import type * as people from "../people.js";
import type * as providers from "../providers.js";
import type * as scheduleEvents from "../scheduleEvents.js";
import type * as seed from "../seed.js";
import type * as uploads from "../uploads.js";
import type * as users from "../users.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  admin: typeof admin;
  auth: typeof auth;
  billParsing: typeof billParsing;
  bills: typeof bills;
  categories: typeof categories;
  contacts: typeof contacts;
  customSubcategories: typeof customSubcategories;
  horses: typeof horses;
  http: typeof http;
  people: typeof people;
  providers: typeof providers;
  scheduleEvents: typeof scheduleEvents;
  seed: typeof seed;
  uploads: typeof uploads;
  users: typeof users;
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
