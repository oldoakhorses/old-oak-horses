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

/** Update a transaction's match */
export const updateTransactionMatch = mutation({
  args: {
    transactionId: v.id("ccTransactions"),
    matchedBillId: v.optional(v.id("bills")),
    matchedBillName: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.transactionId, {
      matchedBillId: args.matchedBillId,
      matchedBillName: args.matchedBillName,
      matchConfidence: args.matchedBillId ? "high" : "none",
    });
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

/** Approve a transaction — this is the gate before it hits horse profiles */
export const approveTransaction = mutation({
  args: {
    transactionId: v.id("ccTransactions"),
    approved: v.boolean(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.transactionId, {
      isApproved: args.approved,
      approvedAt: args.approved ? Date.now() : undefined,
    });
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
        await ctx.db.patch(txn._id, { isApproved: true, approvedAt: Date.now() });
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
    return bills
      .filter((b) => b.status === "done" && b.isApproved)
      .map((b) => {
        const extracted = (b.extractedData ?? {}) as Record<string, unknown>;
        const total = typeof extracted.total === "number" ? extracted.total
          : typeof extracted.invoice_total_usd === "number" ? extracted.invoice_total_usd
          : typeof extracted.invoiceTotalUsd === "number" ? extracted.invoiceTotalUsd
          : 0;
        return {
          _id: b._id,
          fileName: b.fileName,
          amount: round2(Math.abs(total)),
          providerName: String(extracted.provider_name ?? extracted.providerName ?? ""),
          billingPeriod: b.billingPeriod,
        };
      })
      .sort((a, b) => b.billingPeriod.localeCompare(a.billingPeriod) || a.fileName.localeCompare(b.fileName));
  },
});
