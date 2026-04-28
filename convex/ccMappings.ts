/**
 * Static mappings from CC-statement descriptors to known contacts,
 * categories, and subcategories. Used by ccReconcile.ts when processing
 * CSV uploads to:
 *   1. Auto-link a transaction to an existing contact (and via that, to
 *      existing approved bills for the same contact + amount).
 *   2. Pre-fill category/subcategory on the transaction so the bill
 *      created from it lands in the right place without manual triage.
 *   3. Name the generated bill as "<Contact> — <Date>" (matching the
 *      PDF-upload format) instead of the raw CC description.
 *
 * To add a mapping: append a row with the raw CC descriptor (case-
 * insensitive substring match against the txn description), the
 * contact name as it appears in the contacts table, and optional
 * category/subcategory slugs (matching ALL_CATEGORY_OPTIONS and
 * SUBCATEGORY_OPTIONS in app/invoices/preview/[billId]/page.tsx).
 */

export type CcDescriptorMapping = {
  descriptor: string;
  contactName: string;
  category?: string;
  subcategory?: string;
};

export const CC_DESCRIPTOR_MAPPINGS: CcDescriptorMapping[] = [
  { descriptor: "AIRBNB", contactName: "Airbnb", category: "travel" },
  { descriptor: "AMERICAN AIR", contactName: "American Airlines", category: "travel", subcategory: "flights" },
  { descriptor: "BROOK LEDGE", contactName: "Brook Ledge", category: "horse-transport" },
  { descriptor: "CHEVRON", contactName: "Chevron", category: "travel", subcategory: "gas" },
  { descriptor: "EV EQUESTRIAN LLC", contactName: "EV Equestrian LLC" },
  { descriptor: "DA MOORS FEED", contactName: "DaMoor's", category: "feed-bedding" },
  { descriptor: "DELTA", contactName: "Delta Airlines", category: "travel", subcategory: "flights" },
  { descriptor: "DOCUSIGN", contactName: "Docusign", category: "admin", subcategory: "software-subscriptions" },
  { descriptor: "DOMESTIC INCOMING WIRE FEE", contactName: "Wire Fees", category: "admin", subcategory: "bank-fees" },
  { descriptor: "ENTERPRISE RENT-A-C", contactName: "Enterprise", category: "travel", subcategory: "rental-car" },
  { descriptor: "EQUESTRIAN SPORTS PRODU", contactName: "Wellington International", category: "show-expenses" },
  { descriptor: "EQUINE TACK & NUTRI", contactName: "Equine Tack & Nutritionals", category: "supplies" },
  { descriptor: "EXPEDIA", contactName: "Expedia", category: "travel" },
  { descriptor: "FARMVETCOM", contactName: "FarmVet", category: "supplies" },
  { descriptor: "FOREIGN EXCHANGE RATE ADJUSTMENT FEE", contactName: "Foreign Exchange Fee", category: "admin", subcategory: "bank-fees" },
  { descriptor: "FURLONG MWB EQUINE VET", contactName: "B.W. Furlong & Associates", category: "veterinary" },
  { descriptor: "HERTZ", contactName: "Hertz", category: "travel", subcategory: "rental-car" },
  { descriptor: "1000870757 ONTARIO", contactName: "Fred Michelon", category: "bodywork" },
  { descriptor: "HORSESHOEING BY ST", contactName: "Steve Lorenzo", category: "farrier" },
  { descriptor: "LA PRADERA HAY", contactName: "La Pradera Hay and Feed", category: "feed-bedding" },
  { descriptor: "LORENZO EQUINE SPE", contactName: "Steve Lorenzo", category: "supplies", subcategory: "grooming" },
  { descriptor: "O'REILLY FARRIER", contactName: "O'Reilly Farrier Services Inc.", category: "farrier" },
  { descriptor: "JETBLUE", contactName: "Jetblue", category: "travel", subcategory: "flights" },
  { descriptor: "LOWE'S", contactName: "Lowe's", category: "supplies", subcategory: "stable" },
  { descriptor: "LS CALABASAS SADDLER", contactName: "Calabasas Saddlery", category: "supplies", subcategory: "grooming" },
  { descriptor: "Deel, Inc", contactName: "Deel", category: "grooming" },
  { descriptor: "PLATINUM PERFORMANCE", contactName: "Platinum Performance", category: "feed-bedding", subcategory: "supplements" },
  { descriptor: "GRAND PRIX FEED", contactName: "Grand Prix Feed", category: "feed-bedding" },
  { descriptor: "SIXT", contactName: "Sixt", category: "travel", subcategory: "rental-car" },
  { descriptor: "SP HORSEPLAY", contactName: "Horseplay", category: "supplies" },
  { descriptor: "GOLD COAST FEED", contactName: "Gold Coast Feed", category: "feed-bedding" },
  { descriptor: "TACKERIA", contactName: "Tackeria", category: "supplies" },
  { descriptor: "THUNDERBIRD SHOW PARK", contactName: "Thunderbird", category: "show-expenses" },
  { descriptor: "UBER", contactName: "Uber", category: "travel" },
  { descriptor: "UNITED STATES EQUESTRI", contactName: "USEF", category: "dues-registrations" },
];

/** Match a CC description against the descriptor table. Returns the
 *  mapping with the longest matching descriptor (most specific wins),
 *  or null if no descriptor is contained in the description. */
export function findStaticMapping(description: string): CcDescriptorMapping | null {
  const upper = (description ?? "").toUpperCase();
  if (!upper) return null;
  let best: CcDescriptorMapping | null = null;
  for (const mapping of CC_DESCRIPTOR_MAPPINGS) {
    const needle = mapping.descriptor.toUpperCase().trim();
    if (!needle || !upper.includes(needle)) continue;
    if (!best || mapping.descriptor.length > best.descriptor.length) {
      best = mapping;
    }
  }
  return best;
}

/** Format a bill name as "<Contact> — <Date>", matching the PDF-upload
 *  invoice-name format from lib/formatInvoiceName.ts. Convex-side
 *  duplicate (no shared lib import) so it's available in mutations. */
export function formatCcBillName(contactName: string, postingDate: string): string {
  const date = new Date(postingDate);
  if (Number.isNaN(date.getTime())) return contactName;
  // toLocaleDateString in Node defaults to system locale; force en-US.
  const formatted = date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
  return `${contactName} — ${formatted}`;
}
