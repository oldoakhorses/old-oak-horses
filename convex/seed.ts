import { mutation } from "./_generated/server";

const CATEGORY_SEED = [
  { name: "Veterinary", slug: "veterinary" },
  { name: "Feed & Bedding", slug: "feed-bedding" },
  { name: "Stabling", slug: "stabling" },
  { name: "Farrier", slug: "farrier" },
  { name: "Therapeutic Care", slug: "therapeutic-care" },
  { name: "Travel", slug: "travel" },
  { name: "Salaries", slug: "salaries" },
  { name: "Housing", slug: "housing" },
  { name: "Riding & Training", slug: "riding-training" },
  { name: "Commissions", slug: "commissions" },
  { name: "Horse Purchases", slug: "horse-purchases" },
  { name: "Supplies", slug: "supplies" },
  { name: "Marketing", slug: "marketing" },
  { name: "Dues & Registrations", slug: "dues-registrations" },
  { name: "Admin", slug: "admin" },
  { name: "Horse Transport", slug: "horse-transport" },
  { name: "Show Expenses", slug: "show-expenses" }
] as const;

const BUTHE_EXTRACTION_PROMPT = `You are parsing a veterinary invoice from Dr André Buthe Equine Clinic Ltd. These invoices are in GBP — you must convert all monetary values to USD using the current GBP/USD exchange rate (fetch it at time of parsing).

IMPORTANT: The PDF has two pages. Page 1 is a remittance/summary page — ignore it entirely. Extract data only from page 2 onwards.

PAGE 2 STRUCTURE:
The invoice contains a line items table with these columns: Date | Vet | Description | Services | Drugs | Laboratory | Fees | VAT | Fees Inc. VAT

HORSE NAME DETECTION:
Within the Description column, the horse's name appears as a standalone bold line with no date next to it and no amounts. It acts as a grouping header for the line items that follow it. Capture this as the \`horse_name\` tag for all subsequent line items until a new horse name appears. Horse names may contain spaces, accented characters, and multiple words (e.g. "Lingo Van De Watermoelen"). Capture the full name exactly as it appears, including all words.

EXTRACTION — capture the following for each line item:
- date: the date in the Date column (format YYYY-MM-DD). Some line items directly below the horse name row may not repeat the date — in that case, use the date from the most recent line item that had one.
- vet_initials: the code in the Vet column (e.g. "CO")
- description: the text in the Description column
- fee_type: classify the charge based on which column has the value — "service" (Services column), "drug" (Drugs column), "laboratory" (Laboratory column). If a row spans multiple columns, create a separate entry per column that has a value.
- amount_gbp: the value in the Fees column (pre-VAT) as a number
- vat_gbp: the value in the VAT column as a number
- total_gbp: the value in the Fees Inc. VAT column as a number
- amount_usd: amount_gbp converted to USD
- vat_usd: vat_gbp converted to USD
- total_usd: total_gbp converted to USD
- horse_name: the horse this line item belongs to (from bold header detection above)

VET SUBCATEGORY CLASSIFICATION:
First extract all line items raw. Then in a second pass, classify each line item's vet_subcategory using the rules below in strict priority order — apply the first rule that matches and stop:

  1.  "Travel Cost"     — description contains "visit" OR description is exactly
                          "Travel Cost" (case-insensitive)
  2.  "Physical Exam"   — description contains "orthopaedic exam" (case-insensitive)
  3.  "Radiograph"      — description contains "radiograph", "radiographs",
                          or "radiographic" (case-insensitive)
  4.  "Sedation"        — description contains "sedate" or "sedation" (case-insensitive)
  5.  "Joint Injection" — description contains "alpha 2eq" (case-insensitive)
  6.  "Joint Injection" — description contains "inject", "injection", or "inj"
                          (case-insensitive)
  7.  "Joint Injection" — description contains "medicate" (case-insensitive)
  8.  "Joint Injection" — description contains "blood collection & processing" AND
                          at least one other line item on this invoice contains
                          "alpha 2eq" — only apply after all line items are extracted
  9.  "Ultrasound"      — description contains "ultrasound" (case-insensitive)
  10. "MRI"             — description contains "mri" (case-insensitive)
  11. "Labs"            — description contains "saa", "lab", "laboratory",
                          "haematology", "biochemistry", or "culture" (case-insensitive)
  12. "Vaccine"         — description contains "booster", "vial", "vaccine",
                          "flu", "tetanus", "ehv", or "gastrogard" (case-insensitive)
  13. "Medication"      — fee_type is "drug" and no rule above matched
                          (default fallback for any drug column line item)
  14. "Other"           — nothing matched above

INVOICE-LEVEL FIELDS — also extract:
- invoice_number: from "Invoice Nº" field
- invoice_date: the Date shown at the top of the invoice (format YYYY-MM-DD)
- account_number: the Account field
- client_name: the name shown on the invoice
- total_fees_gbp / total_fees_usd
- total_vat_gbp / total_vat_usd
- invoice_total_gbp / invoice_total_usd
- exchange_rate_used: the GBP/USD rate you applied

Return the result as a single JSON object in this shape:
{
  "invoice_number": "...",
  "invoice_date": "...",
  "account_number": "...",
  "client_name": "...",
  "exchange_rate_used": 1.27,
  "total_fees_gbp": 266.89,
  "total_fees_usd": 339.15,
  "total_vat_gbp": 53.38,
  "total_vat_usd": 67.79,
  "invoice_total_gbp": 320.27,
  "invoice_total_usd": 406.74,
  "line_items": [
    {
      "date": "2025-01-26",
      "vet_initials": "CO",
      "description": "Visit (Zone 4)",
      "fee_type": "service",
      "horse_name": "Gigi",
      "vet_subcategory": "Travel Cost",
      "amount_gbp": 71.05,
      "vat_gbp": 14.21,
      "total_gbp": 85.26,
      "amount_usd": 90.23,
      "vat_usd": 18.05,
      "total_usd": 108.27
    }
  ]
}`;

export const seedCategories = mutation(async (ctx) => {
  let createdCategories = 0;
  for (const category of CATEGORY_SEED) {
    const existingCategory = await ctx.db
      .query("categories")
      .withIndex("by_slug", (q) => q.eq("slug", category.slug))
      .first();
    if (!existingCategory) {
      await ctx.db.insert("categories", category);
      createdCategories += 1;
    }
  }

  const vetCategory = await ctx.db
    .query("categories")
    .filter((q) => q.eq(q.field("slug"), "veterinary"))
    .first();
  if (!vetCategory) {
    throw new Error("Veterinary category not found after category seed");
  }

  const vetProviders = [
    {
      name: "Buthe",
      extractionPrompt: BUTHE_EXTRACTION_PROMPT,
      expectedFields: [
        "invoice_number",
        "invoice_date",
        "client_name",
        "horse_name",
        "line_items",
        "invoice_total_usd",
        "exchange_rate_used"
      ]
    },
    {
      name: "Conejo Valley",
      extractionPrompt: "PLACEHOLDER — to be updated",
      expectedFields: ["date", "horse_name", "services", "total_due"]
    },
    {
      name: "EqSports",
      extractionPrompt: "PLACEHOLDER — to be updated",
      expectedFields: ["date", "horse_name", "services", "total_due"]
    },
    {
      name: "Someren",
      extractionPrompt: "PLACEHOLDER — to be updated",
      expectedFields: ["date", "horse_name", "services", "total_due"]
    },
    {
      name: "Steele",
      extractionPrompt: "PLACEHOLDER — to be updated",
      expectedFields: ["date", "horse_name", "services", "total_due"]
    },
    {
      name: "Venlo",
      extractionPrompt: "PLACEHOLDER — to be updated",
      expectedFields: ["date", "horse_name", "services", "total_due"]
    }
  ];

  let createdProviders = 0;
  let updatedProviders = 0;
  for (const provider of vetProviders) {
    const existingProvider = await ctx.db
      .query("providers")
      .withIndex("by_category_name", (q) => q.eq("categoryId", vetCategory._id).eq("name", provider.name))
      .first();

    if (!existingProvider) {
      await ctx.db.insert("providers", {
        categoryId: vetCategory._id,
        name: provider.name,
        slug: slugify(provider.name),
        extractionPrompt: provider.extractionPrompt,
        expectedFields: provider.expectedFields,
        createdAt: Date.now()
      });
      createdProviders += 1;
      continue;
    }

    await ctx.db.patch(existingProvider._id, {
      slug: existingProvider.slug ?? slugify(provider.name),
      extractionPrompt: provider.extractionPrompt,
      expectedFields: provider.expectedFields,
      updatedAt: Date.now()
    });
    updatedProviders += 1;
  }

  const travelCategory = await ctx.db
    .query("categories")
    .withIndex("by_slug", (q) => q.eq("slug", "travel"))
    .first();
  if (!travelCategory) {
    throw new Error("Travel category not found after category seed");
  }

  const travelProviders = ["Flights", "Trains", "Rental Car", "Gas", "Meals", "Hotels"] as const;
  for (const name of travelProviders) {
    const existingProvider = await ctx.db
      .query("providers")
      .withIndex("by_category_name", (q) => q.eq("categoryId", travelCategory._id).eq("name", name))
      .first();
    if (!existingProvider) {
      await ctx.db.insert("providers", {
        categoryId: travelCategory._id,
        name,
        slug: slugify(name),
        extractionPrompt:
          "Extract a travel invoice as strict JSON with original_currency, original_total, exchange_rate, total_usd, invoice_number, invoice_date, provider_name, and line_items[].",
        expectedFields: ["invoice_number", "invoice_date", "provider_name", "original_currency", "original_total", "total_usd", "line_items"],
        createdAt: Date.now()
      });
      createdProviders += 1;
      continue;
    }
    if (!existingProvider.slug) {
      await ctx.db.patch(existingProvider._id, { slug: slugify(name), updatedAt: Date.now() });
      updatedProviders += 1;
    }
  }

  return { createdCategories, createdProviders, updatedProviders, skipped: false };
});

export const seedDashboardData = mutation(async (ctx) => {
  const horses = [
    { name: "Ben", yearOfBirth: 2015 },
    { name: "Gigi", yearOfBirth: 2017 },
    { name: "Lingo Van De Watermoelen", yearOfBirth: 2014 }
  ] as const;

  const contacts: Array<{ name: string; category: string; company?: string }> = [
    {
      name: "Dr. André Buthe",
      category: "Veterinary",
      company: "Buthe Equine Clinic"
    },
    {
      name: "Conejo Valley Equine",
      category: "Veterinary"
    },
    {
      name: "Mike Smith",
      category: "Farrier"
    }
  ] as const;

  let createdHorses = 0;
  let createdContacts = 0;

  for (const horse of horses) {
    const existing = await ctx.db
      .query("horses")
      .withIndex("by_name", (q) => q.eq("name", horse.name))
      .first();

    if (!existing) {
      await ctx.db.insert("horses", {
        name: horse.name,
        yearOfBirth: horse.yearOfBirth,
        status: "active",
        createdAt: Date.now()
      });
      createdHorses += 1;
    }
  }

  for (const contact of contacts) {
    const existing = await ctx.db
      .query("contacts")
      .withIndex("by_name", (q) => q.eq("name", contact.name))
      .first();

    if (!existing) {
      await ctx.db.insert("contacts", {
        name: contact.name,
        category: contact.category,
        company: contact.company,
        createdAt: Date.now()
      });
      createdContacts += 1;
    }
  }

  return { createdHorses, createdContacts };
});

export const seedPeople = mutation(async (ctx) => {
  const seedRows: Array<{ name: string; role: "rider" | "groom" | "freelance" | "trainer" }> = [
    { name: "Lucy Davis Kennedy", role: "rider" },
    { name: "Charlotte Oakes", role: "groom" },
    { name: "Leah Knowles", role: "groom" },
    { name: "Sigrun Land", role: "freelance" },
    { name: "Johanna Mattila", role: "freelance" }
  ];

  let created = 0;
  for (const row of seedRows) {
    const existing = await ctx.db.query("people").filter((q) => q.eq(q.field("name"), row.name)).first();
    if (existing) continue;
    await ctx.db.insert("people", {
      name: row.name,
      role: row.role,
      isActive: true,
      createdAt: Date.now()
    });
    created += 1;
  }

  return { created };
});

function slugify(value: string) {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-");
}
