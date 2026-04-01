import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";

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
    const providers = await ctx.db.query("providers").collect();

    // Build matching index: amount -> bills, name keywords -> bills
    type BillRef = {
      id: Id<"bills">;
      fileName: string;
      amount: number;
      providerName: string;
      providerKeywords: string[];
    };

    const billRefs: BillRef[] = approvedBills.map((b) => {
      const extracted = (b.extractedData ?? {}) as Record<string, unknown>;
      const total = typeof extracted.total === "number" ? Math.abs(extracted.total)
        : typeof extracted.invoice_total_usd === "number" ? Math.abs(extracted.invoice_total_usd)
        : typeof extracted.invoiceTotalUsd === "number" ? Math.abs(extracted.invoiceTotalUsd)
        : 0;
      const pName = String(extracted.provider_name ?? extracted.providerName ?? b.fileName ?? "");

      // Also get contact/provider name
      let contactName = "";
      if (b.contactId) {
        const c = contacts.find((c) => String(c._id) === String(b.contactId));
        if (c) contactName = c.name;
      }
      if (!contactName && b.providerId) {
        const p = providers.find((p) => String(p._id) === String(b.providerId));
        if (p) contactName = p.name;
      }

      const allNames = [pName, contactName, b.fileName].filter(Boolean).join(" ");
      return {
        id: b._id,
        fileName: b.fileName,
        amount: round2(total),
        providerName: pName || contactName,
        providerKeywords: extractKeywords(allNames),
      };
    });

    let matchedCount = 0;

    for (const row of args.csvRows) {
      const absAmount = round2(Math.abs(row.amount));
      const txnKeywords = extractKeywords(row.description);

      // Try to find a matching bill
      let bestMatch: { billRef: BillRef; confidence: "exact" | "high" | "medium" | "low" } | null = null;

      for (const ref of billRefs) {
        // Amount match
        const amountDiff = Math.abs(ref.amount - absAmount);
        const amountMatch = amountDiff < 0.02; // exact match within 2 cents
        const closeAmount = amountDiff / Math.max(absAmount, 1) < 0.05; // within 5%

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

      await ctx.db.insert("ccTransactions", {
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
      });

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
    await ctx.db.patch(args.transactionId, {
      assignType: args.assignType,
      assignedHorses: args.assignedHorses,
      assignedPeople: args.assignedPeople,
      category: args.category,
      subcategory: args.subcategory,
    });
  },
});

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
  const billingPeriod = txn.postingDate.slice(0, 7); // "2026-03" from "2026-03-18"

  const billId = await ctx.db.insert("bills", {
    fileName: txn.description,
    invoiceName: txn.description,
    customProviderName: txn.description,
    status: "done" as const,
    billingPeriod,
    uploadedAt: Date.now(),
    isApproved: true,
    approvedAt: Date.now(),
    source: "cc_transaction" as const,
    ccTransactionId: txn._id,
    categoryId,
    extractedData: {
      invoice_total_usd: absAmount,
      invoice_date: txn.postingDate,
      provider_name: txn.description,
    },
    ...(txn.assignType === "horse" || txn.assignType === "person"
      ? { assignType: txn.assignType as "horse" | "person" }
      : {}),
    ...(txn.assignType === "horse" && txn.assignedHorses
      ? {
          assignedHorses: txn.assignedHorses.map((h) => ({
            horseId: h.horseId,
            horseName: h.horseName,
            amount: h.amount,
            direct: h.amount,
            shared: 0,
          })),
        }
      : {}),
    ...(txn.assignType === "person" && txn.assignedPeople
      ? {
          assignedPeople: txn.assignedPeople.map((p) => ({
            personId: p.personId,
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

  return billId;
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
      if (txn.assignType && !txn.isApproved) {
        // Create a bill for unmatched, non-ignored transactions
        if (!txn.matchedBillId && txn.assignType !== "ignore" && !txn.generatedBillId) {
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
    const providers = await ctx.db.query("providers").collect();
    const categories = await ctx.db.query("categories").collect();
    return bills
      .filter((b) => b.status === "done" && b.isApproved)
      .map((b) => {
        const extracted = (b.extractedData ?? {}) as Record<string, unknown>;
        const total = typeof extracted.total === "number" ? extracted.total
          : typeof extracted.invoice_total_usd === "number" ? extracted.invoice_total_usd
          : typeof extracted.invoiceTotalUsd === "number" ? extracted.invoiceTotalUsd
          : 0;
        const pName = String(extracted.provider_name ?? extracted.providerName ?? "");
        let contactName = "";
        if (b.contactId) {
          const c = contacts.find((c) => String(c._id) === String(b.contactId));
          if (c) contactName = c.name;
        }
        if (!contactName && b.providerId) {
          const p = providers.find((p) => String(p._id) === String(b.providerId));
          if (p) contactName = p.name;
        }
        const invoiceDate = String(extracted.invoice_date ?? extracted.invoiceDate ?? "");
        const category = b.categoryId ? categories.find((c) => String(c._id) === String(b.categoryId)) : null;
        return {
          _id: b._id,
          fileName: b.fileName,
          amount: round2(Math.abs(total)),
          providerName: pName || contactName,
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
