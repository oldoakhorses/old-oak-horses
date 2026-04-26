/**
 * Static (code-level) aliases mapping normalized names from invoice text to
 * the canonical contact `name`. Complemented by rows in the `contactAliases`
 * DB table, which stores per-contact alias strings added at runtime.
 *
 * Keys must be lowercase + whitespace-collapsed (see normalizeContactName).
 */
export const CONTACT_ALIASES: Record<string, string> = {
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
