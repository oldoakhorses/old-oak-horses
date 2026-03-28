import { mutation } from "../_generated/server";

export const migrate = mutation({
  args: {},
  handler: async (ctx) => {
    const records = await ctx.db.query("horseRecords").collect();
    let migrated = 0;

    for (const record of records) {
      const nextVisitDate = (record as any).nextVisitDate as number | undefined;
      if (nextVisitDate) {
        const upcomingId = await ctx.db.insert("horseRecords", {
          horseId: record.horseId,
          type: record.type,
          date: nextVisitDate,
          providerName: record.providerName,
          isUpcoming: true,
          linkedRecordId: record._id,
        });

        await ctx.db.patch(record._id, {
          isUpcoming: false,
          linkedRecordId: upcomingId,
          nextVisitDate: undefined,
        });

        migrated++;
      }
    }

    return { migrated };
  },
});
