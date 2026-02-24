import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { authTables } from "@convex-dev/auth/server";

export default defineSchema({
  ...authTables,
  users: defineTable({
    name: v.optional(v.string()),
    image: v.optional(v.string()),
    email: v.optional(v.string()),
    emailVerificationTime: v.optional(v.number()),
    phone: v.optional(v.string()),
    phoneVerificationTime: v.optional(v.number()),
    isAnonymous: v.optional(v.boolean()),
    role: v.optional(v.union(v.literal("admin"), v.literal("investor")))
  })
    .index("email", ["email"])
    .index("phone", ["phone"]),

  categories: defineTable({
    name: v.string(),
    slug: v.optional(v.string()),
    description: v.optional(v.string())
  })
    .index("by_name", ["name"])
    .index("by_slug", ["slug"]),

  providers: defineTable({
    categoryId: v.id("categories"),
    name: v.string(),
    slug: v.string(),
    fullName: v.optional(v.string()),
    primaryContactName: v.optional(v.string()),
    primaryContactPhone: v.optional(v.string()),
    address: v.optional(v.string()),
    phone: v.optional(v.string()),
    email: v.optional(v.string()),
    accountNumber: v.optional(v.string()),
    extractionPrompt: v.string(),
    expectedFields: v.array(v.string()),
    createdAt: v.number(),
    updatedAt: v.optional(v.number())
  })
    .index("by_name", ["name"])
    .index("by_slug", ["slug"])
    .index("by_category", ["categoryId"])
    .index("by_category_name", ["categoryId", "name"]),

  bills: defineTable({
    providerId: v.id("providers"),
    categoryId: v.id("categories"),
    fileId: v.id("_storage"),
    fileName: v.string(),
    status: v.union(v.literal("uploading"), v.literal("parsing"), v.literal("done"), v.literal("error")),
    billingPeriod: v.string(),
    uploadedAt: v.number(),
    extractedData: v.optional(v.any()),
    errorMessage: v.optional(v.string()),
    originalPdfUrl: v.optional(v.string())
  })
    .index("by_uploadedAt", ["uploadedAt"])
    .index("by_provider", ["providerId"])
    .index("by_category", ["categoryId"]),

  horses: defineTable({
    name: v.string(),
    yearOfBirth: v.optional(v.number()),
    usefNumber: v.optional(v.string()),
    feiNumber: v.optional(v.string()),
    status: v.union(v.literal("active"), v.literal("past")),
    leftStableDate: v.optional(v.string()),
    createdAt: v.number()
  })
    .index("by_name", ["name"])
    .index("by_status", ["status"])
    .index("by_status_name", ["status", "name"])
    .index("by_status_left_stable", ["status", "leftStableDate"]),

  contacts: defineTable({
    name: v.string(),
    category: v.string(),
    company: v.optional(v.string()),
    phone: v.optional(v.string()),
    email: v.optional(v.string()),
    createdAt: v.number()
  })
    .index("by_name", ["name"])
    .index("by_category", ["category"]),

  scheduleEvents: defineTable({
    type: v.string(),
    horseId: v.id("horses"),
    date: v.string(),
    providerId: v.optional(v.id("contacts")),
    providerName: v.optional(v.string()),
    note: v.optional(v.string()),
    createdAt: v.number()
  })
    .index("by_date", ["date"])
    .index("by_horse", ["horseId"])
    .index("by_type", ["type"])
});
