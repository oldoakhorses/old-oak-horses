import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Id } from "./_generated/dataModel";

/**
 * Named horse groups — a shortcut for "this invoice applies to my barn
 * pony team" and similar repeating multi-horse assignments. Groups are
 * pure tagging; expanding them happens in the frontend at save time
 * (the saved invoice still references individual horse IDs, so all
 * existing cost-per-horse math keeps working).
 */

/** Owner-scoped: returns active groups visible to the caller. */
export const list = query({
  args: { ownerId: v.optional(v.string()) },
  handler: async (ctx, args) => {
    if (args.ownerId) {
      let owner;
      try {
        owner = await ctx.db.get(args.ownerId as Id<"owners">);
      } catch {
        owner = null;
      }
      if (owner) {
        return ctx.db
          .query("horseGroups")
          .withIndex("by_owner", (q) => q.eq("ownerId", owner._id as Id<"owners">))
          .collect()
          .then((rows) => rows.filter((row) => row.isActive !== false));
      }
    }
    const all = await ctx.db.query("horseGroups").collect();
    return all.filter((row) => row.isActive !== false);
  },
});

export const create = mutation({
  args: {
    name: v.string(),
    horseIds: v.array(v.id("horses")),
    ownerId: v.optional(v.id("owners")),
    organizationId: v.optional(v.id("organizations")),
  },
  handler: async (ctx, args) => {
    const name = args.name.trim();
    if (!name) throw new Error("Group name is required");
    const id = await ctx.db.insert("horseGroups", {
      name,
      horseIds: args.horseIds,
      ownerId: args.ownerId,
      organizationId: args.organizationId,
      isActive: true,
      createdAt: Date.now(),
    });
    return id;
  },
});

export const update = mutation({
  args: {
    groupId: v.id("horseGroups"),
    name: v.optional(v.string()),
    horseIds: v.optional(v.array(v.id("horses"))),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db.get(args.groupId);
    if (!existing) throw new Error("Group not found");
    const patch: Record<string, unknown> = {};
    if (args.name !== undefined) {
      const trimmed = args.name.trim();
      if (!trimmed) throw new Error("Group name cannot be empty");
      patch.name = trimmed;
    }
    if (args.horseIds !== undefined) patch.horseIds = args.horseIds;
    await ctx.db.patch(args.groupId, patch);
  },
});

/** Soft delete — keep the row for historical reference but hide it
 *  from pickers. Hard delete is rarely the right thing for a group
 *  that may already be referenced in bills' assignment metadata. */
export const remove = mutation({
  args: { groupId: v.id("horseGroups") },
  handler: async (ctx, args) => {
    const existing = await ctx.db.get(args.groupId);
    if (!existing) return;
    await ctx.db.patch(args.groupId, { isActive: false });
  },
});
