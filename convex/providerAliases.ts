import { v } from "convex/values";
import { internalQuery, mutation } from "./_generated/server";

export const PROVIDER_ALIASES: Record<string, string> = {
  buthe: "Buthe Veterinary",
  "buthe vet": "Buthe Veterinary",
  "buthe veterinary": "Buthe Veterinary",
  "dr buthe": "Buthe Veterinary",
  "dr. buthe": "Buthe Veterinary",
  "sarah buthe": "Buthe Veterinary",

  "steve lorenzo": "Steve Lorenzo",
  "lorenzo farrier": "Steve Lorenzo",
  "tyler tablert": "Tyler Tablert",

  "fred michelon": "Fred Michelon",
  "fred michaelson": "Fred Michelon",
  "1000870757 ontario": "Fred Michelon",
  "1000870757 ontario limited": "Fred Michelon",

  pradera: "Pradera",
  "pradera equestrian": "Pradera",

  "brook ledge": "Brook Ledge",
  brookledge: "Brook Ledge",
  "brook ledge inc": "Brook Ledge",
  "brook ledge, inc.": "Brook Ledge",
  "brook ledge horse transport": "Brook Ledge",
  "stateside horse transportation": "Stateside Horse Transportation",
  "stateside farms": "Stateside Horse Transportation",
  stateside: "Stateside Horse Transportation",
  statesidefarms: "Stateside Horse Transportation",
  somnium: "Somnium Farm",
  "somnium farm": "Somnium Farm",

  farmvet: "FarmVet",
  "farm vet": "FarmVet",
  horseplay: "Horseplay",
  vdm: "VDM Mobile Tack",
  "vdm mobile": "VDM Mobile Tack",
  usef: "USEF",
  "united states equestrian federation": "USEF",
  "united states equestrian federation inc": "USEF",
  "usef payment services": "USEF",
  "eq sports medicine group": "EQ Sports Medicine Group",
  "eq sports": "EQ Sports Medicine Group",
  eqsportsmedicinegroup: "EQ Sports Medicine Group",
  "sports medicine group": "EQ Sports Medicine Group",
  "idexx neo": "EQ Sports Medicine Group",
};

export const saveAlias = mutation({
  args: {
    alias: v.string(),
    providerName: v.string(),
    providerId: v.id("providers"),
    category: v.string(),
  },
  handler: async (ctx, args) => {
    const normalizedAlias = args.alias.toLowerCase().trim();
    const existing = await ctx.db
      .query("providerAliases")
      .withIndex("by_alias", (q) => q.eq("alias", normalizedAlias))
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        providerName: args.providerName,
        providerId: args.providerId,
        category: args.category,
        updatedAt: Date.now(),
      });
      return existing._id;
    }

    return await ctx.db.insert("providerAliases", {
      alias: normalizedAlias,
      providerName: args.providerName,
      providerId: args.providerId,
      category: args.category,
      createdAt: Date.now(),
    });
  },
});

export const listAllAliasesInternal = internalQuery({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("providerAliases").collect();
  },
});
