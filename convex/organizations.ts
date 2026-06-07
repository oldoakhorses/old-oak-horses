import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Id } from "./_generated/dataModel";

/* ---------------------------------------------------------------- helpers */

function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/* ---------------------------------------------------------------- queries */

/** Returns the set of horse _id strings that belong to the given org. Bills,
 *  records, meds, and documents are filtered against this set so a single
 *  org pick cascades across the whole app. */
export const listHorseIdsForOrg = query({
  args: { organizationId: v.id("organizations") },
  handler: async (ctx, args) => {
    const horses = await ctx.db
      .query("horses")
      .withIndex("by_organization", (q) => q.eq("organizationId", args.organizationId))
      .collect();
    return horses.map((h) => String(h._id));
  },
});

/** All orgs (admin view — for management UI). */
export const listAll = query({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("organizations").collect();
    return rows.sort((a, b) => a.name.localeCompare(b.name));
  },
});

/** Orgs the given user has access to. Owner/admin global roles see all. */
export const listForUser = query({
  args: { userId: v.optional(v.id("users")) },
  handler: async (ctx, args) => {
    if (!args.userId) return [];
    const user = await ctx.db.get(args.userId);
    if (!user) return [];

    const all = await ctx.db.query("organizations").collect();
    // Admins/owners see every org.
    if (user.role === "admin" || user.role === "owner") {
      return all.sort((a, b) => a.name.localeCompare(b.name));
    }

    // Members see only orgs they're joined to.
    const memberships = await ctx.db
      .query("userOrganizations")
      .withIndex("by_user", (q) => q.eq("userId", args.userId!))
      .collect();
    const allowed = new Set(memberships.map((m) => String(m.organizationId)));
    return all.filter((o) => allowed.has(String(o._id))).sort((a, b) => a.name.localeCompare(b.name));
  },
});

/** Members of one org. */
export const listMembers = query({
  args: { organizationId: v.id("organizations") },
  handler: async (ctx, args) => {
    const memberships = await ctx.db
      .query("userOrganizations")
      .withIndex("by_org", (q) => q.eq("organizationId", args.organizationId))
      .collect();
    const out: { userId: Id<"users">; name?: string; email?: string; role?: string }[] = [];
    for (const m of memberships) {
      const user = await ctx.db.get(m.userId);
      if (!user) continue;
      out.push({
        userId: m.userId,
        name: user.name,
        email: user.email,
        role: m.role,
      });
    }
    return out;
  },
});

/* --------------------------------------------------------------- mutations */

export const create = mutation({
  args: { name: v.string() },
  handler: async (ctx, args) => {
    const trimmed = args.name.trim();
    if (!trimmed) throw new Error("Name required");
    const slug = slugify(trimmed);
    const existing = await ctx.db
      .query("organizations")
      .withIndex("by_slug", (q) => q.eq("slug", slug))
      .first();
    if (existing) throw new Error("Organization already exists");
    return await ctx.db.insert("organizations", {
      name: trimmed,
      slug,
      isActive: true,
      createdAt: Date.now(),
    });
  },
});

export const addMember = mutation({
  args: {
    organizationId: v.id("organizations"),
    userId: v.id("users"),
    role: v.optional(v.union(v.literal("admin"), v.literal("member"))),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("userOrganizations")
      .withIndex("by_user_org", (q) =>
        q.eq("userId", args.userId).eq("organizationId", args.organizationId),
      )
      .first();
    if (existing) return existing._id;
    return await ctx.db.insert("userOrganizations", {
      userId: args.userId,
      organizationId: args.organizationId,
      role: args.role,
      createdAt: Date.now(),
    });
  },
});

export const removeMember = mutation({
  args: {
    organizationId: v.id("organizations"),
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("userOrganizations")
      .withIndex("by_user_org", (q) =>
        q.eq("userId", args.userId).eq("organizationId", args.organizationId),
      )
      .first();
    if (existing) await ctx.db.delete(existing._id);
  },
});

export const assignHorse = mutation({
  args: {
    horseId: v.id("horses"),
    organizationId: v.id("organizations"),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.horseId, { organizationId: args.organizationId });
  },
});

/* ----------------------------------------------------------------- backfill */

/**
 * One-off: creates the 5 seeded orgs, attaches every existing horse to its
 * owner-string match, and joins every active user to every org. Idempotent.
 *
 *   npx convex run --prod organizations:seedAndBackfill
 */
export const seedAndBackfill = mutation({
  args: {},
  handler: async (ctx) => {
    const ORG_NAMES = [
      "EV Equestrian LLC",
      "Old Oak Group LLC",
      "Old Oak Farm LLC",
      "Limestone Horses LLC",
      "Old Oak Horses LLC",
    ];

    // Map a horse's existing `owner` string to one of the new orgs.
    // Strings have to match either exactly (case-insensitive) or via a
    // contains-test for the LLC-less prefix.
    const OWNER_TO_ORG: Record<string, string> = {
      "ev equestrian": "EV Equestrian LLC",
      "ev equestrian llc": "EV Equestrian LLC",
      "old oak group llc": "Old Oak Group LLC",
      "old oak group": "Old Oak Group LLC",
      "old oak farm llc": "Old Oak Farm LLC",
      "old oak farm": "Old Oak Farm LLC",
      "limestone horses llc": "Limestone Horses LLC",
      "limestone horses": "Limestone Horses LLC",
      "limestone": "Limestone Horses LLC",
      "old oak horses llc": "Old Oak Horses LLC",
      "old oak horses": "Old Oak Horses LLC",
    };

    // 1) Upsert all orgs.
    const orgsByName = new Map<string, Id<"organizations">>();
    for (const name of ORG_NAMES) {
      const slug = slugify(name);
      const existing = await ctx.db
        .query("organizations")
        .withIndex("by_slug", (q) => q.eq("slug", slug))
        .first();
      if (existing) {
        orgsByName.set(name, existing._id);
      } else {
        const id = await ctx.db.insert("organizations", {
          name,
          slug,
          isActive: true,
          createdAt: Date.now(),
        });
        orgsByName.set(name, id);
      }
    }

    // 2) Assign horses to orgs by owner-string match.
    const horses = await ctx.db.query("horses").collect();
    let horsesAssigned = 0;
    let horsesUnassigned = 0;
    const defaultOrgId = orgsByName.get("Old Oak Horses LLC")!;
    for (const horse of horses) {
      if (horse.organizationId) continue; // already assigned
      const ownerKey = (horse.owner ?? "").toLowerCase().trim();
      const targetOrgName = OWNER_TO_ORG[ownerKey];
      const targetId = targetOrgName ? orgsByName.get(targetOrgName) : undefined;
      if (targetId) {
        await ctx.db.patch(horse._id, { organizationId: targetId });
        horsesAssigned++;
      } else {
        // Fall back to a sensible default so no horse is orphaned.
        await ctx.db.patch(horse._id, { organizationId: defaultOrgId });
        horsesUnassigned++;
      }
    }

    // 3) Join every active user to every org (you'll prune via UI later).
    const users = await ctx.db.query("users").collect();
    let membershipsCreated = 0;
    for (const user of users) {
      for (const orgId of orgsByName.values()) {
        const existing = await ctx.db
          .query("userOrganizations")
          .withIndex("by_user_org", (q) =>
            q.eq("userId", user._id).eq("organizationId", orgId),
          )
          .first();
        if (!existing) {
          await ctx.db.insert("userOrganizations", {
            userId: user._id,
            organizationId: orgId,
            createdAt: Date.now(),
          });
          membershipsCreated++;
        }
      }
    }

    return {
      orgsTotal: orgsByName.size,
      horsesAssigned,
      horsesAssignedToDefault: horsesUnassigned,
      membershipsCreated,
    };
  },
});
