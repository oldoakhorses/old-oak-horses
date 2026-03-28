"use node";

import Anthropic from "@anthropic-ai/sdk";
import { v } from "convex/values";
import { action } from "./_generated/server";
import { internal } from "./_generated/api";

type ProviderRow = {
  _id: string;
  categoryId: string;
  name: string;
  slug?: string;
  email?: string;
  phone?: string;
  website?: string;
  address?: string;
  categorySlug: string;
  subcategorySlug?: string;
};

type DetectProviderResult = {
  extractedName: string;
  extractedText?: string;
  matched: boolean;
  confidence: "exact" | "partial" | "none";
  providerName: string | null;
  providerId: string | null;
  category: string | null;
  subcategory: string | null;
  categoryId: string | null;
};

const PROVIDER_ALIAS_MAP: Record<string, string> = {
  farmvet: "FarmVet",
  "farm vet": "FarmVet",
  "farmvet order": "FarmVet",
  "stateside horse transportation": "Stateside Horse Transportation",
  "stateside farms": "Stateside Horse Transportation",
  stateside: "Stateside Horse Transportation",
  statesidefarms: "Stateside Horse Transportation",
  "brook ledge": "Brook Ledge",
  brookledge: "Brook Ledge",
  "brook ledge inc": "Brook Ledge",
  "eq sports medicine group": "EQ Sports Medicine Group",
  "eq sports": "EQ Sports Medicine Group",
  eqsportsmedicinegroup: "EQ Sports Medicine Group",
  "sports medicine group": "EQ Sports Medicine Group",
  "idexx neo": "EQ Sports Medicine Group",
};

export const detectProvider: any = action({
  args: { fileStorageId: v.id("_storage") },
  handler: async (ctx, args): Promise<DetectProviderResult> => {
    const blob = await ctx.storage.get(args.fileStorageId);
    if (!blob) throw new Error("Uploaded file not found in storage");

    const anthropicApiKey = process.env.ANTHROPIC_API_KEY;
    if (!anthropicApiKey) throw new Error("ANTHROPIC_API_KEY is not set in Convex environment");

    const bytes = await blob.arrayBuffer();
    const base64Pdf = Buffer.from(bytes).toString("base64");

    const client = new Anthropic({ apiKey: anthropicApiKey });
    const response = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 240,
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
                data: base64Pdf,
              },
            },
            {
              type: "text",
              text: "Extract ONLY the provider/business/company name from this invoice. Return just the name as plain text, nothing else. If unknown, return UNKNOWN.",
            },
          ],
        },
      ],
    });

    const textBlock = response.content.find((item) => item.type === "text");
    const extractedName = textBlock && textBlock.type === "text" && textBlock.text.trim().length > 0 ? textBlock.text.trim() : "UNKNOWN";

    const textResponse = await client.messages.create({
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
                data: base64Pdf,
              },
            },
            {
              type: "text",
              text: "Extract visible text from the first page of this invoice. Return plain text only.",
            },
          ],
        },
      ],
    });
    const extractedPdfTextBlock = textResponse.content.find((item) => item.type === "text");
    const extractedPdfText =
      extractedPdfTextBlock && extractedPdfTextBlock.type === "text" && extractedPdfTextBlock.text.trim().length > 0
        ? extractedPdfTextBlock.text
        : "";
    console.log("3. Extracted text length:", extractedPdfText.length);
    console.log("4. Extracted text preview:", extractedPdfText.substring(0, 500));

    const [providers, aliases, vendorContacts] = await Promise.all([
      ctx.runQuery(internal.providers.listAllForMatching, {}) as Promise<ProviderRow[]>,
      ctx.runQuery(internal.providerAliases.listAllAliasesInternal, {}) as Promise<Array<{
        alias: string;
        providerName: string;
        providerId: string;
      }>>,
      ctx.runQuery(internal.contacts.listVendorsForMatching, {}) as Promise<Array<{
        _id: string;
        name: string;
        slug?: string;
        email?: string;
        phone?: string;
        website?: string;
        address?: string;
        category: string;
        providerId?: string;
      }>>
    ]);
    // Also try matching against vendor contacts
    const contactAsProviders: ProviderRow[] = vendorContacts
      .filter((c) => !providers.some((p) => String(p._id) === String(c.providerId)))
      .map((c) => ({
        _id: c._id,
        categoryId: "",
        name: c.name,
        slug: c.slug,
        email: c.email,
        phone: c.phone,
        website: c.website,
        address: c.address,
        categorySlug: c.category,
      }));
    const allCandidates = [...providers, ...contactAsProviders];
    const matched = matchProviderFromText(extractedName, extractedPdfText, allCandidates, aliases);
    console.log("5. Provider match result:", matched ?? { matched: false });
    if (!matched) {
      return {
        extractedName,
        extractedText: extractedPdfText,
        matched: false,
        confidence: "none",
        providerName: null,
        providerId: null,
        category: null,
        subcategory: null,
        categoryId: null,
      };
    }

    return {
      extractedName,
      extractedText: extractedPdfText,
      matched: true,
      confidence: matched.confidence,
      providerName: matched.provider.name,
      providerId: matched.provider._id,
      category: matched.provider.categorySlug ?? null,
      subcategory: matched.provider.subcategorySlug ?? null,
      categoryId: matched.provider.categoryId,
    };
  },
});

function matchProviderFromText(
  extractedProviderName: string,
  pdfText: string,
  providers: ProviderRow[],
  aliases: Array<{ alias: string; providerName: string; providerId: string }>
) {
  const name = normalize(extractedProviderName);
  const textLower = normalize(pdfText);
  const textCompact = textLower.replace(/\s+/g, "");
  if (!name && !textLower) return null;

  const aliasTarget = PROVIDER_ALIAS_MAP[name];
  if (aliasTarget) {
    const aliasMatch = providers.find((provider) => normalize(provider.name) === normalize(aliasTarget));
    if (aliasMatch) return { provider: aliasMatch, confidence: "partial" as const };
  }

  const aliasProviderMatch = aliases.find((row) => {
    const alias = normalize(row.alias);
    return (name && (name.includes(alias) || alias.includes(name))) || (textLower && textLower.includes(alias));
  });
  if (aliasProviderMatch) {
    const aliasProvider = providers.find((provider) => provider._id === aliasProviderMatch.providerId);
    if (aliasProvider) return { provider: aliasProvider, confidence: "partial" as const };
  }

  const exact = providers.find((provider) => name && normalize(provider.name) === name);
  if (exact) return { provider: exact, confidence: "exact" as const };

  const partial = providers.find((provider) => {
    const providerName = normalize(provider.name);
    if (name && (name.includes(providerName) || providerName.includes(name))) return true;
    if (textLower && providerName && textLower.includes(providerName)) return true;
    if (provider.slug && textLower.includes(normalize(provider.slug))) return true;
    if (provider.email && textLower.includes(normalize(provider.email))) return true;
    if (provider.website) {
      const websiteKey = normalizeWebsite(provider.website);
      if (websiteKey && (textLower.includes(websiteKey) || textCompact.includes(websiteKey))) return true;
    }
    if (provider.address && textLower.includes(normalize(provider.address))) return true;
    if (provider.phone) {
      const providerDigits = provider.phone.replace(/\D/g, "");
      const textDigits = pdfText.replace(/\D/g, "");
      if (providerDigits.length >= 10 && textDigits.includes(providerDigits.slice(-10))) return true;
    }
    return false;
  });
  if (partial) return { provider: partial, confidence: "partial" as const };

  return null;
}

function normalize(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s.&-]/g, "")
    .replace(/\s+/g, " ");
}

function normalizeWebsite(value: string) {
  return normalize(value)
    .replace(/^https?\s*/, "")
    .replace(/^www\s*/, "")
    .replace(/\s+/g, "");
}
