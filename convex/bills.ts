import { v } from "convex/values";
import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { normalizeAliasKey } from "./matchHorse";
import { syncApprovedBillIntoDraftInvoices } from "./billing";

/** Convert a category slug like "feed-bedding" to display name "Feed & Bedding" */
function formatCategorySlug(slug: string): string {
  return slug
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ")
    .replace("Feed Bedding", "Feed & Bedding")
    .replace("Dues Registrations", "Dues & Registrations")
    .replace("Horse Transport", "Horse Transport")
    .replace("Show Expenses", "Show Expenses");
}

/**
 * Resolve contact info for a bill.
 * Returns { name, slug, contactId } or null.
 */
async function resolveContactForBill(
  ctx: any,
  bill: { contactId?: string; customProviderName?: string }
) {
  if (bill.contactId) {
    const contact = await ctx.db.get(bill.contactId);
    if (contact) {
      return { name: contact.name, slug: contact.slug ?? slugify(contact.name), contactId: contact._id };
    }
  }
  return null;
}

/**
 * Batch resolve contacts for a list of bills.
 * Returns a Map from bill._id to { name, slug, contactId }.
 */
async function batchResolveContacts(
  ctx: any,
  bills: Array<{ _id: string; contactId?: string; customProviderName?: string }>
) {
  const contactIds = [...new Set(bills.flatMap((b) => (b.contactId ? [b.contactId] : [])))];
  const contactResults = await Promise.all(contactIds.map(async (id) => [id, await ctx.db.get(id)] as const));
  const contactMap = new Map(contactResults.map(([id, c]) => [id, c]));

  const result = new Map<string, { name: string; slug: string; contactId?: string }>();
  for (const bill of bills) {
    if (bill.contactId) {
      const contact = contactMap.get(bill.contactId);
      if (contact) {
        result.set(String(bill._id), { name: contact.name, slug: contact.slug ?? slugify(contact.name), contactId: String(contact._id) });
      }
    }
  }
  return result;
}

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

/**
 * Attach a PDF storage file to an existing bill.
 * Used by CC-statement-generated invoices (which lack a source PDF) so the
 * user can upload the actual invoice after the fact.
 */
export const attachPdfToBill = mutation({
  args: {
    billId: v.id("bills"),
    fileId: v.id("_storage"),
    fileName: v.string()
  },
  handler: async (ctx, args) => {
    const bill = await ctx.db.get(args.billId);
    if (!bill) throw new Error("Bill not found");
    const url = await ctx.storage.getUrl(args.fileId);
    await ctx.db.patch(args.billId, {
      fileId: args.fileId,
      fileName: args.fileName,
      originalPdfUrl: url ?? undefined
    });
    return { ok: true, url };
  }
});

export const createBillRecord = mutation({
  args: {
    contactId: v.optional(v.id("contacts")),
    categoryId: v.optional(v.id("categories")),
    fileId: v.id("_storage"),
    fileName: v.string(),
    billingPeriod: v.string(),
    originalPdfUrl: v.optional(v.string())
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("bills", {
      ...(args.contactId ? { contactId: args.contactId } : {}),
      ...(args.categoryId ? { categoryId: args.categoryId } : {}),
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
    contactId: v.optional(v.id("contacts")),
    categoryId: v.optional(v.id("categories")),
    fileId: v.id("_storage"),
    fileName: v.string(),
    billingPeriod: v.string(),
    originalPdfUrl: v.optional(v.string())
  },
  handler: async (ctx, args) => {
    const billId = await ctx.db.insert("bills", {
      ...(args.contactId ? { contactId: args.contactId } : {}),
      ...(args.categoryId ? { categoryId: args.categoryId } : {}),
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

export const listForLinking = query(async (ctx) => {
  const bills = await ctx.db.query("bills").withIndex("by_uploadedAt").order("desc").collect();
  const approvedBills = bills.filter((b) => b.status === "done" && b.isApproved);
  const contactResolved = await batchResolveContacts(ctx, approvedBills as any);
  return approvedBills.map((bill) => {
    const resolved = contactResolved.get(String(bill._id));
    const extracted = (bill.extractedData ?? {}) as Record<string, unknown>;
    return {
      _id: bill._id,
      contactName: resolved?.name ?? bill.customProviderName ?? "Unknown",
      invoiceDate: String(extracted.invoice_date ?? extracted.invoiceDate ?? ""),
      invoiceNumber: String(extracted.invoice_number ?? extracted.invoiceNumber ?? ""),
    };
  });
});

export const listAll = query(async (ctx) => {
  const bills = await ctx.db.query("bills").withIndex("by_uploadedAt").order("desc").collect();

  const contactResolved = await batchResolveContacts(ctx, bills as any);

  const categoryIds = [...new Set(bills.map((bill) => bill.categoryId).filter(Boolean))] as string[];
  const categoryPairs = await Promise.all(categoryIds.map(async (id) => [id, await ctx.db.get(id as any)] as const));
  const categoryMap = new Map(categoryPairs.map(([id, category]) => [id, category]));

  return bills.map((bill) => {
    const resolved = contactResolved.get(String(bill._id));
    const category = bill.categoryId ? categoryMap.get(bill.categoryId) as { slug?: string; name?: string } | null | undefined : null;
    // Derive primary category from line items if no bill-level category
    const lineItemCats = bill.lineItemCategories ?? [];
    const primaryCategorySlug = category?.slug ?? (lineItemCats.length > 0 ? lineItemCats[0] : "unknown");
    const primaryCategoryName = category?.name ?? (lineItemCats.length > 0 ? formatCategorySlug(lineItemCats[0]) : "Unknown");
    return {
      ...bill,
      contactName: resolved?.name ?? bill.customProviderName ?? "Unknown",
      contactSlug: resolved?.slug ?? slugify(bill.customProviderName ?? "unknown"),
      categoryName: primaryCategoryName,
      categorySlug: primaryCategorySlug,
      lineItemCategories: lineItemCats,
    };
  });
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
        const resolved = await resolveContactForBill(ctx, bill as any);
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
          contactName: resolved?.name ?? bill.customProviderName ?? "Unknown",
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
    const bills = (await ctx.db.query("bills").withIndex("by_category", (q) => q.eq("categoryId", args.categoryId)).collect()).filter(isApprovedBill);
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
    const bills = (await ctx.db.query("bills").withIndex("by_category", (q) => q.eq("categoryId", args.categoryId)).collect()).filter(isApprovedBill);
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
    const bills = (await ctx.db.query("bills").withIndex("by_category", (q) => q.eq("categoryId", args.categoryId)).collect()).filter(isApprovedBill);
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
    const bills = (await ctx.db.query("bills").withIndex("by_category", (q) => q.eq("categoryId", args.categoryId)).collect()).filter(isApprovedBill);
    const totals = new Map<string, { contactName: string; totalSpend: number; invoiceCount: number }>();

    for (const bill of bills) {
      const resolved = await resolveContactForBill(ctx, bill as any);
      const contactName = resolved?.name ?? bill.customProviderName ?? "Unknown";
      const current = totals.get(contactName) ?? { contactName, totalSpend: 0, invoiceCount: 0 };
      current.totalSpend += getInvoiceTotalUsdFromAny(bill.extractedData);
      current.invoiceCount += 1;
      totals.set(contactName, current);
    }

    const grandTotal = [...totals.values()].reduce((sum, row) => sum + row.totalSpend, 0);
    return [...totals.values()]
      .map((row) => ({
        contactName: row.contactName,
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
        const resolved = await resolveContactForBill(ctx, bill as any);
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
          contactName: resolved?.name ?? bill.customProviderName ?? "Unknown",
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
    const bills = (await ctx.db.query("bills").withIndex("by_category", (q) => q.eq("categoryId", args.categoryId)).collect()).filter(isApprovedBill);
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
        const resolved = await resolveContactForBill(ctx, bill as any);
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
          contactName: resolved?.name ?? bill.customProviderName ?? (typeof extracted.contact_name === "string" ? extracted.contact_name : "Unknown"),
          contactSlug: resolved?.slug ?? slugify(resolved?.name ?? bill.customProviderName ?? "unknown"),
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
    const bills = (await ctx.db.query("bills").withIndex("by_category", (q) => q.eq("categoryId", args.categoryId)).collect()).filter(isApprovedBill);
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
    const bills = (await ctx.db.query("bills").withIndex("by_category", (q) => q.eq("categoryId", args.categoryId)).collect()).filter(isApprovedBill);
    const totals = new Map<string, { contactName: string; totalSpend: number; invoiceCount: number }>();
    for (const bill of bills) {
      const resolved = await resolveContactForBill(ctx, bill as any);
      const extracted = (bill.extractedData ?? {}) as Record<string, unknown>;
      const contactName = resolved?.name ?? bill.customProviderName ?? (typeof extracted.contact_name === "string" ? extracted.contact_name : "Unknown");
      const current = totals.get(contactName) ?? { contactName, totalSpend: 0, invoiceCount: 0 };
      current.totalSpend += getInvoiceTotalUsdFromAny(bill.extractedData);
      current.invoiceCount += 1;
      totals.set(contactName, current);
    }
    const grandTotal = [...totals.values()].reduce((sum, row) => sum + row.totalSpend, 0);
    return [...totals.values()]
      .map((row) => ({
        contactName: row.contactName,
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
    const filtered = bills.filter((bill) => (args.subcategory ? bill.groomingSubcategory === args.subcategory : true));
    const rows = await Promise.all(
      filtered.map(async (bill) => {
        const resolved = await resolveContactForBill(ctx, bill as any);
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
          contactName: resolved?.name ?? bill.customProviderName ?? (typeof extracted.contact_name === "string" ? extracted.contact_name : "Unknown"),
          contactSlug: resolved?.slug ?? slugify(resolved?.name ?? bill.customProviderName ?? "unknown"),
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
    const bills = (await ctx.db.query("bills").withIndex("by_category", (q) => q.eq("categoryId", args.categoryId)).collect()).filter(isApprovedBill);
    const totals = new Map<string, { totalSpend: number; invoiceCount: number }>();
    for (const bill of bills) {
      const key = bill.groomingSubcategory ?? "other";
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
    const bills = (await ctx.db.query("bills").withIndex("by_category", (q) => q.eq("categoryId", args.categoryId)).collect()).filter(isApprovedBill);
    const totals = new Map<string, { contactName: string; totalSpend: number; invoiceCount: number }>();
    for (const bill of bills) {
      const resolved = await resolveContactForBill(ctx, bill as any);
      const extracted = (bill.extractedData ?? {}) as Record<string, unknown>;
      const contactName = resolved?.name ?? bill.customProviderName ?? (typeof extracted.contact_name === "string" ? extracted.contact_name : "Unknown");
      const current = totals.get(contactName) ?? { contactName, totalSpend: 0, invoiceCount: 0 };
      current.totalSpend += getInvoiceTotalUsdFromAny(bill.extractedData);
      current.invoiceCount += 1;
      totals.set(contactName, current);
    }
    const grandTotal = [...totals.values()].reduce((sum, row) => sum + row.totalSpend, 0);
    return [...totals.values()]
      .map((row) => ({
        contactName: row.contactName,
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
    const bills = (await ctx.db.query("bills").withIndex("by_category", (q) => q.eq("categoryId", args.categoryId)).collect()).filter(isApprovedBill);
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

/**
 * Returns spend + recent invoices for a single person.
 * Aggregates across personAssignments, splitPersonLineItems (invoice uploads)
 * and assignedPeople on bills generated from CC transactions.
 */
export const getPersonSpendSummary = query({
  args: { personId: v.id("people") },
  handler: async (ctx, args) => {
    const person = await ctx.db.get(args.personId);
    if (!person) return null;

    // Collect all approved bills. Person data lives on the bill itself, so we need to scan.
    const allBills = (await ctx.db.query("bills").withIndex("by_uploadedAt").collect()).filter(isApprovedBill);

    type InvoiceEntry = {
      billId: string;
      amount: number;
      billingPeriod: string;
      invoiceDate: number;
      uploadedAt: number;
      contactName: string;
      fileName: string;
      categorySlug?: string;
      source?: string;
    };

    const entries: InvoiceEntry[] = [];
    let totalSpend = 0;

    const nowPeriod = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const today = new Date();
    const currentPeriod = nowPeriod(today);
    const lastMonth = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    const previousPeriod = nowPeriod(lastMonth);
    let currentMonthSpend = 0;
    let previousMonthSpend = 0;

    const byCategory = new Map<string, number>();

    for (const bill of allBills) {
      let billPersonTotal = 0;

      for (const row of bill.personAssignments ?? []) {
        if (row.personId && String(row.personId) === String(args.personId)) {
          billPersonTotal += getLineItemTotalUsdByIndex(bill.extractedData, row.lineItemIndex);
        }
      }
      for (const row of bill.splitPersonLineItems ?? []) {
        for (const split of row.splits) {
          if (String(split.personId) === String(args.personId)) {
            billPersonTotal += split.amount;
          }
        }
      }
      for (const row of bill.assignedPeople ?? []) {
        if (String(row.personId) === String(args.personId)) {
          billPersonTotal += row.amount;
        }
      }

      if (billPersonTotal <= 0) continue;

      const resolved = await resolveContactForBill(ctx, bill as any);
      const extracted = (bill.extractedData ?? {}) as Record<string, unknown>;
      const invoiceDate = getInvoiceDateSortValue(bill);

      totalSpend += billPersonTotal;

      if (bill.billingPeriod === currentPeriod) currentMonthSpend += billPersonTotal;
      if (bill.billingPeriod === previousPeriod) previousMonthSpend += billPersonTotal;

      // Derive category slug (bill-level or first line item category)
      let categorySlug: string | undefined;
      if (bill.categoryId) {
        const cat = await ctx.db.get(bill.categoryId);
        if (cat && "slug" in cat) categorySlug = (cat as any).slug;
      }
      if (!categorySlug && Array.isArray(bill.lineItemCategories) && bill.lineItemCategories.length > 0) {
        categorySlug = bill.lineItemCategories[0];
      }
      if (categorySlug) {
        byCategory.set(categorySlug, (byCategory.get(categorySlug) ?? 0) + billPersonTotal);
      }

      entries.push({
        billId: String(bill._id),
        amount: billPersonTotal,
        billingPeriod: bill.billingPeriod,
        invoiceDate,
        uploadedAt: bill.uploadedAt,
        contactName: resolved?.name ?? bill.customProviderName ?? (typeof extracted.contact_name === "string" ? extracted.contact_name : "Unknown"),
        fileName: bill.invoiceName ?? bill.fileName,
        categorySlug,
        source: bill.source,
      });
    }

    entries.sort((a, b) => b.invoiceDate - a.invoiceDate);

    return {
      person,
      totalSpend,
      currentMonthSpend,
      previousMonthSpend,
      invoiceCount: entries.length,
      byCategory: [...byCategory.entries()]
        .map(([slug, amount]) => ({ slug, amount }))
        .sort((a, b) => b.amount - a.amount),
      invoices: entries,
    };
  },
});

export const getFeedBeddingBills = query({
  args: {
    categoryId: v.id("categories")
  },
  handler: async (ctx, args) => {
    const bills = await ctx.db.query("bills").withIndex("by_category", (q) => q.eq("categoryId", args.categoryId)).collect();
    const filtered = bills;
    const rows = await Promise.all(
      filtered.map(async (bill) => {
        const resolved = await resolveContactForBill(ctx, bill as any);
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
          contactName: resolved?.name ?? bill.customProviderName ?? "Unknown",
          contactSlug: resolved?.slug ?? slugify(resolved?.name ?? bill.customProviderName ?? "unknown"),
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
    categoryId: v.id("categories")
  },
  handler: async (ctx, args) => {
    const bills = await ctx.db.query("bills").withIndex("by_category", (q) => q.eq("categoryId", args.categoryId)).collect();
    const filtered = bills;

    const rows = await Promise.all(
      filtered.map(async (bill) => {
        const resolved = await resolveContactForBill(ctx, bill as any);
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
          contactName: resolved?.name ?? bill.customProviderName ?? "Unknown",
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

export const getStablingSpendByContact = query({
  args: { categoryId: v.id("categories") },
  handler: async (ctx, args) => {
    const bills = (await ctx.db.query("bills").withIndex("by_category", (q) => q.eq("categoryId", args.categoryId)).collect()).filter(isApprovedBill);
    const totals = new Map<string, { contactId: string; contactName: string; totalSpend: number; invoiceCount: number }>();
    for (const bill of bills) {
      const resolved = await resolveContactForBill(ctx, bill as any);
      const contactName = resolved?.name ?? bill.customProviderName ?? "Unknown";
      const contactId = String(bill.contactId ?? contactName);
      const current = totals.get(contactId) ?? { contactId, contactName, totalSpend: 0, invoiceCount: 0 };
      current.totalSpend += getInvoiceTotalUsdFromAny(bill.extractedData);
      current.invoiceCount += 1;
      totals.set(contactId, current);
    }
    const grandTotal = [...totals.values()].reduce((sum, row) => sum + row.totalSpend, 0);
    return [...totals.values()]
      .map((row) => ({
        contactId: row.contactId,
        contactName: row.contactName,
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
    const bills = (await ctx.db.query("bills").withIndex("by_category", (q) => q.eq("categoryId", args.categoryId)).collect()).filter(isApprovedBill);
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
    const bills = (await ctx.db.query("bills").withIndex("by_category", (q) => q.eq("categoryId", args.categoryId)).collect()).filter(isApprovedBill);
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

    const [allBills, categories, people] = await Promise.all([
      ctx.db.query("bills").collect(),
      ctx.db.query("categories").collect(),
      ctx.db.query("people").withIndex("by_active", (q) => q.eq("isActive", true)).collect(),
    ]);
    const bills = allBills.filter(isApprovedBill);
    const categoryById = new Map(categories.map((row) => [String(row._id), row]));
    const peopleById = new Map(people.map((row) => [String(row._id), row]));

    const contactResolved = await batchResolveContacts(ctx, bills as any);

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
        role: row.role as "rider" | "groom" | "freelance" | "trainer" | "admin",
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
        const resolved = contactResolved.get(String(bill._id));
        const contactName = resolved?.name ?? bill.customProviderName ?? "Unknown";
        const contactSlug =
          categorySlug === "travel"
            ? bill.travelSubcategory ?? slugify(contactName)
            : categorySlug === "housing"
              ? bill.housingSubcategory ?? slugify(contactName)
              : categorySlug === "marketing"
                ? bill.marketingSubcategory ?? slugify(contactName)
                : categorySlug === "grooming"
                  ? bill.groomingSubcategory ?? "other"
              : resolved?.slug ?? slugify(contactName);
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
          vendor: contactName,
          date,
          entities: entities.names,
          entityType: entities.type,
          status: (bill.status === "done" && bill.isApproved) || categorySlug === "veterinary" ? "done" : "pending",
          total: getInvoiceTotalUsdFromAny(bill.extractedData),
          categorySlug,
          contactSlug
        };
      })
      .sort((a, b) => {
        const aTs = Date.parse(a.date);
        const bTs = Date.parse(b.date);
        if (Number.isFinite(aTs) && Number.isFinite(bTs) && aTs !== bTs) return bTs - aTs;
        return 0;
      });

    // Collect business_general line items
    const businessGeneralItems: Array<{
      billId: string;
      invoiceName: string;
      contactName: string;
      invoiceDate: string;
      categorySlug: string;
      lineDescription: string;
      lineAmount: number;
    }> = [];
    for (const bill of currentBills) {
      const extracted = (bill.extractedData ?? {}) as Record<string, unknown>;
      const lineItems = getLineItems(extracted);
      const category = categoryById.get(String(bill.categoryId));
      const categorySlug = category?.slug ?? "unknown";
      const resolved = contactResolved.get(String(bill._id));
      const contactName = resolved?.name ?? bill.customProviderName ?? "Unknown";
      const invoiceDate =
        typeof extracted.invoice_date === "string" && extracted.invoice_date.trim().length > 0
          ? extracted.invoice_date
          : new Date(bill.uploadedAt).toISOString().slice(0, 10);

      // Check whole-invoice business_general (assignMode === "whole" and all items tagged)
      const isWholeBizGeneral = (bill as any).assignMode === "whole" &&
        lineItems.length > 0 &&
        lineItems.every((item: any) => String(item.assigneeType ?? "").toLowerCase() === "business_general");

      if (isWholeBizGeneral) {
        // Add as a single entry for the whole invoice
        const total = lineItems.reduce((sum: number, item: any) => sum + getLineItemTotalUsd(item as Record<string, unknown>), 0);
        businessGeneralItems.push({
          billId: String(bill._id),
          invoiceName: (bill as any).invoiceName || contactName,
          contactName,
          invoiceDate,
          categorySlug,
          lineDescription: `Whole invoice (${lineItems.length} items)`,
          lineAmount: total,
        });
      } else {
        // Check individual line items
        for (const item of lineItems) {
          const itemObj = item as Record<string, unknown>;
          if (String(itemObj.assigneeType ?? "").toLowerCase() === "business_general") {
            businessGeneralItems.push({
              billId: String(bill._id),
              invoiceName: (bill as any).invoiceName || contactName,
              contactName,
              invoiceDate,
              categorySlug,
              lineDescription: String(itemObj.description ?? "Line item"),
              lineAmount: getLineItemTotalUsd(itemObj),
            });
          }
        }
      }
    }
    businessGeneralItems.sort((a, b) => {
      const aTs = Date.parse(a.invoiceDate);
      const bTs = Date.parse(b.invoiceDate);
      return bTs - aTs;
    });
    const businessGeneralTotal = businessGeneralItems.reduce((sum, item) => sum + item.lineAmount, 0);

    return {
      totalSpend,
      previousPeriodSpend,
      invoiceCount,
      categoryCount,
      categories: categoriesRows,
      horses,
      people: peopleRows,
      recentInvoices,
      businessGeneral: {
        items: businessGeneralItems,
        total: businessGeneralTotal,
      },
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
    const resolved = await resolveContactForBill(ctx, bill as any);
    const vendor = null;
    const category = bill.categoryId ? await ctx.db.get(bill.categoryId) : null;
    const extracted = ((bill.extractedData ?? {}) as Record<string, unknown>) ?? {};
    const lineItems = Array.isArray(extracted.line_items)
      ? extracted.line_items
      : Array.isArray(extracted.lineItems)
        ? extracted.lineItems
        : [];
    const lineItemCats = (bill.lineItemCategories ?? []) as string[];
    const evc = bill.extractedVendorContact ?? (bill as any).extractedProviderContact;
    return {
      ...bill,
      vendor,
      category,
      extractedVendorContact: evc ? {
        ...evc,
        vendorName: evc.vendorName ?? evc.providerName,
      } : undefined,
      pdfStorageId: bill.fileId,
      contactName:
        resolved?.name ??
        bill.customProviderName ??
        (typeof extracted.contact_name === "string" ? extracted.contact_name : null),
      vendorDetected: Boolean(resolved),
      vendorConfirmed: Boolean(resolved),
      categorySlug: category?.slug ?? (lineItemCats.length > 0 ? lineItemCats[0] : null),
      lineItemCategories: lineItemCats,
      invoiceNumber:
        (typeof extracted.invoice_number === "string" ? extracted.invoice_number :
          typeof extracted.invoiceNumber === "string" ? extracted.invoiceNumber : null),
      date:
        (typeof extracted.invoice_date === "string" ? extracted.invoice_date :
          typeof extracted.invoiceDate === "string" ? extracted.invoiceDate : null),
      dueDate:
        (typeof extracted.due_date === "string" ? extracted.due_date :
          typeof extracted.dueDate === "string" ? extracted.dueDate : null),
      shipDate:
        (typeof extracted.ship_date === "string" ? extracted.ship_date :
          typeof extracted.shipDate === "string" ? extracted.shipDate : null),
      origin: typeof extracted.origin === "string" ? extracted.origin : null,
      destination: typeof extracted.destination === "string" ? extracted.destination : null,
      route: typeof extracted.route === "string" ? extracted.route : null,
      total:
        typeof extracted.invoice_total_usd === "number" ? extracted.invoice_total_usd :
          typeof extracted.invoiceTotalUsd === "number" ? extracted.invoiceTotalUsd :
            typeof extracted.total === "number" ? extracted.total : null,
      subtotal:
        typeof extracted.subtotal === "number" ? extracted.subtotal :
          typeof extracted.sub_total === "number" ? extracted.sub_total : null,
      tax:
        typeof extracted.tax_total_usd === "number" ? extracted.tax_total_usd :
          typeof extracted.tax === "number" ? extracted.tax : null,
      lineItems
    };
  }
});

export const getById = query({
  args: { billId: v.id("bills") },
  handler: async (ctx, args) => {
    const bill = await ctx.db.get(args.billId);
    if (!bill) return null;
    const resolved = await resolveContactForBill(ctx, bill as any);
    const vendor = null;
    const category = bill.categoryId ? await ctx.db.get(bill.categoryId) : null;
    const extracted = ((bill.extractedData ?? {}) as Record<string, unknown>) ?? {};
    const lineItems = Array.isArray(extracted.line_items)
      ? extracted.line_items
      : Array.isArray(extracted.lineItems)
        ? extracted.lineItems
        : [];
    const evc2 = bill.extractedVendorContact ?? (bill as any).extractedProviderContact;
    return {
      ...bill,
      vendor,
      category,
      extractedVendorContact: evc2 ? {
        ...evc2,
        vendorName: evc2.vendorName ?? evc2.providerName,
      } : undefined,
      pdfStorageId: bill.fileId,
      contactName:
        resolved?.name ??
        bill.customProviderName ??
        (typeof extracted.contact_name === "string" ? extracted.contact_name : null),
      vendorDetected: Boolean(resolved),
      vendorConfirmed: Boolean(resolved),
      categorySlug: category?.slug ?? ((bill.lineItemCategories as string[] | undefined)?.[0] ?? null),
      lineItemCategories: (bill.lineItemCategories ?? []) as string[],
      invoiceNumber:
        (typeof extracted.invoice_number === "string" ? extracted.invoice_number :
          typeof extracted.invoiceNumber === "string" ? extracted.invoiceNumber : null),
      date:
        (typeof extracted.invoice_date === "string" ? extracted.invoice_date :
          typeof extracted.invoiceDate === "string" ? extracted.invoiceDate : null),
      dueDate:
        (typeof extracted.due_date === "string" ? extracted.due_date :
          typeof extracted.dueDate === "string" ? extracted.dueDate : null),
      shipDate:
        (typeof extracted.ship_date === "string" ? extracted.ship_date :
          typeof extracted.shipDate === "string" ? extracted.shipDate : null),
      origin: typeof extracted.origin === "string" ? extracted.origin : null,
      destination: typeof extracted.destination === "string" ? extracted.destination : null,
      route: typeof extracted.route === "string" ? extracted.route : null,
      total:
        typeof extracted.invoice_total_usd === "number" ? extracted.invoice_total_usd :
          typeof extracted.invoiceTotalUsd === "number" ? extracted.invoiceTotalUsd :
            typeof extracted.total === "number" ? extracted.total : null,
      subtotal:
        typeof extracted.subtotal === "number" ? extracted.subtotal :
          typeof extracted.sub_total === "number" ? extracted.sub_total : null,
      tax:
        typeof extracted.tax_total_usd === "number" ? extracted.tax_total_usd :
          typeof extracted.tax === "number" ? extracted.tax : null,
      lineItems
    };
  }
});

export const getContactStats = query({
  args: { contactId: v.id("contacts") },
  handler: async (ctx, args) => {
    const bills = await ctx.db
      .query("bills")
      .withIndex("by_contact", (q) => q.eq("contactId", args.contactId))
      .filter((q) => q.and(q.eq(q.field("status"), "done"), q.eq(q.field("isApproved"), true)))
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

export const getBillsByContact = query({
  args: {
    contactId: v.id("contacts"),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const bills = await ctx.db
      .query("bills")
      .withIndex("by_contact", (q) => q.eq("contactId", args.contactId))
      .order("desc")
      .take(args.limit ?? 100);

    return bills;
  }
});

/** Get contact cost summary — total and breakdown by line-item category */
export const getContactCostSummary = query({
  args: { contactId: v.id("contacts") },
  handler: async (ctx, args) => {
    const bills = await ctx.db
      .query("bills")
      .withIndex("by_contact", (q) => q.eq("contactId", args.contactId))
      .collect();
    const approvedBills = bills.filter((b) => b.status === "done" || b.isApproved);
    let totalSpend = 0;
    const categoryBreakdown: Record<string, number> = {};
    for (const bill of approvedBills) {
      const extracted = (bill.extractedData ?? {}) as Record<string, unknown>;
      const lineItems = Array.isArray(extracted.line_items) ? extracted.line_items : [];
      for (const item of lineItems) {
        const row = item as Record<string, unknown>;
        const amount = typeof row.total_usd === "number" ? row.total_usd : 0;
        const cat = typeof row.category === "string" ? row.category : "uncategorized";
        totalSpend += amount;
        categoryBreakdown[cat] = (categoryBreakdown[cat] ?? 0) + amount;
      }
      // Fallback: if no line items, use invoice total
      if (lineItems.length === 0) {
        const invoiceTotal = typeof extracted.invoice_total_usd === "number" ? extracted.invoice_total_usd : 0;
        totalSpend += invoiceTotal;
        const cats = (bill.lineItemCategories ?? []) as string[];
        const cat = cats[0] ?? "uncategorized";
        categoryBreakdown[cat] = (categoryBreakdown[cat] ?? 0) + invoiceTotal;
      }
    }
    return {
      totalSpend: Math.round(totalSpend * 100) / 100,
      invoiceCount: approvedBills.length,
      categoryBreakdown: Object.entries(categoryBreakdown)
        .map(([category, amount]) => ({ category, amount: Math.round(amount * 100) / 100 }))
        .sort((a, b) => b.amount - a.amount),
    };
  }
});

export const getBill = internalQuery({
  args: { billId: v.id("bills") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.billId);
  }
});

export const getCategory = internalQuery({
  args: { categoryId: v.id("categories") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.categoryId);
  }
});

export const getCategoryBySlug = internalQuery({
  args: { slug: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db.query("categories").withIndex("by_slug", (q) => q.eq("slug", args.slug)).first();
  }
});

export const getBillFileNamesByContact = internalQuery({
  args: { contactId: v.optional(v.id("contacts")) },
  handler: async (ctx, args) => {
    if (!args.contactId) return [];
    const bills = await ctx.db.query("bills").withIndex("by_contact", (q) => q.eq("contactId", args.contactId)).collect();
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
    contactId: v.optional(v.id("contacts")),
    categoryId: v.optional(v.id("categories")),
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
    adminSubcategory: v.optional(v.string()),
    duesSubcategory: v.optional(v.string()),
    groomingSubcategory: v.optional(v.string())
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("bills", {
      ...(args.contactId ? { contactId: args.contactId } : {}),
      ...(args.categoryId ? { categoryId: args.categoryId } : {}),
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
      adminSubcategory: args.adminSubcategory,
      duesSubcategory: args.duesSubcategory,
      groomingSubcategory: args.groomingSubcategory
    });
  }
});

/**
 * Recompute a bill's derived fields (fileName, categoryId, invoiceName)
 * to match whichever contact is currently assigned. Writes only the fields
 * that change, leaves anything else alone. Safe to call from any mutation
 * that mutates contactId on a bill.
 */
async function syncBillDerivedFields(
  ctx: any,
  bill: any,
  args: { contactId?: string | null; fallbackCustomProviderName?: string }
) {
  const patch: Record<string, unknown> = {};

  // Resolve the contact (if any) and the effective display name
  let contact: any = null;
  if (args.contactId) contact = await ctx.db.get(args.contactId);

  const contactName =
    contact?.name ??
    args.fallbackCustomProviderName ??
    bill.customProviderName ??
    "Other";

  // Sync categoryId to the contact's own category (slug -> category row)
  if (contact?.category) {
    const cat = await ctx.db
      .query("categories")
      .withIndex("by_slug", (q: any) => q.eq("slug", contact.category))
      .first();
    if (cat && String(cat._id) !== String(bill.categoryId ?? "")) {
      patch.categoryId = cat._id;
    }
  }

  // Look up the current category name (either newly patched or existing)
  const effectiveCategoryId = patch.categoryId ?? bill.categoryId;
  const effectiveCategory = effectiveCategoryId ? await ctx.db.get(effectiveCategoryId) : null;
  const categoryName = (effectiveCategory as any)?.name ?? "Invoice";

  // Compute the ISO date for the filename — prefer the extracted invoice_date,
  // fall back to uploadedAt.
  const extracted = (bill.extractedData ?? {}) as Record<string, unknown>;
  const invoiceDateRaw =
    (typeof extracted.invoice_date === "string" ? extracted.invoice_date : null) ??
    (typeof extracted.invoiceDate === "string" ? extracted.invoiceDate : null);
  let isoDate = "";
  if (invoiceDateRaw) {
    const d = new Date(invoiceDateRaw);
    if (!Number.isNaN(d.getTime())) isoDate = d.toISOString().slice(0, 10);
  }
  if (!isoDate) isoDate = new Date(bill.uploadedAt).toISOString().slice(0, 10);

  const newFileName = `${categoryName} - ${contactName} - ${isoDate}`;
  if (newFileName !== bill.fileName) patch.fileName = newFileName;

  // Clear invoiceName so the invoice list falls back to formatInvoiceName
  // with the current contact — this prevents stale names from a previous
  // contact leaking through when the user re-assigns.
  if (bill.invoiceName) patch.invoiceName = undefined;

  if (Object.keys(patch).length > 0) {
    await ctx.db.patch(bill._id, patch);
  }
}

export const reassignBillContact = internalMutation({
  args: {
    billId: v.id("bills"),
    categoryId: v.optional(v.id("categories")),
    contactId: v.optional(v.id("contacts")),
    customProviderName: v.optional(v.string()),
    adminSubcategory: v.optional(v.string()),
    duesSubcategory: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db.get(args.billId);
    if (!existing) throw new Error("Bill not found");

    // Only wipe extractedData + set status=parsing when we can actually
    // re-parse a PDF. CC-reconcile bills (and any other bill without a fileId)
    // don't have a PDF to re-parse, so nuking extractedData would leave them
    // permanently empty (→ $0 totals, no line items).
    const hasPdf = Boolean(existing.fileId);

    const patch: Record<string, unknown> = {
      contactId: args.contactId,
      customProviderName: args.contactId ? undefined : args.customProviderName,
      adminSubcategory: args.adminSubcategory,
      duesSubcategory: args.duesSubcategory,
    };
    if (hasPdf) {
      patch.status = "parsing";
      patch.extractedData = undefined;
    }
    if (args.categoryId) patch.categoryId = args.categoryId;
    await ctx.db.patch(args.billId, patch);

    // Now sync derived fields (fileName/categoryId/invoiceName) to the new contact
    const refreshed = await ctx.db.get(args.billId);
    if (refreshed) {
      await syncBillDerivedFields(ctx, refreshed, {
        contactId: args.contactId ? String(args.contactId) : undefined,
        fallbackCustomProviderName: args.customProviderName,
      });
    }
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
    adminSubcategory: v.optional(v.string()),
    duesSubcategory: v.optional(v.string()),
    groomingSubcategory: v.optional(v.string()),
    contactId: v.optional(v.id("contacts")),
    customProviderName: v.optional(v.string()),
    extractedVendorContact: v.optional(
      v.object({
        vendorName: v.optional(v.string()),
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
          role: v.optional(v.union(v.literal("rider"), v.literal("groom"), v.literal("freelance"), v.literal("trainer"), v.literal("admin")))
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
              role: v.union(v.literal("rider"), v.literal("groom"), v.literal("freelance"), v.literal("trainer"), v.literal("admin")),
              amount: v.number()
            })
          )
        })
      )
    ),
    originalCurrency: v.optional(v.string()),
    originalTotal: v.optional(v.number()),
    exchangeRate: v.optional(v.number()),
    discount: v.optional(v.number()),
    isApproved: v.optional(v.boolean()),
    hasUnmatchedHorses: v.optional(v.boolean()),
    unmatchedHorseNames: v.optional(v.array(v.string())),
    lineItemCategories: v.optional(v.array(v.string())),
    inferredCategoryId: v.optional(v.id("categories"))
  },
  handler: async (ctx, args) => {
    const patch: Record<string, unknown> = {
      status: args.status,
      errorMessage: undefined,
      extractedData: args.extractedData,
      travelSubcategory: args.travelSubcategory,
      housingSubcategory: args.housingSubcategory,
      horseTransportSubcategory: args.horseTransportSubcategory,
      marketingSubcategory: args.marketingSubcategory,
      adminSubcategory: args.adminSubcategory,
      duesSubcategory: args.duesSubcategory,
      groomingSubcategory: args.groomingSubcategory,
      contactId: args.contactId,
      customProviderName: args.customProviderName,
      extractedVendorContact: args.extractedVendorContact,
      horseAssignments: args.horseAssignments,
      splitLineItems: args.splitLineItems,
      personAssignments: args.personAssignments,
      splitPersonLineItems: args.splitPersonLineItems,
      hasUnmatchedHorses: args.hasUnmatchedHorses,
      unmatchedHorseNames: args.unmatchedHorseNames,
      originalCurrency: args.originalCurrency,
      originalTotal: args.originalTotal,
      exchangeRate: args.exchangeRate,
      discount: args.discount,
      isApproved: args.isApproved
    };
    if (args.lineItemCategories) {
      patch.lineItemCategories = args.lineItemCategories;
    }
    if (args.inferredCategoryId) {
      patch.categoryId = args.inferredCategoryId;
    }

    // Update fileName to use parsed invoice date instead of upload date
    const bill = await ctx.db.get(args.billId);
    if (bill) {
      const extracted = (args.extractedData ?? {}) as Record<string, unknown>;
      const invoiceDateRaw = typeof extracted.invoice_date === "string"
        ? extracted.invoice_date
        : typeof extracted.invoiceDate === "string"
          ? extracted.invoiceDate
          : null;
      if (invoiceDateRaw) {
        const parsed = new Date(invoiceDateRaw);
        if (!Number.isNaN(parsed.getTime())) {
          const isoDate = parsed.toISOString().slice(0, 10);
          // Derive provider display name
          const contactName = args.customProviderName
            ?? args.extractedVendorContact?.vendorName
            ?? null;
          const currentParts = bill.fileName.split(" - ");
          const categoryPart = currentParts[0] ?? "Invoice";
          const namePart = contactName ?? (currentParts.length >= 2 ? currentParts[1] : "Other");
          const suffix = currentParts.length >= 4 ? `-${currentParts[3]}` : "";
          const newBaseName = `${categoryPart} - ${namePart} - ${isoDate}${suffix}`;
          patch.fileName = newBaseName;
          // Also update billingPeriod to match invoice date
          patch.billingPeriod = isoDate.slice(0, 7);
        }
      }
    }

    await ctx.db.patch(args.billId, patch);
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
    horseSplitType: v.optional(v.union(v.literal("single"), v.literal("split"))),
    assignedHorses: v.optional(
      v.array(
        v.object({
          horseId: v.id("horses"),
          horseName: v.string(),
          amount: v.number(),
          direct: v.optional(v.number()),
          shared: v.optional(v.number())
        })
      )
    ),
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
      horseSplitType: args.horseSplitType,
      assignedHorses: args.assignedHorses,
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
        role: v.optional(v.union(v.literal("rider"), v.literal("groom"), v.literal("freelance"), v.literal("trainer"), v.literal("admin")))
      })
    ),
    splitPersonLineItems: v.array(
      v.object({
        lineItemIndex: v.number(),
        splits: v.array(
          v.object({
            personId: v.id("people"),
            personName: v.string(),
            role: v.union(v.literal("rider"), v.literal("groom"), v.literal("freelance"), v.literal("trainer"), v.literal("admin")),
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

export const saveDuesAssignments = mutation({
  args: {
    billId: v.id("bills"),
    assignments: v.array(
      v.object({
        lineItemIndex: v.number(),
        entityType: v.union(v.literal("horse"), v.literal("person"), v.literal("general"), v.literal("none")),
        entityId: v.optional(v.string()),
        entityName: v.optional(v.string())
      })
    )
  },
  handler: async (ctx, args) => {
    const bill = await ctx.db.get(args.billId);
    if (!bill) throw new Error("Bill not found");
    const extracted = ((bill.extractedData ?? {}) as Record<string, unknown>) ?? {};
    const lineItems = getLineItems(extracted).map((item) => ({ ...(item as Record<string, unknown>) }));

    for (const row of args.assignments) {
      if (!lineItems[row.lineItemIndex]) continue;
      lineItems[row.lineItemIndex].entityType = row.entityType === "none" ? null : row.entityType;
      lineItems[row.lineItemIndex].entityId = row.entityType === "none" ? null : (row.entityId ?? null);
      lineItems[row.lineItemIndex].entityName = row.entityType === "none" ? null : (row.entityName ?? null);
    }

    await ctx.db.patch(args.billId, {
      extractedData: {
        ...extracted,
        line_items: lineItems
      }
    });
    return args.billId;
  }
});

export const updatePreviewFields = mutation({
  args: {
    billId: v.id("bills"),
    invoiceNumber: v.optional(v.string()),
    invoiceDate: v.optional(v.string()),
    dueDate: v.optional(v.string()),
    shipDate: v.optional(v.string()),
    terms: v.optional(v.string()),
    transactionId: v.optional(v.string()),
    customerId: v.optional(v.string()),
    invoiceName: v.optional(v.string()),
    totalUsd: v.optional(v.number()),
    origin: v.optional(v.string()),
    destination: v.optional(v.string()),
    extractedVendorContact: v.optional(
      v.object({
        vendorName: v.optional(v.string()),
        contactName: v.optional(v.string()),
        address: v.optional(v.string()),
        phone: v.optional(v.string()),
        email: v.optional(v.string()),
        website: v.optional(v.string()),
        accountNumber: v.optional(v.string()),
      })
    ),
  },
  handler: async (ctx, args) => {
    const bill = await ctx.db.get(args.billId);
    if (!bill) throw new Error("Bill not found");

    if (args.extractedVendorContact !== undefined) {
      await ctx.db.patch(args.billId, { extractedVendorContact: args.extractedVendorContact });
    }
    if (args.invoiceName !== undefined) {
      const trimmed = args.invoiceName.trim() || undefined;
      await ctx.db.patch(args.billId, { invoiceName: trimmed });
    }

    const extracted = ((bill.extractedData ?? {}) as Record<string, unknown>) ?? {};
    const next = { ...extracted } as Record<string, unknown>;
    if (args.invoiceNumber !== undefined) {
      next.invoice_number = args.invoiceNumber;
      next.invoiceNumber = args.invoiceNumber;
    }
    if (args.invoiceDate !== undefined) {
      next.invoice_date = args.invoiceDate;
      next.invoiceDate = args.invoiceDate;
    }
    if (args.dueDate !== undefined) {
      next.due_date = args.dueDate;
      next.dueDate = args.dueDate;
    }
    if (args.shipDate !== undefined) {
      next.ship_date = args.shipDate;
      next.shipDate = args.shipDate;
    }
    if (args.terms !== undefined) {
      next.terms = args.terms;
    }
    if (args.transactionId !== undefined) {
      next.transaction_id = args.transactionId;
      next.transactionId = args.transactionId;
    }
    if (args.customerId !== undefined) {
      next.customer_id = args.customerId;
      next.customerId = args.customerId;
    }
    if (args.totalUsd !== undefined && Number.isFinite(args.totalUsd)) {
      next.invoice_total_usd = args.totalUsd;
      next.invoiceTotalUsd = args.totalUsd;
      next.total = args.totalUsd;
    }
    if (args.origin !== undefined) next.origin = args.origin;
    if (args.destination !== undefined) next.destination = args.destination;
    if (args.origin !== undefined || args.destination !== undefined) {
      const origin = String(next.origin ?? "").trim();
      const destination = String(next.destination ?? "").trim();
      next.route = origin && destination ? `${origin} -> ${destination}` : next.route;
    }

    await ctx.db.patch(args.billId, { extractedData: next });
    return args.billId;
  }
});

export const updateBillContact = mutation({
  args: {
    billId: v.id("bills"),
    contactId: v.optional(v.id("contacts")),
    extractedVendorContact: v.optional(
      v.object({
        vendorName: v.optional(v.string()),
        contactName: v.optional(v.string()),
        address: v.optional(v.string()),
        phone: v.optional(v.string()),
        email: v.optional(v.string()),
        website: v.optional(v.string()),
        accountNumber: v.optional(v.string()),
      })
    ),
  },
  handler: async (ctx, args) => {
    const bill = await ctx.db.get(args.billId);
    if (!bill) throw new Error("Bill not found");
    const contactChanged =
      args.contactId !== undefined && String(args.contactId ?? "") !== String(bill.contactId ?? "");
    const patch: Record<string, unknown> = {};
    if (args.contactId !== undefined) patch.contactId = args.contactId;
    if (args.extractedVendorContact !== undefined) patch.extractedVendorContact = args.extractedVendorContact;
    await ctx.db.patch(args.billId, patch);

    // If the contact changed, resync derived fields (category, fileName,
    // invoiceName) so the invoices list, contact page, and preview all
    // reflect the new contact — not whichever one the parser originally
    // matched.
    if (contactChanged) {
      const refreshed = await ctx.db.get(args.billId);
      if (refreshed) {
        await syncBillDerivedFields(ctx, refreshed, {
          contactId: args.contactId ? String(args.contactId) : undefined,
        });
      }
    }

    return args.billId;
  }
});

export const updateBillNotes = mutation({
  args: { billId: v.id("bills"), notes: v.string() },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.billId, { notes: args.notes.trim() || undefined });
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
  if (bill.hasUnmatchedHorses && bill.categoryId) {
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

  // Auto-insert charges into any existing draft owner invoices that cover
  // this bill's period, so drafts stay in sync as bills are approved.
  try {
    await syncApprovedBillIntoDraftInvoices(ctx, billId);
  } catch (err) {
    console.error("syncApprovedBillIntoDraftInvoices failed", err);
  }

  // Schedule Dropbox upload in the background
  await ctx.scheduler.runAfter(0, internal.dropbox.uploadInvoiceToDropbox, { billId });

  return billId;
}

export const approveBill = mutation({
  args: {
    billId: v.id("bills"),
    lineItems: v.optional(v.array(v.any())),
    assignMode: v.optional(v.union(v.literal("line"), v.literal("whole"))),
    assignType: v.optional(v.union(v.literal("horse"), v.literal("person"))),
    splitEntities: v.optional(
      v.array(
        v.object({
          entityId: v.string(),
          entityName: v.string(),
          amount: v.number()
        })
      )
    ),
    splitMode: v.optional(v.union(v.literal("even"), v.literal("custom"))),
    notes: v.optional(v.string())
  },
  handler: async (ctx, args) => {
    const bill = await ctx.db.get(args.billId);
    if (!bill) throw new Error("Bill not found");

    const patch: Record<string, unknown> = {
      assignMode: args.assignMode,
      assignType: args.assignType,
      splitMode: args.splitMode,
    };
    if (args.notes !== undefined) {
      patch.notes = args.notes.trim() || undefined;
    }
    await ctx.db.patch(args.billId, patch);

    if (args.lineItems) {
      const freshBill = await ctx.db.get(args.billId);
      const extracted = ((freshBill ?? bill).extractedData ?? {}) as Record<string, unknown>;
      const existingLineItems = getLineItems(extracted);
      const mergedLineItems = args.lineItems.map((item: any, index: number) => {
        const existing = existingLineItems[index] as Record<string, unknown> | undefined;
        return {
          ...item,
          entityType: item.entityType ?? existing?.entityType ?? undefined,
          entityId: item.entityId ?? existing?.entityId ?? undefined,
          entityName: item.entityName ?? existing?.entityName ?? undefined
        };
      });
      // Recalculate total from confirmed line items only
      const confirmedTotal = mergedLineItems
        .filter((item: any) => item.confirmed !== false)
        .reduce((sum: number, item: any) => {
          const amt = typeof item.amount === "number" ? item.amount
            : typeof item.total_usd === "number" ? item.total_usd
            : typeof item.total === "number" ? item.total
            : 0;
          return sum + amt;
        }, 0);

      await ctx.db.patch(args.billId, {
        extractedData: {
          ...extracted,
          line_items: mergedLineItems,
          invoice_total_usd: Math.round(confirmedTotal * 100) / 100,
        }
      });

      // Update bill category based on line item categories if they differ from current
      const lineCategories = new Map<string, number>();
      for (const item of mergedLineItems) {
        const cat = typeof item.category === "string" ? item.category.toLowerCase().replace(/\s+/g, "-") : null;
        if (cat) lineCategories.set(cat, (lineCategories.get(cat) || 0) + 1);
      }
      if (lineCategories.size > 0) {
        const dominant = [...lineCategories.entries()].sort((a, b) => b[1] - a[1])[0][0];
        const currentCategory = bill.categoryId ? await ctx.db.get(bill.categoryId) : null;
        if (!currentCategory || currentCategory.slug !== dominant) {
          const newCategory = await ctx.db.query("categories").withIndex("by_slug", (q) => q.eq("slug", dominant)).first();
          if (newCategory) {
            await ctx.db.patch(args.billId, { categoryId: newCategory._id });
          }
        }
      }
    }

    // Auto-resolve contactId from extractedVendorContact if missing
    const latestBill = await ctx.db.get(args.billId);
    const vendorContact = latestBill?.extractedVendorContact ?? (latestBill as any)?.extractedProviderContact;
    if (latestBill && !latestBill.contactId && vendorContact) {
      const provName = vendorContact.vendorName ?? vendorContact.providerName;
      if (provName) {
        const allContacts = await ctx.db.query("contacts").collect();
        const match = allContacts.find((c) => c.name?.toLowerCase() === provName.toLowerCase());
        if (match) {
          await ctx.db.patch(args.billId, { contactId: match._id });
        } else {
          // Create a new contact from the extracted info
          const epc = vendorContact as any;
          const category = latestBill.categoryId ? await ctx.db.get(latestBill.categoryId) : null;
          const newContactId = await ctx.db.insert("contacts", {
            name: provName,
            slug: slugify(provName),
            category: (category as any)?.slug ?? "other",
            phone: epc.phone ?? undefined,
            email: epc.email ?? undefined,
            address: epc.address ?? undefined,
            website: epc.website ?? undefined,
            accountNumber: epc.accountNumber ?? undefined,
            createdAt: Date.now(),
          });
          await ctx.db.patch(args.billId, { contactId: newContactId });
        }
      }
    }

    const result = await approveBillById(ctx, args.billId);
    return result;
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
    const category = bill.categoryId ? await ctx.db.get(bill.categoryId) : null;
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

    const sourceContact = bill.contactId ? await ctx.db.get(bill.contactId) : null;
    const sourceProviderName = sourceContact?.name ?? bill.customProviderName;
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
        try { await ctx.storage.delete(fileId as Id<"_storage">); } catch {}
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
        try { await ctx.storage.delete(fileId as Id<"_storage">); } catch {}
      }
      return { deleted: true };
    }

    await ctx.db.delete(args.billId);
    for (const fileId of fileIdsToDelete) {
      try { await ctx.storage.delete(fileId as Id<"_storage">); } catch {}
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
  const bills = (await ctx.db.query("bills").withIndex("by_category", (q: any) => q.eq("categoryId", categoryId)).collect()).filter(isApprovedBill);
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

function isApprovedBill(bill: { status?: string; isApproved?: boolean }) {
  return bill.status === "done" && bill.isApproved === true;
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
  if (typeof record.amount === "number" && Number.isFinite(record.amount)) return record.amount;
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
  if (categorySlug === "grooming" || categorySlug === "admin") {
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
  if (categorySlug === "dues-registrations") {
    const names = new Set<string>();
    const lineItems = getLineItems(bill.extractedData);
    for (const item of lineItems) {
      if (!item || typeof item !== "object") continue;
      const row = item as Record<string, unknown>;
      const entityName = pickString(row, ["entityName", "entity_name"]);
      if (entityName) names.add(entityName);
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
    admin: "#6B7084",
    "dues-registrations": "#22C583",
    grooming: "#4A5BDB",
    stabling: "#F59E0B",
    travel: "#EC4899",
    housing: "#A78BFA",
    "entry-fees": "#EF4444",
    "tack-equipment": "#6B7084",
    insurance: "#22C583",
    "prize-money": "#22C55E",
    "riding-training": "#EC4899",
    income: "#16A34A",
    equity: "#8B5CF6",
  };
  return map[slug] ?? "#6B7084";
}

/** Temporary mutation to fix fileName on bills */
export const fixBillFileName = mutation({
  args: {
    billId: v.id("bills"),
    fileName: v.string(),
  },
  handler: async (ctx, args) => {
    const bill = await ctx.db.get(args.billId);
    if (!bill) throw new Error("Bill not found");
    await ctx.db.patch(args.billId, { fileName: args.fileName });
    return { patched: true, oldFileName: bill.fileName };
  },
});

