import { v } from "convex/values";
import { mutation, query, internalMutation } from "./_generated/server";

export const getByHorse = query({
  args: { horseId: v.id("horses") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("incomeEntries")
      .withIndex("by_horse", (q) => q.eq("horseId", args.horseId))
      .collect();
  },
});

export const getTotalPrizeMoney = query({
  args: {},
  handler: async (ctx) => {
    const entries = await ctx.db.query("incomeEntries").collect();
    const horses = await ctx.db.query("horses").collect();
    const horseMap = new Map(horses.map((h) => [h._id, h.name]));

    let total = 0;
    const byHorseMap = new Map<string, { horseId: string; name: string; prizeMoney: number }>();

    for (const entry of entries) {
      if (entry.type === "prize_money") {
        total += entry.amount;
        const existing = byHorseMap.get(String(entry.horseId));
        if (existing) {
          existing.prizeMoney += entry.amount;
        } else {
          byHorseMap.set(String(entry.horseId), {
            horseId: String(entry.horseId),
            name: horseMap.get(entry.horseId) ?? "Unknown",
            prizeMoney: entry.amount,
          });
        }
      }
    }

    const byHorse = Array.from(byHorseMap.values());
    return { total: round2(total), byHorse };
  },
});

export const getHorsePrizeMoney = query({
  args: { horseId: v.id("horses") },
  handler: async (ctx, args) => {
    const entries = await ctx.db
      .query("incomeEntries")
      .withIndex("by_horse", (q) => q.eq("horseId", args.horseId))
      .collect();

    const prizeEntries = entries.filter((e) => e.type === "prize_money");
    const total = prizeEntries.reduce((sum, e) => sum + e.amount, 0);
    return { total: round2(total), entries: prizeEntries };
  },
});

export const addEntry = mutation({
  args: {
    horseId: v.id("horses"),
    billId: v.optional(v.id("bills")),
    type: v.union(v.literal("prize_money"), v.literal("other")),
    amount: v.number(),
    description: v.string(),
    className: v.optional(v.string()),
    placing: v.optional(v.string()),
    showName: v.optional(v.string()),
    date: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("incomeEntries", {
      ...args,
      createdAt: Date.now(),
    });
  },
});

export const deleteEntry = mutation({
  args: { entryId: v.id("incomeEntries") },
  handler: async (ctx, args) => {
    await ctx.db.delete(args.entryId);
  },
});

export const createFromBill = internalMutation({
  args: {
    billId: v.id("bills"),
    entries: v.array(
      v.object({
        horseId: v.id("horses"),
        amount: v.number(),
        description: v.string(),
        className: v.optional(v.string()),
        placing: v.optional(v.string()),
        showName: v.optional(v.string()),
        date: v.optional(v.string()),
      })
    ),
  },
  handler: async (ctx, args) => {
    // Remove any existing entries for this bill to avoid duplicates
    const existing = await ctx.db
      .query("incomeEntries")
      .withIndex("by_bill", (q) => q.eq("billId", args.billId))
      .collect();
    for (const entry of existing) {
      await ctx.db.delete(entry._id);
    }

    // Create new entries
    for (const entry of args.entries) {
      await ctx.db.insert("incomeEntries", {
        horseId: entry.horseId,
        billId: args.billId,
        type: "prize_money" as const,
        amount: entry.amount,
        description: entry.description,
        className: entry.className,
        placing: entry.placing,
        showName: entry.showName,
        date: entry.date,
        createdAt: Date.now(),
      });
    }
  },
});

function round2(n: number) {
  return Math.round(n * 100) / 100;
}
