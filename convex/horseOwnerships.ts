import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

/** All ownership rows for a horse, hydrated with owner names. */
export const listForHorse = query({
  args: { horseId: v.id("horses") },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("horseOwnerships")
      .withIndex("by_horse", (q) => q.eq("horseId", args.horseId))
      .collect();
    const ownerIds = rows.map((r) => r.ownerId);
    const owners = await Promise.all(ownerIds.map((id) => ctx.db.get(id)));
    const ownerById = new Map(
      owners.filter((o): o is NonNullable<typeof o> => Boolean(o)).map((o) => [String(o._id), o]),
    );
    // Compute effective share %: explicit sharePct values take their
    // declared share; any null entries split the remainder equally.
    const declaredTotal = rows.reduce((sum, r) => sum + (typeof r.sharePct === "number" ? r.sharePct : 0), 0);
    const nullCount = rows.filter((r) => typeof r.sharePct !== "number").length;
    const remainder = Math.max(0, 100 - declaredTotal);
    const equalShare = nullCount > 0 ? remainder / nullCount : 0;
    return rows.map((r) => {
      const o = ownerById.get(String(r.ownerId));
      const effectiveSharePct = typeof r.sharePct === "number" ? r.sharePct : equalShare;
      return {
        _id: r._id,
        horseId: r.horseId,
        ownerId: r.ownerId,
        ownerName: o?.name ?? "Unknown",
        sharePct: r.sharePct,
        effectiveSharePct,
      };
    });
  },
});

/** All horses owned (in full or part) by a given owner. */
export const listHorsesForOwner = query({
  args: { ownerId: v.id("owners") },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("horseOwnerships")
      .withIndex("by_owner", (q) => q.eq("ownerId", args.ownerId))
      .collect();
    const horseIds = rows.map((r) => r.horseId);
    const horses = await Promise.all(horseIds.map((id) => ctx.db.get(id)));
    return horses
      .filter((h): h is NonNullable<typeof h> => Boolean(h))
      .map((h) => {
        const row = rows.find((r) => String(r.horseId) === String(h._id));
        return { ...h, ownershipId: row?._id, sharePct: row?.sharePct };
      });
  },
});

/** Add (or update) an owner on a horse. sharePct optional; null means
 *  equal-split among co-owners. Idempotent: re-calling with the same
 *  (horseId, ownerId) updates sharePct instead of inserting a duplicate. */
export const addOwner = mutation({
  args: {
    horseId: v.id("horses"),
    ownerId: v.id("owners"),
    sharePct: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("horseOwnerships")
      .withIndex("by_horse_owner", (q) => q.eq("horseId", args.horseId).eq("ownerId", args.ownerId))
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, { sharePct: args.sharePct });
      return existing._id;
    }
    const id = await ctx.db.insert("horseOwnerships", {
      horseId: args.horseId,
      ownerId: args.ownerId,
      sharePct: args.sharePct,
      createdAt: Date.now(),
    });
    // Update the legacy denormalized horses.ownerId to point at the first
    // owner so older queries that haven't been migrated still work.
    const horse = await ctx.db.get(args.horseId);
    if (horse && !horse.ownerId) {
      await ctx.db.patch(args.horseId, { ownerId: args.ownerId });
    }
    return id;
  },
});

export const removeOwner = mutation({
  args: { horseId: v.id("horses"), ownerId: v.id("owners") },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("horseOwnerships")
      .withIndex("by_horse_owner", (q) => q.eq("horseId", args.horseId).eq("ownerId", args.ownerId))
      .first();
    if (existing) await ctx.db.delete(existing._id);
    // Maintain the legacy denormalized pointer if it was this owner.
    const horse = await ctx.db.get(args.horseId);
    if (horse && String(horse.ownerId) === String(args.ownerId)) {
      const remaining = await ctx.db
        .query("horseOwnerships")
        .withIndex("by_horse", (q) => q.eq("horseId", args.horseId))
        .first();
      await ctx.db.patch(args.horseId, { ownerId: remaining?.ownerId ?? undefined });
    }
    return args.horseId;
  },
});

/** One-shot migration: for every horse that has the legacy ownerId set,
 *  insert a horseOwnerships row if one doesn't already exist. Safe to
 *  re-run; only inserts missing rows. */
export const backfillFromLegacy = mutation({
  args: {},
  handler: async (ctx) => {
    const horses = await ctx.db.query("horses").collect();
    let created = 0;
    let skipped = 0;
    for (const horse of horses) {
      if (!horse.ownerId) {
        skipped += 1;
        continue;
      }
      const existing = await ctx.db
        .query("horseOwnerships")
        .withIndex("by_horse_owner", (q) => q.eq("horseId", horse._id).eq("ownerId", horse.ownerId!))
        .first();
      if (existing) {
        skipped += 1;
        continue;
      }
      await ctx.db.insert("horseOwnerships", {
        horseId: horse._id,
        ownerId: horse.ownerId,
        sharePct: undefined,
        createdAt: horse.createdAt ?? Date.now(),
      });
      created += 1;
    }
    return { totalHorses: horses.length, created, skipped };
  },
});

/** List horses that currently have no owner — surfaces backfill gaps. */
export const listOrphanHorses = query({
  args: {},
  handler: async (ctx) => {
    const horses = await ctx.db.query("horses").collect();
    const orphans: typeof horses = [];
    for (const horse of horses) {
      const row = await ctx.db
        .query("horseOwnerships")
        .withIndex("by_horse", (q) => q.eq("horseId", horse._id))
        .first();
      if (!row) orphans.push(horse);
    }
    return orphans;
  },
});
