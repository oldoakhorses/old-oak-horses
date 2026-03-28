import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

export const upload = mutation({
  args: {
    name: v.string(),
    tag: v.union(
      v.literal("coggins"),
      v.literal("health_certificate"),
      v.literal("horse_agreement"),
      v.literal("insurance"),
      v.literal("registration"),
      v.literal("other")
    ),
    horseId: v.id("horses"),
    fileStorageId: v.id("_storage"),
    fileName: v.string(),
    fileType: v.optional(v.string()),
    fileSize: v.optional(v.number()),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("documents", {
      ...args,
      name: args.name.trim(),
      notes: args.notes?.trim() || undefined,
      uploadedAt: Date.now(),
    });
  },
});

export const listByHorse = query({
  args: { horseId: v.id("horses") },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("documents")
      .withIndex("by_horse", (q) => q.eq("horseId", args.horseId))
      .collect();

    const withUrls = await Promise.all(
      rows.map(async (row) => ({
        ...row,
        fileUrl: await ctx.storage.getUrl(row.fileStorageId),
      }))
    );
    return withUrls.sort((a, b) => b.uploadedAt - a.uploadedAt);
  },
});

export const getFileUrl = query({
  args: { storageId: v.id("_storage") },
  handler: async (ctx, args) => {
    return await ctx.storage.getUrl(args.storageId);
  },
});

export const deleteDocument = mutation({
  args: { documentId: v.id("documents") },
  handler: async (ctx, args) => {
    const doc = await ctx.db.get(args.documentId);
    if (!doc) {
      throw new Error("Document not found");
    }

    await ctx.storage.delete(doc.fileStorageId);
    await ctx.db.delete(args.documentId);
  },
});
