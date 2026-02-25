import Anthropic from "@anthropic-ai/sdk";
import { v } from "convex/values";
import { action, internalAction, internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";

const TRAVEL_SUBCATEGORY_SLUGS = new Set(["flights", "trains", "rental-car", "gas", "meals", "hotels"]);

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

  const providerIds = [...new Set(bills.map((bill) => bill.providerId))];
  const providerPairs = await Promise.all(providerIds.map(async (id) => [id, await ctx.db.get(id)] as const));
  const providerMap = new Map(providerPairs.map(([id, provider]) => [id, provider?.name ?? "Unknown"]));

  const categoryIds = [...new Set(bills.map((bill) => bill.categoryId))];
  const categoryPairs = await Promise.all(categoryIds.map(async (id) => [id, await ctx.db.get(id)] as const));
  const categoryMap = new Map(categoryPairs.map(([id, category]) => [id, category?.name ?? "Unknown"]));

  return bills.map((bill) => ({
    ...bill,
    providerName: providerMap.get(bill.providerId) ?? "Unknown",
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
        const provider = await ctx.db.get(bill.providerId);
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
          providerName: provider?.name ?? "Unknown",
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
    const provider = await ctx.db.get(bill.providerId);
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

    const provider = await ctx.runQuery(internal.bills.getProvider, { providerId: bill.providerId });
    if (!provider) throw new Error("Provider not found");
    const category = await ctx.runQuery(internal.bills.getCategory, { categoryId: bill.categoryId });
    if (!category) throw new Error("Category not found");

    try {
      const blob = await ctx.storage.get(bill.fileId);
      if (!blob) throw new Error("PDF file not found in storage");

      const bytes = await blob.arrayBuffer();
      const base64Pdf = Buffer.from(bytes).toString("base64");

      const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
      const prompt = `${provider.extractionPrompt}\n\nReturn strict JSON.`;

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

      const missingFields = provider.expectedFields.filter((field: string) => {
        if (field === "horse_name") {
          return !hasHorseNameInLineItems(parsed);
        }
        const value = parsed[field];
        return value === undefined || value === null || value === "";
      });

      if (missingFields.length > 0) {
        throw new Error(`Missing expected parsed fields: ${missingFields.join(", ")}`);
      }

      const isTravel = category.slug === "travel";
      const status = isTravel ? "pending" : "done";
      const travelMeta = isTravel ? extractTravelMeta(parsed, provider?.slug ?? provider?.name) : {};

      await ctx.runMutation(internal.bills.markDone, {
        billId: bill._id,
        extractedData: parsed,
        status,
        ...travelMeta
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
    providerId: v.id("providers"),
    categoryId: v.id("categories"),
    fileId: v.id("_storage"),
    fileName: v.string(),
    billingPeriod: v.string(),
    uploadedAt: v.number(),
    originalPdfUrl: v.optional(v.string()),
    travelSubcategory: v.optional(v.string())
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
      originalPdfUrl: args.originalPdfUrl,
      travelSubcategory: args.travelSubcategory
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
