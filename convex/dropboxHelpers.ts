import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";

/**
 * Internal helpers for Dropbox integration.
 * These are called by the Dropbox actions to read/write DB data.
 */

/* ---------- Bill helpers ---------- */

export const getBillForDropbox = internalQuery({
  args: { billId: v.id("bills") },
  handler: async (ctx, args) => {
    const bill = await ctx.db.get(args.billId);
    if (!bill) return null;

    const category = bill.categoryId ? await ctx.db.get(bill.categoryId) : null;

    // Resolve provider/contact name
    let providerName: string | undefined;
    if (bill.contactId) {
      const contact = await ctx.db.get(bill.contactId);
      providerName = contact?.name;
    }
    if (!providerName && bill.providerId) {
      const provider = await ctx.db.get(bill.providerId);
      providerName = provider?.name;
    }
    if (!providerName) {
      providerName = bill.customProviderName ?? undefined;
    }

    return {
      fileId: bill.fileId,
      fileName: bill.fileName,
      uploadedAt: bill.uploadedAt,
      extractedData: bill.extractedData,
      categoryName: category?.name,
      providerName
    };
  }
});

export const saveBillDropboxPath = internalMutation({
  args: {
    billId: v.id("bills"),
    dropboxPath: v.string()
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.billId, {
      dropboxPath: args.dropboxPath
    });
  }
});

/* ---------- Record helpers ---------- */

export const getRecordForDropbox = internalQuery({
  args: { recordId: v.id("horseRecords") },
  handler: async (ctx, args) => {
    const record = await ctx.db.get(args.recordId);
    if (!record) return null;

    const horse = await ctx.db.get(record.horseId);

    return {
      type: record.type,
      date: record.date,
      horseName: horse?.name,
      attachmentName: record.attachmentName
    };
  }
});

export const saveRecordDropboxPath = internalMutation({
  args: {
    recordId: v.id("horseRecords"),
    dropboxPath: v.string()
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.recordId, {
      dropboxPath: args.dropboxPath
    });
  }
});
