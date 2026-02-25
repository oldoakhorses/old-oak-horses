import { v } from "convex/values";
import { action } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

export const uploadAndParseBill: any = action({
  args: {
    categoryId: v.id("categories"),
    providerId: v.id("providers"),
    travelSubcategory: v.optional(v.string()),
    housingSubcategory: v.optional(v.string()),
    base64Pdf: v.string(),
    uploadedAt: v.optional(v.number())
  },
  handler: async (ctx, args): Promise<{ billId: Id<"bills">; fileName: string }> => {
    const provider = (await ctx.runQuery(internal.bills.getProvider, { providerId: args.providerId })) as
      | { categoryId: Id<"categories">; name: string }
      | null;
    if (!provider) {
      throw new Error("Provider not found");
    }
    if (provider.categoryId !== args.categoryId) {
      throw new Error("Provider/category mismatch");
    }

    const category = (await ctx.runQuery(internal.bills.getCategory, { categoryId: args.categoryId })) as
      | { name: string }
      | null;
    if (!category) {
      throw new Error("Category not found");
    }

    const uploadedAt = args.uploadedAt ?? Date.now();
    const uploadDate = new Date(uploadedAt).toISOString().slice(0, 10);
    const baseName = `${category.name} - ${provider.name} - ${uploadDate}`;
    const existingFileNames = (await ctx.runQuery(internal.bills.getBillFileNamesByProvider, {
      providerId: args.providerId
    })) as string[];

    const fileName = nextAvailableFileName(existingFileNames, baseName);
    const bytes = base64ToBytes(args.base64Pdf);
    const fileId = await ctx.storage.store(new Blob([bytes], { type: "application/pdf" }));
    const originalPdfUrl = (await ctx.storage.getUrl(fileId)) ?? undefined;

    const billId = (await ctx.runMutation(internal.bills.createParsingBill, {
      providerId: args.providerId,
      categoryId: args.categoryId,
      fileId,
      fileName,
      billingPeriod: uploadDate.slice(0, 7),
      uploadedAt,
      originalPdfUrl,
      travelSubcategory: args.travelSubcategory,
      housingSubcategory: args.housingSubcategory
    })) as Id<"bills">;

    await ctx.scheduler.runAfter(0, internal.bills.parseBillPdf, { billId });
    return { billId, fileName };
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
