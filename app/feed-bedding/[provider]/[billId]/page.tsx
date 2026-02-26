"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import NavBar from "@/components/NavBar";
import LineItemReclassBadge from "@/components/LineItemReclassBadge";
import Modal from "@/components/Modal";
import ReclassificationSummary from "@/components/ReclassificationSummary";

type SplitMode = "even" | "custom";

export default function FeedBeddingInvoicePage() {
  const router = useRouter();
  const params = useParams<{ provider: string; billId: string }>();
  const providerSlug = params?.provider ?? "";
  const billId = params?.billId ?? "";

  const bill = useQuery(api.bills.getBillById, billId ? { billId: billId as any } : "skip");
  const provider = useQuery(api.providers.getProviderBySlug, providerSlug ? { categorySlug: "feed-bedding", providerSlug } : "skip");
  const horses = useQuery(api.horses.getActiveHorses) ?? [];
  const saveAssignment = useMutation(api.bills.saveFeedBeddingAssignment);
  const updateLineItemSubcategory = useMutation(api.bills.updateFeedBeddingLineItemSubcategory);
  const approveInvoiceWithReclassification = useMutation(api.bills.approveInvoiceWithReclassification);
  const deleteBill = useMutation(api.bills.deleteBill);

  const [splitType, setSplitType] = useState<"single" | "split">("single");
  const [singleHorseId, setSingleHorseId] = useState<Id<"horses"> | "">("");
  const [splitHorseIds, setSplitHorseIds] = useState<Id<"horses">[]>([]);
  const [splitMode, setSplitMode] = useState<SplitMode>("even");
  const [customAmounts, setCustomAmounts] = useState<Record<string, string>>({});
  const [lineCategoryDecisions, setLineCategoryDecisions] = useState<Record<number, string | null>>({});
  const [isUpdatingLineItem, setIsUpdatingLineItem] = useState<number | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const extracted = (bill?.extractedData ?? {}) as Record<string, unknown>;
  const lineItems = Array.isArray(extracted.line_items) ? (extracted.line_items as Array<Record<string, unknown>>) : [];
  const total =
    typeof extracted.invoice_total_usd === "number"
      ? extracted.invoice_total_usd
      : lineItems.reduce((sum, row) => sum + safeNumber(row.total_usd), 0);

  useEffect(() => {
    if (!bill?.assignedHorses || bill.assignedHorses.length === 0) return;
    setSplitType((bill.horseSplitType as "single" | "split") ?? (bill.assignedHorses.length > 1 ? "split" : "single"));
    if (bill.assignedHorses.length === 1) {
      setSingleHorseId(bill.assignedHorses[0].horseId);
    } else {
      setSplitHorseIds(bill.assignedHorses.map((row) => row.horseId));
      const next: Record<string, string> = {};
      for (const row of bill.assignedHorses) next[String(row.horseId)] = row.amount.toFixed(2);
      setCustomAmounts(next);
    }
  }, [bill?.assignedHorses, bill?.horseSplitType]);

  useEffect(() => {
    const next = Object.fromEntries(
      lineItems.map((row, index) => [index, normalizeCategoryKey(row.confirmedCategory ?? row.suggestedCategory)])
    );
    setLineCategoryDecisions(next);
  }, [bill?._id, lineItems]);

  const feedTotal = useMemo(
    () =>
      lineItems.reduce((sum, row) => {
        const sub = String(row.subcategory ?? "").toLowerCase();
        return sub.includes("bedding") ? sum : sum + safeNumber(row.total_usd);
      }, 0),
    [lineItems]
  );
  const beddingTotal = Math.max(0, total - feedTotal);

  const assignedRows = useMemo(() => {
    if (splitType === "single") {
      const horse = horses.find((row) => row._id === singleHorseId);
      if (!horse) return [] as Array<{ horseId: Id<"horses">; horseName: string; amount: number }>;
      return [{ horseId: horse._id, horseName: horse.name, amount: total }];
    }
    if (splitHorseIds.length === 0) return [] as Array<{ horseId: Id<"horses">; horseName: string; amount: number }>;
    if (splitMode === "even") {
      const each = total / splitHorseIds.length;
      return splitHorseIds
        .map((horseId) => horses.find((row) => row._id === horseId))
        .filter(Boolean)
        .map((horse) => ({ horseId: horse!._id, horseName: horse!.name, amount: each }));
    }
    return splitHorseIds
      .map((horseId) => horses.find((row) => row._id === horseId))
      .filter(Boolean)
      .map((horse) => ({
        horseId: horse!._id,
        horseName: horse!.name,
        amount: safeNumber(customAmounts[String(horse!._id)])
      }));
  }, [customAmounts, horses, singleHorseId, splitHorseIds, splitMode, splitType, total]);

  const customDelta = useMemo(() => {
    if (splitType !== "split" || splitMode !== "custom") return 0;
    const sum = assignedRows.reduce((acc, row) => acc + row.amount, 0);
    return total - sum;
  }, [assignedRows, splitMode, splitType, total]);

  const reclassification = useMemo(() => {
    const current = "feed_bedding";
    const grouped = new Map<string, Array<{ description: string; amount: number }>>();
    let remainingItems = 0;
    let remainingTotal = 0;
    for (let idx = 0; idx < lineItems.length; idx += 1) {
      const item = lineItems[idx] ?? {};
      const suggested = normalizeCategoryKey(item.suggestedCategory);
      const confirmed = normalizeCategoryKey(lineCategoryDecisions[idx]);
      const target = confirmed ?? suggested;
      const amount = safeNumber(item.total_usd);
      if (!target || target === current) {
        remainingItems += 1;
        remainingTotal += amount;
        continue;
      }
      const rows = grouped.get(target) ?? [];
      rows.push({ description: String(item.description ?? "Line item"), amount });
      grouped.set(target, rows);
    }
    const groups = [...grouped.entries()].map(([category, items]) => ({
      category,
      itemCount: items.length,
      total: round2(items.reduce((sum, row) => sum + row.amount, 0)),
      items
    }));
    groups.sort((a, b) => b.total - a.total);
    return {
      groups,
      movedCount: groups.reduce((sum, row) => sum + row.itemCount, 0),
      remainingItems,
      remainingTotal: round2(remainingTotal)
    };
  }, [lineCategoryDecisions, lineItems]);

  const canSave =
    splitType === "single"
      ? assignedRows.length === 1
      : splitHorseIds.length >= 2 && (splitMode === "even" || Math.abs(customDelta) < 0.01);

  async function onSaveAssignment() {
    if (!bill || !canSave) return;
    await saveAssignment({
      billId: bill._id,
      splitType,
      assignedHorses: assignedRows
    });
  }

  async function onApprove() {
    if (!bill || !(bill.assignedHorses?.length || assignedRows.length)) return;
    await approveInvoiceWithReclassification({
      billId: bill._id,
      lineItemDecisions: lineItems.map((_, index) => ({
        lineItemIndex: index,
        confirmedCategory: lineCategoryDecisions[index] ?? undefined
      }))
    });
  }

  async function onDelete() {
    if (!bill) return;
    await deleteBill({ billId: bill._id });
    router.push(`/feed-bedding/${providerSlug}`);
  }

  async function onToggleSubcategory(index: number, current: "feed" | "bedding") {
    if (!bill) return;
    setIsUpdatingLineItem(index);
    try {
      await updateLineItemSubcategory({
        billId: bill._id,
        lineItemIndex: index,
        subcategory: current === "feed" ? "bedding" : "feed"
      });
    } finally {
      setIsUpdatingLineItem(null);
    }
  }

  return (
    <div className="page-shell">
      <NavBar
        items={[
          { label: "old-oak-horses", href: "/dashboard", brand: true },
          { label: "feed-bedding", href: "/feed-bedding" },
          { label: providerSlug, href: `/feed-bedding/${providerSlug}` },
          { label: String(extracted.invoice_number ?? "invoice"), current: true }
        ]}
        actions={[{ label: "biz overview", href: "/biz-overview", variant: "filled" }]}
      />
      <main className="page-main">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
          <Link className="ui-back-link" href={`/feed-bedding/${providerSlug}`}>
            ← cd /{providerSlug}
          </Link>
          {bill?.originalPdfUrl ? (
            <a href={bill.originalPdfUrl} target="_blank" rel="noreferrer">
              view original PDF
            </a>
          ) : null}
        </div>

        <section className="ui-card">
          <div className="ui-label">// feed & bedding invoice</div>
          <h1 style={{ fontSize: 28, marginTop: 8 }}>{provider?.fullName ?? provider?.name ?? providerSlug}</h1>
          <p style={{ marginTop: 8, color: "var(--ui-text-secondary)" }}>
            {String(extracted.invoice_number ?? "—")} · {formatDate(extracted.invoice_date)} · due {formatDate(extracted.due_date)}
          </p>
          <div style={{ marginTop: 10, fontSize: 34, fontWeight: 700 }}>{fmtUSD(total)}</div>
          <p style={{ marginTop: 10, color: "var(--ui-text-secondary)" }}>
            <span style={{ color: "#22C583" }}>● Feed {fmtUSD(feedTotal)}</span> · <span style={{ color: "#F59E0B" }}>● Bedding {fmtUSD(beddingTotal)}</span>
          </p>
        </section>

        <section className="ui-card" style={{ marginTop: 16 }}>
          <h2 style={{ fontSize: 16, marginBottom: 10 }}>line_items</h2>
          <ul style={{ paddingLeft: 18 }}>
            {lineItems.map((row, idx) => {
              const sub = String(row.subcategory ?? "feed").toLowerCase().includes("bedding") ? "bedding" : "feed";
              return (
                <li key={idx} style={{ marginBottom: 8 }}>
                  {String(row.description ?? "—")} · {fmtUSD(safeNumber(row.total_usd))}{" "}
                  <LineItemReclassBadge
                    currentCategory="feed_bedding"
                    suggestedCategory={normalizeCategoryKey(row.suggestedCategory)}
                    confirmedCategory={lineCategoryDecisions[idx] ?? null}
                    onChange={(category) => setLineCategoryDecisions((prev) => ({ ...prev, [idx]: category }))}
                  />
                  <button
                    type="button"
                    disabled={isUpdatingLineItem === idx}
                    onClick={() => onToggleSubcategory(idx, sub)}
                    style={{
                      marginLeft: 8,
                      padding: "1px 7px",
                      borderRadius: 6,
                      background: sub === "feed" ? "rgba(34,197,131,0.10)" : "rgba(245,158,11,0.12)",
                      color: sub === "feed" ? "#22C583" : "#F59E0B",
                      fontSize: 10,
                      fontWeight: 700,
                      border: "1px solid transparent",
                      cursor: isUpdatingLineItem === idx ? "not-allowed" : "pointer"
                    }}
                  >
                    {isUpdatingLineItem === idx ? "saving..." : sub}
                  </button>
                </li>
              );
            })}
          </ul>
        </section>

        <section className="ui-card" style={{ marginTop: 16 }}>
          <h2 style={{ fontSize: 16, marginBottom: 10 }}>assign_horses</h2>
          <div style={{ display: "flex", gap: 8 }}>
            <button type="button" className={splitType === "single" ? "ui-button-filled" : "ui-button-outlined"} onClick={() => setSplitType("single")}>
              one horse
            </button>
            <button type="button" className={splitType === "split" ? "ui-button-filled" : "ui-button-outlined"} onClick={() => setSplitType("split")}>
              split across horses
            </button>
          </div>

          {splitType === "single" ? (
            <div style={{ marginTop: 12 }}>
              <select
                style={{ width: "100%", background: "#F2F3F7", border: "1px solid #E8EAF0", borderRadius: 6, padding: "10px 12px" }}
                value={singleHorseId}
                onChange={(e) => setSingleHorseId((e.target.value || "") as Id<"horses"> | "")}
              >
                <option value="">assign horse...</option>
                {horses.map((horse) => (
                  <option key={horse._id} value={horse._id}>
                    {horse.name}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <div style={{ marginTop: 12 }}>
              <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
                <button type="button" className={splitMode === "even" ? "ui-button-filled" : "ui-button-outlined"} onClick={() => setSplitMode("even")}>
                  even split
                </button>
                <button type="button" className={splitMode === "custom" ? "ui-button-filled" : "ui-button-outlined"} onClick={() => setSplitMode("custom")}>
                  custom split
                </button>
              </div>

              <select
                style={{ width: "100%", background: "#F2F3F7", border: "1px solid #E8EAF0", borderRadius: 6, padding: "10px 12px" }}
                value=""
                onChange={(e) => {
                  const id = e.target.value as Id<"horses">;
                  if (!id || splitHorseIds.includes(id)) return;
                  setSplitHorseIds((prev) => [...prev, id]);
                }}
              >
                <option value="">+ add horse...</option>
                {horses
                  .filter((horse) => !splitHorseIds.includes(horse._id))
                  .map((horse) => (
                    <option key={horse._id} value={horse._id}>
                      {horse.name}
                    </option>
                  ))}
              </select>

              <div style={{ marginTop: 10 }}>
                {splitHorseIds.map((horseId) => {
                  const horse = horses.find((row) => row._id === horseId);
                  if (!horse) return null;
                  const evenAmount = splitHorseIds.length ? total / splitHorseIds.length : 0;
                  return (
                    <div key={horseId} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                      <span>{horse.name}</span>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        {splitMode === "custom" ? (
                          <input
                            style={{ width: 120, background: "#fff", border: "1px solid #E8EAF0", borderRadius: 6, padding: "6px 8px" }}
                            value={customAmounts[String(horseId)] ?? ""}
                            onChange={(e) => setCustomAmounts((prev) => ({ ...prev, [String(horseId)]: e.target.value }))}
                            placeholder="0.00"
                          />
                        ) : (
                          <span>{fmtUSD(evenAmount)}</span>
                        )}
                        <button type="button" className="ui-button-outlined" onClick={() => setSplitHorseIds((prev) => prev.filter((id) => id !== horseId))}>
                          ×
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
              {splitMode === "custom" ? (
                <p style={{ color: Math.abs(customDelta) < 0.01 ? "#22C583" : "#E5484D", marginTop: 8 }}>
                  {Math.abs(customDelta) < 0.01 ? "✓ balanced" : `${fmtUSD(Math.abs(customDelta))} ${customDelta > 0 ? "remaining" : "over"}`}
                </p>
              ) : null}
            </div>
          )}

          <div style={{ marginTop: 12, display: "flex", gap: 10 }}>
            <button type="button" className="ui-button-filled" disabled={!canSave} onClick={onSaveAssignment}>
              save assignment
            </button>
          </div>
        </section>

        <ReclassificationSummary
          currentCategoryLabel="Feed & Bedding"
          groups={reclassification.groups}
          remainingItems={reclassification.remainingItems}
          remainingTotal={reclassification.remainingTotal}
        />

        <section className="ui-card" style={{ marginTop: 16, display: "flex", gap: 10 }}>
          <button
            type="button"
            className="ui-button-filled"
            disabled={(bill?.status === "done") || !((bill?.assignedHorses?.length ?? 0) > 0)}
            onClick={onApprove}
          >
            {reclassification.movedCount > 0 ? `approve & move ${reclassification.movedCount} items` : "approve invoice"}
          </button>
          <button type="button" className="ui-button-outlined" onClick={() => setShowDeleteConfirm(true)}>
            delete
          </button>
        </section>

        <section
          style={{
            marginTop: 16,
            background: "#1A1A2E",
            color: "white",
            borderRadius: 10,
            padding: "16px 20px",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center"
          }}
        >
          <div style={{ display: "flex", gap: 20 }}>
            <Summary label="ITEMS" value={String(lineItems.length)} />
            <Summary label="FEED" value={fmtUSD(feedTotal)} />
            <Summary label="BEDDING" value={fmtUSD(beddingTotal)} />
            <Summary label="HORSES" value={String((bill?.assignedHorses?.length ?? assignedRows.length) || 0)} />
            <Summary label="STATUS" value={bill?.status === "done" ? "APPROVED" : "PENDING"} />
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 10, color: "#9EA2B0" }}>TOTAL DUE</div>
            <div style={{ fontSize: 24, fontWeight: 700 }}>{fmtUSD(total)}</div>
          </div>
        </section>

        <Modal open={showDeleteConfirm} title="delete invoice?" onClose={() => setShowDeleteConfirm(false)}>
          <p style={{ marginTop: 0, color: "var(--ui-text-secondary)" }}>
            this will permanently delete invoice <strong>{String(extracted.invoice_number ?? billId)}</strong>.
          </p>
          {bill?.linkedBills?.length ? (
            <p style={{ color: "var(--ui-text-muted)" }}>This will also delete {bill.linkedBills.length} linked invoices created from reclassified items.</p>
          ) : null}
          <p style={{ color: "var(--ui-text-muted)" }}>this action cannot be undone.</p>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
            <button type="button" className="ui-button-outlined" onClick={() => setShowDeleteConfirm(false)}>
              cancel
            </button>
            <button
              type="button"
              className="ui-button-filled"
              onClick={async () => {
                setShowDeleteConfirm(false);
                await onDelete();
              }}
            >
              yes, delete invoice
            </button>
          </div>
        </Modal>
      </main>
    </div>
  );
}

function Summary({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ fontSize: 10, color: "#9EA2B0" }}>{label}</div>
      <div style={{ fontWeight: 700 }}>{value}</div>
    </div>
  );
}

function safeNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

function normalizeCategoryKey(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase().replace(/-/g, "_");
  return normalized.length > 0 ? normalized : null;
}

function round2(value: number) {
  return Math.round(value * 100) / 100;
}

function fmtUSD(v: number) {
  return `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatDate(value: unknown) {
  if (typeof value !== "string" || !value) return "—";
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}
