import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

/** All users granted access to a horse, hydrated with names + roles. */
export const listForHorse = query({
  args: { horseId: v.id("horses") },
  handler: async (ctx, args) => {
    const grants = await ctx.db
      .query("horseAccess")
      .withIndex("by_horse", (q) => q.eq("horseId", args.horseId))
      .collect();
    const users = await Promise.all(grants.map((g) => ctx.db.get(g.userId)));
    return grants
      .map((g, i) => {
        const u = users[i];
        if (!u) return null;
        return {
          _id: g._id,
          horseId: g.horseId,
          userId: g.userId,
          userName: u.name ?? "Unknown",
          userEmail: u.email ?? null,
          userRole: u.role ?? null,
          grantedBy: g.grantedBy ?? null,
          createdAt: g.createdAt,
        };
      })
      .filter((row): row is NonNullable<typeof row> => row !== null);
  },
});

/** All horses a given user has been granted access to. Used by the team
 *  member profile page and by the /horses list filter for team users. */
export const listSharedForUser = query({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const grants = await ctx.db
      .query("horseAccess")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .collect();
    const horses = await Promise.all(grants.map((g) => ctx.db.get(g.horseId)));
    return horses.filter((h): h is NonNullable<typeof h> => Boolean(h));
  },
});

/** Cheap boolean check: does this user have access to this horse?
 *  Admins and owner-role users always return true; team users require
 *  an explicit grant. */
export const userCanAccessHorse = query({
  args: { userId: v.id("users"), horseId: v.id("horses") },
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId);
    if (!user) return false;
    if (user.role === "admin" || user.role === "owner") return true;
    const grant = await ctx.db
      .query("horseAccess")
      .withIndex("by_horse_user", (q) => q.eq("horseId", args.horseId).eq("userId", args.userId))
      .first();
    return Boolean(grant);
  },
});

/** Admin-grants-access mutation. Idempotent on (horseId, userId). */
export const grant = mutation({
  args: {
    horseId: v.id("horses"),
    userId: v.id("users"),
    grantedBy: v.optional(v.id("users")),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("horseAccess")
      .withIndex("by_horse_user", (q) => q.eq("horseId", args.horseId).eq("userId", args.userId))
      .first();
    if (existing) return existing._id;
    return await ctx.db.insert("horseAccess", {
      horseId: args.horseId,
      userId: args.userId,
      grantedBy: args.grantedBy,
      createdAt: Date.now(),
    });
  },
});

export const revoke = mutation({
  args: { horseId: v.id("horses"), userId: v.id("users") },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("horseAccess")
      .withIndex("by_horse_user", (q) => q.eq("horseId", args.horseId).eq("userId", args.userId))
      .first();
    if (existing) await ctx.db.delete(existing._id);
    return args.horseId;
  },
});

/** Convenience: list team-role users (those eligible to receive grants). */
export const listGrantableUsers = query({
  args: {},
  handler: async (ctx) => {
    const users = await ctx.db.query("users").collect();
    return users
      .filter((u) => u.isActive !== false && u.role === "team")
      .map((u) => ({ _id: u._id, name: u.name ?? "Unknown", email: u.email ?? null }));
  },
});
