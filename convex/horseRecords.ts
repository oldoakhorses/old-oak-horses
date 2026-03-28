import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

function withStorageId(value?: string) {
  return value as Id<"_storage"> | undefined;
}

export const createHorseRecord = mutation({
  args: {
    horseId: v.id("horses"),
    type: v.union(
      v.literal("veterinary"),
      v.literal("medication"),
      v.literal("farrier"),
      v.literal("bodywork"),
      v.literal("other")
    ),
    customType: v.optional(v.string()),
    date: v.number(),
    providerName: v.optional(v.string()),
    visitType: v.optional(v.union(v.literal("vaccination"), v.literal("treatment"))),
    vaccineName: v.optional(v.string()),
    treatmentDescription: v.optional(v.string()),
    serviceType: v.optional(v.string()),
    isUpcoming: v.optional(v.boolean()),
    linkedRecordId: v.optional(v.id("horseRecords")),
    notes: v.optional(v.string()),
    attachmentStorageId: v.optional(v.string()),
    attachmentName: v.optional(v.string()),
    billId: v.optional(v.id("bills"))
  },
  handler: async (ctx, args) => {
    console.log("createHorseRecord called with:", JSON.stringify(args, null, 2));
    try {
      const recordId = await ctx.db.insert("horseRecords", {
        horseId: args.horseId,
        type: args.type,
        customType: args.customType?.trim() || undefined,
        date: args.date,
        providerName: args.providerName?.trim() || undefined,
        visitType: args.visitType,
        vaccineName: args.vaccineName?.trim() || undefined,
        treatmentDescription: args.treatmentDescription?.trim() || undefined,
        serviceType: args.serviceType?.trim() || undefined,
        isUpcoming: args.isUpcoming ?? false,
        linkedRecordId: args.linkedRecordId,
        notes: args.notes?.trim() || undefined,
        attachmentStorageId: args.attachmentStorageId,
        attachmentName: args.attachmentName?.trim() || undefined,
        billId: args.billId
      });

      // Schedule Dropbox upload if there's an attachment
      if (args.attachmentStorageId) {
        await ctx.scheduler.runAfter(0, internal.dropbox.uploadRecordAttachmentToDropbox, {
          recordId,
          storageId: args.attachmentStorageId
        });
      }

      return recordId;
    } catch (error) {
      console.error("createHorseRecord error:", error);
      throw error;
    }
  }
});

export const getRecentByHorse = query({
  args: { horseId: v.id("horses"), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("horseRecords")
      .withIndex("by_horse", (q) => q.eq("horseId", args.horseId))
      .collect();

    rows.sort((a, b) => b.date - a.date);
    const limited = rows.slice(0, args.limit ?? 3);

    return await Promise.all(
      limited.map(async (row) => ({
        ...row,
        attachmentUrl: row.attachmentStorageId ? await ctx.storage.getUrl(withStorageId(row.attachmentStorageId)!) : null,
      }))
    );
  },
});

export const getAllByHorse = query({
  args: { horseId: v.id("horses") },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("horseRecords")
      .withIndex("by_horse", (q) => q.eq("horseId", args.horseId))
      .collect();

    rows.sort((a, b) => b.date - a.date);

    return await Promise.all(
      rows.map(async (row) => {
        let billInfo = null;
        if (row.billId) {
          const bill = await ctx.db.get(row.billId);
          if (bill) {
            let providerName = (bill as any).customProviderName ?? "Unknown";
            if ((bill as any).contactId) {
              const contact = await ctx.db.get((bill as any).contactId);
              if (contact) providerName = (contact as any).name ?? providerName;
            }
            const extracted = ((bill as any).extractedData ?? {}) as Record<string, unknown>;
            billInfo = {
              billId: bill._id,
              providerName,
              invoiceDate: String(extracted.invoice_date ?? extracted.invoiceDate ?? ""),
            };
          }
        }
        return {
          ...row,
          attachmentUrl: row.attachmentStorageId ? await ctx.storage.getUrl(withStorageId(row.attachmentStorageId)!) : null,
          billInfo,
        };
      })
    );
  },
});

export const getUpcoming = query({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const rows = await ctx.db.query("horseRecords").collect();
    const upcoming: Array<{
      type: "scheduled" | "followup";
      record: typeof rows[number];
      horse: { _id: Id<"horses">; name: string; status: "active" | "inactive" | "past"; isSold?: boolean };
      eventDate: number;
    }> = [];

    for (const record of rows) {
      const horse = await ctx.db.get(record.horseId);
      if (!horse || horse.status !== "active") continue;

      if (record.isUpcoming && record.date > now) {
        upcoming.push({
          type: record.linkedRecordId ? "followup" : "scheduled",
          record,
          horse: { _id: horse._id, name: horse.name, status: horse.status, isSold: horse.isSold },
          eventDate: record.date,
        });
      }
    }

    upcoming.sort((a, b) => a.eventDate - b.eventDate);
    return upcoming;
  },
});

export const getAll = query({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("horseRecords").collect();
    return await Promise.all(
      rows.map(async (record) => {
        const horse = await ctx.db.get(record.horseId);
        let billInfo = null;
        if (record.billId) {
          const bill = await ctx.db.get(record.billId);
          if (bill) {
            let providerName = (bill as any).customProviderName ?? "Unknown";
            if ((bill as any).contactId) {
              const contact = await ctx.db.get((bill as any).contactId);
              if (contact) providerName = (contact as any).name ?? providerName;
            }
            const extracted = ((bill as any).extractedData ?? {}) as Record<string, unknown>;
            billInfo = {
              billId: bill._id,
              providerName,
              invoiceDate: String(extracted.invoice_date ?? extracted.invoiceDate ?? ""),
            };
          }
        }
        return {
          ...record,
          horseName: horse?.name || "Unknown",
          horse: horse
            ? {
                _id: horse._id,
                name: horse.name,
                status: horse.status,
              }
            : null,
          attachmentUrl: record.attachmentStorageId ? await ctx.storage.getUrl(withStorageId(record.attachmentStorageId)!) : null,
          billInfo,
        };
      })
    );
  },
});

export const updateHorseRecord = mutation({
  args: {
    recordId: v.id("horseRecords"),
    type: v.optional(v.union(
      v.literal("veterinary"),
      v.literal("medication"),
      v.literal("farrier"),
      v.literal("bodywork"),
      v.literal("other")
    )),
    customType: v.optional(v.string()),
    date: v.optional(v.number()),
    providerName: v.optional(v.string()),
    visitType: v.optional(v.union(v.literal("vaccination"), v.literal("treatment"))),
    vaccineName: v.optional(v.string()),
    treatmentDescription: v.optional(v.string()),
    serviceType: v.optional(v.string()),
    isUpcoming: v.optional(v.boolean()),
    linkedRecordId: v.optional(v.id("horseRecords")),
    notes: v.optional(v.string()),
    billId: v.optional(v.id("bills"))
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db.get(args.recordId);
    if (!existing) {
      throw new Error("Record not found");
    }

    const { recordId, ...rest } = args;
    await ctx.db.patch(recordId, {
      ...rest,
      customType: rest.customType?.trim() || undefined,
      providerName: rest.providerName?.trim() || undefined,
      vaccineName: rest.vaccineName?.trim() || undefined,
      treatmentDescription: rest.treatmentDescription?.trim() || undefined,
      serviceType: rest.serviceType?.trim() || undefined,
      notes: rest.notes?.trim() || undefined,
    });

    return recordId;
  }
});

export const updateRecordWithNextVisit = mutation({
  args: {
    recordId: v.id("horseRecords"),
    updates: v.object({
      type: v.optional(v.union(
        v.literal("veterinary"),
        v.literal("medication"),
        v.literal("farrier"),
        v.literal("bodywork"),
        v.literal("other")
      )),
      customType: v.optional(v.string()),
      date: v.optional(v.number()),
      providerName: v.optional(v.string()),
      serviceType: v.optional(v.string()),
      visitType: v.optional(v.union(v.literal("vaccination"), v.literal("treatment"))),
      vaccineName: v.optional(v.string()),
      treatmentDescription: v.optional(v.string()),
      notes: v.optional(v.string()),
      attachmentStorageId: v.optional(v.string()),
      attachmentName: v.optional(v.string()),
      billId: v.optional(v.id("bills")),
    }),
    nextVisitDate: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const record = await ctx.db.get(args.recordId);
    if (!record) throw new Error("Record not found");

    const cleanedUpdates = {
      ...args.updates,
      customType: args.updates.customType?.trim() || undefined,
      providerName: args.updates.providerName?.trim() || undefined,
      serviceType: args.updates.serviceType?.trim() || undefined,
      vaccineName: args.updates.vaccineName?.trim() || undefined,
      treatmentDescription: args.updates.treatmentDescription?.trim() || undefined,
      notes: args.updates.notes?.trim() || undefined,
      attachmentStorageId: args.updates.attachmentStorageId || undefined,
      attachmentName: args.updates.attachmentName?.trim() || undefined,
      billId: args.updates.billId,
    };

    // Schedule Dropbox upload if a new attachment was added
    if (args.updates.attachmentStorageId && args.updates.attachmentStorageId !== record.attachmentStorageId) {
      await ctx.scheduler.runAfter(0, internal.dropbox.uploadRecordAttachmentToDropbox, {
        recordId: args.recordId,
        storageId: args.updates.attachmentStorageId,
      });
    }

    const hasExistingUpcoming = record.linkedRecordId ? await ctx.db.get(record.linkedRecordId) : null;

    await ctx.db.patch(args.recordId, cleanedUpdates);

    // Upcoming records are already scheduled items; do not create/delete paired follow-ups from them.
    if (record.isUpcoming) {
      return args.recordId;
    }

    if (typeof args.nextVisitDate === "number") {
      const nextVisitTimestamp = args.nextVisitDate;
      if (hasExistingUpcoming && record.linkedRecordId) {
        await ctx.db.patch(record.linkedRecordId, {
          date: nextVisitTimestamp,
          providerName: cleanedUpdates.providerName ?? record.providerName,
          type: cleanedUpdates.type ?? record.type,
          customType: cleanedUpdates.customType ?? record.customType,
          serviceType: cleanedUpdates.serviceType ?? record.serviceType,
          visitType: cleanedUpdates.visitType ?? record.visitType,
          vaccineName: cleanedUpdates.vaccineName ?? record.vaccineName,
          treatmentDescription: cleanedUpdates.treatmentDescription ?? record.treatmentDescription,
        });
      } else {
        const upcomingId = await ctx.db.insert("horseRecords", {
          horseId: record.horseId,
          type: cleanedUpdates.type ?? record.type,
          customType: cleanedUpdates.customType ?? record.customType,
          date: nextVisitTimestamp,
          providerName: cleanedUpdates.providerName ?? record.providerName,
          serviceType: cleanedUpdates.serviceType ?? record.serviceType,
          visitType: cleanedUpdates.visitType ?? record.visitType,
          vaccineName: cleanedUpdates.vaccineName ?? record.vaccineName,
          treatmentDescription: cleanedUpdates.treatmentDescription ?? record.treatmentDescription,
          isUpcoming: true,
          linkedRecordId: args.recordId,
          notes: undefined,
          attachmentStorageId: undefined,
        });
        await ctx.db.patch(args.recordId, { linkedRecordId: upcomingId });
      }
    } else if (hasExistingUpcoming && record.linkedRecordId) {
      await ctx.db.delete(record.linkedRecordId);
      await ctx.db.patch(args.recordId, { linkedRecordId: undefined });
    }

    return args.recordId;
  },
});

export const deleteHorseRecord = mutation({
  args: { recordId: v.id("horseRecords") },
  handler: async (ctx, args) => {
    const record = await ctx.db.get(args.recordId);
    if (!record) {
      throw new Error("Record not found");
    }

    if (record.attachmentStorageId) {
      await ctx.storage.delete(withStorageId(record.attachmentStorageId)!);
    }

    await ctx.db.delete(args.recordId);
    return args.recordId;
  }
});

export const migrateNextVisitToUpcomingRecords = mutation({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("horseRecords").collect();
    let migrated = 0;
    for (const row of rows) {
      const legacyNextVisitDate = (row as any).nextVisitDate as number | undefined;
      if (!legacyNextVisitDate || row.linkedRecordId) continue;

      const upcomingId = await ctx.db.insert("horseRecords", {
        horseId: row.horseId,
        type: row.type,
        customType: row.customType,
        date: legacyNextVisitDate,
        providerName: row.providerName,
        visitType: row.visitType,
        vaccineName: row.vaccineName,
        treatmentDescription: row.treatmentDescription,
        serviceType: row.serviceType,
        notes: undefined,
        attachmentStorageId: undefined,
        isUpcoming: true,
        linkedRecordId: row._id,
      });

      await ctx.db.patch(row._id, {
        isUpcoming: false,
        linkedRecordId: upcomingId,
      });
      migrated += 1;
    }
    return { migrated };
  },
});

export const getByBill = query({
  args: { billId: v.id("bills") },
  handler: async (ctx, args) => {
    const rows = await ctx.db.query("horseRecords").withIndex("by_bill", (q) => q.eq("billId", args.billId)).collect();
    return await Promise.all(
      rows.map(async (row) => {
        const horse = await ctx.db.get(row.horseId);
        return {
          ...row,
          horseName: horse?.name || "Unknown",
        };
      })
    );
  },
});
