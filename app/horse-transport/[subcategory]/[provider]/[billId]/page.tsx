"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useMutation, useQuery } from "convex/react";
import type { Id } from "@/convex/_generated/dataModel";
import { api } from "@/convex/_generated/api";
import NavBar from "@/components/NavBar";
import Modal from "@/components/Modal";
import styles from "./invoice.module.css";

type AssignmentMode = "line_item" | "split";
type SplitMode = "even" | "custom";

type LineItem = {
  description?: string;
  horse_name?: string;
  horse_name_raw?: string;
  matchConfidence?: string;
  match_confidence?: string;
  matchedHorseId?: string;
  matched_horse_id?: string;
  total_usd?: number;
};

type Extracted = {
  provider_name?: string;
  invoice_number?: string;
  invoice_date?: string;
  due_date?: string;
  origin?: string;
  destination?: string;
  invoice_total_usd?: number;
  line_items?: LineItem[];
};

export default function HorseTransportInvoicePage() {
  const router = useRouter();
  const params = useParams<{ subcategory: string; provider: string; billId: string }>();
  const subcategory = params?.subcategory ?? "";
  const providerSlug = params?.provider ?? "";
  const billId = params?.billId as Id<"bills">;

  const bill = useQuery(api.bills.getBillById, billId ? { billId } : "skip");
  const provider = useQuery(api.providers.getProviderBySlug, { categorySlug: "horse-transport", providerSlug });
  const horses = useQuery(api.horses.getActiveHorses) ?? [];

  const approveBill = useMutation(api.bills.approveBill);
  const deleteBill = useMutation(api.bills.deleteBill);
  const saveTransportAssignment = useMutation(api.bills.saveHorseTransportAssignment);

  const [mode, setMode] = useState<AssignmentMode>("line_item");
  const [lineAssignments, setLineAssignments] = useState<Record<number, string>>({});
  const [cardEditing, setCardEditing] = useState<Record<string, boolean>>({});
  const [splitHorseIds, setSplitHorseIds] = useState<string[]>([]);
  const [splitMode, setSplitMode] = useState<SplitMode>("even");
  const [customAmounts, setCustomAmounts] = useState<Record<string, string>>({});
  const [assignmentSaved, setAssignmentSaved] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isApproving, setIsApproving] = useState(false);

  const extracted = (bill?.extractedData ?? {}) as Extracted;
  const lineItems = Array.isArray(extracted.line_items) ? extracted.line_items : [];

  const total = typeof extracted.invoice_total_usd === "number" ? extracted.invoice_total_usd : lineItems.reduce((sum, row) => sum + safe(row.total_usd), 0);

  const horsesById = useMemo(() => new Map(horses.map((horse) => [String(horse._id), horse])), [horses]);
  const horseIdByName = useMemo(() => {
    const map = new Map<string, string>();
    for (const horse of horses) {
      map.set(normalize(horse.name), String(horse._id));
    }
    return map;
  }, [horses]);

  useEffect(() => {
    if (!bill) return;
    const nextAssignments: Record<number, string> = {};
    for (const row of bill.horseAssignments ?? []) {
      if (row.horseId) nextAssignments[row.lineItemIndex] = String(row.horseId);
    }
    for (let idx = 0; idx < lineItems.length; idx += 1) {
      if (nextAssignments[idx]) continue;
      const item = lineItems[idx] ?? {};
      const matchedId = String((item as any).matched_horse_id ?? (item as any).matchedHorseId ?? "").trim();
      if (matchedId && horsesById.has(matchedId)) {
        nextAssignments[idx] = matchedId;
        continue;
      }
      const horseName = String(item.horse_name ?? "").trim();
      const byName = horseIdByName.get(normalize(horseName));
      if (byName) nextAssignments[idx] = byName;
    }
    setLineAssignments(nextAssignments);

    if ((bill.assignedHorses ?? []).length > 0) {
      setMode("split");
      setSplitHorseIds((bill.assignedHorses ?? []).map((row) => String(row.horseId)));
      const nextCustom: Record<string, string> = {};
      for (const row of bill.assignedHorses ?? []) nextCustom[String(row.horseId)] = row.amount.toFixed(2);
      setCustomAmounts(nextCustom);
      setSplitMode("custom");
      setAssignmentSaved(true);
      return;
    }

    const parserFoundHorses = lineItems.some((item) => Boolean(String(item.horse_name ?? "").trim()));
    setMode(parserFoundHorses ? "line_item" : "split");
    setAssignmentSaved((bill.horseAssignments ?? []).length > 0 && parserFoundHorses);
  }, [bill, horseIdByName, horsesById, lineItems]);

  const lineRows = useMemo(
    () =>
      lineItems.map((item, index) => {
        const assignedHorseId = lineAssignments[index] ?? "";
        const assignedHorseName = horsesById.get(assignedHorseId)?.name;
        const parsedHorse = String(item.horse_name ?? "").trim();
        const parsedRaw = String((item as any).horse_name_raw ?? "").trim();
        const confidence = String((item as any).matchConfidence ?? (item as any).match_confidence ?? "").toLowerCase();
        return {
          index,
          description: item.description ?? "—",
          amount: safe(item.total_usd),
          assignedHorseId,
          assignedHorseName,
          parsedHorse,
          parsedRaw,
          confidence
        };
      }),
    [horsesById, lineAssignments, lineItems]
  );

  const groupedByHorse = useMemo(() => {
    const map = new Map<string, typeof lineRows>();
    for (const row of lineRows) {
      if (!row.assignedHorseId) continue;
      const name = row.assignedHorseName ?? "Unknown";
      map.set(name, [...(map.get(name) ?? []), row]);
    }
    return [...map.entries()].map(([horseName, rows]) => ({
      horseName,
      rows,
      total: round2(rows.reduce((sum, row) => sum + row.amount, 0))
    }));
  }, [lineRows]);

  const unassignedRows = useMemo(() => lineRows.filter((row) => !row.assignedHorseId), [lineRows]);
  const allLineItemsAssigned = lineRows.length > 0 && unassignedRows.length === 0;

  const computedSplitRows = useMemo(() => {
    if (splitHorseIds.length === 0) return [] as Array<{ horseId: string; horseName: string; amount: number }>;
    if (splitMode === "even") {
      const per = round2(total / splitHorseIds.length);
      return splitHorseIds.map((horseId, index) => ({
        horseId,
        horseName: horsesById.get(horseId)?.name ?? "Unknown",
        amount: index === splitHorseIds.length - 1 ? round2(total - per * (splitHorseIds.length - 1)) : per
      }));
    }
    return splitHorseIds.map((horseId) => ({
      horseId,
      horseName: horsesById.get(horseId)?.name ?? "Unknown",
      amount: round2(Number(customAmounts[horseId] ?? 0))
    }));
  }, [customAmounts, horsesById, splitHorseIds, splitMode, total]);

  const splitDelta = useMemo(() => round2(total - computedSplitRows.reduce((sum, row) => sum + row.amount, 0)), [computedSplitRows, total]);
  const splitValid = splitHorseIds.length >= 2 && (splitMode === "even" || Math.abs(splitDelta) <= 0.01);
  const canSave = mode === "line_item" ? allLineItemsAssigned : splitValid;
  const horsesCountForFooter = mode === "line_item" ? groupedByHorse.length : computedSplitRows.length;
  const canApprove = bill?.status === "done" ? false : assignmentSaved && (mode === "line_item" ? allLineItemsAssigned : splitValid);

  if (!bill) {
    return (
      <div className="page-shell">
        <main className="page-main">
          <section className="ui-card">Loading invoice...</section>
        </main>
      </div>
    );
  }

  async function onSave() {
    if (!canSave || isSaving) return;
    setIsSaving(true);
    try {
      if (mode === "line_item") {
        await saveTransportAssignment({
          billId,
          mode: "line_item",
          horseAssignments: lineRows.map((row) => ({
            lineItemIndex: row.index,
            horseId: row.assignedHorseId ? (row.assignedHorseId as Id<"horses">) : undefined,
            horseName: row.assignedHorseName ?? undefined
          })),
          splitLineItems: []
        });
      } else {
        await saveTransportAssignment({
          billId,
          mode: "split",
          splitType: "split",
          assignedHorses: computedSplitRows.map((row) => ({
            horseId: row.horseId as Id<"horses">,
            horseName: row.horseName,
            amount: row.amount
          }))
        });
      }
      setAssignmentSaved(true);
    } finally {
      setIsSaving(false);
    }
  }

  async function onApprove() {
    if (!canApprove || isApproving) return;
    setIsApproving(true);
    try {
      await approveBill({ billId });
    } finally {
      setIsApproving(false);
    }
  }

  async function onDelete() {
    await deleteBill({ billId });
    router.push(`/horse-transport/${subcategory}/${providerSlug}`);
  }

  const providerName = extracted.provider_name || provider?.fullName || provider?.name || providerSlug;
  const routeValue = `${extracted.origin || "—"} → ${extracted.destination || "—"}`;

  return (
    <div className="page-shell">
      <NavBar
        items={[
          { label: "old-oak-horses", href: "/dashboard", brand: true },
          { label: "horse_transport", href: "/horse-transport" },
          { label: subcategory, href: `/horse-transport/${subcategory}` },
          { label: providerSlug, href: `/horse-transport/${subcategory}/${providerSlug}` },
          { label: extracted.invoice_number ?? "invoice", current: true }
        ]}
        actions={bill.originalPdfUrl ? [{ label: "view original PDF", href: bill.originalPdfUrl, variant: "link", newTab: true }] : []}
      />

      <main className="page-main">
        <div className={styles.topRow}>
          <Link className="ui-back-link" href={`/horse-transport/${subcategory}/${providerSlug}`}>
            ← cd /{providerSlug}
          </Link>
        </div>

        <section className={styles.headerCard}>
          <div className={styles.headerLeft}>
            <div className={styles.label}>HORSE TRANSPORT INVOICE</div>
            <h1 className={styles.providerName}>{providerName}</h1>
            <div className={styles.detailsRow}>
              <Detail label="INVOICE #" value={String(extracted.invoice_number ?? bill.fileName)} />
              <Detail label="DATE" value={formatDate(extracted.invoice_date)} />
              <Detail label="DUE DATE" value={formatDate(extracted.due_date)} />
              <Detail label="ROUTE" value={routeValue} />
            </div>
          </div>
          <div className={styles.totalBlock}>
            <div className={styles.totalLabel}>INVOICE TOTAL</div>
            <div className={styles.totalAmount}>{fmtUSD(total)}</div>
          </div>
        </section>

        <section className={assignmentSaved ? styles.assignmentCardComplete : styles.assignmentCard}>
          <div className={styles.assignTitle}>🐴 assign_horses</div>
          <div className={styles.assignQuestion}>how should transport costs be assigned?</div>
          <div className={styles.modeToggle}>
            <button
              type="button"
              className={mode === "line_item" ? styles.modeBtnActive : styles.modeBtn}
              onClick={() => {
                setMode("line_item");
                setAssignmentSaved(false);
              }}
            >
              by line item
            </button>
            <button
              type="button"
              className={mode === "split" ? styles.modeBtnActive : styles.modeBtn}
              onClick={() => {
                setMode("split");
                setAssignmentSaved(false);
              }}
            >
              split across horses
            </button>
          </div>

          {mode === "line_item" ? (
            <div>
              {groupedByHorse.map((group) => {
                const isEditingCard = cardEditing[group.horseName] === true;
                return (
                  <section key={group.horseName} className={styles.horseCard}>
                    <div className={styles.horseHeader}>
                      <div className={styles.horseHeaderLeft}>
                        <span className={styles.horseEmoji}>🐴</span>
                        <span className={styles.horseName}>{group.horseName}</span>
                        {group.rows.some((row) => row.confidence === "exact" || row.confidence === "alias") ? <span className={styles.autoBadge}>auto</span> : null}
                        {group.rows.some((row) => row.confidence === "fuzzy") ? <span className={styles.fuzzyBadge}>fuzzy</span> : null}
                      </div>
                      <div className={styles.horseHeaderRight}>
                        <span className={styles.horseTotal}>{fmtUSD(group.total)}</span>
                        <button
                          type="button"
                          className={styles.editBtn}
                          onClick={() => setCardEditing((prev) => ({ ...prev, [group.horseName]: !isEditingCard }))}
                        >
                          edit
                        </button>
                      </div>
                    </div>

                    {group.rows.map((row) => (
                      <div key={`line-${row.index}`} className={styles.horseLine}>
                        <div>
                          <div>{row.description}</div>
                          {row.confidence === "fuzzy" && row.parsedRaw && normalize(row.parsedRaw) !== normalize(row.parsedHorse || "") ? (
                            <div className={styles.rawText}>(parsed as "{row.parsedRaw}")</div>
                          ) : null}
                        </div>
                        <div className={styles.lineRight}>
                          {isEditingCard ? (
                            <select
                              className={styles.inlineSelect}
                              value={row.assignedHorseId}
                              onChange={(event) => {
                                setAssignmentSaved(false);
                                setLineAssignments((prev) => ({ ...prev, [row.index]: event.target.value }));
                              }}
                            >
                              <option value="">assign horse...</option>
                              {horses.map((horse) => (
                                <option key={horse._id} value={String(horse._id)}>
                                  {horse.name}
                                </option>
                              ))}
                            </select>
                          ) : null}
                          <span className={styles.lineAmount}>{fmtUSD(row.amount)}</span>
                        </div>
                      </div>
                    ))}
                  </section>
                );
              })}

              {unassignedRows.length > 0 ? (
                <section className={styles.horseCard}>
                  <div className={styles.horseHeader}>
                    <div className={styles.horseHeaderLeft}>
                      <span className={styles.horseEmoji}>🐴</span>
                      <span className={styles.horseName}>unassigned</span>
                      <span className={styles.unmatchedBadge}>unmatched</span>
                    </div>
                  </div>

                  {unassignedRows.map((row) => (
                    <div key={`unassigned-${row.index}`} className={styles.horseLine}>
                      <div>
                        <div>{row.description}</div>
                        {row.parsedHorse ? <div className={styles.rawText}>parsed horse: {row.parsedHorse}</div> : null}
                      </div>
                      <div className={styles.lineRight}>
                        <select
                          className={styles.inlineSelect}
                          value={row.assignedHorseId}
                          onChange={(event) => {
                            setAssignmentSaved(false);
                            setLineAssignments((prev) => ({ ...prev, [row.index]: event.target.value }));
                          }}
                        >
                          <option value="">assign horse...</option>
                          {horses.map((horse) => (
                            <option key={horse._id} value={String(horse._id)}>
                              {horse.name}
                            </option>
                          ))}
                        </select>
                        <span className={styles.lineAmount}>{fmtUSD(row.amount)}</span>
                      </div>
                    </div>
                  ))}
                </section>
              ) : null}
            </div>
          ) : (
            <div className={styles.splitContent}>
              <div className={styles.fieldLabel}>ADD HORSES TO SPLIT {fmtUSD(total)}</div>
              <div className={styles.addRow}>
                <select
                  className={styles.splitSelect}
                  value=""
                  onChange={(event) => {
                    const value = event.target.value;
                    if (!value || splitHorseIds.includes(value)) return;
                    setAssignmentSaved(false);
                    setSplitHorseIds((prev) => [...prev, value]);
                  }}
                >
                  <option value="">+ add horse...</option>
                  {horses
                    .filter((horse) => !splitHorseIds.includes(String(horse._id)))
                    .map((horse) => (
                      <option key={horse._id} value={String(horse._id)}>
                        {horse.name}
                      </option>
                    ))}
                </select>

                <div className={styles.splitModeToggle}>
                  <button type="button" className={splitMode === "even" ? styles.splitModeActive : styles.splitModeBtn} onClick={() => setSplitMode("even")}>
                    even split
                  </button>
                  <button
                    type="button"
                    className={splitMode === "custom" ? styles.splitModeActive : styles.splitModeBtn}
                    onClick={() => setSplitMode("custom")}
                  >
                    custom split
                  </button>
                </div>
              </div>

              <div className={styles.splitList}>
                {computedSplitRows.map((row) => (
                  <div key={`split-${row.horseId}`} className={styles.splitRow}>
                    <div className={styles.splitLeft}>
                      <button
                        type="button"
                        className={styles.removeBtn}
                        onClick={() => {
                          setAssignmentSaved(false);
                          setSplitHorseIds((prev) => prev.filter((id) => id !== row.horseId));
                        }}
                      >
                        ×
                      </button>
                      <span>{row.horseName}</span>
                    </div>
                    {splitMode === "custom" ? (
                      <input
                        className={styles.amountInput}
                        type="number"
                        step="0.01"
                        value={customAmounts[row.horseId] ?? ""}
                        onChange={(event) => {
                          setAssignmentSaved(false);
                          setCustomAmounts((prev) => ({ ...prev, [row.horseId]: event.target.value }));
                        }}
                      />
                    ) : (
                      <span className={styles.lineAmount}>{fmtUSD(row.amount)}</span>
                    )}
                  </div>
                ))}
              </div>

              <div className={styles.splitSummary}>
                <span>
                  {splitHorseIds.length} horses · {splitMode} split
                </span>
                {splitMode === "custom" ? (
                  Math.abs(splitDelta) <= 0.01 ? (
                    <span className={styles.balanced}>✓ balanced</span>
                  ) : (
                    <span className={styles.unbalanced}>{fmtUSD(Math.abs(splitDelta))} remaining</span>
                  )
                ) : null}
              </div>
            </div>
          )}

          <button type="button" className={canSave ? styles.saveBtn : styles.saveBtnDisabled} disabled={!canSave || isSaving} onClick={onSave}>
            {isSaving ? "saving..." : mode === "line_item" ? "save line-item assignment" : "save split assignment"}
          </button>
        </section>

        <div className={styles.approvalRow}>
          {bill.status === "done" ? (
            <div className={styles.approvedBar}>✓ invoice approved</div>
          ) : (
            <button type="button" className={canApprove ? styles.approveBtn : styles.approveDisabled} disabled={!canApprove || isApproving} onClick={onApprove}>
              {canApprove ? (isApproving ? "approving..." : "approve invoice") : "assign all horses before approving"}
            </button>
          )}
          <button type="button" className={styles.deleteBtn} onClick={() => setShowDeleteConfirm(true)}>
            delete
          </button>
        </div>

        <section className={styles.footerBar}>
          <div className={styles.footerStats}>
            <Summary label="ITEMS" value={String(lineItems.length)} />
            <Summary label="HORSES" value={String(horsesCountForFooter)} />
            <Summary label="ROUTE" value={routeValue} />
            <Summary label="STATUS" value={bill.status === "done" ? "APPROVED" : "PENDING"} status={bill.status === "done" ? "approved" : "pending"} />
          </div>
          <div className={styles.footerTotal}>
            <div className={styles.footerLabel}>TOTAL DUE</div>
            <div className={styles.footerAmount}>{fmtUSD(total)}</div>
          </div>
        </section>

        <div className="ui-footer">OLD_OAK_HORSES // HORSE_TRANSPORT // {providerSlug.toUpperCase()}</div>

        <Modal open={showDeleteConfirm} title="delete invoice?" onClose={() => setShowDeleteConfirm(false)}>
          <p style={{ marginTop: 0, color: "var(--ui-text-secondary)" }}>
            this will permanently delete invoice <strong>{String(extracted.invoice_number ?? billId)}</strong> from {providerName}.
          </p>
          <p style={{ color: "var(--ui-text-muted)" }}>this action cannot be undone.</p>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
            <button type="button" className="ui-button-outlined" onClick={() => setShowDeleteConfirm(false)}>
              cancel
            </button>
            <button
              type="button"
              className="ui-button-danger"
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

function Summary({
  label,
  value,
  status
}: {
  label: string;
  value: string;
  status?: "pending" | "approved";
}) {
  return (
    <div>
      <div className={styles.footerLabel}>{label}</div>
      <div className={status === "pending" ? styles.pending : status === "approved" ? styles.approved : styles.footerValue}>{value}</div>
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

function formatDate(value?: string) {
  if (!value) return "—";
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function normalize(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function fmtUSD(v: number) {
  return `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function safe(v: unknown) {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

function round2(value: number) {
  return Math.round(value * 100) / 100;
}
