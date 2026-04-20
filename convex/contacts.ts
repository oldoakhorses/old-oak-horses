import { v } from "convex/values";
import { internalMutation, internalQuery, mutation, query } from "./_generated/server";

const locationValue = v.union(
  v.literal("wellington"),
  v.literal("thermal"),
  v.literal("ocala"),
  v.literal("la"),
  v.literal("eu"),
  v.literal("can")
);

function trimOrUndefined(value?: string) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function normalizeLocation(value?: string) {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return undefined;
  if (normalized === "wellington") return "wellington" as const;
  if (normalized === "thermal") return "thermal" as const;
  if (normalized === "ocala") return "ocala" as const;
  if (normalized === "la") return "la" as const;
  if (normalized === "eu") return "eu" as const;
  if (normalized === "can" || normalized === "canada") return "can" as const;
  return undefined;
}

function normalizeCategory(value?: string) {
  const raw = value?.trim();
  return raw ? raw.toLowerCase().replace(/\s+/g, "_") : "other";
}

function normalizeEmail(value?: string) {
  const trimmed = value?.trim();
  return trimmed ? trimmed.toLowerCase() : undefined;
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)+/g, "");
}

async function generateUniqueSlug(ctx: any, name: string) {
  const base = slugify(name);
  if (!base) return undefined;
  const existing = await ctx.db.query("contacts").withIndex("by_slug", (q: any) => q.eq("slug", base)).first();
  if (!existing) return base;
  let suffix = 2;
  while (true) {
    const candidate = `${base}-${suffix}`;
    const found = await ctx.db.query("contacts").withIndex("by_slug", (q: any) => q.eq("slug", candidate)).first();
    if (!found) return candidate;
    suffix++;
  }
}

export const getAllContacts = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("contacts").withIndex("by_name").collect();
  }
});

export const getContactsByCategory = query({
  args: { category: v.string() },
  handler: async (ctx, args) => {
    const contacts = await ctx.db
      .query("contacts")
      .withIndex("by_category", (q) => q.eq("category", normalizeCategory(args.category)))
      .collect();
    return contacts.sort((a, b) => a.name.localeCompare(b.name));
  }
});

export const getContactById = query({
  args: { id: v.id("contacts") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.id);
  }
});

export const getContactBySlug = query({
  args: { slug: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("contacts")
      .withIndex("by_slug", (q) => q.eq("slug", args.slug))
      .first();
  }
});

export const getVendorContacts = query({
  args: {},
  handler: async (ctx) => {
    const contacts = await ctx.db.query("contacts").collect();
    return contacts.sort((a, b) => a.name.localeCompare(b.name));
  }
});

export const listContacts = query({
  args: {
    category: v.optional(v.string()),
    location: v.optional(v.union(v.literal("all"), locationValue))
  },
  handler: async (ctx, args) => {
    const contacts = await ctx.db.query("contacts").withIndex("by_name").collect();
    return contacts.filter((contact) => {
      if (args.category && args.category !== "all" && contact.category !== normalizeCategory(args.category)) {
        return false;
      }
      if (args.location && args.location !== "all" && contact.location !== args.location) {
        return false;
      }
      return true;
    });
  }
});

export const createContact = mutation({
  args: {
    name: v.string(),
    companyName: v.optional(v.string()),
    category: v.string(),
    location: v.optional(locationValue),
    phone: v.optional(v.string()),
    email: v.optional(v.string()),
    address: v.optional(v.string()),
    website: v.optional(v.string()),
    accountNumber: v.optional(v.string()),
    notes: v.optional(v.string())
  },
  handler: async (ctx, args) => {
    const slug = await generateUniqueSlug(ctx, args.name);
    return await ctx.db.insert("contacts", {
      name: args.name.trim(),
      slug,
      companyName: trimOrUndefined(args.companyName),
      category: normalizeCategory(args.category),
      location: args.location,
      phone: trimOrUndefined(args.phone),
      email: normalizeEmail(args.email),
      address: trimOrUndefined(args.address),
      website: trimOrUndefined(args.website),
      accountNumber: trimOrUndefined(args.accountNumber),
      notes: trimOrUndefined(args.notes),
      createdAt: Date.now()
    });
  }
});

export const updateContact = mutation({
  args: {
    contactId: v.optional(v.id("contacts")),
    id: v.optional(v.id("contacts")),
    name: v.optional(v.string()),
    category: v.optional(v.string()),
    location: v.optional(v.string()),
    phone: v.optional(v.string()),
    email: v.optional(v.string()),
    notes: v.optional(v.string()),
    address: v.optional(v.string()),
    website: v.optional(v.string()),
    accountNumber: v.optional(v.string()),
    companyName: v.optional(v.string()),
    contactStatus: v.optional(v.union(v.literal("active"), v.literal("invoice_only"))),
  },
  handler: async (ctx, args) => {
    const contactId = args.contactId ?? args.id;
    if (!contactId) throw new Error("contactId is required");
    const contact = await ctx.db.get(contactId);
    if (!contact) throw new Error("Contact not found");

    const fields = {
      name: args.name !== undefined ? args.name.trim() : undefined,
      category: args.category !== undefined ? normalizeCategory(args.category) : undefined,
      location: args.location !== undefined ? normalizeLocation(args.location) : undefined,
      phone: args.phone !== undefined ? trimOrUndefined(args.phone) : undefined,
      email: args.email !== undefined ? normalizeEmail(args.email) : undefined,
      notes: args.notes !== undefined ? trimOrUndefined(args.notes) : undefined,
      address: args.address !== undefined ? trimOrUndefined(args.address) : undefined,
      website: args.website !== undefined ? trimOrUndefined(args.website) : undefined,
      accountNumber: args.accountNumber !== undefined ? trimOrUndefined(args.accountNumber) : undefined,
      companyName: args.companyName !== undefined ? trimOrUndefined(args.companyName) : undefined,
      contactStatus: args.contactStatus,
    } as const;
    const updates = Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined));
    if (args.location !== undefined && !normalizeLocation(args.location)) {
      updates.location = undefined;
    }
    if (args.category !== undefined && !args.category.trim()) {
      updates.category = "other";
    }
    await ctx.db.patch(contactId, updates as any);

    return contactId;
  }
});

export const deleteContact = mutation({
  args: {
    contactId: v.optional(v.id("contacts")),
    id: v.optional(v.id("contacts"))
  },
  handler: async (ctx, args) => {
    const contactId = args.contactId ?? args.id;
    if (!contactId) throw new Error("contactId is required");
    await ctx.db.delete(contactId);
    return contactId;
  }
});

/**
 * Merge two contacts: point all bills + contactAliases referencing `sourceId`
 * to `targetId`, then delete `sourceId`. Used to clean up duplicates.
 */
export const mergeContacts = mutation({
  args: {
    targetId: v.id("contacts"),
    sourceId: v.id("contacts")
  },
  handler: async (ctx, args) => {
    if (args.targetId === args.sourceId) throw new Error("targetId and sourceId must differ");
    const target = await ctx.db.get(args.targetId);
    const source = await ctx.db.get(args.sourceId);
    if (!target) throw new Error("target contact not found");
    if (!source) throw new Error("source contact not found");

    // Repoint bills
    const bills = await ctx.db
      .query("bills")
      .withIndex("by_contact", (q) => q.eq("contactId", args.sourceId))
      .collect();
    for (const bill of bills) {
      await ctx.db.patch(bill._id, { contactId: args.targetId });
    }

    // Repoint contactAliases
    const aliases = await ctx.db.query("contactAliases").collect();
    for (const alias of aliases) {
      if (alias.contactId === args.sourceId) {
        await ctx.db.patch(alias._id, { contactId: args.targetId });
      }
    }

    // Fill in any fields on target that are missing from source
    const patch: Record<string, unknown> = {};
    const fillable: (keyof typeof source)[] = [
      "email", "phone", "address", "website", "accountNumber",
      "companyName", "location"
    ];
    for (const key of fillable) {
      const targetVal = (target as any)[key];
      const sourceVal = (source as any)[key];
      if (!targetVal && sourceVal) patch[key as string] = sourceVal;
    }
    if (Object.keys(patch).length > 0) {
      await ctx.db.patch(args.targetId, patch);
    }

    await ctx.db.delete(args.sourceId);
    return { mergedBills: bills.length, keptId: args.targetId, deletedId: args.sourceId };
  }
});

/**
 * One-off cleanup: normalize category slugs, backfill missing slugs,
 * consolidate legacy duplicate fields (primaryContactName -> contactName,
 * company -> fullName), and clear fields that are being dropped from the
 * schema.
 *
 * Idempotent — safe to run multiple times.
 */
export const cleanupContactsForSchemaSlim = mutation({
  args: {},
  handler: async (ctx) => {
    const contacts = await ctx.db.query("contacts").collect();

    // For slug uniqueness
    const takenSlugs = new Set<string>();
    for (const c of contacts) {
      if (c.slug) takenSlugs.add(c.slug);
    }

    function slugifyLocal(str: string): string {
      return str
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 60) || "contact";
    }

    let normalizedCategories = 0;
    let backfilledSlugs = 0;
    let consolidatedContactName = 0;
    let consolidatedFullName = 0;
    let clearedLegacyFields = 0;

    const dropFields = [
      "role",
      "type",
      "company",
      "primaryContactName",
      "primaryContactPhone",
      "providerName",
      "expectedFields",
      "extractionPrompt",
    ] as const;

    for (const c of contacts) {
      const patch: Record<string, unknown> = {};

      // 1. Normalize category slug
      const cat = (c as any).category;
      if (typeof cat === "string") {
        let normalized = cat;
        if (cat === "horse_transport") normalized = "horse-transport";
        else if (cat === "feed_bedding") normalized = "feed-bedding";
        else if (cat === "dues_registrations") normalized = "dues-registrations";
        else if (cat === "show_expenses") normalized = "show-expenses";
        else if (cat === "riding_training") normalized = "riding-training";
        if (normalized !== cat) {
          patch.category = normalized;
          normalizedCategories++;
        }
      }

      // 2. Consolidate primaryContactName -> contactName (legacy — both fields
      //    have since been dropped from the schema, but we keep the cleanup
      //    logic idempotent for any data that still has them around.)
      const primaryContactName = (c as any).primaryContactName;
      if (primaryContactName && !(c as any).contactName) {
        patch.contactName = primaryContactName;
        consolidatedContactName++;
      }

      // 3. Consolidate company -> fullName (also now dropped; still safe to
      //    run on legacy rows.)
      const company = (c as any).company;
      if (company && !(c as any).fullName) {
        patch.fullName = company;
        consolidatedFullName++;
      }

      // 4. Backfill slug
      if (!c.slug && c.name) {
        let base = slugifyLocal(c.name);
        let slug = base;
        let n = 2;
        while (takenSlugs.has(slug)) {
          slug = `${base}-${n}`;
          n++;
        }
        takenSlugs.add(slug);
        patch.slug = slug;
        backfilledSlugs++;
      }

      // 5. Clear fields being dropped (set to undefined so the schema-tighten
      //    push doesn't reject).
      let fieldsCleared = 0;
      for (const f of dropFields) {
        if ((c as any)[f] !== undefined) {
          patch[f] = undefined;
          fieldsCleared++;
        }
      }
      if (fieldsCleared > 0) clearedLegacyFields++;

      if (Object.keys(patch).length > 0) {
        await ctx.db.patch(c._id, patch);
      }
    }

    return {
      totalContacts: contacts.length,
      normalizedCategories,
      backfilledSlugs,
      consolidatedContactName,
      consolidatedFullName,
      clearedLegacyFields,
    };
  },
});

/**
 * One-off migration for the providers-table removal: nullify every
 * `providerId` reference across bills + contacts, and delete the entire
 * providerAliases + providers tables' rows. Idempotent.
 */
export const stripAllProviderFields = mutation({
  args: {},
  handler: async (ctx) => {
    const contacts = await ctx.db.query("contacts").collect();
    let contactsCleared = 0;
    for (const c of contacts) {
      if ((c as any).providerId !== undefined) {
        await ctx.db.patch(c._id, { providerId: undefined } as any);
        contactsCleared++;
      }
    }

    const bills = await ctx.db.query("bills").collect();
    let billsCleared = 0;
    for (const b of bills) {
      if ((b as any).providerId !== undefined || (b as any).providerDetected !== undefined || (b as any).providerConfirmed !== undefined) {
        await ctx.db.patch(b._id, {
          providerId: undefined,
          providerDetected: undefined,
          providerConfirmed: undefined,
        } as any);
        billsCleared++;
      }
    }

    // providers + providerAliases tables have been dropped from the schema,
    // so their rows are already gone. Keeping the migration idempotent shape.
    return {
      contactsCleared,
      billsCleared,
      providerAliasesDeleted: 0,
      providersDeleted: 0,
    };
  },
});

/**
 * One-off migration: rename `fullName` -> `companyName` on every contact,
 * and clear `contactName` (dropped entirely). Idempotent.
 */
export const renameFullNameToCompanyName = mutation({
  args: {},
  handler: async (ctx) => {
    const contacts = await ctx.db.query("contacts").collect();
    let renamedFullName = 0;
    let clearedContactName = 0;
    for (const c of contacts) {
      const patch: Record<string, unknown> = {};
      const fullName = (c as any).fullName as string | undefined;
      const companyName = (c as any).companyName as string | undefined;
      if (fullName && !companyName) {
        patch.companyName = fullName;
        renamedFullName++;
      }
      if (fullName !== undefined) {
        patch.fullName = undefined;
      }
      if ((c as any).contactName !== undefined) {
        patch.contactName = undefined;
        clearedContactName++;
      }
      if (Object.keys(patch).length > 0) {
        await ctx.db.patch(c._id, patch);
      }
    }
    return { totalContacts: contacts.length, renamedFullName, clearedContactName };
  },
});

/**
 * Find duplicate contacts by (categoryId, name) and return them grouped.
 */
export const findDuplicateContacts = query({
  args: { name: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const all = await ctx.db.query("contacts").collect();
    const groups: Record<string, typeof all> = {};
    for (const c of all) {
      if (args.name && c.name.toLowerCase() !== args.name.toLowerCase()) continue;
      const key = `${(c as any).category ?? (c as any).categoryId ?? "_nocat_"}::${c.name.trim().toLowerCase()}`;
      groups[key] = groups[key] || [];
      groups[key].push(c);
    }
    return Object.entries(groups)
      .filter(([, v]) => v.length > 1)
      .map(([key, contacts]) => ({ key, contacts }));
  }
});

export const upsertContactFromInvoice = internalMutation({
  args: {
    name: v.string(),
    category: v.string(),
    location: v.optional(v.string()),
    phone: v.optional(v.string()),
    email: v.optional(v.string()),
    companyName: v.optional(v.string()),
    address: v.optional(v.string()),
    website: v.optional(v.string()),
    accountNumber: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const normalizedName = args.name.trim();
    if (!normalizedName) return null;

    const normalizedCategory = normalizeCategory(args.category);
    const normalizedLocation = normalizeLocation(args.location);
    const normalizedEmail = normalizeEmail(args.email);
    const key = normalizedName.toLowerCase();
    const normalizedCompanyName = trimOrUndefined(args.companyName)?.toLowerCase();
    const existingContacts = await ctx.db.query("contacts").collect();
    const alreadyExists = existingContacts.some((contact) => {
      const cName = contact.name?.toLowerCase();
      const cCompanyName = contact.companyName?.toLowerCase();
      const cEmail = contact.email?.toLowerCase();
      if (cName === key) return true;
      if (normalizedCompanyName && cCompanyName === normalizedCompanyName) return true;
      if (normalizedEmail && cEmail === normalizedEmail) return true;
      return false;
    });
    if (alreadyExists) return null;

    const slug = await generateUniqueSlug(ctx, normalizedName);
    return await ctx.db.insert("contacts", {
      name: normalizedName,
      slug,
      companyName: trimOrUndefined(args.companyName),
      category: normalizedCategory,
      location: normalizedLocation,
      address: trimOrUndefined(args.address),
      phone: trimOrUndefined(args.phone),
      email: normalizedEmail,
      website: trimOrUndefined(args.website),
      accountNumber: trimOrUndefined(args.accountNumber),
      createdAt: Date.now()
    });
  }
});

export const listVendorsForMatching = internalQuery({
  args: {},
  handler: async (ctx) => {
    const contacts = await ctx.db.query("contacts").collect();
    return contacts.map((contact) => ({
      _id: contact._id,
      name: contact.name,
      slug: contact.slug ?? undefined,
      email: contact.email ?? undefined,
      phone: contact.phone ?? undefined,
      website: contact.website ?? undefined,
      address: contact.address ?? undefined,
      category: contact.category ?? "other",
    }));
  },
});

export const getContactByNameInternal = internalQuery({
  args: { name: v.string() },
  handler: async (ctx, args) => {
    const normalized = args.name.trim().toLowerCase();
    const contacts = await ctx.db.query("contacts").withIndex("by_name").collect();
    return contacts.find((c) => c.name.toLowerCase().trim() === normalized) ?? null;
  },
});

export const updateContactFromInvoice = internalMutation({
  args: {
    contactId: v.id("contacts"),
    companyName: v.optional(v.string()),
    address: v.optional(v.string()),
    phone: v.optional(v.string()),
    email: v.optional(v.string()),
    website: v.optional(v.string()),
    accountNumber: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const contact = await ctx.db.get(args.contactId);
    if (!contact) return;

    const updates: Record<string, unknown> = {};
    if (args.companyName && !contact.companyName) updates.companyName = args.companyName;
    if (args.address && !contact.address) updates.address = args.address;
    if (args.phone && !contact.phone) updates.phone = args.phone;
    if (args.email && !contact.email) updates.email = args.email;
    if (args.website && !contact.website) updates.website = args.website;
    if (args.accountNumber && !contact.accountNumber) updates.accountNumber = args.accountNumber;

    if (Object.keys(updates).length > 0) {
      updates.updatedAt = Date.now();
      await ctx.db.patch(args.contactId, updates as any);
    }
  },
});
