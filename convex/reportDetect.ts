"use node";

import Anthropic from "@anthropic-ai/sdk";
import { v } from "convex/values";
import { action } from "./_generated/server";
import { HORSE_ALIASES } from "./horseAliases";

type ReportType = "bodywork" | "invoice" | "unknown";

export const detectReportFromPdf = action({
  args: { fileStorageId: v.id("_storage") },
  handler: async (ctx, args) => {
    const blob = await ctx.storage.get(args.fileStorageId);
    if (!blob) throw new Error("Attachment not found in storage");

    const anthropicApiKey = process.env.ANTHROPIC_API_KEY;
    if (!anthropicApiKey) throw new Error("ANTHROPIC_API_KEY is not set in Convex environment");

    const bytes = await blob.arrayBuffer();
    const base64Pdf = Buffer.from(bytes).toString("base64");
    const client = new Anthropic({ apiKey: anthropicApiKey });

    const textResponse = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1800,
      temperature: 0,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "document",
              source: { type: "base64", media_type: "application/pdf", data: base64Pdf }
            },
            {
              type: "text",
              text: "Extract visible text from this PDF as plain text only."
            }
          ]
        }
      ]
    });

    const textBlock = textResponse.content.find((item) => item.type === "text");
    const extractedText = textBlock && textBlock.type === "text" ? textBlock.text ?? "" : "";
    const reportType = detectReportType(extractedText);
    if (reportType !== "bodywork") {
      return { reportType, extractedTextLength: extractedText.length };
    }

    const parseResponse = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 2500,
      temperature: 0,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text:
                "You will receive text extracted from a horse bodywork/treatment report. " +
                "This report may contain treatment notes for MULTIPLE horses.\n\n" +
                "Return strict JSON with these keys:\n" +
                "- reportDate: string (YYYY-MM-DD)\n" +
                "- providerName: string\n" +
                "- horses: array of objects, each with { horseName: string, treatmentNotes: string, sessionNumber: number|null }\n\n" +
                "IMPORTANT rules for treatmentNotes:\n" +
                "- Write a clean, readable clinical summary for each horse individually.\n" +
                "- Remove ALL raw timestamps, page numbers (1/3, 2/3), file metadata, session IDs, disclaimers, and formatting artifacts.\n" +
                "- Remove duplicate text — the raw extraction often repeats the same notes multiple times. Only include each observation ONCE.\n" +
                "- Remove boilerplate labels like 'Muscular', 'Bone/joint', 'Reactive points' that appear as section headers without content.\n" +
                "- Keep clinical observations and treatment details in plain, readable sentences.\n" +
                "- Use natural language. Be concise but include all relevant clinical findings.\n" +
                "- Do NOT include the horse name or date within the notes text.\n\n" +
                "If only one horse is in the report, still return it as a single-element array.\n" +
                "If missing values, use null.\n\nTEXT:\n" +
                extractedText
            }
          ]
        }
      ]
    });

    const parseTextBlock = parseResponse.content.find((item) => item.type === "text");
    const rawJson = parseTextBlock && parseTextBlock.type === "text" ? parseTextBlock.text ?? "" : "";
    const parsed = parseJsonObject(rawJson) as {
      reportDate?: string | null;
      providerName?: string | null;
      horses?: Array<{
        horseName?: string | null;
        treatmentNotes?: string | null;
        sessionNumber?: number | string | null;
      }> | null;
      // Legacy single-horse fallback
      horseName?: string | null;
      treatmentNotes?: string | null;
      sessionNumber?: number | string | null;
    };

    const reportDate = normalizeDate(clean(parsed.reportDate)) ?? normalizeDateFromText(extractedText);
    const providerFromText = clean(parsed.providerName);
    const providerName = providerFromText && providerFromText.toLowerCase().includes("fred") ? "Fred Michelon" : providerFromText || "Fred Michelon";

    // Handle multi-horse response
    const rawHorses = Array.isArray(parsed.horses) && parsed.horses.length > 0
      ? parsed.horses
      : [{ horseName: parsed.horseName, treatmentNotes: parsed.treatmentNotes, sessionNumber: parsed.sessionNumber }];

    const horses = rawHorses.map((h) => {
      const extractedName = clean(h.horseName);
      const matchedName = matchHorseAlias(extractedName);
      return {
        extractedHorseName: extractedName,
        matchedHorseName: matchedName,
        treatmentNotes: cleanNotes(clean(h.treatmentNotes)),
        sessionNumber: parseSessionNumber(h.sessionNumber, extractedText),
      };
    }).filter((h) => h.extractedHorseName);

    // For backwards compatibility, also return top-level fields from first horse
    const firstHorse = horses[0];

    return {
      reportType,
      extractedHorseName: firstHorse?.extractedHorseName ?? "",
      matchedHorseName: firstHorse?.matchedHorseName ?? null,
      reportDate,
      providerName,
      treatmentNotes: firstHorse?.treatmentNotes ?? "",
      sessionNumber: firstHorse?.sessionNumber ?? null,
      horses,
      extractedTextLength: extractedText.length
    };
  }
});

function isBodyworkReport(text: string): boolean {
  const lower = text.toLowerCase();
  const signals = [
    "fred michelon",
    "bodywork",
    "muscular",
    "bone/joint",
    "reactive points",
    "don't replace veterinarian care",
    "mobilization",
    "releases on tissues",
  ];
  return signals.filter((s) => lower.includes(s)).length >= 3;
}

function detectReportType(text: string): ReportType {
  if (isBodyworkReport(text)) return "bodywork";
  const lower = text.toLowerCase();
  if (lower.includes("invoice") || lower.includes("receipt") || lower.includes("transaction id")) return "invoice";
  return "unknown";
}

function parseJsonObject(text: string): Record<string, unknown> {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return {};
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return {};
  }
}

function clean(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.trim();
}

function normalizeDate(value: string): string | null {
  if (!value) return null;
  const isoMatch = value.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (isoMatch) return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;

  const usMatch = value.match(/\b(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})\b/);
  if (!usMatch) return null;
  const month = Number(usMatch[1]);
  const day = Number(usMatch[2]);
  let year = Number(usMatch[3]);
  if (year < 100) year += 2000;
  if (!Number.isFinite(month) || !Number.isFinite(day) || !Number.isFinite(year)) return null;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return `${year.toString().padStart(4, "0")}-${month.toString().padStart(2, "0")}-${day.toString().padStart(2, "0")}`;
}

function normalizeDateFromText(text: string): string | null {
  return normalizeDate(text);
}

function matchHorseAlias(name: string): string | null {
  if (!name) return null;
  const normalized = normalizeHorseKey(name);
  const aliasExact = HORSE_ALIASES[normalized];
  if (aliasExact) return aliasExact;

  // Handle "Gabby 03-12-26" style leading token.
  const firstToken = normalizeHorseKey(name.split(/\s+/)[0] || "");
  const aliasFirst = HORSE_ALIASES[firstToken];
  if (aliasFirst) return aliasFirst;
  return null;
}

function normalizeHorseKey(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ");
}

function cleanNotes(value: string): string {
  if (!value) return "";
  const lines = value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => {
      const lower = line.toLowerCase();
      return !(
        lower.includes("don't replace veterinarian care") ||
        lower.includes("dont replace veterinarian care") ||
        lower.includes("do not replace veterinarian care")
      );
    });
  return lines.join("\n").trim();
}

function parseSessionNumber(value: unknown, text: string): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === "string") {
    const match = value.match(/\d+/);
    if (match) return Number(match[0]);
  }
  const textMatch = text.match(/\(#\s*(\d+)\)/i);
  if (textMatch) return Number(textMatch[1]);
  return null;
}
