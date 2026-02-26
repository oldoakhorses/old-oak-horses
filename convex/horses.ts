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

export const getInactiveHorses = query({
  args: {},
  handler: async (ctx) => {
    const horses = await ctx.db.query("horses").collect();
    const inactive = horses.filter((horse) => horse.status !== "active" || horse.isSold);
    return inactive.sort((a, b) => b.createdAt - a.createdAt);
  }
});

export const getAllHorses = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("horses").withIndex("by_name").collect();
  }
});

export const getHorseById = query({
  args: { horseId: v.id("horses") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.horseId);
  }
});

export const createHorse = mutation({
  args: {
    name: v.string(),
    yearOfBirth: v.optional(v.number()),
    usefNumber: v.optional(v.string()),
    feiNumber: v.optional(v.string()),
    owner: v.optional(v.string())
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("horses", {
      name: args.name.trim(),
      yearOfBirth: args.yearOfBirth,
      usefNumber: args.usefNumber?.trim() || undefined,
      feiNumber: args.feiNumber?.trim() || undefined,
      owner: args.owner?.trim() || undefined,
      status: "active",
      createdAt: Date.now()
    });
  }
});

export const updateHorseProfile = mutation({
  args: {
    horseId: v.id("horses"),
    name: v.optional(v.string()),
    yearOfBirth: v.optional(v.number()),
    usefNumber: v.optional(v.string()),
    feiNumber: v.optional(v.string()),
    owner: v.optional(v.string())
  },
  handler: async (ctx, args) => {
    const horse = await ctx.db.get(args.horseId);
    if (!horse) {
      throw new Error("Horse not found");
    }

    await ctx.db.patch(args.horseId, {
      name: args.name?.trim(),
      yearOfBirth: args.yearOfBirth,
      usefNumber: args.usefNumber?.trim() || undefined,
      feiNumber: args.feiNumber?.trim() || undefined,
      owner: args.owner?.trim() || undefined
    });

    return args.horseId;
  }
});

export const setHorseStatus = mutation({
  args: {
    horseId: v.id("horses"),
    status: v.union(v.literal("active"), v.literal("inactive")),
    isSold: v.optional(v.boolean())
  },
  handler: async (ctx, args) => {
    const updates: {
      status: "active" | "inactive";
      isSold?: boolean;
      soldDate?: number | undefined;
    } = { status: args.status };

    if (args.isSold) {
      updates.isSold = true;
      updates.soldDate = Date.now();
    }
    if (args.status === "active") {
      updates.isSold = false;
      updates.soldDate = undefined;
    }

    await ctx.db.patch(args.horseId, updates);
    return args.horseId;
  }
});

export const deleteHorse = mutation({
  args: { horseId: v.id("horses") },
  handler: async (ctx, args) => {
    await ctx.db.delete(args.horseId);
    return args.horseId;
  }
});

export const getHorseSpendSummary = query({
  args: { horseId: v.id("horses") },
  handler: async (ctx, args) => {
    const horse = await ctx.db.get(args.horseId);
    if (!horse) return null;

    const bills = await ctx.db.query("bills").collect();
    const categories = await ctx.db.query("categories").collect();
    const categoryById = new Map(categories.map((row) => [String(row._id), row]));

    const byCategory = new Map<string, { slug: string; name: string; spend: number; invoiceCount: number }>();
    const invoiceRows: Array<{
      billId: string;
      categorySlug: string;
      providerSlug: string;
      providerName: string;
      invoiceNumber: string;
      invoiceDate: string | null;
      total: number;
    }> = [];

    const horseNamesToMatch = new Set([horse.name.toLowerCase(), ...horseAliases(horse.name)]);

    for (const bill of bills) {
      if (bill.status === "error" || !bill.extractedData) continue;
      const category = categoryById.get(String(bill.categoryId));
      if (!category) continue;
      const matchedAmount = amountForHorseInBill(horseNamesToMatch, bill);
      if (matchedAmount <= 0) continue;

      const current = byCategory.get(category.slug) ?? { slug: category.slug, name: category.name, spend: 0, invoiceCount: 0 };
      current.spend += matchedAmount;
      current.invoiceCount += 1;
      byCategory.set(category.slug, current);

      const provider =
        bill.providerId ? await ctx.db.get(bill.providerId) : null;
      const extracted = bill.extractedData as Record<string, unknown>;
      invoiceRows.push({
        billId: String(bill._id),
        categorySlug: category.slug,
        providerSlug: provider?.slug ?? slugify(provider?.name ?? bill.customProviderName ?? "invoice"),
        providerName: provider?.name ?? bill.customProviderName ?? "Unknown",
        invoiceNumber: String(extracted.invoice_number ?? bill.fileName),
        invoiceDate: typeof extracted.invoice_date === "string" ? extracted.invoice_date : null,
        total: round2(matchedAmount)
      });
    }

    invoiceRows.sort((a, b) => {
      const aDate = a.invoiceDate ? Date.parse(a.invoiceDate) : 0;
      const bDate = b.invoiceDate ? Date.parse(b.invoiceDate) : 0;
      return bDate - aDate;
    });

    const byCategoryRows = [...byCategory.values()].sort((a, b) => b.spend - a.spend);
    const totalSpend = byCategoryRows.reduce((sum, row) => sum + row.spend, 0);

    return {
      horse,
      totalSpend: round2(totalSpend),
      byCategory: byCategoryRows.map((row) => ({ ...row, spend: round2(row.spend) })),
      recentInvoices: invoiceRows.slice(0, 20)
    };
  }
});

function amountForHorseInBill(horseNamesToMatch: Set<string>, bill: any) {
  let total = 0;

  const assignedHorses = Array.isArray(bill.assignedHorses) ? bill.assignedHorses : [];
  if (assignedHorses.length > 0) {
    for (const row of assignedHorses) {
      const name = String(row.horseName ?? "").toLowerCase();
      if (horseNamesToMatch.has(name) || includesAlias(horseNamesToMatch, name)) {
        total += typeof row.amount === "number" ? row.amount : 0;
      }
    }
    return round2(total);
  }

  const splitLineItems = new Map<number, number>();
  for (const splitRow of Array.isArray(bill.splitLineItems) ? bill.splitLineItems : []) {
    for (const split of splitRow.splits ?? []) {
      const name = String(split.horseName ?? "").toLowerCase();
      if (horseNamesToMatch.has(name) || includesAlias(horseNamesToMatch, name)) {
        splitLineItems.set(splitRow.lineItemIndex, (splitLineItems.get(splitRow.lineItemIndex) ?? 0) + (typeof split.amount === "number" ? split.amount : 0));
      }
    }
  }

  for (const row of Array.isArray(bill.horseAssignments) ? bill.horseAssignments : []) {
    const name = String(row.horseName ?? "").toLowerCase();
    if (!(horseNamesToMatch.has(name) || includesAlias(horseNamesToMatch, name))) continue;
    total += lineItemAmount(bill.extractedData, row.lineItemIndex);
  }
  total += [...splitLineItems.values()].reduce((sum, value) => sum + value, 0);
  if (total > 0) return round2(total);

  const extracted = (bill.extractedData ?? {}) as Record<string, unknown>;
  const lineItems = Array.isArray(extracted.line_items) ? extracted.line_items : [];
  for (const item of lineItems as Array<Record<string, unknown>>) {
    const name = String(item.horse_name ?? item.horseName ?? "").toLowerCase();
    if (!(horseNamesToMatch.has(name) || includesAlias(horseNamesToMatch, name))) continue;
    total += numeric(item.total_usd ?? item.amount_usd ?? item.total);
  }
  return round2(total);
}

function lineItemAmount(extractedData: any, index: number) {
  const extracted = (extractedData ?? {}) as Record<string, unknown>;
  const lineItems = Array.isArray(extracted.line_items) ? extracted.line_items : [];
  const item = lineItems[index] as Record<string, unknown> | undefined;
  if (!item) return 0;
  return numeric(item.total_usd ?? item.amount_usd ?? item.total);
}

function numeric(value: unknown) {
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

function slugify(value: string) {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-");
}

function horseAliases(name: string) {
  const lowered = name.toLowerCase();
  if (lowered.includes("numero valentina")) return ["valentina"];
  if (lowered === "ben") return ["ben 431"];
  if (lowered === "ben 431") return ["ben"];
  return [];
}

function includesAlias(aliases: Set<string>, value: string) {
  if (!value) return false;
  for (const alias of aliases) {
    if (value.includes(alias)) return true;
  }
  return false;
}
