import { v } from "convex/values";
import { action } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

/**
 * Upload a PDF that's already been streamed to Convex storage and kick off parsing.
 * No category/contact required — the parser figures that out and the user picks
 * the contact on the preview page.
 */
export const parseUploadedInvoice: any = action({
  args: {
    fileStorageId: v.id("_storage"),
    categoryId: v.optional(v.id("categories")),
    contactId: v.optional(v.id("contacts")),
    customProviderName: v.optional(v.string()),
    adminSubcategory: v.optional(v.string()),
    duesSubcategory: v.optional(v.string()),
    uploadedAt: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<{ billId: Id<"bills">; fileName: string; redirectPath: string; listPath: string }> => {
    const category = args.categoryId
      ? ((await ctx.runQuery(internal.bills.getCategory, { categoryId: args.categoryId })) as
          | { name: string; slug?: string }
          | null)
      : null;

    const customProviderName = args.customProviderName?.trim() || undefined;
    const isAdminCategory = category?.slug === "admin";
    const isDuesCategory = category?.slug === "dues-registrations";

    const uploadedAt = args.uploadedAt ?? Date.now();
    const uploadDate = new Date(uploadedAt).toISOString().slice(0, 10);
    const displayName = customProviderName ?? "Other";
    const baseName = `${category?.name ?? "Invoice"} - ${displayName} - ${uploadDate}`;
    const existingFileNames = args.contactId
      ? ((await ctx.runQuery(internal.bills.getBillFileNamesByContact, { contactId: args.contactId })) as string[])
      : [];
    const fileName = nextAvailableFileName(existingFileNames, baseName);
    const originalPdfUrl = (await ctx.storage.getUrl(args.fileStorageId)) ?? undefined;

    const billId = (await ctx.runMutation(internal.bills.createParsingBill, {
      contactId: args.contactId,
      categoryId: args.categoryId,
      fileId: args.fileStorageId,
      fileName,
      billingPeriod: uploadDate.slice(0, 7),
      uploadedAt,
      customProviderName: args.contactId ? undefined : customProviderName,
      originalPdfUrl,
      adminSubcategory: isAdminCategory ? args.adminSubcategory || undefined : undefined,
      duesSubcategory: isDuesCategory ? args.duesSubcategory || undefined : undefined,
    })) as Id<"bills">;

    await ctx.scheduler.runAfter(0, internal.billParsing.parseBillPdf, { billId });

    // Every bill now lives at the preview URL — no more category/provider nesting.
    return {
      billId,
      fileName,
      redirectPath: `/invoices/preview/${billId}`,
      listPath: "/invoices",
    };
  },
});

/**
 * Reassign a bill to a different category/contact and re-run the parser
 * (if the bill has a PDF). Used by the preview page edit flow.
 */
export const reassignAndReparse: any = action({
  args: {
    billId: v.id("bills"),
    categoryId: v.id("categories"),
    contactId: v.optional(v.id("contacts")),
    customProviderName: v.optional(v.string()),
    adminSubcategory: v.optional(v.string()),
    duesSubcategory: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await ctx.runMutation(internal.bills.reassignBillContact, {
      billId: args.billId,
      categoryId: args.categoryId,
      contactId: args.contactId,
      customProviderName: args.customProviderName,
      adminSubcategory: args.adminSubcategory,
      duesSubcategory: args.duesSubcategory,
    });
    // Only re-parse if the bill actually has a PDF. CC-reconcile bills
    // have no fileId, so parsing would fail and leave the bill errored.
    const bill = await ctx.runQuery(internal.bills.getBill, { billId: args.billId });
    if (bill?.fileId) {
      await ctx.scheduler.runAfter(0, internal.billParsing.parseBillPdf, { billId: args.billId });
    }
  },
});

function nextAvailableFileName(existingNames: string[], baseName: string) {
  const names = new Set(existingNames);
  if (!names.has(baseName)) return baseName;

  let index = 1;
  while (true) {
    const candidate = `${baseName}-${String(index).padStart(2, "0")}`;
    if (!names.has(candidate)) return candidate;
    index += 1;
  }
}
