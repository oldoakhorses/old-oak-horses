"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import NavBar from "@/components/NavBar";
import Modal from "@/components/Modal";
import styles from "./feedBeddingInvoice.module.css";

type SplitMode = "even" | "custom";
type FeedBeddingType = "feed" | "bedding" | "admin";

type AssignedHorse = {
  horseId: Id<"horses">;
  horseName: string;
  baseAmount: number;
  adminAmount: number;
  totalAmount: number;
};

export default function FeedBeddingInvoicePage() {
  const router = useRouter();
  const params = useParams<{ provider: string; billId: string }>();
  const providerSlug = params?.provider ?? "";
  const billId = params?.billId as Id<"bills">;

  const bill = useQuery(api.bills.getBillById, billId ? { billId } : "skip");
  const horses = useQuery(api.horses.getActiveHorses) ?? [];

  const saveAssignment = useMutation(api.bills.saveFeedBeddingAssignment);
  const updateLineItemSubcategory = useMutation(api.bills.updateFeedBeddingLineItemSubcategory);
  const approveBill = useMutation(api.bills.approveBill);
  const deleteBill = useMutation(api.bills.deleteBill);

  const [editing, setEditing] = useState(false);
  const [splitType, setSplitType] = useState<"single" | "split">("single");
  const [singleHorseId, setSingleHorseId] = useState<Id<"horses"> | "">("");
  const [splitHorseIds, setSplitHorseIds] = useState<Id<"horses">[]>([]);
  const [splitMode, setSplitMode] = useState<SplitMode>("even");
  const [customAmounts, setCustomAmounts] = useState<Record<string, string>>({});
  const [isSaving, setIsSaving] = useState(false);
  const [isApproving, setIsApproving] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [assignmentSavedLocal, setAssignmentSavedLocal] = useState(false);
  const [isUpdatingLineItem, setIsUpdatingLineItem] = useState<number | null>(null);

  const extracted = (bill?.extractedData ?? {}) as Record<string, unknown>;
  const lineItems = Array.isArray(extracted.line_items) ? (extracted.line_items as Array<Record<string, unknown>>) : [];
  const typedLineItems = useMemo(
    () =>
      lineItems.map((row) => ({
        row,
        type: normalizeFeedBeddingType(row.subcategory),
        amount: safeNumber(row.total_usd ?? row.amount_usd ?? row.total)
      })),
    [lineItems]
  );
  const total =
    typeof extracted.invoice_total_usd === "number"
      ? extracted.invoice_total_usd
      : typedLineItems.reduce((sum, row) => sum + row.amount, 0);

  useEffect(() => {
    if (!bill) return;
    if (!bill.assignedHorses || bill.assignedHorses.length === 0) {
      setEditing(true);
      return;
    }

    const nextSplitType = (bill.horseSplitType as "single" | "split" | undefined) ?? (bill.assignedHorses.length > 1 ? "split" : "single");
    setSplitType(nextSplitType);
    if (bill.assignedHorses.length === 1) {
      setSingleHorseId(bill.assignedHorses[0].horseId);
      setSplitHorseIds([]);
      setCustomAmounts({});
    } else {
      setSplitHorseIds(bill.assignedHorses.map((row) => row.horseId));
      setSingleHorseId("");
      const next: Record<string, string> = {};
      const savedTotal = bill.assignedHorses.reduce((sum, row) => sum + row.amount, 0);
      for (const row of bill.assignedHorses) {
        const inferredAdminShare = adminTotal > 0 && savedTotal > 0 ? round2((row.amount / savedTotal) * adminTotal) : 0;
        next[String(row.horseId)] = round2(Math.max(0, row.amount - inferredAdminShare)).toFixed(2);
      }
      setCustomAmounts(next);
    }
    setAssignmentSavedLocal(true);
    setEditing(false);
  }, [bill]);

  const assignmentSaved = useMemo(() => {
    return Boolean(((bill?.assignedHorses?.length ?? 0) > 0 || assignmentSavedLocal) && !editing);
  }, [assignmentSavedLocal, bill?.assignedHorses?.length, editing]);

  const feedTotal = useMemo(() => round2(typedLineItems.reduce((sum, row) => (row.type === "feed" ? sum + row.amount : sum), 0)), [typedLineItems]);
  const beddingTotal = useMemo(() => round2(typedLineItems.reduce((sum, row) => (row.type === "bedding" ? sum + row.amount : sum), 0)), [typedLineItems]);
  const adminTotal = useMemo(() => round2(typedLineItems.reduce((sum, row) => (row.type === "admin" ? sum + row.amount : sum), 0)), [typedLineItems]);
  const assignableTotal = useMemo(() => round2(Math.max(0, total - adminTotal)), [adminTotal, total]);

  const assignedRows: AssignedHorse[] = useMemo(() => {
    if (splitType === "single") {
      const horse = horses.find((row) => row._id === singleHorseId);
      if (!horse) return [];
      return [{ horseId: horse._id, horseName: horse.name, baseAmount: assignableTotal, adminAmount: adminTotal, totalAmount: round2(assignableTotal + adminTotal) }];
    }

    if (splitHorseIds.length === 0) return [];
    if (splitMode === "even") {
      const evenBase = splitHorseIds.length > 0 ? round2(assignableTotal / splitHorseIds.length) : 0;
      const evenAdmin = splitHorseIds.length > 0 ? round2(adminTotal / splitHorseIds.length) : 0;
      return splitHorseIds
        .map((horseId, index) => {
          const horse = horses.find((row) => row._id === horseId);
          if (!horse) return null;
          const isLast = index === splitHorseIds.length - 1;
          const baseAmount = isLast ? round2(assignableTotal - evenBase * (splitHorseIds.length - 1)) : evenBase;
          const adminAmount = isLast ? round2(adminTotal - evenAdmin * (splitHorseIds.length - 1)) : evenAdmin;
          return { horseId: horse._id, horseName: horse.name, baseAmount, adminAmount, totalAmount: round2(baseAmount + adminAmount) };
        })
        .filter(Boolean) as AssignedHorse[];
    }

    const baseRows = splitHorseIds
      .map((horseId) => {
        const horse = horses.find((row) => row._id === horseId);
        if (!horse) return null;
        return {
          horseId: horse._id,
          horseName: horse.name,
          baseAmount: round2(safeNumber(customAmounts[String(horseId)]))
        };
      })
      .filter(Boolean) as Array<{ horseId: Id<"horses">; horseName: string; baseAmount: number }>;

    if (baseRows.length === 0) return [];
    const baseTotal = baseRows.reduce((sum, row) => sum + row.baseAmount, 0);
    if (adminTotal <= 0) {
      return baseRows.map((row) => ({ ...row, adminAmount: 0, totalAmount: row.baseAmount }));
    }
    if (baseTotal <= 0) {
      const evenAdmin = round2(adminTotal / baseRows.length);
      return baseRows.map((row, index) => {
        const adminAmount = index === baseRows.length - 1 ? round2(adminTotal - evenAdmin * (baseRows.length - 1)) : evenAdmin;
        return { ...row, adminAmount, totalAmount: round2(row.baseAmount + adminAmount) };
      });
    }
    return baseRows.map((row, index) => {
      if (index === baseRows.length - 1) {
        const allocated = baseRows.slice(0, -1).reduce((sum, entry) => sum + round2((entry.baseAmount / baseTotal) * adminTotal), 0);
        const adminAmount = round2(adminTotal - allocated);
        return { ...row, adminAmount, totalAmount: round2(row.baseAmount + adminAmount) };
      }
      const adminAmount = round2((row.baseAmount / baseTotal) * adminTotal);
      return { ...row, adminAmount, totalAmount: round2(row.baseAmount + adminAmount) };
    });
  }, [adminTotal, assignableTotal, customAmounts, horses, singleHorseId, splitHorseIds, splitMode, splitType]);

  const customDelta = useMemo(() => {
    if (splitType !== "split" || splitMode !== "custom") return 0;
    const assignedBase = assignedRows.reduce((sum, row) => sum + row.baseAmount, 0);
    return round2(assignableTotal - assignedBase);
  }, [assignableTotal, assignedRows, splitMode, splitType]);

  const feedPct = total > 0 ? (feedTotal / total) * 100 : 0;
  const beddingPct = total > 0 ? (beddingTotal / total) * 100 : 0;
  const adminPct = total > 0 ? (adminTotal / total) * 100 : 0;

  const canSaveAssignment =
    splitType === "single"
      ? assignedRows.length === 1
      : splitHorseIds.length >= 2 && (splitMode === "even" || Math.abs(customDelta) <= 0.01);

  if (!bill) {
    return (
      <div className="page-shell">
        <main className="page-main">
          <section className="ui-card">Loading invoice...</section>
        </main>
      </div>
    );
  }

  async function onSaveAssignment() {
    if (!bill) return;
    if (!canSaveAssignment || isSaving) return;
    setIsSaving(true);
    try {
      await saveAssignment({
        billId: bill._id,
        splitType,
        assignedHorses: assignedRows.map((row) => ({
          horseId: row.horseId,
          horseName: row.horseName,
          amount: row.totalAmount
        }))
      });
      setAssignmentSavedLocal(true);
      setEditing(false);
    } finally {
      setIsSaving(false);
    }
  }

  async function onApprove() {
    if (!bill) return;
    if (!assignmentSaved || isApproving) return;
    setIsApproving(true);
    console.log("Approve clicked, billId:", bill._id);
    try {
      await approveBill({ billId: bill._id });
      console.log("Approve mutation succeeded");
    } catch (error) {
      console.error("Approve mutation failed:", error);
    } finally {
      setIsApproving(false);
    }
  }

  async function onDelete() {
    if (!bill) return;
    await deleteBill({ billId: bill._id });
    router.push(`/feed-bedding/${providerSlug}`);
  }

  async function onToggleSubcategory(index: number, current: FeedBeddingType) {
    if (!bill) return;
    setIsUpdatingLineItem(index);
    try {
      const next: FeedBeddingType = current === "feed" ? "bedding" : current === "bedding" ? "admin" : "feed";
      await updateLineItemSubcategory({
        billId: bill._id,
        lineItemIndex: index,
        subcategory: next
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
          { label: "feed_bedding", href: "/feed-bedding" },
          { label: providerSlug, href: `/feed-bedding/${providerSlug}` },
          { label: String(extracted.invoice_number ?? "invoice"), current: true }
        ]}
        actions={bill.originalPdfUrl ? [{ label: "view original PDF", href: bill.originalPdfUrl, variant: "link", newTab: true }] : []}
      />

      <main className="page-main">
        <div className={styles.topRow}>
          <Link className="ui-back-link" href={`/feed-bedding/${providerSlug}`}>
            ← cd /{providerSlug}
          </Link>
        </div>

        <section className={styles.headerCard}>
          <div className={styles.headerLeft}>
            <div className={styles.invoiceLabel}>FEED & BEDDING INVOICE</div>
            <h1 className={styles.providerName}>{bill.provider?.fullName || bill.provider?.name || bill.customProviderName || providerSlug}</h1>
            <div className={styles.detailsRow}>
              <Detail label="INVOICE #" value={String(extracted.invoice_number ?? bill.fileName)} />
              <Detail label="DATE" value={formatDate(extracted.invoice_date)} />
              <Detail label="DUE DATE" value={formatDate(extracted.due_date)} />
            </div>
          </div>
          <div className={styles.totalBlock}>
            <div className={styles.totalLabel}>INVOICE TOTAL</div>
            <div className={styles.totalAmount}>{fmtUSD(total)}</div>
          </div>
        </section>

        <section className={styles.card}>
          <div className={styles.cardHeader}>spend_by_type</div>
          <div className={styles.typeRow}>
            <div className={styles.typeMeta}><span className={styles.feedDot} />Feed</div>
            <div className={styles.typeNumbers}>{fmtUSD(feedTotal)} · {feedPct.toFixed(1)}%</div>
          </div>
          <div className={styles.typeRow}>
            <div className={styles.typeMeta}><span className={styles.beddingDot} />Bedding</div>
            <div className={styles.typeNumbers}>{fmtUSD(beddingTotal)} · {beddingPct.toFixed(1)}%</div>
          </div>
          <div className={styles.typeRow}>
            <div className={styles.typeMeta}><span className={styles.adminDot} />Admin</div>
            <div className={styles.typeNumbers}>{fmtUSD(adminTotal)} · {adminPct.toFixed(1)}%</div>
          </div>
          <div className={styles.splitTrack}>
            <div className={styles.feedFill} style={{ width: `${feedPct}%` }} />
            <div className={styles.beddingFill} style={{ width: `${beddingPct}%` }} />
            <div className={styles.adminFill} style={{ width: `${adminPct}%` }} />
          </div>
        </section>

        <section className={styles.card}>
          <div className={styles.cardHeader}>line_items</div>
          <div className={styles.tableHeader}>
            <span>DESCRIPTION</span>
            <span>QTY</span>
            <span>UNIT</span>
            <span>TYPE</span>
            <span>AMOUNT</span>
          </div>
          {lineItems.map((row, index) => {
            const sub = normalizeFeedBeddingType(row.subcategory);
            const qty = safeNumber(row.quantity || row.qty);
            const unit = safeNumber(row.unit_price || row.rate);
            return (
              <div key={`${index}-${String(row.description ?? "line")}`} className={styles.tableRow}>
                <span className={styles.desc}>{String(row.description ?? "—")}</span>
                <span className={styles.centerText}>{qty > 0 ? qty.toFixed(2) : "—"}</span>
                <span className={styles.centerText}>{unit > 0 ? fmtUSD(unit) : "—"}</span>
                <span>
                  <button
                    type="button"
                    disabled={isUpdatingLineItem === index}
                    onClick={() => onToggleSubcategory(index, sub)}
                    className={sub === "feed" ? styles.feedBadge : sub === "bedding" ? styles.beddingBadge : styles.adminBadge}
                  >
                    {isUpdatingLineItem === index ? "..." : sub}
                  </button>
                </span>
                <span className={styles.amount}>{fmtUSD(safeNumber(row.total_usd ?? row.amount_usd ?? row.total))}</span>
              </div>
            );
          })}
        </section>

        <section className={assignmentSaved ? styles.assignmentSavedCard : styles.assignmentCard}>
          {assignmentSaved ? (
            <div className={styles.savedRow}>
              <div>
                <div className={styles.savedTitle}>{splitType === "single" ? "assigned to" : `split across ${assignedRows.length} horses`}</div>
                <div className={styles.savedPeople}>
                  {assignedRows.map((row) => (
                    <span key={String(row.horseId)} className={styles.savedPill}>
                      {row.horseName} · {fmtUSD(row.totalAmount)}{row.adminAmount > 0 ? ` (+ ${fmtUSD(row.adminAmount)} admin)` : ""}
                    </span>
                  ))}
                </div>
              </div>
              <button
                type="button"
                className="ui-button-outlined"
                onClick={() => {
                  setEditing(true);
                  setAssignmentSavedLocal(false);
                }}
              >
                edit
              </button>
            </div>
          ) : (
            <>
              <div className={styles.assignHead}>🐴 assign_horses</div>
              <div className={styles.question}>how should this invoice be split across horses?</div>

              <div className={styles.toggleRow}>
                <button type="button" className={splitType === "single" ? styles.toggleActive : styles.toggleBtn} onClick={() => setSplitType("single")}>one horse</button>
                <button type="button" className={splitType === "split" ? styles.toggleActive : styles.toggleBtn} onClick={() => setSplitType("split")}>split across horses</button>
              </div>

              {splitType === "single" ? (
                <div className={styles.singleWrap}>
                  <label className={styles.fieldLabel}>ASSIGN ENTIRE INVOICE TO</label>
                  <select className={styles.select} value={singleHorseId} onChange={(e) => setSingleHorseId((e.target.value || "") as Id<"horses"> | "")}>
                    <option value="">assign horse...</option>
                    {horses.map((horse) => (
                      <option key={horse._id} value={horse._id}>{horse.name}</option>
                    ))}
                  </select>
                  {assignedRows[0] ? (
                    <div className={styles.singleSummary}>
                      <span>{assignedRows[0].horseName}</span>
                      <span className={styles.rowAmount}>{fmtUSD(assignedRows[0].totalAmount)}</span>
                      {assignedRows[0].adminAmount > 0 ? <span className={styles.adminNote}>+ {fmtUSD(assignedRows[0].adminAmount)} admin</span> : null}
                    </div>
                  ) : null}
                </div>
              ) : (
                <div className={styles.splitWrap}>
                  <label className={styles.fieldLabel}>ADD HORSES TO SPLIT {fmtUSD(assignableTotal)}</label>
                  <select
                    className={styles.select}
                    value=""
                    onChange={(e) => {
                      const value = e.target.value as Id<"horses">;
                      if (!value || splitHorseIds.includes(value)) return;
                      setSplitHorseIds((prev) => [...prev, value]);
                    }}
                  >
                    <option value="">+ add horse...</option>
                    {horses
                      .filter((horse) => !splitHorseIds.includes(horse._id))
                      .map((horse) => (
                        <option key={horse._id} value={horse._id}>{horse.name}</option>
                      ))}
                  </select>

                  {splitHorseIds.length > 0 ? (
                    <div className={styles.modeRow}>
                      <button type="button" className={splitMode === "even" ? styles.modeActive : styles.modeBtn} onClick={() => setSplitMode("even")}>even split</button>
                      <button type="button" className={splitMode === "custom" ? styles.modeActive : styles.modeBtn} onClick={() => setSplitMode("custom")}>custom split</button>
                    </div>
                  ) : null}

                  <div className={styles.peopleList}>
                    {splitHorseIds.map((horseId) => {
                      const horse = horses.find((row) => row._id === horseId);
                      const summary = assignedRows.find((row) => row.horseId === horseId);
                      const evenAmount = summary?.totalAmount ?? 0;
                      const adminShare = summary?.adminAmount ?? 0;
                      if (!horse) return null;
                      return (
                        <div key={horseId} className={styles.personRow}>
                          <div className={styles.personLeft}>
                            <button type="button" className={styles.removeBtn} onClick={() => setSplitHorseIds((prev) => prev.filter((id) => id !== horseId))}>×</button>
                            <span>{horse.name}</span>
                          </div>
                          {splitMode === "even" ? (
                            <div className={styles.rowAmountWrap}>
                              <span className={styles.rowAmount}>{fmtUSD(evenAmount)}</span>
                              {adminShare > 0 ? <span className={styles.adminNote}>+ {fmtUSD(adminShare)} admin</span> : null}
                            </div>
                          ) : (
                            <div className={styles.rowAmountWrap}>
                              <input
                                className={styles.amountInput}
                                type="number"
                                step="0.01"
                                value={customAmounts[String(horseId)] || ""}
                                onChange={(e) => setCustomAmounts((prev) => ({ ...prev, [String(horseId)]: e.target.value }))}
                              />
                              {adminShare > 0 ? <span className={styles.adminNote}>+ {fmtUSD(adminShare)} admin</span> : null}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  <div className={styles.splitSummary}>
                    <span>{splitHorseIds.length} horses · {splitMode} split</span>
                    {splitMode === "custom" ? (
                      Math.abs(customDelta) <= 0.01 ? <span className={styles.ok}>✓ balanced</span> : <span className={styles.bad}>{customDelta > 0 ? `${fmtUSD(customDelta)} remaining` : `${fmtUSD(Math.abs(customDelta))} over`}</span>
                    ) : null}
                  </div>
                </div>
              )}

              <button type="button" className={canSaveAssignment ? styles.saveBtn : styles.saveBtnDisabled} disabled={!canSaveAssignment || isSaving} onClick={onSaveAssignment}>
                {isSaving ? "saving..." : "save assignment"}
              </button>
            </>
          )}
        </section>

        <section className={styles.approvalRow}>
          {bill.isApproved ? (
            <div className={styles.approvedBox}>✓ invoice approved</div>
          ) : (
            <button
              type="button"
              className={assignmentSaved ? styles.approveBtn : styles.approveDisabled}
              disabled={!assignmentSaved || isApproving}
              onClick={onApprove}
            >
              {assignmentSaved ? (isApproving ? "approving..." : "approve invoice") : "assign horses before approving"}
            </button>
          )}
          <button type="button" className={styles.deleteBtn} onClick={() => setShowDeleteConfirm(true)}>
            delete
          </button>
        </section>

        <section className={styles.summaryBar}>
          <div className={styles.summaryLeft}>
            <Summary label="ITEMS" value={String(lineItems.length)} />
            <Summary label="FEED" value={fmtUSD(feedTotal)} />
            <Summary label="BEDDING" value={fmtUSD(beddingTotal)} />
            <Summary label="ADMIN" value={fmtUSD(adminTotal)} />
            <Summary label="HORSES" value={String(assignedRows.length)} />
            <Summary label="STATUS" value={bill.isApproved ? "APPROVED" : "PENDING"} valueClassName={bill.isApproved ? styles.greenText : styles.amberText} />
          </div>
          <div>
            <div className={styles.summaryLabel}>TOTAL DUE</div>
            <div className={styles.summaryTotal}>{fmtUSD(total)}</div>
          </div>
        </section>

        <div className="ui-footer">OLD_OAK_HORSES // FEED_BEDDING // {providerSlug.toUpperCase()}</div>

        <Modal open={showDeleteConfirm} title="delete invoice?" onClose={() => setShowDeleteConfirm(false)}>
          <p className={styles.modalBody}>
            this will permanently delete invoice <strong>{String(extracted.invoice_number ?? billId)}</strong>.
          </p>
          <p className={styles.modalSub}>this action cannot be undone.</p>
          <div className={styles.modalActions}>
            <button type="button" className="ui-button-outlined" onClick={() => setShowDeleteConfirm(false)}>cancel</button>
            <button type="button" className={styles.confirmDelete} onClick={onDelete}>yes, delete invoice</button>
          </div>
        </Modal>
      </main>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className={styles.detailLabel}>{label}</div>
      <div className={styles.detailValue}>{value}</div>
    </div>
  );
}

function Summary({ label, value, valueClassName }: { label: string; value: string; valueClassName?: string }) {
  return (
    <div>
      <div className={styles.summaryLabel}>{label}</div>
      <div className={valueClassName ?? styles.summaryValue}>{value}</div>
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

function normalizeFeedBeddingType(value: unknown): FeedBeddingType {
  const source = String(value ?? "").toLowerCase();
  if (source.includes("bedding")) return "bedding";
  if (source.includes("admin")) return "admin";
  return "feed";
}
