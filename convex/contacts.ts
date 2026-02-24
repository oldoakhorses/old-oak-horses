import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

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
      .withIndex("by_category", (q) => q.eq("category", args.category))
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

export const createContact = mutation({
  args: {
    name: v.string(),
    category: v.string(),
    company: v.optional(v.string()),
    phone: v.optional(v.string()),
    email: v.optional(v.string())
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("contacts", {
      name: args.name.trim(),
      category: args.category.trim(),
      company: args.company?.trim() || undefined,
      phone: args.phone?.trim() || undefined,
      email: args.email?.trim() || undefined,
      createdAt: Date.now()
    });
  }
});

export const updateContact = mutation({
  args: {
    id: v.id("contacts"),
    name: v.optional(v.string()),
    category: v.optional(v.string()),
    company: v.optional(v.string()),
    phone: v.optional(v.string()),
    email: v.optional(v.string())
  },
  handler: async (ctx, args) => {
    const contact = await ctx.db.get(args.id);
    if (!contact) {
      throw new Error("Contact not found");
    }

    await ctx.db.patch(args.id, {
      name: args.name?.trim(),
      category: args.category?.trim(),
      company: args.company?.trim() || undefined,
      phone: args.phone?.trim() || undefined,
      email: args.email?.trim() || undefined
    });

    return args.id;
  }
});

export const deleteContact = mutation({
  args: { id: v.id("contacts") },
  handler: async (ctx, args) => {
    await ctx.db.delete(args.id);
    return args.id;
  }
});
