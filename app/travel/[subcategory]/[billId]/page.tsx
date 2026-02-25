"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import NavBar from "@/components/NavBar";
import styles from "./travelInvoice.module.css";

type PersonAssignRow = { personId: Id<"people">; amount: number };

export default function TravelInvoicePage() {
  const params = useParams<{ subcategory: string; billId: string }>();
  const subcategory = params?.subcategory ?? "travel";
  const billId = params?.billId as Id<"bills">;
  const router = useRouter();

  const bill = useQuery(api.bills.getBillById, billId ? { billId } : "skip");
  const people = useQuery(api.people.getAllPeople) ?? [];

  const saveAssignment = useMutation(api.bills.saveTravelAssignment);
  const approveInvoice = useMutation(api.bills.approveInvoice);
  const deleteBill = useMutation(api.bills.deleteBill);

  const [editing, setEditing] = useState(false);
  const [isSplit, setIsSplit] = useState<boolean | null>(null);
  const [wholePerson, setWholePerson] = useState<string>("");
  const [splitPeople, setSplitPeople] = useState<string[]>([]);
  const [splitMode, setSplitMode] = useState<"even" | "custom">("even");
  const [customAmounts, setCustomAmounts] = useState<Record<string, string>>({});
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [saving, setSaving] = useState(false);

  const extracted = (bill?.extractedData ?? {}) as any;
  const lineItems = Array.isArray(extracted.line_items) ? extracted.line_items : [];
  const invoiceTotal = getInvoiceTotalUsd(extracted);

  useEffect(() => {
    if (!bill) return;
    if ((bill.assignedPeople ?? []).length === 0) {
      setEditing(true);
      return;
    }

    const split = Boolean(bill.isSplit);
    setIsSplit(split);
    if (!split && bill.assignedPeople?.[0]) {
      setWholePerson(String(bill.assignedPeople[0].personId));
    }
    if (split) {
      setSplitPeople((bill.assignedPeople ?? []).map((row) => String(row.personId)));
      setCustomAmounts(
        (bill.assignedPeople ?? []).reduce((acc, row) => {
          acc[String(row.personId)] = row.amount.toFixed(2);
          return acc;
        }, {} as Record<string, string>)
      );
    }
    setEditing(false);
  }, [bill]);

  const peopleById = useMemo(() => new Map(people.map((row) => [String(row._id), row])), [people]);

  const availableSplitPeople = useMemo(() => people.filter((row) => !splitPeople.includes(String(row._id))), [people, splitPeople]);

  const computedAssignments: PersonAssignRow[] = useMemo(() => {
    if (isSplit === null) return [];
    if (!isSplit) {
      if (!wholePerson) return [];
      return [{ personId: wholePerson as Id<"people">, amount: invoiceTotal }];
    }

    if (splitPeople.length === 0) return [];
    if (splitMode === "even") {
      const amount = splitPeople.length > 0 ? round2(invoiceTotal / splitPeople.length) : 0;
      return splitPeople.map((personId, index) => {
        if (index === splitPeople.length - 1) {
          const allocated = amount * (splitPeople.length - 1);
          return { personId: personId as Id<"people">, amount: round2(invoiceTotal - allocated) };
        }
        return { personId: personId as Id<"people">, amount };
      });
    }

    return splitPeople.map((personId) => ({
      personId: personId as Id<"people">,
      amount: round2(Number(customAmounts[personId] || 0))
    }));
  }, [customAmounts, invoiceTotal, isSplit, splitMode, splitPeople, wholePerson]);

  const splitSum = useMemo(() => computedAssignments.reduce((sum, row) => sum + row.amount, 0), [computedAssignments]);
  const splitDelta = round2(invoiceTotal - splitSum);

  const canSaveAssignment = useMemo(() => {
    if (isSplit === null) return false;
    if (!isSplit) return Boolean(wholePerson);
    if (splitPeople.length < 2) return false;
    if (splitMode === "custom") return Math.abs(splitDelta) <= 0.01;
    return true;
  }, [isSplit, wholePerson, splitPeople.length, splitMode, splitDelta]);

  const assignmentSaved = Boolean((bill?.assignedPeople ?? []).length > 0) && !editing;

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
    if (!canSaveAssignment) return;
    setSaving(true);
    try {
      await saveAssignment({ billId, isSplit: Boolean(isSplit), assignedPeople: computedAssignments });
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
    router.push(`/travel/${subcategory}`);
  }

  return (
    <div className="page-shell">
      <NavBar
        items={[
          { label: "old-oak-horses", href: "/dashboard", brand: true },
          { label: "travel", href: "/travel" },
          { label: subcategory, href: `/travel/${subcategory}` },
          { label: extracted.invoice_number || "invoice", current: true }
        ]}
        actions={[{ label: "biz overview", href: "/reports", variant: "filled" }]}
      />

      <main className="page-main">
        <div className={styles.topRow}>
          <Link href={`/travel/${subcategory}`} className="ui-back-link">
            ← cd /travel/{subcategory}
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
              <span className="ui-label">TRAVEL · {subcategory.toUpperCase()}</span>
              <span className={styles.subBadge}>{titleCase(subcategory)}</span>
            </div>
            <h1 className={styles.provider}>{extracted.provider_name || bill.provider?.fullName || bill.provider?.name || "Travel Provider"}</h1>
            <div className={styles.details}>
              <Detail label="CONFIRMATION" value={extracted.invoice_number || bill.fileName} />
              <Detail label="DATE" value={extracted.invoice_date || "—"} />
              <Detail label="ORIGINAL" value={formatOriginal(bill.originalCurrency, bill.originalTotal, invoiceTotal)} />
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
                <div className={styles.savedTitle}>{bill.isSplit ? `split between ${(bill.assignedPeople ?? []).length} people` : "assigned to"}</div>
                <div className={styles.savedPeople}>
                  {(bill.assignedPeople ?? []).map((row) => {
                    const person = peopleById.get(String(row.personId));
                    return (
                      <span key={String(row.personId)} className={styles.savedPill}>
                        {person?.name || "Unknown"} · {fmtUSD(row.amount)}
                      </span>
                    );
                  })}
                </div>
              </div>
              <button type="button" className="ui-button-outlined" onClick={() => setEditing(true)}>
                edit
              </button>
            </div>
          ) : (
            <>
              <div className={styles.assignHead}>assign_people</div>
              <div className={styles.question}>is this invoice split across multiple people?</div>
              <div className={styles.toggleRow}>
                <button type="button" className={isSplit === false ? styles.toggleActive : styles.toggleBtn} onClick={() => { setIsSplit(false); setSplitPeople([]); }}>
                  no — one person
                </button>
                <button type="button" className={isSplit === true ? styles.toggleActive : styles.toggleBtn} onClick={() => { setIsSplit(true); setWholePerson(""); }}>
                  yes — split it
                </button>
              </div>

              {isSplit === false ? (
                <div className={styles.singleWrap}>
                  <label className={styles.fieldLabel}>ASSIGN ENTIRE INVOICE TO</label>
                  <select className={styles.select} value={wholePerson} onChange={(e) => setWholePerson(e.target.value)}>
                    <option value="">assign person...</option>
                    {groupPeopleByRole(people).map((group) => (
                      <optgroup key={group.role} label={group.role.toUpperCase()}>
                        {group.rows.map((person) => (
                          <option key={person._id} value={String(person._id)}>{person.name}</option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                </div>
              ) : null}

              {isSplit === true ? (
                <div className={styles.splitWrap}>
                  <label className={styles.fieldLabel}>ADD PEOPLE TO SPLIT {fmtUSD(invoiceTotal)}</label>
                  <select
                    className={styles.select}
                    value=""
                    onChange={(e) => {
                      const value = e.target.value;
                      if (!value) return;
                      setSplitPeople((prev) => (prev.includes(value) ? prev : [...prev, value]));
                    }}
                  >
                    <option value="">+ add person...</option>
                    {availableSplitPeople.map((person) => (
                      <option key={person._id} value={String(person._id)}>{person.name}</option>
                    ))}
                  </select>

                  {splitPeople.length > 0 ? (
                    <div className={styles.modeRow}>
                      <button type="button" className={splitMode === "even" ? styles.modeActive : styles.modeBtn} onClick={() => setSplitMode("even")}>even split</button>
                      <button type="button" className={splitMode === "custom" ? styles.modeActive : styles.modeBtn} onClick={() => setSplitMode("custom")}>custom split</button>
                    </div>
                  ) : null}

                  <div className={styles.peopleList}>
                    {splitPeople.map((personId) => {
                      const person = peopleById.get(personId);
                      const evenAmount = computedAssignments.find((row) => String(row.personId) === personId)?.amount ?? 0;
                      return (
                        <div key={personId} className={styles.personRow}>
                          <div className={styles.personLeft}>
                            <button type="button" className={styles.removeBtn} onClick={() => setSplitPeople((prev) => prev.filter((id) => id !== personId))}>×</button>
                            <span>{person?.name || "Unknown"}</span>
                            <span className={styles.roleBadge}>{person?.role || "role"}</span>
                          </div>
                          {splitMode === "even" ? (
                            <span className={styles.rowAmount}>{fmtUSD(evenAmount)}</span>
                          ) : (
                            <input
                              className={styles.amountInput}
                              type="number"
                              step="0.01"
                              value={customAmounts[personId] || ""}
                              onChange={(e) => setCustomAmounts((prev) => ({ ...prev, [personId]: e.target.value }))}
                            />
                          )}
                        </div>
                      );
                    })}
                  </div>

                  <div className={styles.splitSummary}>
                    <span>{splitPeople.length} people · {splitMode} split</span>
                    {splitMode === "custom" ? (
                      Math.abs(splitDelta) <= 0.01 ? <span className={styles.ok}>✓ balanced</span> : <span className={styles.bad}>{splitDelta > 0 ? `${fmtUSD(splitDelta)} remaining` : `${fmtUSD(Math.abs(splitDelta))} over`}</span>
                    ) : null}
                  </div>
                </div>
              ) : null}

              <button type="button" className={canSaveAssignment ? styles.saveBtn : styles.saveBtnDisabled} disabled={!canSaveAssignment || saving} onClick={onSaveAssignment}>
                {saving ? "saving..." : "save assignment"}
              </button>
            </>
          )}
        </section>

        <section className={styles.lineItemsCard}>
          <div className={styles.cardHead}>
            <h2 className={styles.cardTitle}>line_items</h2>
            <span className={styles.count}>{lineItems.length} items</span>
          </div>
          <div className={styles.lineRows}>
            {lineItems.map((item: any, idx: number) => (
              <div key={`${idx}-${item.description}`} className={styles.lineRow}>
                <div>
                  <div className={styles.desc}>{item.description || "—"}</div>
                  <div className={styles.orig}>{formatOriginalLine(item, bill.originalCurrency)}</div>
                </div>
                <div className={styles.rowAmount}>{fmtUSD(typeof item.total_usd === "number" ? item.total_usd : 0)}</div>
              </div>
            ))}
          </div>
        </section>

        <section className={styles.approvalRow}>
          {bill.isApproved ? (
            <div className={styles.approvedBox}>✓ invoice approved</div>
          ) : (
            <button type="button" className={assignmentSaved ? styles.approveBtn : styles.approveDisabled} disabled={!assignmentSaved} onClick={onApprove}>
              {assignmentSaved ? "approve invoice" : "assign people before approving"}
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
            <Summary label="PEOPLE" value={(bill.assignedPeople ?? []).length > 0 ? String((bill.assignedPeople ?? []).length) : "—"} />
            <Summary label="STATUS" value={bill.isApproved ? "APPROVED" : "PENDING"} valueClassName={bill.isApproved ? styles.greenText : styles.amberText} />
          </div>
          <div>
            <div className={styles.summaryLabel}>TOTAL DUE</div>
            <div className={styles.summaryTotal}>{fmtUSD(invoiceTotal)}</div>
          </div>
        </section>

        <div className="ui-footer">OLD_OAK_HORSES // TRAVEL // {subcategory.toUpperCase()}</div>
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

function getInvoiceTotalUsd(extracted: any) {
  if (typeof extracted?.invoice_total_usd === "number") return extracted.invoice_total_usd;
  if (!Array.isArray(extracted?.line_items)) return 0;
  return extracted.line_items.reduce((sum: number, row: any) => sum + (typeof row?.total_usd === "number" ? row.total_usd : 0), 0);
}

function groupPeopleByRole(people: any[]) {
  const roles: Array<"rider" | "groom" | "freelance" | "trainer"> = ["rider", "groom", "freelance", "trainer"];
  return roles.map((role) => ({ role, rows: people.filter((row) => row.role === role) })).filter((group) => group.rows.length > 0);
}

function formatOriginal(currency: string | undefined, originalTotal: number | undefined, invoiceTotal: number) {
  if (!currency || currency === "USD") return fmtUSD(invoiceTotal);
  if (typeof originalTotal !== "number") return `${currency} —`;
  return formatMoneyWithCurrency(currency, originalTotal);
}

function formatOriginalLine(item: any, currency: string | undefined) {
  if (!currency || currency === "USD") return "USD";
  const original = typeof item.amount_original === "number" ? item.amount_original : typeof item.total_original === "number" ? item.total_original : null;
  if (original === null) return `${currency} —`;
  return formatMoneyWithCurrency(currency, original);
}

function formatMoneyWithCurrency(currency: string, amount: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency, minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount);
}

function round2(value: number) {
  return Math.round(value * 100) / 100;
}

function fmtUSD(v: number) {
  return `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function titleCase(value: string) {
  return value
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
