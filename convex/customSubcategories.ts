import { v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";

export const getByCategory = query({
  args: { categoryId: v.id("categories") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("customSubcategories")
      .withIndex("by_category", (q) => q.eq("categoryId", args.categoryId))
      .collect();
  }
});

export const createCustomSubcategoryOnUpload = mutation({
  args: {
    categoryId: v.id("categories"),
    name: v.string()
  },
  handler: async (ctx, args) => {
    return await createCustomSubcategoryOnUploadImpl(ctx, args.categoryId, args.name);
  }
});

export const createCustomSubcategoryOnUploadInternal = internalMutation({
  args: {
    categoryId: v.id("categories"),
    name: v.string()
  },
  handler: async (ctx, args) => {
    return await createCustomSubcategoryOnUploadImpl(ctx, args.categoryId, args.name);
  }
});

async function createCustomSubcategoryOnUploadImpl(ctx: any, categoryId: string, name: string) {
  const cleanName = name.trim();
  const baseSlug = slugify(cleanName);

  const existing = await ctx.db
    .query("customSubcategories")
    .withIndex("by_category_slug", (q: any) => q.eq("categoryId", categoryId).eq("slug", baseSlug))
    .first();

  const slug = existing ? `${baseSlug}-${Date.now().toString(36).slice(-4)}` : baseSlug;

  return await ctx.db.insert("customSubcategories", {
    categoryId,
    name: cleanName,
    slug,
    createdAt: Date.now()
  });
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)+/g, "");
}
