import { v } from "convex/values";
import { query } from "./_generated/server";

export const getAllCategories = query(async (ctx) => {
  return await ctx.db.query("categories").withIndex("by_name").collect();
});

export const getCategoryById = query({
  args: { categoryId: v.id("categories") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.categoryId);
  }
});
