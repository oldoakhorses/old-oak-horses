import Anthropic from "@anthropic-ai/sdk";
import { v } from "convex/values";
import { action, internalAction, internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

const TRAVEL_SUBCATEGORY_SLUGS = new Set(["flights", "trains", "rental-car", "gas", "meals", "hotels"]);
const HOUSING_SUBCATEGORY_SLUGS = new Set(["rider-housing", "groom-housing"]);
const STABLING_SUBCATEGORY_SLUGS = new Set(["board", "turnout", "bedding", "hay-feed", "facility-fees", "other"]);

export const generateUploadUrl = mutation(async (ctx) => {
  return await ctx.storage.generateUploadUrl();
});

export const createBillRecord = mutation({
  args: {
    providerId: v.id("providers"),
    categoryId: v.id("categories"),
    fileId: v.id("_storage"),
    fileName: v.string(),
    billingPeriod: v.string(),
    originalPdfUrl: v.optional(v.string())
  },
  handler: async (ctx, args) => {
    const provider = await ctx.db.get(args.providerId);
    if (!provider) throw new Error("Provider not found");
    if (provider.categoryId !== args.categoryId) {
      throw new Error("Provider/category mismatch");
    }

    return await ctx.db.insert("bills", {
      providerId: args.providerId,
      categoryId: args.categoryId,
      fileId: args.fileId,
      fileName: args.fileName,
      status: "uploading",
      billingPeriod: args.billingPeriod,
      uploadedAt: Date.now(),
      originalPdfUrl: args.originalPdfUrl
    });
  }
});

export const createAndParseBill = mutation({
  args: {
    providerId: v.id("providers"),
    categoryId: v.id("categories"),
    fileId: v.id("_storage"),
    fileName: v.string(),
    billingPeriod: v.string(),
    originalPdfUrl: v.optional(v.string())
  },
  handler: async (ctx, args) => {
    const provider = await ctx.db.get(args.providerId);
    if (!provider) throw new Error("Provider not found");
    if (provider.categoryId !== args.categoryId) {
      throw new Error("Provider/category mismatch");
    }

    const billId = await ctx.db.insert("bills", {
      providerId: args.providerId,
      categoryId: args.categoryId,
      fileId: args.fileId,
      fileName: args.fileName,
      status: "parsing",
      billingPeriod: args.billingPeriod,
      uploadedAt: Date.now(),
      originalPdfUrl: args.originalPdfUrl
    });

    await ctx.scheduler.runAfter(0, internal.bills.parseBillPdf, { billId });
    return billId;
  }
});

export const triggerBillParsing = mutation({
  args: { billId: v.id("bills") },
  handler: async (ctx, args) => {
    const bill = await ctx.db.get(args.billId);
    if (!bill) throw new Error("Bill not found");

    await ctx.db.patch(args.billId, { status: "parsing", errorMessage: undefined });
    await ctx.scheduler.runAfter(0, internal.bills.parseBillPdf, { billId: args.billId });
    return { queued: true };
  }
});

export const listAll = query(async (ctx) => {
  const bills = await ctx.db.query("bills").withIndex("by_uploadedAt").order("desc").collect();

  const providerIds = [...new Set(bills.flatMap((bill) => (bill.providerId ? [bill.providerId] : [])))];
  const providerPairs = await Promise.all(providerIds.map(async (id) => [id, await ctx.db.get(id)] as const));
  const providerMap = new Map(providerPairs.map(([id, provider]) => [id, provider?.name ?? "Unknown"]));

  const categoryIds = [...new Set(bills.map((bill) => bill.categoryId))];
  const categoryPairs = await Promise.all(categoryIds.map(async (id) => [id, await ctx.db.get(id)] as const));
  const categoryMap = new Map(categoryPairs.map(([id, category]) => [id, category?.name ?? "Unknown"]));

  return bills.map((bill) => ({
    ...bill,
    providerName: (bill.providerId ? providerMap.get(bill.providerId) : undefined) ?? bill.customProviderName ?? "Unknown",
    categoryName: categoryMap.get(bill.categoryId) ?? "Unknown"
  }));
});

export const getBillsByProvider = query({
  args: {
    providerId: v.id("providers"),
    limit: v.optional(v.number()),
    cursor: v.optional(v.string())
  },
  handler: async (ctx, args) => {
    const bills = await ctx.db.query("bills").withIndex("by_provider", (q) => q.eq("providerId", args.providerId)).collect();
    const doneBills = bills.filter((bill) => bill.status === "done");
    const mapped = doneBills
      .map((bill) => {
        const extracted = (bill.extractedData ?? {}) as {
          line_items?: Array<{ horse_name?: string; total_usd?: number }>;
          invoice_total_usd?: number;
          invoice_number?: string;
          invoice_date?: string;
        };
        const lineItems = Array.isArray(extracted.line_items) ? extracted.line_items : [];
        const horses = [...new Set(lineItems.map((item) => item.horse_name?.trim()).filter((name): name is string => Boolean(name)))];
        const total_usd =
          typeof extracted.invoice_total_usd === "number"
            ? extracted.invoice_total_usd
            : lineItems.reduce((sum, item) => sum + (typeof item.total_usd === "number" ? item.total_usd : 0), 0);

        return {
          ...bill,
          horses,
          total_usd,
          invoice_number: extracted.invoice_number || bill.fileName,
          invoice_date: extracted.invoice_date || null,
          line_item_count: lineItems.length
        };
      })
      .sort((a, b) => {
        const aInvoice = a.invoice_date ? Date.parse(a.invoice_date) : 0;
        const bInvoice = b.invoice_date ? Date.parse(b.invoice_date) : 0;
        if (aInvoice !== bInvoice) return bInvoice - aInvoice;
        return b.uploadedAt - a.uploadedAt;
      });

    if (!args.limit || args.limit <= 0) {
      return mapped;
    }
    const offset = args.cursor ? Number(args.cursor) : 0;
    const start = Number.isFinite(offset) ? Math.max(0, offset) : 0;
    return mapped.slice(start, start + args.limit);
  }
});

export const getBillsByProviderAndDateRange = query({
  args: {
    providerId: v.id("providers"),
    startDate: v.number(),
    endDate: v.number()
  },
  handler: async (ctx, args) => {
    const bills = await ctx.db.query("bills").withIndex("by_provider", (q) => q.eq("providerId", args.providerId)).collect();
    return bills
      .filter((bill) => bill.uploadedAt >= args.startDate && bill.uploadedAt <= args.endDate)
      .sort((a, b) => {
        const aDate = getInvoiceDateSortValue(a);
        const bDate = getInvoiceDateSortValue(b);
        if (aDate !== bDate) return bDate - aDate;
        return b.uploadedAt - a.uploadedAt;
      });
  }
});

export const getBillsByCategory = query({
  args: { categoryId: v.id("categories") },
  handler: async (ctx, args) => {
    const bills = await ctx.db.query("bills").withIndex("by_category", (q) => q.eq("categoryId", args.categoryId)).collect();
    return bills.sort((a, b) => {
      const aDate = getInvoiceDateSortValue(a);
      const bDate = getInvoiceDateSortValue(b);
      if (aDate !== bDate) return bDate - aDate;
      return b.uploadedAt - a.uploadedAt;
    });
  }
});

export const getTravelBills = query({
  args: {
    categoryId: v.id("categories")
  },
  handler: async (ctx, args) => {
    const bills = await ctx.db.query("bills").withIndex("by_category", (q) => q.eq("categoryId", args.categoryId)).collect();
    const rows = await Promise.all(
      bills.map(async (bill) => {
        const provider = bill.providerId ? await ctx.db.get(bill.providerId) : null;
        const assignedPeopleResolved = await Promise.all(
          (bill.assignedPeople ?? []).map(async (row) => {
            const person = await ctx.db.get(row.personId);
            return {
              personId: row.personId,
              amount: row.amount,
              personName: person?.name ?? "Unknown",
              role: person?.role ?? "freelance"
            };
          })
        );
        return {
          ...bill,
          providerName: provider?.name ?? bill.customProviderName ?? "Unknown",
          assignedPeople: bill.assignedPeople ?? [],
          assignedPeopleResolved,
          approvalStatus: bill.status === "done" && bill.isApproved ? "approved" : "pending"
        };
      })
    );
    return rows.sort((a, b) => {
      const aDate = getInvoiceDateSortValue(a);
      const bDate = getInvoiceDateSortValue(b);
      if (aDate !== bDate) return bDate - aDate;
      return b.uploadedAt - a.uploadedAt;
    });
  }
});

export const getTravelSpendBySubcategory = query({
  args: { categoryId: v.id("categories") },
  handler: async (ctx, args) => {
    const bills = await ctx.db.query("bills").withIndex("by_category", (q) => q.eq("categoryId", args.categoryId)).collect();
    const totals = new Map<string, { totalSpend: number; invoiceCount: number }>();

    for (const bill of bills) {
      const subcategory = (bill.travelSubcategory ?? "other").toLowerCase();
      const total = getInvoiceTotalUsdFromAny(bill.extractedData);
      const current = totals.get(subcategory) ?? { totalSpend: 0, invoiceCount: 0 };
      current.totalSpend += total;
      current.invoiceCount += 1;
      totals.set(subcategory, current);
    }

    const grandTotal = [...totals.values()].reduce((sum, row) => sum + row.totalSpend, 0);
    return [...totals.entries()]
      .map(([subcategory, row]) => ({
        subcategory,
        totalSpend: row.totalSpend,
        invoiceCount: row.invoiceCount,
        pctOfTotal: grandTotal > 0 ? (row.totalSpend / grandTotal) * 100 : 0
      }))
      .sort((a, b) => b.totalSpend - a.totalSpend);
  }
});

export const getHousingSpendBySubcategory = query({
  args: { categoryId: v.id("categories") },
  handler: async (ctx, args) => {
    const bills = await ctx.db.query("bills").withIndex("by_category", (q) => q.eq("categoryId", args.categoryId)).collect();
    const totals = new Map<string, { totalSpend: number; invoiceCount: number }>();

    for (const bill of bills) {
      const subcategory = (bill.housingSubcategory ?? "other").toLowerCase();
      const total = getInvoiceTotalUsdFromAny(bill.extractedData);
      const current = totals.get(subcategory) ?? { totalSpend: 0, invoiceCount: 0 };
      current.totalSpend += total;
      current.invoiceCount += 1;
      totals.set(subcategory, current);
    }

    const grandTotal = [...totals.values()].reduce((sum, row) => sum + row.totalSpend, 0);
    return [...totals.entries()]
      .map(([subcategory, row]) => ({
        subcategory,
        totalSpend: row.totalSpend,
        invoiceCount: row.invoiceCount,
        pctOfTotal: grandTotal > 0 ? (row.totalSpend / grandTotal) * 100 : 0
      }))
      .sort((a, b) => b.totalSpend - a.totalSpend);
  }
});

export const getTravelSpendByPerson = query({
  args: { categoryId: v.id("categories") },
  handler: async (ctx, args) => {
    const bills = await ctx.db.query("bills").withIndex("by_category", (q) => q.eq("categoryId", args.categoryId)).collect();
    const totals = new Map<string, { personId: string; totalSpend: number; invoiceCount: number }>();

    for (const bill of bills) {
      const assigned = bill.assignedPeople ?? [];
      for (const row of assigned) {
        const key = row.personId;
        const current = totals.get(key) ?? { personId: key, totalSpend: 0, invoiceCount: 0 };
        current.totalSpend += row.amount;
        current.invoiceCount += 1;
        totals.set(key, current);
      }
    }

    const people = await Promise.all(
      [...totals.values()].map(async (row) => {
        const person = await ctx.db.get(row.personId as any);
        return {
          personId: row.personId,
          person,
          totalSpend: row.totalSpend,
          invoiceCount: row.invoiceCount
        };
      })
    );
    const grandTotal = people.reduce((sum, row) => sum + row.totalSpend, 0);

    return people
      .filter((row) => row.person && "name" in row.person && "role" in row.person)
      .map((row) => ({
        personId: row.person!._id,
        personName: (row.person as any).name as string,
        role: (row.person as any).role as string,
        totalSpend: row.totalSpend,
        invoiceCount: row.invoiceCount,
        pctOfTotal: grandTotal > 0 ? (row.totalSpend / grandTotal) * 100 : 0
      }))
      .sort((a, b) => b.totalSpend - a.totalSpend);
  }
});

export const getHousingSpendByPerson = query({
  args: { categoryId: v.id("categories") },
  handler: async (ctx, args) => {
    return await getPeopleSpend(ctx, args.categoryId);
  }
});

export const getHousingSpendByProvider = query({
  args: { categoryId: v.id("categories") },
  handler: async (ctx, args) => {
    const bills = await ctx.db.query("bills").withIndex("by_category", (q) => q.eq("categoryId", args.categoryId)).collect();
    const totals = new Map<string, { providerName: string; totalSpend: number; invoiceCount: number }>();

    for (const bill of bills) {
      const provider = bill.providerId ? await ctx.db.get(bill.providerId) : null;
      const providerName = provider?.name ?? bill.customProviderName ?? "Unknown";
      const current = totals.get(providerName) ?? { providerName, totalSpend: 0, invoiceCount: 0 };
      current.totalSpend += getInvoiceTotalUsdFromAny(bill.extractedData);
      current.invoiceCount += 1;
      totals.set(providerName, current);
    }

    const grandTotal = [...totals.values()].reduce((sum, row) => sum + row.totalSpend, 0);
    return [...totals.values()]
      .map((row) => ({
        providerName: row.providerName,
        totalSpend: row.totalSpend,
        invoiceCount: row.invoiceCount,
        pctOfTotal: grandTotal > 0 ? (row.totalSpend / grandTotal) * 100 : 0
      }))
      .sort((a, b) => b.totalSpend - a.totalSpend);
  }
});

export const getHousingBills = query({
  args: {
    categoryId: v.id("categories"),
    subcategory: v.optional(v.string())
  },
  handler: async (ctx, args) => {
    const bills = await ctx.db.query("bills").withIndex("by_category", (q) => q.eq("categoryId", args.categoryId)).collect();
    const rows = await Promise.all(
      bills.map(async (bill) => {
        const provider = bill.providerId ? await ctx.db.get(bill.providerId) : null;
        const assignedPeopleResolved = await Promise.all(
          (bill.assignedPeople ?? []).map(async (row) => {
            const person = await ctx.db.get(row.personId);
            return {
              personId: row.personId,
              amount: row.amount,
              personName: person?.name ?? "Unknown",
              role: person?.role ?? "freelance"
            };
          })
        );
        return {
          ...bill,
          providerName: provider?.name ?? bill.customProviderName ?? "Unknown",
          assignedPeopleResolved,
          approvalStatus: bill.status === "done" && bill.isApproved ? "approved" : "pending"
        };
      })
    );

    return rows
      .filter((row) => (args.subcategory ? row.housingSubcategory === args.subcategory : true))
      .sort((a, b) => {
        const aDate = getInvoiceDateSortValue(a);
        const bDate = getInvoiceDateSortValue(b);
        if (aDate !== bDate) return bDate - aDate;
        return b.uploadedAt - a.uploadedAt;
      });
  }
});

export const getHousingStats = query({
  args: {
    categoryId: v.id("categories"),
    subcategory: v.optional(v.string())
  },
  handler: async (ctx, args) => {
    const bills = await ctx.db.query("bills").withIndex("by_category", (q) => q.eq("categoryId", args.categoryId)).collect();
    const filtered = bills.filter((bill) => (args.subcategory ? bill.housingSubcategory === args.subcategory : true));
    const currentYear = new Date().getFullYear();
    const totalSpend = filtered.reduce((sum, row) => sum + getInvoiceTotalUsdFromAny(row.extractedData), 0);
    const ytdInvoices = filtered.filter((row) => {
      const extracted = (row.extractedData ?? {}) as { invoice_date?: unknown };
      return typeof extracted.invoice_date === "string" && extracted.invoice_date.startsWith(String(currentYear));
    });
    return {
      totalSpend,
      totalInvoices: filtered.length,
      ytdSpend: ytdInvoices.reduce((sum, row) => sum + getInvoiceTotalUsdFromAny(row.extractedData), 0),
      ytdInvoices: ytdInvoices.length,
      currentYear
    };
  }
});

export const getStablingBills = query({
  args: {
    categoryId: v.id("categories"),
    providerId: v.optional(v.id("providers"))
  },
  handler: async (ctx, args) => {
    const bills = await ctx.db.query("bills").withIndex("by_category", (q) => q.eq("categoryId", args.categoryId)).collect();
    const filtered = bills.filter((bill) => (args.providerId ? bill.providerId === args.providerId : true));

    const rows = await Promise.all(
      filtered.map(async (bill) => {
        const provider = bill.providerId ? await ctx.db.get(bill.providerId) : null;
        const horseTotals = new Map<string, { horseName: string; amount: number }>();

        for (const row of bill.horseAssignments ?? []) {
          const horseName = row.horseName?.trim();
          if (!horseName) continue;
          const amount = getLineItemTotalUsdByIndex(bill.extractedData, row.lineItemIndex);
          const current = horseTotals.get(horseName) ?? { horseName, amount: 0 };
          current.amount += amount;
          horseTotals.set(horseName, current);
        }
        for (const split of bill.splitLineItems ?? []) {
          for (const splitRow of split.splits) {
            const horseName = splitRow.horseName?.trim();
            if (!horseName) continue;
            const current = horseTotals.get(horseName) ?? { horseName, amount: 0 };
            current.amount += splitRow.amount;
            horseTotals.set(horseName, current);
          }
        }

        return {
          ...bill,
          providerName: provider?.name ?? bill.customProviderName ?? "Unknown",
          provider,
          horses: [...horseTotals.values()],
          approvalStatus: bill.status === "done" && bill.isApproved ? "approved" : "pending"
        };
      })
    );

    return rows.sort((a, b) => {
      const aDate = getInvoiceDateSortValue(a);
      const bDate = getInvoiceDateSortValue(b);
      if (aDate !== bDate) return bDate - aDate;
      return b.uploadedAt - a.uploadedAt;
    });
  }
});

export const getStablingSpendByProvider = query({
  args: { categoryId: v.id("categories") },
  handler: async (ctx, args) => {
    const bills = await ctx.db.query("bills").withIndex("by_category", (q) => q.eq("categoryId", args.categoryId)).collect();
    const totals = new Map<string, { providerId: string; providerName: string; totalSpend: number; invoiceCount: number }>();
    for (const bill of bills) {
      const provider = bill.providerId ? await ctx.db.get(bill.providerId) : null;
      const providerName = provider?.name ?? bill.customProviderName ?? "Unknown";
      const providerId = String(bill.providerId ?? providerName);
      const current = totals.get(providerId) ?? { providerId, providerName, totalSpend: 0, invoiceCount: 0 };
      current.totalSpend += getInvoiceTotalUsdFromAny(bill.extractedData);
      current.invoiceCount += 1;
      totals.set(providerId, current);
    }
    const grandTotal = [...totals.values()].reduce((sum, row) => sum + row.totalSpend, 0);
    return [...totals.values()]
      .map((row) => ({
        providerId: row.providerId,
        providerName: row.providerName,
        totalSpend: row.totalSpend,
        invoiceCount: row.invoiceCount,
        pctOfTotal: grandTotal > 0 ? (row.totalSpend / grandTotal) * 100 : 0
      }))
      .sort((a, b) => b.totalSpend - a.totalSpend);
  }
});

export const getStablingSpendBySubcategory = query({
  args: { categoryId: v.id("categories") },
  handler: async (ctx, args) => {
    const bills = await ctx.db.query("bills").withIndex("by_category", (q) => q.eq("categoryId", args.categoryId)).collect();
    const totals = new Map<string, { totalSpend: number; lineItemCount: number }>();

    for (const bill of bills) {
      const lineItems = getLineItems(bill.extractedData);
      for (let index = 0; index < lineItems.length; index += 1) {
        const item = lineItems[index] as Record<string, unknown>;
        const baseSubcategory = classifyStablingSubcategory(item);
        const split = (bill.splitLineItems ?? []).find((row) => row.lineItemIndex === index);
        if (split && split.splits.length > 0) {
          const totalSplit = split.splits.reduce((sum, row) => sum + row.amount, 0);
          const current = totals.get(baseSubcategory) ?? { totalSpend: 0, lineItemCount: 0 };
          current.totalSpend += totalSplit;
          current.lineItemCount += 1;
          totals.set(baseSubcategory, current);
          continue;
        }
        const amount = typeof item.total_usd === "number" ? (item.total_usd as number) : 0;
        const current = totals.get(baseSubcategory) ?? { totalSpend: 0, lineItemCount: 0 };
        current.totalSpend += amount;
        current.lineItemCount += 1;
        totals.set(baseSubcategory, current);
      }
    }

    const grandTotal = [...totals.values()].reduce((sum, row) => sum + row.totalSpend, 0);
    return [...totals.entries()]
      .map(([subcategory, row]) => ({
        subcategory,
        totalSpend: row.totalSpend,
        lineItemCount: row.lineItemCount,
        pctOfTotal: grandTotal > 0 ? (row.totalSpend / grandTotal) * 100 : 0
      }))
      .sort((a, b) => b.totalSpend - a.totalSpend);
  }
});

export const getStablingSpendByHorse = query({
  args: { categoryId: v.id("categories") },
  handler: async (ctx, args) => {
    const bills = await ctx.db.query("bills").withIndex("by_category", (q) => q.eq("categoryId", args.categoryId)).collect();
    const totals = new Map<string, { horseName: string; totalSpend: number; invoiceIds: Set<string> }>();

    for (const bill of bills) {
      for (const row of bill.horseAssignments ?? []) {
        const horseName = row.horseName?.trim();
        if (!horseName) continue;
        const amount = getLineItemTotalUsdByIndex(bill.extractedData, row.lineItemIndex);
        const current = totals.get(horseName) ?? { horseName, totalSpend: 0, invoiceIds: new Set<string>() };
        current.totalSpend += amount;
        current.invoiceIds.add(String(bill._id));
        totals.set(horseName, current);
      }
      for (const split of bill.splitLineItems ?? []) {
        for (const splitRow of split.splits) {
          const horseName = splitRow.horseName?.trim();
          if (!horseName) continue;
          const current = totals.get(horseName) ?? { horseName, totalSpend: 0, invoiceIds: new Set<string>() };
          current.totalSpend += splitRow.amount;
          current.invoiceIds.add(String(bill._id));
          totals.set(horseName, current);
        }
      }
    }

    const rows = [...totals.values()];
    const grandTotal = rows.reduce((sum, row) => sum + row.totalSpend, 0);
    return rows
      .map((row) => ({
        horseName: row.horseName,
        totalSpend: row.totalSpend,
        invoiceCount: row.invoiceIds.size,
        pctOfTotal: grandTotal > 0 ? (row.totalSpend / grandTotal) * 100 : 0
      }))
      .sort((a, b) => b.totalSpend - a.totalSpend);
  }
});

export const getBizOverview = query({
  args: {
    period: v.union(v.literal("thisMonth"), v.literal("ytd"), v.literal("2024"), v.literal("all"))
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const currentRange = getPeriodRange(args.period, now);
    const previousRange = getPreviousPeriodRange(args.period, currentRange);

    const [bills, categories, people] = await Promise.all([
      ctx.db.query("bills").collect(),
      ctx.db.query("categories").collect(),
      ctx.db.query("people").withIndex("by_active", (q) => q.eq("isActive", true)).collect(),
    ]);
    const categoryById = new Map(categories.map((row) => [String(row._id), row]));
    const peopleById = new Map(people.map((row) => [String(row._id), row]));

    const providerIds = [...new Set(bills.flatMap((bill) => (bill.providerId ? [bill.providerId] : [])))];
    const providerDocs = await Promise.all(providerIds.map((id) => ctx.db.get(id)));
    const providerById = new Map(providerDocs.filter(Boolean).map((row: any) => [String(row._id), row]));

    const currentBills = bills.filter((bill) => inRange(getBillTimestamp(bill), currentRange));
    const previousBills = bills.filter((bill) => inRange(getBillTimestamp(bill), previousRange));

    const totalSpend = sumInvoiceTotals(currentBills);
    const previousPeriodSpend = sumInvoiceTotals(previousBills);
    const invoiceCount = currentBills.length;
    const categoryCount = new Set(
      currentBills.map((bill) => categoryById.get(String(bill.categoryId))?.slug ?? "unknown")
    ).size;

    const categoriesRows = categories
      .map((category) => {
        const current = currentBills.filter((bill) => String(bill.categoryId) === String(category._id));
        const previous = previousBills.filter((bill) => String(bill.categoryId) === String(category._id));
        return {
          name: category.name,
          slug: category.slug,
          color: getCategoryColor(category.slug),
          spend: sumInvoiceTotals(current),
          previousSpend: sumInvoiceTotals(previous),
          invoiceCount: current.length
        };
      })
      .filter((row) => row.spend > 0 || row.invoiceCount > 0)
      .sort((a, b) => b.spend - a.spend);

    const horseMap = new Map<string, { name: string; totalSpend: number; breakdown: Record<string, number>; invoiceIds: Set<string> }>();
    for (const bill of currentBills) {
      const categorySlug = categoryById.get(String(bill.categoryId))?.slug ?? "unknown";
      const horseRows = getHorseSpendRowsFromBill(bill, categorySlug);
      for (const row of horseRows) {
        const key = row.horseName.toLowerCase();
        const current = horseMap.get(key) ?? {
          name: row.horseName,
          totalSpend: 0,
          breakdown: { veterinary: 0, farrier: 0, stabling: 0, other: 0 },
          invoiceIds: new Set<string>()
        };
        current.totalSpend += row.amount;
        const bucket =
          categorySlug === "veterinary"
            ? "veterinary"
            : categorySlug === "farrier"
              ? "farrier"
              : categorySlug === "stabling"
                ? "stabling"
                : "other";
        current.breakdown[bucket] += row.amount;
        current.invoiceIds.add(String(bill._id));
        horseMap.set(key, current);
      }
    }
    const horseTotal = [...horseMap.values()].reduce((sum, row) => sum + row.totalSpend, 0);
    const horses = [...horseMap.values()]
      .map((row) => ({
        name: row.name,
        totalSpend: row.totalSpend,
        pctOfTotal: horseTotal > 0 ? (row.totalSpend / horseTotal) * 100 : 0,
        invoiceCount: row.invoiceIds.size,
        breakdown: row.breakdown
      }))
      .sort((a, b) => b.totalSpend - a.totalSpend);

    const peopleMap = new Map<string, { personId: string; name: string; role: string; totalSpend: number; breakdown: { travel: number; housing: number }; invoiceIds: Set<string> }>();
    for (const bill of currentBills) {
      const categorySlug = categoryById.get(String(bill.categoryId))?.slug ?? "unknown";
      if (categorySlug !== "travel" && categorySlug !== "housing") continue;
      for (const row of bill.assignedPeople ?? []) {
        const person = peopleById.get(String(row.personId));
        const key = String(row.personId);
        const current = peopleMap.get(key) ?? {
          personId: key,
          name: person?.name ?? "Unknown",
          role: person?.role ?? "freelance",
          totalSpend: 0,
          breakdown: { travel: 0, housing: 0 },
          invoiceIds: new Set<string>()
        };
        current.totalSpend += row.amount;
        if (categorySlug === "travel") current.breakdown.travel += row.amount;
        if (categorySlug === "housing") current.breakdown.housing += row.amount;
        current.invoiceIds.add(String(bill._id));
        peopleMap.set(key, current);
      }
    }
    const peopleTotal = [...peopleMap.values()].reduce((sum, row) => sum + row.totalSpend, 0);
    const peopleRows = [...peopleMap.values()]
      .map((row) => ({
        personId: row.personId,
        name: row.name,
        role: row.role as "rider" | "groom" | "freelance" | "trainer",
        totalSpend: row.totalSpend,
        pctOfTotal: peopleTotal > 0 ? (row.totalSpend / peopleTotal) * 100 : 0,
        invoiceCount: row.invoiceIds.size,
        breakdown: row.breakdown
      }))
      .sort((a, b) => b.totalSpend - a.totalSpend);

    const recentInvoices = currentBills
      .map((bill) => {
        const category = categoryById.get(String(bill.categoryId));
        const categorySlug = category?.slug ?? "unknown";
        const provider = bill.providerId ? providerById.get(String(bill.providerId)) : null;
        const providerName = provider?.name ?? bill.customProviderName ?? "Unknown";
        const providerSlug =
          categorySlug === "travel"
            ? bill.travelSubcategory ?? slugify(providerName)
            : categorySlug === "housing"
              ? bill.housingSubcategory ?? slugify(providerName)
              : provider?.slug ?? slugify(providerName);
        const extracted = (bill.extractedData ?? {}) as Record<string, unknown>;
        const invoiceNumber =
          typeof extracted.invoice_number === "string" && extracted.invoice_number.trim().length > 0
            ? extracted.invoice_number
            : bill.fileName;
        const date =
          typeof extracted.invoice_date === "string" && extracted.invoice_date.trim().length > 0
            ? extracted.invoice_date
            : new Date(bill.uploadedAt).toISOString().slice(0, 10);
        const entities = getInvoiceEntities(bill, categorySlug, peopleById);

        return {
          _id: bill._id,
          invoiceNumber,
          category: category?.name ?? "Unknown",
          categoryColor: getCategoryColor(categorySlug),
          provider: providerName,
          date,
          entities: entities.names,
          entityType: entities.type,
          status: (bill.status === "done" && bill.isApproved) || categorySlug === "veterinary" ? "done" : "pending",
          total: getInvoiceTotalUsdFromAny(bill.extractedData),
          categorySlug,
          providerSlug
        };
      })
      .sort((a, b) => {
        const aTs = Date.parse(a.date);
        const bTs = Date.parse(b.date);
        if (Number.isFinite(aTs) && Number.isFinite(bTs) && aTs !== bTs) return bTs - aTs;
        return 0;
      });

    return {
      totalSpend,
      previousPeriodSpend,
      invoiceCount,
      categoryCount,
      categories: categoriesRows,
      horses,
      people: peopleRows,
      recentInvoices
    };
  }
});

export const getBillsByDateRange = query({
  args: {
    categoryId: v.id("categories"),
    startDate: v.number(),
    endDate: v.number()
  },
  handler: async (ctx, args) => {
    const bills = await ctx.db.query("bills").withIndex("by_category", (q) => q.eq("categoryId", args.categoryId)).collect();
    return bills
      .filter((bill) => bill.uploadedAt >= args.startDate && bill.uploadedAt <= args.endDate)
      .sort((a, b) => {
        const aDate = getInvoiceDateSortValue(a);
        const bDate = getInvoiceDateSortValue(b);
        if (aDate !== bDate) return bDate - aDate;
        return b.uploadedAt - a.uploadedAt;
      });
  }
});

export const getBillById = query({
  args: { billId: v.id("bills") },
  handler: async (ctx, args) => {
    const bill = await ctx.db.get(args.billId);
    if (!bill) return null;
    const provider = bill.providerId ? await ctx.db.get(bill.providerId) : null;
    const category = await ctx.db.get(bill.categoryId);
    return {
      ...bill,
      provider,
      category
    };
  }
});

export const getProviderStats = query({
  args: { providerId: v.id("providers") },
  handler: async (ctx, args) => {
    const bills = await ctx.db
      .query("bills")
      .withIndex("by_provider", (q) => q.eq("providerId", args.providerId))
      .filter((q) => q.eq(q.field("status"), "done"))
      .collect();

    const currentYear = new Date().getFullYear();
    const totalSpend = bills.reduce((sum, bill) => sum + getInvoiceTotalUsdFromAny(bill.extractedData), 0);
    const ytdBills = bills.filter((bill) => {
      const extracted = (bill.extractedData ?? {}) as { invoice_date?: unknown };
      return typeof extracted.invoice_date === "string" && extracted.invoice_date.startsWith(String(currentYear));
    });
    const ytdSpend = ytdBills.reduce((sum, bill) => sum + getInvoiceTotalUsdFromAny(bill.extractedData), 0);

    return {
      totalSpend,
      totalInvoices: bills.length,
      ytdSpend,
      ytdInvoices: ytdBills.length,
      currentYear
    };
  }
});

export const parseBillPdf = internalAction({
  args: { billId: v.id("bills") },
  handler: async (ctx, args) => {
    const bill = await ctx.runQuery(internal.bills.getBill, { billId: args.billId });
    if (!bill) throw new Error("Bill not found");

    const provider = bill.providerId ? await ctx.runQuery(internal.bills.getProvider, { providerId: bill.providerId }) : null;
    const category = await ctx.runQuery(internal.bills.getCategory, { categoryId: bill.categoryId });
    if (!category) throw new Error("Category not found");

    try {
      const blob = await ctx.storage.get(bill.fileId);
      if (!blob) throw new Error("PDF file not found in storage");

      const bytes = await blob.arrayBuffer();
      const base64Pdf = Buffer.from(bytes).toString("base64");

      const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
      const extractionPrompt = provider?.extractionPrompt || genericExtractionPrompt(category.slug);
      const prompt = `${extractionPrompt}\n\nReturn strict JSON.`;

      const response = await client.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: 1200,
        temperature: 0,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "document",
                source: {
                  type: "base64",
                  media_type: "application/pdf",
                  data: base64Pdf
                }
              },
              { type: "text", text: prompt }
            ]
          }
        ]
      });

      const textBlock = response.content.find((c) => c.type === "text");
      if (!textBlock || textBlock.type !== "text") {
        throw new Error("Claude response had no text payload");
      }

      const parsed = JSON.parse(stripCodeFences(textBlock.text)) as Record<string, unknown>;

      const expectedFields = provider?.expectedFields ?? [];
      const missingFields = expectedFields.filter((field: string) => {
        if (field === "horse_name") {
          return !hasHorseNameInLineItems(parsed);
        }
        const value = parsed[field];
        return value === undefined || value === null || value === "";
      });

      if (missingFields.length > 0) {
        throw new Error(`Missing expected parsed fields: ${missingFields.join(", ")}`);
      }

      const needsApproval = category.slug === "travel" || category.slug === "housing" || category.slug === "stabling";
      const status = needsApproval ? "pending" : "done";
      const categoryMeta =
        category.slug === "travel"
          ? extractTravelMeta(parsed, provider?.slug ?? provider?.name)
          : category.slug === "housing"
            ? extractHousingMeta(parsed, provider?.slug ?? provider?.name)
            : category.slug === "stabling"
              ? extractStablingMeta(parsed)
            : {};

      await ctx.runMutation(internal.bills.markDone, {
        billId: bill._id,
        extractedData: parsed,
        status,
        ...categoryMeta
      });

      const providerContactPatch = extractProviderContactInfo(parsed);
      if (provider && !provider.fullName && Object.values(providerContactPatch).some((value) => value !== undefined)) {
        await ctx.runMutation(internal.bills.updateProviderContactInfo, {
          providerId: provider._id,
          fullName: provider.fullName ?? providerContactPatch.fullName,
          primaryContactName: provider.primaryContactName ?? providerContactPatch.primaryContactName,
          primaryContactPhone: provider.primaryContactPhone ?? providerContactPatch.primaryContactPhone,
          address: provider.address ?? providerContactPatch.address,
          phone: provider.phone ?? providerContactPatch.phone,
          email: provider.email ?? providerContactPatch.email,
          accountNumber: provider.accountNumber ?? providerContactPatch.accountNumber
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown parse error";
      await ctx.runMutation(internal.bills.markError, { billId: bill._id, errorMessage: message });
      throw error;
    }
  }
});

export const getBill = internalQuery({
  args: { billId: v.id("bills") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.billId);
  }
});

export const getProvider = internalQuery({
  args: { providerId: v.id("providers") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.providerId);
  }
});

export const getCategory = internalQuery({
  args: { categoryId: v.id("categories") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.categoryId);
  }
});

export const getBillFileNamesByProvider = internalQuery({
  args: { providerId: v.id("providers") },
  handler: async (ctx, args) => {
    const bills = await ctx.db.query("bills").withIndex("by_provider", (q) => q.eq("providerId", args.providerId)).collect();
    return bills.map((bill) => bill.fileName);
  }
});

export const createParsingBill = internalMutation({
  args: {
    providerId: v.optional(v.id("providers")),
    categoryId: v.id("categories"),
    fileId: v.id("_storage"),
    fileName: v.string(),
    billingPeriod: v.string(),
    uploadedAt: v.number(),
    customProviderName: v.optional(v.string()),
    originalPdfUrl: v.optional(v.string()),
    travelSubcategory: v.optional(v.string()),
    housingSubcategory: v.optional(v.string())
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("bills", {
      providerId: args.providerId,
      categoryId: args.categoryId,
      fileId: args.fileId,
      fileName: args.fileName,
      status: "parsing",
      billingPeriod: args.billingPeriod,
      uploadedAt: args.uploadedAt,
      customProviderName: args.customProviderName,
      originalPdfUrl: args.originalPdfUrl,
      travelSubcategory: args.travelSubcategory,
      housingSubcategory: args.housingSubcategory
    });
  }
});

export const updateProviderContactInfo = internalMutation({
  args: {
    providerId: v.id("providers"),
    fullName: v.optional(v.string()),
    primaryContactName: v.optional(v.string()),
    primaryContactPhone: v.optional(v.string()),
    address: v.optional(v.string()),
    phone: v.optional(v.string()),
    email: v.optional(v.string()),
    accountNumber: v.optional(v.string())
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.providerId, {
      fullName: args.fullName,
      primaryContactName: args.primaryContactName,
      primaryContactPhone: args.primaryContactPhone,
      address: args.address,
      phone: args.phone,
      email: args.email,
      accountNumber: args.accountNumber,
      updatedAt: Date.now()
    });
  }
});

export const markDone = internalMutation({
  args: {
    billId: v.id("bills"),
    extractedData: v.any(),
    status: v.union(v.literal("pending"), v.literal("done")),
    travelSubcategory: v.optional(v.string()),
    housingSubcategory: v.optional(v.string()),
    horseAssignments: v.optional(
      v.array(
        v.object({
          lineItemIndex: v.number(),
          horseId: v.optional(v.id("horses")),
          horseName: v.optional(v.string())
        })
      )
    ),
    splitLineItems: v.optional(
      v.array(
        v.object({
          lineItemIndex: v.number(),
          splits: v.array(
            v.object({
              horseId: v.id("horses"),
              horseName: v.string(),
              amount: v.number()
            })
          )
        })
      )
    ),
    originalCurrency: v.optional(v.string()),
    originalTotal: v.optional(v.number()),
    exchangeRate: v.optional(v.number()),
    isApproved: v.optional(v.boolean())
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.billId, {
      status: args.status,
      errorMessage: undefined,
      extractedData: args.extractedData,
      travelSubcategory: args.travelSubcategory,
      housingSubcategory: args.housingSubcategory,
      horseAssignments: args.horseAssignments,
      splitLineItems: args.splitLineItems,
      originalCurrency: args.originalCurrency,
      originalTotal: args.originalTotal,
      exchangeRate: args.exchangeRate,
      isApproved: args.isApproved
    });
  }
});

export const markError = internalMutation({
  args: { billId: v.id("bills"), errorMessage: v.string() },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.billId, {
      status: "error",
      errorMessage: args.errorMessage
    });
  }
});

export const parseBillNow = action({
  args: { billId: v.id("bills") },
  handler: async (ctx, args) => {
    await ctx.runAction(internal.bills.parseBillPdf, { billId: args.billId });
  }
});

export const savePersonAssignment = mutation({
  args: {
    billId: v.id("bills"),
    isSplit: v.boolean(),
    assignedPeople: v.array(
      v.object({
        personId: v.id("people"),
        amount: v.number()
      })
    )
  },
  handler: async (ctx, args) => {
    const bill = await ctx.db.get(args.billId);
    if (!bill) throw new Error("Bill not found");
    await ctx.db.patch(args.billId, {
      isSplit: args.isSplit,
      assignedPeople: args.assignedPeople
    });
    return args.billId;
  }
});

export const saveHorseAssignment = mutation({
  args: {
    billId: v.id("bills"),
    horseAssignments: v.array(
      v.object({
        lineItemIndex: v.number(),
        horseId: v.optional(v.id("horses")),
        horseName: v.optional(v.string())
      })
    ),
    splitLineItems: v.array(
      v.object({
        lineItemIndex: v.number(),
        splits: v.array(
          v.object({
            horseId: v.id("horses"),
            horseName: v.string(),
            amount: v.number()
          })
        )
      })
    )
  },
  handler: async (ctx, args) => {
    const bill = await ctx.db.get(args.billId);
    if (!bill) throw new Error("Bill not found");
    await ctx.db.patch(args.billId, {
      horseAssignments: args.horseAssignments,
      splitLineItems: args.splitLineItems
    });
    return args.billId;
  }
});

export const saveTravelAssignment = mutation({
  args: {
    billId: v.id("bills"),
    isSplit: v.boolean(),
    assignedPeople: v.array(
      v.object({
        personId: v.id("people"),
        amount: v.number()
      })
    )
  },
  handler: async (ctx, args) => {
    const bill = await ctx.db.get(args.billId);
    if (!bill) throw new Error("Bill not found");
    await ctx.db.patch(args.billId, {
      isSplit: args.isSplit,
      assignedPeople: args.assignedPeople
    });
    return args.billId;
  }
});

export const approveInvoice = mutation({
  args: { billId: v.id("bills") },
  handler: async (ctx, args) => {
    const bill = await ctx.db.get(args.billId);
    if (!bill) throw new Error("Bill not found");
    await ctx.db.patch(args.billId, {
      isApproved: true,
      approvedAt: Date.now(),
      status: "done"
    });
    return args.billId;
  }
});

export const deleteBill = mutation({
  args: { billId: v.id("bills") },
  handler: async (ctx, args) => {
    const bill = await ctx.db.get(args.billId);
    if (!bill) return { deleted: false };
    if (bill.fileId) {
      await ctx.storage.delete(bill.fileId);
    }
    await ctx.db.delete(args.billId);
    return { deleted: true };
  }
});

function stripCodeFences(text: string) {
  const trimmed = text.trim();
  if (trimmed.startsWith("```") && trimmed.endsWith("```")) {
    return trimmed.replace(/^```[a-zA-Z]*\n?/, "").replace(/```$/, "").trim();
  }
  return trimmed;
}

function hasHorseNameInLineItems(parsed: Record<string, unknown>) {
  const lineItemsValue = parsed.line_items ?? parsed.lineItems;
  if (!Array.isArray(lineItemsValue)) {
    return false;
  }

  return lineItemsValue.some((item) => {
    if (!item || typeof item !== "object") {
      return false;
    }
    const horseName = (item as Record<string, unknown>).horse_name;
    return typeof horseName === "string" && horseName.trim().length > 0;
  });
}

function getInvoiceDateSortValue(bill: { extractedData?: unknown; uploadedAt: number }) {
  const extracted = bill.extractedData as { invoice_date?: unknown } | undefined;
  if (typeof extracted?.invoice_date === "string") {
    const parsed = Date.parse(extracted.invoice_date);
    if (Number.isFinite(parsed)) return parsed;
  }
  return bill.uploadedAt;
}

function getInvoiceTotalUsdFromAny(extractedData: unknown) {
  if (!extractedData || typeof extractedData !== "object") return 0;
  const extracted = extractedData as { invoice_total_usd?: unknown; line_items?: unknown };
  if (typeof extracted.invoice_total_usd === "number" && Number.isFinite(extracted.invoice_total_usd)) {
    return extracted.invoice_total_usd;
  }
  if (!Array.isArray(extracted.line_items)) return 0;
  return extracted.line_items.reduce((sum, item) => {
    if (!item || typeof item !== "object") return sum;
    const total = (item as { total_usd?: unknown }).total_usd;
    if (typeof total === "number" && Number.isFinite(total)) {
      return sum + total;
    }
    return sum;
  }, 0);
}

function extractProviderContactInfo(parsed: Record<string, unknown>) {
  const fullNameCandidates = ["provider_full_name", "provider_name", "clinic_name", "client_name"];
  const primaryContactNameCandidates = ["primary_contact_name", "contact_name", "provider_contact_name"];
  const primaryContactPhoneCandidates = ["primary_contact_phone", "contact_phone"];
  const addressCandidates = ["provider_address", "address"];
  const phoneCandidates = ["provider_phone", "phone"];
  const emailCandidates = ["provider_email", "email"];
  const accountCandidates = ["account_number", "account"];

  return {
    fullName: pickString(parsed, fullNameCandidates),
    primaryContactName: pickString(parsed, primaryContactNameCandidates),
    primaryContactPhone: pickString(parsed, primaryContactPhoneCandidates),
    address: pickString(parsed, addressCandidates),
    phone: pickString(parsed, phoneCandidates),
    email: pickString(parsed, emailCandidates),
    accountNumber: pickString(parsed, accountCandidates)
  };
}

function pickString(source: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
  return undefined;
}

function extractTravelMeta(parsed: Record<string, unknown>, providerSlugOrName: string | undefined) {
  const originalCurrency = pickString(parsed, ["original_currency", "currency"])?.toUpperCase();
  const originalTotal = pickNumber(parsed, ["original_total", "invoice_total_original"]);
  const exchangeRate = pickNumber(parsed, ["exchange_rate", "exchange_rate_used"]);
  const providerSubcategory = slugify(providerSlugOrName ?? "");
  const parsedSubcategory = slugify(pickString(parsed, ["travel_subcategory", "subcategory"]) ?? "");
  const travelSubcategory = TRAVEL_SUBCATEGORY_SLUGS.has(parsedSubcategory)
    ? parsedSubcategory
    : TRAVEL_SUBCATEGORY_SLUGS.has(providerSubcategory)
      ? providerSubcategory
      : "travel";

  return {
    travelSubcategory,
    originalCurrency,
    originalTotal,
    exchangeRate,
    isApproved: false
  };
}

function extractHousingMeta(parsed: Record<string, unknown>, providerSlugOrName: string | undefined) {
  const originalCurrency = pickString(parsed, ["original_currency", "currency"])?.toUpperCase();
  const originalTotal = pickNumber(parsed, ["original_total", "invoice_total_original"]);
  const exchangeRate = pickNumber(parsed, ["exchange_rate", "exchange_rate_used"]);
  const providerSubcategory = slugify(providerSlugOrName ?? "");
  const parsedSubcategory = slugify(pickString(parsed, ["housing_subcategory", "subcategory"]) ?? "");
  const housingSubcategory = HOUSING_SUBCATEGORY_SLUGS.has(parsedSubcategory)
    ? parsedSubcategory
    : HOUSING_SUBCATEGORY_SLUGS.has(providerSubcategory)
      ? providerSubcategory
      : "housing";

  return {
    housingSubcategory,
    originalCurrency,
    originalTotal,
    exchangeRate,
    isApproved: false
  };
}

function extractStablingMeta(parsed: Record<string, unknown>) {
  const originalCurrency = pickString(parsed, ["original_currency", "currency"])?.toUpperCase();
  const originalTotal = pickNumber(parsed, ["original_total", "invoice_total_original"]);
  const exchangeRate = pickNumber(parsed, ["exchange_rate", "exchange_rate_used"]);
  const lineItems = getLineItems(parsed);
  const horseAssignments = lineItems.map((item, index) => {
    const row = item as Record<string, unknown>;
    const horseName = pickString(row, ["horse_name", "horseName"]);
    return {
      lineItemIndex: index,
      horseName,
      horseId: undefined
    };
  });

  return {
    horseAssignments,
    splitLineItems: [] as any[],
    originalCurrency,
    originalTotal,
    exchangeRate,
    isApproved: false
  };
}

async function getPeopleSpend(ctx: any, categoryId: string) {
  const bills = await ctx.db.query("bills").withIndex("by_category", (q: any) => q.eq("categoryId", categoryId)).collect();
  const totals = new Map<string, { personId: string; totalSpend: number; invoiceCount: number }>();

  for (const bill of bills) {
    const assigned = bill.assignedPeople ?? [];
    for (const row of assigned) {
      const key = row.personId;
      const current = totals.get(key) ?? { personId: key, totalSpend: 0, invoiceCount: 0 };
      current.totalSpend += row.amount;
      current.invoiceCount += 1;
      totals.set(key, current);
    }
  }

  const people = await Promise.all(
    [...totals.values()].map(async (row) => {
      const person = await ctx.db.get(row.personId as any);
      return {
        personId: row.personId,
        person,
        totalSpend: row.totalSpend,
        invoiceCount: row.invoiceCount
      };
    })
  );
  const grandTotal = people.reduce((sum, row) => sum + row.totalSpend, 0);

  return people
    .filter((row) => row.person && "name" in row.person && "role" in row.person)
    .map((row) => ({
      personId: row.person!._id,
      personName: (row.person as any).name as string,
      role: (row.person as any).role as string,
      totalSpend: row.totalSpend,
      invoiceCount: row.invoiceCount,
      pctOfTotal: grandTotal > 0 ? (row.totalSpend / grandTotal) * 100 : 0
    }))
    .sort((a, b) => b.totalSpend - a.totalSpend);
}

function getLineItems(extractedData: unknown) {
  if (!extractedData || typeof extractedData !== "object") return [] as unknown[];
  const extracted = extractedData as { line_items?: unknown; lineItems?: unknown };
  if (Array.isArray(extracted.line_items)) return extracted.line_items;
  if (Array.isArray(extracted.lineItems)) return extracted.lineItems;
  return [] as unknown[];
}

function getLineItemTotalUsdByIndex(extractedData: unknown, index: number) {
  const lineItems = getLineItems(extractedData);
  const row = lineItems[index];
  if (!row || typeof row !== "object") return 0;
  const record = row as Record<string, unknown>;
  if (typeof record.total_usd === "number" && Number.isFinite(record.total_usd)) return record.total_usd;
  if (typeof record.amount_usd === "number" && Number.isFinite(record.amount_usd)) return record.amount_usd;
  return 0;
}

function classifyStablingSubcategory(item: Record<string, unknown>) {
  const raw = pickString(item, ["stabling_subcategory", "subcategory", "line_item_subcategory"]);
  const slug = slugify(raw ?? "");
  if (STABLING_SUBCATEGORY_SLUGS.has(slug)) return slug;
  const description = String(item.description ?? "").toLowerCase();
  if (description.includes("turnout") || description.includes("paddock")) return "turnout";
  if (description.includes("bedding")) return "bedding";
  if (description.includes("hay") || description.includes("feed")) return "hay-feed";
  if (description.includes("facility")) return "facility-fees";
  if (description.includes("board") || description.includes("stall")) return "board";
  return "board";
}

function pickNumber(source: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === "string") {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return undefined;
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)+/g, "");
}

function genericExtractionPrompt(categorySlug?: string) {
  const base =
    "Extract invoice data as strict JSON with invoice_number, invoice_date, provider_name, account_number, original_currency, original_total, exchange_rate, invoice_total_usd, and line_items[].";
  if (categorySlug === "stabling") {
    return `${base} For each line item also return horse_name (if present) and stabling_subcategory.`;
  }
  if (categorySlug === "travel" || categorySlug === "housing") {
    return `${base} For each line item return amount_original and amount_usd when available.`;
  }
  return base;
}

function inRange(ts: number, range: { start: number; end: number }) {
  return ts >= range.start && ts <= range.end;
}

function getBillTimestamp(bill: { extractedData?: unknown; uploadedAt: number }) {
  const extracted = (bill.extractedData ?? {}) as { invoice_date?: unknown };
  if (typeof extracted.invoice_date === "string") {
    const parsed = Date.parse(extracted.invoice_date);
    if (Number.isFinite(parsed)) return parsed;
  }
  return bill.uploadedAt;
}

function getPeriodRange(period: "thisMonth" | "ytd" | "2024" | "all", nowTs: number) {
  const now = new Date(nowTs);
  switch (period) {
    case "thisMonth":
      return { start: new Date(now.getFullYear(), now.getMonth(), 1).getTime(), end: nowTs };
    case "ytd":
      return { start: new Date(now.getFullYear(), 0, 1).getTime(), end: nowTs };
    case "2024":
      return { start: new Date(2024, 0, 1).getTime(), end: new Date(2024, 11, 31, 23, 59, 59, 999).getTime() };
    case "all":
    default:
      return { start: 0, end: nowTs };
  }
}

function getPreviousPeriodRange(period: "thisMonth" | "ytd" | "2024" | "all", current: { start: number; end: number }) {
  const startDate = new Date(current.start);
  switch (period) {
    case "thisMonth": {
      const prevStart = new Date(startDate.getFullYear(), startDate.getMonth() - 1, 1).getTime();
      const prevEnd = new Date(startDate.getFullYear(), startDate.getMonth(), 0, 23, 59, 59, 999).getTime();
      return { start: prevStart, end: prevEnd };
    }
    case "ytd": {
      const now = new Date(current.end);
      const daysIntoYear = Math.floor((current.end - new Date(now.getFullYear(), 0, 1).getTime()) / (1000 * 60 * 60 * 24));
      const prevYear = now.getFullYear() - 1;
      return {
        start: new Date(prevYear, 0, 1).getTime(),
        end: new Date(prevYear, 0, 1 + daysIntoYear, 23, 59, 59, 999).getTime()
      };
    }
    case "2024":
      return { start: new Date(2023, 0, 1).getTime(), end: new Date(2023, 11, 31, 23, 59, 59, 999).getTime() };
    case "all":
    default:
      return { start: 0, end: 0 };
  }
}

function sumInvoiceTotals(bills: Array<{ extractedData?: unknown }>) {
  return bills.reduce((sum, bill) => sum + getInvoiceTotalUsdFromAny(bill.extractedData), 0);
}

function getHorseSpendRowsFromBill(
  bill: {
    extractedData?: unknown;
    horseAssignments?: Array<{ lineItemIndex: number; horseName?: string }>;
    splitLineItems?: Array<{ lineItemIndex: number; splits: Array<{ horseName: string; amount: number }> }>;
  },
  categorySlug: string
) {
  const rows: Array<{ horseName: string; amount: number }> = [];
  if (categorySlug === "stabling") {
    for (const row of bill.horseAssignments ?? []) {
      const horseName = row.horseName?.trim();
      if (!horseName) continue;
      rows.push({ horseName, amount: getLineItemTotalUsdByIndex(bill.extractedData, row.lineItemIndex) });
    }
    for (const row of bill.splitLineItems ?? []) {
      for (const split of row.splits) {
        const horseName = split.horseName?.trim();
        if (!horseName) continue;
        rows.push({ horseName, amount: split.amount });
      }
    }
    return rows;
  }

  const lineItems = getLineItems(bill.extractedData);
  for (const item of lineItems) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const horseName = pickString(record, ["horse_name", "horseName"]);
    if (!horseName) continue;
    const amount =
      typeof record.total_usd === "number" ? record.total_usd :
      typeof record.amount_usd === "number" ? record.amount_usd : 0;
    rows.push({ horseName, amount });
  }
  return rows;
}

function getInvoiceEntities(
  bill: {
    extractedData?: unknown;
    assignedPeople?: Array<{ personId: string }>;
    horseAssignments?: Array<{ horseName?: string }>;
    splitLineItems?: Array<{ splits: Array<{ horseName: string }> }>;
  },
  categorySlug: string,
  peopleById: Map<string, { name: string }>
) {
  if (categorySlug === "travel" || categorySlug === "housing") {
    const names = [...new Set((bill.assignedPeople ?? []).map((row) => peopleById.get(String(row.personId))?.name).filter(Boolean) as string[])];
    return { type: "person" as const, names };
  }

  const names = new Set<string>();
  for (const row of bill.horseAssignments ?? []) {
    if (row.horseName?.trim()) names.add(row.horseName.trim());
  }
  for (const row of bill.splitLineItems ?? []) {
    for (const split of row.splits) {
      if (split.horseName?.trim()) names.add(split.horseName.trim());
    }
  }
  if (names.size === 0) {
    const lineItems = getLineItems(bill.extractedData);
    for (const item of lineItems) {
      if (!item || typeof item !== "object") continue;
      const horseName = pickString(item as Record<string, unknown>, ["horse_name", "horseName"]);
      if (horseName) names.add(horseName);
    }
  }
  return { type: "horse" as const, names: [...names] };
}

function getCategoryColor(slug: string) {
  const map: Record<string, string> = {
    veterinary: "#4A5BDB",
    farrier: "#14B8A6",
    stabling: "#F59E0B",
    travel: "#EC4899",
    housing: "#A78BFA",
    "entry-fees": "#EF4444",
    "tack-equipment": "#6B7084",
    insurance: "#22C583",
  };
  return map[slug] ?? "#6B7084";
}
