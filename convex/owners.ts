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
    const allHorses = await ctx.db.query("horses").collect();
    return allHorses
      .filter((h) => h.ownerId === args.ownerId)
      .sort((a, b) => a.name.localeCompare(b.name));
  },
});

export const getOwnerSpendSummary = query({
  args: { ownerId: v.id("owners") },
  handler: async (ctx, args) => {
    const allHorses = await ctx.db.query("horses").collect();
    const ownerHorses = allHorses.filter((h) => h.ownerId === args.ownerId);
    if (ownerHorses.length === 0) return { totalSpend: 0, thisMonth: 0, lastMonth: 0, byCategory: [], byHorse: [] };

    const ownerHorseIds = new Set(ownerHorses.map((h) => String(h._id)));
    const ownerHorseNames = new Map(ownerHorses.map((h) => [String(h._id), h.name]));

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
            const amt = typeof row.amount === "number" ? row.amount : 0;
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
              const amt = typeof sp.amount === "number" ? sp.amount : 0;
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
            const amt = item ? numericVal(item.total_usd ?? item.amount_usd ?? item.total) : 0;
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
  },
  handler: async (ctx, args) => {
    const { ownerId, ...fields } = args;
    const patch: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(fields)) {
      if (value !== undefined) patch[key] = value;
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
