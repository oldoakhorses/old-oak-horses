"use node";

import Anthropic from "@anthropic-ai/sdk";
import { v } from "convex/values";
import { action, internalAction } from "./_generated/server";
import { internal } from "./_generated/api";

const TRAVEL_SUBCATEGORY_SLUGS = new Set(["flights", "trains", "rental-car", "gas", "meals", "hotels"]);
const HOUSING_SUBCATEGORY_SLUGS = new Set(["rider-housing", "groom-housing"]);
const MARKETING_SUBCATEGORY_SLUGS = new Set(["vip-tickets", "photography", "social-media"]);
const SALARIES_SUBCATEGORY_SLUGS = new Set(["rider", "groom", "freelance"]);
const RECLASSIFICATION_SOURCE_CATEGORIES = new Set(["stabling", "show-expenses", "feed-bedding"]);

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
      annotateSuggestedCategories(parsed, category.slug);

      let resolvedProvider = provider;
      if (category.slug === "marketing" && !resolvedProvider && !bill.customProviderName) {
        const extractedProviderName = pickString(parsed, ["provider_name", "vendor_name", "supplier_name", "merchant_name"]);
        if (extractedProviderName) {
          const existingProvider = await ctx.runQuery(internal.providers.getProviderByNameInCategoryInternal, {
            categoryId: bill.categoryId,
            name: extractedProviderName
          });
          const providerId =
            existingProvider?._id ??
            (await ctx.runMutation(internal.providers.createProviderOnUploadInternal, {
              categoryId: bill.categoryId,
              name: extractedProviderName
            }));
          resolvedProvider = existingProvider ?? (await ctx.runQuery(internal.bills.getProvider, { providerId }));
        }
      }

      const expectedFields = resolvedProvider?.expectedFields ?? [];
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

      const needsApproval =
        category.slug === "travel" ||
        category.slug === "housing" ||
        category.slug === "stabling" ||
        category.slug === "marketing" ||
        category.slug === "bodywork" ||
        category.slug === "feed-bedding" ||
        category.slug === "salaries";
      const needsApprovalWithTransport = needsApproval || category.slug === "horse-transport";
      const status = needsApprovalWithTransport ? "pending" : "done";
      const categoryMeta =
        category.slug === "travel"
          ? extractTravelMeta(parsed, resolvedProvider?.slug ?? resolvedProvider?.name)
          : category.slug === "housing"
            ? extractHousingMeta(parsed, resolvedProvider?.slug ?? resolvedProvider?.name)
            : category.slug === "stabling"
              ? extractStablingMeta(parsed)
              : category.slug === "horse-transport"
                ? extractHorseTransportMeta(parsed, bill.horseTransportSubcategory)
              : category.slug === "marketing"
                ? extractMarketingMeta(parsed, bill.marketingSubcategory)
                : category.slug === "salaries"
                  ? extractSalariesMeta(parsed, bill.salariesSubcategory)
              : {};

      await ctx.runMutation(internal.bills.markDone, {
        billId: bill._id,
        extractedData: parsed,
        status,
        providerId: resolvedProvider?._id,
        ...categoryMeta
      });

      const providerContactPatch = extractProviderContactInfo(parsed);
      if (resolvedProvider && Object.values(providerContactPatch).some((value) => value !== undefined)) {
        await ctx.runMutation(internal.bills.updateProviderContactInfo, {
          providerId: resolvedProvider._id,
          fullName: resolvedProvider.fullName ?? providerContactPatch.fullName,
          primaryContactName: resolvedProvider.primaryContactName ?? providerContactPatch.primaryContactName,
          primaryContactPhone: resolvedProvider.primaryContactPhone ?? providerContactPatch.primaryContactPhone,
          address: resolvedProvider.address ?? providerContactPatch.address,
          phone: resolvedProvider.phone ?? providerContactPatch.phone,
          email: resolvedProvider.email ?? providerContactPatch.email,
          accountNumber: resolvedProvider.accountNumber ?? providerContactPatch.accountNumber
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown parse error";
      await ctx.runMutation(internal.bills.markError, { billId: bill._id, errorMessage: message });
      throw error;
    }
  }
});

export const parseBillNow = action({
  args: { billId: v.id("bills") },
  handler: async (ctx, args) => {
    await ctx.runAction(internal.billParsing.parseBillPdf, { billId: args.billId });
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

function getLineItems(extractedData: unknown) {
  if (!extractedData || typeof extractedData !== "object") return [] as unknown[];
  const extracted = extractedData as { line_items?: unknown; lineItems?: unknown };
  if (Array.isArray(extracted.line_items)) return extracted.line_items;
  if (Array.isArray(extracted.lineItems)) return extracted.lineItems;
  return [] as unknown[];
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

function extractHorseTransportMeta(parsed: Record<string, unknown>, billSubcategory: string | undefined) {
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
    horseTransportSubcategory: billSubcategory,
    horseAssignments,
    splitLineItems: [] as any[],
    originalCurrency,
    originalTotal,
    exchangeRate,
    isApproved: false
  };
}

function extractMarketingMeta(parsed: Record<string, unknown>, billSubcategory: string | undefined) {
  const originalCurrency = pickString(parsed, ["original_currency", "currency"])?.toUpperCase();
  const originalTotal = pickNumber(parsed, ["original_total", "invoice_total_original"]);
  const exchangeRate = pickNumber(parsed, ["exchange_rate", "exchange_rate_used"]);
  const parsedSubcategory = slugify(pickString(parsed, ["marketing_subcategory", "subcategory"]) ?? "");
  const marketingSubcategory = MARKETING_SUBCATEGORY_SLUGS.has(parsedSubcategory)
    ? parsedSubcategory
    : billSubcategory ?? "other";
  return {
    marketingSubcategory,
    originalCurrency,
    originalTotal,
    exchangeRate,
    isApproved: false
  };
}

function extractSalariesMeta(parsed: Record<string, unknown>, billSubcategory: string | undefined) {
  const originalCurrency = pickString(parsed, ["original_currency", "currency"])?.toUpperCase();
  const originalTotal = pickNumber(parsed, ["original_total", "invoice_total_original"]);
  const exchangeRate = pickNumber(parsed, ["exchange_rate", "exchange_rate_used"]);
  const parsedSubcategory = slugify(pickString(parsed, ["salary_subcategory", "salaries_subcategory", "subcategory"]) ?? "");
  const salariesSubcategory = SALARIES_SUBCATEGORY_SLUGS.has(parsedSubcategory) ? parsedSubcategory : billSubcategory ?? "other";
  const role = salariesSubcategory === "rider" || salariesSubcategory === "groom" || salariesSubcategory === "freelance" ? salariesSubcategory : undefined;
  const lineItems = getLineItems(parsed);
  const personAssignments = lineItems.map((item, index) => {
    const row = item as Record<string, unknown>;
    const personName = pickString(row, ["person_name", "employee_name", "name"]);
    return {
      lineItemIndex: index,
      personId: undefined,
      personName,
      role
    };
  });
  return {
    salariesSubcategory,
    personAssignments,
    splitPersonLineItems: [] as any[],
    originalCurrency,
    originalTotal,
    exchangeRate,
    isApproved: false
  };
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
  if (categorySlug === "marketing") {
    return "Extract from this marketing invoice: provider/vendor name and contact details (address, phone, email), invoice_number, invoice_date, due_date, original_currency, original_total, exchange_rate, invoice_total_usd, and line_items[] with description, quantity, unit_price, total_usd. Return strict JSON.";
  }
  if (categorySlug === "bodywork") {
    return "Extract from this bodywork/chiropractic/massage invoice: invoice_number, invoice_date, due_date, provider_name, original_currency, original_total, exchange_rate, invoice_total_usd, and line_items[] with description, horse_name (if identifiable), quantity, unit_price, total_usd. Return strict JSON.";
  }
  if (categorySlug === "feed-bedding") {
    return 'Extract from this feed and bedding invoice: invoice_number, invoice_date, due_date, provider_name, original_currency, original_total, exchange_rate, invoice_total_usd, and line_items[] with description, quantity, unit_price, total_usd, and subcategory ("feed", "bedding", or null for delivery/tax). Return strict JSON.';
  }
  if (categorySlug === "stabling" || categorySlug === "show-expenses") {
    return `${base} For each line item include suggestedCategory as null if it belongs in ${categorySlug}, or one of: feed_bedding, stabling, farrier, supplies, veterinary.`;
  }
  if (categorySlug === "salaries") {
    return "Extract from this salary/payroll invoice: invoice_number, invoice_date, due_date, provider_name, pay_period, original_currency, original_total, exchange_rate, invoice_total_usd, and line_items[] with description, person_name (if identifiable), quantity, unit_price, total_usd. Return strict JSON.";
  }
  return base;
}

function annotateSuggestedCategories(parsed: Record<string, unknown>, categorySlug: string) {
  if (!RECLASSIFICATION_SOURCE_CATEGORIES.has(categorySlug)) return;
  const currentCategory = categorySlug.replace(/-/g, "_");
  const lineItems = getLineItems(parsed);
  for (const item of lineItems) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const existing = normalizeCategoryKey(record.suggestedCategory);
    if (existing) {
      record.suggestedCategory = existing === currentCategory ? null : existing;
      continue;
    }
    const inferred = inferCategoryFromLineItem(record, currentCategory);
    record.suggestedCategory = inferred && inferred !== currentCategory ? inferred : null;
    if (record.confirmedCategory === undefined) {
      record.confirmedCategory = undefined;
    }
    if (record.reclassified === undefined) {
      record.reclassified = false;
    }
  }
}

function inferCategoryFromLineItem(item: Record<string, unknown>, currentCategory: string) {
  const description = String(item.description ?? "").toLowerCase();
  const subcategory = String(item.stabling_subcategory ?? item.subcategory ?? "").toLowerCase();
  const text = `${description} ${subcategory}`;

  if (matchesAny(text, ["shoe", "shoeing", "trim", "trimming", "farrier", "horseshoe"])) return "farrier";
  if (matchesAny(text, ["inject", "exam", "vaccine", "medication", "xray", "radiograph", "vet"])) return "veterinary";
  if (matchesAny(text, ["blanket", "bridle", "saddle", "boot", "tack", "equipment", "repair"])) return "supplies";
  if (matchesAny(text, ["hay", "grain", "alfalfa", "feed", "beet pulp", "supplement", "bedding", "shavings", "straw", "wood chip", "sawdust"])) return "feed_bedding";
  if (matchesAny(text, ["board", "stall", "turnout", "paddock", "facility"])) return "stabling";
  return currentCategory;
}

function matchesAny(text: string, keywords: string[]) {
  return keywords.some((keyword) => text.includes(keyword));
}

function normalizeCategoryKey(value: unknown) {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase().replace(/-/g, "_");
  return normalized.length > 0 ? normalized : null;
}
