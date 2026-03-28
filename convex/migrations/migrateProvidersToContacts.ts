import { internalMutation } from "../_generated/server";

function slugify(value: string) {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-");
}

/**
 * Phase 1 – Step 1: Copy all providers → contacts with type "vendor".
 * Handles slug collisions by appending a suffix.
 * Stores the original providerId on the contact for back-reference.
 */
export const migrateProvidersToContacts = internalMutation({
  args: {},
  handler: async (ctx) => {
    const providers = await ctx.db.query("providers").collect();
    const existingContacts = await ctx.db.query("contacts").collect();

    // Build a set of existing slugs + names (lowercase) to detect collisions
    const existingSlugs = new Set(
      existingContacts.map((c) => c.slug).filter(Boolean)
    );
    const existingNameKeys = new Set(
      existingContacts.map((c) => c.name.toLowerCase().trim())
    );

    // Track provider→contact mapping for backfill step
    const providerToContact: Record<string, string> = {};
    let created = 0;
    let skipped = 0;

    for (const provider of providers) {
      const nameKey = provider.name.toLowerCase().trim();

      // If a contact already exists with this provider's name, link them
      // instead of creating a duplicate
      const existingContact = existingContacts.find(
        (c) =>
          c.name.toLowerCase().trim() === nameKey ||
          (c.providerName && c.providerName.toLowerCase().trim() === nameKey)
      );

      if (existingContact) {
        // Update the existing contact with vendor fields if missing
        const updates: Record<string, unknown> = {};
        if (!existingContact.type) updates.type = "vendor";
        if (!existingContact.slug) {
          let slug = slugify(provider.name);
          if (existingSlugs.has(slug)) {
            slug = `${slug}-${Date.now().toString(36).slice(-4)}`;
          }
          updates.slug = slug;
          existingSlugs.add(slug);
        }
        if (!existingContact.providerId) updates.providerId = provider._id;
        if (!existingContact.fullName && provider.fullName)
          updates.fullName = provider.fullName;
        if (!existingContact.contactName && provider.contactName)
          updates.contactName = provider.contactName;
        if (!existingContact.primaryContactName && provider.primaryContactName)
          updates.primaryContactName = provider.primaryContactName;
        if (!existingContact.primaryContactPhone && provider.primaryContactPhone)
          updates.primaryContactPhone = provider.primaryContactPhone;
        if (!existingContact.address && provider.address)
          updates.address = provider.address;
        if (!existingContact.phone && provider.phone)
          updates.phone = provider.phone;
        if (!existingContact.email && provider.email)
          updates.email = provider.email;
        if (!existingContact.website && provider.website)
          updates.website = provider.website;
        if (!existingContact.accountNumber && provider.accountNumber)
          updates.accountNumber = provider.accountNumber;
        if (provider.extractionPrompt)
          updates.extractionPrompt = provider.extractionPrompt;
        if (provider.expectedFields?.length)
          updates.expectedFields = provider.expectedFields;
        updates.updatedAt = Date.now();

        if (Object.keys(updates).length > 1) {
          await ctx.db.patch(existingContact._id, updates as any);
        }
        providerToContact[String(provider._id)] = String(existingContact._id);
        skipped++;
        continue;
      }

      // Generate a unique slug
      let slug = provider.slug || slugify(provider.name);
      if (existingSlugs.has(slug)) {
        slug = `${slug}-${Date.now().toString(36).slice(-4)}`;
      }
      existingSlugs.add(slug);

      // Resolve category slug from the provider's category
      const category = await ctx.db.get(provider.categoryId);
      const categorySlug = category?.slug ?? "other";

      const contactId = await ctx.db.insert("contacts", {
        name: provider.name,
        slug,
        fullName: provider.fullName,
        type: "vendor",
        providerId: provider._id,
        providerName: provider.name,
        category: categorySlug,
        contactName: provider.contactName,
        primaryContactName: provider.primaryContactName,
        primaryContactPhone: provider.primaryContactPhone,
        address: provider.address,
        location: provider.location,
        phone: provider.phone,
        email: provider.email,
        website: provider.website,
        accountNumber: provider.accountNumber,
        extractionPrompt: provider.extractionPrompt || undefined,
        expectedFields:
          provider.expectedFields?.length ? provider.expectedFields : undefined,
        createdAt: provider.createdAt,
        updatedAt: Date.now(),
      });

      providerToContact[String(provider._id)] = String(contactId);
      created++;
    }

    return { created, skipped, providerToContact };
  },
});

/**
 * Phase 1 – Step 2: Backfill contactId on all bills that have a providerId.
 * Accepts the providerToContact map from step 1.
 */
export const backfillBillContactIds = internalMutation({
  args: {},
  handler: async (ctx) => {
    // Build provider→contact map from current contacts
    const contacts = await ctx.db.query("contacts").collect();
    const providerToContact = new Map<string, string>();
    for (const contact of contacts) {
      if (contact.providerId) {
        providerToContact.set(String(contact.providerId), String(contact._id));
      }
    }

    const bills = await ctx.db.query("bills").collect();
    let updated = 0;
    let skippedNoProvider = 0;
    let skippedNoContact = 0;
    let alreadySet = 0;

    for (const bill of bills) {
      if (bill.contactId) {
        alreadySet++;
        continue;
      }
      if (!bill.providerId) {
        skippedNoProvider++;
        continue;
      }
      const contactId = providerToContact.get(String(bill.providerId));
      if (!contactId) {
        skippedNoContact++;
        continue;
      }
      await ctx.db.patch(bill._id, { contactId: contactId as any });
      updated++;
    }

    return { updated, alreadySet, skippedNoProvider, skippedNoContact };
  },
});

/**
 * Phase 1 – Step 3: Copy providerAliases → contactAliases.
 */
export const migrateProviderAliasesToContactAliases = internalMutation({
  args: {},
  handler: async (ctx) => {
    const providerAliases = await ctx.db.query("providerAliases").collect();
    const contacts = await ctx.db.query("contacts").collect();

    // Build provider→contact map
    const providerToContact = new Map<string, { _id: string; name: string }>();
    for (const contact of contacts) {
      if (contact.providerId) {
        providerToContact.set(String(contact.providerId), {
          _id: String(contact._id),
          name: contact.name,
        });
      }
    }

    // Check existing contactAliases to avoid duplicates
    const existingAliases = await ctx.db.query("contactAliases").collect();
    const existingAliasSet = new Set(
      existingAliases.map((a) => a.alias.toLowerCase())
    );

    let created = 0;
    let skipped = 0;

    for (const alias of providerAliases) {
      if (existingAliasSet.has(alias.alias.toLowerCase())) {
        skipped++;
        continue;
      }
      const contact = providerToContact.get(String(alias.providerId));
      if (!contact) {
        skipped++;
        continue;
      }

      await ctx.db.insert("contactAliases", {
        alias: alias.alias.toLowerCase(),
        contactName: contact.name,
        contactId: contact._id as any,
        createdAt: alias.createdAt,
        updatedAt: Date.now(),
      });
      existingAliasSet.add(alias.alias.toLowerCase());
      created++;
    }

    return { created, skipped };
  },
});
