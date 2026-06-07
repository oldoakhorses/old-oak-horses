import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { findStaticMapping, formatCcBillName } from "./ccMappings";

// ── helpers ──────────────────────────────────────────────────────────────
function round2(n: number) { return Math.round(n * 100) / 100; }

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, " ").replace(/\s+/g, " ").trim();
}

/** Extract recognizable keywords from a CC description */
function extractKeywords(desc: string): string[] {
  const norm = normalize(desc);
  // Remove common noise words
  const noise = new Set(["debit", "credit", "orig", "co", "name", "id", "desc", "date", "entry",
    "descr", "sec", "web", "trace", "eed", "ind", "trn", "ccd", "ppd", "sale", "payment",
    "ach", "misc", "card", "the", "inc", "llc", "corp", "online", "transfer", "fee",
    "ca", "ny", "fl", "tx", "pa", "ky", "tn", "de", "wa", "se"]);
  return norm.split(" ").filter((w) => w.length > 2 && !noise.has(w));
}

/** Strip payment-processor noise and locations from a raw CC description. */
function cleanCcDescription(raw: string): string {
  let s = (raw ?? "").toString().trim();
  if (!s) return "";

  // Strip leading transaction-type prefixes
  s = s.replace(/^(ACH\s+(DEBIT|CREDIT)|POS\s+(DEBIT|PURCHASE)|DEBIT\s+PURCHASE|CHECKCARD|PURCHASE\s+AUTHORIZED\s+ON(\s+\d{2}\/\d{2})?|RECURRING\s+PAYMENT)\s*/i, "");

  // Strip payment processor prefixes: SQ *, TST*, SP *, PAYPAL *, IN *, PY *, PP *, SQU*, TSTT*
  s = s.replace(/^(SQ|SQU|TST|TSTT|SP|SPK|PAYPAL|PY|PP|IN|INT|VENMO|STRIPE|CASH\s+APP)\s*\*+\s*/i, "");

  // Special-case Amazon variants
  s = s.replace(/^(AMZN\s+Mktp(\s+US)?|AMAZON\.COM|AMAZON\s+MKTPLACE)\b.*$/i, "Amazon");
  s = s.replace(/^AMZN\s+DIGITAL.*$/i, "Amazon Digital");

  // Strip trailing " CC:" / " CC#" / " CC" tags
  s = s.replace(/\s+CC[:#]?\s*$/i, "");

  // Strip trailing long phone number patterns
  s = s.replace(/\s+\+?\d{3}[-.\s]?\d{3}[-.\s]?\d{4}.*$/, "");
  s = s.replace(/\s+\d{10,}.*$/, "");

  // Strip trailing store / transaction ref numbers (" #12345", " 12345", " No. 1234")
  s = s.replace(/\s+#\s*\d{3,}.*$/, "");
  s = s.replace(/\s+NO\.?\s*\d{3,}.*$/i, "");
  s = s.replace(/\s+\d{4,}\s*$/, "");

  // Strip trailing known cities (with optional state abbrev)
  const cities = [
    "WELLINGTON", "THERMAL", "OCALA", "LOS ANGELES", "MIAMI", "ORLANDO",
    "PALM BEACH", "WEST PALM BCH", "W PALM BCH", "LAKE WORTH", "LOXAHATCHEE",
    "BOCA RATON", "DEERFIELD BCH", "JUPITER", "TAMPA", "GAINESVILLE",
    "LEXINGTON", "LOUISVILLE", "SARATOGA", "SAN FRANCISCO", "NEW YORK",
    "TORONTO", "VANCOUVER", "MONTREAL", "LONDON", "PARIS", "AMSTERDAM"
  ];
  const cityRe = new RegExp(`\\s+(${cities.join("|")})(\\s+[A-Z]{2})?\\s*$`, "i");
  s = s.replace(cityRe, "");

  // Strip trailing US state codes / CA provinces
  s = s.replace(/\s+(AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY|ON|BC|QC|AB|MB|SK|NS|NB)\s*$/i, "");

  // Strip dangling truncated suffixes like " & S", " & T", " &"
  s = s.replace(/\s+&\s*[A-Z]?\s*$/i, "");
  // Strip trailing generic tokens we don't want in the name
  s = s.replace(/\s+(STORE|LLC|INC|CORP|CO|LTD|USA|US)\s*$/i, "");

  // Collapse whitespace
  s = s.replace(/\s+/g, " ").trim();

  return s;
}

function toTitleCase(s: string): string {
  if (!s) return s;
  const lowers = new Set(["and", "of", "the", "for", "in", "to", "a", "an", "at", "or", "on", "by"]);
  const words = s.toLowerCase().split(/\s+/);
  return words
    .map((w, i) => {
      if (i > 0 && lowers.has(w)) return w;
      // preserve ampersand and apostrophes
      return w.replace(/([a-z])([a-z']*)/i, (_m, first, rest) => first.toUpperCase() + rest);
    })
    .join(" ");
}

/** Find the best existing contact that matches a cleaned CC description.
 *  Requires ALL of the contact's name keywords to appear in the description. */
async function findBestContactMatch(ctx: any, cleanedDesc: string) {
  const descKeywords = extractKeywords(cleanedDesc);
  if (descKeywords.length === 0) return null;
  const descKeys = new Set(descKeywords);

  const contacts = await ctx.db.query("contacts").collect();
  let best: any = null;
  let bestScore = 0;
  for (const c of contacts) {
    const name = (c.name ?? "").toString();
    if (!name) continue;
    const contactKeywords = extractKeywords(name);
    if (contactKeywords.length === 0) continue;
    const allPresent = contactKeywords.every((k: string) => descKeys.has(k));
    if (!allPresent) continue;
    // Score = number of contact keywords matched (more specific wins)
    const score = contactKeywords.length;
    if (score > bestScore) {
      bestScore = score;
      best = c;
    }
  }
  return best;
}

/** Resolve the contact for a CC transaction. Tries (in order):
 *   1. Static descriptor mappings → look up contact by name
 *   2. Keyword-overlap match against existing contacts
 *   3. Cleaned + title-cased description (no contactId) */
async function resolveCcContact(
  ctx: any,
  rawDescription: string
): Promise<{ contactName: string; contactId?: Id<"contacts"> }> {
  // 1. Static mapping
  const mapping = findStaticMapping(rawDescription);
  if (mapping) {
    const contacts = await ctx.db.query("contacts").collect();
    const key = mapping.contactName.toLowerCase().trim();
    const direct = contacts.find((c: any) => (c.name ?? "").toLowerCase().trim() === key);
    return direct
      ? { contactName: direct.name, contactId: direct._id }
      : { contactName: mapping.contactName };
  }

  // 2. Keyword match against contacts
  const cleaned = cleanCcDescription(rawDescription);
  if (cleaned) {
    const match = await findBestContactMatch(ctx, cleaned);
    if (match) return { contactName: match.name, contactId: match._id };
    return { contactName: toTitleCase(cleaned) };
  }

  return { contactName: rawDescription };
}

// ── queries ──────────────────────────────────────────────────────────────
export const listStatements = query({
  handler: async (ctx) => {
    return await ctx.db.query("ccStatements").collect()
      .then((stmts) => stmts.sort((a, b) => b.uploadedAt - a.uploadedAt));
  },
});

export const getStatement = query({
  args: { statementId: v.id("ccStatements") },
  handler: async (ctx, args) => {
    const stmt = await ctx.db.get(args.statementId);
    if (!stmt) return null;

    const transactions = await ctx.db
      .query("ccTransactions")
      .withIndex("by_statement", (q) => q.eq("statementId", args.statementId))
      .collect();

    // Sort by date descending
    transactions.sort((a, b) => {
      const da = new Date(a.postingDate).getTime();
      const db = new Date(b.postingDate).getTime();
      return db - da;
    });

    const matched = transactions.filter((t) => t.matchedBillId);
    const unmatched = transactions.filter((t) => !t.matchedBillId && t.amount < 0);
    const credits = transactions.filter((t) => t.amount > 0);
    const approved = transactions.filter((t) => t.isApproved);
    const assigned = transactions.filter((t) => t.assignType);

    return {
      ...stmt,
      transactions,
      matchedCount: matched.length,
      unmatchedCount: unmatched.length,
      creditCount: credits.length,
      approvedCount: approved.length,
      assignedCount: assigned.length,
    };
  },
});

// ── mutations ────────────────────────────────────────────────────────────

/** Upload and parse a CSV statement, auto-match transactions to existing invoices */
export const uploadStatement = mutation({
  args: {
    fileName: v.string(),
    csvRows: v.array(v.object({
      details: v.string(),
      postingDate: v.string(),
      description: v.string(),
      amount: v.number(),
      type: v.string(),
      balance: v.optional(v.number()),
    })),
  },
  handler: async (ctx, args) => {
    // Extract last 4 from filename (e.g. Chase7227_Activity...)
    const acctMatch = args.fileName.match(/(\d{4})/);
    const accountLast4 = acctMatch ? acctMatch[1] : undefined;

    let totalDebits = 0;
    let totalCredits = 0;
    for (const row of args.csvRows) {
      if (row.amount < 0) totalDebits += Math.abs(row.amount);
      else totalCredits += row.amount;
    }

    const stmtId = await ctx.db.insert("ccStatements", {
      fileName: args.fileName,
      accountLast4,
      uploadedAt: Date.now(),
      transactionCount: args.csvRows.length,
      matchedCount: 0,
      unmatchedCount: args.csvRows.length,
      totalDebits: round2(totalDebits),
      totalCredits: round2(totalCredits),
      status: "matching",
    });

    // Load all approved bills for matching
    const bills = await ctx.db.query("bills").collect();
    const approvedBills = bills.filter((b) => b.status === "done" && b.isApproved);

    // Load contacts/providers for name matching
    const contacts = await ctx.db.query("contacts").collect();

    // Build matching index: amount -> bills, name keywords -> bills
    type BillRef = {
      id: Id<"bills">;
      fileName: string;
      amount: number;
      contactName: string;
      contactId?: Id<"contacts">;
      providerKeywords: string[];
    };

    const billRefs: BillRef[] = approvedBills.map((b) => {
      const extracted = (b.extractedData ?? {}) as Record<string, unknown>;
      const total = typeof extracted.total === "number" ? Math.abs(extracted.total)
        : typeof extracted.invoice_total_usd === "number" ? Math.abs(extracted.invoice_total_usd)
        : typeof extracted.invoiceTotalUsd === "number" ? Math.abs(extracted.invoiceTotalUsd)
        : 0;
      const pName = String(extracted.contact_name ?? extracted.contactName ?? b.fileName ?? "");

      // Also get contact/provider name
      let contactName = "";
      if (b.contactId) {
        const c = contacts.find((c) => String(c._id) === String(b.contactId));
        if (c) contactName = c.name;
      }

      const allNames = [pName, contactName, b.fileName].filter(Boolean).join(" ");
      return {
        id: b._id,
        fileName: b.fileName,
        amount: round2(total),
        contactName: pName || contactName,
        contactId: b.contactId,
        providerKeywords: extractKeywords(allNames),
      };
    });

    // Load learned rules for auto-suggesting assignments
    const learnedRules = await ctx.db.query("ccTransactionRules").collect();

    let matchedCount = 0;

    for (const row of args.csvRows) {
      const absAmount = round2(Math.abs(row.amount));
      const txnKeywords = extractKeywords(row.description);

      // Resolve any static descriptor mapping for this row (e.g., "AIRBNB" → Airbnb).
      // Used to (a) prefer same-contact bills during matching and
      // (b) pre-fill category/subcategory if no bill match is found.
      const staticMapping = findStaticMapping(row.description);
      const staticContact = staticMapping
        ? contacts.find(
            (c) => (c.name ?? "").toLowerCase().trim() === staticMapping.contactName.toLowerCase().trim()
          )
        : undefined;
      const staticContactId = staticContact?._id;

      // Try to find a matching bill
      let bestMatch: { billRef: BillRef; confidence: "exact" | "high" | "medium" | "low" } | null = null;

      for (const ref of billRefs) {
        // Amount match
        const amountDiff = Math.abs(ref.amount - absAmount);
        const amountMatch = amountDiff < 0.02; // exact match within 2 cents
        const closeAmount = amountDiff / Math.max(absAmount, 1) < 0.05; // within 5%

        // Static-mapping contact match: when the txn maps to a known contact and
        // this bill is for that same contact, that's a much stronger signal than
        // keyword overlap. Treat amountMatch+contactMatch as exact, closeAmount
        // +contactMatch as high.
        const contactMatch = staticContactId && ref.contactId
          ? String(ref.contactId) === String(staticContactId)
          : false;
        if (contactMatch && amountMatch) {
          bestMatch = { billRef: ref, confidence: "exact" };
          break;
        }
        if (contactMatch && closeAmount) {
          if (!bestMatch || bestMatch.confidence !== "exact") {
            bestMatch = { billRef: ref, confidence: "high" };
          }
          continue;
        }

        // Name/keyword match
        const commonKeywords = txnKeywords.filter((kw) =>
          ref.providerKeywords.some((pk) => pk.includes(kw) || kw.includes(pk))
        );
        const nameMatch = commonKeywords.length >= 1;
        const strongNameMatch = commonKeywords.length >= 2;

        if (amountMatch && strongNameMatch) {
          bestMatch = { billRef: ref, confidence: "exact" };
          break;
        } else if (amountMatch && nameMatch) {
          if (!bestMatch || bestMatch.confidence !== "exact") {
            bestMatch = { billRef: ref, confidence: "high" };
          }
        } else if (closeAmount && strongNameMatch) {
          if (!bestMatch || (bestMatch.confidence !== "exact" && bestMatch.confidence !== "high")) {
            bestMatch = { billRef: ref, confidence: "medium" };
          }
        } else if (nameMatch && !bestMatch) {
          bestMatch = { billRef: ref, confidence: "low" };
        }
      }

      // If no bill match, try learned rules
      let ruleMatch: typeof learnedRules[0] | null = null;
      if (!bestMatch && txnKeywords.length > 0) {
        let bestScore = 0;
        for (const rule of learnedRules) {
          const ruleKeySet = new Set(rule.descriptionKeywords);
          const overlap = txnKeywords.filter((kw) =>
            [...ruleKeySet].some((rk) => rk.includes(kw) || kw.includes(rk))
          ).length;
          // Require at least half the rule keywords to match, and at least 2 overlapping
          const matchRatio = overlap / rule.descriptionKeywords.length;
          if (overlap >= 2 && matchRatio >= 0.5 && overlap > bestScore) {
            bestScore = overlap;
            ruleMatch = rule;
          }
        }
      }

      const txnId = await ctx.db.insert("ccTransactions", {
        statementId: stmtId,
        postingDate: row.postingDate,
        description: row.description,
        amount: row.amount,
        type: row.type,
        balance: row.balance,
        matchedBillId: bestMatch ? bestMatch.billRef.id : undefined,
        matchedBillName: bestMatch ? bestMatch.billRef.fileName : undefined,
        matchConfidence: bestMatch ? bestMatch.confidence : "none",
        isApproved: false,
        // Apply learned rule as pre-populated suggestion (takes precedence over
        // static mapping because rules carry assignment info that mappings don't).
        ...(ruleMatch && !bestMatch ? {
          assignType: ruleMatch.assignType as any,
          assignedHorses: ruleMatch.assignType === "horse" && ruleMatch.assignedHorses
            ? ruleMatch.assignedHorses.map((h: any) => ({
                horseId: h.horseId,
                horseName: h.horseName,
                amount: round2(absAmount / ruleMatch!.assignedHorses!.length),
              }))
            : undefined,
          assignedPeople: ruleMatch.assignType === "person" && ruleMatch.assignedPeople
            ? ruleMatch.assignedPeople.map((p: any) => ({
                personId: p.personId,
                personName: p.personName,
                role: p.role,
                amount: round2(absAmount / ruleMatch!.assignedPeople!.length),
              }))
            : undefined,
          category: ruleMatch.category,
          subcategory: ruleMatch.subcategory,
        } : staticMapping && !bestMatch ? {
          // Pre-fill category/subcategory only — assignType requires user judgment
          // (which horse / person / business this expense should land on).
          category: staticMapping.category,
          subcategory: staticMapping.subcategory,
        } : {}),
      });

      // Increment rule usage count
      if (ruleMatch && !bestMatch) {
        await ctx.db.patch(ruleMatch._id, { timesApplied: ruleMatch.timesApplied + 1 });
      }

      if (bestMatch) matchedCount++;
    }

    // Update statement counts
    await ctx.db.patch(stmtId, {
      matchedCount,
      unmatchedCount: args.csvRows.length - matchedCount,
      status: "review",
    });

    return { statementId: stmtId, transactionCount: args.csvRows.length, matchedCount };
  },
});

/** Update a transaction's match — manual matches are always "exact" confidence.
 *  When matching to a bill, auto-carry-over the invoice's horse/person assignments and category. */
export const updateTransactionMatch = mutation({
  args: {
    transactionId: v.id("ccTransactions"),
    matchedBillId: v.optional(v.id("bills")),
    matchedBillName: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const patch: Record<string, unknown> = {
      matchedBillId: args.matchedBillId,
      matchedBillName: args.matchedBillName,
      matchConfidence: args.matchedBillId ? "exact" : "none",
    };

    // Auto-carry-over assignments from the matched invoice
    if (args.matchedBillId) {
      const bill = await ctx.db.get(args.matchedBillId);
      if (bill) {
        // Carry over category
        if (bill.categoryId) {
          const category = await ctx.db.get(bill.categoryId);
          if (category) {
            patch.category = category.slug;
          }
        }

        // Carry over horse assignments
        if (bill.assignedHorses && bill.assignedHorses.length > 0) {
          patch.assignType = "horse";
          patch.assignedHorses = bill.assignedHorses.map((h) => ({
            horseId: h.horseId,
            horseName: h.horseName,
            amount: h.amount,
          }));
        }
        // Carry over person assignments
        else if (bill.assignedPeople && bill.assignedPeople.length > 0) {
          const people = await ctx.db.query("people").collect();
          patch.assignType = "person";
          patch.assignedPeople = bill.assignedPeople.map((p) => {
            const person = people.find((pe) => String(pe._id) === String(p.personId));
            return {
              personId: p.personId,
              personName: person?.name ?? "Unknown",
              role: person?.role,
              amount: p.amount,
            };
          });
        }
      }
    } else {
      // Clearing match — also clear carried-over assignments
      patch.assignType = undefined;
      patch.assignedHorses = undefined;
      patch.assignedPeople = undefined;
      patch.category = undefined;
    }

    await ctx.db.patch(args.transactionId, patch);
  },
});

/** Assign a transaction to horses, people, or business */
export const assignTransaction = mutation({
  args: {
    transactionId: v.id("ccTransactions"),
    assignType: v.union(v.literal("horse"), v.literal("person"), v.literal("business"), v.literal("personal"), v.literal("ignore")),
    assignedHorses: v.optional(v.array(v.object({
      horseId: v.id("horses"),
      horseName: v.string(),
      amount: v.number(),
    }))),
    assignedPeople: v.optional(v.array(v.object({
      personId: v.id("people"),
      personName: v.string(),
      role: v.optional(v.string()),
      amount: v.number(),
    }))),
    category: v.optional(v.string()),
    subcategory: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const txn = await ctx.db.get(args.transactionId);
    if (!txn) throw new Error("Transaction not found");

    await ctx.db.patch(args.transactionId, {
      assignType: args.assignType,
      assignedHorses: args.assignedHorses,
      assignedPeople: args.assignedPeople,
      category: args.category,
      subcategory: args.subcategory,
    });

    // Save/update a learned rule from this manual assignment
    if (args.assignType !== "ignore") {
      await saveTransactionRule(ctx, txn.description, args);
    }
  },
});

/** After a transaction is approved, copy its assignment shape onto any
 *  other unapproved, still-unassigned transactions in the same statement
 *  whose descriptions share enough keywords. The split is recomputed for
 *  each sibling's own amount (even split across the picked entities).
 *
 *  Guards:
 *    - skip siblings that are already approved
 *    - skip siblings that already have an assignType set (never clobber
 *      the user's earlier work)
 *    - require at least 2 overlapping keywords AND >= 50% match ratio
 *      (same threshold uploadStatement uses for learned-rule matches) */
async function propagateApprovedAssignmentToSiblings(
  ctx: any,
  approved: {
    _id: Id<"ccTransactions">;
    statementId: Id<"ccStatements">;
    description: string;
    assignType?: string;
    assignedHorses?: { horseId: Id<"horses">; horseName: string; amount: number }[];
    assignedPeople?: { personId: Id<"people">; personName: string; role?: string; amount: number }[];
    category?: string;
    subcategory?: string;
  }
) {
  if (!approved.assignType || approved.assignType === "ignore") return;
  const keywords = extractKeywords(approved.description);
  if (keywords.length === 0) return;
  const keySet = new Set(keywords);

  const siblings = await ctx.db
    .query("ccTransactions")
    .withIndex("by_statement", (q: any) => q.eq("statementId", approved.statementId))
    .collect();

  for (const sib of siblings) {
    if (String(sib._id) === String(approved._id)) continue;
    if (sib.isApproved) continue;
    if (sib.assignType) continue; // preserve any prior manual assignment

    const sibKeywords = extractKeywords(sib.description);
    const overlap = sibKeywords.filter((k: string) => keySet.has(k)).length;
    const matchRatio = overlap / keywords.length;
    if (overlap < 2 || matchRatio < 0.5) continue;

    const absAmount = Math.abs(sib.amount);
    const patch: Record<string, unknown> = {
      assignType: approved.assignType,
      category: approved.category,
      subcategory: approved.subcategory,
    };
    if (approved.assignType === "horse" && approved.assignedHorses && approved.assignedHorses.length > 0) {
      const per = round2(absAmount / approved.assignedHorses.length);
      patch.assignedHorses = approved.assignedHorses.map((h) => ({
        horseId: h.horseId,
        horseName: h.horseName,
        amount: per,
      }));
    }
    if (approved.assignType === "person" && approved.assignedPeople && approved.assignedPeople.length > 0) {
      const per = round2(absAmount / approved.assignedPeople.length);
      patch.assignedPeople = approved.assignedPeople.map((p) => ({
        personId: p.personId,
        personName: p.personName,
        role: p.role,
        amount: per,
      }));
    }
    await ctx.db.patch(sib._id, patch as any);
  }
}

/** Save or update a learned rule from a manual transaction assignment */
async function saveTransactionRule(
  ctx: any,
  description: string,
  assignment: {
    assignType: "horse" | "person" | "business" | "personal" | "ignore";
    assignedHorses?: { horseId: Id<"horses">; horseName: string; amount: number }[];
    assignedPeople?: { personId: Id<"people">; personName: string; role?: string; amount: number }[];
    category?: string;
    subcategory?: string;
  }
) {
  const keywords = extractKeywords(description);
  if (keywords.length === 0) return;

  // Check for existing rule with same keywords (exact set match)
  const allRules = await ctx.db.query("ccTransactionRules").collect();
  const keySet = new Set(keywords);
  const existing = allRules.find((r: any) => {
    if (r.descriptionKeywords.length !== keywords.length) return false;
    return r.descriptionKeywords.every((k: string) => keySet.has(k));
  });

  const ruleData = {
    descriptionKeywords: keywords,
    originalDescription: description,
    assignType: assignment.assignType,
    assignedHorses: assignment.assignType === "horse" && assignment.assignedHorses
      ? assignment.assignedHorses.map((h) => ({ horseId: h.horseId, horseName: h.horseName }))
      : undefined,
    assignedPeople: assignment.assignType === "person" && assignment.assignedPeople
      ? assignment.assignedPeople.map((p) => ({ personId: p.personId, personName: p.personName, role: p.role }))
      : undefined,
    category: assignment.category,
    subcategory: assignment.subcategory,
    updatedAt: Date.now(),
  };

  if (existing) {
    await ctx.db.patch(existing._id, ruleData);
  } else {
    await ctx.db.insert("ccTransactionRules", {
      ...ruleData,
      timesApplied: 0,
      createdAt: Date.now(),
    });
  }
}

/** Create a bill from a CC transaction that has no matched invoice */
async function createBillFromTransaction(
  ctx: any,
  txn: {
    _id: Id<"ccTransactions">;
    description: string;
    amount: number;
    postingDate: string;
    assignType?: string;
    assignedHorses?: { horseId: Id<"horses">; horseName: string; amount: number }[];
    assignedPeople?: { personId: Id<"people">; personName: string; role?: string; amount: number }[];
    category?: string;
    subcategory?: string;
  }
): Promise<Id<"bills">> {
  // Look up categoryId from slug
  let categoryId: Id<"categories"> | undefined;
  if (txn.category) {
    const cats = await ctx.db.query("categories").collect();
    const match = cats.find((c: any) => c.slug === txn.category);
    if (match) categoryId = match._id;
  }

  const absAmount = Math.abs(txn.amount);
  const isCredit = txn.amount > 0;
  const billingPeriod = txn.postingDate.slice(0, 7); // "2026-03" from "2026-03-18"

  const hasHorses = txn.assignType === "horse" && txn.assignedHorses && txn.assignedHorses.length > 0;
  const hasPeople = txn.assignType === "person" && txn.assignedPeople && txn.assignedPeople.length > 0;
  const isWholeAssign = hasHorses || hasPeople;

  // Determine split mode: check if all amounts are equal (even) or differ (custom)
  let splitMode: "even" | "custom" | undefined;
  if (hasHorses && txn.assignedHorses!.length > 1) {
    const amounts = txn.assignedHorses!.map((h) => round2(h.amount));
    splitMode = amounts.every((a) => a === amounts[0]) ? "even" : "custom";
  } else if (hasPeople && txn.assignedPeople!.length > 1) {
    const amounts = txn.assignedPeople!.map((p) => round2(p.amount));
    splitMode = amounts.every((a) => a === amounts[0]) ? "even" : "custom";
  } else if (isWholeAssign) {
    splitMode = "even";
  }

  // Build line items with assignment data (same structure as PDF-approved bills)
  const lineItem: Record<string, unknown> = {
    description: txn.description,
    amount: absAmount,
    total_usd: absAmount,
    category: txn.category || undefined,
    subcategory: txn.subcategory || undefined,
    confirmed: true,
    confidence: "manual",
  };

  if (hasHorses) {
    const firstHorse = txn.assignedHorses![0];
    lineItem.assigneeType = "horse";
    lineItem.assigneeId = String(firstHorse.horseId);
    lineItem.assignee = String(firstHorse.horseId);
    lineItem.entityType = "horse";
    lineItem.entityId = String(firstHorse.horseId);
    lineItem.entityName = firstHorse.horseName;
    lineItem.matched_horse_id = String(firstHorse.horseId);
    lineItem.matchedHorseId = String(firstHorse.horseId);
    lineItem.horse_name = firstHorse.horseName;
    lineItem.horseName = firstHorse.horseName;
    lineItem.match_confidence = "manual";
    // Store all horse IDs for whole-invoice multi-horse split
    lineItem.horses = txn.assignedHorses!.map((h) => String(h.horseId));
  } else if (hasPeople) {
    const firstPerson = txn.assignedPeople![0];
    lineItem.assigneeType = "person";
    lineItem.assigneeId = String(firstPerson.personId);
    lineItem.assignee = String(firstPerson.personId);
    lineItem.entityType = "person";
    lineItem.entityId = String(firstPerson.personId);
    lineItem.entityName = firstPerson.personName;
    lineItem.people = txn.assignedPeople!.map((p) => String(p.personId));
  } else if (txn.assignType === "business") {
    lineItem.assigneeType = "business_general";
    lineItem.confirmed = true;
  }

  // Resolve contact (static mapping → contact lookup → keyword match → cleaned text)
  // and format the bill name as "<Contact> — <Date>" to match the PDF-upload format.
  const { contactName, contactId: matchedContactId } = await resolveCcContact(ctx, txn.description);
  const billName = matchedContactId || findStaticMapping(txn.description)
    ? formatCcBillName(contactName, txn.postingDate)
    : contactName;

  const billId = await ctx.db.insert("bills", {
    fileName: billName,
    invoiceName: billName,
    customProviderName: contactName,
    contactId: matchedContactId,
    status: "done" as const,
    billingPeriod,
    uploadedAt: Date.now(),
    isApproved: true,
    approvedAt: Date.now(),
    source: "cc_transaction" as const,
    ccTransactionId: txn._id,
    categoryId,
    assignMode: isWholeAssign ? ("whole" as const) : undefined,
    splitMode,
    extractedData: {
      invoice_total_usd: absAmount,
      invoice_date: txn.postingDate,
      contact_name: contactName,
      line_items: [lineItem],
      isCredit,
    },
    ...(txn.assignType === "horse" || txn.assignType === "person"
      ? { assignType: txn.assignType as "horse" | "person" }
      : {}),
    ...(hasHorses
      ? {
          assignedHorses: txn.assignedHorses!.map((h) => ({
            horseId: h.horseId,
            horseName: h.horseName,
            amount: h.amount,
            direct: h.amount,
            shared: 0,
          })),
        }
      : {}),
    ...(hasPeople
      ? {
          assignedPeople: txn.assignedPeople!.map((p) => ({
            personId: p.personId,
            personName: p.personName,
            amount: p.amount,
          })),
        }
      : {}),
    ...(txn.category ? { lineItemCategories: [txn.category] } : {}),
    ...(txn.subcategory
      ? (() => {
          const slug = txn.category;
          if (slug === "travel") return { travelSubcategory: txn.subcategory };
          if (slug === "housing") return { housingSubcategory: txn.subcategory };
          if (slug === "admin") return { adminSubcategory: txn.subcategory };
          if (slug === "marketing") return { marketingSubcategory: txn.subcategory };
          if (slug === "grooming") return { groomingSubcategory: txn.subcategory };
          if (slug === "dues-registrations") return { duesSubcategory: txn.subcategory };
          return {};
        })()
      : {}),
  });

  // Apply any learned vendor-rule overrides (e.g. invoiceName rename) so
  // newly-created CC bills land with the same display name and assignment
  // shape as previously-approved bills from the same vendor.
  try {
    await applyBillRuleAction(ctx, billId);
  } catch (err) {
    console.error("applyBillRule (from CC bill creation) failed", err);
  }

  return billId;
}

/** Calls the rule-application helper exported on bills.ts via internal API. */
async function applyBillRuleAction(ctx: any, billId: Id<"bills">) {
  // Inline the logic by reading the bill, looking up rule, patching fields.
  const bill = await ctx.db.get(billId);
  if (!bill) return;

  // Recompute the normalized key — must match bills.ts normalizeVendorKey.
  const vendor =
    bill?.extractedVendorContact?.vendorName ??
    bill?.extractedProviderContact?.providerName ??
    bill?.customProviderName ??
    bill?.invoiceName ??
    "";
  if (!vendor) return;
  let key = String(vendor).toLowerCase().replace(/[.,]/g, "").trim();
  for (let i = 0; i < 3; i++) {
    const next = key.replace(/\s+(?=[a-z0-9]*\d)(?=[a-z0-9]*[a-z])[a-z0-9]{6,}$/i, "").trim();
    if (next === key) break;
    key = next;
  }
  key = key.replace(/\s+(inc|llc|ltd|corp|co|company|gmbh|limited|sa|sas|ag)$/i, "").trim();
  if (!key) return;

  const rule = await ctx.db
    .query("billRules")
    .withIndex("by_vendorKey", (q: any) => q.eq("vendorKey", key))
    .first();
  if (!rule) return;

  const patch: Record<string, unknown> = {};
  if (rule.invoiceName) {
    // For CC bills, always apply the learned name (overwriting the
    // auto-generated "Zelle Payment to X" placeholder) since the rule
    // represents the user's preferred display name.
    patch.invoiceName = rule.invoiceName;
  }
  if (!bill.contactId && rule.contactId) {
    const contact = await ctx.db.get(rule.contactId);
    if (contact) patch.contactId = rule.contactId;
  }
  if (Object.keys(patch).length > 0) {
    await ctx.db.patch(billId, patch);
  }
}

/** Approve a transaction — this is the gate before it hits horse profiles */
export const approveTransaction = mutation({
  args: {
    transactionId: v.id("ccTransactions"),
    approved: v.boolean(),
  },
  handler: async (ctx, args) => {
    const txn = await ctx.db.get(args.transactionId);
    if (!txn) return;

    if (args.approved) {
      // Once an assigned txn is approved, treat its assignment as a
      // confirmed pattern and push the same suggestion onto any other
      // unapproved, still-unassigned txns in the same statement whose
      // descriptions share enough keywords.
      await propagateApprovedAssignmentToSiblings(ctx, txn as any);

      // Create a bill if there's no matched invoice and this isn't ignored
      if (!txn.matchedBillId && txn.assignType && txn.assignType !== "ignore") {
        // Check if bill already generated (re-approval case)
        if (txn.generatedBillId) {
          const existing = await ctx.db.get(txn.generatedBillId);
          if (existing) {
            // Bill already exists — skip creation
            await ctx.db.patch(args.transactionId, {
              isApproved: true,
              approvedAt: Date.now(),
            });
            return;
          }
        }
        const billId = await createBillFromTransaction(ctx, txn as any);
        await ctx.db.patch(args.transactionId, {
          isApproved: true,
          approvedAt: Date.now(),
          generatedBillId: billId,
        });
      } else {
        await ctx.db.patch(args.transactionId, {
          isApproved: true,
          approvedAt: Date.now(),
        });
      }
    } else {
      // Unapproving — delete generated bill if it exists
      if (txn.generatedBillId) {
        const bill = await ctx.db.get(txn.generatedBillId);
        if (bill) await ctx.db.delete(txn.generatedBillId);
        await ctx.db.patch(args.transactionId, {
          isApproved: false,
          approvedAt: undefined,
          generatedBillId: undefined,
        });
      } else {
        await ctx.db.patch(args.transactionId, {
          isApproved: false,
          approvedAt: undefined,
        });
      }
    }
  },
});

/** Approve all assigned transactions in a statement */
export const approveAllAssigned = mutation({
  args: { statementId: v.id("ccStatements") },
  handler: async (ctx, args) => {
    const txns = await ctx.db
      .query("ccTransactions")
      .withIndex("by_statement", (q) => q.eq("statementId", args.statementId))
      .collect();

    let count = 0;
    for (const txn of txns) {
      if ((txn.assignType || txn.matchedBillId) && !txn.isApproved) {
        // Create a bill for unmatched, non-ignored transactions
        if (!txn.matchedBillId && txn.assignType && txn.assignType !== "ignore" && !txn.generatedBillId) {
          const billId = await createBillFromTransaction(ctx, txn as any);
          await ctx.db.patch(txn._id, { isApproved: true, approvedAt: Date.now(), generatedBillId: billId });
        } else {
          await ctx.db.patch(txn._id, { isApproved: true, approvedAt: Date.now() });
        }
        count++;
      }
    }

    return { approvedCount: count };
  },
});

/** Finalize a statement — mark it as fully approved once all transactions are handled */
export const approveStatement = mutation({
  args: { statementId: v.id("ccStatements") },
  handler: async (ctx, args) => {
    const txns = await ctx.db
      .query("ccTransactions")
      .withIndex("by_statement", (q) => q.eq("statementId", args.statementId))
      .collect();

    // Check all transactions are approved
    const unapproved = txns.filter((t) => !t.isApproved);
    if (unapproved.length > 0) {
      throw new Error(`${unapproved.length} transactions still need approval`);
    }

    await ctx.db.patch(args.statementId, {
      status: "approved" as const,
    });

    return { transactionCount: txns.length };
  },
});

/** Rename a statement (sets/clears the displayName override) */
export const renameStatement = mutation({
  args: {
    statementId: v.id("ccStatements"),
    displayName: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const trimmed = args.displayName?.trim();
    await ctx.db.patch(args.statementId, {
      displayName: trimmed && trimmed.length > 0 ? trimmed : undefined,
    });
  },
});

/** Delete a statement and all its transactions */
export const deleteStatement = mutation({
  args: { statementId: v.id("ccStatements") },
  handler: async (ctx, args) => {
    const txns = await ctx.db
      .query("ccTransactions")
      .withIndex("by_statement", (q) => q.eq("statementId", args.statementId))
      .collect();
    for (const txn of txns) {
      await ctx.db.delete(txn._id);
    }
    await ctx.db.delete(args.statementId);
  },
});

/** Get list of approved bills for manual matching dropdown */
export const getMatchableBills = query({
  handler: async (ctx) => {
    const bills = await ctx.db.query("bills").collect();
    const contacts = await ctx.db.query("contacts").collect();
    const categories = await ctx.db.query("categories").collect();
    return bills
      .filter((b) => b.status === "done" && b.isApproved)
      .map((b) => {
        const extracted = (b.extractedData ?? {}) as Record<string, unknown>;
        const total = typeof extracted.total === "number" ? extracted.total
          : typeof extracted.invoice_total_usd === "number" ? extracted.invoice_total_usd
          : typeof extracted.invoiceTotalUsd === "number" ? extracted.invoiceTotalUsd
          : 0;
        const pName = String(extracted.contact_name ?? extracted.contactName ?? "");
        let contactName = "";
        if (b.contactId) {
          const c = contacts.find((c) => String(c._id) === String(b.contactId));
          if (c) contactName = c.name;
        }
        const invoiceDate = String(extracted.invoice_date ?? extracted.invoiceDate ?? "");
        const category = b.categoryId ? categories.find((c) => String(c._id) === String(b.categoryId)) : null;
        return {
          _id: b._id,
          fileName: b.fileName,
          amount: round2(Math.abs(total)),
          contactName: pName || contactName,
          providerKeywords: extractKeywords([pName, contactName, b.fileName].filter(Boolean).join(" ")),
          billingPeriod: b.billingPeriod,
          invoiceDate,
          categorySlug: category?.slug ?? "",
          hasHorseAssignments: (b.assignedHorses?.length ?? 0) > 0,
          hasPersonAssignments: (b.assignedPeople?.length ?? 0) > 0,
        };
      })
      .sort((a, b) => (b.billingPeriod ?? "").localeCompare(a.billingPeriod ?? "") || a.fileName.localeCompare(b.fileName));
  },
});

/**
 * One-shot restore for CC-reconcile bills whose extractedData got wiped
 * (bug: reassignBillProvider used to nuke extractedData even for bills
 * without a PDF, causing invoice_total_usd to disappear → $0 totals).
 *
 * For each CC-reconcile bill (source="cc_transaction") whose extractedData
 * is missing/empty, rebuild it from the source ccTransaction.
 */
export const restoreCcReconcileExtractedData = mutation({
  args: { billId: v.optional(v.id("bills")) },
  handler: async (ctx, args) => {
    const candidates = args.billId
      ? [await ctx.db.get(args.billId)].filter(Boolean)
      : await ctx.db
          .query("bills")
          .filter((q) => q.eq(q.field("source"), "cc_transaction"))
          .collect();

    const restored: Array<{ billId: Id<"bills">; total: number; description: string }> = [];

    for (const bill of candidates) {
      if (!bill) continue;
      const extracted = (bill.extractedData ?? {}) as Record<string, unknown>;
      const hasTotal = typeof extracted.invoice_total_usd === "number" && extracted.invoice_total_usd > 0;
      const lineItems = Array.isArray((extracted as any).line_items) ? (extracted as any).line_items : [];
      const hasLines = lineItems.length > 0;
      // Skip bills that already have valid data
      if (hasTotal && hasLines) continue;

      if (!bill.ccTransactionId) continue;
      const txn = await ctx.db.get(bill.ccTransactionId);
      if (!txn) continue;

      const absAmount = Math.abs(txn.amount);
      const hasHorses = txn.assignType === "horse" && (bill.assignedHorses?.length ?? 0) > 0;
      const hasPeople = txn.assignType === "person" && (bill.assignedPeople?.length ?? 0) > 0;

      const lineItem: Record<string, unknown> = {
        description: txn.description,
        amount: absAmount,
        total_usd: absAmount,
        category: txn.category || undefined,
        subcategory: txn.subcategory || undefined,
        confirmed: true,
        confidence: "manual",
      };

      if (hasHorses) {
        const firstHorse = bill.assignedHorses![0];
        lineItem.assigneeType = "horse";
        lineItem.assigneeId = String(firstHorse.horseId);
        lineItem.assignee = String(firstHorse.horseId);
        lineItem.entityType = "horse";
        lineItem.entityId = String(firstHorse.horseId);
        lineItem.entityName = firstHorse.horseName;
        lineItem.matched_horse_id = String(firstHorse.horseId);
        lineItem.matchedHorseId = String(firstHorse.horseId);
        lineItem.horse_name = firstHorse.horseName;
        lineItem.horseName = firstHorse.horseName;
        lineItem.match_confidence = "manual";
        lineItem.horses = bill.assignedHorses!.map((h: any) => String(h.horseId));
      } else if (hasPeople) {
        const firstPerson = bill.assignedPeople![0];
        lineItem.assigneeType = "person";
        lineItem.assigneeId = String(firstPerson.personId);
        lineItem.assignee = String(firstPerson.personId);
        lineItem.entityType = "person";
        lineItem.entityId = String(firstPerson.personId);
        lineItem.people = bill.assignedPeople!.map((p: any) => String(p.personId));
      } else if (txn.assignType === "business") {
        lineItem.assigneeType = "business_general";
      }

      const nextExtracted: Record<string, unknown> = {
        ...extracted,
        invoice_total_usd: absAmount,
        invoice_date: extracted.invoice_date ?? txn.postingDate,
        contact_name: extracted.contact_name ?? txn.description,
        line_items: [lineItem],
        isCredit: txn.amount > 0,
      };

      await ctx.db.patch(bill._id, {
        extractedData: nextExtracted,
        // If a previous reparse attempt left the bill in error/parsing state,
        // restore it to done since these were approved CC bills.
        status: "done" as const,
        errorMessage: undefined,
      });

      restored.push({ billId: bill._id, total: absAmount, description: txn.description });
    }

    return { restored, count: restored.length };
  },
});

/**
 * Clean up invoice display names on bills that came from CC statements.
 * Strips payment-processor prefixes, locations, and trailing noise from the raw
 * CC description, then attempts to match against an existing contact. If a
 * match is found, the contact's name is used and bill.contactId is linked.
 * Otherwise a title-cased cleaned version is stored.
 * Safe to re-run — only patches bills whose current name differs from the target.
 */
export const cleanCcBillNames = mutation({
  args: {},
  handler: async (ctx) => {
    const ccBills = await ctx.db
      .query("bills")
      .filter((q) => q.eq(q.field("source"), "cc_transaction"))
      .collect();

    let updated = 0;
    let matchedCount = 0;
    let skipped = 0;

    for (const bill of ccBills) {
      // Prefer the original ccTransaction description (most trustworthy source)
      let rawDescription: string | undefined;
      if (bill.ccTransactionId) {
        const txn = await ctx.db.get(bill.ccTransactionId);
        if (txn && typeof txn.description === "string") {
          rawDescription = txn.description;
        }
      }
      if (!rawDescription) {
        const extracted = (bill.extractedData ?? {}) as Record<string, unknown>;
        rawDescription =
          (typeof extracted.contact_name === "string" ? extracted.contact_name : undefined) ??
          bill.fileName ??
          bill.invoiceName;
      }
      if (!rawDescription) {
        skipped++;
        continue;
      }

      const { contactName, contactId: matchedContactId } = await resolveCcContact(ctx, rawDescription);
      if (!contactName) {
        skipped++;
        continue;
      }

      // Format as "<Contact> — <Date>" when we have a real contact match
      // (matching the PDF-upload format); otherwise leave as the cleaned text.
      const extracted = (bill.extractedData ?? {}) as Record<string, unknown>;
      const dateForName =
        (typeof extracted.invoice_date === "string" ? extracted.invoice_date : undefined) ??
        bill.billingPeriod ??
        new Date(bill.uploadedAt).toISOString().slice(0, 10);
      const knownContact = matchedContactId || findStaticMapping(rawDescription);
      const displayName = knownContact ? formatCcBillName(contactName, dateForName) : contactName;

      const currentDisplay = bill.invoiceName ?? bill.fileName ?? "";
      const sameName = currentDisplay === displayName;
      const sameContact = (bill.contactId ?? undefined) === (matchedContactId ?? undefined);
      if (sameName && sameContact) {
        skipped++;
        continue;
      }

      const updates: Record<string, unknown> = {
        fileName: displayName,
        invoiceName: displayName,
        customProviderName: contactName,
        extractedData: { ...extracted, contact_name: contactName },
      };
      if (matchedContactId && !bill.contactId) {
        updates.contactId = matchedContactId;
        matchedCount++;
      }

      await ctx.db.patch(bill._id, updates as any);
      updated++;
    }

    return { totalCcBills: ccBills.length, updated, matched: matchedCount, skipped };
  },
});

/**
 * Backfill `isCredit` flag on extractedData for CC-reconcile bills.
 * Reads the source ccTransaction.amount sign — positive = credit (money in).
 * Safe to re-run; only patches bills missing the flag.
 */
export const backfillCcCreditFlag = mutation({
  args: {},
  handler: async (ctx) => {
    const ccBills = await ctx.db
      .query("bills")
      .filter((q) => q.eq(q.field("source"), "cc_transaction"))
      .collect();

    let updated = 0;
    let credits = 0;
    for (const bill of ccBills) {
      if (!bill.ccTransactionId) continue;
      const extracted = (bill.extractedData ?? {}) as Record<string, unknown>;
      if (typeof extracted.isCredit === "boolean") continue;

      const txn = await ctx.db.get(bill.ccTransactionId);
      if (!txn) continue;

      const isCredit = txn.amount > 0;
      if (isCredit) credits++;
      await ctx.db.patch(bill._id, {
        extractedData: { ...extracted, isCredit },
      });
      updated++;
    }

    return { updated, credits };
  },
});
