import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { authTables } from "@convex-dev/auth/server";

export default defineSchema({
  ...authTables,

  categories: defineTable({
    name: v.string(),
    slug: v.string(),
    description: v.optional(v.string())
  })
    .index("by_name", ["name"])
    .index("by_slug", ["slug"]),

  providers: defineTable({
    categoryId: v.id("categories"),
    name: v.string(),
    extractionPrompt: v.string(),
    expectedFields: v.array(v.string())
  })
    .index("by_name", ["name"])
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
    errorMessage: v.optional(v.string())
  })
    .index("by_uploadedAt", ["uploadedAt"])
    .index("by_provider", ["providerId"])
    .index("by_category", ["categoryId"])
});
