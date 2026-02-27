import { mutation } from "./_generated/server";

const CATEGORY_SEED = [
  { name: "Veterinary", slug: "veterinary" },
  { name: "Feed & Bedding", slug: "feed-bedding" },
  { name: "Stabling", slug: "stabling" },
  { name: "Farrier", slug: "farrier" },
  { name: "Bodywork", slug: "bodywork" },
  { name: "Therapeutic Care", slug: "therapeutic-care" },
  { name: "Travel", slug: "travel" },
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

  const housingCategory = await ctx.db
    .query("categories")
    .withIndex("by_slug", (q) => q.eq("slug", "housing"))
    .first();
  if (!housingCategory) {
    throw new Error("Housing category not found after category seed");
  }

  const housingProviders = ["Rider Housing", "Groom Housing"] as const;
  for (const name of housingProviders) {
    const existingProvider = await ctx.db
      .query("providers")
      .withIndex("by_category_name", (q) => q.eq("categoryId", housingCategory._id).eq("name", name))
      .first();
    if (!existingProvider) {
      await ctx.db.insert("providers", {
        categoryId: housingCategory._id,
        name,
        slug: slugify(name),
        extractionPrompt:
          "Extract a housing invoice as strict JSON with original_currency, original_total, exchange_rate, total_usd, invoice_number, invoice_date, provider_name, and line_items[].",
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

  const stablingCategory = await ctx.db
    .query("categories")
    .withIndex("by_slug", (q) => q.eq("slug", "stabling"))
    .first();
  if (!stablingCategory) {
    throw new Error("Stabling category not found after category seed");
  }

  const stablingProviders = [
    { name: "Travers Horse Facility", slug: "travers-horse-facility" },
    { name: "El Campeon Farms", slug: "el-campeon-farms" },
    { name: "Vanessa Mannix Stables", slug: "vanessa-mannix-stables" },
    { name: "Malnik Family Farms", slug: "malnik-family-farms" }
  ] as const;

  for (const provider of stablingProviders) {
    const existingProvider = await ctx.db
      .query("providers")
      .withIndex("by_category_name", (q) => q.eq("categoryId", stablingCategory._id).eq("name", provider.name))
      .first();
    if (!existingProvider) {
      await ctx.db.insert("providers", {
        categoryId: stablingCategory._id,
        name: provider.name,
        slug: provider.slug,
        extractionPrompt:
          "Extract a stabling invoice as strict JSON with invoice_number, invoice_date, provider_name, account_number, original_currency, original_total, exchange_rate, invoice_total_usd and line_items[] containing description, total_usd, horse_name (if present), and stabling_subcategory.",
        expectedFields: ["invoice_number", "invoice_date", "provider_name", "invoice_total_usd", "line_items"],
        createdAt: Date.now()
      });
      createdProviders += 1;
      continue;
    }
    if (!existingProvider.slug) {
      await ctx.db.patch(existingProvider._id, { slug: provider.slug, updatedAt: Date.now() });
      updatedProviders += 1;
    }
  }

  const horseTransportCategory = await ctx.db
    .query("categories")
    .withIndex("by_slug", (q) => q.eq("slug", "horse-transport"))
    .first();
  if (!horseTransportCategory) {
    throw new Error("Horse Transport category not found after category seed");
  }

  const horseTransportProviders = [
    { name: "Brook Ledge", slug: "brook-ledge", subcategorySlug: "ground-transport" },
    { name: "Johnson", slug: "johnson", subcategorySlug: "ground-transport" },
    { name: "Stateside", slug: "stateside", subcategorySlug: "ground-transport" },
    { name: "Somnium Farm", slug: "somnium", subcategorySlug: "ground-transport" },
    { name: "Gelissen", slug: "gelissen", subcategorySlug: "ground-transport" },
    { name: "Dutta Corp", slug: "dutta-corp", subcategorySlug: "air-transport" },
    { name: "Apollo Equine Transport", slug: "apollo-equine-transport", subcategorySlug: "air-transport" },
    { name: "Guido Klatte", slug: "guido-klatte", subcategorySlug: "air-transport" }
  ] as const;

  for (const provider of horseTransportProviders) {
    const existingProvider = await ctx.db
      .query("providers")
      .withIndex("by_category_name", (q) => q.eq("categoryId", horseTransportCategory._id).eq("name", provider.name))
      .first();
    if (!existingProvider) {
      await ctx.db.insert("providers", {
        categoryId: horseTransportCategory._id,
        subcategorySlug: provider.subcategorySlug,
        name: provider.name,
        slug: provider.slug,
        extractionPrompt:
          "Extract from this horse transport invoice: invoice_number, invoice_date, due_date, provider_name, original_currency, original_total, exchange_rate, invoice_total_usd, origin, destination, and line_items[] with description, horse_name (or null), quantity, unit_price, total_usd.",
        expectedFields: ["invoice_number", "invoice_date", "provider_name", "invoice_total_usd", "line_items"],
        createdAt: Date.now()
      });
      createdProviders += 1;
      continue;
    }
    if (!existingProvider.slug || !existingProvider.subcategorySlug) {
      await ctx.db.patch(existingProvider._id, {
        slug: existingProvider.slug ?? provider.slug,
        subcategorySlug: existingProvider.subcategorySlug ?? provider.subcategorySlug,
        updatedAt: Date.now()
      });
      updatedProviders += 1;
    }
  }

  const legacySominium = await ctx.db
    .query("providers")
    .withIndex("by_category_name", (q) => q.eq("categoryId", horseTransportCategory._id).eq("name", "Sominium"))
    .first();
  if (legacySominium) {
    await ctx.db.patch(legacySominium._id, {
      name: "Somnium Farm",
      slug: "somnium",
      updatedAt: Date.now()
    });
    updatedProviders += 1;
  }

  const farrierCategory = await ctx.db
    .query("categories")
    .withIndex("by_slug", (q) => q.eq("slug", "farrier"))
    .first();
  if (!farrierCategory) {
    throw new Error("Farrier category not found after category seed");
  }

  const farrierProviders = [
    { name: "Steve Lorenzo", slug: "steve-lorenzo" },
    { name: "Tyler Tablert", slug: "tyler-tablert" },
    { name: "Paul Bocken", slug: "paul-bocken" }
  ] as const;

  for (const provider of farrierProviders) {
    const existingProvider = await ctx.db
      .query("providers")
      .withIndex("by_category_name", (q) => q.eq("categoryId", farrierCategory._id).eq("name", provider.name))
      .first();
    if (!existingProvider) {
      await ctx.db.insert("providers", {
        categoryId: farrierCategory._id,
        name: provider.name,
        slug: provider.slug,
        extractionPrompt:
          "Extract a farrier invoice as strict JSON with invoice_number, invoice_date, provider_name, original_currency, original_total, exchange_rate, invoice_total_usd, and line_items[].",
        expectedFields: ["invoice_number", "invoice_date", "provider_name", "invoice_total_usd", "line_items"],
        createdAt: Date.now()
      });
      createdProviders += 1;
      continue;
    }
    if (!existingProvider.slug) {
      await ctx.db.patch(existingProvider._id, { slug: provider.slug, updatedAt: Date.now() });
      updatedProviders += 1;
    }
  }

  const feedBeddingCategory = await ctx.db
    .query("categories")
    .withIndex("by_slug", (q) => q.eq("slug", "feed-bedding"))
    .first();
  if (!feedBeddingCategory) {
    throw new Error("Feed & Bedding category not found after category seed");
  }

  const feedBeddingProviders = [
    { name: "Pradera", slug: "pradera" },
    { name: "El Campeon", slug: "el-campeon" },
    { name: "DaMoors", slug: "damoors" },
    { name: "Travers", slug: "travers" },
    { name: "Red Mills", slug: "red-mills" },
    { name: "Watermolen", slug: "watermolen" }
  ] as const;

  for (const provider of feedBeddingProviders) {
    const existingProvider = await ctx.db
      .query("providers")
      .withIndex("by_category_name", (q) => q.eq("categoryId", feedBeddingCategory._id).eq("name", provider.name))
      .first();
    if (!existingProvider) {
      await ctx.db.insert("providers", {
        categoryId: feedBeddingCategory._id,
        name: provider.name,
        slug: provider.slug,
        extractionPrompt:
          "Extract from this feed and bedding invoice: invoice_number, invoice_date, due_date, provider_name, original_currency, original_total, exchange_rate, invoice_total_usd, and line_items[] with description, quantity, unit_price, total_usd, and subcategory where subcategory is feed, bedding, or null for fees/tax.",
        expectedFields: ["invoice_number", "invoice_date", "provider_name", "invoice_total_usd", "line_items"],
        createdAt: Date.now()
      });
      createdProviders += 1;
      continue;
    }
    if (!existingProvider.slug) {
      await ctx.db.patch(existingProvider._id, { slug: provider.slug, updatedAt: Date.now() });
      updatedProviders += 1;
    }
  }

  const bodyworkCategory = await ctx.db
    .query("categories")
    .withIndex("by_slug", (q) => q.eq("slug", "bodywork"))
    .first();
  if (!bodyworkCategory) {
    throw new Error("Bodywork category not found after category seed");
  }

  const bodyworkProviders = [
    { name: "Steve Engle", slug: "steve-engle" },
    { name: "Fred Michelon", slug: "fred-michelon" },
    { name: "Janice", slug: "janice" },
    { name: "Inga Pavling", slug: "inga-pavling" }
  ] as const;

  const legacyFred = await ctx.db
    .query("providers")
    .withIndex("by_category_name", (q) => q.eq("categoryId", bodyworkCategory._id).eq("name", "Fred Michaelson"))
    .first();
  if (legacyFred) {
    await ctx.db.patch(legacyFred._id, {
      name: "Fred Michelon",
      slug: "fred-michelon",
      updatedAt: Date.now()
    });
    updatedProviders += 1;
  }

  for (const provider of bodyworkProviders) {
    const existingProvider = await ctx.db
      .query("providers")
      .withIndex("by_category_name", (q) => q.eq("categoryId", bodyworkCategory._id).eq("name", provider.name))
      .first();
    if (!existingProvider) {
      await ctx.db.insert("providers", {
        categoryId: bodyworkCategory._id,
        name: provider.name,
        slug: provider.slug,
        extractionPrompt:
          "Extract from this bodywork/chiropractic/massage invoice: invoice_number, invoice_date, due_date, provider_name, original_currency, original_total, exchange_rate, invoice_total_usd, and line_items[] with description, horse_name (if identifiable), quantity, unit_price, total_usd.",
        expectedFields: ["invoice_number", "invoice_date", "provider_name", "invoice_total_usd", "line_items"],
        createdAt: Date.now()
      });
      createdProviders += 1;
      continue;
    }
    if (!existingProvider.slug) {
      await ctx.db.patch(existingProvider._id, { slug: provider.slug, updatedAt: Date.now() });
      updatedProviders += 1;
    }
  }

  const adminCategory = await ctx.db
    .query("categories")
    .withIndex("by_slug", (q) => q.eq("slug", "admin"))
    .first();
  if (!adminCategory) {
    throw new Error("Admin category not found after category seed");
  }

  const adminProviders: Array<{ name: string; slug: string; subcategorySlug: string }> = [
    { name: "General", slug: "general", subcategorySlug: "legal" },
    { name: "Zeidan & Associates", slug: "zeidan-associates", subcategorySlug: "visas" },
    { name: "Karel Thijssens", slug: "karel-thijssens", subcategorySlug: "visas" },
    { name: "Fishmann", slug: "fishmann", subcategorySlug: "accounting" },
    { name: "Hoeymakers", slug: "hoeymakers", subcategorySlug: "contractors" },
    { name: "Freelance Grooming", slug: "freelance-grooming", subcategorySlug: "contractors" },
    { name: "Freelance Riding", slug: "freelance-riding", subcategorySlug: "contractors" },
    { name: "Media/Marketing", slug: "media-marketing", subcategorySlug: "contractors" }
  ];

  for (const provider of adminProviders) {
    const existingProvider = await ctx.db
      .query("providers")
      .withIndex("by_category_name", (q) => q.eq("categoryId", adminCategory._id).eq("name", provider.name))
      .first();
    if (!existingProvider) {
      await ctx.db.insert("providers", {
        categoryId: adminCategory._id,
        subcategorySlug: provider.subcategorySlug,
        name: provider.name,
        slug: provider.slug,
        extractionPrompt:
          "Extract all data from this admin/business operations invoice as strict JSON with provider_name, invoice_number, invoice_date, due_date, subtotal, tax_total_usd, invoice_total_usd, original_currency, admin_subcategory, and line_items[] with description, quantity, unit_price, total_usd, person_name.",
        expectedFields: ["invoice_number", "invoice_date", "provider_name", "invoice_total_usd", "line_items"],
        createdAt: Date.now()
      });
      createdProviders += 1;
      continue;
    }
    const patch: Record<string, unknown> = {};
    if (!existingProvider.slug) patch.slug = provider.slug;
    if (!existingProvider.subcategorySlug) patch.subcategorySlug = provider.subcategorySlug;
    if (Object.keys(patch).length > 0) {
      patch.updatedAt = Date.now();
      await ctx.db.patch(existingProvider._id, patch);
      updatedProviders += 1;
    }
  }

  const duesCategory = await ctx.db
    .query("categories")
    .withIndex("by_slug", (q) => q.eq("slug", "dues-registrations"))
    .first();
  if (!duesCategory) {
    throw new Error("Dues & Registrations category not found after category seed");
  }

  const duesProviders: Array<{ name: string; slug: string; subcategorySlug: string }> = [
    { name: "USEF", slug: "usef", subcategorySlug: "horse-registrations" },
    { name: "USHJA", slug: "ushja", subcategorySlug: "horse-registrations" },
    { name: "USEF", slug: "usef", subcategorySlug: "rider-registrations" },
    { name: "USHJA", slug: "ushja", subcategorySlug: "rider-registrations" },
    { name: "USEF", slug: "usef", subcategorySlug: "memberships" },
    { name: "USHJA", slug: "ushja", subcategorySlug: "memberships" }
  ];

  for (const provider of duesProviders) {
    const existingProvider = await ctx.db
      .query("providers")
      .withIndex("by_category_subcategory_name", (q) =>
        q.eq("categoryId", duesCategory._id).eq("subcategorySlug", provider.subcategorySlug).eq("name", provider.name)
      )
      .first();
    if (!existingProvider) {
      await ctx.db.insert("providers", {
        categoryId: duesCategory._id,
        subcategorySlug: provider.subcategorySlug,
        name: provider.name,
        slug: provider.slug,
        extractionPrompt:
          "Extract dues/registration invoice JSON: provider_name, invoice_number, invoice_date, due_date, invoice_total_usd, original_currency, dues_subcategory, line_items[] with description,total_usd,entity_name,entity_type.",
        expectedFields: ["invoice_number", "invoice_date", "provider_name", "invoice_total_usd", "line_items"],
        createdAt: Date.now()
      });
      createdProviders += 1;
      continue;
    }
    const patch: Record<string, unknown> = {};
    if (!existingProvider.slug) patch.slug = provider.slug;
    if (!existingProvider.subcategorySlug) patch.subcategorySlug = provider.subcategorySlug;
    if (Object.keys(patch).length > 0) {
      patch.updatedAt = Date.now();
      await ctx.db.patch(existingProvider._id, patch);
      updatedProviders += 1;
    }
  }

  // Migrate legacy Salaries bills/providers to Admin -> Payroll.
  const salariesCategory = await ctx.db
    .query("categories")
    .withIndex("by_slug", (q) => q.eq("slug", "salaries"))
    .first();
  if (salariesCategory) {
    const salaryProviders = await ctx.db
      .query("providers")
      .withIndex("by_category", (q) => q.eq("categoryId", salariesCategory._id))
      .collect();
    for (const provider of salaryProviders) {
      await ctx.db.patch(provider._id, {
        categoryId: adminCategory._id,
        subcategorySlug: provider.subcategorySlug ?? "payroll",
        updatedAt: Date.now()
      });
      updatedProviders += 1;
    }

    const salaryBills = await ctx.db
      .query("bills")
      .withIndex("by_category", (q) => q.eq("categoryId", salariesCategory._id))
      .collect();
    for (const bill of salaryBills) {
      await ctx.db.patch(bill._id, {
        categoryId: adminCategory._id,
        adminSubcategory: (bill as any).salariesSubcategory ?? "payroll",
        salariesSubcategory: undefined
      });
    }

    await ctx.db.delete(salariesCategory._id);
  }

  const suppliesCategory = await ctx.db
    .query("categories")
    .withIndex("by_slug", (q) => q.eq("slug", "supplies"))
    .first();
  if (!suppliesCategory) {
    throw new Error("Supplies category not found after category seed");
  }

  const suppliesProviders: Array<{
    name: string;
    slug: string;
    email?: string;
    address?: string;
    phone?: string;
    website?: string;
  }> = [
    {
      name: "FarmVet",
      slug: "farmvet",
      email: "sales@farmvet.com",
      address: "1254 Old Hillsboro Rd, Franklin, TN 37069",
      phone: "888.837.3626",
      website: "https://www.farmvet.com/"
    },
    {
      name: "Horseplay",
      slug: "horseplay",
      email: "hello@horseplaybend.com"
    },
    {
      name: "VDM Mobile Tack",
      slug: "vdm-mobile-tack",
      email: "sarah@mobiletack.com"
    }
  ];

  for (const provider of suppliesProviders) {
    const existingProvider = await ctx.db
      .query("providers")
      .withIndex("by_category_name", (q) => q.eq("categoryId", suppliesCategory._id).eq("name", provider.name))
      .first();
    if (!existingProvider) {
      await ctx.db.insert("providers", {
        categoryId: suppliesCategory._id,
        name: provider.name,
        slug: provider.slug,
        email: provider.email,
        address: provider.address,
        phone: provider.phone,
        website: provider.website,
        extractionPrompt:
          "Extract all data from this supplies/equipment invoice or receipt as strict JSON. Include provider_name, invoice_number (order or receipt number is valid), invoice_date, due_date (null for receipts), subtotal, tax_total_usd, invoice_total_usd, original_currency, and line_items[] with description, quantity, unit_price, total_usd. For email receipts (including Horseplay): parse headers like 'Receipt for order #', use ORDER # as invoice_number, parse date from email header, and treat variant lines like 'BLACK / HORSE' as details appended to the item description in parentheses rather than separate line items.",
        expectedFields: ["invoice_number", "invoice_date", "provider_name", "invoice_total_usd", "line_items"],
        createdAt: Date.now()
      });
      createdProviders += 1;
      continue;
    }

    const patch: Record<string, unknown> = {};
    if (!existingProvider.slug) patch.slug = provider.slug;
    if (!existingProvider.email && provider.email) patch.email = provider.email;
    if (!existingProvider.address && provider.address) patch.address = provider.address;
    if (!existingProvider.phone && provider.phone) patch.phone = provider.phone;
    if (!existingProvider.website && provider.website) patch.website = provider.website;
    if (Object.keys(patch).length > 0) {
      patch.updatedAt = Date.now();
      await ctx.db.patch(existingProvider._id, patch);
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
