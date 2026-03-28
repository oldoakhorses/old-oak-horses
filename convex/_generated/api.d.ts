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
import type * as billing from "../billing.js";
import type * as bills from "../bills.js";
import type * as categories from "../categories.js";
import type * as ccReconcile from "../ccReconcile.js";
import type * as contacts from "../contacts.js";
import type * as customSubcategories from "../customSubcategories.js";
import type * as documents from "../documents.js";
import type * as dropbox from "../dropbox.js";
import type * as dropboxHelpers from "../dropboxHelpers.js";
import type * as feedPlans from "../feedPlans.js";
import type * as horseAliases from "../horseAliases.js";
import type * as horseRecords from "../horseRecords.js";
import type * as horses from "../horses.js";
import type * as http from "../http.js";
import type * as invoiceDetect from "../invoiceDetect.js";
import type * as matchHorse from "../matchHorse.js";
import type * as matchPerson from "../matchPerson.js";
import type * as migrations_migrateNextVisitDate from "../migrations/migrateNextVisitDate.js";
import type * as migrations_migrateProvidersToContacts from "../migrations/migrateProvidersToContacts.js";
import type * as owners from "../owners.js";
import type * as people from "../people.js";
import type * as personAliases from "../personAliases.js";
import type * as providerAliases from "../providerAliases.js";
import type * as providerMatching from "../providerMatching.js";
import type * as providers from "../providers.js";
import type * as reportDetect from "../reportDetect.js";
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
  billing: typeof billing;
  bills: typeof bills;
  categories: typeof categories;
  ccReconcile: typeof ccReconcile;
  contacts: typeof contacts;
  customSubcategories: typeof customSubcategories;
  documents: typeof documents;
  dropbox: typeof dropbox;
  dropboxHelpers: typeof dropboxHelpers;
  feedPlans: typeof feedPlans;
  horseAliases: typeof horseAliases;
  horseRecords: typeof horseRecords;
  horses: typeof horses;
  http: typeof http;
  invoiceDetect: typeof invoiceDetect;
  matchHorse: typeof matchHorse;
  matchPerson: typeof matchPerson;
  "migrations/migrateNextVisitDate": typeof migrations_migrateNextVisitDate;
  "migrations/migrateProvidersToContacts": typeof migrations_migrateProvidersToContacts;
  owners: typeof owners;
  people: typeof people;
  personAliases: typeof personAliases;
  providerAliases: typeof providerAliases;
  providerMatching: typeof providerMatching;
  providers: typeof providers;
  reportDetect: typeof reportDetect;
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
