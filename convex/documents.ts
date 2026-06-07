import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

const DOCUMENT_TAG_VALIDATOR = v.union(
  v.literal("coggins"),
  v.literal("health_certificate"),
  v.literal("horse_agreement"),
  v.literal("insurance"),
  v.literal("registration"),
  v.literal("contract"),
  v.literal("id"),
  v.literal("tax"),
  v.literal("other")
);

export const upload = mutation({
  args: {
    name: v.string(),
    tag: DOCUMENT_TAG_VALIDATOR,
    horseId: v.optional(v.id("horses")),
    personId: v.optional(v.id("people")),
    fileStorageId: v.id("_storage"),
    fileName: v.string(),
    fileType: v.optional(v.string()),
    fileSize: v.optional(v.number()),
    documentDate: v.optional(v.number()),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    if (!args.horseId && !args.personId) {
      throw new Error("Document must be associated with a horse or a person");
    }
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
    return withUrls.sort(
      (a, b) => (b.documentDate ?? b.uploadedAt) - (a.documentDate ?? a.uploadedAt)
    );
  },
});

export const listByPerson = query({
  args: { personId: v.id("people") },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("documents")
      .withIndex("by_person", (q) => q.eq("personId", args.personId))
      .collect();

    const withUrls = await Promise.all(
      rows.map(async (row) => ({
        ...row,
        fileUrl: await ctx.storage.getUrl(row.fileStorageId),
      }))
    );
    return withUrls.sort(
      (a, b) => (b.documentDate ?? b.uploadedAt) - (a.documentDate ?? a.uploadedAt)
    );
  },
});

export const getFileUrl = query({
  args: { storageId: v.id("_storage") },
  handler: async (ctx, args) => {
    return await ctx.storage.getUrl(args.storageId);
  },
});

export const updateDocument = mutation({
  args: {
    documentId: v.id("documents"),
    name: v.optional(v.string()),
    tag: v.optional(DOCUMENT_TAG_VALIDATOR),
    documentDate: v.optional(v.number()),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const doc = await ctx.db.get(args.documentId);
    if (!doc) throw new Error("Document not found");

    const patch: Record<string, unknown> = {};
    if (args.name !== undefined) {
      const trimmed = args.name.trim();
      if (!trimmed) throw new Error("Title cannot be empty");
      patch.name = trimmed;
    }
    if (args.tag !== undefined) patch.tag = args.tag;
    if (args.documentDate !== undefined) patch.documentDate = args.documentDate;
    if (args.notes !== undefined) patch.notes = args.notes.trim() || undefined;

    if (Object.keys(patch).length > 0) {
      await ctx.db.patch(args.documentId, patch);
    }
    return args.documentId;
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
