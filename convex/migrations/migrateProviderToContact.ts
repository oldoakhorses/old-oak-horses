import { mutation } from "../_generated/server";

export const migrate = mutation({
  args: {},
  handler: async (ctx) => {
    let billsMigrated = 0;
    let recordsMigrated = 0;
    let eventsMigrated = 0;

    const bills = await ctx.db.query("bills").collect();
    for (const bill of bills) {
      const old = (bill as any).extractedProviderContact;
      if (old) {
        const newContact: Record<string, string> = {};
        if (old.providerName) newContact.vendorName = old.providerName;
        if (old.contactName) newContact.contactName = old.contactName;
        if (old.address) newContact.address = old.address;
        if (old.phone) newContact.phone = old.phone;
        if (old.email) newContact.email = old.email;
        if (old.website) newContact.website = old.website;
        if (old.accountNumber) newContact.accountNumber = old.accountNumber;
        await ctx.db.patch(bill._id, {
          extractedVendorContact: Object.keys(newContact).length > 0 ? newContact : undefined,
          extractedProviderContact: undefined,
        } as any);
        billsMigrated++;
      }
    }

    const records = await ctx.db.query("horseRecords").collect();
    for (const record of records) {
      const oldName = (record as any).providerName;
      if (oldName !== undefined) {
        const patch: Record<string, unknown> = { providerName: undefined };
        if (!record.contactName && oldName) {
          patch.contactName = oldName;
        }
        await ctx.db.patch(record._id, patch as any);
        recordsMigrated++;
      }
    }

    const events = await ctx.db.query("scheduleEvents").collect();
    for (const event of events) {
      const oldId = (event as any).providerId;
      const oldName = (event as any).providerName;
      if (oldId !== undefined || oldName !== undefined) {
        const patch: Record<string, unknown> = {
          providerId: undefined,
          providerName: undefined,
        };
        if (!event.contactId && oldId) patch.contactId = oldId;
        if (!event.contactName && oldName) patch.contactName = oldName;
        await ctx.db.patch(event._id, patch as any);
        eventsMigrated++;
      }
    }

    return { billsMigrated, recordsMigrated, eventsMigrated };
  },
});
