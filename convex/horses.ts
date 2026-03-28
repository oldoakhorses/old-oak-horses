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
    sex: v.optional(v.union(v.literal("gelding"), v.literal("mare"), v.literal("stallion"))),
    usefNumber: v.optional(v.string()),
    feiNumber: v.optional(v.string()),
    owner: v.optional(v.string())
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("horses", {
      name: args.name.trim(),
      yearOfBirth: args.yearOfBirth,
      sex: args.sex,
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
    sex: v.optional(v.union(v.literal("gelding"), v.literal("mare"), v.literal("stallion"))),
    usefNumber: v.optional(v.string()),
    feiNumber: v.optional(v.string()),
    owner: v.optional(v.string()),
    prizeMoney: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const horse = await ctx.db.get(args.horseId);
    if (!horse) {
      throw new Error("Horse not found");
    }

    await ctx.db.patch(args.horseId, {
      name: args.name?.trim(),
      yearOfBirth: args.yearOfBirth,
      sex: args.sex,
      usefNumber: args.usefNumber?.trim() || undefined,
      feiNumber: args.feiNumber?.trim() || undefined,
      owner: args.owner?.trim() || undefined,
      prizeMoney: args.prizeMoney,
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

export const getInvoicesByHorse = query({
  args: { horseId: v.id("horses") },
  handler: async (ctx, args) => {
    return await collectHorseInvoices(ctx, args.horseId);
  },
});

export const getHorseSpendByCategory = query({
  args: { horseId: v.id("horses") },
  handler: async (ctx, args) => {
    const invoices = await collectHorseInvoices(ctx, args.horseId);
    const totals = new Map<string, { category: string; amount: number }>();
    for (const row of invoices) {
      const current = totals.get(row.category) ?? { category: row.category, amount: 0 };
      current.amount += row.amount;
      totals.set(row.category, current);
    }

    const total = [...totals.values()].reduce((sum, row) => sum + row.amount, 0);
    return [...totals.values()]
      .map((row) => ({
        category: row.category,
        amount: round2(row.amount),
        pct: total > 0 ? (row.amount / total) * 100 : 0,
      }))
      .sort((a, b) => b.amount - a.amount);
  },
});

export const getHorseSpendMeta = query({
  args: { horseId: v.id("horses") },
  handler: async (ctx, args) => {
    const invoices = await collectHorseInvoices(ctx, args.horseId);
    const now = new Date();
    const monthStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
    const prevMonthStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1);

    let thisMonth = 0;
    let lastMonth = 0;
    for (const row of invoices) {
      const parsed = row.date ? Date.parse(row.date) : NaN;
      if (Number.isNaN(parsed)) continue;
      if (parsed >= monthStart) {
        thisMonth += row.amount;
      } else if (parsed >= prevMonthStart && parsed < monthStart) {
        lastMonth += row.amount;
      }
    }

    const totalSpend = invoices.reduce((sum, row) => sum + row.amount, 0);
    return {
      totalSpend: round2(totalSpend),
      thisMonth: round2(thisMonth),
      lastMonth: round2(lastMonth),
      momPct: lastMonth > 0 ? ((thisMonth - lastMonth) / lastMonth) * 100 : 0,
    };
  },
});

export const getHorseRecordCounts = query({
  args: { horseId: v.id("horses") },
  handler: async (ctx, args) => {
    const invoices = await collectHorseInvoices(ctx, args.horseId);
    const countFor = (keys: string[]) => invoices.filter((row) => keys.includes(row.category)).length;
    return {
      veterinary: countFor(["veterinary"]),
      farrier: countFor(["farrier", "bodywork"]),
      health: countFor(["veterinary", "dues-registrations"]),
      registration: countFor(["dues-registrations"]),
    };
  },
});

const RECORD_TYPE_CATEGORIES: Record<string, string[]> = {
  veterinary: ["veterinary"],
  farrier: ["farrier", "bodywork"],
  health: ["veterinary", "dues-registrations"],
  registration: ["dues-registrations"],
};

export const getRecordsByType = query({
  args: { horseId: v.id("horses"), type: v.string() },
  handler: async (ctx, args) => {
    const categorySlugs = RECORD_TYPE_CATEGORIES[args.type] ?? [args.type];
    const invoices = await collectHorseInvoices(ctx, args.horseId);
    return invoices
      .filter((row) => categorySlugs.includes(row.category))
      .map((row) => ({
        ...row,
        uploadedAt: row.uploadedAt,
      }));
  },
});

export const getTotalPrizeMoney = query({
  args: {},
  handler: async (ctx) => {
    const horses = await ctx.db.query("horses").collect();
    let total = 0;
    const byHorse: Array<{ horseId: string; name: string; prizeMoney: number }> = [];
    for (const horse of horses) {
      if (horse.prizeMoney && horse.prizeMoney > 0) {
        total += horse.prizeMoney;
        byHorse.push({ horseId: String(horse._id), name: horse.name, prizeMoney: horse.prizeMoney });
      }
    }
    return { total: round2(total), byHorse };
  },
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

async function collectHorseInvoices(ctx: any, horseId: any) {
  const horse = await ctx.db.get(horseId);
  if (!horse) return [];

  const bills = await ctx.db.query("bills").collect();
  const categories = await ctx.db.query("categories").collect();
  const categoryById = new Map(categories.map((row: any) => [String(row._id), row]));

  const horseNamesToMatch = new Set([horse.name.toLowerCase(), ...horseAliases(horse.name)]);
  const rows: Array<{
    _id: string;
    category: string;
    categoryName: string;
    providerName: string;
    providerSlug: string;
    invoiceNumber: string;
    date: string | null;
    uploadedAt: number;
    amount: number;
    status: "pending" | "approved";
    href: string;
  }> = [];

  for (const bill of bills) {
    if (bill.status === "error" || !bill.extractedData) continue;
    const category = categoryById.get(String(bill.categoryId)) as { slug: string; name: string } | undefined;
    if (!category) continue;
    const amount = amountForHorseInBill(horseNamesToMatch, bill);
    if (amount <= 0) continue;

    const provider = bill.providerId ? await ctx.db.get(bill.providerId) : null;
    const extracted = (bill.extractedData ?? {}) as Record<string, unknown>;
    const invoiceDate = typeof extracted.invoice_date === "string" ? extracted.invoice_date : null;
    const providerName = provider?.name ?? bill.customProviderName ?? "Unknown";
    const providerSlug = provider?.slug ?? slugify(providerName);

    rows.push({
      _id: String(bill._id),
      category: category.slug,
      categoryName: category.name,
      providerName,
      providerSlug,
      invoiceNumber: String(extracted.invoice_number ?? bill.fileName ?? ""),
      date: invoiceDate,
      uploadedAt: bill.uploadedAt,
      amount: round2(amount),
      status: bill.status === "done" && bill.isApproved ? "approved" : "pending",
      href: buildInvoiceHref(category.slug, providerSlug, String(bill._id), bill),
    });
  }

  return rows.sort((a, b) => {
    const aDate = a.date ? Date.parse(a.date) : 0;
    const bDate = b.date ? Date.parse(b.date) : 0;
    if (aDate !== bDate) return bDate - aDate;
    return b.amount - a.amount;
  });
}

function buildInvoiceHref(categorySlug: string, providerSlug: string, billId: string, bill: any) {
  if (categorySlug === "admin") {
    const sub = bill.adminSubcategory ?? "legal";
    return `/admin/${sub}/${providerSlug}/${billId}`;
  }
  if (categorySlug === "dues-registrations") {
    const sub = bill.duesSubcategory ?? "memberships";
    return `/dues-registrations/${sub}/${providerSlug}/${billId}`;
  }
  if (categorySlug === "horse-transport") {
    const sub = bill.horseTransportSubcategory ?? "ground-transport";
    return `/horse-transport/${sub}/${providerSlug}/${billId}`;
  }
  if (categorySlug === "travel") {
    const sub = bill.travelSubcategory ?? "rental-car";
    return `/travel/${sub}/${billId}`;
  }
  if (categorySlug === "housing") {
    const sub = bill.housingSubcategory ?? "rider-housing";
    return `/housing/${sub}/${billId}`;
  }
  if (categorySlug === "marketing") {
    const sub = bill.marketingSubcategory ?? providerSlug;
    return `/marketing/${sub}/${billId}`;
  }
  return `/${categorySlug}/${providerSlug}/${billId}`;
}
