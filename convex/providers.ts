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

export const listByCategory = query({
  args: { category: v.string() },
  handler: async (ctx, args) => {
    const slug = args.category.trim().toLowerCase();
    if (!slug) return [];

    const category = await ctx.db
      .query("categories")
      .withIndex("by_slug", (q) => q.eq("slug", slug))
      .first();
    if (!category) return [];

    return await ctx.db
      .query("providers")
      .withIndex("by_category_name", (q) => q.eq("categoryId", category._id))
      .collect();
  }
});

export const getAllProvidersWithCategory = query({
  args: {},
  handler: async (ctx) => {
    const providers = await ctx.db.query("providers").withIndex("by_name").collect();
    const categoryIds = [...new Set(providers.map((p) => p.categoryId))];
    const categories = await Promise.all(categoryIds.map((id) => ctx.db.get(id)));
    const categoryMap = new Map(categories.filter(Boolean).map((c: any) => [String(c._id), c]));

    return providers
      .map((provider) => {
        const category = categoryMap.get(String(provider.categoryId));
        return {
          ...provider,
          categoryName: category?.name ?? "Unknown",
          categorySlug: category?.slug ?? "unknown",
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }
});

export const listAllForMatching = internalQuery({
  args: {},
  handler: async (ctx) => {
    const providers = await ctx.db.query("providers").withIndex("by_name").collect();
    const categories = await ctx.db.query("categories").collect();
    const categoryMap = new Map(categories.map((category) => [String(category._id), category]));

    return providers.map((provider) => {
      const category = categoryMap.get(String(provider.categoryId));
      return {
        _id: provider._id,
        categoryId: provider.categoryId,
        name: provider.name,
        slug: provider.slug ?? undefined,
        email: provider.email ?? undefined,
        phone: provider.phone ?? undefined,
        website: provider.website ?? undefined,
        address: provider.address ?? undefined,
        categorySlug: category?.slug ?? "unknown",
        subcategorySlug: provider.subcategorySlug ?? undefined,
      };
    });
  },
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
    providerSlug: v.string(),
    subcategorySlug: v.optional(v.string())
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

    const provider = args.subcategorySlug
      ? await ctx.db
          .query("providers")
          .withIndex("by_slug", (q) => q.eq("slug", requestedSlug))
          .filter((q) => q.and(q.eq(q.field("categoryId"), category._id), q.eq(q.field("subcategorySlug"), args.subcategorySlug)))
          .first()
      : await ctx.db
          .query("providers")
          .withIndex("by_slug", (q) => q.eq("slug", requestedSlug))
          .filter((q) => q.eq(q.field("categoryId"), category._id))
          .first();
    if (!provider) {
      const categoryProviders = await ctx.db
        .query("providers")
        .withIndex("by_category", (q) => q.eq("categoryId", category._id))
        .collect();
      const fallback = categoryProviders.find((entry) =>
        slugify(entry.name) === requestedSlug &&
        (!args.subcategorySlug || entry.subcategorySlug === args.subcategorySlug)
      );
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
      category: category.slug,
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
    accountNumber: v.optional(v.string()),
    location: v.optional(
      v.union(
        v.literal("wellington"),
        v.literal("thermal"),
        v.literal("ocala"),
        v.literal("la"),
        v.literal("eu"),
        v.literal("can")
      )
    )
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

export const backfillProviderCategoryField = mutation({
  args: {},
  handler: async (ctx) => {
    const providers = await ctx.db.query("providers").collect();
    let updated = 0;
    for (const provider of providers) {
      if (provider.category) continue;
      const category = await ctx.db.get(provider.categoryId);
      if (!category) continue;
      await ctx.db.patch(provider._id, {
        category: category.slug,
        updatedAt: Date.now(),
      });
      updated += 1;
    }
    return { updated };
  },
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
  const category = await ctx.db.get(categoryId);
  if (!category) throw new Error("Category not found");
  const cleanName = name.trim();
  const baseSlug = slugify(cleanName);
  const existing = await ctx.db
    .query("providers")
    .withIndex("by_slug", (q: any) => q.eq("slug", baseSlug))
    .first();

  const slug = existing ? `${baseSlug}-${Date.now().toString(36).slice(-4)}` : baseSlug;
  const providerId = await ctx.db.insert("providers", {
    name: cleanName,
    slug,
    categoryId,
    category: category.slug,
    subcategorySlug,
    extractionPrompt: "",
    expectedFields: [],
    createdAt: Date.now()
  });

  // Also create a corresponding contact
  const existingContact = await ctx.db
    .query("contacts")
    .withIndex("by_slug", (q: any) => q.eq("slug", slug))
    .first();
  if (!existingContact) {
    await ctx.db.insert("contacts", {
      name: cleanName,
      slug,
      type: "vendor",
      providerId,
      providerName: cleanName,
      category: category.slug,
      createdAt: Date.now(),
    });
  }

  return providerId;
}
