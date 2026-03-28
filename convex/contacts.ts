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
    const contacts = await ctx.db
      .query("contacts")
      .withIndex("by_type", (q) => q.eq("type", "vendor"))
      .collect();
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
    role: v.optional(v.string()),
    providerId: v.optional(v.id("providers")),
    providerName: v.optional(v.string()),
    category: v.string(),
    location: v.optional(locationValue),
    phone: v.optional(v.string()),
    email: v.optional(v.string()),
    notes: v.optional(v.string()),
    company: v.optional(v.string())
  },
  handler: async (ctx, args) => {
    const providerName = trimOrUndefined(args.providerName) ?? trimOrUndefined(args.company);
    return await ctx.db.insert("contacts", {
      name: args.name.trim(),
      role: trimOrUndefined(args.role),
      providerId: args.providerId,
      providerName,
      category: normalizeCategory(args.category),
      location: args.location,
      phone: trimOrUndefined(args.phone),
      email: normalizeEmail(args.email),
      notes: trimOrUndefined(args.notes),
      company: providerName,
      createdAt: Date.now()
    });
  }
});

export const updateContact = mutation({
  args: {
    contactId: v.optional(v.id("contacts")),
    id: v.optional(v.id("contacts")),
    name: v.optional(v.string()),
    role: v.optional(v.string()),
    providerId: v.optional(v.id("providers")),
    providerName: v.optional(v.string()),
    category: v.optional(v.string()),
    location: v.optional(v.string()),
    phone: v.optional(v.string()),
    email: v.optional(v.string()),
    notes: v.optional(v.string()),
    company: v.optional(v.string())
  },
  handler: async (ctx, args) => {
    const contactId = args.contactId ?? args.id;
    if (!contactId) throw new Error("contactId is required");
    const contact = await ctx.db.get(contactId);
    if (!contact) throw new Error("Contact not found");

    const providerName = args.providerName ?? args.company;
    const fields = {
      name: args.name !== undefined ? args.name.trim() : undefined,
      role: args.role !== undefined ? trimOrUndefined(args.role) : undefined,
      providerId: args.providerId,
      providerName: providerName !== undefined ? trimOrUndefined(providerName) : undefined,
      category: args.category !== undefined ? normalizeCategory(args.category) : undefined,
      location: args.location !== undefined ? normalizeLocation(args.location) : undefined,
      phone: args.phone !== undefined ? trimOrUndefined(args.phone) : undefined,
      email: args.email !== undefined ? normalizeEmail(args.email) : undefined,
      notes: args.notes !== undefined ? trimOrUndefined(args.notes) : undefined,
      company: providerName !== undefined ? trimOrUndefined(providerName) : undefined
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

export const upsertContactFromInvoice = internalMutation({
  args: {
    name: v.string(),
    role: v.optional(v.string()),
    providerId: v.optional(v.id("providers")),
    providerName: v.optional(v.string()),
    category: v.string(),
    location: v.optional(v.string()),
    phone: v.optional(v.string()),
    email: v.optional(v.string())
  },
  handler: async (ctx, args) => {
    const normalizedName = args.name.trim();
    const normalizedProviderName = trimOrUndefined(args.providerName);
    if (!normalizedName && !normalizedProviderName) return null;

    const normalizedCategory = normalizeCategory(args.category);
    const normalizedLocation = normalizeLocation(args.location);
    const normalizedEmail = normalizeEmail(args.email);
    const providerKey = (normalizedProviderName ?? normalizedName).toLowerCase();
    const existingContacts = await ctx.db.query("contacts").collect();
    const alreadyExists = existingContacts.some((contact) => {
      const contactProviderName = contact.providerName?.toLowerCase();
      const contactName = contact.name?.toLowerCase();
      const contactEmail = contact.email?.toLowerCase();

      if (providerKey && (contactProviderName === providerKey || contactName === providerKey)) {
        return true;
      }
      if (normalizedEmail && contactEmail === normalizedEmail) {
        return true;
      }
      return false;
    });
    if (alreadyExists) return null;

    return await ctx.db.insert("contacts", {
      name: normalizedName || normalizedProviderName || "Unknown",
      role: trimOrUndefined(args.role),
      providerId: args.providerId,
      providerName: normalizedProviderName,
      company: normalizedProviderName,
      category: normalizedCategory,
      location: normalizedLocation,
      phone: trimOrUndefined(args.phone),
      email: normalizedEmail,
      createdAt: Date.now()
    });
  }
});

export const listVendorsForMatching = internalQuery({
  args: {},
  handler: async (ctx) => {
    const contacts = await ctx.db.query("contacts").collect();
    return contacts
      .filter((c) => c.type === "vendor" || c.providerId)
      .map((contact) => ({
        _id: contact._id,
        name: contact.name,
        slug: contact.slug ?? undefined,
        email: contact.email ?? undefined,
        phone: contact.phone ?? undefined,
        website: contact.website ?? undefined,
        address: contact.address ?? undefined,
        category: contact.category ?? "other",
        providerId: contact.providerId ?? undefined,
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
    fullName: v.optional(v.string()),
    contactName: v.optional(v.string()),
    primaryContactName: v.optional(v.string()),
    primaryContactPhone: v.optional(v.string()),
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
    if (args.fullName && !contact.fullName) updates.fullName = args.fullName;
    if (args.contactName && !contact.contactName) updates.contactName = args.contactName;
    if (args.primaryContactName && !contact.primaryContactName) updates.primaryContactName = args.primaryContactName;
    if (args.primaryContactPhone && !contact.primaryContactPhone) updates.primaryContactPhone = args.primaryContactPhone;
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
