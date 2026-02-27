import { v } from "convex/values";
import { action } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

export const uploadAndParseBill: any = action({
  args: {
    categoryId: v.id("categories"),
    providerId: v.optional(v.id("providers")),
    customProviderName: v.optional(v.string()),
    saveAsNew: v.optional(v.boolean()),
    travelSubcategory: v.optional(v.string()),
    housingSubcategory: v.optional(v.string()),
    horseTransportSubcategory: v.optional(v.string()),
    marketingSubcategory: v.optional(v.string()),
    adminSubcategory: v.optional(v.string()),
    duesSubcategory: v.optional(v.string()),
    salariesSubcategory: v.optional(v.string()),
    base64Pdf: v.string(),
    uploadedAt: v.optional(v.number())
  },
  handler: async (ctx, args): Promise<{ billId: Id<"bills">; fileName: string; redirectPath: string; listPath: string }> => {
    const category = (await ctx.runQuery(internal.bills.getCategory, { categoryId: args.categoryId })) as
      | { name: string; slug?: string }
      | null;
    if (!category) {
      throw new Error("Category not found");
    }

    let providerId = args.providerId;
    const customProviderName = args.customProviderName?.trim() || undefined;

    const isSubcategoryCategory =
      category.slug === "travel" || category.slug === "housing" || category.slug === "marketing" || category.slug === "salaries";
    const isAdminCategory = category.slug === "admin";
    const isDuesCategory = category.slug === "dues-registrations";
    const isHorseTransportCategory = category.slug === "horse-transport";

    if (!providerId && customProviderName && args.saveAsNew) {
      if (isSubcategoryCategory) {
        await ctx.runMutation(internal.customSubcategories.createCustomSubcategoryOnUploadInternal, {
          categoryId: args.categoryId,
          name: customProviderName
        });
      } else {
        providerId = (await ctx.runMutation(internal.providers.createProviderOnUploadInternal, {
          categoryId: args.categoryId,
          name: customProviderName,
          subcategorySlug:
            isHorseTransportCategory ? args.horseTransportSubcategory :
            isAdminCategory ? args.adminSubcategory :
            isDuesCategory ? args.duesSubcategory :
            undefined
        })) as Id<"providers">;
      }
    }

    const provider = providerId
      ? ((await ctx.runQuery(internal.bills.getProvider, { providerId })) as
      | { categoryId: Id<"categories">; name: string }
      | null)
      : null;
    if (provider && provider.categoryId !== args.categoryId) {
      throw new Error("Provider/category mismatch");
    }

    const uploadedAt = args.uploadedAt ?? Date.now();
    const uploadDate = new Date(uploadedAt).toISOString().slice(0, 10);
    const displayName = provider?.name ?? customProviderName ?? "Other";
    const baseName = `${category.name} - ${displayName} - ${uploadDate}`;
    const existingFileNames = providerId
      ? ((await ctx.runQuery(internal.bills.getBillFileNamesByProvider, {
          providerId
        })) as string[])
      : [];

    const fileName = nextAvailableFileName(existingFileNames, baseName);
    const bytes = base64ToBytes(args.base64Pdf);
    const fileId = await ctx.storage.store(new Blob([bytes], { type: "application/pdf" }));
    const originalPdfUrl = (await ctx.storage.getUrl(fileId)) ?? undefined;

    const billId = (await ctx.runMutation(internal.bills.createParsingBill, {
      providerId,
      categoryId: args.categoryId,
      fileId,
      fileName,
      billingPeriod: uploadDate.slice(0, 7),
      uploadedAt,
      customProviderName: !providerId ? customProviderName : undefined,
      originalPdfUrl,
      travelSubcategory:
        category.slug === "travel"
          ? args.travelSubcategory || (!providerId && customProviderName ? slugify(customProviderName) : undefined)
          : undefined,
      housingSubcategory:
        category.slug === "housing"
          ? args.housingSubcategory || (!providerId && customProviderName ? slugify(customProviderName) : undefined)
          : undefined
      ,
      horseTransportSubcategory:
        category.slug === "horse-transport"
          ? args.horseTransportSubcategory || undefined
          : undefined,
      marketingSubcategory:
        category.slug === "marketing"
          ? args.marketingSubcategory || (!providerId && customProviderName ? slugify(customProviderName) : undefined)
          : undefined,
      adminSubcategory:
        category.slug === "admin"
          ? args.adminSubcategory || undefined
          : undefined,
      duesSubcategory:
        category.slug === "dues-registrations"
          ? args.duesSubcategory || undefined
          : undefined,
      salariesSubcategory:
        category.slug === "salaries"
          ? args.salariesSubcategory || (!providerId && customProviderName ? slugify(customProviderName) : undefined)
          : undefined
    })) as Id<"bills">;

    await ctx.scheduler.runAfter(0, internal.billParsing.parseBillPdf, { billId });

    const providerSlug = provider ? slugify(provider.name) : customProviderName ? slugify(customProviderName) : "other";
    const travelSubcategory = args.travelSubcategory || (!providerId && customProviderName ? slugify(customProviderName) : "travel");
    const housingSubcategory = args.housingSubcategory || (!providerId && customProviderName ? slugify(customProviderName) : "housing");

    let redirectPath = `/${category.slug}/${providerSlug}/${billId}`;
    let listPath = `/${category.slug}`;
    if (category.slug === "travel") {
      redirectPath = `/travel/${travelSubcategory}/${billId}`;
      listPath = `/travel/${travelSubcategory}`;
    } else if (category.slug === "housing") {
      redirectPath = `/housing/${housingSubcategory}/${billId}`;
      listPath = `/housing/${housingSubcategory}`;
    } else if (category.slug === "stabling") {
      redirectPath = `/stabling/${providerSlug}/${billId}`;
      listPath = `/stabling/${providerSlug}`;
    } else if (category.slug === "horse-transport") {
      const subSlug = args.horseTransportSubcategory || "ground-transport";
      redirectPath = `/horse-transport/${subSlug}/${providerSlug}/${billId}`;
      listPath = `/horse-transport/${subSlug}/${providerSlug}`;
    } else if (category.slug === "marketing") {
      const subSlug = args.marketingSubcategory || "other";
      redirectPath = `/marketing/${subSlug}/${billId}`;
      listPath = `/marketing/${subSlug}`;
    } else if (category.slug === "admin") {
      const subSlug = args.adminSubcategory || "payroll";
      redirectPath = `/admin/${subSlug}/${providerSlug}/${billId}`;
      listPath = `/admin/${subSlug}/${providerSlug}`;
    } else if (category.slug === "dues-registrations") {
      const subSlug = args.duesSubcategory || "memberships";
      redirectPath = `/dues-registrations/${subSlug}/${providerSlug}/${billId}`;
      listPath = `/dues-registrations/${subSlug}/${providerSlug}`;
    } else if (category.slug === "salaries") {
      const subSlug = args.salariesSubcategory || "other";
      redirectPath = `/salaries/${subSlug}/${billId}`;
      listPath = `/salaries/${subSlug}`;
    } else if (providerId) {
      listPath = `/${category.slug}/${providerSlug}`;
    }

    return { billId, fileName, redirectPath, listPath };
  }
});

function nextAvailableFileName(existingNames: string[], baseName: string) {
  const names = new Set(existingNames);
  if (!names.has(baseName)) {
    return baseName;
  }

  let index = 1;
  while (true) {
    const candidate = `${baseName}-${String(index).padStart(2, "0")}`;
    if (!names.has(candidate)) {
      return candidate;
    }
    index += 1;
  }
}

function base64ToBytes(base64: string) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)+/g, "");
}
