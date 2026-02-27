import { v } from "convex/values";
import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { normalizeAliasKey } from "./matchHorse";

const STABLING_SUBCATEGORY_SLUGS = new Set(["board", "turnout", "bedding", "hay-feed", "facility-fees", "other"]);
const HORSE_BASED_CATEGORY_SLUGS = new Set([
  "veterinary",
  "farrier",
  "stabling",
  "feed-bedding",
  "horse-transport",
  "bodywork",
  "show-expenses"
]);

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

    await ctx.scheduler.runAfter(0, internal.billParsing.parseBillPdf, { billId });
    return billId;
  }
});

export const triggerBillParsing = mutation({
  args: { billId: v.id("bills") },
  handler: async (ctx, args) => {
    const bill = await ctx.db.get(args.billId);
    if (!bill) throw new Error("Bill not found");

    await ctx.db.patch(args.billId, { status: "parsing", errorMessage: undefined });
    await ctx.scheduler.runAfter(0, internal.billParsing.parseBillPdf, { billId: args.billId });
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

export const getMarketingBills = query({
  args: {
    categoryId: v.id("categories"),
    subcategory: v.optional(v.string())
  },
  handler: async (ctx, args) => {
    const bills = await ctx.db.query("bills").withIndex("by_category", (q) => q.eq("categoryId", args.categoryId)).collect();
    const filtered = bills.filter((bill) => (args.subcategory ? bill.marketingSubcategory === args.subcategory : true));
    const rows = await Promise.all(
      filtered.map(async (bill) => {
        const provider = bill.providerId ? await ctx.db.get(bill.providerId) : null;
        const extracted = (bill.extractedData ?? {}) as Record<string, unknown>;
        const invoiceNumber =
          typeof extracted.invoice_number === "string" && extracted.invoice_number.trim().length > 0
            ? extracted.invoice_number
            : bill.fileName;
        const invoiceDate =
          typeof extracted.invoice_date === "string" && extracted.invoice_date.trim().length > 0
            ? extracted.invoice_date
            : null;
        const lineItems = getLineItems(bill.extractedData);
        return {
          ...bill,
          providerName: provider?.name ?? bill.customProviderName ?? (typeof extracted.provider_name === "string" ? extracted.provider_name : "Unknown"),
          providerSlug: provider?.slug ?? slugify(provider?.name ?? bill.customProviderName ?? "unknown"),
          invoiceNumber,
          invoiceDate,
          totalUsd: getInvoiceTotalUsdFromAny(bill.extractedData),
          lineItemCount: lineItems.length,
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

export const getMarketingSpendBySubcategory = query({
  args: { categoryId: v.id("categories") },
  handler: async (ctx, args) => {
    const bills = await ctx.db.query("bills").withIndex("by_category", (q) => q.eq("categoryId", args.categoryId)).collect();
    const totals = new Map<string, { totalSpend: number; invoiceCount: number }>();
    for (const bill of bills) {
      const key = bill.marketingSubcategory ?? "other";
      const current = totals.get(key) ?? { totalSpend: 0, invoiceCount: 0 };
      current.totalSpend += getInvoiceTotalUsdFromAny(bill.extractedData);
      current.invoiceCount += 1;
      totals.set(key, current);
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

export const getMarketingSpendByProvider = query({
  args: { categoryId: v.id("categories") },
  handler: async (ctx, args) => {
    const bills = await ctx.db.query("bills").withIndex("by_category", (q) => q.eq("categoryId", args.categoryId)).collect();
    const totals = new Map<string, { providerName: string; totalSpend: number; invoiceCount: number }>();
    for (const bill of bills) {
      const provider = bill.providerId ? await ctx.db.get(bill.providerId) : null;
      const extracted = (bill.extractedData ?? {}) as Record<string, unknown>;
      const providerName = provider?.name ?? bill.customProviderName ?? (typeof extracted.provider_name === "string" ? extracted.provider_name : "Unknown");
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

export const getSalaryBills = query({
  args: {
    categoryId: v.id("categories"),
    subcategory: v.optional(v.string())
  },
  handler: async (ctx, args) => {
    const bills = await ctx.db.query("bills").withIndex("by_category", (q) => q.eq("categoryId", args.categoryId)).collect();
    const filtered = bills.filter((bill) => (args.subcategory ? bill.salariesSubcategory === args.subcategory : true));
    const rows = await Promise.all(
      filtered.map(async (bill) => {
        const provider = bill.providerId ? await ctx.db.get(bill.providerId) : null;
        const extracted = (bill.extractedData ?? {}) as Record<string, unknown>;
        const lineItems = getLineItems(bill.extractedData);
        const peopleNames = new Set<string>();
        for (const row of bill.personAssignments ?? []) {
          if (row.personName?.trim()) peopleNames.add(row.personName.trim());
        }
        for (const row of bill.splitPersonLineItems ?? []) {
          for (const split of row.splits) {
            if (split.personName?.trim()) peopleNames.add(split.personName.trim());
          }
        }
        return {
          ...bill,
          providerName: provider?.name ?? bill.customProviderName ?? (typeof extracted.provider_name === "string" ? extracted.provider_name : "Unknown"),
          providerSlug: provider?.slug ?? slugify(provider?.name ?? bill.customProviderName ?? "unknown"),
          invoiceNumber: typeof extracted.invoice_number === "string" ? extracted.invoice_number : bill.fileName,
          invoiceDate: typeof extracted.invoice_date === "string" ? extracted.invoice_date : null,
          totalUsd: getInvoiceTotalUsdFromAny(bill.extractedData),
          lineItemCount: lineItems.length,
          people: [...peopleNames],
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

export const getSalarySpendBySubcategory = query({
  args: { categoryId: v.id("categories") },
  handler: async (ctx, args) => {
    const bills = await ctx.db.query("bills").withIndex("by_category", (q) => q.eq("categoryId", args.categoryId)).collect();
    const totals = new Map<string, { totalSpend: number; invoiceCount: number }>();
    for (const bill of bills) {
      const key = bill.salariesSubcategory ?? "other";
      const current = totals.get(key) ?? { totalSpend: 0, invoiceCount: 0 };
      current.totalSpend += getInvoiceTotalUsdFromAny(bill.extractedData);
      current.invoiceCount += 1;
      totals.set(key, current);
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

export const getSalarySpendByProvider = query({
  args: { categoryId: v.id("categories") },
  handler: async (ctx, args) => {
    const bills = await ctx.db.query("bills").withIndex("by_category", (q) => q.eq("categoryId", args.categoryId)).collect();
    const totals = new Map<string, { providerName: string; totalSpend: number; invoiceCount: number }>();
    for (const bill of bills) {
      const provider = bill.providerId ? await ctx.db.get(bill.providerId) : null;
      const extracted = (bill.extractedData ?? {}) as Record<string, unknown>;
      const providerName = provider?.name ?? bill.customProviderName ?? (typeof extracted.provider_name === "string" ? extracted.provider_name : "Unknown");
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

export const getSalarySpendByPerson = query({
  args: { categoryId: v.id("categories") },
  handler: async (ctx, args) => {
    const bills = await ctx.db.query("bills").withIndex("by_category", (q) => q.eq("categoryId", args.categoryId)).collect();
    const totals = new Map<string, { personName: string; role: string; totalSpend: number; invoiceIds: Set<string> }>();
    for (const bill of bills) {
      for (const row of bill.personAssignments ?? []) {
        if (!row.personName) continue;
        const key = row.personName.toLowerCase();
        const current = totals.get(key) ?? { personName: row.personName, role: row.role ?? "freelance", totalSpend: 0, invoiceIds: new Set<string>() };
        current.totalSpend += getLineItemTotalUsdByIndex(bill.extractedData, row.lineItemIndex);
        current.invoiceIds.add(String(bill._id));
        totals.set(key, current);
      }
      for (const row of bill.splitPersonLineItems ?? []) {
        for (const split of row.splits) {
          const key = split.personName.toLowerCase();
          const current = totals.get(key) ?? { personName: split.personName, role: split.role, totalSpend: 0, invoiceIds: new Set<string>() };
          current.totalSpend += split.amount;
          current.invoiceIds.add(String(bill._id));
          totals.set(key, current);
        }
      }
    }

    const rows = [...totals.values()];
    const grandTotal = rows.reduce((sum, row) => sum + row.totalSpend, 0);
    return rows
      .map((row) => ({
        personName: row.personName,
        role: row.role,
        totalSpend: row.totalSpend,
        invoiceCount: row.invoiceIds.size,
        pctOfTotal: grandTotal > 0 ? (row.totalSpend / grandTotal) * 100 : 0
      }))
      .sort((a, b) => b.totalSpend - a.totalSpend);
  }
});

export const getFeedBeddingBills = query({
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
        const extracted = (bill.extractedData ?? {}) as Record<string, unknown>;
        const lineItems = getLineItems(bill.extractedData);
        let feedTotal = 0;
        let beddingTotal = 0;
        let adminTotal = 0;
        for (const item of lineItems) {
          if (!item || typeof item !== "object") continue;
          const record = item as Record<string, unknown>;
          const subcategory = slugify(String(record.subcategory ?? ""));
          const amount = getLineItemTotalUsd(record);
          if (subcategory === "bedding") {
            beddingTotal += amount;
          } else if (subcategory === "admin") {
            adminTotal += amount;
          } else {
            feedTotal += amount;
          }
        }
        return {
          ...bill,
          providerName: provider?.name ?? bill.customProviderName ?? "Unknown",
          providerSlug: provider?.slug ?? slugify(provider?.name ?? bill.customProviderName ?? "unknown"),
          invoiceNumber: typeof extracted.invoice_number === "string" ? extracted.invoice_number : bill.fileName,
          invoiceDate: typeof extracted.invoice_date === "string" ? extracted.invoice_date : null,
          totalUsd: getInvoiceTotalUsdFromAny(bill.extractedData),
          feedTotal,
          beddingTotal,
          adminTotal,
          lineItemCount: lineItems.length,
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

export const saveFeedBeddingAssignment = mutation({
  args: {
    billId: v.id("bills"),
    splitType: v.union(v.literal("single"), v.literal("split")),
    assignedHorses: v.array(
      v.object({
        horseId: v.id("horses"),
        horseName: v.string(),
        amount: v.number()
      })
    )
  },
  handler: async (ctx, args) => {
    const bill = await ctx.db.get(args.billId);
    if (!bill) throw new Error("Bill not found");
    await ctx.db.patch(args.billId, {
      horseSplitType: args.splitType,
      assignedHorses: args.assignedHorses
    });
    return args.billId;
  }
});

export const updateFeedBeddingLineItemSubcategory = mutation({
  args: {
    billId: v.id("bills"),
    lineItemIndex: v.number(),
    subcategory: v.union(v.literal("feed"), v.literal("bedding"), v.literal("admin"))
  },
  handler: async (ctx, args) => {
    const bill = await ctx.db.get(args.billId);
    if (!bill) throw new Error("Bill not found");
    const extracted = (bill.extractedData ?? {}) as Record<string, unknown>;
    const lineItems = getLineItems(extracted).map((row) => ({ ...(row as Record<string, unknown>) }));
    if (args.lineItemIndex < 0 || args.lineItemIndex >= lineItems.length) {
      throw new Error("Line item index out of range");
    }
    lineItems[args.lineItemIndex] = {
      ...lineItems[args.lineItemIndex],
      subcategory: args.subcategory
    };
    await ctx.db.patch(args.billId, {
      extractedData: {
        ...extracted,
        line_items: lineItems
      }
    });
    return args.billId;
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
              : categorySlug === "marketing"
                ? bill.marketingSubcategory ?? slugify(providerName)
                : categorySlug === "salaries"
                  ? bill.salariesSubcategory ?? "other"
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

export const getAllHorsesForMatching = internalQuery({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("horses").withIndex("by_status_name", (q) => q.eq("status", "active")).collect();
    return rows.map((row) => ({ _id: row._id, name: row.name }));
  }
});

export const getAllPeopleForMatching = internalQuery({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("people").withIndex("by_active", (q) => q.eq("isActive", true)).collect();
    return rows.map((row) => ({ _id: row._id, name: row.name, role: row.role }));
  }
});

export const getHorseAliasesForMatching = internalQuery({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("horseAliases").collect();
    return rows.map((row) => ({ alias: row.alias, horseName: row.horseName, horseId: row.horseId }));
  }
});

export const getPersonAliasesForMatching = internalQuery({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("personAliases").collect();
    return rows.map((row) => ({ alias: row.alias, personName: row.personName, personId: row.personId }));
  }
});

export const upsertHorseAlias = internalMutation({
  args: {
    alias: v.string(),
    horseId: v.id("horses"),
    horseName: v.string()
  },
  handler: async (ctx, args) => {
    const normalizedAlias = normalizeAliasKey(args.alias);
    if (!normalizedAlias || normalizedAlias.length < 2) return null;
    const existing = await ctx.db
      .query("horseAliases")
      .withIndex("by_alias", (q) => q.eq("alias", normalizedAlias))
      .first();
    const now = Date.now();
    if (existing) {
      await ctx.db.patch(existing._id, {
        horseId: args.horseId,
        horseName: args.horseName,
        updatedAt: now
      });
      return existing._id;
    }
    return await ctx.db.insert("horseAliases", {
      alias: normalizedAlias,
      horseId: args.horseId,
      horseName: args.horseName,
      createdAt: now
    });
  }
});

export const upsertPersonAlias = internalMutation({
  args: {
    alias: v.string(),
    personId: v.id("people"),
    personName: v.string()
  },
  handler: async (ctx, args) => {
    const normalizedAlias = normalizeAliasKey(args.alias);
    if (!normalizedAlias || normalizedAlias.length < 2) return null;
    const existing = await ctx.db
      .query("personAliases")
      .withIndex("by_alias", (q) => q.eq("alias", normalizedAlias))
      .first();
    const now = Date.now();
    if (existing) {
      await ctx.db.patch(existing._id, {
        personId: args.personId,
        personName: args.personName,
        updatedAt: now
      });
      return existing._id;
    }
    return await ctx.db.insert("personAliases", {
      alias: normalizedAlias,
      personId: args.personId,
      personName: args.personName,
      createdAt: now
    });
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
    housingSubcategory: v.optional(v.string()),
    horseTransportSubcategory: v.optional(v.string()),
    marketingSubcategory: v.optional(v.string()),
    salariesSubcategory: v.optional(v.string())
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
      housingSubcategory: args.housingSubcategory,
      horseTransportSubcategory: args.horseTransportSubcategory,
      marketingSubcategory: args.marketingSubcategory,
      salariesSubcategory: args.salariesSubcategory
    });
  }
});

export const updateProviderContactInfo = internalMutation({
  args: {
    providerId: v.id("providers"),
    fullName: v.optional(v.string()),
    contactName: v.optional(v.string()),
    primaryContactName: v.optional(v.string()),
    primaryContactPhone: v.optional(v.string()),
    address: v.optional(v.string()),
    phone: v.optional(v.string()),
    email: v.optional(v.string()),
    website: v.optional(v.string()),
    accountNumber: v.optional(v.string())
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.providerId, {
      fullName: args.fullName,
      contactName: args.contactName,
      primaryContactName: args.primaryContactName,
      primaryContactPhone: args.primaryContactPhone,
      address: args.address,
      phone: args.phone,
      email: args.email,
      website: args.website,
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
    horseTransportSubcategory: v.optional(v.string()),
    marketingSubcategory: v.optional(v.string()),
    salariesSubcategory: v.optional(v.string()),
    providerId: v.optional(v.id("providers")),
    customProviderName: v.optional(v.string()),
    extractedProviderContact: v.optional(
      v.object({
        providerName: v.optional(v.string()),
        contactName: v.optional(v.string()),
        address: v.optional(v.string()),
        phone: v.optional(v.string()),
        email: v.optional(v.string()),
        website: v.optional(v.string()),
        accountNumber: v.optional(v.string())
      })
    ),
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
    personAssignments: v.optional(
      v.array(
        v.object({
          lineItemIndex: v.number(),
          personId: v.optional(v.id("people")),
          personName: v.optional(v.string()),
          role: v.optional(v.union(v.literal("rider"), v.literal("groom"), v.literal("freelance"), v.literal("trainer")))
        })
      )
    ),
    splitPersonLineItems: v.optional(
      v.array(
        v.object({
          lineItemIndex: v.number(),
          splits: v.array(
            v.object({
              personId: v.id("people"),
              personName: v.string(),
              role: v.union(v.literal("rider"), v.literal("groom"), v.literal("freelance"), v.literal("trainer")),
              amount: v.number()
            })
          )
        })
      )
    ),
    originalCurrency: v.optional(v.string()),
    originalTotal: v.optional(v.number()),
    exchangeRate: v.optional(v.number()),
    isApproved: v.optional(v.boolean()),
    hasUnmatchedHorses: v.optional(v.boolean()),
    unmatchedHorseNames: v.optional(v.array(v.string()))
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.billId, {
      status: args.status,
      errorMessage: undefined,
      extractedData: args.extractedData,
      travelSubcategory: args.travelSubcategory,
      housingSubcategory: args.housingSubcategory,
      horseTransportSubcategory: args.horseTransportSubcategory,
      marketingSubcategory: args.marketingSubcategory,
      salariesSubcategory: args.salariesSubcategory,
      providerId: args.providerId,
      customProviderName: args.customProviderName,
      extractedProviderContact: args.extractedProviderContact,
      horseAssignments: args.horseAssignments,
      splitLineItems: args.splitLineItems,
      personAssignments: args.personAssignments,
      splitPersonLineItems: args.splitPersonLineItems,
      hasUnmatchedHorses: args.hasUnmatchedHorses,
      unmatchedHorseNames: args.unmatchedHorseNames,
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

    if (!args.isSplit && args.assignedPeople.length === 1) {
      const target = await ctx.db.get(args.assignedPeople[0].personId);
      if (target) {
        const extracted = (bill.extractedData ?? {}) as Record<string, unknown>;
        const aliasCandidate =
          pickString(extracted, ["person_name", "driver_name", "driverName", "employee_name"]) ??
          pickString(extracted, ["assigned_person_suggestion"]);
        if (aliasCandidate && normalizeAliasKey(aliasCandidate) !== normalizeAliasKey(target.name)) {
          await ctx.db
            .query("personAliases")
            .withIndex("by_alias", (q) => q.eq("alias", normalizeAliasKey(aliasCandidate)))
            .first()
            .then(async (existing) => {
              if (existing) {
                await ctx.db.patch(existing._id, {
                  personId: target._id,
                  personName: target.name,
                  updatedAt: Date.now()
                });
              } else {
                await ctx.db.insert("personAliases", {
                  alias: normalizeAliasKey(aliasCandidate),
                  personId: target._id,
                  personName: target.name,
                  createdAt: Date.now()
                });
              }
            });
        }
      }
    }

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

    const lineItems = getLineItems(bill.extractedData);
    for (const row of args.horseAssignments) {
      if (!row.horseId) continue;
      const horse = await ctx.db.get(row.horseId);
      if (!horse) continue;
      const source = lineItems[row.lineItemIndex];
      if (!source || typeof source !== "object") continue;
      const raw = pickString(source as Record<string, unknown>, ["horse_name_raw", "horse_name", "horseName"]);
      if (!raw || normalizeAliasKey(raw) === normalizeAliasKey(horse.name)) continue;

      const normalizedAlias = normalizeAliasKey(raw);
      const existing = await ctx.db.query("horseAliases").withIndex("by_alias", (q) => q.eq("alias", normalizedAlias)).first();
      if (existing) {
        await ctx.db.patch(existing._id, {
          horseId: horse._id,
          horseName: horse.name,
          updatedAt: Date.now()
        });
      } else {
        await ctx.db.insert("horseAliases", {
          alias: normalizedAlias,
          horseId: horse._id,
          horseName: horse.name,
          createdAt: Date.now()
        });
      }
    }

    return args.billId;
  }
});

export const saveHorseTransportAssignment = mutation({
  args: {
    billId: v.id("bills"),
    mode: v.union(v.literal("line_item"), v.literal("split")),
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
    splitType: v.optional(v.union(v.literal("single"), v.literal("split"))),
    assignedHorses: v.optional(
      v.array(
        v.object({
          horseId: v.id("horses"),
          horseName: v.string(),
          amount: v.number()
        })
      )
    )
  },
  handler: async (ctx, args) => {
    const bill = await ctx.db.get(args.billId);
    if (!bill) throw new Error("Bill not found");

    if (args.mode === "line_item") {
      await ctx.db.patch(args.billId, {
        horseAssignments: args.horseAssignments ?? [],
        splitLineItems: args.splitLineItems ?? [],
        horseSplitType: undefined,
        assignedHorses: undefined
      });
      return args.billId;
    }

    await ctx.db.patch(args.billId, {
      horseSplitType: args.splitType ?? "split",
      assignedHorses: args.assignedHorses ?? [],
      horseAssignments: undefined,
      splitLineItems: undefined
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

export const saveSalaryAssignment = mutation({
  args: {
    billId: v.id("bills"),
    personAssignments: v.array(
      v.object({
        lineItemIndex: v.number(),
        personId: v.optional(v.id("people")),
        personName: v.optional(v.string()),
        role: v.optional(v.union(v.literal("rider"), v.literal("groom"), v.literal("freelance"), v.literal("trainer")))
      })
    ),
    splitPersonLineItems: v.array(
      v.object({
        lineItemIndex: v.number(),
        splits: v.array(
          v.object({
            personId: v.id("people"),
            personName: v.string(),
            role: v.union(v.literal("rider"), v.literal("groom"), v.literal("freelance"), v.literal("trainer")),
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
      personAssignments: args.personAssignments,
      splitPersonLineItems: args.splitPersonLineItems
    });

    const lineItems = getLineItems(bill.extractedData);
    for (const row of args.personAssignments) {
      if (!row.personId) continue;
      const person = await ctx.db.get(row.personId);
      if (!person) continue;
      const source = lineItems[row.lineItemIndex];
      if (!source || typeof source !== "object") continue;
      const raw = pickString(source as Record<string, unknown>, ["person_name_raw", "person_name", "personName", "employee_name"]);
      if (!raw || normalizeAliasKey(raw) === normalizeAliasKey(person.name)) continue;
      const normalizedAlias = normalizeAliasKey(raw);
      const existing = await ctx.db.query("personAliases").withIndex("by_alias", (q) => q.eq("alias", normalizedAlias)).first();
      if (existing) {
        await ctx.db.patch(existing._id, {
          personId: person._id,
          personName: person.name,
          updatedAt: Date.now()
        });
      } else {
        await ctx.db.insert("personAliases", {
          alias: normalizedAlias,
          personId: person._id,
          personName: person.name,
          createdAt: Date.now()
        });
      }
    }

    return args.billId;
  }
});

export const resolveUnmatchedHorse = mutation({
  args: {
    billId: v.id("bills"),
    originalName: v.string(),
    horseId: v.id("horses")
  },
  handler: async (ctx, args) => {
    await resolveUnmatchedHorseHandler(ctx, args);
    return args.billId;
  }
});

export const addHorseAndResolveUnmatched = mutation({
  args: {
    billId: v.id("bills"),
    originalName: v.string(),
    horseName: v.string(),
    owner: v.optional(v.string())
  },
  handler: async (ctx, args) => {
    const horseId = await ctx.db.insert("horses", {
      name: args.horseName.trim(),
      owner: args.owner?.trim() || undefined,
      status: "active",
      createdAt: Date.now()
    });
    await resolveUnmatchedHorseHandler(ctx, {
      billId: args.billId,
      originalName: args.originalName,
      horseId
    });
    return horseId;
  }
});

async function approveBillById(ctx: any, billId: Id<"bills">) {
  const bill = await ctx.db.get(billId);
  if (!bill) throw new Error("Bill not found");
  if (bill.hasUnmatchedHorses) {
    const category = await ctx.db.get(bill.categoryId);
    if (category && HORSE_BASED_CATEGORY_SLUGS.has(category.slug)) {
      throw new Error("Resolve all unmatched horses before approving");
    }
  }
  await ctx.db.patch(billId, {
    isApproved: true,
    approvedAt: Date.now(),
    status: "done"
  });
  return billId;
}

export const approveBill = mutation({
  args: { billId: v.id("bills") },
  handler: async (ctx, args) => {
    return await approveBillById(ctx, args.billId);
  }
});

async function resolveUnmatchedHorseHandler(
  ctx: any,
  args: {
    billId: Id<"bills">;
    originalName: string;
    horseId: Id<"horses">;
  }
) {
  const bill = await ctx.db.get(args.billId);
  if (!bill) throw new Error("Bill not found");
  const horse = await ctx.db.get(args.horseId);
  if (!horse || horse.status !== "active") throw new Error("Active horse not found");

  const extracted = (bill.extractedData ?? {}) as Record<string, unknown>;
  const lineItems = getLineItems(extracted).map((row) => ({ ...(row as Record<string, unknown>) }));
  const target = normalizeAliasKey(args.originalName);
  for (const row of lineItems) {
    const rawName = pickString(row, ["horse_name_raw", "originalParsedName", "horse_name", "horseName"]);
    const confidence = String(row.match_confidence ?? row.matchConfidence ?? "").toLowerCase();
    if (!rawName) continue;
    if (normalizeAliasKey(rawName) !== target) continue;
    if (confidence !== "none" && confidence !== "") continue;

    row.horse_name = horse.name;
    row.horseName = horse.name;
    row.matched_horse_id = String(horse._id);
    row.matchedHorseId = String(horse._id);
    row.match_confidence = "manual";
    row.matchConfidence = "manual";
    row.originalParsedName = rawName;
  }

  const unmatchedNames = collectUnmatchedHorseNamesFromLineItems(lineItems);
  await ctx.db.patch(args.billId, {
    extractedData: {
      ...extracted,
      line_items: lineItems
    },
    hasUnmatchedHorses: unmatchedNames.length > 0,
    unmatchedHorseNames: unmatchedNames
  });

  const alias = normalizeAliasKey(args.originalName);
  if (alias && alias !== normalizeAliasKey(horse.name)) {
    const existingAlias = await ctx.db.query("horseAliases").withIndex("by_alias", (q: any) => q.eq("alias", alias)).first();
    if (existingAlias) {
      await ctx.db.patch(existingAlias._id, { horseId: horse._id, horseName: horse.name, updatedAt: Date.now() });
    } else {
      await ctx.db.insert("horseAliases", {
        alias,
        horseId: horse._id,
        horseName: horse.name,
        createdAt: Date.now()
      });
    }
  }
}

export const approveInvoice = mutation({
  args: { billId: v.id("bills") },
  handler: async (ctx, args) => {
    return await approveBillById(ctx, args.billId);
  }
});

export const approveInvoiceWithReclassification = mutation({
  args: {
    billId: v.id("bills"),
    lineItemDecisions: v.array(
      v.object({
        lineItemIndex: v.number(),
        confirmedCategory: v.optional(v.string())
      })
    )
  },
  handler: async (ctx, args) => {
    const bill = await ctx.db.get(args.billId);
    if (!bill) throw new Error("Bill not found");
    const category = await ctx.db.get(bill.categoryId);
    if (!category) throw new Error("Source category not found");

    const sourceCategoryKey = toCategoryKey(category.slug);
    const extracted = (bill.extractedData ?? {}) as Record<string, unknown>;
    const lineItems = getLineItems(extracted).map((row) => ({ ...(row as Record<string, unknown>) }));
    const decisionsByIndex = new Map(args.lineItemDecisions.map((row) => [row.lineItemIndex, row.confirmedCategory]));

    const grouped = new Map<string, Array<{ index: number; item: Record<string, unknown> }>>();
    const kept: Array<Record<string, unknown>> = [];

    for (let index = 0; index < lineItems.length; index += 1) {
      const item = lineItems[index];
      const suggested = normalizeCategoryKey(item.suggestedCategory);
      const decided = normalizeCategoryKey(decisionsByIndex.get(index));
      const target = decided === "keep" ? null : decided ?? suggested;
      const normalizedTarget = target && target !== sourceCategoryKey ? target : null;

      if (!normalizedTarget) {
        kept.push({
          ...item,
          confirmedCategory: decided ?? item.confirmedCategory ?? undefined,
          reclassified: false
        });
        continue;
      }

      const current = grouped.get(normalizedTarget) ?? [];
      current.push({
        index,
        item: {
          ...item,
          confirmedCategory: normalizedTarget,
          reclassified: true
        }
      });
      grouped.set(normalizedTarget, current);
    }

    const sourceProviderName = bill.providerId ? (await ctx.db.get(bill.providerId))?.name : bill.customProviderName;
    const linkedBills: Array<{ targetBillId: Id<"bills">; targetCategory: string; amount: number; itemCount: number }> = [];

    for (const [targetCategoryKey, items] of grouped.entries()) {
      const targetSlug = fromCategoryKey(targetCategoryKey);
      const targetCategory = await ctx.db.query("categories").withIndex("by_slug", (q) => q.eq("slug", targetSlug)).first();
      if (!targetCategory) continue;

      const newLineItems = items.map((row) => row.item);
      const newTotal = newLineItems.reduce((sum, row) => sum + getLineItemTotalUsd(row), 0);
      const targetExtracted = {
        ...extracted,
        line_items: newLineItems,
        invoice_total_usd: roundCurrency(newTotal)
      };

      const targetBillId = await ctx.db.insert("bills", {
        providerId: undefined,
        categoryId: targetCategory._id,
        fileId: bill.fileId,
        fileName: `${bill.fileName} · ${targetCategory.name}`,
        status: "pending",
        billingPeriod: bill.billingPeriod,
        uploadedAt: Date.now(),
        extractedData: targetExtracted,
        customProviderName: sourceProviderName,
        originalPdfUrl: bill.originalPdfUrl,
        originalCurrency: bill.originalCurrency,
        originalTotal: roundCurrency(newTotal),
        exchangeRate: bill.exchangeRate,
        isApproved: false,
        linkedFromBillId: bill._id
      });

      linkedBills.push({
        targetBillId,
        targetCategory: targetCategoryKey,
        amount: roundCurrency(newTotal),
        itemCount: newLineItems.length
      });
    }

    const keptTotal = kept.reduce((sum, row) => sum + getLineItemTotalUsd(row), 0);
    const nextLinked = [...(bill.linkedBills ?? []), ...linkedBills];
    await ctx.db.patch(args.billId, {
      extractedData: {
        ...extracted,
        line_items: kept,
        invoice_total_usd: roundCurrency(keptTotal)
      },
      linkedBills: nextLinked,
      isApproved: true,
      approvedAt: Date.now(),
      status: "done"
    });

    return {
      billId: args.billId,
      linkedBills: nextLinked
    };
  }
});

export const deleteBill = mutation({
  args: { billId: v.id("bills") },
  handler: async (ctx, args) => {
    const bill = await ctx.db.get(args.billId);
    if (!bill) return { deleted: false };

    const fileIdsToDelete = new Set<string>();
    if (bill.fileId) fileIdsToDelete.add(String(bill.fileId));

    if (bill.linkedBills && bill.linkedBills.length > 0) {
      for (const linked of bill.linkedBills) {
        const linkedBill = await ctx.db.get(linked.targetBillId);
        if (!linkedBill) continue;
        if (linkedBill.fileId) fileIdsToDelete.add(String(linkedBill.fileId));
        await ctx.db.delete(linked.targetBillId);
      }
      await ctx.db.delete(args.billId);
      for (const fileId of fileIdsToDelete) {
        await ctx.storage.delete(fileId as Id<"_storage">);
      }
      return { deleted: true };
    }

    if (bill.linkedFromBillId) {
      const source = await ctx.db.get(bill.linkedFromBillId);
      if (source?.linkedBills) {
        await ctx.db.patch(source._id, {
          linkedBills: source.linkedBills.filter((row) => row.targetBillId !== bill._id)
        });
      }
      await ctx.db.delete(args.billId);
      for (const fileId of fileIdsToDelete) {
        await ctx.storage.delete(fileId as Id<"_storage">);
      }
      return { deleted: true };
    }

    await ctx.db.delete(args.billId);
    for (const fileId of fileIdsToDelete) {
      await ctx.storage.delete(fileId as Id<"_storage">);
    }
    return { deleted: true };
  }
});

export const setLineItemConfirmedCategory = mutation({
  args: {
    billId: v.id("bills"),
    lineItemIndex: v.number(),
    confirmedCategory: v.optional(v.string())
  },
  handler: async (ctx, args) => {
    const bill = await ctx.db.get(args.billId);
    if (!bill) throw new Error("Bill not found");
    const extracted = (bill.extractedData ?? {}) as Record<string, unknown>;
    const lineItems = getLineItems(extracted).map((row) => ({ ...(row as Record<string, unknown>) }));
    if (args.lineItemIndex < 0 || args.lineItemIndex >= lineItems.length) {
      throw new Error("Line item index out of range");
    }

    lineItems[args.lineItemIndex] = {
      ...lineItems[args.lineItemIndex],
      confirmedCategory: args.confirmedCategory
    };
    await ctx.db.patch(args.billId, {
      extractedData: {
        ...extracted,
        line_items: lineItems
      }
    });
    return args.billId;
  }
});

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

function pickString(source: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
  return undefined;
}

function collectUnmatchedHorseNamesFromLineItems(lineItems: Array<Record<string, unknown>>) {
  const names = new Set<string>();
  for (const row of lineItems) {
    const confidence = String(row.match_confidence ?? row.matchConfidence ?? "").toLowerCase();
    if (confidence !== "none" && confidence !== "") continue;
    const raw = pickString(row, ["horse_name_raw", "originalParsedName", "horse_name", "horseName"]);
    if (!raw) continue;
    names.add(raw);
  }
  return [...names];
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

function getLineItemTotalUsd(record: Record<string, unknown>) {
  if (typeof record.total_usd === "number" && Number.isFinite(record.total_usd)) return record.total_usd;
  if (typeof record.amount_usd === "number" && Number.isFinite(record.amount_usd)) return record.amount_usd;
  if (typeof record.total === "number" && Number.isFinite(record.total)) return record.total;
  return 0;
}

function roundCurrency(value: number) {
  return Math.round(value * 100) / 100;
}

function toCategoryKey(slug: string) {
  return slug.replace(/-/g, "_");
}

function fromCategoryKey(key: string) {
  return key.replace(/_/g, "-");
}

function normalizeCategoryKey(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return null;
  if (normalized === "keep") return "keep";
  return normalized.replace(/-/g, "_");
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

function slugify(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)+/g, "");
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
    personAssignments?: Array<{ personName?: string }>;
    splitPersonLineItems?: Array<{ splits: Array<{ personName: string }> }>;
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
  if (categorySlug === "salaries") {
    const names = new Set<string>();
    for (const row of bill.personAssignments ?? []) {
      if (row.personName?.trim()) names.add(row.personName.trim());
    }
    for (const row of bill.splitPersonLineItems ?? []) {
      for (const split of row.splits) {
        if (split.personName?.trim()) names.add(split.personName.trim());
      }
    }
    return { type: "person" as const, names: [...names] };
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
    bodywork: "#5B8DEF",
    "feed-bedding": "#22C583",
    salaries: "#4A5BDB",
    stabling: "#F59E0B",
    travel: "#EC4899",
    housing: "#A78BFA",
    "entry-fees": "#EF4444",
    "tack-equipment": "#6B7084",
    insurance: "#22C583",
  };
  return map[slug] ?? "#6B7084";
}
