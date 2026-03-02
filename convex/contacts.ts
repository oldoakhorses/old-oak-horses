import { v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";

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
    location: v.optional(locationValue),
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
    await ctx.db.patch(contactId, {
      name: args.name ? args.name.trim() : undefined,
      role: args.role !== undefined ? trimOrUndefined(args.role) : undefined,
      providerId: args.providerId,
      providerName: providerName !== undefined ? trimOrUndefined(providerName) : undefined,
      category: args.category ? normalizeCategory(args.category) : undefined,
      location: args.location,
      phone: args.phone !== undefined ? trimOrUndefined(args.phone) : undefined,
      email: args.email !== undefined ? normalizeEmail(args.email) : undefined,
      notes: args.notes !== undefined ? trimOrUndefined(args.notes) : undefined,
      company: providerName !== undefined ? trimOrUndefined(providerName) : undefined
    });

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
    if (!normalizedName) return null;

    const normalizedCategory = normalizeCategory(args.category);
    const normalizedLocation = normalizeLocation(args.location);
    const normalizedEmail = normalizeEmail(args.email);
    const normalizedProviderName = trimOrUndefined(args.providerName);

    let existing =
      normalizedEmail
        ? (await ctx.db
            .query("contacts")
            .withIndex("by_name", (q) => q.eq("name", normalizedName))
            .collect())
            .find((entry) => entry.email === normalizedEmail && entry.category === normalizedCategory)
        : undefined;

    if (!existing) {
      existing = (await ctx.db.query("contacts").withIndex("by_name", (q) => q.eq("name", normalizedName)).collect()).find((entry) => {
        if (entry.category !== normalizedCategory) return false;
        if (args.providerId && entry.providerId && String(entry.providerId) !== String(args.providerId)) return false;
        if (normalizedProviderName && entry.providerName && entry.providerName !== normalizedProviderName) return false;
        return true;
      });
    }

    if (existing) {
      await ctx.db.patch(existing._id, {
        role: existing.role ?? trimOrUndefined(args.role),
        providerId: existing.providerId ?? args.providerId,
        providerName: existing.providerName ?? normalizedProviderName,
        company: existing.company ?? normalizedProviderName,
        location: existing.location ?? normalizedLocation,
        phone: existing.phone ?? trimOrUndefined(args.phone),
        email: existing.email ?? normalizedEmail
      });
      return existing._id;
    }

    return await ctx.db.insert("contacts", {
      name: normalizedName,
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
