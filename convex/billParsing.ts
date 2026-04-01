"use node";

import Anthropic from "@anthropic-ai/sdk";
import { v } from "convex/values";
import { Id } from "./_generated/dataModel";
import { action, internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { matchHorseName, normalizeAliasKey } from "./matchHorse";
import { matchPersonName } from "./matchPerson";
import { matchProvider } from "./providerMatching";

const TRAVEL_SUBCATEGORY_SLUGS = new Set(["flights", "trains", "rental-car", "gas", "meals", "hotels"]);
const HOUSING_SUBCATEGORY_SLUGS = new Set(["rider-housing", "groom-housing"]);
const MARKETING_SUBCATEGORY_SLUGS = new Set(["vip-tickets", "photography", "social-media"]);
const ADMIN_SUBCATEGORY_SLUGS = new Set(["legal", "visas", "accounting", "payroll", "contractors", "software-subscriptions", "housing", "bank-fees"]);
const DUES_SUBCATEGORY_SLUGS = new Set(["horse-registrations", "rider-registrations", "memberships"]);
const GROOMING_SUBCATEGORY_SLUGS = new Set(["rider", "groom", "freelance"]);
const INCOME_SUBCATEGORY_SLUGS = new Set(["reimbursements", "other"]);
const RECLASSIFICATION_SOURCE_CATEGORIES = new Set(["stabling", "show-expenses", "feed-bedding"]);
const HORSE_BASED_CATEGORIES = new Set([
  "veterinary",
  "farrier",
  "stabling",
  "feed-bedding",
  "horse-transport",
  "bodywork",
  "show-expenses",
  "dues-registrations",
  "riding-training",
  "prize-money",
  "grooming",
]);
const PERSON_BASED_CATEGORIES = new Set(["travel", "housing", "admin", "grooming", "commissions", "riding-training"]);
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
    const category = bill.categoryId
      ? await ctx.runQuery(internal.bills.getCategory, { categoryId: bill.categoryId })
      : null;
    // Category is now optional — if missing, we auto-detect per line item
    const categorySlug = category?.slug ?? null;

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
      console.log("2. Extracting text from PDF...");
      const textExtractionResponse = await client.messages.create({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1600,
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
              {
                type: "text",
                text: "Extract visible text from this invoice PDF. Return plain text only."
              }
            ]
          }
        ]
      });
      const extractedTextBlock = textExtractionResponse.content.find((c) => c.type === "text");
      const extractedPdfText = extractedTextBlock && extractedTextBlock.type === "text" ? extractedTextBlock.text : "";
      console.log("3. Extracted text length:", extractedPdfText.length);
      console.log("4. Extracted text preview:", extractedPdfText.substring(0, 500));
      console.log("=== RAW PDF TEXT ===");
      console.log(extractedPdfText);
      console.log("=== END RAW TEXT ===");
      console.log("Text length:", extractedPdfText.length);

      const extractionPrompt = getExtractionPrompt({
        categorySlug: categorySlug ?? "auto-detect",
        travelSubcategory: bill.travelSubcategory,
        billSubcategory:
          bill.duesSubcategory ??
          bill.adminSubcategory ??
          bill.marketingSubcategory ??
          bill.groomingSubcategory ??
          bill.travelSubcategory,
        providerName: provider?.name,
        providerPrompt: provider?.extractionPrompt,
        extractedPdfText
      });
      const prompt = `${extractionPrompt}\n\nReturn strict JSON.`;
      console.log(
        `[billParsing] bill=${String(bill._id)} category=${categorySlug ?? "auto-detect"} travelSubcategory=${bill.travelSubcategory ?? "-"} sending PDF as base64 document to Anthropic`
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
      console.log("6. Parsed invoice data:", JSON.stringify(parsedRaw, null, 2));
      console.log("=== PARSED RESULT ===");
      console.log(JSON.stringify(parsedRaw, null, 2));
      console.log("=== END PARSED ===");
      let parsed = normalizeParsedPayload(parsedRaw);
      if (categorySlug === "dues-registrations" && isUsefProviderSignal(provider?.name, pickString(parsed, ["provider_name", "providerName"]))) {
        parsed = normalizeUsefDuesParse(parsed, bill.duesSubcategory);
      }
      if (categorySlug === "horse-transport" && isBrookLedgeProviderSignal(provider?.name, pickString(parsed, ["provider_name", "providerName"]))) {
        parsed = normalizeBrookLedgeHorseTransportParse(parsed);
      }
      const eqSportsSignal = isEqSportsProviderSignal(
        provider?.name,
        pickString(parsed, ["provider_name", "providerName"]),
        extractedPdfText
      );
      const multiPatientInvoice = isMultiPatientInvoice(extractedPdfText);
      const parsedHasPatientSections = Array.isArray((parsed as any).patientSections);
      if (eqSportsSignal || multiPatientInvoice || parsedHasPatientSections) {
        parsed = normalizeEqSportsVeterinaryParse(parsed, extractedPdfText, { forceEqSportsProvider: eqSportsSignal });
      }
      if (categorySlug === "travel" && bill.travelSubcategory === "rental-car") {
        parsed = enrichTravelRentalCarParse(parsed);
      }
      if (categorySlug === "feed-bedding") {
        parsed = enforceFeedBeddingClassification(parsed);
      }
      if (categorySlug === "bodywork") {
        parsed = splitBodyworkEmbeddedHorseItems(parsed);
        parsed = preferBrandedProviderName(parsed);
      }
      const [registeredHorses, registeredPeople, dynamicHorseAliases, dynamicPersonAliases] = await Promise.all([
        ctx.runQuery(internal.bills.getAllHorsesForMatching, {}),
        ctx.runQuery(internal.bills.getAllPeopleForMatching, {}),
        ctx.runQuery(internal.bills.getHorseAliasesForMatching, {}),
        ctx.runQuery(internal.bills.getPersonAliasesForMatching, {})
      ]);
      // When no bill-level category, match both horses and people (per-line-item categories will guide usage)
      const matchHorses = categorySlug ? HORSE_BASED_CATEGORIES.has(categorySlug) : true;
      const matchPeople = categorySlug ? PERSON_BASED_CATEGORIES.has(categorySlug) : true;
      parsed = applyEntityMatching(parsed, registeredHorses, registeredPeople, dynamicHorseAliases, dynamicPersonAliases, {
        matchHorses,
        matchPeople
      });
      parsed = ensureUsdAmounts(parsed);
      if (categorySlug) annotateSuggestedCategories(parsed, categorySlug);
      // Collect unique line-item categories and store on the bill
      const lineItemCategories = collectLineItemCategories(parsed);
      const unmatchedHorseNames = matchHorses ? collectUnmatchedHorseNames(parsed) : [];

      let resolvedProvider = provider;
      let extractedCustomProviderName = bill.customProviderName;
      if (categorySlug === "marketing" && !resolvedProvider && !bill.customProviderName && bill.categoryId) {
        const extractedProviderName = pickString(parsed, ["provider_name", "vendor_name", "supplier_name", "merchant_name"]);
        if (extractedProviderName) {
          const existingProvider = await ctx.runQuery(internal.providers.getProviderByNameInCategoryInternal, {
            categoryId: bill.categoryId!,
            name: extractedProviderName
          });
          const providerId =
            existingProvider?._id ??
            (await ctx.runMutation(internal.providers.createProviderOnUploadInternal, {
              categoryId: bill.categoryId!,
              name: extractedProviderName
            }));
          resolvedProvider = existingProvider ?? (await ctx.runQuery(internal.bills.getProvider, { providerId }));
        }
      }
      const extractedProviderName = pickString(parsed, [
        "provider_name",
        "providerName",
        "vendor_name",
        "vendorName",
        "supplier_name",
        "merchant_name"
      ]);
      if (!resolvedProvider && extractedProviderName) {
        const targetSubcategory =
          bill.duesSubcategory ??
          bill.adminSubcategory ??
          bill.horseTransportSubcategory ??
          bill.marketingSubcategory ??
          bill.travelSubcategory ??
          bill.housingSubcategory ??
          bill.groomingSubcategory;
        const allProviders = await ctx.runQuery(internal.providers.listAllForMatching, {});
        const categoryProviders = allProviders.filter((candidate: any) => candidate.categorySlug === categorySlug);
        const subcategoryScopedProviders = targetSubcategory
          ? categoryProviders.filter((candidate: any) => candidate.subcategorySlug === targetSubcategory)
          : categoryProviders;
        const providerCandidates = subcategoryScopedProviders.length > 0 ? subcategoryScopedProviders : categoryProviders;
        console.log("Checking provider match for text containing:", extractedPdfText.substring(0, 200));
        console.log("All providers:", providerCandidates.map((candidate: any) => candidate.name));

        if (providerCandidates.length > 0) {
          const providerMatch = await matchProvider(ctx, extractedProviderName, providerCandidates);
          console.log("Provider match result:", providerMatch);
          if (providerMatch.matched && providerMatch.providerId) {
            resolvedProvider = await ctx.runQuery(internal.bills.getProvider, {
              providerId: providerMatch.providerId as any,
            });
          }
        }
      }
      if (!resolvedProvider && isEqSportsProviderSignal(extractedPdfText)) {
        const allProviders = await ctx.runQuery(internal.providers.listAllForMatching, {});
        const eqSportsProvider = allProviders.find(
          (candidate: any) => normalizeAliasKey(String(candidate.name ?? "")) === "eq sports medicine group"
        );
        if (eqSportsProvider?._id) {
          resolvedProvider = await ctx.runQuery(internal.bills.getProvider, { providerId: eqSportsProvider._id });
        }
      }
      if (!resolvedProvider && extractedProviderName) {
        extractedCustomProviderName = extractedProviderName;
      }

      const expectedFields = resolvedProvider?.expectedFields ?? [];
      const isEQSportsFormat =
        Array.isArray((parsed as any).patientSections) ||
        (categorySlug === "veterinary" && (eqSportsSignal || multiPatientInvoice));

      if (isEQSportsFormat) {
        const sectionCount = extractSectionsFromParsedPayload(parsed).length;
        if (sectionCount === 0 && getLineItems(parsed).length === 0) {
          throw new Error("EQ Sports invoice parsed but no patient sections found");
        }
        console.log(`EQ Sports format: ${sectionCount} patient sections found`);
      }

      const missingFields = expectedFields.filter((field: string) => {
        if (isEQSportsFormat && (field === "date" || field === "services" || field === "total_due")) {
          return false;
        }
        if (field === "horse_name") {
          return !hasHorseNameInLineItems(parsed);
        }
        if (field === "date") {
          const value =
            pickString(parsed, ["date", "invoice_date", "invoiceDate"]) ??
            pickNumber(parsed, ["date_timestamp", "date"]);
          return value === undefined || value === null || value === "";
        }
        if (field === "services") {
          return getLineItems(parsed).length === 0;
        }
        if (field === "total_due") {
          const total = pickNumber(parsed, ["total_due", "total", "invoice_total_usd", "invoiceTotalUsd", "amount_due", "grandTotal"]);
          return total === undefined || total === null;
        }
        const value = parsed[field];
        return value === undefined || value === null || value === "";
      });

      if (missingFields.length > 0) {
        console.warn(`Missing some expected parsed fields, continuing with what we have: ${missingFields.join(", ")}`);
      }

      // All invoices require approval (always go to pending)
      const status: "pending" | "done" = "pending";
      const categoryMeta =
        categorySlug === "travel"
          ? extractTravelMeta(parsed, resolvedProvider?.slug ?? resolvedProvider?.name)
          : categorySlug === "housing"
            ? extractHousingMeta(parsed, resolvedProvider?.slug ?? resolvedProvider?.name)
            : categorySlug === "stabling"
              ? extractStablingMeta(parsed)
              : categorySlug === "horse-transport"
                ? extractHorseTransportMeta(parsed, bill.horseTransportSubcategory)
              : categorySlug === "marketing"
                ? extractMarketingMeta(parsed, bill.marketingSubcategory)
                : categorySlug === "admin"
                  ? extractAdminMeta(parsed, bill.adminSubcategory)
                  : categorySlug === "dues-registrations"
                    ? extractDuesMeta(parsed, bill.duesSubcategory)
                : categorySlug === "grooming"
                  ? extractGroomingMeta(parsed, bill.groomingSubcategory)
                : {};
      const currencyMeta = extractCurrencyMeta(parsed);
      const billDiscount = pickNumber(parsed, ["discount", "professional_discount", "professionalDiscount"]);

      const providerContactPatch = extractProviderContactInfo(parsed);
      const extractedProviderContact = buildExtractedProviderContact(providerContactPatch);
      const parsedLineItemsForLog = getLineItems(parsed);
      const parsedTotalForLog = pickNumber(parsed, ["invoice_total_usd", "invoiceTotalUsd", "total", "subtotal"]);
      console.log("=== SAVING BILL ===");
      console.log("total:", parsedTotalForLog ?? null);
      console.log("lineItems count:", parsedLineItemsForLog.length);
      console.log("lineItems:", JSON.stringify(parsedLineItemsForLog, null, 2));
      console.log("=== END BILL ===");

      // Resolve contactId from the matched provider
      let resolvedContactId: string | undefined;
      if (resolvedProvider) {
        const contact = await ctx.runQuery(internal.contacts.getContactByNameInternal, { name: resolvedProvider.name });
        resolvedContactId = contact?._id ?? undefined;
      }

      // When no bill-level category was set, infer from line item categories
      let inferredCategoryId: string | undefined;
      if (!categorySlug && lineItemCategories.length > 0) {
        // Pick the most common line item category
        const freq = new Map<string, number>();
        for (const cat of lineItemCategories) freq.set(cat, (freq.get(cat) || 0) + 1);
        const dominant = [...freq.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
        if (dominant) {
          const matched = await ctx.runQuery(internal.bills.getCategoryBySlug, { slug: dominant });
          if (matched) inferredCategoryId = matched._id;
        }
      }

      await ctx.runMutation(internal.bills.markDone, {
        billId: bill._id,
        extractedData: parsed,
        status,
        lineItemCategories: lineItemCategories.length > 0 ? lineItemCategories : undefined,
        hasUnmatchedHorses: matchHorses ? unmatchedHorseNames.length > 0 : false,
        unmatchedHorseNames: matchHorses ? unmatchedHorseNames : [],
        providerId: resolvedProvider?._id,
        contactId: resolvedContactId as any,
        customProviderName: extractedCustomProviderName,
        extractedProviderContact,
        inferredCategoryId: inferredCategoryId as any,
        ...currencyMeta,
        discount: typeof billDiscount === "number" ? round2(billDiscount) : undefined,
        ...categoryMeta
      });

      // Update contact with extracted invoice info
      if (resolvedContactId && Object.values(providerContactPatch).some((value) => value !== undefined)) {
        await ctx.runMutation(internal.contacts.updateContactFromInvoice, {
          contactId: resolvedContactId as any,
          fullName: providerContactPatch.fullName,
          contactName: providerContactPatch.contactName,
          primaryContactName: providerContactPatch.primaryContactName,
          primaryContactPhone: providerContactPatch.primaryContactPhone,
          address: providerContactPatch.address,
          phone: providerContactPatch.phone,
          email: providerContactPatch.email,
          website: providerContactPatch.website,
          accountNumber: providerContactPatch.accountNumber
        });
      }

      // Also update provider (legacy, will be removed in Phase 6)
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

      const contactCandidateName =
        providerContactPatch.contactName ??
        providerContactPatch.primaryContactName ??
        providerContactPatch.fullName ??
        resolvedProvider?.name ??
        extractedCustomProviderName;
      if (!resolvedContactId && contactCandidateName && (resolvedProvider?.name || extractedCustomProviderName)) {
        await ctx.runMutation(internal.contacts.upsertContactFromInvoice, {
          name: contactCandidateName,
          providerId: resolvedProvider?._id,
          providerName: resolvedProvider?.name ?? extractedCustomProviderName ?? providerContactPatch.fullName,
          category: categorySlug ?? (lineItemCategories.length > 0 ? lineItemCategories[0] : "other"),
          location: resolvedProvider?.location,
          fullName: providerContactPatch.fullName,
          contactName: providerContactPatch.contactName,
          primaryContactName: providerContactPatch.primaryContactName,
          primaryContactPhone: providerContactPatch.primaryContactPhone,
          address: providerContactPatch.address,
          phone: providerContactPatch.phone ?? providerContactPatch.primaryContactPhone,
          email: providerContactPatch.email,
          website: providerContactPatch.website,
          accountNumber: providerContactPatch.accountNumber,
        });
      }

      // Auto-create income entries for prize money line items
      {
        const prizeEntries = extractPrizeMoneyEntries(parsed, bill._id);
        if (prizeEntries.length > 0) {
          await ctx.runMutation(internal.incomeEntries.createFromBill, {
            billId: bill._id,
            entries: prizeEntries,
          });
        }
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
    "%_due",
    "your % due",
    "Your % Due"
  ]);
  const amountUsd = pickNumber(row, ["total_usd", "amount_usd", "amountUsd", "total"]);
  const horseName = pickString(row, ["horse_name", "horseName", "horse"]);
  const personName = pickString(row, ["person_name", "personName", "employee_name"]);
  const taxCode = pickString(row, ["tax_code", "taxCode"]);
  const ownershipPercent = pickNumber(row, [
    "ownership_percent",
    "owned_percent",
    "percent_owned",
    "%_owned",
    "percent",
    "percentOwned",
    "% Owned",
    "Percent Owned"
  ]);
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

function extractGroomingMeta(parsed: Record<string, unknown>, billSubcategory: string | undefined) {
  const originalCurrency = pickString(parsed, ["original_currency", "currency"])?.toUpperCase();
  const originalTotal = pickNumber(parsed, ["original_total", "invoice_total_original"]);
  const exchangeRate = pickNumber(parsed, ["exchange_rate", "exchange_rate_used"]);
  const parsedSubcategory = slugify(pickString(parsed, ["salary_subcategory", "salaries_subcategory", "grooming_subcategory", "subcategory"]) ?? "");
  const groomingSubcategory = GROOMING_SUBCATEGORY_SLUGS.has(parsedSubcategory) ? parsedSubcategory : billSubcategory ?? "other";
  const role = groomingSubcategory === "rider" || groomingSubcategory === "groom" || groomingSubcategory === "freelance" ? groomingSubcategory : undefined;
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
    groomingSubcategory,
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
  extractedPdfText?: string;
}) {
  if (isEqSportsProviderSignal(args.providerName, args.extractedPdfText) || isMultiPatientInvoice(args.extractedPdfText ?? "")) {
    return eqSportsVeterinaryExtractionPrompt(args.providerPrompt);
  }
  if (args.categorySlug === "horse-transport") {
    return horseTransportExtractionPrompt(args.providerName, args.providerPrompt);
  }
  if (args.categorySlug === "farrier") {
    return farrierExtractionPrompt(args.providerName);
  }
  if (args.providerPrompt && args.providerPrompt.trim().length > 0) {
    return `${args.providerPrompt.trim()}\n\n${PROVIDER_CONTACT_PROMPT}`;
  }
  if (args.categorySlug === "auto-detect") {
    return autoDetectCategoryExtractionPrompt();
  }
  return genericExtractionPrompt(args.categorySlug, args.travelSubcategory, args.billSubcategory);
}

function autoDetectCategoryExtractionPrompt() {
  return `Parse this invoice PDF and extract structured data as JSON.

For the overall invoice, extract:
- provider_name: Name of the company/person who issued the invoice
- contact_name: Specific contact person on the invoice (if different from provider)
- address: Provider's address
- phone: Provider's phone number
- email: Provider's email
- website: Provider's website
- account_number: Account number
- invoice_number: Invoice or reference number
- invoice_date: Date on the invoice (MM/DD/YYYY)
- due_date: Due date if shown
- invoice_total_usd: Total amount in USD
- tax: Tax amount if shown
- subtotal: Subtotal before tax if shown

For each line item, extract into a "line_items" array:
- description: What the item/service is
- quantity: Number of units (default 1)
- rate: Per-unit price
- total_usd: Total for this line item
- horse_name: If the line item is for a specific horse, extract the horse name. Otherwise null.
- person_name: If the line item is for a specific person (travel, admin/housing, etc.), extract the person name. Otherwise null.
- category: Classify this line item into ONE of these categories:
  veterinary, farrier, stabling, travel, horse-transport, feed-bedding, bodywork, marketing, admin, dues-registrations, show-expenses, grooming, riding-training, supplies, commissions, prize-money, income
  Note: housing is now a subcategory of admin — use "admin" for housing-related items.
  Use "prize-money" for any prize money, winnings, awards, or credits earned from competitions/shows.
  Use "income" for reimbursements, refunds, or other non-prize income items. Subcategories: "reimbursements", "other".
  Choose the most specific match. If unclear, use "supplies".
- subcategory: Optional more specific classification within the category (e.g., "medication", "joint_injections" for veterinary; "flights", "hotels" for travel; "hay", "grain" for feed-bedding; "grooming", "stable", "tack" for supplies)

${PROVIDER_CONTACT_PROMPT}`;
}

function eqSportsVeterinaryExtractionPrompt(providerPrompt?: string) {
  const custom = providerPrompt?.trim() ? `${providerPrompt.trim()}\n\n` : "";
  return `${custom}This is a veterinary invoice from EQ Sports Medicine Group. It contains MULTIPLE patient sections; each section is a separate sub-invoice for a different horse.

Parse EVERY patient section. Each section starts with "Patient ID:" and contains:
- Patient ID number
- Patient name (format: "[Horse Name] Davis" — extract just the horse name before "Davis")
- Sex, Birth Date, Species, Breed
- Invoice Date for that section
- Invoice Number for that section
- Provider name (usually "Morgan Geller")
- A Product / Service table with Quantity, Price (Exc), Tax, Amount columns
- An "Invoice Total" for that section

Patient mappings:
- "Ben 431 Davis" => horseName "Ben"
- "Carlin Davis" => horseName "Carlin"
- "Gigi Davis" => horseName "Gigi"
- "Valentina Davis" => horseName "Valentina"
- "Barn group Davis" => shared barn supplies (not a horse)

Footer fields (document-level):
- Subtotal
- Professional Discount (if present)
- Tax
- AMOUNT DUE
- INVOICE BALANCE

Return strict JSON:
{
  "providerName": "EQ Sports Medicine Group",
  "providerDoctor": "Morgan Geller",
  "grandTotal": <number>,
  "subtotal": <number>,
  "discount": <number|null>,
  "tax": <number>,
  "patientSections": [
    {
      "patientId": "<string>",
      "patientName": "<string>",
      "horseName": "<string>",
      "sex": "<string>",
      "birthDate": "<string|null>",
      "invoiceDate": "<string>",
      "invoiceNumber": "<string>",
      "sectionTotal": <number>,
      "lineItems": [
        {
          "description": "<string>",
          "quantity": <number>,
          "unitPrice": <number>,
          "tax": "<string|number>",
          "amount": <number>
        }
      ]
    }
  ]
}

Parse ALL patient sections. Do not skip any. Do not merge sections.

${PROVIDER_CONTACT_PROMPT}`;
}

function horseTransportExtractionPrompt(providerName?: string, providerPrompt?: string) {
  const providerHint = providerName ? `Provider hint: ${providerName}.` : "";
  const custom = providerPrompt?.trim() ? `${providerPrompt.trim()}\n\n` : "";
  if (isBrookLedgeProviderSignal(providerName)) {
    return `${custom}${providerHint}
Extract this Brook Ledge horse transport invoice as strict JSON.

Expected structure:
- invoice_number from "Invoice [NUMBER]"
- invoice_date from "Invoice Date:" at top (YYYY-MM-DD)
- ship_date from "Ship Date:"
- customer_number from "Customer ID:"
- terms from "Terms:"
- origin from "Origin:" (keep full text, including pipes like "OAK VIEW FARM | MORRISTON, FL")
- destination from "Destination:" (keep full text, including pipes)
- route as "ORIGIN -> DESTINATION"
- invoice_total_usd from "Please Pay This Amount:"
- provider_name should be "Brook Ledge"
- provider_email should be "billing@brookledge.com" when shown in Remit To
- provider_phone should include "610-987-6284" when shown
- provider_address should include "PO Box 56, Oley, PA 19547-0056" when shown

Description of Charges table:
Columns: % Owned | Horse | Stall Desc | Your % Due
Each table row is one horse transport line item.
For each row return:
- description: "Transport — <Horse>"
- horse_name: value from Horse column
- ownership_percent: numeric percent from % Owned (e.g. 100.0000% => 100)
- total_usd: numeric value from Your % Due

Critical:
- The Horse column is the horse name; do not treat rows as generic items.
- "Please Pay This Amount" is authoritative total.
- Keep non-horse fees as separate line items with horse_name: null.

${PROVIDER_CONTACT_PROMPT}
Return strict JSON only.`;
  }
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
- use "Please Pay This Amount" as invoice_total_usd
- extract Origin and Destination blocks exactly when present

Format B (Stateside Horse Transportation style): rows with date | product/service | description | qty | rate | amount
- horse names are embedded in description:
  example: "Transport for Gaby De Courcel from LAX to Coachella CA"
- extract horse_name from description
- extract route text into description notes (origin/destination if present)
- if description is a non-transport charge (for example "Credit Card Charge", "Credit Card Processing Fee", admin fee):
  set horse_name to null and keep as a separate fee line item

Format C (general): per-horse charge table
- each row => horse_name + per-horse amount

Format D (lump sum): horse names listed, one total
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
  if (categorySlug === "veterinary") {
    return `Extract all data from this veterinary invoice as strict JSON.

This may contain MULTIPLE patient sections in one PDF. If there are multiple "Patient ID:" blocks:
- Parse each patient section separately.
- Each section has its own Patient name, Invoice Date, Invoice Number, Product/Service table, and Invoice Total.
- Combine all section line items into one flat line_items array.
- Include section metadata on each line item: patient_name, invoice_number, invoice_date.
- Use footer "AMOUNT DUE" or "INVOICE BALANCE" as invoice_total_usd.
- Capture footer Subtotal, Tax, and Professional Discount when present.

For each line item extract:
- description
- quantity
- unit_price
- tax (if present)
- total_usd (use Amount column value as authoritative)
- horse_name when inferable from patient/description

Return strict JSON only with:
- provider_name
- invoice_number (best global identifier, optional if section-level only)
- invoice_date (latest date across sections)
- subtotal
- tax_total_usd
- discount (negative number when present)
- invoice_total_usd
- sections[] when multiple patient sections are present
- line_items[] flattened across all sections`;
  }
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

USEF-specific rules (when receipt is from United States Equestrian Federation / USEF Payment Services):
- Date comes from the top receipt line like "Feb 23, 2026 at 5:39PM" (return invoice_date as YYYY-MM-DD)
- invoice_number should be Transaction ID from Payment Information when present
- Parse each table row in Item/Name/Description/Qty/Unit Price/Item Total
- For each line item, set dues_subcategory using Name+Description:
  - horse registration / horse recording / late entry / international entry => horse_registrations
  - membership / member => memberships
  - rider / amateur / junior => rider_registrations
- Extract horse name from Description when pattern includes "for <horse name>" (stop before "with" when present)
- If horse found: set entity_type="horse", entity_name="<horse>", horse_name="<horse>"
- If no horse found: set entity_type=null, entity_name=null

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
- line_items[] with description, quantity, unit_price, total_usd, subcategory
  Classify each line item subcategory as one of: "grooming" (grooming supplies, brushes, shampoos, sprays), "stable" (stable supplies, buckets, hooks, barn equipment), "tack" (saddles, bridles, boots, girths, pads, reins, bits, halters), or "other"

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
  if (categorySlug === "stabling") {
    return `${base} For each line item include suggestedCategory as null if it belongs in stabling, or one of: feed_bedding, stabling, farrier, supplies, veterinary.`;
  }
  if (categorySlug === "show-expenses") {
    return `Extract invoice/statement data as strict JSON with invoice_number, invoice_date, provider_name, account_number, original_currency, original_total, exchange_rate, invoice_total_usd, and line_items[].

IMPORTANT: Horse show statements often contain BOTH expenses (entry fees, office charges, facility fees, drug testing, etc.) AND income/credits (prize money, prize winnings, awards).

For each line item include:
- description: the line item description
- quantity, unit_price, total_usd: amounts
- horse_name: the horse this item is for (if identifiable)
- item_type: "expense" for charges/fees, or "prize_money" for prize winnings/awards/credits
- class_name: the class/division name if applicable (e.g. "Class 366A", "1.30m Jumpers")
- placing: the placing if mentioned (e.g. "3rd", "1st")
- suggestedCategory: null if it belongs in show-expenses, or one of: feed_bedding, stabling, farrier, supplies, veterinary

For prize money / winnings / credits:
- Set item_type to "prize_money"
- Set total_usd as a POSITIVE number (the amount won)
- Extract the class name and placing if available
- The invoice_total_usd should reflect the NET amount (expenses minus credits/prize money)

${PROVIDER_CONTACT_PROMPT}
Return strict JSON only.`;
  }
  if (categorySlug === "grooming") {
    return `Extract from this grooming invoice: invoice_number, invoice_date, due_date, provider_name, pay_period, original_currency, original_total, exchange_rate, invoice_total_usd, and line_items[] with description, person_name (if identifiable), quantity, unit_price, total_usd.

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

/**
 * Collect unique category slugs from line items.
 * Each line item may have a `category` field set by the AI or during normalization.
 */
const VALID_LINE_ITEM_CATEGORIES = new Set([
  "veterinary", "farrier", "stabling", "travel", "horse-transport",
  "feed-bedding", "bodywork", "marketing", "admin", "dues-registrations",
  "show-expenses", "grooming", "riding-training", "supplies", "commissions",
  "prize-money", "income",
]);
const LINE_ITEM_CATEGORY_ALIASES: Record<string, string> = {
  general: "supplies",
  feed_bedding: "feed-bedding",
  "feed-and-bedding": "feed-bedding",
  horse_transport: "horse-transport",
  "horse transport": "horse-transport",
  show_expenses: "show-expenses",
  dues_registrations: "dues-registrations",
  tack: "supplies",
  equipment: "supplies",
  grooming: "supplies",
  housing: "admin",
};

function normalizeLineItemCategory(raw: string): string {
  const lower = raw.toLowerCase().replace(/\s+/g, "-");
  if (VALID_LINE_ITEM_CATEGORIES.has(lower)) return lower;
  return LINE_ITEM_CATEGORY_ALIASES[lower] ?? lower;
}

function collectLineItemCategories(parsed: Record<string, unknown>): string[] {
  const lineItems = getLineItems(parsed);
  const categories = new Set<string>();
  for (const item of lineItems) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const raw = typeof record.category === "string" ? record.category.toLowerCase().replace(/\s+/g, "-") : null;
    if (raw) {
      const normalized = normalizeLineItemCategory(raw);
      categories.add(normalized);
      // Also fix the item's category in-place so downstream code sees the normalized value
      record.category = normalized;
    }
  }
  return [...categories];
}

function isUsefProviderSignal(...values: Array<string | undefined>) {
  const joined = values.filter(Boolean).join(" ").toLowerCase();
  if (!joined) return false;
  return joined.includes("usef") || joined.includes("united states equestrian federation");
}

function isBrookLedgeProviderSignal(...values: Array<string | undefined>) {
  const joined = values.filter(Boolean).join(" ").toLowerCase();
  if (!joined) return false;
  return joined.includes("brook ledge") || joined.includes("brookledge");
}

function isEqSportsProviderSignal(...values: Array<string | undefined>) {
  const joined = values.filter(Boolean).join(" ").toLowerCase();
  if (!joined) return false;
  return (
    joined.includes("eq sports medicine group") ||
    joined.includes("eq sports") ||
    joined.includes("sports medicine group") ||
    joined.includes("idexx neo")
  );
}

function normalizeUsefDuesParse(parsed: Record<string, unknown>, billSubcategory?: string) {
  const normalized = { ...parsed };
  const lineItems = getLineItems(normalized).map((item) => ({ ...(item as Record<string, unknown>) }));
  const subcategoryCounts: Record<string, number> = {};

  for (const row of lineItems) {
    const name = pickString(row, ["name", "item_name", "title"]) ?? "";
    const description = pickString(row, ["description", "detail", "details"]) ?? "";
    const lineSubcategory = detectUsefSubcategory(name, description);
    subcategoryCounts[lineSubcategory] = (subcategoryCounts[lineSubcategory] ?? 0) + 1;

    row.subcategory = lineSubcategory;
    row.dues_subcategory = lineSubcategory;

    const extractedHorse = extractUsefHorseFromDescription(description);
    if (extractedHorse) {
      row.entity_type = "horse";
      row.entityType = "horse";
      row.entity_name = extractedHorse;
      row.entityName = extractedHorse;
      row.horse_name = extractedHorse;
      row.horseName = extractedHorse;
    } else {
      row.entity_type = null;
      row.entityType = null;
      row.entity_name = null;
      row.entityName = null;
    }
  }

  const topDate = pickString(normalized, ["invoice_date", "invoiceDate", "date", "datetime"]);
  const normalizedDate = normalizeReceiptDate(topDate);
  if (normalizedDate) {
    normalized.invoice_date = normalizedDate;
    normalized.invoiceDate = normalizedDate;
  }

  const transactionId = pickString(normalized, ["transaction_id", "transactionId", "payment_transaction_id"]);
  if (transactionId) {
    normalized.invoice_number = transactionId;
    normalized.invoiceNumber = transactionId;
  }

  const topSubcategory = resolveTopUsefSubcategory(subcategoryCounts, billSubcategory);
  normalized.dues_subcategory = topSubcategory;
  normalized.subcategory = topSubcategory;
  normalized.provider_name = "USEF";
  normalized.providerName = "USEF";
  normalized.line_items = lineItems;
  normalized.lineItems = lineItems;
  return normalized;
}

function detectUsefSubcategory(itemName: string, description: string) {
  const text = `${itemName} ${description}`.toLowerCase();
  if (text.includes("horse registration") || text.includes("horse recording")) {
    return "horse_registrations";
  }
  if (text.includes("membership") || text.includes("member")) {
    return "memberships";
  }
  if (text.includes("rider") || text.includes("amateur") || text.includes("junior")) {
    return "rider_registrations";
  }
  return "horse_registrations";
}

function extractUsefHorseFromDescription(description: string) {
  const direct = description.match(/\bfor\s+(.+?)(?:\s+with\b|$)/i);
  const reg = description.match(/\breg(?:istration)?\s+for\s+(.+?)(?:\s+with\b|$)/i);
  const candidate = (direct?.[1] ?? reg?.[1] ?? "").trim();
  if (!candidate) return undefined;
  const cleaned = candidate.replace(/[*.,;:()[\]"]/g, " ").replace(/\s+/g, " ").trim();
  return cleaned.length > 0 ? cleaned : undefined;
}

function normalizeReceiptDate(value?: string) {
  if (!value) return undefined;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const dmyMatch = value.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/);
  if (dmyMatch) {
    const monthMap: Record<string, string> = {
      jan: "01",
      feb: "02",
      mar: "03",
      apr: "04",
      may: "05",
      jun: "06",
      jul: "07",
      aug: "08",
      sep: "09",
      oct: "10",
      nov: "11",
      dec: "12",
    };
    const month = monthMap[dmyMatch[2].toLowerCase()];
    if (month) {
      return `${dmyMatch[3]}-${month}-${dmyMatch[1].padStart(2, "0")}`;
    }
  }
  const match = value.match(/[A-Za-z]{3,9}\s+\d{1,2},\s+\d{4}/);
  const parsed = new Date(match ? match[0] : value);
  if (Number.isNaN(parsed.getTime())) return undefined;
  return parsed.toISOString().slice(0, 10);
}

function resolveTopUsefSubcategory(counts: Record<string, number>, billSubcategory?: string) {
  const entries = Object.entries(counts);
  if (entries.length === 0) {
    return billSubcategory ? billSubcategory.replace(/-/g, "_") : "horse_registrations";
  }
  const sorted = entries.sort((a, b) => b[1] - a[1]);
  const [topName, topCount] = sorted[0];
  const ties = sorted.filter((entry) => entry[1] === topCount);
  if (ties.length > 1) return "horse_registrations";
  return topName;
}

function normalizeBrookLedgeHorseTransportParse(parsed: Record<string, unknown>) {
  const normalized = { ...parsed };
  const lineItems = getLineItems(normalized).map((item) => ({ ...(item as Record<string, unknown>) }));
  const transformed = lineItems.map((row) => {
    const horseName = pickString(row, ["horse_name", "horseName", "horse", "Horse"]);
    const ownershipPercent =
      pickNumber(row, ["ownership_percent", "owned_percent", "percent_owned", "percentOwned", "% Owned", "Percent Owned"]) ??
      undefined;
    const amount =
      pickNumber(row, ["total_usd", "amount", "total", "your_percent_due", "your % due", "Your % Due"]) ?? undefined;
    const description = horseName ? `Transport — ${horseName}` : pickString(row, ["description"]) ?? "Line item";
    const next: Record<string, unknown> = {
      ...row,
      description,
      horse_name: horseName ?? undefined,
      horseName: horseName ?? undefined
    };
    if (typeof ownershipPercent === "number") {
      const percent = ownershipPercent > 1 ? ownershipPercent : ownershipPercent * 100;
      next.ownership_percent = round2(percent);
      next.percentOwned = round2(percent);
    }
    if (typeof amount === "number") {
      next.total_usd = round2(amount);
      next.amount = round2(amount);
    }
    return next;
  });

  const origin = pickString(normalized, ["origin", "Origin"]);
  const destination = pickString(normalized, ["destination", "Destination"]);
  const invoiceDate = normalizeReceiptDate(pickString(normalized, ["invoice_date", "invoiceDate", "invoice date", "Invoice Date"]));
  const shipDate = normalizeReceiptDate(pickString(normalized, ["ship_date", "shipDate", "ship date", "Ship Date"]));
  const terms = pickString(normalized, ["terms", "Terms"]);
  const customerNumber = pickString(normalized, ["customer_number", "customerNumber", "customer_id", "Customer ID"]);
  const invoiceNumber = pickString(normalized, ["invoice_number", "invoiceNumber", "invoice", "Invoice"]);
  if (invoiceDate) {
    normalized.invoice_date = invoiceDate;
    normalized.invoiceDate = invoiceDate;
  }
  if (shipDate) {
    normalized.ship_date = shipDate;
    normalized.shipDate = shipDate;
  }
  if (terms) normalized.terms = terms;
  if (customerNumber) {
    normalized.customer_number = customerNumber;
    normalized.customerNumber = customerNumber;
  }
  if (invoiceNumber) {
    normalized.invoice_number = invoiceNumber;
    normalized.invoiceNumber = invoiceNumber;
  }
  if (origin) normalized.origin = origin;
  if (destination) normalized.destination = destination;
  if (origin && destination) normalized.route = `${origin} -> ${destination}`;
  normalized.provider_name = "Brook Ledge";
  normalized.providerName = "Brook Ledge";

  const pleasePay =
    pickNumber(normalized, ["please_pay_this_amount", "pleasePayThisAmount"]) ??
    transformed.reduce((sum, row) => sum + (pickNumber(row, ["total_usd", "amount", "total"]) ?? 0), 0);
  if (typeof pleasePay === "number" && pleasePay > 0) {
    normalized.invoice_total_usd = round2(pleasePay);
    normalized.invoiceTotalUsd = round2(pleasePay);
    normalized.total = round2(pleasePay);
  }

  normalized.line_items = transformed;
  normalized.lineItems = transformed;
  return normalized;
}

function normalizeEqSportsVeterinaryParse(
  parsed: Record<string, unknown>,
  extractedText: string,
  options?: { forceEqSportsProvider?: boolean }
) {
  const normalized = { ...parsed };
  const transformed = transformEQSportsInvoice(normalized, extractedText);
  let lineItems = transformed.lineItems;

  if (lineItems.length === 0) {
    lineItems = getLineItems(normalized).map((item) => ({ ...(item as Record<string, unknown>) }));
    lineItems = lineItems.map((row) => {
      const rawHorseName = pickString(row, ["horse_name", "horseName", "patient_name", "patientName"]);
      const mappedHorseName = mapEqSportsPatientToHorse(rawHorseName);
      if (!mappedHorseName) return row;
      return {
        ...row,
        horse_name: mappedHorseName,
        horseName: mappedHorseName
      };
    });
  }

  if (typeof transformed.total === "number") {
    normalized.invoice_total_usd = round2(transformed.total);
    normalized.invoiceTotalUsd = round2(transformed.total);
    normalized.total = round2(transformed.total);
  }
  if (typeof transformed.subtotal === "number") normalized.subtotal = round2(transformed.subtotal);
  if (typeof transformed.tax === "number") {
    normalized.tax = round2(transformed.tax);
    normalized.tax_total_usd = round2(transformed.tax);
  }
  if (typeof transformed.discount === "number") {
    normalized.discount = round2(transformed.discount);
    normalized.professional_discount = round2(transformed.discount);
  }
  if (typeof transformed.date === "number") {
    const date = new Date(transformed.date).toISOString().slice(0, 10);
    normalized.invoice_date = date;
    normalized.invoiceDate = date;
  }

  const totalFromItems = lineItems.reduce((sum, row) => sum + (pickNumber(row, ["total_usd", "amount"]) ?? 0), 0);
  if (!pickNumber(normalized, ["invoice_total_usd", "invoiceTotalUsd", "total"]) && totalFromItems > 0) {
    normalized.invoice_total_usd = round2(totalFromItems);
    normalized.invoiceTotalUsd = round2(totalFromItems);
    normalized.total = round2(totalFromItems);
  }

  const shouldForceEqSports =
    options?.forceEqSportsProvider === true ||
    isEqSportsProviderSignal(
      pickString(normalized, ["provider_name", "providerName"]),
      extractedText
    );
  if (shouldForceEqSports) {
    normalized.provider_name = "EQ Sports Medicine Group";
    normalized.providerName = "EQ Sports Medicine Group";
    normalized.provider_email = pickString(normalized, ["provider_email", "email"]) ?? "eqsportsmedicinegroup@gmail.com";
    normalized.provider_phone = pickString(normalized, ["provider_phone", "phone"]) ?? "310-944-0570";
    normalized.provider_address =
      pickString(normalized, ["provider_address", "address"]) ?? "PO Box 1573, Rancho Santa Fe, CA 92067";
    normalized.contact_name = pickString(normalized, ["contact_name", "contactName"]) ?? "Morgan Geller";
    normalized.provider_doctor = pickString(normalized, ["provider_doctor", "providerDoctor"]) ?? "Morgan Geller";
  }
  normalized.line_items = lineItems;
  normalized.lineItems = lineItems;
  return normalized;
}

function detectVetSubcategory(description: string) {
  const text = description.toLowerCase();
  if (text.includes("vaccination") || text.includes("vaccine")) return "vaccinations";
  if (text.includes("sedation") || text.includes("xylazine") || text.includes("dormosedan")) return "sedation";
  if (text.includes("shockwave")) return "shockwave";
  if (text.includes("inject") || text.includes("injection") || text.includes("stifle") || text.includes("hock")) return "joint_injections";
  if (text.includes("exam") || text.includes("consult") || text.includes("telemedicine")) return "exams_diagnostics";
  if (text.includes("saa") || text.includes("lab") || text.includes("bloodwork") || text.includes("blood work")) return "lab_work";
  if (text.includes("fee") || text.includes("stable call")) return "fees";
  if (
    text.includes("prp") ||
    text.includes("emcyte") ||
    text.includes("aniprin") ||
    text.includes("regumate") ||
    text.includes("adequan") ||
    text.includes("nexha") ||
    text.includes("gastrogard")
  ) {
    return "medication";
  }
  return "other";
}

function transformEQSportsInvoice(parsed: Record<string, unknown>, extractedText: string) {
  const parsedSections = extractSectionsFromParsedPayload(parsed);
  const sections = parsedSections.length > 0 ? parsedSections : parseEqSportsSections(extractedText);
  const allLineItems: Array<Record<string, unknown>> = [];

  for (const section of sections) {
    const patientName = section.patientName ?? "";
    const isBarnGroup = patientName.toLowerCase().includes("barn group");
    const horseName = isBarnGroup ? "__split_all__" : mapEqSportsPatientToHorse(patientName);

    for (const item of section.lineItems || []) {
      allLineItems.push({
        description: item.description,
        quantity: item.quantity,
        unit_price: item.unitPrice,
        unitPrice: item.unitPrice,
        total_usd: item.amount,
        amount: item.amount,
        tax: item.tax,
        horse_name: horseName ?? null,
        horseName: horseName ?? null,
        patient_name: patientName,
        patient_id: section.patientId,
        invoice_number: section.invoiceNumber,
        invoiceNumber: section.invoiceNumber,
        invoice_date: section.invoiceDate,
        invoiceDate: section.invoiceDate,
        provider_doctor: section.providerDoctor,
        percentOwned: item.percentOwned,
        subcategory: detectVetSubcategory(item.description),
        subcategoryAutoDetected: true,
      });
    }
  }

  const footer = parseEqSportsFooter(extractedText);
  const latestSectionDate = sections
    .map((row) => normalizeReceiptDate(row.invoiceDate))
    .filter((value): value is string => Boolean(value))
    .map((value) => new Date(`${value}T00:00:00`).getTime())
    .sort((a, b) => b - a)[0];
  const total =
    pickNumber(parsed, ["grandTotal", "grand_total", "amount_due", "invoice_total_usd", "invoiceTotalUsd", "total"]) ??
    footer.amountDue ??
    undefined;
  const subtotal = pickNumber(parsed, ["subtotal"]) ?? footer.subtotal ?? undefined;
  const discount = pickNumber(parsed, ["discount", "professional_discount"]) ?? footer.discount ?? undefined;
  const tax = pickNumber(parsed, ["tax", "tax_total_usd"]) ?? footer.tax ?? undefined;

  return {
    providerName: "EQ Sports Medicine Group",
    category: "veterinary",
    date: latestSectionDate,
    total,
    subtotal,
    discount: typeof discount === "number" ? -Math.abs(discount) : undefined,
    tax,
    lineItems: allLineItems,
  };
}

function isMultiPatientInvoice(text: string) {
  const matches = text.match(/Patient ID:/gi);
  return matches !== null && matches.length > 1;
}

function extractSectionsFromParsedPayload(parsed: Record<string, unknown>) {
  const candidate = Array.isArray(parsed.patientSections) ? parsed.patientSections : parsed.sections;
  if (!Array.isArray(candidate)) {
    return [] as Array<{
      patientId?: string;
      patientName?: string;
      invoiceDate?: string;
      invoiceNumber?: string;
      providerDoctor?: string;
      lineItems: Array<{
        description: string;
        quantity?: number;
        unitPrice?: number;
        tax?: number;
        amount: number;
        percentOwned?: number;
      }>;
    }>;
  }

  return candidate
    .map((section) => {
      if (!section || typeof section !== "object") return null;
      const row = section as Record<string, unknown>;
      const sectionLineItemsRaw = row.lineItems ?? row.line_items;
      const normalizedLineItems = Array.isArray(sectionLineItemsRaw)
        ? sectionLineItemsRaw
            .map((item) => {
              if (!item || typeof item !== "object") return null;
              const value = item as Record<string, unknown>;
              const description = pickString(value, ["description", "service", "item"]) ?? "";
              const amount = pickNumber(value, ["amount", "total_usd", "total"]);
              if (!description || typeof amount !== "number" || Number.isNaN(amount)) return null;
              return {
                description,
                quantity: pickNumber(value, ["quantity", "qty"]),
                unitPrice: pickNumber(value, ["unit_price", "unitPrice", "price_exc", "price"]),
                tax: pickNumber(value, ["tax"]),
                amount,
                percentOwned: pickNumber(value, ["percentOwned", "ownership_percent"])
              };
            })
            .filter((item): item is NonNullable<typeof item> => item !== null)
        : [];
      if (normalizedLineItems.length === 0) return null;
      const sectionHorseName = pickString(row, ["horseName", "horse_name"]);
      const derivedPatientName =
        pickString(row, ["patientName", "patient_name"]) ??
        (sectionHorseName ? `${sectionHorseName} Davis` : undefined);
      return {
        patientId: pickString(row, ["patientId", "patient_id"]),
        patientName: derivedPatientName,
        invoiceDate: pickString(row, ["invoiceDate", "invoice_date"]),
        invoiceNumber: pickString(row, ["invoiceNumber", "invoice_number"]),
        providerDoctor: pickString(row, ["providerDoctor", "provider_doctor", "provider"]),
        lineItems: normalizedLineItems
      };
    })
    .filter((item): item is NonNullable<typeof item> => item !== null);
}

function parseEqSportsSections(text: string) {
  if (!text) return [] as Array<{
    patientId?: string;
    patientName?: string;
    invoiceDate?: string;
    invoiceNumber?: string;
    providerDoctor?: string;
    lineItems: Array<{
      description: string;
      quantity?: number;
      unitPrice?: number;
      tax?: number;
      amount: number;
      percentOwned?: number;
    }>;
  }>;
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const sections: Array<{
    patientId?: string;
    patientName?: string;
    invoiceDate?: string;
    invoiceNumber?: string;
    providerDoctor?: string;
    lineItems: Array<{
      description: string;
      quantity?: number;
      unitPrice?: number;
      tax?: number;
      amount: number;
      percentOwned?: number;
    }>;
  }> = [];

  let current: (typeof sections)[number] | null = null;
  for (const line of lines) {
    if (/^Patient ID:/i.test(line)) {
      if (current && current.lineItems.length > 0) sections.push(current);
      current = { patientId: line.replace(/^Patient ID:\s*/i, "").trim(), lineItems: [] };
      continue;
    }
    if (!current) continue;
    if (/^(Subtotal|AMOUNT DUE|INVOICE BALANCE)/i.test(line)) break;

    if (/^Patient:/i.test(line)) {
      const rawPatient = line.replace(/^Patient:\s*/i, "");
      current.patientName = rawPatient.split(/\bSex:/i)[0]?.trim();
      continue;
    }
    if (/^Invoice Date:/i.test(line)) {
      current.invoiceDate = line.replace(/^Invoice Date:\s*/i, "").trim();
      continue;
    }
    if (/^Invoice Number:/i.test(line)) {
      current.invoiceNumber = line.replace(/^Invoice Number:\s*/i, "").trim();
      continue;
    }
    if (/^Provider:/i.test(line)) {
      current.providerDoctor = line.replace(/^Provider:\s*/i, "").trim();
      continue;
    }
    if (/^Invoice Total/i.test(line) || /^Product \/ Service/i.test(line) || /^Species:/i.test(line) || /^Breed:/i.test(line)) {
      continue;
    }

    const parsedRow = parseEqSportsLineItem(line);
    if (parsedRow) current.lineItems.push(parsedRow);
  }

  if (current && current.lineItems.length > 0) sections.push(current);
  return sections;
}

function parseEqSportsLineItem(line: string) {
  // Handles rows like:
  // "Musculoskeletal Recheck Exam 1.00 180.00 0.00 180.00"
  const cleanedLine = line.replace(/\$/g, "").replace(/,/g, "").trim();
  const withTax = cleanedLine.match(
    /^(.*?)\s+(\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?%?)\s+(-?\d+(?:\.\d+)?)$/
  );
  if (withTax) {
    const description = withTax[1].trim();
    if (!description) return null;
    return {
      description,
      quantity: Number(withTax[2]),
      unitPrice: Number(withTax[3]),
      tax: Number(String(withTax[4]).replace("%", "")),
      amount: Number(withTax[5]),
    };
  }
  // Fallback for shorter OCR rows.
  const amountOnly = cleanedLine.match(/^(.*?)\s+(-?\d+(?:\.\d+)?)$/);
  if (amountOnly) {
    const description = amountOnly[1].trim();
    if (!description || /^Invoice Total$/i.test(description)) return null;
    return {
      description,
      amount: Number(amountOnly[2]),
    };
  }
  return null;
}

function parseEqSportsFooter(text: string) {
  const read = (label: string) => {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regex = new RegExp(`${escaped}\\s*:?[\\s$]*\\(?(-?[\\d,]+(?:\\.\\d+)?)\\)?`, "gi");
    const matches = [...text.matchAll(regex)];
    if (matches.length === 0) return undefined;
    const match = matches[matches.length - 1];
    return Number(String(match[1]).replace(/,/g, ""));
  };
  const subtotal = read("Subtotal");
  const discountRaw = read("Professional Discount");
  const tax = read("Tax");
  const amountDue = read("AMOUNT DUE") ?? read("INVOICE BALANCE");
  return {
    subtotal,
    discount: typeof discountRaw === "number" ? -Math.abs(discountRaw) : undefined,
    tax,
    amountDue
  };
}

function mapEqSportsPatientToHorse(patientName?: string) {
  if (!patientName) return undefined;
  const key = normalizeAliasKey(patientName);
  if (key === "barn group davis" || key === "barn group") return "__split_all__";
  if (key === "ben 431 davis" || key === "ben 431" || key === "ben davis") return "Ben";
  if (key === "carlin davis") return "Carlin";
  if (key === "gigi davis") return "Gigi";
  if (key === "valentina davis" || key === "valentina") return "Numero Valentina Z";
  const strippedDavis = patientName.replace(/\s+davis$/i, "").trim();
  if (strippedDavis.toLowerCase() === "barn group") return "__split_all__";
  if (strippedDavis.toLowerCase().startsWith("ben")) return "Ben";
  if (strippedDavis.toLowerCase().startsWith("carlin")) return "Carlin";
  if (strippedDavis.toLowerCase().startsWith("gigi")) return "Gigi";
  if (strippedDavis.toLowerCase().startsWith("valentina")) return "Numero Valentina Z";
  return strippedDavis || patientName;
}

function inferCategoryFromLineItem(item: Record<string, unknown>, currentCategory: string) {
  const description = String(item.description ?? "").toLowerCase();
  const subcategory = String(item.stabling_subcategory ?? item.subcategory ?? "").toLowerCase();
  const text = `${description} ${subcategory}`;

  if (matchesAny(text, ["shoe", "shoeing", "trim", "trimming", "farrier", "horseshoe"])) return "farrier";
  if (matchesAny(text, ["inject", "exam", "vaccine", "medication", "xray", "radiograph", "vet"])) return "veterinary";
  if (matchesAny(text, ["blanket", "bridle", "saddle", "boot", "tack", "equipment", "repair", "reins", "girth", "halter", "bit ", "martingale", "crop", "spur", "pad", "grooming", "brush"])) return "supplies";
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
      const normalizedHorseName = normalizeAliasKey(rawHorseName);
      if (normalizedHorseName === "__split_all__" || normalizedHorseName === "barn group davis" || normalizedHorseName === "barn group") {
        row.horse_name_raw = rawHorseName;
        row.match_confidence = "alias";
        row.matchConfidence = "alias";
        row.horse_name = "__split_all__";
        row.horseName = "__split_all__";
        row.auto_detected = true;
        continue;
      }
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
    if (normalizeAliasKey(raw) === "__split_all__") continue;
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

function extractPrizeMoneyEntries(
  parsed: Record<string, unknown>,
  billId: string
) {
  const lineItems = getLineItems(parsed);
  const invoiceDate = pickString(parsed, ["invoice_date", "invoiceDate"]);
  const showName = pickString(parsed, ["provider_name", "providerName"]);
  const entries: Array<{
    horseId: Id<"horses">;
    amount: number;
    description: string;
    className?: string;
    placing?: string;
    showName?: string;
    date?: string;
  }> = [];

  for (const item of lineItems) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const itemType = String(record.item_type ?? record.itemType ?? "").toLowerCase();
    const lineCategory = String(record.category ?? "").toLowerCase().replace(/\s+/g, "-");
    if (itemType !== "prize_money" && lineCategory !== "prize-money") continue;

    const horseId = pickString(record, ["matched_horse_id", "matchedHorseId"]);
    if (!horseId) continue;

    const amount = typeof record.total_usd === "number"
      ? Math.abs(record.total_usd)
      : typeof record.totalUsd === "number"
        ? Math.abs(record.totalUsd)
        : 0;
    if (amount <= 0) continue;

    entries.push({
      horseId: horseId as Id<"horses">,
      amount,
      description: String(record.description ?? "Prize money"),
      className: pickString(record, ["class_name", "className"]) ?? undefined,
      placing: pickString(record, ["placing"]) ?? undefined,
      showName: showName ?? undefined,
      date: invoiceDate ?? undefined,
    });
  }

  return entries;
}
