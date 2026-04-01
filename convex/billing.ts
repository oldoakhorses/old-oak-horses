import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";

// ── helpers ──────────────────────────────────────────────────────────────
function getLineItems(extracted: Record<string, unknown>): Record<string, unknown>[] {
  const items = extracted.line_items ?? extracted.lineItems;
  return Array.isArray(items) ? (items as Record<string, unknown>[]) : [];
}

function numVal(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") { const n = Number(v); if (Number.isFinite(n)) return n; }
  return 0;
}

function lineItemAmount(item: Record<string, unknown>): number {
  return numVal(item.total_usd ?? item.amount_usd ?? item.total ?? item.amount ?? 0);
}

function round2(n: number) { return Math.round(n * 100) / 100; }

/** Check if a bill's billing period falls within a date range (YYYY-MM-DD strings) */
function billInDateRange(bill: { billingPeriod?: string; extractedData?: unknown; uploadedAt: number }, startDate?: string, endDate?: string): boolean {
  if (!startDate && !endDate) return true;
  // Try to get invoice date from extracted data
  const extracted = (bill.extractedData ?? {}) as Record<string, unknown>;
  const invoiceDateStr = String(extracted.invoice_date ?? extracted.invoiceDate ?? "").trim();
  // Parse the invoice date or fall back to billingPeriod or uploadedAt
  let dateStr = "";
  if (invoiceDateStr) {
    // Normalize common date formats to YYYY-MM-DD
    const parsed = new Date(invoiceDateStr);
    if (!isNaN(parsed.getTime())) {
      dateStr = parsed.toISOString().slice(0, 10);
    }
  }
  if (!dateStr && bill.billingPeriod) {
    // billingPeriod is "YYYY-MM", treat as first of month
    dateStr = `${bill.billingPeriod}-01`;
  }
  if (!dateStr) {
    dateStr = new Date(bill.uploadedAt).toISOString().slice(0, 10);
  }
  if (startDate && dateStr < startDate) return false;
  if (endDate && dateStr > endDate) return false;
  return true;
}

// ── queries ──────────────────────────────────────────────────────────────
export const listOwnerInvoices = query({
  args: { billingPeriod: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const all = await ctx.db.query("ownerInvoices").collect();
    const filtered = args.billingPeriod
      ? all.filter((inv) => inv.billingPeriod === args.billingPeriod)
      : all;

    const owners = await ctx.db.query("owners").collect();
    const ownerMap = new Map(owners.map((o) => [String(o._id), o]));

    return filtered
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((inv) => ({
        ...inv,
        ownerName: ownerMap.get(String(inv.ownerId))?.name ?? "Unknown",
      }));
  },
});

export const getOwnerInvoice = query({
  args: { ownerInvoiceId: v.id("ownerInvoices") },
  handler: async (ctx, args) => {
    const inv = await ctx.db.get(args.ownerInvoiceId);
    if (!inv) return null;

    const owner = await ctx.db.get(inv.ownerId);
    const lineItems = await ctx.db
      .query("ownerInvoiceLineItems")
      .withIndex("by_owner_invoice", (q) => q.eq("ownerInvoiceId", args.ownerInvoiceId))
      .collect();

    // Resolve source bill info for each line item
    const billIds = [...new Set(lineItems.map((i) => String(i.sourceBillId)))];
    const billMap = new Map<string, { fileName: string; billId: string; invoiceDate?: string; providerName?: string }>();
    for (const billIdStr of billIds) {
      const bill = await ctx.db.get(billIdStr as Id<"bills">);
      if (bill) {
        const extracted = (bill.extractedData ?? {}) as Record<string, unknown>;
        const invoiceDate = (extracted.invoice_date ?? extracted.invoiceDate ?? "") as string;
        const providerName = (extracted.provider_name ?? extracted.providerName ?? "") as string;
        billMap.set(billIdStr, {
          fileName: bill.fileName,
          billId: billIdStr,
          invoiceDate,
          providerName,
        });
      }
    }

    // Group by horse, then by source bill within each horse
    const byHorse = new Map<string, {
      horseName: string;
      horseId: string | null;
      byBill: Map<string, {
        billId: string;
        fileName: string;
        invoiceDate: string;
        providerName: string;
        items: typeof lineItems;
        total: number;
        approvedCount: number;
      }>;
      total: number;
    }>();

    for (const item of lineItems) {
      const horseKey = item.horseId ? String(item.horseId) : "__general__";
      const group = byHorse.get(horseKey) ?? {
        horseName: item.horseName ?? "General / Shared",
        horseId: item.horseId ? String(item.horseId) : null,
        byBill: new Map(),
        total: 0,
      };

      const billKey = String(item.sourceBillId);
      const billInfo = billMap.get(billKey);
      const billGroup = group.byBill.get(billKey) ?? {
        billId: billKey,
        fileName: billInfo?.fileName ?? "Unknown Invoice",
        invoiceDate: billInfo?.invoiceDate ?? "",
        providerName: billInfo?.providerName ?? "",
        items: [],
        total: 0,
        approvedCount: 0,
      };
      billGroup.items.push(item);
      billGroup.total += item.amount;
      if (item.isApproved) billGroup.approvedCount++;
      group.byBill.set(billKey, billGroup);
      group.total += item.amount;
      byHorse.set(horseKey, group);
    }

    const byHorseArr = [...byHorse.values()]
      .map((g) => ({
        horseName: g.horseName,
        horseId: g.horseId,
        total: round2(g.total),
        bills: [...g.byBill.values()]
          .map((b) => ({ ...b, total: round2(b.total) }))
          .sort((a, b) => a.fileName.localeCompare(b.fileName)),
      }))
      .sort((a, b) => a.horseName.localeCompare(b.horseName));

    return {
      ...inv,
      ownerName: owner?.name ?? "Unknown",
      ownerEmail: owner?.email,
      lineItems: lineItems.sort((a, b) => (a.horseName ?? "").localeCompare(b.horseName ?? "") || a.description.localeCompare(b.description)),
      byHorse: byHorseArr,
    };
  },
});

export const getAvailablePeriods = query({
  handler: async (ctx) => {
    const bills = await ctx.db.query("bills").collect();
    const periods = new Set<string>();
    for (const bill of bills) {
      if (bill.status === "done" && bill.isApproved && bill.billingPeriod) {
        periods.add(bill.billingPeriod);
      }
    }
    return [...periods].sort().reverse();
  },
});

/** Preview what line items would be generated for a period, without creating anything */
export const previewBillingPeriod = query({
  args: {
    billingPeriod: v.optional(v.string()),
    startDate: v.optional(v.string()),
    endDate: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const owners = await ctx.db.query("owners").collect();
    const horses = await ctx.db.query("horses").collect();
    const horseOwner = new Map<string, Id<"owners">>();
    const horseNames = new Map<string, string>();
    for (const h of horses) {
      if (h.ownerId) horseOwner.set(String(h._id), h.ownerId);
      horseNames.set(String(h._id), h.name);
    }

    const bills = await ctx.db.query("bills").collect();
    const approvedBills = bills.filter((b) => {
      if (b.status !== "done" || !b.isApproved) return false;
      if (args.startDate || args.endDate) {
        return billInDateRange(b, args.startDate, args.endDate);
      }
      return args.billingPeriod ? b.billingPeriod === args.billingPeriod : false;
    });

    // Check which bills already have owner invoice line items
    const existingItems = await ctx.db.query("ownerInvoiceLineItems").collect();
    const existingBillIds = new Set(existingItems.map((i) => String(i.sourceBillId)));

    const ownerTotals = new Map<string, { ownerName: string; horseCount: number; lineItemCount: number; total: number; horses: Set<string>; alreadyBilled: boolean }>();

    for (const bill of approvedBills) {
      const alreadyBilled = existingBillIds.has(String(bill._id));
      const extracted = (bill.extractedData ?? {}) as Record<string, unknown>;
      const lineItems = getLineItems(extracted);

      // Get horse assignments for this bill
      const assigned = Array.isArray(bill.assignedHorses) ? bill.assignedHorses : [];
      const ha = Array.isArray(bill.horseAssignments) ? bill.horseAssignments : [];
      const splits = Array.isArray(bill.splitLineItems) ? bill.splitLineItems : [];

      if (assigned.length > 0) {
        for (const row of assigned) {
          const hId = String(row.horseId ?? "");
          const oId = horseOwner.get(hId);
          if (!oId) continue;
          const key = String(oId);
          const cur = ownerTotals.get(key) ?? { ownerName: owners.find((o) => String(o._id) === key)?.name ?? "?", horseCount: 0, lineItemCount: 0, total: 0, horses: new Set(), alreadyBilled: false };
          cur.total += typeof row.amount === "number" ? row.amount : 0;
          cur.lineItemCount += 1;
          cur.horses.add(hId);
          if (alreadyBilled) cur.alreadyBilled = true;
          ownerTotals.set(key, cur);
        }
      } else {
        // Use horseAssignments + line items
        for (const row of ha) {
          const hId = String(row.horseId ?? "");
          const oId = horseOwner.get(hId);
          if (!oId) continue;
          const key = String(oId);
          const item = lineItems[row.lineItemIndex] as Record<string, unknown> | undefined;
          const amt = item ? lineItemAmount(item) : 0;
          // Check for splits on this line item
          const split = splits.find((s) => s.lineItemIndex === row.lineItemIndex);
          const finalAmt = split
            ? (split.splits.find((sp) => String(sp.horseId) === hId)?.amount ?? amt)
            : amt;
          const cur = ownerTotals.get(key) ?? { ownerName: owners.find((o) => String(o._id) === key)?.name ?? "?", horseCount: 0, lineItemCount: 0, total: 0, horses: new Set(), alreadyBilled: false };
          cur.total += finalAmt;
          cur.lineItemCount += 1;
          cur.horses.add(hId);
          if (alreadyBilled) cur.alreadyBilled = true;
          ownerTotals.set(key, cur);
        }
      }
    }

    return [...ownerTotals.entries()]
      .map(([ownerId, data]) => ({
        ownerId,
        ownerName: data.ownerName,
        horseCount: data.horses.size,
        lineItemCount: data.lineItemCount,
        total: round2(data.total),
        alreadyBilled: data.alreadyBilled,
      }))
      .sort((a, b) => a.ownerName.localeCompare(b.ownerName));
  },
});

// ── mutations ────────────────────────────────────────────────────────────
/** Generate owner invoices for a billing period */
export const generateOwnerInvoices = mutation({
  args: {
    billingPeriod: v.string(),
    startDate: v.optional(v.string()),
    endDate: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const owners = await ctx.db.query("owners").collect();
    const horses = await ctx.db.query("horses").collect();
    const horseOwner = new Map<string, Id<"owners">>();
    const horseNames = new Map<string, string>();
    for (const h of horses) {
      if (h.ownerId) horseOwner.set(String(h._id), h.ownerId);
      horseNames.set(String(h._id), h.name);
    }

    const bills = await ctx.db.query("bills").collect();
    const approvedBills = bills.filter((b) => {
      if (b.status !== "done" || !b.isApproved) return false;
      if (args.startDate || args.endDate) {
        return billInDateRange(b, args.startDate, args.endDate);
      }
      return b.billingPeriod === args.billingPeriod;
    });

    // Check existing — skip bills already billed
    const existingItems = await ctx.db.query("ownerInvoiceLineItems").collect();
    const existingBillIds = new Set(existingItems.map((i) => String(i.sourceBillId)));

    // Build line items per owner
    type PendingItem = {
      sourceBillId: Id<"bills">;
      horseId?: Id<"horses">;
      horseName?: string;
      description: string;
      category?: string;
      subcategory?: string;
      amount: number;
      sourceLineItemIndex?: number;
    };

    const ownerItems = new Map<string, PendingItem[]>();

    for (const bill of approvedBills) {
      if (existingBillIds.has(String(bill._id))) continue;

      const extracted = (bill.extractedData ?? {}) as Record<string, unknown>;
      const lineItems = getLineItems(extracted);
      const assigned = Array.isArray(bill.assignedHorses) ? bill.assignedHorses : [];
      const ha = Array.isArray(bill.horseAssignments) ? bill.horseAssignments : [];
      const splits = Array.isArray(bill.splitLineItems) ? bill.splitLineItems : [];

      // Pre-compute how many horses share each lineItemIndex (for equal-split fallback)
      const horsesPerIdx = new Map<number, number>();
      for (const h of ha) {
        horsesPerIdx.set(h.lineItemIndex, (horsesPerIdx.get(h.lineItemIndex) ?? 0) + 1);
      }

      if (assigned.length > 0) {
        // Simple assignment mode — one entry per assigned horse
        for (const row of assigned) {
          const hId = row.horseId;
          const oId = horseOwner.get(String(hId));
          if (!oId) continue;
          const key = String(oId);
          const items = ownerItems.get(key) ?? [];

          // Find line items for this horse to get descriptions
          const horseLineIdxs = ha.filter((h) => String(h.horseId) === String(hId)).map((h) => h.lineItemIndex);
          if (horseLineIdxs.length > 0) {
            for (const idx of horseLineIdxs) {
              const li = lineItems[idx] as Record<string, unknown> | undefined;
              const split = splits.find((s) => s.lineItemIndex === idx);
              const splitAmount = split?.splits.find((sp) => String(sp.horseId) === String(hId))?.amount;
              // If no explicit split but multiple horses share this line item, divide equally
              const shareCount = horsesPerIdx.get(idx) ?? 1;
              const fallbackAmount = shareCount > 1
                ? lineItemAmount(li ?? {}) / shareCount
                : lineItemAmount(li ?? {});
              items.push({
                sourceBillId: bill._id,
                horseId: hId,
                horseName: row.horseName,
                description: String(li?.description ?? bill.fileName),
                category: typeof li?.category === "string" ? li.category : undefined,
                subcategory: typeof li?.subcategory === "string" ? li.subcategory : undefined,
                amount: round2(splitAmount ?? fallbackAmount),
                sourceLineItemIndex: idx,
              });
            }
          } else {
            // Whole-bill assignment
            items.push({
              sourceBillId: bill._id,
              horseId: hId,
              horseName: row.horseName,
              description: bill.fileName,
              category: undefined,
              amount: round2(typeof row.amount === "number" ? row.amount : 0),
            });
          }
          ownerItems.set(key, items);
        }
      } else if (ha.length > 0) {
        // Line-by-line assignment mode
        for (const row of ha) {
          const hId = row.horseId;
          if (!hId) continue;
          const oId = horseOwner.get(String(hId));
          if (!oId) continue;
          const key = String(oId);
          const items = ownerItems.get(key) ?? [];
          const li = lineItems[row.lineItemIndex] as Record<string, unknown> | undefined;
          const split = splits.find((s) => s.lineItemIndex === row.lineItemIndex);
          const splitAmount = split?.splits.find((sp) => String(sp.horseId) === String(hId))?.amount;
          // If no explicit split but multiple horses share this line item, divide equally
          const shareCount = horsesPerIdx.get(row.lineItemIndex) ?? 1;
          const fallbackAmount = shareCount > 1
            ? lineItemAmount(li ?? {}) / shareCount
            : lineItemAmount(li ?? {});
          items.push({
            sourceBillId: bill._id,
            horseId: hId,
            horseName: row.horseName ?? horseNames.get(String(hId)),
            description: String(li?.description ?? bill.fileName),
            category: typeof li?.category === "string" ? li.category : undefined,
            subcategory: typeof li?.subcategory === "string" ? li.subcategory : undefined,
            amount: round2(splitAmount ?? fallbackAmount),
            sourceLineItemIndex: row.lineItemIndex,
          });
          ownerItems.set(key, items);
        }
      }
    }

    // Create owner invoices
    let invoicesCreated = 0;
    let lineItemsCreated = 0;

    for (const [ownerIdStr, items] of ownerItems.entries()) {
      if (items.length === 0) continue;
      const ownerId = ownerIdStr as Id<"owners">;
      const totalAmount = round2(items.reduce((sum, i) => sum + i.amount, 0));

      const invId = await ctx.db.insert("ownerInvoices", {
        ownerId,
        billingPeriod: args.billingPeriod,
        status: "draft",
        totalAmount,
        approvedAmount: 0,
        lineItemCount: items.length,
        approvedLineItemCount: 0,
        notes: undefined,
        createdAt: Date.now(),
      });

      for (const item of items) {
        await ctx.db.insert("ownerInvoiceLineItems", {
          ownerInvoiceId: invId,
          sourceBillId: item.sourceBillId,
          horseId: item.horseId,
          horseName: item.horseName,
          description: item.description,
          category: item.category,
          subcategory: item.subcategory,
          amount: item.amount,
          sourceLineItemIndex: item.sourceLineItemIndex,
          isApproved: false,
          createdAt: Date.now(),
        });
        lineItemsCreated++;
      }
      invoicesCreated++;
    }

    return { invoicesCreated, lineItemsCreated };
  },
});

export const approveLineItem = mutation({
  args: { lineItemId: v.id("ownerInvoiceLineItems"), approved: v.boolean() },
  handler: async (ctx, args) => {
    const item = await ctx.db.get(args.lineItemId);
    if (!item) throw new Error("Line item not found");

    await ctx.db.patch(args.lineItemId, {
      isApproved: args.approved,
      approvedAt: args.approved ? Date.now() : undefined,
    });

    // Recalculate invoice totals
    const allItems = await ctx.db
      .query("ownerInvoiceLineItems")
      .withIndex("by_owner_invoice", (q) => q.eq("ownerInvoiceId", item.ownerInvoiceId))
      .collect();

    const approvedItems = allItems.filter((i) =>
      i._id === args.lineItemId ? args.approved : i.isApproved
    );

    await ctx.db.patch(item.ownerInvoiceId, {
      approvedAmount: round2(approvedItems.reduce((s, i) => s + i.amount, 0)),
      approvedLineItemCount: approvedItems.length,
    });
  },
});

export const approveAllLineItems = mutation({
  args: { ownerInvoiceId: v.id("ownerInvoices") },
  handler: async (ctx, args) => {
    const items = await ctx.db
      .query("ownerInvoiceLineItems")
      .withIndex("by_owner_invoice", (q) => q.eq("ownerInvoiceId", args.ownerInvoiceId))
      .collect();

    let total = 0;
    for (const item of items) {
      if (!item.isApproved) {
        await ctx.db.patch(item._id, { isApproved: true, approvedAt: Date.now() });
      }
      total += item.amount;
    }

    await ctx.db.patch(args.ownerInvoiceId, {
      approvedAmount: round2(total),
      approvedLineItemCount: items.length,
    });
  },
});

export const finalizeOwnerInvoice = mutation({
  args: { ownerInvoiceId: v.id("ownerInvoices") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.ownerInvoiceId, {
      status: "finalized",
      finalizedAt: Date.now(),
    });
  },
});

export const updateOwnerInvoiceStatus = mutation({
  args: {
    ownerInvoiceId: v.id("ownerInvoices"),
    status: v.union(v.literal("draft"), v.literal("finalized"), v.literal("sent"), v.literal("paid")),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.ownerInvoiceId, { status: args.status });
  },
});

export const deleteOwnerInvoice = mutation({
  args: { ownerInvoiceId: v.id("ownerInvoices") },
  handler: async (ctx, args) => {
    const items = await ctx.db
      .query("ownerInvoiceLineItems")
      .withIndex("by_owner_invoice", (q) => q.eq("ownerInvoiceId", args.ownerInvoiceId))
      .collect();
    for (const item of items) {
      await ctx.db.delete(item._id);
    }
    await ctx.db.delete(args.ownerInvoiceId);
  },
});
