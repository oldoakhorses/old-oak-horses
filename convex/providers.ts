import { v } from "convex/values";
import { internalMutation, internalQuery, mutation, query } from "./_generated/server";

export const getProvidersByCategory = query({
  args: { categoryId: v.id("categories") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("providers")
      .withIndex("by_category_name", (q) => q.eq("categoryId", args.categoryId))
      .collect();
  }
});

export const getProvidersByCategoryAndSubcategory = query({
  args: {
    categoryId: v.id("categories"),
    subcategorySlug: v.string()
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("providers")
      .withIndex("by_category_subcategory_name", (q) => q.eq("categoryId", args.categoryId).eq("subcategorySlug", args.subcategorySlug))
      .collect();
  }
});

export const getProviderById = query({
  args: { providerId: v.id("providers") },
  handler: async (ctx, args) => {
    const provider = await ctx.db.get(args.providerId);
    if (!provider) return null;

    const category = await ctx.db.get(provider.categoryId);
    return {
      ...provider,
      category
    };
  }
});

export const getProviderBySlug = query({
  args: {
    categorySlug: v.string(),
    providerSlug: v.string()
  },
  handler: async (ctx, args) => {
    const slugAliases: Record<string, string> = {
      "fred-michaelson": "fred-michelon",
      sominium: "somnium"
    };
    const requestedSlug = slugAliases[args.providerSlug] ?? args.providerSlug;
    const category = await ctx.db
      .query("categories")
      .withIndex("by_slug", (q) => q.eq("slug", args.categorySlug))
      .first();
    if (!category) return null;

    const provider = await ctx.db
      .query("providers")
      .withIndex("by_slug", (q) => q.eq("slug", requestedSlug))
      .filter((q) => q.eq(q.field("categoryId"), category._id))
      .first();
    if (!provider) {
      const categoryProviders = await ctx.db
        .query("providers")
        .withIndex("by_category", (q) => q.eq("categoryId", category._id))
        .collect();
      const fallback = categoryProviders.find((entry) => slugify(entry.name) === requestedSlug);
      if (!fallback) return null;
      return {
        ...fallback,
        category
      };
    }

    return {
      ...provider,
      category
    };
  }
});

export const getProviderByNameInCategory = query({
  args: {
    categoryId: v.id("categories"),
    name: v.string()
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("providers")
      .withIndex("by_category_name", (q) => q.eq("categoryId", args.categoryId).eq("name", args.name))
      .first();
  }
});

export const getProviderByNameInCategoryInternal = internalQuery({
  args: {
    categoryId: v.id("categories"),
    name: v.string()
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("providers")
      .withIndex("by_category_name", (q) => q.eq("categoryId", args.categoryId).eq("name", args.name))
      .first();
  }
});

export const createProvider = mutation({
  args: {
    categoryId: v.id("categories"),
    subcategorySlug: v.optional(v.string()),
    name: v.string(),
    extractionPrompt: v.string(),
    expectedFields: v.array(v.string())
  },
  handler: async (ctx, args) => {
    const category = await ctx.db.get(args.categoryId);
    if (!category) {
      throw new Error("Category not found");
    }

    return await ctx.db.insert("providers", {
      categoryId: args.categoryId,
      subcategorySlug: args.subcategorySlug,
      name: args.name,
      slug: slugify(args.name),
      extractionPrompt: args.extractionPrompt,
      expectedFields: args.expectedFields,
      createdAt: Date.now()
    });
  }
});

export const updateProviderPrompt = mutation({
  args: {
    providerId: v.id("providers"),
    extractionPrompt: v.string(),
    expectedFields: v.array(v.string())
  },
  handler: async (ctx, args) => {
    const provider = await ctx.db.get(args.providerId);
    if (!provider) {
      throw new Error("Provider not found");
    }

    await ctx.db.patch(args.providerId, {
      extractionPrompt: args.extractionPrompt,
      expectedFields: args.expectedFields
    });

    return args.providerId;
  }
});

export const updateProviderContact = mutation({
  args: {
    providerId: v.id("providers"),
    fullName: v.optional(v.string()),
    contactName: v.optional(v.string()),
    primaryContactName: v.optional(v.string()),
    primaryContactPhone: v.optional(v.string()),
    address: v.optional(v.string()),
    phone: v.optional(v.string()),
    email: v.optional(v.string()),
    website: v.optional(v.string()),
    accountNumber: v.optional(v.string())
  },
  handler: async (ctx, args) => {
    const provider = await ctx.db.get(args.providerId);
    if (!provider) {
      throw new Error("Provider not found");
    }

    const { providerId, ...updates } = args;
    await ctx.db.patch(providerId, {
      ...updates,
      updatedAt: Date.now()
    });
    return providerId;
  }
});

export const createProviderOnUpload = mutation({
  args: {
    name: v.string(),
    categoryId: v.id("categories"),
    subcategorySlug: v.optional(v.string())
  },
  handler: async (ctx, args) => {
    return await createProviderOnUploadImpl(ctx, args.name, args.categoryId, args.subcategorySlug);
  }
});

export const createProviderOnUploadInternal = internalMutation({
  args: {
    name: v.string(),
    categoryId: v.id("categories"),
    subcategorySlug: v.optional(v.string())
  },
  handler: async (ctx, args) => {
    return await createProviderOnUploadImpl(ctx, args.name, args.categoryId, args.subcategorySlug);
  }
});

function slugify(value: string) {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-");
}

async function createProviderOnUploadImpl(ctx: any, name: string, categoryId: string, subcategorySlug?: string) {
  const cleanName = name.trim();
  const baseSlug = slugify(cleanName);
  const existing = await ctx.db
    .query("providers")
    .withIndex("by_slug", (q: any) => q.eq("slug", baseSlug))
    .first();

  const slug = existing ? `${baseSlug}-${Date.now().toString(36).slice(-4)}` : baseSlug;
  return await ctx.db.insert("providers", {
    name: cleanName,
    slug,
    categoryId,
    subcategorySlug,
    extractionPrompt: "",
    expectedFields: [],
    createdAt: Date.now()
  });
}
