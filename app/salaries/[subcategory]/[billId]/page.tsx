"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import NavBar from "@/components/NavBar";
import Modal from "@/components/Modal";

type SplitMode = "even" | "custom";

type SplitState = {
  personIds: string[];
  mode: SplitMode;
  customAmounts: Record<string, string>;
};

const SPLIT_VALUE = "__split__";
const ROLE_BY_SUBCATEGORY: Record<string, "rider" | "groom" | "freelance" | undefined> = {
  rider: "rider",
  groom: "groom",
  freelance: "freelance"
};

export default function SalariesInvoicePage() {
  const params = useParams<{ subcategory: string; billId: string }>();
  const subcategory = params?.subcategory ?? "other";
  const billId = params?.billId as Id<"bills">;
  const router = useRouter();

  const bill = useQuery(api.bills.getBillById, billId ? { billId } : "skip");
  const people: any[] = useQuery(api.people.getAllPeople) ?? [];

  const saveSalaryAssignment = useMutation(api.bills.saveSalaryAssignment);
  const approveBill = useMutation(api.bills.approveBill);
  const deleteBill = useMutation(api.bills.deleteBill);

  const [editing, setEditing] = useState(false);
  const [lineAssignments, setLineAssignments] = useState<Record<number, string>>({});
  const [splitState, setSplitState] = useState<Record<number, SplitState>>({});
  const [saving, setSaving] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const extracted = (bill?.extractedData ?? {}) as Record<string, any>;
  const lineItems = Array.isArray(extracted.line_items) ? extracted.line_items : [];
  const invoiceTotal = getInvoiceTotalUsd(extracted);

  const filteredPeople = useMemo(() => {
    const role = ROLE_BY_SUBCATEGORY[subcategory];
    if (!role) return people;
    return people.filter((person) => person.role === role);
  }, [people, subcategory]);

  const peopleById = useMemo(() => new Map(people.map((row) => [String(row._id), row])), [people]);
  const personIdByName = useMemo(() => {
    const map = new Map<string, string>();
    for (const person of filteredPeople) {
      map.set(person.name.toLowerCase().trim(), String(person._id));
      const first = person.name.split(" ")[0]?.toLowerCase().trim();
      if (first) map.set(first, String(person._id));
    }
    return map;
  }, [filteredPeople]);

  useEffect(() => {
    if (!bill) return;

    if ((bill.personAssignments ?? []).length === 0 && (bill.splitPersonLineItems ?? []).length === 0) {
      const nextAssignments: Record<number, string> = {};
      for (let idx = 0; idx < lineItems.length; idx += 1) {
        const row = lineItems[idx] ?? {};
        const personName = String(row.person_name ?? row.employee_name ?? row.name ?? "").trim().toLowerCase();
        const personId = personIdByName.get(personName);
        if (personId) nextAssignments[idx] = personId;
      }
      setLineAssignments(nextAssignments);
      setSplitState({});
      setEditing(true);
      return;
    }

    const nextAssignments: Record<number, string> = {};
    for (const row of bill.personAssignments ?? []) {
      if (row.personId) nextAssignments[row.lineItemIndex] = String(row.personId);
      else nextAssignments[row.lineItemIndex] = "";
    }

    const nextSplits: Record<number, SplitState> = {};
    for (const row of bill.splitPersonLineItems ?? []) {
      nextAssignments[row.lineItemIndex] = SPLIT_VALUE;
      nextSplits[row.lineItemIndex] = {
        personIds: row.splits.map((item) => String(item.personId)),
        mode: "custom",
        customAmounts: row.splits.reduce((acc, item) => {
          acc[String(item.personId)] = item.amount.toFixed(2);
          return acc;
        }, {} as Record<string, string>)
      };
    }

    setLineAssignments(nextAssignments);
    setSplitState(nextSplits);
    setEditing(false);
  }, [bill, lineItems, personIdByName]);

  const splitAmountsByIndex = useMemo(() => {
    const entries = new Map<number, Array<{ personId: string; amount: number }>>();
    for (const [key, split] of Object.entries(splitState)) {
      const lineIndex = Number(key);
      const lineTotal = getLineAmount(lineItems[lineIndex]);
      if (!Number.isFinite(lineTotal)) continue;

      if (split.mode === "even") {
        if (split.personIds.length === 0) {
          entries.set(lineIndex, []);
          continue;
        }
        const even = round2(lineTotal / split.personIds.length);
        const values = split.personIds.map((personId, idx) => {
          if (idx === split.personIds.length - 1) {
            return { personId, amount: round2(lineTotal - even * (split.personIds.length - 1)) };
          }
          return { personId, amount: even };
        });
        entries.set(lineIndex, values);
      } else {
        const values = split.personIds.map((personId) => ({ personId, amount: round2(Number(split.customAmounts[personId] || 0)) }));
        entries.set(lineIndex, values);
      }
    }
    return entries;
  }, [lineItems, splitState]);

  const autoDetectedCount = useMemo(
    () => lineItems.filter((row: any) => String(row?.person_name ?? row?.employee_name ?? row?.name ?? "").trim().length > 0).length,
    [lineItems]
  );

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
        if (!split || split.personIds.length < 2) {
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

  const summaryByPerson = useMemo(() => {
    const map = new Map<string, { personName: string; role: string; total: number; lineItemCount: number }>();
    let unassigned = 0;

    for (let idx = 0; idx < lineItems.length; idx += 1) {
      const assignment = lineAssignments[idx] ?? "";
      const amount = getLineAmount(lineItems[idx]);

      if (!assignment) {
        unassigned += amount;
        continue;
      }

      if (assignment === SPLIT_VALUE) {
        const splitRows = splitAmountsByIndex.get(idx) ?? [];
        if (splitRows.length === 0) {
          unassigned += amount;
          continue;
        }
        for (const split of splitRows) {
          const person = peopleById.get(split.personId);
          const current = map.get(split.personId) ?? {
            personName: person?.name ?? "Unknown",
            role: person?.role ?? "freelance",
            total: 0,
            lineItemCount: 0
          };
          current.total += split.amount;
          current.lineItemCount += 1;
          map.set(split.personId, current);
        }
        continue;
      }

      const person = peopleById.get(assignment);
      const current = map.get(assignment) ?? {
        personName: person?.name ?? "Unknown",
        role: person?.role ?? "freelance",
        total: 0,
        lineItemCount: 0
      };
      current.total += amount;
      current.lineItemCount += 1;
      map.set(assignment, current);
    }

    return {
      rows: [...map.values()].sort((a, b) => b.total - a.total),
      unassigned: round2(unassigned)
    };
  }, [lineAssignments, lineItems, peopleById, splitAmountsByIndex]);

  const assignmentSaved = Boolean(((bill?.personAssignments ?? []).length > 0 || (bill?.splitPersonLineItems ?? []).length > 0) && !editing);

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
      const personAssignments: Array<{ lineItemIndex: number; personId?: Id<"people">; personName?: string; role?: "rider" | "groom" | "freelance" | "trainer" }> = [];
      const splitPersonLineItems: Array<{
        lineItemIndex: number;
        splits: Array<{ personId: Id<"people">; personName: string; role: "rider" | "groom" | "freelance" | "trainer"; amount: number }>;
      }> = [];

      for (let idx = 0; idx < lineItems.length; idx += 1) {
        const assignment = lineAssignments[idx] ?? "";
        if (!assignment) continue;

        if (assignment === SPLIT_VALUE) {
          const splitRows = splitAmountsByIndex.get(idx) ?? [];
          splitPersonLineItems.push({
            lineItemIndex: idx,
            splits: splitRows.map((row) => ({
              personId: row.personId as Id<"people">,
              personName: peopleById.get(row.personId)?.name ?? "Unknown",
              role: (peopleById.get(row.personId)?.role ?? "freelance") as "rider" | "groom" | "freelance" | "trainer",
              amount: row.amount
            }))
          });
          continue;
        }

        personAssignments.push({
          lineItemIndex: idx,
          personId: assignment as Id<"people">,
          personName: peopleById.get(assignment)?.name,
          role: (peopleById.get(assignment)?.role ?? undefined) as "rider" | "groom" | "freelance" | "trainer" | undefined
        });
      }

      await saveSalaryAssignment({ billId, personAssignments, splitPersonLineItems });
      setEditing(false);
    } finally {
      setSaving(false);
    }
  }

  async function onApprove() {
    console.log("Approve clicked, billId:", billId);
    try {
      await approveBill({ billId });
      console.log("Approve mutation succeeded");
    } catch (error) {
      console.error("Approve mutation failed:", error);
    }
  }

  async function onDelete() {
    await deleteBill({ billId });
    router.push(`/salaries/${subcategory}`);
  }

  const providerName =
    (typeof extracted.provider_name === "string" && extracted.provider_name) ||
    bill.provider?.fullName ||
    bill.provider?.name ||
    bill.customProviderName ||
    "Payroll";

  return (
    <div className="page-shell">
      <NavBar
        items={[
          { label: "old-oak-horses", href: "/dashboard", brand: true },
          { label: "salaries", href: "/salaries" },
          { label: subcategory, href: `/salaries/${subcategory}` },
          { label: String(extracted.invoice_number ?? "invoice"), current: true }
        ]}
        actions={bill.originalPdfUrl ? [{ label: "view original PDF", href: bill.originalPdfUrl, variant: "link", newTab: true }] : []}
      />

      <main className="page-main">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
          <Link href={`/salaries/${subcategory}`} className="ui-back-link">
            ← cd /salaries/{subcategory}
          </Link>
        </div>

        <section className="ui-card">
          <div className="ui-label">SALARIES INVOICE</div>
          <h1 style={{ fontSize: 28, marginTop: 8 }}>{providerName}</h1>
          <p style={{ color: "var(--ui-text-secondary)", marginTop: 8 }}>
            {String(extracted.invoice_number ?? bill.fileName)} · {formatDate(extracted.invoice_date)} · due {formatDate(extracted.due_date)}
          </p>
          <div style={{ fontSize: 34, fontWeight: 700, marginTop: 10 }}>{fmtUSD(invoiceTotal)}</div>
        </section>

        <section className="ui-card" style={{ marginTop: 16, borderColor: assignmentSaved ? "#22C583" : "#4A5BDB" }}>
          {assignmentSaved ? (
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
              <div>
                <div style={{ fontWeight: 700 }}>assigned to {summaryByPerson.rows.length} people</div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 6 }}>
                  {summaryByPerson.rows.map((row) => (
                    <span key={row.personName} style={{ fontSize: 11, border: "1px solid #E8EAF0", borderRadius: 6, padding: "2px 8px" }}>
                      {row.personName} ({fmtUSD(row.total)})
                    </span>
                  ))}
                </div>
              </div>
              <button type="button" className="ui-button-outlined" onClick={() => setEditing(true)}>
                edit
              </button>
            </div>
          ) : (
            <>
              <div style={{ fontWeight: 700, marginBottom: 8 }}>assign_people</div>
              <div style={{ color: "var(--ui-text-secondary)", marginBottom: 10 }}>
                {validation.assignedCount}/{validation.totalCount} assigned
              </div>
              {autoDetectedCount > 0 ? (
                <div style={{ marginBottom: 10, fontSize: 11, color: "#22C583" }}>
                  ✓ auto-detected people on {autoDetectedCount} of {lineItems.length} line items
                </div>
              ) : null}

              <div style={{ display: "grid", gap: 8 }}>
                {lineItems.map((item: any, idx: number) => {
                  const assignment = lineAssignments[idx] ?? "";
                  const split = splitState[idx];
                  const splitValues = splitAmountsByIndex.get(idx) ?? [];
                  const availableForSplit = filteredPeople.filter((person) => !split?.personIds.includes(String(person._id)));
                  const isUnassigned = !assignment;
                  const matchConfidence = String(item.personMatchConfidence ?? item.person_match_confidence ?? "").toLowerCase();
                  const rawPerson = String(item.person_name_raw ?? "").trim();
                  const parsedPerson = String(item.person_name ?? item.employee_name ?? item.name ?? "").trim();

                  return (
                    <div key={`${idx}-${String(item.description ?? "line")}`} style={{ border: "1px solid #E8EAF0", borderRadius: 8, padding: 10, background: isUnassigned ? "rgba(229,72,77,0.03)" : "#F2F3F7" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: 12, fontWeight: 700 }}>{String(item.description ?? "—")}</div>
                          <div style={{ fontSize: 10, color: "var(--ui-text-muted)", marginTop: 2, display: "inline-flex", gap: 6, alignItems: "center" }}>
                            {(matchConfidence === "exact" || matchConfidence === "alias") && parsedPerson ? (
                              <span style={{ fontSize: 8, padding: "2px 7px", borderRadius: 4, background: "rgba(34,197,131,0.08)", color: "#22C583", fontWeight: 700, textTransform: "uppercase" }}>
                                auto
                              </span>
                            ) : null}
                            {matchConfidence === "fuzzy" ? (
                              <span style={{ fontSize: 8, padding: "2px 7px", borderRadius: 4, background: "rgba(245,158,11,0.08)", color: "#F59E0B", fontWeight: 700, textTransform: "uppercase" }}>
                                fuzzy
                              </span>
                            ) : null}
                            {matchConfidence === "none" && rawPerson ? (
                              <span style={{ fontSize: 8, padding: "2px 7px", borderRadius: 4, background: "rgba(229,72,77,0.08)", color: "#E5484D", fontWeight: 700, textTransform: "uppercase" }}>
                                unmatched
                              </span>
                            ) : null}
                            {matchConfidence === "fuzzy" && rawPerson && parsedPerson && normalize(rawPerson) !== normalize(parsedPerson) ? (
                              <span style={{ fontSize: 9, color: "#9EA2B0" }}>(parsed as "{rawPerson}")</span>
                            ) : null}
                          </div>
                        </div>
                        <select
                          value={assignment}
                          onChange={(event) => {
                            const value = event.target.value;
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
                                [idx]: prev[idx] ?? { personIds: [], mode: "even", customAmounts: {} }
                              }));
                            }
                          }}
                          style={{ minWidth: 200, fontSize: 12, padding: "8px 10px", background: "white", border: "1px solid #E8EAF0", borderRadius: 6 }}
                        >
                          <option value="">assign person...</option>
                          {filteredPeople.map((person) => (
                            <option key={person._id} value={String(person._id)}>
                              {person.name}
                            </option>
                          ))}
                          <option value={SPLIT_VALUE}>split across people...</option>
                        </select>
                        <div style={{ minWidth: 90, textAlign: "right", fontWeight: 700 }}>{fmtUSD(getLineAmount(item))}</div>
                      </div>

                      {assignment === SPLIT_VALUE ? (
                        <div style={{ marginTop: 8, borderTop: "1px solid #E8EAF0", paddingTop: 8 }}>
                          <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
                            <select
                              value=""
                              onChange={(event) => {
                                const value = event.target.value;
                                if (!value) return;
                                setSplitState((prev) => {
                                  const current = prev[idx] ?? { personIds: [], mode: "even" as const, customAmounts: {} };
                                  if (current.personIds.includes(value)) return prev;
                                  return {
                                    ...prev,
                                    [idx]: { ...current, personIds: [...current.personIds, value] }
                                  };
                                });
                              }}
                              style={{ minWidth: 220, fontSize: 12, padding: "6px 8px", background: "white", border: "1px solid #E8EAF0", borderRadius: 6 }}
                            >
                              <option value="">+ add person...</option>
                              {availableForSplit.map((person) => (
                                <option key={person._id} value={String(person._id)}>{person.name}</option>
                              ))}
                            </select>
                            <button
                              type="button"
                              className="ui-button-outlined"
                              onClick={() =>
                                setSplitState((prev) => ({
                                  ...prev,
                                  [idx]: { ...(prev[idx] ?? { personIds: [], mode: "even", customAmounts: {} }), mode: "even" }
                                }))
                              }
                            >
                              even
                            </button>
                            <button
                              type="button"
                              className="ui-button-outlined"
                              onClick={() =>
                                setSplitState((prev) => ({
                                  ...prev,
                                  [idx]: { ...(prev[idx] ?? { personIds: [], mode: "even", customAmounts: {} }), mode: "custom" }
                                }))
                              }
                            >
                              custom
                            </button>
                          </div>

                          {(split?.personIds ?? []).map((personId) => {
                            const person = peopleById.get(personId);
                            const splitMode = split?.mode ?? "even";
                            const evenAmount = splitValues.find((row) => row.personId === personId)?.amount ?? 0;
                            return (
                              <div key={`${idx}-${personId}`} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                                <button
                                  type="button"
                                  className="ui-button-outlined"
                                  onClick={() =>
                                    setSplitState((prev) => {
                                      const current = prev[idx];
                                      if (!current) return prev;
                                      const nextIds = current.personIds.filter((id) => id !== personId);
                                      const nextAmounts = { ...current.customAmounts };
                                      delete nextAmounts[personId];
                                      return {
                                        ...prev,
                                        [idx]: { ...current, personIds: nextIds, customAmounts: nextAmounts }
                                      };
                                    })
                                  }
                                >
                                  ×
                                </button>
                                <div style={{ flex: 1 }}>{person?.name ?? "Unknown"}</div>
                                {splitMode === "even" ? (
                                  <div style={{ width: 100, textAlign: "right", fontWeight: 700 }}>{fmtUSD(evenAmount)}</div>
                                ) : (
                                  <input
                                    type="number"
                                    step="0.01"
                                    value={split?.customAmounts?.[personId] ?? ""}
                                    onChange={(event) =>
                                      setSplitState((prev) => ({
                                        ...prev,
                                        [idx]: {
                                          ...(prev[idx] ?? { personIds: [], mode: "custom", customAmounts: {} }),
                                          customAmounts: {
                                            ...prev[idx]?.customAmounts,
                                            [personId]: event.target.value
                                          }
                                        }
                                      }))
                                    }
                                    style={{ width: 100, textAlign: "right", padding: "6px 8px", background: "white", border: "1px solid #E8EAF0", borderRadius: 6 }}
                                  />
                                )}
                              </div>
                            );
                          })}
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>

              <div style={{ marginTop: 12, padding: 10, background: "#F2F3F7", borderRadius: 8 }}>
                <div className="ui-label">COST BY PERSON</div>
                {summaryByPerson.rows.map((row) => (
                  <div key={row.personName} style={{ display: "flex", justifyContent: "space-between", marginTop: 6 }}>
                    <span>{row.personName} ({row.role}) · {row.lineItemCount} items</span>
                    <strong>{fmtUSD(row.total)}</strong>
                  </div>
                ))}
                {summaryByPerson.unassigned > 0 ? (
                  <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6, color: "#E5484D" }}>
                    <span>unassigned</span>
                    <strong>{fmtUSD(summaryByPerson.unassigned)}</strong>
                  </div>
                ) : null}
              </div>

              <button
                type="button"
                className="ui-button-filled"
                disabled={!validation.canSave || saving}
                onClick={onSaveAssignment}
                style={{ marginTop: 12, opacity: validation.canSave ? 1 : 0.5 }}
              >
                {saving ? "saving..." : "save assignment"}
              </button>
            </>
          )}
        </section>

        <section className="ui-card" style={{ marginTop: 16, display: "flex", gap: 8 }}>
          {bill.isApproved ? (
            <div style={{ color: "#22C583", fontWeight: 700 }}>✓ invoice approved</div>
          ) : (
            <button type="button" className="ui-button-filled" disabled={!assignmentSaved} onClick={onApprove}>
              {assignmentSaved ? "approve invoice" : "assign all people before approving"}
            </button>
          )}
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
          <div style={{ display: "flex", gap: 24 }}>
            <Summary label="SUBCATEGORY" value={subcategory.toUpperCase()} />
            <Summary label="ITEMS" value={String(lineItems.length)} />
            <Summary label="PEOPLE" value={String(summaryByPerson.rows.length)} />
            <Summary label="STATUS" value={bill.isApproved ? "APPROVED" : "PENDING"} />
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 10, color: "#9EA2B0" }}>TOTAL DUE</div>
            <div style={{ fontSize: 24, fontWeight: 700 }}>{fmtUSD(invoiceTotal)}</div>
          </div>
        </section>

        <div className="ui-footer">OLD_OAK_HORSES // SALARIES // {subcategory.toUpperCase()}</div>

        <Modal open={showDeleteConfirm} title="delete invoice?" onClose={() => setShowDeleteConfirm(false)}>
          <p style={{ marginTop: 0, color: "var(--ui-text-secondary)" }}>
            this will permanently delete invoice <strong>{String(extracted.invoice_number ?? billId)}</strong> from{" "}
            {String(extracted.provider_name ?? bill?.provider?.name ?? "provider")}.
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

function Summary({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ fontSize: 10, color: "#9EA2B0" }}>{label}</div>
      <div style={{ fontWeight: 700 }}>{value}</div>
    </div>
  );
}

function formatDate(value: unknown) {
  if (typeof value !== "string" || !value) return "—";
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function getLineAmount(row: any) {
  if (typeof row?.total_usd === "number") return row.total_usd;
  if (typeof row?.amount_usd === "number") return row.amount_usd;
  if (typeof row?.total === "number") return row.total;
  return 0;
}

function getInvoiceTotalUsd(extracted: Record<string, any>) {
  if (typeof extracted?.invoice_total_usd === "number") return extracted.invoice_total_usd;
  const lineItems = Array.isArray(extracted?.line_items) ? extracted.line_items : [];
  return lineItems.reduce((sum: number, row: any) => sum + getLineAmount(row), 0);
}

function round2(value: number) {
  return Math.round(value * 100) / 100;
}

function normalize(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function fmtUSD(v: number) {
  return `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
