import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

export const getProvidersByCategory = query({
  args: { categoryId: v.id("categories") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("providers")
      .withIndex("by_category_name", (q) => q.eq("categoryId", args.categoryId))
      .collect();
  }
});

export const getProviderById = query({
  args: { providerId: v.id("providers") },
  handler: async (ctx, args) => {
    const provider = await ctx.db.get(args.providerId);
    if (!provider) return null;

    const category = await ctx.db.get(provider.categoryId);
    return {
      ...provider,
      category
    };
  }
});

export const getProviderBySlug = query({
  args: {
    categorySlug: v.string(),
    providerSlug: v.string()
  },
  handler: async (ctx, args) => {
    const category = await ctx.db
      .query("categories")
      .withIndex("by_slug", (q) => q.eq("slug", args.categorySlug))
      .first();
    if (!category) return null;

    const providers = await ctx.db
      .query("providers")
      .withIndex("by_category", (q) => q.eq("categoryId", category._id))
      .collect();

    const provider = providers.find((entry) => slugify(entry.name) === args.providerSlug);
    if (!provider) return null;

    return {
      ...provider,
      category
    };
  }
});

export const getProviderByNameInCategory = query({
  args: {
    categoryId: v.id("categories"),
    name: v.string()
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("providers")
      .withIndex("by_category_name", (q) => q.eq("categoryId", args.categoryId).eq("name", args.name))
      .first();
  }
});

export const createProvider = mutation({
  args: {
    categoryId: v.id("categories"),
    name: v.string(),
    extractionPrompt: v.string(),
    expectedFields: v.array(v.string())
  },
  handler: async (ctx, args) => {
    const category = await ctx.db.get(args.categoryId);
    if (!category) {
      throw new Error("Category not found");
    }

    return await ctx.db.insert("providers", {
      categoryId: args.categoryId,
      name: args.name,
      extractionPrompt: args.extractionPrompt,
      expectedFields: args.expectedFields,
      createdAt: Date.now()
    });
  }
});

export const updateProviderPrompt = mutation({
  args: {
    providerId: v.id("providers"),
    extractionPrompt: v.string(),
    expectedFields: v.array(v.string())
  },
  handler: async (ctx, args) => {
    const provider = await ctx.db.get(args.providerId);
    if (!provider) {
      throw new Error("Provider not found");
    }

    await ctx.db.patch(args.providerId, {
      extractionPrompt: args.extractionPrompt,
      expectedFields: args.expectedFields
    });

    return args.providerId;
  }
});

function slugify(value: string) {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-");
}
