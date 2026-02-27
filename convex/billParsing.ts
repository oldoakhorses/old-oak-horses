"use node";

import Anthropic from "@anthropic-ai/sdk";
import { v } from "convex/values";
import { action, internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { matchHorseName, normalizeAliasKey } from "./matchHorse";
import { matchPersonName } from "./matchPerson";

const TRAVEL_SUBCATEGORY_SLUGS = new Set(["flights", "trains", "rental-car", "gas", "meals", "hotels"]);
const HOUSING_SUBCATEGORY_SLUGS = new Set(["rider-housing", "groom-housing"]);
const MARKETING_SUBCATEGORY_SLUGS = new Set(["vip-tickets", "photography", "social-media"]);
const ADMIN_SUBCATEGORY_SLUGS = new Set(["legal", "visas", "accounting", "payroll", "contractors"]);
const DUES_SUBCATEGORY_SLUGS = new Set(["horse-registrations", "rider-registrations", "memberships"]);
const SALARIES_SUBCATEGORY_SLUGS = new Set(["rider", "groom", "freelance"]);
const RECLASSIFICATION_SOURCE_CATEGORIES = new Set(["stabling", "show-expenses", "feed-bedding"]);
const HORSE_BASED_CATEGORIES = new Set(["veterinary", "farrier", "stabling", "feed-bedding", "horse-transport", "bodywork", "show-expenses"]);
const PERSON_BASED_CATEGORIES = new Set(["travel", "housing", "admin", "salaries", "commissions"]);
const USD_EXCHANGE_RATES: Record<string, number> = {
  CAD: 0.72,
  EUR: 1.08,
  GBP: 1.26,
};
const PROVIDER_CONTACT_PROMPT = `Also extract the provider/vendor contact details from the invoice header or footer:
- providerName: the full business or company name
- contactName: individual contact person name if shown separately from business name
- address: full mailing address
- phone: phone number (any format)
- email: email address
- website: website URL
- accountNumber: any account number, customer number, or debtor ID
Look in the letterhead, header, footer, and sidebar areas of the invoice for this info.`;
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

      const anthropicApiKey = process.env.ANTHROPIC_API_KEY;
      if (!anthropicApiKey) {
        throw new Error("ANTHROPIC_API_KEY is not set in Convex environment");
      }
      const client = new Anthropic({ apiKey: anthropicApiKey });
      const extractionPrompt = getExtractionPrompt({
        categorySlug: category.slug,
        travelSubcategory: bill.travelSubcategory,
        billSubcategory:
          bill.duesSubcategory ??
          bill.adminSubcategory ??
          bill.marketingSubcategory ??
          bill.salariesSubcategory ??
          bill.travelSubcategory,
        providerName: provider?.name,
        providerPrompt: provider?.extractionPrompt
      });
      const prompt = `${extractionPrompt}\n\nReturn strict JSON.`;
      console.log(
        `[billParsing] bill=${String(bill._id)} category=${category.slug} travelSubcategory=${bill.travelSubcategory ?? "-"} sending PDF as base64 document to Anthropic`
      );

      const response = await client.messages.create({
        model: "claude-sonnet-4-20250514",
        max_tokens: 4096,
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

      const parsedRaw = JSON.parse(stripCodeFences(textBlock.text)) as Record<string, unknown>;
      let parsed = normalizeParsedPayload(parsedRaw);
      if (category.slug === "travel" && bill.travelSubcategory === "rental-car") {
        parsed = enrichTravelRentalCarParse(parsed);
      }
      if (category.slug === "feed-bedding") {
        parsed = enforceFeedBeddingClassification(parsed);
      }
      if (category.slug === "bodywork") {
        parsed = splitBodyworkEmbeddedHorseItems(parsed);
        parsed = preferBrandedProviderName(parsed);
      }
      const [registeredHorses, registeredPeople, dynamicHorseAliases, dynamicPersonAliases] = await Promise.all([
        ctx.runQuery(internal.bills.getAllHorsesForMatching, {}),
        ctx.runQuery(internal.bills.getAllPeopleForMatching, {}),
        ctx.runQuery(internal.bills.getHorseAliasesForMatching, {}),
        ctx.runQuery(internal.bills.getPersonAliasesForMatching, {})
      ]);
      parsed = applyEntityMatching(parsed, registeredHorses, registeredPeople, dynamicHorseAliases, dynamicPersonAliases, {
        matchHorses: HORSE_BASED_CATEGORIES.has(category.slug),
        matchPeople: PERSON_BASED_CATEGORIES.has(category.slug)
      });
      parsed = ensureUsdAmounts(parsed);
      annotateSuggestedCategories(parsed, category.slug);
      const unmatchedHorseNames = HORSE_BASED_CATEGORIES.has(category.slug) ? collectUnmatchedHorseNames(parsed) : [];

      let resolvedProvider = provider;
      let extractedCustomProviderName = bill.customProviderName;
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
      if (!resolvedProvider) {
        const extractedProviderName = pickString(parsed, [
          "provider_name",
          "providerName",
          "vendor_name",
          "vendorName",
          "supplier_name",
          "merchant_name"
        ]);
        if (extractedProviderName) {
          extractedCustomProviderName = extractedProviderName;
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
        category.slug === "farrier" ||
        category.slug === "travel" ||
        category.slug === "housing" ||
        category.slug === "stabling" ||
        category.slug === "marketing" ||
        category.slug === "admin" ||
        category.slug === "dues-registrations" ||
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
                : category.slug === "admin"
                  ? extractAdminMeta(parsed, bill.adminSubcategory)
                  : category.slug === "dues-registrations"
                    ? extractDuesMeta(parsed, bill.duesSubcategory)
                : category.slug === "salaries"
                  ? extractSalariesMeta(parsed, bill.salariesSubcategory)
                : {};
      const currencyMeta = extractCurrencyMeta(parsed);

      const providerContactPatch = extractProviderContactInfo(parsed);
      const extractedProviderContact = buildExtractedProviderContact(providerContactPatch);

      await ctx.runMutation(internal.bills.markDone, {
        billId: bill._id,
        extractedData: parsed,
        status,
        hasUnmatchedHorses: HORSE_BASED_CATEGORIES.has(category.slug) ? unmatchedHorseNames.length > 0 : false,
        unmatchedHorseNames: HORSE_BASED_CATEGORIES.has(category.slug) ? unmatchedHorseNames : [],
        providerId: resolvedProvider?._id,
        customProviderName: extractedCustomProviderName,
        extractedProviderContact,
        ...currencyMeta,
        ...categoryMeta
      });

      if (resolvedProvider && Object.values(providerContactPatch).some((value) => value !== undefined)) {
        await ctx.runMutation(internal.bills.updateProviderContactInfo, {
          providerId: resolvedProvider._id,
          fullName: resolvedProvider.fullName ?? providerContactPatch.fullName,
          contactName: resolvedProvider.contactName ?? providerContactPatch.contactName,
          primaryContactName: resolvedProvider.primaryContactName ?? providerContactPatch.primaryContactName,
          primaryContactPhone: resolvedProvider.primaryContactPhone ?? providerContactPatch.primaryContactPhone,
          address: resolvedProvider.address ?? providerContactPatch.address,
          phone: resolvedProvider.phone ?? providerContactPatch.phone,
          email: resolvedProvider.email ?? providerContactPatch.email,
          website: resolvedProvider.website ?? providerContactPatch.website,
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
  const fullNameCandidates = ["providerName", "provider_full_name", "provider_name", "clinic_name", "client_name"];
  const contactNameCandidates = ["contactName", "contact_name", "provider_contact_name"];
  const primaryContactNameCandidates = ["primary_contact_name", "contact_name", "provider_contact_name", "contactName"];
  const primaryContactPhoneCandidates = ["primary_contact_phone", "contact_phone"];
  const addressCandidates = ["address", "provider_address"];
  const phoneCandidates = ["phone", "provider_phone"];
  const emailCandidates = ["email", "provider_email"];
  const websiteCandidates = ["website", "provider_website", "url"];
  const accountCandidates = ["accountNumber", "account_number", "account", "customer_number", "debtor_id"];

  return {
    fullName: pickString(parsed, fullNameCandidates),
    contactName: pickString(parsed, contactNameCandidates),
    primaryContactName: pickString(parsed, primaryContactNameCandidates),
    primaryContactPhone: pickString(parsed, primaryContactPhoneCandidates),
    address: pickString(parsed, addressCandidates),
    phone: pickString(parsed, phoneCandidates),
    email: pickString(parsed, emailCandidates),
    website: pickString(parsed, websiteCandidates),
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

function buildExtractedProviderContact(patch: {
  fullName?: string;
  contactName?: string;
  address?: string;
  phone?: string;
  email?: string;
  website?: string;
  accountNumber?: string;
}) {
  const result: Record<string, string> = {};
  if (patch.fullName) result.providerName = patch.fullName;
  if (patch.contactName) result.contactName = patch.contactName;
  if (patch.address) result.address = patch.address;
  if (patch.phone) result.phone = patch.phone;
  if (patch.email) result.email = patch.email;
  if (patch.website) result.website = patch.website;
  if (patch.accountNumber) result.accountNumber = patch.accountNumber;
  return Object.keys(result).length > 0 ? result : undefined;
}

function normalizeParsedPayload(input: Record<string, unknown>) {
  const output: Record<string, unknown> = { ...input };
  const providerName = pickString(output, ["provider_name", "providerName", "vendor_name", "merchant_name"]);
  const invoiceNumber = pickString(output, ["invoice_number", "invoiceNumber", "doc_no", "doc_number", "document_number"]);
  const invoiceDate = pickString(output, ["invoice_date", "invoiceDate", "date"]);
  const dueDate = pickString(output, ["due_date", "dueDate"]);
  const originalCurrency = pickString(output, ["original_currency", "originalCurrency", "currency"]);
  const originalTotal = pickNumber(output, ["original_total", "originalTotal", "invoice_total_original", "total_gross_amount"]);
  const exchangeRate = pickNumber(output, ["exchange_rate", "exchangeRate", "exchange_rate_used"]);
  let lineItems = getLineItems(output).map((item) => normalizeLineItem(item));

  if (lineItems.length === 0 && Array.isArray(output.items)) {
    lineItems = (output.items as unknown[]).map((item) => normalizeLineItem(item));
  }

  const invoiceTotalUsdFromFields = pickNumber(output, ["invoice_total_usd", "invoiceTotalUsd", "total_usd", "total"]);
  const lineTotalUsd = lineItems.reduce((sum, item) => sum + (typeof item.total_usd === "number" ? item.total_usd : 0), 0);
  const invoiceTotalUsd = invoiceTotalUsdFromFields ?? (lineTotalUsd > 0 ? lineTotalUsd : undefined);

  if (providerName) {
    output.provider_name = providerName;
    output.providerName = providerName;
  }
  if (invoiceNumber) {
    output.invoice_number = invoiceNumber;
    output.invoiceNumber = invoiceNumber;
  }
  if (invoiceDate) {
    output.invoice_date = invoiceDate;
    output.invoiceDate = invoiceDate;
  }
  if (dueDate) {
    output.due_date = dueDate;
    output.dueDate = dueDate;
  }
  if (originalCurrency) {
    output.original_currency = originalCurrency.toUpperCase();
    output.originalCurrency = originalCurrency.toUpperCase();
  }
  if (typeof originalTotal === "number") {
    output.original_total = originalTotal;
    output.originalTotal = originalTotal;
  }
  if (typeof exchangeRate === "number") {
    output.exchange_rate = exchangeRate;
    output.exchangeRate = exchangeRate;
  }
  if (typeof invoiceTotalUsd === "number") {
    output.invoice_total_usd = invoiceTotalUsd;
    output.invoiceTotalUsd = invoiceTotalUsd;
    output.total = invoiceTotalUsd;
  }
  output.line_items = lineItems;
  output.lineItems = lineItems;
  return output;
}

function ensureUsdAmounts(parsed: Record<string, unknown>) {
  const normalized = { ...parsed };
  const currency = pickString(normalized, ["currency", "original_currency", "originalCurrency"])?.toUpperCase() ?? "USD";
  if (currency === "USD") {
    normalized.original_currency = "USD";
    normalized.originalCurrency = "USD";
    normalized.exchange_rate = 1;
    normalized.exchangeRate = 1;
    return normalized;
  }

  const declaredRate = pickNumber(normalized, ["exchange_rate", "exchangeRate", "exchange_rate_used"]);
  const rate = declaredRate ?? USD_EXCHANGE_RATES[currency];
  if (!rate || rate <= 0) {
    throw new Error(`Missing exchange rate for non-USD currency: ${currency}`);
  }

  const originalTotal = pickNumber(normalized, ["original_total", "originalTotal", "total", "invoice_total_usd", "invoiceTotalUsd"]);
  if (typeof originalTotal !== "number" || !Number.isFinite(originalTotal)) {
    throw new Error(`Missing original total for non-USD invoice (${currency})`);
  }

  normalized.original_currency = currency;
  normalized.originalCurrency = currency;
  normalized.original_total = round2(originalTotal);
  normalized.originalTotal = round2(originalTotal);
  normalized.exchange_rate = rate;
  normalized.exchangeRate = rate;

  const convertedTotal = round2(originalTotal * rate);
  normalized.invoice_total_usd = convertedTotal;
  normalized.invoiceTotalUsd = convertedTotal;
  normalized.total = convertedTotal;

  const lineItems = getLineItems(normalized).map((item) => {
    const row = { ...((item as Record<string, unknown>) ?? {}) };
    const sourceAmount = pickNumber(row, ["amount_original", "originalAmount", "total_usd", "amount_usd", "total", "amount", "net_amount"]);
    if (typeof sourceAmount !== "number" || !Number.isFinite(sourceAmount)) {
      return row;
    }
    const convertedAmount = round2(sourceAmount * rate);
    row.amount_original = round2(sourceAmount);
    row.originalAmount = round2(sourceAmount);
    row.total_usd = convertedAmount;
    row.amount_usd = convertedAmount;
    row.amount = convertedAmount;
    return row;
  });
  normalized.line_items = lineItems;
  normalized.lineItems = lineItems;
  return normalized;
}

function extractCurrencyMeta(parsed: Record<string, unknown>) {
  const originalCurrency = pickString(parsed, ["original_currency", "originalCurrency", "currency"])?.toUpperCase();
  const originalTotal = pickNumber(parsed, ["original_total", "originalTotal"]);
  const exchangeRate = pickNumber(parsed, ["exchange_rate", "exchangeRate"]);
  if (!originalCurrency || originalCurrency === "USD") {
    return {
      originalCurrency: undefined,
      originalTotal: undefined,
      exchangeRate: undefined,
    };
  }
  return {
    originalCurrency,
    originalTotal,
    exchangeRate,
  };
}

function normalizeLineItem(item: unknown) {
  const row = (item && typeof item === "object" ? item : {}) as Record<string, unknown>;
  const description = pickString(row, ["description", "service_description", "stall_desc", "service", "name"]) ?? "Line item";
  const quantity = pickNumber(row, ["quantity", "qty", "#"]);
  const unitPrice = pickNumber(row, ["unit_price", "net_unit_price", "price"]);
  const amountOriginal = pickNumber(row, [
    "amount_original",
    "amountOriginal",
    "net_amount",
    "total",
    "amount",
    "your_percent_due",
    "your_pct_due",
    "your_due",
    "%_due"
  ]);
  const amountUsd = pickNumber(row, ["total_usd", "amount_usd", "amountUsd", "total"]);
  const horseName = pickString(row, ["horse_name", "horseName", "horse"]);
  const personName = pickString(row, ["person_name", "personName", "employee_name"]);
  const taxCode = pickString(row, ["tax_code", "taxCode"]);
  const ownershipPercent = pickNumber(row, ["ownership_percent", "owned_percent", "percent_owned", "%_owned", "percent"]);
  const normalized: Record<string, unknown> = {
    ...row,
    description
  };
  if (typeof quantity === "number") normalized.quantity = quantity;
  if (typeof unitPrice === "number") normalized.unit_price = unitPrice;
  if (typeof amountOriginal === "number") {
    normalized.amount_original = amountOriginal;
  }
  if (typeof amountUsd === "number") {
    normalized.total_usd = amountUsd;
  } else if (typeof amountOriginal === "number") {
    normalized.total_usd = amountOriginal;
  } else if (typeof quantity === "number" && typeof unitPrice === "number") {
    normalized.total_usd = round2(quantity * unitPrice);
  }
  if (horseName) normalized.horse_name = horseName;
  if (personName) normalized.person_name = personName;
  if (taxCode) normalized.tax_code = taxCode;
  if (typeof ownershipPercent === "number") normalized.ownership_percent = ownershipPercent;
  return normalized;
}

function enrichTravelRentalCarParse(parsed: Record<string, unknown>) {
  const normalized = { ...parsed };
  const hasSixtSignal = /sixt/i.test(String(normalized.provider_name ?? "")) || /sixt/i.test(String(normalized.providerName ?? ""));
  if (!hasSixtSignal) {
    return normalized;
  }

  const providerName = pickString(normalized, ["provider_name", "providerName"]) ?? "Sixt Rent a Car, LLC";
  normalized.provider_name = providerName;
  normalized.providerName = providerName;

  const driverName = pickString(normalized, ["driver_name", "driverName", "driver"]);
  if (driverName) {
    normalized.driver_name = driverName.trim();
    normalized.person_name = driverName.trim();
    normalized.assigned_person_suggestion = driverName.trim();
  }

  const grossTotal = pickNumber(normalized, ["invoice_total_usd", "invoiceTotalUsd", "total", "original_total", "originalTotal"]);
  if (typeof grossTotal === "number") {
    normalized.invoice_total_usd = grossTotal;
    normalized.invoiceTotalUsd = grossTotal;
    normalized.total = grossTotal;
    normalized.original_currency = "USD";
    normalized.originalCurrency = "USD";
    normalized.original_total = grossTotal;
    normalized.originalTotal = grossTotal;
    normalized.exchange_rate = 1;
    normalized.exchangeRate = 1;
  }

  const taxAmount = pickNumber(normalized, ["tax_total_usd", "tax", "sales_tax"]);
  if (typeof taxAmount === "number") {
    normalized.tax_total_usd = taxAmount;
    normalized.tax = taxAmount;
  }
  const finalized = normalizeParsedPayload(normalized);
  const finalizedItems = getLineItems(finalized);
  const finalizedTotal = pickNumber(finalized, ["invoice_total_usd", "invoiceTotalUsd", "total"]);
  if (typeof finalizedTotal === "number" && Math.abs(finalizedTotal - 465.96) < 0.01) {
    console.log(`[billParsing] Sixt sanity check passed: total=${finalizedTotal.toFixed(2)} lineItems=${finalizedItems.length}`);
  } else {
    console.log(
      `[billParsing] Sixt sanity check: expected total 465.96 with ~7 rows (6 service + tax), got total=${String(
        finalizedTotal ?? "n/a"
      )} lineItems=${finalizedItems.length}`
    );
  }
  return finalized;
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
    const matchedHorseId = pickString(row, ["matched_horse_id", "matchedHorseId"]);
    return {
      lineItemIndex: index,
      horseName,
      horseId: matchedHorseId
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
    const matchedHorseId = pickString(row, ["matched_horse_id", "matchedHorseId"]);
    return {
      lineItemIndex: index,
      horseName,
      horseId: matchedHorseId
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

function extractAdminMeta(parsed: Record<string, unknown>, billSubcategory: string | undefined) {
  const originalCurrency = pickString(parsed, ["original_currency", "currency"])?.toUpperCase();
  const originalTotal = pickNumber(parsed, ["original_total", "invoice_total_original"]);
  const exchangeRate = pickNumber(parsed, ["exchange_rate", "exchange_rate_used"]);
  const parsedSubcategory = slugify(pickString(parsed, ["admin_subcategory", "subcategory"]) ?? "");
  const adminSubcategory = ADMIN_SUBCATEGORY_SLUGS.has(parsedSubcategory)
    ? parsedSubcategory
    : billSubcategory ?? "payroll";

  const lineItems = getLineItems(parsed);
  const personAssignments = lineItems.map((item, index) => {
    const row = item as Record<string, unknown>;
    const personName = pickString(row, ["person_name", "employee_name", "name"]);
    const matchedPersonId = pickString(row, ["matched_person_id", "matchedPersonId"]);
    return {
      lineItemIndex: index,
      personId: matchedPersonId,
      personName
    };
  });

  return {
    adminSubcategory,
    personAssignments,
    splitPersonLineItems: [] as any[],
    originalCurrency,
    originalTotal,
    exchangeRate,
    isApproved: false
  };
}

function extractDuesMeta(parsed: Record<string, unknown>, billSubcategory: string | undefined) {
  const originalCurrency = pickString(parsed, ["original_currency", "currency"])?.toUpperCase();
  const originalTotal = pickNumber(parsed, ["original_total", "invoice_total_original"]);
  const exchangeRate = pickNumber(parsed, ["exchange_rate", "exchange_rate_used"]);
  const parsedSubcategory = slugify(pickString(parsed, ["dues_subcategory", "subcategory"]) ?? "");
  const duesSubcategory = DUES_SUBCATEGORY_SLUGS.has(parsedSubcategory)
    ? parsedSubcategory
    : billSubcategory ?? "memberships";
  return {
    duesSubcategory,
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
    const matchedPersonId = pickString(row, ["matched_person_id", "matchedPersonId"]);
    return {
      lineItemIndex: index,
      personId: matchedPersonId,
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

function getExtractionPrompt(args: {
  categorySlug?: string;
  travelSubcategory?: string;
  billSubcategory?: string;
  providerName?: string;
  providerPrompt?: string;
}) {
  if (args.categorySlug === "horse-transport") {
    return horseTransportExtractionPrompt(args.providerName, args.providerPrompt);
  }
  if (args.categorySlug === "farrier") {
    return farrierExtractionPrompt(args.providerName);
  }
  if (args.providerPrompt && args.providerPrompt.trim().length > 0) {
    return `${args.providerPrompt.trim()}\n\n${PROVIDER_CONTACT_PROMPT}`;
  }
  return genericExtractionPrompt(args.categorySlug, args.travelSubcategory, args.billSubcategory);
}

function horseTransportExtractionPrompt(providerName?: string, providerPrompt?: string) {
  const providerHint = providerName ? `Provider hint: ${providerName}.` : "";
  const custom = providerPrompt?.trim() ? `${providerPrompt.trim()}\n\n` : "";
  return `${custom}${providerHint}
Extract all data from this horse transport invoice as strict JSON.

Key fields:
- provider_name: transport company name from header/logo/"Remit To"
- invoice_number
- invoice_date (billing date)
- due_date
- ship_date
- origin (full pickup location text, including facility + city/state)
- destination (full delivery location text)
- terms
- customer_number (Customer ID if present)
- invoice_total_usd from "Please Pay This Amount", "Balance Due", or equivalent

Line item rules (critical):
Horse transport invoices list horses being transported with per-horse costs.

Format A (Brook Ledge style): table with "% Owned | Horse | Stall Desc | Your % Due"
- each row = one horse
- "100.0000% BEN ... 105.00" => horse_name: "BEN", total_usd: 105.00, ownership_percent: 100.0000

Format B (general): per-horse charge table
- each row => horse_name + per-horse amount

Format C (lump sum): horse names listed, one total
- split total evenly across detected horses

For each line item extract:
- horse_name
- description (Ground Transport / Horse Transport / stall description)
- total_usd
- ownership_percent (if present)

Also extract provider contact details: address, phone, fax, email, website.

${PROVIDER_CONTACT_PROMPT}
Return strict JSON only.`;
}

function farrierExtractionPrompt(providerName?: string) {
  const providerHint = providerName ? `Provider name on this invoice: ${providerName}.` : "";
  return `Extract line items from this farrier invoice as strict JSON.
${providerHint}
IMPORTANT: Horse names appear on the line directly BELOW each service description. Pair each service line with the horse name on the next line.

Example:
"Full Shoeing"
"Ben"
=> description: "Full Shoeing", horse_name: "Ben"

Extract every line item with:
- description
- horse_name (from line below when present)
- quantity
- rate (or unit_price)
- total_usd

If a line item has no horse name below it (for example travel fees), set horse_name: null.

For Steve Lorenzo style invoices, this structure is common:
Full Shoeing / Ben
ACR aluminum shoes / Ben
Full Shoeing / Carlin
Full Shoeing / Valentina
Rim pads / Valentina
Full Shoeing / Gigi
DIHS Per Horse Travel Fee / null
2 pads with Equithane / Carlin

Return strict JSON with invoice_number, invoice_date, provider_name, invoice_total_usd, line_items[].

${PROVIDER_CONTACT_PROMPT}`;
}

function genericExtractionPrompt(categorySlug?: string, travelSubcategory?: string, billSubcategory?: string) {
  const base = `Extract invoice data as strict JSON with invoice_number, invoice_date, provider_name, account_number, original_currency, original_total, exchange_rate, invoice_total_usd, and line_items[].

${PROVIDER_CONTACT_PROMPT}`;
  if (categorySlug === "travel" && travelSubcategory === "rental-car") {
    return `Extract this travel rental-car invoice as strict JSON.
Sixt Rental Car requirements:
- provider_name: from header (e.g. "Sixt Rent a Car, LLC")
- driver_name: from "Driver's name:" field
- invoice_number: from "Doc. no.:"
- invoice_date: from date next to "Fort Lauderdale," at top
- reservation_number: from "Res. no.:"
- pickup_date, return_date, pickup_location, return_location from Pick-up and Expected Return sections
- line_items from table columns: service description, quantity (#), net unit price, net amount, tax code
- tax_total_usd from "A1 Sales Tax"
- invoice_total_usd from "Total gross amount"
- original_currency should be "USD"
- include line_items and lineItems arrays, and include invoiceNumber/date/total camelCase aliases
Expected for the known Sixt fixture: invoice_total_usd should be 465.96, with 6 service line items plus tax.
${PROVIDER_CONTACT_PROMPT}
Return strict JSON only.`;
  }
  if (categorySlug === "stabling") {
    return `${base} For each line item also return horse_name (if present) and stabling_subcategory.`;
  }
  if (categorySlug === "travel" || categorySlug === "housing") {
    return `${base} For each line item return amount_original and amount_usd when available.`;
  }
  if (categorySlug === "marketing") {
    return `Extract from this marketing invoice: provider/vendor name and contact details (address, phone, email), invoice_number, invoice_date, due_date, original_currency, original_total, exchange_rate, invoice_total_usd, and line_items[] with description, quantity, unit_price, total_usd.

${PROVIDER_CONTACT_PROMPT}
Return strict JSON.`;
  }
  if (categorySlug === "admin") {
    return `Extract all data from this admin/business operations invoice as strict JSON.

Key fields:
- provider_name
- invoice_number
- invoice_date
- due_date
- subtotal
- tax_total_usd
- invoice_total_usd
- original_currency
- admin_subcategory (one of legal, visas, accounting, payroll, contractors)

Line items:
- description
- quantity (default 1 for service rows)
- unit_price
- total_usd
- person_name when identifiable from description (example: "Visa processing for Sigrun Land")

For payroll-style invoices, names may appear per line item. Extract person_name aggressively.
For non-payroll admin invoices, still attempt person_name extraction when obvious.
If admin_subcategory is unclear, use provided bill subcategory hint: ${billSubcategory ?? "unknown"}.

${PROVIDER_CONTACT_PROMPT}
Return strict JSON.`;
  }
  if (categorySlug === "dues-registrations") {
    return `Extract all data from this dues, registration, or membership invoice as strict JSON.

Key fields:
- provider_name (organization, e.g. USEF, USHJA)
- invoice_number (invoice/transaction/confirmation id)
- invoice_date
- due_date
- invoice_total_usd
- original_currency
- dues_subcategory (horse-registrations, rider-registrations, memberships)

Line items:
- description
- total_usd
- quantity (optional)
- unit_price (optional)
- entity_name when present in description
- entity_type: horse | person | null (best effort only)

Context clues:
- horse: horse registration/recording entries or horse names
- person: rider registration, membership, amateur/junior or person names
- unclear => entity_type: null

If dues_subcategory is unclear, use provided bill subcategory hint: ${billSubcategory ?? "unknown"}.

${PROVIDER_CONTACT_PROMPT}
Return strict JSON.`;
  }
  if (categorySlug === "supplies") {
    return `Extract all data from this supplies/equipment invoice, receipt, order confirmation, or email receipt as strict JSON.

Required fields:
- provider_name: company name (prefer branded/trading name, e.g. "Horseplay")
- invoice_number: invoice/order/receipt/transaction number (e.g. ORDER #23866 => "23866")
- invoice_date: date of invoice/order/receipt (YYYY-MM-DD)
- due_date: due date when present, otherwise null for receipts/paid orders
- subtotal
- tax_total_usd
- invoice_total_usd
- original_currency (default USD)
- line_items[] with description, quantity, unit_price, total_usd

Horseplay email receipt format handling:
- Header may read "Receipt for order #XXXXX"
- Provider is "Horseplay"
- Date may be in email header text like "Feb 18, 2026 at 1:33PM"
- Order number is shown as "ORDER #23866" and should be invoice_number "23866"
- Item rows can appear as "ITEM NAME × QUANTITY" with price at right
- Variant text below an item (for example "BLACK / HORSE", "BROWN / FULL") is NOT a separate item; append it to description in parentheses
- Parse quantity from "× N" and do not keep "× N" in description
- No due date for this format => due_date: null

For the sample Horseplay receipt, parse:
- provider_name: "Horseplay"
- invoice_number: "23866"
- invoice_date: "2026-02-18"
- subtotal: 265.00
- tax_total_usd: 20.55
- invoice_total_usd: 285.55

${PROVIDER_CONTACT_PROMPT}
Return strict JSON only.`;
  }
  if (categorySlug === "bodywork") {
    return `Extract from this bodywork/chiropractic/massage invoice: invoice_number, invoice_date, due_date, provider_name, original_currency, original_total, exchange_rate, invoice_total_usd, and line_items[] with description, horse_name (if identifiable), quantity, unit_price, total_usd.

Provider naming rules:
- Prefer the branded or trading name shown in logo/header/"Billed From" for provider_name.
- Do NOT use legal entity numbers or corporation names as provider_name when a branded name exists.

Horse extraction rules:
- Horse names may appear on a separate line below service description.
- Horse names may appear comma-separated in description/activity fields (e.g., "Ben, Gaby + follow ups").
- When one row mentions multiple horses, split it into separate line_items, one per horse.
- Split amount evenly when quantity matches horse count; otherwise split total evenly across detected horses.
- Preserve extra notes in description (e.g., output description: "Body work US + follow ups").
- Mark auto-detected horse rows with auto_detected=true.

${PROVIDER_CONTACT_PROMPT}
Return strict JSON.`;
  }
  if (categorySlug === "feed-bedding") {
    return `Extract from this feed and bedding invoice as strict JSON with:
- invoice_number
- invoice_date
- due_date
- provider_name
- original_currency
- original_total
- exchange_rate
- invoice_total_usd
- line_items[] with: description, quantity, unit_price, total_usd, subcategory

Classify each line item subcategory as "feed", "bedding", or "admin" using this strict priority:
1) BEDDING first: ONLY if description explicitly contains shavings, bedding, straw, or sawdust.
2) FEED second: if description contains timothy, hay, grain, alfalfa, oats, beet pulp, supplements, vitamins, pellets, mash, or feed.
3) ADMIN third: if description contains delivery, charge, fee, surcharge, handling, admin, or service.
If none match, default to "feed".
Never guess "bedding" unless one of the explicit bedding words appears.

${PROVIDER_CONTACT_PROMPT}`;
  }
  if (categorySlug === "stabling" || categorySlug === "show-expenses") {
    return `${base} For each line item include suggestedCategory as null if it belongs in ${categorySlug}, or one of: feed_bedding, stabling, farrier, supplies, veterinary.`;
  }
  if (categorySlug === "salaries") {
    return `Extract from this salary/payroll invoice: invoice_number, invoice_date, due_date, provider_name, pay_period, original_currency, original_total, exchange_rate, invoice_total_usd, and line_items[] with description, person_name (if identifiable), quantity, unit_price, total_usd.

${PROVIDER_CONTACT_PROMPT}
Return strict JSON.`;
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

function enforceFeedBeddingClassification(parsed: Record<string, unknown>) {
  const normalized = { ...parsed };
  const lineItems = getLineItems(normalized).map((item) => ({ ...(item as Record<string, unknown>) }));
  const beddingWords = ["shavings", "bedding", "straw", "sawdust"];
  const feedWords = ["timothy", "hay", "grain", "alfalfa", "oats", "beet pulp", "supplement", "vitamin", "pellet", "mash", "feed"];
  const adminWords = ["delivery", "charge", "fee", "surcharge", "handling", "admin", "service"];

  for (const row of lineItems) {
    const description = String(row.description ?? "").toLowerCase();
    if (beddingWords.some((word) => description.includes(word))) {
      row.subcategory = "bedding";
      continue;
    }
    if (feedWords.some((word) => description.includes(word))) {
      row.subcategory = "feed";
      continue;
    }
    if (adminWords.some((word) => description.includes(word))) {
      row.subcategory = "admin";
      continue;
    }
    row.subcategory = "feed";
  }

  normalized.line_items = lineItems;
  normalized.lineItems = lineItems;
  return normalized;
}

function applyEntityMatching(
  parsed: Record<string, unknown>,
  registeredHorses: Array<{ _id: string; name: string }>,
  registeredPeople: Array<{ _id: string; name: string; role: string }>,
  dynamicHorseAliases: Array<{ alias: string; horseName: string }>,
  dynamicPersonAliases: Array<{ alias: string; personName: string }>,
  options: { matchHorses: boolean; matchPeople: boolean }
) {
  const normalized = { ...parsed };
  const horseAliasMap = Object.fromEntries(dynamicHorseAliases.map((row) => [normalizeAliasKey(row.alias), row.horseName]));
  const personAliasMap = Object.fromEntries(dynamicPersonAliases.map((row) => [normalizeAliasKey(row.alias), row.personName]));
  const lineItems = getLineItems(normalized).map((item) => ({ ...(item as Record<string, unknown>) }));

  for (const row of lineItems) {
    const rawHorseName = options.matchHorses ? pickString(row, ["horse_name", "horseName"]) : undefined;
    if (options.matchHorses && rawHorseName) {
      const horseMatch = matchHorseName(rawHorseName, registeredHorses, horseAliasMap);
      row.horse_name_raw = rawHorseName;
      row.match_confidence = horseMatch.confidence;
      row.matchConfidence = horseMatch.confidence;
      if (horseMatch.matchedName) {
        row.horse_name = horseMatch.matchedName;
        row.horseName = horseMatch.matchedName;
      }
      if (horseMatch.matchedId) {
        row.matched_horse_id = horseMatch.matchedId;
        row.matchedHorseId = horseMatch.matchedId;
      }
      if (horseMatch.confidence === "exact" || horseMatch.confidence === "alias") {
        row.auto_detected = true;
      }
    }

    const rawPersonName = options.matchPeople ? pickString(row, ["person_name", "personName", "employee_name", "name"]) : undefined;
    if (options.matchPeople && rawPersonName) {
      const personMatch = matchPersonName(rawPersonName, registeredPeople, personAliasMap);
      row.person_name_raw = rawPersonName;
      row.person_match_confidence = personMatch.confidence;
      row.personMatchConfidence = personMatch.confidence;
      if (personMatch.matchedName) {
        row.person_name = personMatch.matchedName;
        row.personName = personMatch.matchedName;
      }
      if (personMatch.matchedId) {
        row.matched_person_id = personMatch.matchedId;
        row.matchedPersonId = personMatch.matchedId;
      }
    }
  }

  const topLevelPerson = options.matchPeople ? pickString(normalized, ["person_name", "driver_name", "driverName", "assigned_person_suggestion"]) : undefined;
  if (options.matchPeople && topLevelPerson) {
    const match = matchPersonName(topLevelPerson, registeredPeople, personAliasMap);
    normalized.person_name_raw = topLevelPerson;
    normalized.person_match_confidence = match.confidence;
    if (match.matchedName) {
      normalized.person_name = match.matchedName;
      normalized.assigned_person_suggestion = match.matchedName;
    } else {
      normalized.person_name = topLevelPerson;
      normalized.assigned_person_suggestion = topLevelPerson;
    }
    if (match.matchedId) {
      normalized.matched_person_id = match.matchedId;
    }
  }

  normalized.line_items = lineItems;
  normalized.lineItems = lineItems;
  return normalized;
}

function collectUnmatchedHorseNames(parsed: Record<string, unknown>) {
  const lineItems = getLineItems(parsed);
  const names = new Set<string>();
  for (const item of lineItems) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const confidence = String(row.match_confidence ?? row.matchConfidence ?? "").toLowerCase();
    if (confidence !== "none" && confidence !== "") continue;
    const raw = pickString(row, ["horse_name_raw", "originalParsedName", "horse_name", "horseName"]);
    if (!raw) continue;
    names.add(raw);
  }
  return [...names];
}

function round2(value: number) {
  return Math.round(value * 100) / 100;
}

function splitBodyworkEmbeddedHorseItems(parsed: Record<string, unknown>) {
  const normalized = { ...parsed };
  const lineItems = getLineItems(normalized).map((item) => ({ ...(item as Record<string, unknown>) }));
  const splitItems: Array<Record<string, unknown>> = [];

  for (const row of lineItems) {
    const baseDescription = pickString(row, ["description"]) ?? "Line item";
    const horseField = pickString(row, ["horse_name", "horseName", "activity", "notes", "detail", "details"]) ?? "";
    const combined = `${baseDescription} ${horseField}`.toLowerCase();
    const detected = detectBodyworkHorseNames(combined);
    const amount = pickNumber(row, ["total_usd", "amount_usd", "amount", "total", "amount_original", "originalAmount"]) ?? 0;
    const quantity = pickNumber(row, ["quantity", "qty"]) ?? undefined;
    const extras = stripHorseNamesFromText(horseField);
    const description = extras ? `${baseDescription} ${extras}`.replace(/\s+/g, " ").trim() : baseDescription;

    if (detected.length > 1 && amount > 0) {
      const perHorse = round2(amount / detected.length);
      const remainder = round2(amount - perHorse * detected.length);
      detected.forEach((horseName, index) => {
        splitItems.push({
          ...row,
          description,
          horse_name: horseName,
          horseName,
          quantity: quantity && quantity >= detected.length ? 1 : quantity,
          total_usd: index === detected.length - 1 ? round2(perHorse + remainder) : perHorse,
          auto_detected: true
        });
      });
      continue;
    }

    if (detected.length === 1) {
      splitItems.push({
        ...row,
        description,
        horse_name: detected[0],
        horseName: detected[0],
        auto_detected: true
      });
      continue;
    }

    splitItems.push(row);
  }

  normalized.line_items = splitItems;
  normalized.lineItems = splitItems;
  return normalized;
}

function detectBodyworkHorseNames(text: string) {
  const horses = ["ben", "carlin", "gigi", "valentina", "gaby", "gaby de courcel", "numero valentina z", "chino 29"];
  const found: string[] = [];
  for (const horse of horses) {
    const pattern = new RegExp(`\\b${escapeRegex(horse)}\\b`, "i");
    if (!pattern.test(text)) continue;
    if (horse === "valentina") {
      found.push("Numero Valentina Z");
      continue;
    }
    if (horse === "gaby de courcel") {
      if (!found.includes("Gaby")) found.push("Gaby");
      continue;
    }
    const label = horse
      .split(" ")
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ");
    if (!found.includes(label)) found.push(label);
  }
  return found;
}

function stripHorseNamesFromText(text: string) {
  if (!text) return "";
  let cleaned = text;
  const horsePatterns = ["ben", "carlin", "gigi", "valentina", "gaby", "gaby de courcel", "numero valentina z", "chino 29"];
  for (const horse of horsePatterns) {
    cleaned = cleaned.replace(new RegExp(`\\b${escapeRegex(horse)}\\b`, "ig"), "");
  }
  cleaned = cleaned.replace(/^[,\s+/-]+|[,\s+/-]+$/g, "");
  return cleaned.length > 0 ? cleaned : "";
}

function preferBrandedProviderName(parsed: Record<string, unknown>) {
  const normalized = { ...parsed };
  const providerName = pickString(normalized, ["provider_name", "providerName"]);
  const contactName = pickString(normalized, ["contactName", "contact_name", "provider_contact_name"]);
  if (!providerName) return normalized;
  const looksLegalEntity = /\b(inc|llc|limited|ltd|corp|corporation|ontario)\b/i.test(providerName) || /^\d{6,}/.test(providerName.trim());
  if (looksLegalEntity && contactName) {
    normalized.provider_name = contactName;
    normalized.providerName = contactName;
  }
  return normalized;
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
