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
      expectedFields: args.expectedFields
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
