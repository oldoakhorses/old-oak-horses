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
    title: v.optional(v.string()),
    createdBy: v.optional(v.string()),
    type: v.union(
      v.literal("veterinary"),
      v.literal("medication"),
      v.literal("farrier"),
      v.literal("bodywork"),
      v.literal("other")
    ),
    customType: v.optional(v.string()),
    date: v.number(),
    contactName: v.optional(v.string()),
    contactId: v.optional(v.id("contacts")),
    visitType: v.optional(v.union(
      v.literal("vaccination"),
      v.literal("treatment"),
      v.literal("medication"),
      v.literal("joint_injections"),
      v.literal("exams_diagnostics"),
      v.literal("vaccinations"),
      v.literal("shockwave"),
      v.literal("sedation"),
      v.literal("fees"),
      v.literal("lab_work"),
      v.literal("blood_test"),
      v.literal("exam"),
      v.literal("imaging"),
      v.literal("other")
    )),
    visitTypes: v.optional(v.array(v.string())),
    vetOtherDescription: v.optional(v.string()),
    vaccineName: v.optional(v.string()),
    treatmentDescription: v.optional(v.string()),
    serviceType: v.optional(v.string()),
    medications: v.optional(v.array(v.string())),
    medicationRepeatValue: v.optional(v.number()),
    medicationRepeatUnit: v.optional(v.union(v.literal("days"), v.literal("weeks"), v.literal("months"))),
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
        title: args.title?.trim() || undefined,
        createdBy: args.createdBy?.trim() || undefined,
        type: args.type,
        customType: args.customType?.trim() || undefined,
        date: args.date,
        contactName: args.contactName?.trim() || undefined,
        contactId: args.contactId,
        visitType: args.visitType,
        visitTypes: args.visitTypes && args.visitTypes.length > 0 ? args.visitTypes : undefined,
        vetOtherDescription: args.vetOtherDescription?.trim() || undefined,
        vaccineName: args.vaccineName?.trim() || undefined,
        treatmentDescription: args.treatmentDescription?.trim() || undefined,
        serviceType: args.serviceType?.trim() || undefined,
        medications: args.medications && args.medications.length > 0 ? args.medications : undefined,
        medicationRepeatValue: args.medicationRepeatValue,
        medicationRepeatUnit: args.medicationRepeatUnit,
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
        contactName: row.contactName ?? (row as any).providerName,
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
            let contactName = (bill as any).customProviderName ?? "Unknown";
            if ((bill as any).contactId) {
              const contact = await ctx.db.get((bill as any).contactId);
              if (contact) contactName = (contact as any).name ?? contactName;
            }
            const extracted = ((bill as any).extractedData ?? {}) as Record<string, unknown>;
            billInfo = {
              billId: bill._id,
              contactName,
              invoiceDate: String(extracted.invoice_date ?? extracted.invoiceDate ?? ""),
            };
          }
        }
        return {
          ...row,
          contactName: row.contactName ?? (row as any).providerName,
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
  args: { ownerId: v.optional(v.id("owners")) },
  handler: async (ctx, args) => {
    let rows = await ctx.db.query("horseRecords").collect();
    // Filter by owner: include records whose parent horse is owned by the
    // picked owner (either via horse.ownerId or the horseOwnerships join).
    if (args.ownerId) {
      const allowed = new Set<string>();
      const allHorses = await ctx.db.query("horses").collect();
      for (const h of allHorses) {
        if (h.ownerId && String(h.ownerId) === String(args.ownerId)) allowed.add(String(h._id));
      }
      const links = await ctx.db
        .query("horseOwnerships")
        .withIndex("by_owner", (q: any) => q.eq("ownerId", args.ownerId!))
        .collect();
      for (const link of links) allowed.add(String(link.horseId));
      rows = rows.filter((r) => allowed.has(String(r.horseId)));
    }
    return await Promise.all(
      rows.map(async (record) => {
        const horse = await ctx.db.get(record.horseId);
        let billInfo = null;
        if (record.billId) {
          const bill = await ctx.db.get(record.billId);
          if (bill) {
            let contactName = (bill as any).customProviderName ?? "Unknown";
            if ((bill as any).contactId) {
              const contact = await ctx.db.get((bill as any).contactId);
              if (contact) contactName = (contact as any).name ?? contactName;
            }
            const extracted = ((bill as any).extractedData ?? {}) as Record<string, unknown>;
            billInfo = {
              billId: bill._id,
              contactName,
              invoiceDate: String(extracted.invoice_date ?? extracted.invoiceDate ?? ""),
            };
          }
        }
        return {
          ...record,
          contactName: record.contactName ?? (record as any).providerName,
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
    title: v.optional(v.string()),
    type: v.optional(v.union(
      v.literal("veterinary"),
      v.literal("medication"),
      v.literal("farrier"),
      v.literal("bodywork"),
      v.literal("other")
    )),
    customType: v.optional(v.string()),
    date: v.optional(v.number()),
    contactName: v.optional(v.string()),
    contactId: v.optional(v.id("contacts")),
    visitType: v.optional(v.union(
      v.literal("vaccination"),
      v.literal("treatment"),
      v.literal("medication"),
      v.literal("joint_injections"),
      v.literal("exams_diagnostics"),
      v.literal("vaccinations"),
      v.literal("shockwave"),
      v.literal("sedation"),
      v.literal("fees"),
      v.literal("lab_work"),
      v.literal("blood_test"),
      v.literal("exam"),
      v.literal("imaging"),
      v.literal("other")
    )),
    visitTypes: v.optional(v.array(v.string())),
    vetOtherDescription: v.optional(v.string()),
    vaccineName: v.optional(v.string()),
    treatmentDescription: v.optional(v.string()),
    serviceType: v.optional(v.string()),
    medications: v.optional(v.array(v.string())),
    medicationRepeatValue: v.optional(v.number()),
    medicationRepeatUnit: v.optional(v.union(v.literal("days"), v.literal("weeks"), v.literal("months"))),
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
      title: rest.title?.trim() || undefined,
      customType: rest.customType?.trim() || undefined,
      contactName: rest.contactName?.trim() || undefined,
      vetOtherDescription: rest.vetOtherDescription?.trim() || undefined,
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
      title: v.optional(v.string()),
      type: v.optional(v.union(
        v.literal("veterinary"),
        v.literal("medication"),
        v.literal("farrier"),
        v.literal("bodywork"),
        v.literal("other")
      )),
      customType: v.optional(v.string()),
      date: v.optional(v.number()),
      contactName: v.optional(v.string()),
      contactId: v.optional(v.id("contacts")),
      serviceType: v.optional(v.string()),
      visitType: v.optional(v.union(
      v.literal("vaccination"),
      v.literal("treatment"),
      v.literal("medication"),
      v.literal("joint_injections"),
      v.literal("exams_diagnostics"),
      v.literal("vaccinations"),
      v.literal("shockwave"),
      v.literal("sedation"),
      v.literal("fees"),
      v.literal("lab_work"),
      v.literal("blood_test"),
      v.literal("exam"),
      v.literal("imaging"),
      v.literal("other")
    )),
      visitTypes: v.optional(v.array(v.string())),
      vetOtherDescription: v.optional(v.string()),
      vaccineName: v.optional(v.string()),
      treatmentDescription: v.optional(v.string()),
      notes: v.optional(v.string()),
      medications: v.optional(v.array(v.string())),
      medicationRepeatValue: v.optional(v.number()),
      medicationRepeatUnit: v.optional(v.union(v.literal("days"), v.literal("weeks"), v.literal("months"))),
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
      title: args.updates.title?.trim() || undefined,
      customType: args.updates.customType?.trim() || undefined,
      contactName: args.updates.contactName?.trim() || undefined,
      serviceType: args.updates.serviceType?.trim() || undefined,
      vaccineName: args.updates.vaccineName?.trim() || undefined,
      treatmentDescription: args.updates.treatmentDescription?.trim() || undefined,
      vetOtherDescription: args.updates.vetOtherDescription?.trim() || undefined,
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
          contactName: cleanedUpdates.contactName ?? record.contactName,
          contactId: cleanedUpdates.contactId ?? record.contactId,
          type: cleanedUpdates.type ?? record.type,
          customType: cleanedUpdates.customType ?? record.customType,
          serviceType: cleanedUpdates.serviceType ?? record.serviceType,
          visitType: cleanedUpdates.visitType ?? record.visitType,
          visitTypes: cleanedUpdates.visitTypes ?? record.visitTypes,
          vetOtherDescription: cleanedUpdates.vetOtherDescription ?? record.vetOtherDescription,
          vaccineName: cleanedUpdates.vaccineName ?? record.vaccineName,
          treatmentDescription: cleanedUpdates.treatmentDescription ?? record.treatmentDescription,
        });
      } else {
        const upcomingId = await ctx.db.insert("horseRecords", {
          horseId: record.horseId,
          type: cleanedUpdates.type ?? record.type,
          customType: cleanedUpdates.customType ?? record.customType,
          date: nextVisitTimestamp,
          contactName: cleanedUpdates.contactName ?? record.contactName,
          contactId: cleanedUpdates.contactId ?? record.contactId,
          serviceType: cleanedUpdates.serviceType ?? record.serviceType,
          visitType: cleanedUpdates.visitType ?? record.visitType,
          visitTypes: cleanedUpdates.visitTypes ?? record.visitTypes,
          vetOtherDescription: cleanedUpdates.vetOtherDescription ?? record.vetOtherDescription,
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

/** One-shot migration: collapse `title` and `medications` on every
 *  medication record so the joined medications string acts as the
 *  record's title. Three cases per record:
 *    1) Both medications and title set →
 *       overwrite title = medications.join(", ").
 *    2) Only title set (no medications array) →
 *       promote the title into a single-element medications array
 *       (the legacy vet→medication migration left these), then sync
 *       title = medications.join(", ") so future reads are consistent.
 *    3) Only medications set (no title) →
 *       set title = medications.join(", ").
 *  Idempotent — re-running finds the data already consistent. */
export const migrateMedTitleToMedications = mutation({
  args: {},
  handler: async (ctx) => {
    const records = await ctx.db.query("horseRecords").collect();
    let updated = 0;
    for (const r of records) {
      if (r.type !== "medication") continue;
      const meds = Array.isArray(r.medications) ? r.medications.filter(Boolean) : [];
      const title = (r.title ?? "").trim();

      let nextMedications: string[] | undefined = meds;
      let nextTitle: string | undefined = title || undefined;

      if (meds.length > 0) {
        // Cases 1 + 3: medications is the source of truth.
        nextTitle = meds.join(", ");
      } else if (title) {
        // Case 2: lift the title into the medications array (split on
        // comma so a comma-separated title becomes multiple entries).
        nextMedications = title.split(",").map((s) => s.trim()).filter(Boolean);
        nextTitle = nextMedications.join(", ");
      } else {
        continue; // nothing to do
      }

      // Skip records that are already consistent.
      const sameMeds =
        (meds.length === nextMedications.length) &&
        meds.every((m, i) => m === nextMedications![i]);
      if (sameMeds && (r.title ?? undefined) === nextTitle) continue;

      await ctx.db.patch(r._id, {
        title: nextTitle,
        medications: nextMedications && nextMedications.length > 0 ? nextMedications : undefined,
      } as any);
      updated += 1;
    }
    return { totalRecords: records.length, updated };
  }
});

/** One-shot migration: any record currently classified as type="veterinary"
 *  with the legacy "medication" subcategory (either singular visitType
 *  or inside the visitTypes array) is promoted to type="medication" so
 *  it shows on the /meds page. visitType is cleared on promotion and
 *  "medication" is filtered out of any visitTypes array; if that leaves
 *  the array empty, the field is unset.
 *  Idempotent — re-running finds nothing left to migrate. */
export const migrateVetMedicationToMedicationRecords = mutation({
  args: {},
  handler: async (ctx) => {
    const records = await ctx.db.query("horseRecords").collect();
    let promoted = 0;
    for (const r of records) {
      if (r.type !== "veterinary") continue;
      const hasMedSingular = r.visitType === "medication";
      const visitTypesArr = Array.isArray(r.visitTypes) ? r.visitTypes : [];
      const hasMedInArray = visitTypesArr.includes("medication");
      if (!hasMedSingular && !hasMedInArray) continue;

      const remaining = visitTypesArr.filter((t) => t !== "medication");
      const patch: Record<string, unknown> = {
        type: "medication",
        // Clear the now-redundant subcategory fields. If there were
        // co-tagged visit types (e.g. ["vaccinations","medication"]),
        // they're preserved on visitTypes so the record still carries
        // that context for inspection — but the top-level type is now
        // medication, so it lands on /meds.
        visitType: undefined,
      };
      if (remaining.length === 0) patch.visitTypes = undefined;
      else patch.visitTypes = remaining;
      await ctx.db.patch(r._id, patch as any);
      promoted += 1;
    }
    return { totalRecords: records.length, promoted };
  }
});

/** One-shot migration: rewrite the legacy "exam" vet subcategory to
 *  "exams_diagnostics" on existing horseRecords (both the singular
 *  visitType and inside the visitTypes array). Idempotent; safe to
 *  re-run. Returns a count of records touched. */
export const migrateExamToExamsDiagnostics = mutation({
  args: {},
  handler: async (ctx) => {
    const records = await ctx.db.query("horseRecords").collect();
    let updated = 0;
    for (const r of records) {
      const patch: Record<string, unknown> = {};
      if (r.visitType === "exam") {
        patch.visitType = "exams_diagnostics";
      }
      if (Array.isArray(r.visitTypes) && r.visitTypes.includes("exam")) {
        const replaced = r.visitTypes.map((t) => (t === "exam" ? "exams_diagnostics" : t));
        // Dedupe in case the record already contained exams_diagnostics too
        patch.visitTypes = Array.from(new Set(replaced));
      }
      if (Object.keys(patch).length > 0) {
        await ctx.db.patch(r._id, patch as any);
        updated += 1;
      }
    }
    return { totalRecords: records.length, updated };
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
        contactName: row.contactName,
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

export const getByDateRange = query({
  args: { startTs: v.number(), endTs: v.number() },
  handler: async (ctx, args) => {
    const rows = await ctx.db.query("horseRecords").collect();
    const filtered = rows.filter((r) => {
      const inRange = r.date >= args.startTs && r.date <= args.endTs;
      const nextInRange = r.nextVisitDate && r.nextVisitDate >= args.startTs && r.nextVisitDate <= args.endTs;
      return inRange || nextInRange;
    });
    return await Promise.all(
      filtered.map(async (record) => {
        const horse = await ctx.db.get(record.horseId);
        return {
          ...record,
          contactName: record.contactName ?? (record as any).providerName,
          horseName: horse?.name || "Unknown",
        };
      })
    );
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
