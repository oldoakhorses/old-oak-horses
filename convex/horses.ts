import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

export const getActiveHorses = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db
      .query("horses")
      .withIndex("by_status_name", (q) => q.eq("status", "active"))
      .collect();
  }
});

export const getPastHorses = query({
  args: {},
  handler: async (ctx) => {
    const horses = await ctx.db
      .query("horses")
      .withIndex("by_status", (q) => q.eq("status", "past"))
      .collect();

    return horses.sort((a, b) => (b.leftStableDate ?? "").localeCompare(a.leftStableDate ?? ""));
  }
});

export const getHorseById = query({
  args: { id: v.id("horses") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.id);
  }
});

export const createHorse = mutation({
  args: {
    name: v.string(),
    yearOfBirth: v.optional(v.number()),
    usefNumber: v.optional(v.string()),
    feiNumber: v.optional(v.string())
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("horses", {
      name: args.name.trim(),
      yearOfBirth: args.yearOfBirth,
      usefNumber: args.usefNumber?.trim() || undefined,
      feiNumber: args.feiNumber?.trim() || undefined,
      status: "active",
      createdAt: Date.now()
    });
  }
});

export const updateHorse = mutation({
  args: {
    id: v.id("horses"),
    name: v.optional(v.string()),
    yearOfBirth: v.optional(v.number()),
    usefNumber: v.optional(v.string()),
    feiNumber: v.optional(v.string())
  },
  handler: async (ctx, args) => {
    const horse = await ctx.db.get(args.id);
    if (!horse) {
      throw new Error("Horse not found");
    }

    await ctx.db.patch(args.id, {
      name: args.name?.trim(),
      yearOfBirth: args.yearOfBirth,
      usefNumber: args.usefNumber?.trim() || undefined,
      feiNumber: args.feiNumber?.trim() || undefined
    });

    return args.id;
  }
});

export const markHorseAsPast = mutation({
  args: {
    id: v.id("horses"),
    leftStableDate: v.string()
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, {
      status: "past",
      leftStableDate: args.leftStableDate
    });

    return args.id;
  }
});

export const reactivateHorse = mutation({
  args: { id: v.id("horses") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, {
      status: "active",
      leftStableDate: undefined
    });

    return args.id;
  }
});

export const deleteHorse = mutation({
  args: { id: v.id("horses") },
  handler: async (ctx, args) => {
    await ctx.db.delete(args.id);
    return args.id;
  }
});
