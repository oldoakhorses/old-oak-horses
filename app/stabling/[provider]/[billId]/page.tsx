"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import NavBar from "@/components/NavBar";
import HorseSelect from "@/components/HorseSelect";
import styles from "./stablingInvoice.module.css";

type SplitMode = "even" | "custom";

type SplitState = {
  horseIds: string[];
  mode: SplitMode;
  customAmounts: Record<string, string>;
};

const SPLIT_VALUE = "__split__";

export default function StablingInvoicePage() {
  const params = useParams<{ provider: string; billId: string }>();
  const providerSlug = params?.provider ?? "";
  const billId = params?.billId as Id<"bills">;
  const router = useRouter();

  const bill = useQuery(api.bills.getBillById, billId ? { billId } : "skip");
  const horses = useQuery(api.horses.getActiveHorses) ?? [];

  const saveHorseAssignment = useMutation(api.bills.saveHorseAssignment);
  const approveInvoice = useMutation(api.bills.approveInvoice);
  const deleteBill = useMutation(api.bills.deleteBill);

  const [editing, setEditing] = useState(false);
  const [lineAssignments, setLineAssignments] = useState<Record<number, string>>({});
  const [splitState, setSplitState] = useState<Record<number, SplitState>>({});
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [saving, setSaving] = useState(false);

  const extracted = (bill?.extractedData ?? {}) as Record<string, any>;
  const lineItems = Array.isArray(extracted.line_items) ? extracted.line_items : [];
  const invoiceTotal = getInvoiceTotalUsd(extracted);

  const horsesById = useMemo(() => new Map(horses.map((horse) => [String(horse._id), horse])), [horses]);
  const horseIdByName = useMemo(() => {
    const map = new Map<string, string>();
    for (const horse of horses) {
      map.set(horse.name.toLowerCase().trim(), String(horse._id));
    }
    return map;
  }, [horses]);

  useEffect(() => {
    if (!bill) return;

    if ((bill.horseAssignments ?? []).length === 0 && (bill.splitLineItems ?? []).length === 0) {
      const nextAssignments: Record<number, string> = {};
      for (let idx = 0; idx < lineItems.length; idx += 1) {
        const row = lineItems[idx] ?? {};
        const horseName = String(row.horse_name ?? row.horseName ?? "").trim();
        if (!horseName) continue;
        const horseId = horseIdByName.get(horseName.toLowerCase());
        if (horseId) nextAssignments[idx] = horseId;
      }
      setLineAssignments(nextAssignments);
      setSplitState({});
      setEditing(true);
      return;
    }

    const nextAssignments: Record<number, string> = {};
    for (const row of bill.horseAssignments ?? []) {
      if (row.horseId) nextAssignments[row.lineItemIndex] = String(row.horseId);
      else nextAssignments[row.lineItemIndex] = "";
    }

    const nextSplits: Record<number, SplitState> = {};
    for (const row of bill.splitLineItems ?? []) {
      nextAssignments[row.lineItemIndex] = SPLIT_VALUE;
      nextSplits[row.lineItemIndex] = {
        horseIds: row.splits.map((item) => String(item.horseId)),
        mode: "custom",
        customAmounts: row.splits.reduce((acc, item) => {
          acc[String(item.horseId)] = item.amount.toFixed(2);
          return acc;
        }, {} as Record<string, string>)
      };
    }

    setLineAssignments(nextAssignments);
    setSplitState(nextSplits);
    setEditing(false);
  }, [bill, horseIdByName, lineItems]);

  const splitAmountsByIndex = useMemo(() => {
    const entries = new Map<number, Array<{ horseId: string; amount: number }>>();
    for (const [key, split] of Object.entries(splitState)) {
      const lineIndex = Number(key);
      const lineTotal = getLineAmount(lineItems[lineIndex]);
      if (!Number.isFinite(lineTotal)) continue;

      if (split.mode === "even") {
        if (split.horseIds.length === 0) {
          entries.set(lineIndex, []);
          continue;
        }
        const even = round2(lineTotal / split.horseIds.length);
        const values = split.horseIds.map((horseId, idx) => {
          if (idx === split.horseIds.length - 1) {
            return { horseId, amount: round2(lineTotal - even * (split.horseIds.length - 1)) };
          }
          return { horseId, amount: even };
        });
        entries.set(lineIndex, values);
      } else {
        const values = split.horseIds.map((horseId) => ({ horseId, amount: round2(Number(split.customAmounts[horseId] || 0)) }));
        entries.set(lineIndex, values);
      }
    }
    return entries;
  }, [lineItems, splitState]);

  const autoDetectedCount = useMemo(
    () => lineItems.filter((row: any) => String(row?.horse_name ?? row?.horseName ?? "").trim().length > 0).length,
    [lineItems]
  );

  const summaryByHorse = useMemo(() => {
    const map = new Map<string, { horseName: string; total: number; lineItemCount: number }>();
    let unassigned = 0;

    for (let idx = 0; idx < lineItems.length; idx += 1) {
      const assignment = lineAssignments[idx] ?? "";
      const amount = getLineAmount(lineItems[idx]);

      if (!assignment) {
        unassigned += amount;
        continue;
      }

      if (assignment === SPLIT_VALUE) {
        const splitValues = splitAmountsByIndex.get(idx) ?? [];
        if (splitValues.length === 0) {
          unassigned += amount;
          continue;
        }
        for (const row of splitValues) {
          const horseName = horsesById.get(row.horseId)?.name ?? "Unknown";
          const current = map.get(row.horseId) ?? { horseName, total: 0, lineItemCount: 0 };
          current.total += row.amount;
          current.lineItemCount += 1;
          map.set(row.horseId, current);
        }
        continue;
      }

      const horseName = horsesById.get(assignment)?.name ?? "Unknown";
      const current = map.get(assignment) ?? { horseName, total: 0, lineItemCount: 0 };
      current.total += amount;
      current.lineItemCount += 1;
      map.set(assignment, current);
    }

    return {
      rows: [...map.values()].sort((a, b) => b.total - a.total),
      unassigned: round2(unassigned)
    };
  }, [horsesById, lineAssignments, lineItems, splitAmountsByIndex]);

  const validation = useMemo(() => {
    let assignedCount = 0;
    let allAssigned = true;
    let splitsBalanced = true;

    for (let idx = 0; idx < lineItems.length; idx += 1) {
      const assignment = lineAssignments[idx] ?? "";
      if (!assignment) {
        allAssigned = false;
        continue;
      }

      if (assignment === SPLIT_VALUE) {
        const split = splitState[idx];
        if (!split || split.horseIds.length < 2) {
          allAssigned = false;
          continue;
        }
        const splitRows = splitAmountsByIndex.get(idx) ?? [];
        const splitTotal = splitRows.reduce((sum, row) => sum + row.amount, 0);
        const lineTotal = getLineAmount(lineItems[idx]);
        if (Math.abs(lineTotal - splitTotal) > 0.01) {
          splitsBalanced = false;
        }
        assignedCount += 1;
        continue;
      }

      assignedCount += 1;
    }

    return {
      assignedCount,
      totalCount: lineItems.length,
      allAssigned,
      splitsBalanced,
      canSave: lineItems.length > 0 && allAssigned && splitsBalanced
    };
  }, [lineAssignments, lineItems, splitAmountsByIndex, splitState]);

  const assignmentSaved = Boolean(((bill?.horseAssignments ?? []).length > 0 || (bill?.splitLineItems ?? []).length > 0) && !editing);

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
    if (!validation.canSave) return;
    setSaving(true);
    try {
      const horseAssignments: Array<{ lineItemIndex: number; horseId?: Id<"horses">; horseName?: string }> = [];
      const splitLineItems: Array<{
        lineItemIndex: number;
        splits: Array<{ horseId: Id<"horses">; horseName: string; amount: number }>;
      }> = [];

      for (let idx = 0; idx < lineItems.length; idx += 1) {
        const assignment = lineAssignments[idx] ?? "";
        if (!assignment) continue;

        if (assignment === SPLIT_VALUE) {
          const splitRows = splitAmountsByIndex.get(idx) ?? [];
          splitLineItems.push({
            lineItemIndex: idx,
            splits: splitRows.map((row) => ({
              horseId: row.horseId as Id<"horses">,
              horseName: horsesById.get(row.horseId)?.name ?? "Unknown",
              amount: row.amount
            }))
          });
          continue;
        }

        horseAssignments.push({
          lineItemIndex: idx,
          horseId: assignment as Id<"horses">,
          horseName: horsesById.get(assignment)?.name
        });
      }

      await saveHorseAssignment({ billId, horseAssignments, splitLineItems });
      setEditing(false);
    } finally {
      setSaving(false);
    }
  }

  async function onApprove() {
    await approveInvoice({ billId });
  }

  async function onDelete() {
    await deleteBill({ billId });
    router.push(`/stabling/${providerSlug}`);
  }

  return (
    <div className="page-shell">
      <NavBar
        items={[
          { label: "old-oak-horses", href: "/dashboard", brand: true },
          { label: "stabling", href: "/stabling" },
          { label: providerSlug, href: `/stabling/${providerSlug}` },
          { label: extracted.invoice_number || "invoice", current: true }
        ]}
        actions={[{ label: "biz overview", href: "/biz-overview", variant: "filled" }]}
      />

      <main className="page-main">
        <div className={styles.topRow}>
          <Link href={`/stabling/${providerSlug}`} className="ui-back-link">
            ← cd /stabling/{providerSlug}
          </Link>
          {bill.originalPdfUrl ? (
            <a href={bill.originalPdfUrl} target="_blank" rel="noreferrer" className={styles.pdfLink}>
              view original PDF
            </a>
          ) : null}
        </div>

        <section className={styles.headerCard}>
          <div>
            <div className={styles.labelRow}>
              <span className="ui-label">STABLING INVOICE</span>
            </div>
            <h1 className={styles.provider}>{extracted.provider_name || bill.provider?.fullName || bill.provider?.name || "Stabling Provider"}</h1>
            <div className={styles.details}>
              <Detail label="INVOICE #" value={extracted.invoice_number || bill.fileName} />
              <Detail label="DATE" value={extracted.invoice_date || extracted.period || "—"} />
              <Detail label="ACCOUNT" value={extracted.account_number || bill.provider?.accountNumber || "—"} />
              {bill.originalCurrency && bill.originalCurrency !== "USD" ? (
                <Detail label="RATE" value={`1 ${bill.originalCurrency} = ${(bill.exchangeRate ?? 1).toFixed(2)} USD`} />
              ) : null}
            </div>
          </div>
          <div className={styles.totalBox}>
            <div className="ui-label">INVOICE TOTAL</div>
            <div className={styles.total}>{fmtUSD(invoiceTotal)}</div>
            {bill.originalCurrency && bill.originalCurrency !== "USD" && typeof bill.originalTotal === "number" ? (
              <div className={styles.from}>from {formatMoneyWithCurrency(bill.originalCurrency, bill.originalTotal)}</div>
            ) : null}
          </div>
        </section>

        <section className={assignmentSaved ? styles.assignmentSavedCard : styles.assignmentCard}>
          {assignmentSaved ? (
            <div className={styles.savedRow}>
              <div>
                <div className={styles.savedTitle}>assigned to {summaryByHorse.rows.length} horses</div>
                <div className={styles.savedPeople}>
                  {summaryByHorse.rows.map((row) => (
                    <span key={row.horseName} className={styles.savedPill}>{row.horseName} ({fmtUSD(row.total)})</span>
                  ))}
                </div>
              </div>
              <button type="button" className="ui-button-outlined" onClick={() => setEditing(true)}>
                edit
              </button>
            </div>
          ) : (
            <>
              <div className={styles.assignHead}>assign_horses</div>
              <div className={styles.question}>{validation.assignedCount}/{validation.totalCount} assigned</div>

              {autoDetectedCount > 0 ? (
                <div className={styles.autoNotice}>✓ auto-detected horses on {autoDetectedCount} of {lineItems.length} line items</div>
              ) : null}

              <div className={styles.lineRows}>
                {lineItems.map((item: any, idx: number) => {
                  const assignment = lineAssignments[idx] ?? "";
                  const split = splitState[idx];
                  const splitValues = splitAmountsByIndex.get(idx) ?? [];
                  const isUnassigned = !assignment;

                  return (
                    <div key={`${idx}-${item.description || "line"}`} className={`${styles.lineRow} ${isUnassigned ? styles.unassignedRow : ""}`}>
                      <div className={styles.lineLeft}>
                        <div className={styles.desc}>{item.description || "—"}</div>
                        <div className={styles.lineMeta}>
                          <span className={styles.subcategoryBadge}>{titleCase(classifyStablingSubcategory(item))}</span>
                          {String(item.horse_name ?? item.horseName ?? "").trim() ? <span className={styles.autoBadge}>auto</span> : null}
                        </div>
                      </div>

                      <div className={styles.lineRight}>
                        <HorseSelect
                          value={assignment}
                          onChange={(value) => {
                            setLineAssignments((prev) => ({ ...prev, [idx]: value }));
                            if (value !== SPLIT_VALUE) {
                              setSplitState((prev) => {
                                const next = { ...prev };
                                delete next[idx];
                                return next;
                              });
                            } else {
                              setSplitState((prev) => ({
                                ...prev,
                                [idx]: prev[idx] ?? { horseIds: [], mode: "even", customAmounts: {} }
                              }));
                            }
                          }}
                          compact
                          showSplitOption
                          splitValue={SPLIT_VALUE}
                        />
                        <span className={styles.rowAmount}>{fmtUSD(getLineAmount(item))}</span>
                      </div>

                      {assignment === SPLIT_VALUE ? (
                        <div className={styles.splitPanel}>
                          <HorseSelect
                            value=""
                            onChange={(value) => {
                              if (!value || value === SPLIT_VALUE) return;
                              setSplitState((prev) => {
                                const current = prev[idx] ?? { horseIds: [], mode: "even", customAmounts: {} };
                                if (current.horseIds.includes(value)) return prev;
                                return {
                                  ...prev,
                                  [idx]: { ...current, horseIds: [...current.horseIds, value] }
                                };
                              });
                            }}
                            compact
                          />

                          <div className={styles.modeRow}>
                            <button
                              type="button"
                              className={split?.mode === "even" ? styles.modeActive : styles.modeBtn}
                              onClick={() => setSplitState((prev) => ({
                                ...prev,
                                [idx]: { ...(prev[idx] ?? { horseIds: [], customAmounts: {} }), mode: "even" }
                              }))}
                            >
                              even
                            </button>
                            <button
                              type="button"
                              className={split?.mode === "custom" ? styles.modeActive : styles.modeBtn}
                              onClick={() => setSplitState((prev) => ({
                                ...prev,
                                [idx]: { ...(prev[idx] ?? { horseIds: [], customAmounts: {} }), mode: "custom" }
                              }))}
                            >
                              custom
                            </button>
                          </div>

                          <div className={styles.peopleList}>
                            {(split?.horseIds ?? []).map((horseId) => {
                              const horseName = horsesById.get(horseId)?.name ?? "Unknown";
                              const splitAmount = splitValues.find((row) => row.horseId === horseId)?.amount ?? 0;
                              return (
                                <div key={`${idx}-${horseId}`} className={styles.personRow}>
                                  <div className={styles.personLeft}>
                                    <button
                                      type="button"
                                      className={styles.removeBtn}
                                      onClick={() => setSplitState((prev) => {
                                        const current = prev[idx];
                                        if (!current) return prev;
                                        return {
                                          ...prev,
                                          [idx]: {
                                            ...current,
                                            horseIds: current.horseIds.filter((id) => id !== horseId)
                                          }
                                        };
                                      })}
                                    >
                                      ×
                                    </button>
                                    <span>🐴 {horseName}</span>
                                  </div>
                                  {split?.mode === "custom" ? (
                                    <input
                                      className={styles.amountInput}
                                      type="number"
                                      step="0.01"
                                      value={split.customAmounts[horseId] || ""}
                                      onChange={(event) => setSplitState((prev) => {
                                        const current = prev[idx] ?? { horseIds: [], mode: "custom", customAmounts: {} };
                                        return {
                                          ...prev,
                                          [idx]: {
                                            ...current,
                                            customAmounts: { ...current.customAmounts, [horseId]: event.target.value }
                                          }
                                        };
                                      })}
                                    />
                                  ) : (
                                    <span className={styles.rowAmount}>{fmtUSD(splitAmount)}</span>
                                  )}
                                </div>
                              );
                            })}
                          </div>

                          {split?.mode === "custom" ? (
                            <div className={styles.splitSummary}>
                              {Math.abs(getLineAmount(item) - splitValues.reduce((sum, row) => sum + row.amount, 0)) <= 0.01 ? (
                                <span className={styles.ok}>✓ balanced</span>
                              ) : (
                                <span className={styles.bad}>
                                  {fmtUSD(Math.abs(getLineAmount(item) - splitValues.reduce((sum, row) => sum + row.amount, 0)))} remaining
                                </span>
                              )}
                            </div>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>

              <div className={styles.summaryBlock}>
                <div className={styles.fieldLabel}>COST BY HORSE</div>
                <div className={styles.savedPeople}>
                  {summaryByHorse.rows.map((row) => (
                    <span key={row.horseName} className={styles.savedPill}>🐴 {row.horseName} · {row.lineItemCount} items · {fmtUSD(row.total)}</span>
                  ))}
                  {summaryByHorse.unassigned > 0 ? <span className={styles.unassignedPill}>Unassigned · {fmtUSD(summaryByHorse.unassigned)}</span> : null}
                </div>
              </div>

              <button
                type="button"
                className={validation.canSave ? styles.saveBtn : styles.saveBtnDisabled}
                disabled={!validation.canSave || saving}
                onClick={onSaveAssignment}
              >
                {saving ? "saving..." : !validation.allAssigned ? "assign all line items" : !validation.splitsBalanced ? "balance split amounts" : "save assignment"}
              </button>
            </>
          )}
        </section>

        <section className={styles.approvalRow}>
          {bill.isApproved ? (
            <div className={styles.approvedBox}>✓ invoice approved</div>
          ) : (
            <button type="button" className={assignmentSaved ? styles.approveBtn : styles.approveDisabled} disabled={!assignmentSaved} onClick={onApprove}>
              {assignmentSaved ? "approve invoice" : "assign horses before approving"}
            </button>
          )}

          <button type="button" className={styles.deleteBtn} onClick={() => setShowDeleteConfirm(true)}>
            delete
          </button>
        </section>

        <section className={styles.summaryBar}>
          <div className={styles.summaryLeft}>
            <Summary label="CURRENCY" value={bill.originalCurrency || "USD"} />
            {bill.originalCurrency && bill.originalCurrency !== "USD" ? <Summary label="RATE" value={(bill.exchangeRate ?? 1).toFixed(2)} /> : null}
            <Summary label="ITEMS" value={String(lineItems.length)} />
            <Summary label="HORSES" value={String(summaryByHorse.rows.length)} />
            <Summary label="STATUS" value={bill.isApproved ? "APPROVED" : "PENDING"} valueClassName={bill.isApproved ? styles.greenText : styles.amberText} />
          </div>
          <div>
            <div className={styles.summaryLabel}>TOTAL DUE</div>
            <div className={styles.summaryTotal}>{fmtUSD(invoiceTotal)}</div>
          </div>
        </section>

        <div className="ui-footer">OLD_OAK_HORSES // STABLING // {providerSlug.toUpperCase()}</div>
      </main>

      {showDeleteConfirm ? (
        <div className={styles.modalBackdrop} onMouseDown={(e) => e.target === e.currentTarget && setShowDeleteConfirm(false)}>
          <div className={styles.modalCard}>
            <div className={styles.modalTitle}>⚠ delete invoice?</div>
            <p className={styles.modalBody}>
              this will permanently delete invoice <strong>{extracted.invoice_number || bill.fileName}</strong> from {extracted.provider_name || bill.provider?.name || "provider"}.
            </p>
            <p className={styles.modalSub}>this action cannot be undone.</p>
            <div className={styles.modalActions}>
              <button type="button" className="ui-button-outlined" onClick={() => setShowDeleteConfirm(false)}>cancel</button>
              <button type="button" className={styles.confirmDelete} onClick={onDelete}>yes, delete invoice</button>
            </div>
          </div>
        </div>
      ) : null}
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

function classifyStablingSubcategory(item: Record<string, unknown>) {
  const raw = String(item.stabling_subcategory ?? item.subcategory ?? "").trim().toLowerCase();
  if (["board", "turnout", "bedding", "hay-feed", "facility-fees", "other"].includes(raw)) return raw;
  const description = String(item.description ?? "").toLowerCase();
  if (description.includes("turnout") || description.includes("paddock")) return "turnout";
  if (description.includes("bedding")) return "bedding";
  if (description.includes("hay") || description.includes("feed")) return "hay-feed";
  if (description.includes("facility")) return "facility-fees";
  return "board";
}

function getLineAmount(item: any) {
  if (typeof item?.total_usd === "number") return item.total_usd;
  if (typeof item?.amount_usd === "number") return item.amount_usd;
  return 0;
}

function getInvoiceTotalUsd(extracted: Record<string, unknown>) {
  if (typeof extracted?.invoice_total_usd === "number") return extracted.invoice_total_usd as number;
  const lineItems = Array.isArray(extracted.line_items) ? extracted.line_items : [];
  return lineItems.reduce((sum: number, row: any) => sum + getLineAmount(row), 0);
}

function round2(value: number) {
  return Math.round(value * 100) / 100;
}

function formatMoneyWithCurrency(currency: string, amount: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency, minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount);
}

function titleCase(value: string) {
  return value
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function fmtUSD(v: number) {
  return `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
