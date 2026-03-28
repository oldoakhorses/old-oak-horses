import { v } from "convex/values";
import { query, mutation } from "./_generated/server";

export const getByHorse = query({
  args: { horseId: v.id("horses") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("feedPlans")
      .withIndex("by_horse", (q) => q.eq("horseId", args.horseId))
      .first();
  },
});

export const save = mutation({
  args: {
    horseId: v.id("horses"),
    sections: v.any(),
    changeDescription: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("feedPlans")
      .withIndex("by_horse", (q) => q.eq("horseId", args.horseId))
      .first();

    if (existing) {
      // Save history entry with previous state
      await ctx.db.insert("feedPlanHistory", {
        horseId: args.horseId,
        feedPlanId: existing._id,
        changeDescription: args.changeDescription || "Feed plan updated",
        previousSections: existing.sections,
        changedAt: Date.now(),
      });

      // Update the plan
      await ctx.db.patch(existing._id, {
        sections: args.sections,
        updatedAt: Date.now(),
      });
    } else {
      // Create new plan
      const planId = await ctx.db.insert("feedPlans", {
        horseId: args.horseId,
        sections: args.sections,
        updatedAt: Date.now(),
      });

      // Save initial history entry
      await ctx.db.insert("feedPlanHistory", {
        horseId: args.horseId,
        feedPlanId: planId,
        changeDescription: "Initial feed plan created",
        changedAt: Date.now(),
      });
    }
  },
});

export const getHistory = query({
  args: { horseId: v.id("horses") },
  handler: async (ctx, args) => {
    const history = await ctx.db
      .query("feedPlanHistory")
      .withIndex("by_horse", (q) => q.eq("horseId", args.horseId))
      .collect();
    return history.sort((a, b) => b.changedAt - a.changedAt);
  },
});
