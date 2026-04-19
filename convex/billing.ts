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
    const billMap = new Map<string, { fileName: string; billId: string; invoiceName?: string; invoiceDate?: string; providerName?: string; category?: string; subcategory?: string; notes?: string }>();
    for (const billIdStr of billIds) {
      const bill = await ctx.db.get(billIdStr as Id<"bills">);
      if (bill) {
        const extracted = (bill.extractedData ?? {}) as Record<string, unknown>;
        const invoiceDate = (extracted.invoice_date ?? extracted.invoiceDate ?? "") as string;
        const providerName = (extracted.provider_name ?? extracted.providerName ?? "") as string;
        let categorySlug: string | undefined;
        if (bill.categoryId) {
          const cat = await ctx.db.get(bill.categoryId);
          if (cat) categorySlug = (cat as any).slug;
        }
        billMap.set(billIdStr, {
          fileName: bill.fileName,
          billId: billIdStr,
          invoiceName: typeof bill.invoiceName === "string" && bill.invoiceName.trim().length > 0 ? bill.invoiceName : undefined,
          invoiceDate,
          providerName,
          category: categorySlug,
          subcategory: (bill as any).travelSubcategory ?? (bill as any).housingSubcategory ?? (bill as any).adminSubcategory ?? (bill as any).marketingSubcategory ?? (bill as any).groomingSubcategory ?? (bill as any).duesSubcategory ?? undefined,
          notes: (bill as any).notes,
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
        invoiceName: string;
        invoiceDate: string;
        providerName: string;
        category: string;
        subcategory: string;
        notes: string;
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
        invoiceName: billInfo?.invoiceName ?? "",
        invoiceDate: billInfo?.invoiceDate ?? "",
        providerName: billInfo?.providerName ?? "",
        category: billInfo?.category ?? "",
        subcategory: billInfo?.subcategory ?? "",
        notes: billInfo?.notes ?? "",
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
      // Skip credit bills (deposits/money-in) — not charges to bill out
      if (extracted.isCredit === true) continue;
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
      // Skip credit bills (deposits/money-in) — not charges to bill out
      if (extracted.isCredit === true) continue;

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

    // ── Auto-matched line items: bills with no user-confirmed assignment but
    // the parser auto-detected a horse via matched_horse_id. Respect those
    // matches BEFORE falling through to "business general". Otherwise a bill
    // that was approved without the user explicitly confirming the detected
    // horse gets split evenly across the whole owner's herd, producing bogus
    // charges on the wrong owner's invoice (e.g. a Gaby de Courcel bodywork
    // invoice landing on every Old Oak Farm horse instead of Gaby alone).
    for (const bill of approvedBills) {
      if (existingBillIds.has(String(bill._id))) continue;
      const extracted = (bill.extractedData ?? {}) as Record<string, unknown>;
      if (extracted.isCredit === true) continue;
      if (Array.isArray(bill.assignedHorses) && bill.assignedHorses.length > 0) continue;
      if (Array.isArray(bill.horseAssignments) && (bill.horseAssignments as any[]).length > 0) continue;
      if (Array.isArray(bill.assignedPeople) && bill.assignedPeople.length > 0) continue;
      const lineItems = getLineItems(extracted);
      const hasAutoMatches = lineItems.some((li) => {
        const m = (li as any).matched_horse_id ?? (li as any).matchedHorseId;
        return typeof m === "string" && m.length > 0;
      });
      if (!hasAutoMatches) continue;
      // Emit one pending item per line-item-with-match, routed to the matched
      // horse's owner. Items without a match on this bill are skipped here
      // (they will fall into the business-general bucket below only if the
      // filter still includes this bill — we mark this bill as handled to
      // prevent double-billing).
      for (let idx = 0; idx < lineItems.length; idx++) {
        const li = lineItems[idx] as Record<string, unknown>;
        const matchedHorseId = ((li as any).matched_horse_id ?? (li as any).matchedHorseId) as string | undefined;
        if (!matchedHorseId) continue;
        const ownerId = horseOwner.get(String(matchedHorseId));
        if (!ownerId) continue;
        const amount = lineItemAmount(li);
        if (amount === 0) continue;
        const key = String(ownerId);
        const items = ownerItems.get(key) ?? [];
        items.push({
          sourceBillId: bill._id,
          horseId: matchedHorseId as Id<"horses">,
          horseName: horseNames.get(String(matchedHorseId)),
          description: String(li.description ?? bill.fileName),
          category: typeof li.category === "string" ? li.category : undefined,
          subcategory: typeof li.subcategory === "string" ? li.subcategory : undefined,
          amount: round2(amount),
          sourceLineItemIndex: idx,
        });
        ownerItems.set(key, items);
      }
      // Mark this bill as handled so it doesn't fall into business general.
      existingBillIds.add(String(bill._id));
    }

    // ── Business General charges: split evenly across ALL active horses ──
    // Find bills that are business_general (no horse assignment, assignType not horse/person)
    // Exclude credit bills (deposits/money-in) — they are not charges to bill out
    const businessGeneralBills = approvedBills.filter((b) => {
      if (existingBillIds.has(String(b._id))) return false;
      // Skip credit bills (money coming in)
      const ext = (b.extractedData ?? {}) as Record<string, unknown>;
      if (ext.isCredit === true) return false;
      // Already processed above as horse-assigned
      if (Array.isArray(b.assignedHorses) && b.assignedHorses.length > 0) return false;
      if (Array.isArray(b.horseAssignments) && (b.horseAssignments as any[]).length > 0) return false;
      // Check if it's a business or business_general bill
      const lineItems = Array.isArray(ext.line_items) ? ext.line_items as any[] : [];
      const isBusiness = (b as any).assignType === "business"
        || (!b.assignedPeople || b.assignedPeople.length === 0)
          && lineItems.some((li: any) => li.assigneeType === "business_general");
      // Also include bills with no assignment at all (unassigned approved bills count as business)
      const hasNoAssignment = !(b as any).assignType
        && (!b.assignedPeople || b.assignedPeople.length === 0);
      return isBusiness || hasNoAssignment;
    });

    if (businessGeneralBills.length > 0) {
      // Build map: ownerId -> active horse list
      // A horse counts as "active at bill time" if it is currently active OR
      // if it became inactive after the bill was uploaded (inactiveSince > bill.uploadedAt).
      const ownerHorses = new Map<string, Array<{ id: Id<"horses">; name: string }>>();
      // Collect ALL active horses (across all owners) for the denominator
      const allActiveHorses: Array<{ id: Id<"horses">; name: string; ownerId: string }> = [];
      for (const h of horses) {
        if (!h.ownerId || h.isSold) continue;
        // Horse is eligible if currently active, or became inactive after
        // the billing period started (i.e. was still active when bills were uploaded)
        const isCurrentlyActive = h.status === "active";
        const wasActiveInPeriod = h.inactiveSince
          ? h.inactiveSince >= (new Date(args.billingPeriod + "-01").getTime())
          : false;
        if (!isCurrentlyActive && !wasActiveInPeriod) continue;
        const key = String(h.ownerId);
        const list = ownerHorses.get(key) ?? [];
        list.push({ id: h._id, name: h.name });
        ownerHorses.set(key, list);
        allActiveHorses.push({ id: h._id, name: h.name, ownerId: key });
      }

      const totalActiveHorses = allActiveHorses.length;
      if (totalActiveHorses === 0) {
        // No active horses — skip business general entirely
      } else {
        for (const bill of businessGeneralBills) {
          const extracted = (bill.extractedData ?? {}) as Record<string, unknown>;
          const lineItems = getLineItems(extracted);
          const providerName = String(extracted.provider_name ?? extracted.providerName ?? bill.fileName ?? "");
          let categorySlug: string | undefined;
          if (bill.categoryId) {
            const cat = await ctx.db.get(bill.categoryId);
            if (cat) categorySlug = (cat as any).slug;
          }

          // Split across ALL active horses, grouped back per owner
          for (const [ownerIdStr, ownerHorseList] of ownerHorses.entries()) {
            if (ownerHorseList.length === 0) continue;
            const items = ownerItems.get(ownerIdStr) ?? [];

            if (lineItems.length > 0) {
              for (let idx = 0; idx < lineItems.length; idx++) {
                const li = lineItems[idx] as Record<string, unknown>;
                const liAmount = lineItemAmount(li);
                if (liAmount === 0) continue;
                const perHorse = round2(liAmount / totalActiveHorses);
                for (const horse of ownerHorseList) {
                  items.push({
                    sourceBillId: bill._id,
                    horseId: horse.id,
                    horseName: horse.name,
                    description: `${String(li.description ?? providerName)} (shared)`,
                    category: categorySlug ?? (typeof li.category === "string" ? li.category : undefined),
                    subcategory: typeof li.subcategory === "string" ? li.subcategory : undefined,
                    amount: perHorse,
                    sourceLineItemIndex: idx,
                  });
                }
              }
            } else {
              const total = typeof extracted.invoice_total_usd === "number"
                ? extracted.invoice_total_usd : 0;
              if (total === 0) continue;
              const perHorse = round2(total / totalActiveHorses);
              for (const horse of ownerHorseList) {
                items.push({
                  sourceBillId: bill._id,
                  horseId: horse.id,
                  horseName: horse.name,
                  description: `${providerName || bill.fileName} (shared)`,
                  category: categorySlug,
                  amount: perHorse,
                });
              }
            }
            ownerItems.set(ownerIdStr, items);
          }
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

/** Update the title of an owner invoice */
export const updateOwnerInvoiceTitle = mutation({
  args: {
    ownerInvoiceId: v.id("ownerInvoices"),
    title: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.ownerInvoiceId, { title: args.title.trim() || undefined });
  },
});

/** Update a line item's description (does NOT affect the source bill) */
export const updateLineItemDescription = mutation({
  args: {
    lineItemId: v.id("ownerInvoiceLineItems"),
    description: v.string(),
  },
  handler: async (ctx, args) => {
    const item = await ctx.db.get(args.lineItemId);
    if (!item) throw new Error("Line item not found");
    const invoice = await ctx.db.get(item.ownerInvoiceId);
    if (invoice && invoice.status !== "draft") throw new Error("Can only edit items on draft invoices");
    await ctx.db.patch(args.lineItemId, { description: args.description.trim() });
  },
});

/** Update notes on an owner invoice */
export const updateOwnerInvoiceNotes = mutation({
  args: {
    ownerInvoiceId: v.id("ownerInvoices"),
    notes: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.ownerInvoiceId, { notes: args.notes.trim() || undefined });
  },
});

/** Add a manual line item to an owner invoice */
export const addManualLineItem = mutation({
  args: {
    ownerInvoiceId: v.id("ownerInvoices"),
    horseId: v.optional(v.id("horses")),
    horseName: v.optional(v.string()),
    description: v.string(),
    amount: v.number(),
    category: v.optional(v.string()),
    subcategory: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const invoice = await ctx.db.get(args.ownerInvoiceId);
    if (!invoice) throw new Error("Invoice not found");
    if (invoice.status !== "draft") throw new Error("Can only add items to draft invoices");

    // Create a placeholder bill for the manual charge
    const billId = await ctx.db.insert("bills", {
      fileName: args.description,
      invoiceName: args.description,
      status: "done" as const,
      isApproved: true,
      approvedAt: Date.now(),
      uploadedAt: Date.now(),
      billingPeriod: invoice.billingPeriod,
      source: "cc_transaction" as const,
      extractedData: {
        invoice_total_usd: args.amount,
        provider_name: args.description,
        line_items: [{ description: args.description, amount: args.amount, confirmed: true }],
      },
      ...(args.horseId ? {
        assignType: "horse" as const,
        assignedHorses: [{
          horseId: args.horseId,
          horseName: args.horseName ?? "",
          amount: args.amount,
          direct: args.amount,
          shared: 0,
        }],
      } : {}),
    });

    const itemId = await ctx.db.insert("ownerInvoiceLineItems", {
      ownerInvoiceId: args.ownerInvoiceId,
      sourceBillId: billId,
      horseId: args.horseId,
      horseName: args.horseName,
      description: args.description,
      amount: args.amount,
      category: args.category,
      subcategory: args.subcategory,
      isApproved: false,
      createdAt: Date.now(),
    });

    // Update invoice totals
    await recalcInvoiceTotals(ctx, args.ownerInvoiceId);
    return itemId;
  },
});

/** Get approved bills assigned to horses owned by this invoice's owner, not yet on the invoice */
export const getAvailableCharges = query({
  args: { ownerInvoiceId: v.id("ownerInvoices") },
  handler: async (ctx, args) => {
    const invoice = await ctx.db.get(args.ownerInvoiceId);
    if (!invoice) return [];

    const owner = await ctx.db.get(invoice.ownerId);
    if (!owner) return [];

    // Get horses owned by this owner
    const horses = await ctx.db.query("horses").collect();
    const ownerHorseIds = new Set(
      horses.filter((h) => h.ownerId && String(h.ownerId) === String(invoice.ownerId)).map((h) => String(h._id))
    );

    // Get existing line items on this invoice to exclude
    const existingItems = await ctx.db
      .query("ownerInvoiceLineItems")
      .withIndex("by_owner_invoice", (q) => q.eq("ownerInvoiceId", args.ownerInvoiceId))
      .collect();
    const existingBillIds = new Set(existingItems.map((i) => String(i.sourceBillId)));

    // Find approved bills assigned to these horses, not already on the invoice
    const bills = await ctx.db.query("bills").collect();
    const available: Array<{
      billId: string;
      fileName: string;
      providerName: string;
      invoiceDate: string;
      amount: number;
      category: string;
      horseName: string;
      horseId: string;
    }> = [];

    for (const bill of bills) {
      if (bill.status !== "done" || !bill.isApproved) continue;
      if (existingBillIds.has(String(bill._id))) continue;

      const extracted = (bill.extractedData ?? {}) as Record<string, unknown>;
      const providerName = String(extracted.provider_name ?? extracted.providerName ?? bill.fileName ?? "");
      const invoiceDate = String(extracted.invoice_date ?? extracted.invoiceDate ?? "");
      const total = typeof extracted.invoice_total_usd === "number" ? extracted.invoice_total_usd : 0;

      // Check if bill has horses assigned that belong to this owner
      if (bill.assignedHorses && bill.assignedHorses.length > 0) {
        for (const h of bill.assignedHorses) {
          if (ownerHorseIds.has(String(h.horseId))) {
            let categorySlug = "";
            if (bill.categoryId) {
              const cat = await ctx.db.get(bill.categoryId);
              if (cat) categorySlug = (cat as any).slug ?? "";
            }
            available.push({
              billId: String(bill._id),
              fileName: bill.fileName,
              providerName,
              invoiceDate,
              amount: h.amount,
              category: categorySlug,
              horseName: h.horseName,
              horseId: String(h.horseId),
            });
          }
        }
      }
    }

    return available.sort((a, b) => b.invoiceDate.localeCompare(a.invoiceDate));
  },
});

/** Add charges from an existing bill to the owner invoice */
export const addBillCharges = mutation({
  args: {
    ownerInvoiceId: v.id("ownerInvoices"),
    billId: v.id("bills"),
    horseId: v.id("horses"),
    horseName: v.string(),
    amount: v.number(),
    category: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const invoice = await ctx.db.get(args.ownerInvoiceId);
    if (!invoice) throw new Error("Invoice not found");
    if (invoice.status !== "draft") throw new Error("Can only add items to draft invoices");

    const bill = await ctx.db.get(args.billId);
    if (!bill) throw new Error("Bill not found");

    const extracted = (bill.extractedData ?? {}) as Record<string, unknown>;
    const lineItems = Array.isArray(extracted.line_items) ? extracted.line_items : [];
    const providerName = String(extracted.provider_name ?? extracted.providerName ?? bill.fileName ?? "");

    if (lineItems.length > 0) {
      // Add each line item from the bill
      const totalBillAmount = typeof extracted.invoice_total_usd === "number" ? extracted.invoice_total_usd : 0;
      for (let i = 0; i < lineItems.length; i++) {
        const li = lineItems[i] as Record<string, unknown>;
        const liAmount = typeof li.amount === "number" ? li.amount
          : typeof li.total_usd === "number" ? li.total_usd
          : typeof li.total === "number" ? li.total : 0;
        // Scale amount proportionally if horse gets partial
        const scale = totalBillAmount > 0 ? args.amount / totalBillAmount : 1;
        await ctx.db.insert("ownerInvoiceLineItems", {
          ownerInvoiceId: args.ownerInvoiceId,
          sourceBillId: args.billId,
          horseId: args.horseId,
          horseName: args.horseName,
          description: String(li.description ?? providerName),
          amount: round2(liAmount * scale),
          category: args.category ?? String(li.category ?? ""),
          sourceLineItemIndex: i,
          isApproved: false,
          createdAt: Date.now(),
        });
      }
    } else {
      // Bill has no parsed line items — add as single item
      await ctx.db.insert("ownerInvoiceLineItems", {
        ownerInvoiceId: args.ownerInvoiceId,
        sourceBillId: args.billId,
        horseId: args.horseId,
        horseName: args.horseName,
        description: providerName || bill.fileName,
        amount: args.amount,
        category: args.category,
        isApproved: false,
        createdAt: Date.now(),
      });
    }

    await recalcInvoiceTotals(ctx, args.ownerInvoiceId);
  },
});

/** Delete (omit) a single line item from an owner invoice — allowed on any status */
export const deleteLineItem = mutation({
  args: { lineItemId: v.id("ownerInvoiceLineItems") },
  handler: async (ctx, args) => {
    const item = await ctx.db.get(args.lineItemId);
    if (!item) throw new Error("Line item not found");
    await ctx.db.delete(args.lineItemId);
    if (item.ownerInvoiceId) await recalcInvoiceTotals(ctx, item.ownerInvoiceId);
  },
});

/**
 * Auto-add an approved bill's horse charges into any existing DRAFT owner
 * invoices that cover the bill's period. This keeps draft invoices in sync
 * as users continue to approve new bills during an open billing cycle.
 *
 * - Matches draft invoices where the bill's date falls in the invoice period
 *   (matching by billingPeriod string YYYY-MM against the bill's date).
 * - Skips any draft invoice that already has a line item referencing this bill.
 * - Only inserts charges for horses that belong to the invoice's owner.
 */
export async function syncApprovedBillIntoDraftInvoices(
  ctx: any,
  billId: Id<"bills">
): Promise<{ invoicesUpdated: number; lineItemsAdded: number }> {
  const bill = await ctx.db.get(billId);
  if (!bill || bill.status !== "done" || !bill.isApproved) {
    return { invoicesUpdated: 0, lineItemsAdded: 0 };
  }

  // Resolve the bill's effective date (YYYY-MM-DD) and month key (YYYY-MM)
  const extracted = (bill.extractedData ?? {}) as Record<string, unknown>;
  const invoiceDateStr = String(extracted.invoice_date ?? extracted.invoiceDate ?? "").trim();
  let dateStr = "";
  if (invoiceDateStr) {
    const parsed = new Date(invoiceDateStr);
    if (!isNaN(parsed.getTime())) dateStr = parsed.toISOString().slice(0, 10);
  }
  if (!dateStr && bill.billingPeriod) dateStr = `${bill.billingPeriod}-01`;
  if (!dateStr) dateStr = new Date(bill.uploadedAt).toISOString().slice(0, 10);
  const monthKey = dateStr.slice(0, 7);

  // Build horse → owner + horse name map
  const horses = await ctx.db.query("horses").collect();
  const horseOwner = new Map<string, Id<"owners">>();
  const horseNames = new Map<string, string>();
  for (const h of horses) {
    if (h.ownerId) horseOwner.set(String(h._id), h.ownerId);
    horseNames.set(String(h._id), h.name);
  }

  // Build per-owner pending line items for this bill
  type PendingItem = {
    ownerId: Id<"owners">;
    horseId?: Id<"horses">;
    horseName?: string;
    description: string;
    category?: string;
    subcategory?: string;
    amount: number;
    sourceLineItemIndex?: number;
  };
  const pending = new Map<string, PendingItem[]>();

  const lineItems = getLineItems(extracted);
  const assigned = Array.isArray(bill.assignedHorses) ? bill.assignedHorses : [];
  const ha = Array.isArray(bill.horseAssignments) ? bill.horseAssignments : [];
  const splits = Array.isArray(bill.splitLineItems) ? bill.splitLineItems : [];
  const horsesPerIdx = new Map<number, number>();
  for (const h of ha) {
    horsesPerIdx.set(h.lineItemIndex, (horsesPerIdx.get(h.lineItemIndex) ?? 0) + 1);
  }

  let categorySlug: string | undefined;
  if (bill.categoryId) {
    const cat = await ctx.db.get(bill.categoryId);
    if (cat) categorySlug = (cat as any).slug;
  }

  function pushItem(ownerId: Id<"owners">, item: Omit<PendingItem, "ownerId">) {
    const key = String(ownerId);
    const arr = pending.get(key) ?? [];
    arr.push({ ownerId, ...item });
    pending.set(key, arr);
  }

  if (assigned.length > 0) {
    for (const row of assigned) {
      const hId = row.horseId;
      const oId = horseOwner.get(String(hId));
      if (!oId) continue;
      const horseLineIdxs = ha.filter((h: any) => String(h.horseId) === String(hId)).map((h: any) => h.lineItemIndex);
      if (horseLineIdxs.length > 0) {
        for (const idx of horseLineIdxs) {
          const li = lineItems[idx] as Record<string, unknown> | undefined;
          const split = splits.find((s: any) => s.lineItemIndex === idx);
          const splitAmount = split?.splits.find((sp: any) => String(sp.horseId) === String(hId))?.amount;
          const shareCount = horsesPerIdx.get(idx) ?? 1;
          const fallbackAmount = shareCount > 1
            ? lineItemAmount(li ?? {}) / shareCount
            : lineItemAmount(li ?? {});
          pushItem(oId, {
            horseId: hId,
            horseName: row.horseName,
            description: String(li?.description ?? bill.fileName),
            category: categorySlug ?? (typeof li?.category === "string" ? li.category : undefined),
            subcategory: typeof li?.subcategory === "string" ? li.subcategory : undefined,
            amount: round2(splitAmount ?? fallbackAmount),
            sourceLineItemIndex: idx,
          });
        }
      } else {
        pushItem(oId, {
          horseId: hId,
          horseName: row.horseName,
          description: bill.fileName,
          category: categorySlug,
          amount: round2(typeof row.amount === "number" ? row.amount : 0),
        });
      }
    }
  } else if (ha.length > 0) {
    for (const row of ha) {
      const hId = row.horseId;
      if (!hId) continue;
      const oId = horseOwner.get(String(hId));
      if (!oId) continue;
      const li = lineItems[row.lineItemIndex] as Record<string, unknown> | undefined;
      const split = splits.find((s: any) => s.lineItemIndex === row.lineItemIndex);
      const splitAmount = split?.splits.find((sp: any) => String(sp.horseId) === String(hId))?.amount;
      const shareCount = horsesPerIdx.get(row.lineItemIndex) ?? 1;
      const fallbackAmount = shareCount > 1
        ? lineItemAmount(li ?? {}) / shareCount
        : lineItemAmount(li ?? {});
      pushItem(oId, {
        horseId: hId,
        horseName: row.horseName ?? horseNames.get(String(hId)),
        description: String(li?.description ?? bill.fileName),
        category: categorySlug ?? (typeof li?.category === "string" ? li.category : undefined),
        subcategory: typeof li?.subcategory === "string" ? li.subcategory : undefined,
        amount: round2(splitAmount ?? fallbackAmount),
        sourceLineItemIndex: row.lineItemIndex,
      });
    }
  } else {
    // No user-confirmed horse assignment. Fall back to per-line-item
    // matched_horse_id (set by the parser) so auto-detected assignments still
    // route to the correct owner on approval.
    let added = 0;
    for (let idx = 0; idx < lineItems.length; idx++) {
      const li = lineItems[idx] as Record<string, unknown>;
      const matchedHorseId = ((li as any).matched_horse_id ?? (li as any).matchedHorseId) as string | undefined;
      if (!matchedHorseId) continue;
      const oId = horseOwner.get(String(matchedHorseId));
      if (!oId) continue;
      const amount = lineItemAmount(li);
      if (amount === 0) continue;
      pushItem(oId, {
        horseId: matchedHorseId as Id<"horses">,
        horseName: horseNames.get(String(matchedHorseId)),
        description: String(li.description ?? bill.fileName),
        category: categorySlug ?? (typeof li.category === "string" ? li.category : undefined),
        subcategory: typeof li.subcategory === "string" ? li.subcategory : undefined,
        amount: round2(amount),
        sourceLineItemIndex: idx,
      });
      added++;
    }
    if (added === 0) {
      return { invoicesUpdated: 0, lineItemsAdded: 0 };
    }
  }

  if (pending.size === 0) return { invoicesUpdated: 0, lineItemsAdded: 0 };

  // Find draft owner invoices for these owners covering the bill's month
  const allInvoices = await ctx.db.query("ownerInvoices").collect();
  const touchedInvoices = new Set<string>();
  let lineItemsAdded = 0;

  for (const [ownerIdStr, items] of pending.entries()) {
    const matches = allInvoices.filter(
      (inv: any) => inv.status === "draft" && String(inv.ownerId) === ownerIdStr && inv.billingPeriod === monthKey
    );
    if (matches.length === 0) continue;

    for (const inv of matches) {
      // Skip if this bill already has line items on the invoice
      const existing = await ctx.db
        .query("ownerInvoiceLineItems")
        .withIndex("by_owner_invoice", (q: any) => q.eq("ownerInvoiceId", inv._id))
        .collect();
      const alreadyHasBill = existing.some((i: any) => String(i.sourceBillId) === String(billId));
      if (alreadyHasBill) continue;

      for (const item of items) {
        await ctx.db.insert("ownerInvoiceLineItems", {
          ownerInvoiceId: inv._id,
          sourceBillId: billId,
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
        lineItemsAdded++;
      }
      touchedInvoices.add(String(inv._id));
      await recalcInvoiceTotals(ctx, inv._id);
    }
  }

  return { invoicesUpdated: touchedInvoices.size, lineItemsAdded };
}

/**
 * Create a single owner invoice for one owner.
 * mode = "autofill": pulls all approved bills assigned to this owner's horses
 *   in the date range (mirrors generateOwnerInvoices logic for one owner).
 * mode = "blank": creates an empty invoice the user fills in manually.
 * Returns the new ownerInvoiceId.
 */
export const createOwnerInvoiceForOwner = mutation({
  args: {
    ownerId: v.id("owners"),
    billingPeriod: v.string(),
    startDate: v.optional(v.string()),
    endDate: v.optional(v.string()),
    mode: v.union(v.literal("autofill"), v.literal("blank")),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const invId = await ctx.db.insert("ownerInvoices", {
      ownerId: args.ownerId,
      billingPeriod: args.billingPeriod,
      status: "draft",
      totalAmount: 0,
      approvedAmount: 0,
      lineItemCount: 0,
      approvedLineItemCount: 0,
      notes: undefined,
      createdAt: now,
    });

    if (args.mode === "blank") {
      return invId;
    }

    // Autofill: collect approved bills for horses owned by this owner, in date range
    const horses = await ctx.db.query("horses").collect();
    const ownerHorses = horses.filter((h) => h.ownerId && String(h.ownerId) === String(args.ownerId));
    const ownerHorseIds = new Set(ownerHorses.map((h) => String(h._id)));
    const horseNames = new Map(horses.map((h) => [String(h._id), h.name]));

    const bills = await ctx.db.query("bills").collect();
    const approvedBills = bills.filter((b) => {
      if (b.status !== "done" || !b.isApproved) return false;
      if (args.startDate || args.endDate) {
        return billInDateRange(b, args.startDate, args.endDate);
      }
      return b.billingPeriod === args.billingPeriod;
    });

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
    const items: PendingItem[] = [];

    for (const bill of approvedBills) {
      const extracted = (bill.extractedData ?? {}) as Record<string, unknown>;
      // Skip credit bills (deposits/money-in) — not charges to bill out
      if (extracted.isCredit === true) continue;

      const lineItems = getLineItems(extracted);
      const assigned = Array.isArray(bill.assignedHorses) ? bill.assignedHorses : [];
      const ha = Array.isArray(bill.horseAssignments) ? bill.horseAssignments : [];
      const splits = Array.isArray(bill.splitLineItems) ? bill.splitLineItems : [];

      const horsesPerIdx = new Map<number, number>();
      for (const h of ha) horsesPerIdx.set(h.lineItemIndex, (horsesPerIdx.get(h.lineItemIndex) ?? 0) + 1);

      if (assigned.length > 0) {
        for (const row of assigned) {
          if (!ownerHorseIds.has(String(row.horseId))) continue;
          const horseLineIdxs = ha.filter((h) => String(h.horseId) === String(row.horseId)).map((h) => h.lineItemIndex);
          if (horseLineIdxs.length > 0) {
            for (const idx of horseLineIdxs) {
              const li = lineItems[idx] as Record<string, unknown> | undefined;
              const split = splits.find((s) => s.lineItemIndex === idx);
              const splitAmount = split?.splits.find((sp) => String(sp.horseId) === String(row.horseId))?.amount;
              const shareCount = horsesPerIdx.get(idx) ?? 1;
              const fallbackAmount = shareCount > 1
                ? lineItemAmount(li ?? {}) / shareCount
                : lineItemAmount(li ?? {});
              items.push({
                sourceBillId: bill._id,
                horseId: row.horseId,
                horseName: row.horseName,
                description: String(li?.description ?? bill.fileName),
                category: typeof li?.category === "string" ? li.category : undefined,
                subcategory: typeof li?.subcategory === "string" ? li.subcategory : undefined,
                amount: round2(splitAmount ?? fallbackAmount),
                sourceLineItemIndex: idx,
              });
            }
          } else {
            items.push({
              sourceBillId: bill._id,
              horseId: row.horseId,
              horseName: row.horseName,
              description: bill.fileName,
              amount: round2(typeof row.amount === "number" ? row.amount : 0),
            });
          }
        }
      } else if (ha.length > 0) {
        for (const row of ha) {
          if (!row.horseId || !ownerHorseIds.has(String(row.horseId))) continue;
          const li = lineItems[row.lineItemIndex] as Record<string, unknown> | undefined;
          const split = splits.find((s) => s.lineItemIndex === row.lineItemIndex);
          const splitAmount = split?.splits.find((sp) => String(sp.horseId) === String(row.horseId))?.amount;
          const shareCount = horsesPerIdx.get(row.lineItemIndex) ?? 1;
          const fallbackAmount = shareCount > 1
            ? lineItemAmount(li ?? {}) / shareCount
            : lineItemAmount(li ?? {});
          items.push({
            sourceBillId: bill._id,
            horseId: row.horseId,
            horseName: row.horseName ?? horseNames.get(String(row.horseId)),
            description: String(li?.description ?? bill.fileName),
            category: typeof li?.category === "string" ? li.category : undefined,
            subcategory: typeof li?.subcategory === "string" ? li.subcategory : undefined,
            amount: round2(splitAmount ?? fallbackAmount),
            sourceLineItemIndex: row.lineItemIndex,
          });
        }
      }
    }

    // Business-general charges: split evenly across ALL active horses (not just this owner's)
    // Then only include the line items for this owner's horses.
    // Exclude credit bills (deposits/money-in).
    const activeHorses = ownerHorses.filter((h) => h.status === "active" && !h.isSold);
    // Count ALL active horses across all owners for the denominator
    const totalActiveHorseCount = horses.filter((h) => {
      if (h.isSold) return false;
      if (h.status === "active") return true;
      // Was active in billing period
      if (h.inactiveSince && h.inactiveSince >= new Date(args.billingPeriod + "-01").getTime()) return true;
      return false;
    }).length;

    if (activeHorses.length > 0 && totalActiveHorseCount > 0) {
      const businessGeneralBills = approvedBills.filter((b) => {
        // Skip credits
        const ext = (b.extractedData ?? {}) as Record<string, unknown>;
        if (ext.isCredit === true) return false;
        if (Array.isArray(b.assignedHorses) && b.assignedHorses.length > 0) return false;
        if (Array.isArray(b.horseAssignments) && (b.horseAssignments as any[]).length > 0) return false;
        const lis = Array.isArray(ext.line_items) ? ext.line_items as any[] : [];
        const isBusiness = (b as any).assignType === "business"
          || (!b.assignedPeople || b.assignedPeople.length === 0)
            && lis.some((li: any) => li.assigneeType === "business_general");
        const hasNoAssignment = !(b as any).assignType
          && (!b.assignedPeople || b.assignedPeople.length === 0);
        return isBusiness || hasNoAssignment;
      });

      for (const bill of businessGeneralBills) {
        const extracted = (bill.extractedData ?? {}) as Record<string, unknown>;
        const lineItems = getLineItems(extracted);
        const providerName = String(extracted.provider_name ?? extracted.providerName ?? bill.fileName ?? "");
        let categorySlug: string | undefined;
        if (bill.categoryId) {
          const cat = await ctx.db.get(bill.categoryId);
          if (cat) categorySlug = (cat as any).slug;
        }
        if (lineItems.length > 0) {
          for (let idx = 0; idx < lineItems.length; idx++) {
            const li = lineItems[idx] as Record<string, unknown>;
            const liAmount = lineItemAmount(li);
            if (liAmount === 0) continue;
            const perHorse = round2(liAmount / totalActiveHorseCount);
            for (const horse of activeHorses) {
              items.push({
                sourceBillId: bill._id,
                horseId: horse._id,
                horseName: horse.name,
                description: `${String(li.description ?? providerName)} (shared)`,
                category: categorySlug ?? (typeof li.category === "string" ? li.category : undefined),
                subcategory: typeof li.subcategory === "string" ? li.subcategory : undefined,
                amount: perHorse,
                sourceLineItemIndex: idx,
              });
            }
          }
        } else {
          const total = typeof extracted.invoice_total_usd === "number" ? extracted.invoice_total_usd : 0;
          if (total === 0) continue;
          const perHorse = round2(total / totalActiveHorseCount);
          for (const horse of activeHorses) {
            items.push({
              sourceBillId: bill._id,
              horseId: horse._id,
              horseName: horse.name,
              description: `${providerName || bill.fileName} (shared)`,
              category: categorySlug,
              amount: perHorse,
            });
          }
        }
      }
    }

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
        createdAt: now,
      });
    }

    await recalcInvoiceTotals(ctx, invId);
    return invId;
  },
});

/** Recalculate owner invoice totals from line items */
async function recalcInvoiceTotals(ctx: any, ownerInvoiceId: Id<"ownerInvoices">) {
  const items = await ctx.db
    .query("ownerInvoiceLineItems")
    .withIndex("by_owner_invoice", (q: any) => q.eq("ownerInvoiceId", ownerInvoiceId))
    .collect();
  const totalAmount = round2(items.reduce((s: number, i: any) => s + i.amount, 0));
  const approvedItems = items.filter((i: any) => i.isApproved);
  const approvedAmount = round2(approvedItems.reduce((s: number, i: any) => s + i.amount, 0));
  await ctx.db.patch(ownerInvoiceId, {
    totalAmount,
    approvedAmount,
    lineItemCount: items.length,
    approvedLineItemCount: approvedItems.length,
  });
}
