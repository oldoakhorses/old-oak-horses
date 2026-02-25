import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

export const getAllPeople = query(async (ctx) => {
  const rows = await ctx.db.query("people").withIndex("by_active", (q) => q.eq("isActive", true)).collect();
  return rows.sort((a, b) => {
    if (a.role !== b.role) return a.role.localeCompare(b.role);
    return a.name.localeCompare(b.name);
  });
});

export const getPeopleByRole = query({
  args: { role: v.union(v.literal("rider"), v.literal("groom"), v.literal("freelance"), v.literal("trainer")) },
  handler: async (ctx, args) => {
    const rows = await ctx.db.query("people").withIndex("by_role", (q) => q.eq("role", args.role)).collect();
    return rows.filter((row) => row.isActive).sort((a, b) => a.name.localeCompare(b.name));
  }
});

export const getPersonById = query({
  args: { id: v.id("people") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.id);
  }
});

export const createPerson = mutation({
  args: {
    name: v.string(),
    role: v.union(v.literal("rider"), v.literal("groom"), v.literal("freelance"), v.literal("trainer"))
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("people", {
      name: args.name.trim(),
      role: args.role,
      isActive: true,
      createdAt: Date.now()
    });
  }
});

export const updatePerson = mutation({
  args: {
    id: v.id("people"),
    name: v.optional(v.string()),
    role: v.optional(v.union(v.literal("rider"), v.literal("groom"), v.literal("freelance"), v.literal("trainer")))
  },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.id);
    if (!row) throw new Error("Person not found");
    await ctx.db.patch(args.id, {
      name: args.name?.trim() || row.name,
      role: args.role ?? row.role
    });
    return args.id;
  }
});

export const deactivatePerson = mutation({
  args: { id: v.id("people") },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.id);
    if (!row) throw new Error("Person not found");
    await ctx.db.patch(args.id, { isActive: false });
    return args.id;
  }
});
