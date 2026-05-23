import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

export const getByDateRange = query({
  args: {
    startDate: v.string(),
    endDate: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("calendarEvents")
      .withIndex("by_date")
      .filter((q) =>
        q.and(
          q.gte(q.field("date"), args.startDate),
          q.lte(q.field("date"), args.endDate)
        )
      )
      .collect();
  },
});

export const create = mutation({
  args: {
    title: v.string(),
    date: v.string(),
    time: v.optional(v.string()),
    allDay: v.optional(v.boolean()),
    createdBy: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("calendarEvents", {
      title: args.title.trim(),
      date: args.date,
      time: args.time,
      allDay: args.allDay || false,
      createdBy: args.createdBy,
      createdAt: Date.now(),
    });
  },
});

export const remove = mutation({
  args: { id: v.id("calendarEvents") },
  handler: async (ctx, args) => {
    await ctx.db.delete(args.id);
  },
});
