import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

export const list = query({
  handler: async (ctx) => {
    const owners = await ctx.db.query("owners").collect();
    return owners.sort((a, b) => a.name.localeCompare(b.name));
  },
});

export const getById = query({
  args: { ownerId: v.id("owners") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.ownerId);
  },
});

export const getOwnerHorses = query({
  args: { ownerId: v.id("owners") },
  handler: async (ctx, args) => {
    // Source of truth is horseOwnerships (supports multi-owner). Fall back
    // to the legacy horses.ownerId pointer for horses that haven't been
    // backfilled yet so this query stays correct during the migration.
    const ownerships = await ctx.db
      .query("horseOwnerships")
      .withIndex("by_owner", (q) => q.eq("ownerId", args.ownerId))
      .collect();
    const horseIdsFromOwnerships = new Set(ownerships.map((o) => String(o.horseId)));
    const allHorses = await ctx.db.query("horses").collect();
    const result = allHorses.filter(
      (h) => horseIdsFromOwnerships.has(String(h._id)) || h.ownerId === args.ownerId,
    );
    return result.sort((a, b) => a.name.localeCompare(b.name));
  },
});

export const getOwnerSpendSummary = query({
  args: { ownerId: v.id("owners") },
  handler: async (ctx, args) => {
    // Build the set of horses this owner has a stake in (and the effective
    // share % per horse) by reading horseOwnerships, falling back to the
    // legacy horses.ownerId for horses not yet backfilled. Multi-owner
    // horses split each line-item amount by this owner's share so two
    // 50/50 owners each see their half of every expense.
    const ownerships = await ctx.db
      .query("horseOwnerships")
      .withIndex("by_owner", (q) => q.eq("ownerId", args.ownerId))
      .collect();
    const allHorses = await ctx.db.query("horses").collect();

    const ownerShareByHorseId = new Map<string, number>(); // horseId → fraction (0-1)
    for (const o of ownerships) {
      // Pull all co-owners of this horse to compute the equal-split fallback.
      const co = await ctx.db
        .query("horseOwnerships")
        .withIndex("by_horse", (q) => q.eq("horseId", o.horseId))
        .collect();
      const declaredTotal = co.reduce((sum, r) => sum + (typeof r.sharePct === "number" ? r.sharePct : 0), 0);
      const nullCount = co.filter((r) => typeof r.sharePct !== "number").length;
      const equalShare = nullCount > 0 ? Math.max(0, 100 - declaredTotal) / nullCount : 0;
      const pct = typeof o.sharePct === "number" ? o.sharePct : equalShare;
      ownerShareByHorseId.set(String(o.horseId), pct / 100);
    }
    // Legacy-only horses: full share to the legacy owner.
    for (const h of allHorses) {
      if (h.ownerId === args.ownerId && !ownerShareByHorseId.has(String(h._id))) {
        ownerShareByHorseId.set(String(h._id), 1);
      }
    }
    const ownerHorses = allHorses.filter((h) => ownerShareByHorseId.has(String(h._id)));
    if (ownerHorses.length === 0) return { totalSpend: 0, thisMonth: 0, lastMonth: 0, byCategory: [], byHorse: [] };

    const ownerHorseIds = new Set(ownerHorses.map((h) => String(h._id)));
    const ownerHorseNames = new Map(ownerHorses.map((h) => [String(h._id), h.name]));
    const shareFor = (horseId: string) => ownerShareByHorseId.get(horseId) ?? 0;

    const activeHorses = allHorses.filter((h) => h.status === "active" && !h.isSold);
    const activeHorseCount = activeHorses.length;

    const bills = await ctx.db.query("bills").collect();
    const categories = await ctx.db.query("categories").collect();
    const categoryById = new Map(categories.map((c) => [String(c._id), c]));

    const now = new Date();
    const monthStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
    const prevMonthStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1);

    let totalSpend = 0;
    let thisMonth = 0;
    let lastMonth = 0;
    const catTotals = new Map<string, number>();
    const horseTotals = new Map<string, { name: string; amount: number; invoiceCount: number }>();

    for (const bill of bills) {
      if (bill.status !== "done" || !bill.isApproved || !bill.extractedData) continue;

      const assigned = Array.isArray(bill.assignedHorses) ? bill.assignedHorses : [];
      let billAmount = 0;

      if (assigned.length > 0) {
        for (const row of assigned) {
          const horseId = String(row.horseId ?? "");
          if (ownerHorseIds.has(horseId)) {
            const fullAmt = typeof row.amount === "number" ? row.amount : 0;
            const amt = fullAmt * shareFor(horseId);
            billAmount += amt;
            const curr = horseTotals.get(horseId) ?? { name: row.horseName ?? "Unknown", amount: 0, invoiceCount: 0 };
            curr.amount += amt;
            curr.invoiceCount += 1;
            horseTotals.set(horseId, curr);
          }
        }
      } else {
        // Check splitLineItems and horseAssignments
        const splits = Array.isArray(bill.splitLineItems) ? bill.splitLineItems : [];
        for (const s of splits) {
          for (const sp of s.splits ?? []) {
            const horseId = String(sp.horseId ?? "");
            if (ownerHorseIds.has(horseId)) {
              const fullAmt = typeof sp.amount === "number" ? sp.amount : 0;
              const amt = fullAmt * shareFor(horseId);
              billAmount += amt;
              const curr = horseTotals.get(horseId) ?? { name: sp.horseName ?? "Unknown", amount: 0, invoiceCount: 0 };
              curr.amount += amt;
              curr.invoiceCount += 1;
              horseTotals.set(horseId, curr);
            }
          }
        }

        const ha = Array.isArray(bill.horseAssignments) ? bill.horseAssignments : [];
        for (const row of ha) {
          const horseId = String(row.horseId ?? "");
          if (ownerHorseIds.has(horseId)) {
            const extracted = (bill.extractedData ?? {}) as Record<string, unknown>;
            const lineItems = Array.isArray(extracted.line_items) ? extracted.line_items : [];
            const item = lineItems[row.lineItemIndex] as Record<string, unknown> | undefined;
            const fullAmt = item ? numericVal(item.total_usd ?? item.amount_usd ?? item.total) : 0;
            const amt = fullAmt * shareFor(horseId);
            billAmount += amt;
            const curr = horseTotals.get(horseId) ?? { name: row.horseName ?? "Unknown", amount: 0, invoiceCount: 0 };
            curr.amount += amt;
            curr.invoiceCount += 1;
            horseTotals.set(horseId, curr);
          }
        }
      }

      if (billAmount > 0) {
        totalSpend += billAmount;

        const cat = bill.categoryId ? categoryById.get(String(bill.categoryId)) : null;
        const lineItemCats = Array.isArray(bill.lineItemCategories) ? bill.lineItemCategories as string[] : [];
        const catSlug = cat?.slug ?? (lineItemCats.length > 0 ? lineItemCats[0] : "other");
        catTotals.set(catSlug, (catTotals.get(catSlug) ?? 0) + billAmount);

        const uploadedAt = bill.uploadedAt ?? 0;
        if (uploadedAt >= monthStart) thisMonth += billAmount;
        else if (uploadedAt >= prevMonthStart && uploadedAt < monthStart) lastMonth += billAmount;
      }
    }

    const byCategory = [...catTotals.entries()]
      .map(([slug, amount]) => ({ category: slug, amount: round2(amount) }))
      .sort((a, b) => b.amount - a.amount);

    const byHorse = [...horseTotals.entries()]
      .map(([id, data]) => ({ horseId: id, name: data.name, amount: round2(data.amount), invoiceCount: data.invoiceCount }))
      .sort((a, b) => b.amount - a.amount);

    return {
      totalSpend: round2(totalSpend),
      thisMonth: round2(thisMonth),
      lastMonth: round2(lastMonth),
      byCategory,
      byHorse,
    };
  },
});

export const create = mutation({
  args: {
    name: v.string(),
    email: v.optional(v.string()),
    phone: v.optional(v.string()),
    address: v.optional(v.string()),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("owners", {
      name: args.name,
      email: args.email,
      phone: args.phone,
      address: args.address,
      notes: args.notes,
      isActive: true,
      createdAt: Date.now(),
    });
  },
});

export const update = mutation({
  args: {
    ownerId: v.id("owners"),
    name: v.optional(v.string()),
    email: v.optional(v.string()),
    phone: v.optional(v.string()),
    address: v.optional(v.string()),
    notes: v.optional(v.string()),
    usefNumber: v.optional(v.string()),
    feiNumber: v.optional(v.string()),
    contactPerson: v.optional(v.string()),
    ein: v.optional(v.string()),
    vat: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { ownerId, ...fields } = args;
    const patch: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(fields)) {
      // Allow empty string to clear the field
      patch[key] = value === "" ? undefined : value;
    }
    if (Object.keys(patch).length > 0) {
      await ctx.db.patch(ownerId, patch);
    }
  },
});

export const assignHorseToOwner = mutation({
  args: {
    horseId: v.id("horses"),
    ownerId: v.optional(v.id("owners")),
  },
  handler: async (ctx, args) => {
    const owner = args.ownerId ? await ctx.db.get(args.ownerId) : null;
    await ctx.db.patch(args.horseId, {
      ownerId: args.ownerId,
      owner: owner?.name,
    });
  },
});

export const deleteOwner = mutation({
  args: {
    ownerId: v.id("owners"),
    reassignTo: v.optional(v.id("owners")),
  },
  handler: async (ctx, args) => {
    const horses = await ctx.db.query("horses").collect();
    const ownerHorses = horses.filter((h) => h.ownerId === args.ownerId);
    const newOwner = args.reassignTo ? await ctx.db.get(args.reassignTo) : null;

    for (const horse of ownerHorses) {
      await ctx.db.patch(horse._id, {
        ownerId: args.reassignTo,
        owner: newOwner?.name,
      });
    }

    await ctx.db.delete(args.ownerId);
    return { reassigned: ownerHorses.length };
  },
});

/** One-time migration: create owners from horse.owner strings and link them */
export const seedFromHorses = mutation({
  handler: async (ctx) => {
    const horses = await ctx.db.query("horses").collect();
    const existingOwners = await ctx.db.query("owners").collect();
    const ownerByName = new Map(existingOwners.map((o) => [o.name.toLowerCase(), o._id]));

    let created = 0;
    let linked = 0;

    for (const horse of horses) {
      if (!horse.owner || horse.ownerId) continue;
      const key = horse.owner.trim().toLowerCase();
      if (!key) continue;

      let ownerId = ownerByName.get(key);
      if (!ownerId) {
        ownerId = await ctx.db.insert("owners", {
          name: horse.owner.trim(),
          isActive: true,
          createdAt: Date.now(),
        });
        ownerByName.set(key, ownerId);
        created++;
      }

      await ctx.db.patch(horse._id, { ownerId });
      linked++;
    }

    return { created, linked };
  },
});

function numericVal(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

function round2(value: number) {
  return Math.round(value * 100) / 100;
}

/**
 * One-off: ensure every horse has a primary ownerId set. Maps any
 * stale `horse.owner` string to an owner row by case-insensitive name
 * match. Horses with no resolvable owner are left untouched (caller
 * needs to fix them by hand). Idempotent.
 *
 *   npx convex run --prod owners:backfillHorseOwners
 */
export const backfillHorseOwners = mutation({
  args: {},
  handler: async (ctx) => {
    const owners = await ctx.db.query("owners").collect();
    const byNameKey = new Map<string, typeof owners[number]>();
    for (const o of owners) {
      const key = o.name.toLowerCase().replace(/\s*(llc|inc|ltd|corp)\.?\s*$/i, "").trim();
      if (!byNameKey.has(key)) byNameKey.set(key, o);
      // Also index by full name in case the suffix-stripped key collides.
      byNameKey.set(o.name.toLowerCase().trim(), o);
    }

    const horses = await ctx.db.query("horses").collect();
    let assigned = 0;
    let alreadyOwned = 0;
    const orphans: { id: string; name: string; owner?: string }[] = [];

    for (const horse of horses) {
      if (horse.ownerId) {
        alreadyOwned++;
        continue;
      }
      const rawOwner = (horse.owner ?? "").toLowerCase().trim();
      if (!rawOwner) {
        orphans.push({ id: String(horse._id), name: horse.name });
        continue;
      }
      const key = rawOwner.replace(/\s*(llc|inc|ltd|corp)\.?\s*$/i, "").trim();
      const match = byNameKey.get(key) ?? byNameKey.get(rawOwner);
      if (match) {
        await ctx.db.patch(horse._id, { ownerId: match._id });
        assigned++;
      } else {
        orphans.push({ id: String(horse._id), name: horse.name, owner: horse.owner });
      }
    }

    return { assigned, alreadyOwned, orphans };
  },
});

/** Convenience query for status checks during the rollout. */
export const listOrphanedHorses = query({
  args: {},
  handler: async (ctx) => {
    const horses = await ctx.db.query("horses").collect();
    return horses
      .filter((h) => !h.ownerId)
      .map((h) => ({ id: String(h._id), name: h.name, owner: h.owner, status: h.status }));
  },
});
