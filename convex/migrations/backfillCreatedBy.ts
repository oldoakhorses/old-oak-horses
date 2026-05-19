import { mutation } from "../_generated/server";

export const migrate = mutation({
  args: {},
  handler: async (ctx) => {
    const records = await ctx.db.query("horseRecords").collect();
    let recordCount = 0;
    for (const record of records) {
      if (!(record as any).createdBy) {
        await ctx.db.patch(record._id, { createdBy: "LDK" });
        recordCount++;
      }
    }

    const bills = await ctx.db.query("bills").collect();
    let billCount = 0;
    for (const bill of bills) {
      if (!(bill as any).createdBy) {
        await ctx.db.patch(bill._id, { createdBy: "LDK" } as any);
        billCount++;
      }
    }

    return { recordCount, billCount };
  },
});
