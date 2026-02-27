"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import Modal from "@/components/Modal";
import NavBar from "@/components/NavBar";

type SplitMode = "even" | "custom";
type AssignMode = "whole" | "line";

type LineRow = {
  description: string;
  amount: number;
  personName?: string;
  matchedPersonId?: string;
};

export default function AdminInvoicePage() {
  const params = useParams<{ subcategory: string; provider: string; billId: string }>();
  const subcategory = params?.subcategory ?? "payroll";
  const providerSlug = params?.provider ?? "other";
  const billId = params?.billId as Id<"bills">;
  const router = useRouter();

  const bill = useQuery(api.bills.getBillById, billId ? { billId } : "skip");
  const provider = useQuery(
    api.providers.getProviderBySlug,
    providerSlug ? { categorySlug: "admin", providerSlug, subcategorySlug: subcategory } : "skip"
  );
  const people: any[] = useQuery(api.people.getAllPeople) ?? [];

  const saveWholeAssignment = useMutation(api.bills.savePersonAssignment);
  const saveLineAssignment = useMutation(api.bills.saveSalaryAssignment);
  const approveBill = useMutation(api.bills.approveBill);
  const deleteBill = useMutation(api.bills.deleteBill);

  const [assignMode, setAssignMode] = useState<AssignMode>("whole");
  const [wholeMode, setWholeMode] = useState<"single" | "split">("single");
  const [singlePersonId, setSinglePersonId] = useState("");
  const [splitPersonIds, setSplitPersonIds] = useState<string[]>([]);
  const [splitMode, setSplitMode] = useState<SplitMode>("even");
  const [customAmounts, setCustomAmounts] = useState<Record<string, string>>({});
  const [lineAssignments, setLineAssignments] = useState<Record<number, string>>({});
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  const extracted = (bill?.extractedData ?? {}) as Record<string, any>;
  const lineItems: LineRow[] = useMemo(() => {
    const rows = Array.isArray(extracted.line_items) ? extracted.line_items : [];
    return rows.map((row: any) => ({
      description: String(row?.description ?? "—"),
      amount: pickAmount(row),
      personName: row?.person_name,
      matchedPersonId: row?.matched_person_id ?? row?.matchedPersonId
    }));
  }, [extracted]);

  const total = useMemo(() => {
    if (typeof extracted.invoice_total_usd === "number") return extracted.invoice_total_usd;
    return lineItems.reduce((sum, row) => sum + row.amount, 0);
  }, [extracted.invoice_total_usd, lineItems]);

  const splitPreview = useMemo(() => {
    if (splitPersonIds.length === 0) return [] as Array<{ personId: string; amount: number }>;
    if (splitMode === "even") {
      const even = round2(total / splitPersonIds.length);
      return splitPersonIds.map((personId, index) => ({
        personId,
        amount: index === splitPersonIds.length - 1 ? round2(total - even * (splitPersonIds.length - 1)) : even
      }));
    }
    return splitPersonIds.map((personId) => ({ personId, amount: round2(Number(customAmounts[personId] || 0)) }));
  }, [customAmounts, splitMode, splitPersonIds, total]);

  const splitBalanced = useMemo(() => Math.abs(splitPreview.reduce((sum, row) => sum + row.amount, 0) - total) < 0.01, [splitPreview, total]);
  const lineComplete = useMemo(() => lineItems.length > 0 && lineItems.every((_, index) => Boolean(lineAssignments[index])), [lineAssignments, lineItems]);

  const hasSavedAssignment = Boolean((bill?.assignedPeople ?? []).length > 0 || (bill?.personAssignments ?? []).length > 0 || (bill?.splitPersonLineItems ?? []).length > 0);
  const startedWhole = wholeMode === "single" ? Boolean(singlePersonId) : splitPersonIds.length > 0;
  const startedLine = Object.values(lineAssignments).some(Boolean);
  const startedAny = assignMode === "whole" ? startedWhole : startedLine;
  const wholeReady = wholeMode === "single" ? Boolean(singlePersonId) : splitPersonIds.length >= 2 && splitBalanced;
  const lineReady = lineComplete;
  const canSave = assignMode === "whole" ? wholeReady : lineReady;
  const approveDisabled = !bill?.isApproved && (dirty || (startedAny && !canSave));

  const availableSplitPeople = people.filter((person) => !splitPersonIds.includes(String(person._id)));

  async function onSaveAssignment() {
    if (!bill || !canSave) return;
    setSaving(true);
    try {
      if (assignMode === "whole") {
        if (wholeMode === "single") {
          const person = people.find((row) => String(row._id) === singlePersonId);
          if (!person) return;
          await saveWholeAssignment({
            billId,
            isSplit: false,
            assignedPeople: [{ personId: person._id, amount: total }]
          });
        } else {
          await saveWholeAssignment({
            billId,
            isSplit: true,
            assignedPeople: splitPreview
              .map((row) => {
                const person = people.find((entry) => String(entry._id) === row.personId);
                return person ? { personId: person._id, amount: row.amount } : null;
              })
              .filter(Boolean) as Array<{ personId: Id<"people">; amount: number }>
          });
        }
        await saveLineAssignment({ billId, personAssignments: [], splitPersonLineItems: [] });
      } else {
        const personAssignments = lineItems
          .map((row, index) => {
            const id = lineAssignments[index];
            const person = people.find((entry) => String(entry._id) === id);
            if (!person) return null;
            return {
              lineItemIndex: index,
              personId: person._id,
              personName: person.name,
              role: person.role as "rider" | "groom" | "freelance" | "trainer"
            };
          })
          .filter(Boolean) as Array<{
            lineItemIndex: number;
            personId?: Id<"people">;
            personName?: string;
            role?: "rider" | "groom" | "freelance" | "trainer";
          }>;

        await saveLineAssignment({
          billId,
          personAssignments,
          splitPersonLineItems: []
        });
        await saveWholeAssignment({ billId, isSplit: false, assignedPeople: [] });
      }
      setDirty(false);
    } finally {
      setSaving(false);
    }
  }

  async function onApprove() {
    if (!bill || approveDisabled) return;
    await approveBill({ billId });
  }

  async function onDelete() {
    if (!bill) return;
    await deleteBill({ billId });
    router.push(`/admin/${subcategory}/${providerSlug}`);
  }

  if (!bill) {
    return (
      <div className="page-shell">
        <main className="page-main"><section className="ui-card">Loading invoice...</section></main>
      </div>
    );
  }

  return (
    <div className="page-shell">
      <NavBar
        items={[
          { label: "old-oak-horses", href: "/dashboard", brand: true },
          { label: "admin", href: "/admin" },
          { label: subcategory, href: `/admin/${subcategory}` },
          { label: providerSlug, href: `/admin/${subcategory}/${providerSlug}` },
          { label: String(extracted.invoice_number ?? "invoice"), current: true }
        ]}
        actions={bill.originalPdfUrl ? [{ label: "view original PDF", href: bill.originalPdfUrl, variant: "link", newTab: true }] : []}
      />

      <main className="page-main">
        <Link href={`/admin/${subcategory}/${providerSlug}`} className="ui-back-link">← cd /admin/{subcategory}/{providerSlug}</Link>

        <section className="ui-card">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 24 }}>
            <div>
              <div className="ui-label">ADMIN INVOICE</div>
              <h1 style={{ fontSize: 24, margin: "8px 0 16px" }}>{provider?.name ?? bill.customProviderName ?? "Provider"}</h1>
              <div style={{ display: "flex", gap: 32, flexWrap: "wrap" }}>
                <Detail label="INVOICE #" value={String(extracted.invoice_number ?? "—")} />
                <Detail label="DATE" value={formatDate(extracted.invoice_date)} />
                <Detail label="DUE DATE" value={formatDate(extracted.due_date)} />
                <Detail label="SUBCATEGORY" value={titleCase(subcategory)} />
              </div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div className="ui-label">INVOICE TOTAL</div>
              <div style={{ fontSize: 32, fontWeight: 700 }}>{fmtUSD(total)}</div>
            </div>
          </div>
        </section>

        <section className="ui-card" style={{ marginTop: 16 }}>
          <div style={{ fontWeight: 700, marginBottom: 12 }}>line_items</div>
          <div style={{ display: "grid", gap: 8 }}>
            {lineItems.map((row, index) => (
              <div key={`${index}-${row.description}`} style={{ display: "grid", gridTemplateColumns: assignMode === "line" ? "1fr 220px 90px" : "1fr 90px", gap: 10, alignItems: "center", padding: "10px 0", borderBottom: "1px solid #F0F1F5" }}>
                <div>{row.description}</div>
                {assignMode === "line" ? (
                  <select
                    value={lineAssignments[index] ?? ""}
                    onChange={(event) => {
                      setLineAssignments((prev) => ({ ...prev, [index]: event.target.value }));
                      setDirty(true);
                    }}
                    style={{ fontFamily: "'Space Mono', monospace", fontSize: 11, padding: "6px 10px", borderRadius: 6, border: "1px solid #E8EAF0", background: "#F2F3F7" }}
                  >
                    <option value="">select person...</option>
                    {people.map((person) => (
                      <option key={person._id} value={String(person._id)}>{person.name}</option>
                    ))}
                  </select>
                ) : null}
                <strong style={{ textAlign: "right" }}>{fmtUSD(row.amount)}</strong>
              </div>
            ))}
          </div>
        </section>

        <section className="ui-card" style={{ marginTop: 16, borderColor: hasSavedAssignment ? "#22C583" : "#4A5BDB" }}>
          <div style={{ fontWeight: 700, marginBottom: 10 }}>assign_people</div>
          <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
            <button type="button" className="ui-button-outlined" onClick={() => { setAssignMode("whole"); setDirty(true); }} style={{ background: assignMode === "whole" ? "#1A1A2E" : "transparent", color: assignMode === "whole" ? "#fff" : "#6B7084" }}>whole invoice</button>
            <button type="button" className="ui-button-outlined" onClick={() => { setAssignMode("line"); setDirty(true); }} style={{ background: assignMode === "line" ? "#1A1A2E" : "transparent", color: assignMode === "line" ? "#fff" : "#6B7084" }}>per line item</button>
          </div>

          {assignMode === "whole" ? (
            <>
              <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
                <button type="button" className="ui-button-outlined" onClick={() => { setWholeMode("single"); setDirty(true); }} style={{ background: wholeMode === "single" ? "#1A1A2E" : "transparent", color: wholeMode === "single" ? "#fff" : "#6B7084" }}>one person</button>
                <button type="button" className="ui-button-outlined" onClick={() => { setWholeMode("split"); setDirty(true); }} style={{ background: wholeMode === "split" ? "#1A1A2E" : "transparent", color: wholeMode === "split" ? "#fff" : "#6B7084" }}>split across people</button>
              </div>

              {wholeMode === "single" ? (
                <select value={singlePersonId} onChange={(event) => { setSinglePersonId(event.target.value); setDirty(true); }} style={{ fontFamily: "'Space Mono', monospace", fontSize: 12, padding: "8px 10px", borderRadius: 6, border: "1px solid #E8EAF0", background: "#F2F3F7", maxWidth: 320 }}>
                  <option value="">assign person...</option>
                  {people.map((person) => (
                    <option key={person._id} value={String(person._id)}>{person.name}</option>
                  ))}
                </select>
              ) : (
                <div style={{ display: "grid", gap: 8 }}>
                  <div style={{ display: "flex", gap: 8 }}>
                    <select value="" onChange={(event) => {
                      const id = event.target.value;
                      if (!id) return;
                      setSplitPersonIds((prev) => (prev.includes(id) ? prev : [...prev, id]));
                      setDirty(true);
                    }} style={{ fontFamily: "'Space Mono', monospace", fontSize: 12, padding: "8px 10px", borderRadius: 6, border: "1px solid #E8EAF0", background: "#F2F3F7", maxWidth: 320 }}>
                      <option value="">+ add person...</option>
                      {availableSplitPeople.map((person) => (
                        <option key={person._id} value={String(person._id)}>{person.name}</option>
                      ))}
                    </select>
                    <button type="button" className="ui-button-outlined" onClick={() => { setSplitMode("even"); setDirty(true); }} style={{ background: splitMode === "even" ? "#1A1A2E" : "transparent", color: splitMode === "even" ? "#fff" : "#6B7084" }}>even</button>
                    <button type="button" className="ui-button-outlined" onClick={() => { setSplitMode("custom"); setDirty(true); }} style={{ background: splitMode === "custom" ? "#1A1A2E" : "transparent", color: splitMode === "custom" ? "#fff" : "#6B7084" }}>custom</button>
                  </div>
                  {splitPreview.map((row) => {
                    const person = people.find((entry) => String(entry._id) === row.personId);
                    return (
                      <div key={row.personId} style={{ display: "flex", alignItems: "center", gap: 8, background: "#F2F3F7", borderRadius: 6, padding: "8px 10px" }}>
                        <button type="button" onClick={() => {
                          setSplitPersonIds((prev) => prev.filter((id) => id !== row.personId));
                          setCustomAmounts((prev) => {
                            const next = { ...prev };
                            delete next[row.personId];
                            return next;
                          });
                          setDirty(true);
                        }} style={{ border: "none", background: "transparent", color: "#9EA2B0", cursor: "pointer" }}>×</button>
                        <div style={{ flex: 1 }}>{person?.name ?? "Unknown"}</div>
                        {splitMode === "custom" ? (
                          <input value={customAmounts[row.personId] ?? ""} onChange={(event) => { setCustomAmounts((prev) => ({ ...prev, [row.personId]: event.target.value })); setDirty(true); }} placeholder="0.00" style={{ width: 100, textAlign: "right", fontFamily: "'Space Mono', monospace", fontSize: 12, padding: "4px 8px", borderRadius: 4, border: "1px solid #E8EAF0", background: "#fff" }} />
                        ) : (
                          <strong>{fmtUSD(row.amount)}</strong>
                        )}
                      </div>
                    );
                  })}
                  {splitMode === "custom" ? (
                    <div style={{ fontSize: 11, color: splitBalanced ? "#22C583" : "#E5484D" }}>
                      {splitBalanced ? "✓ balanced" : `${fmtUSD(round2(total - splitPreview.reduce((sum, row) => sum + row.amount, 0)))} remaining`}
                    </div>
                  ) : null}
                </div>
              )}
            </>
          ) : (
            <div style={{ fontSize: 11, color: "#6B7084" }}>tag each line item to a person in the table above.</div>
          )}

          <button type="button" className="ui-button-filled" disabled={!canSave || saving} onClick={onSaveAssignment} style={{ marginTop: 12, opacity: canSave ? 1 : 0.5 }}>
            {saving ? "saving..." : "save assignment"}
          </button>
        </section>

        <div style={{ display: "flex", gap: 10, marginTop: 16, marginBottom: 16 }}>
          {bill.isApproved ? (
            <div style={{ flex: 1, padding: "14px 20px", borderRadius: 8, background: "rgba(34,197,131,0.08)", border: "1px solid #22C583", color: "#22C583", fontWeight: 700 }}>✓ invoice approved</div>
          ) : (
            <button type="button" onClick={onApprove} disabled={approveDisabled} style={{ flex: 1, fontFamily: "'Space Mono', monospace", fontSize: 12, fontWeight: 700, padding: "14px 20px", borderRadius: 8, border: "none", background: approveDisabled ? "#E8EAF0" : "#22C583", color: approveDisabled ? "#9EA2B0" : "#fff" }}>
              {approveDisabled ? "complete or save assignment before approving" : "approve invoice"}
            </button>
          )}
          <button type="button" onClick={() => setShowDeleteConfirm(true)} style={{ fontFamily: "'Space Mono', monospace", fontSize: 12, padding: "14px 20px", borderRadius: 8, border: "1px solid #E8EAF0", background: "transparent", color: "#6B7084" }}>delete</button>
        </div>

        <section style={{ background: "#1A1A2E", color: "#fff", borderRadius: 10, padding: "20px 26px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ display: "flex", gap: 24 }}>
            <Summary label="ITEMS" value={String(lineItems.length)} />
            <Summary label="PEOPLE" value={String((bill.assignedPeople ?? []).length || (bill.personAssignments ?? []).length)} />
            <Summary label="SUBCATEGORY" value={titleCase(subcategory)} />
            <Summary label="STATUS" value={bill.isApproved ? "APPROVED" : "PENDING"} />
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 9, color: "#6B7084" }}>TOTAL DUE</div>
            <div style={{ fontSize: 22, fontWeight: 700 }}>{fmtUSD(total)}</div>
          </div>
        </section>

        <div className="ui-footer">OLD_OAK_HORSES // ADMIN // {subcategory.toUpperCase()} // {providerSlug.toUpperCase()}</div>

        <Modal open={showDeleteConfirm} title="delete invoice?" onClose={() => setShowDeleteConfirm(false)}>
          <p style={{ marginTop: 0, color: "var(--ui-text-secondary)" }}>
            this will permanently delete invoice <strong>{String(extracted.invoice_number ?? billId)}</strong> from {provider?.name ?? providerSlug}.
          </p>
          <p style={{ color: "var(--ui-text-muted)" }}>this action cannot be undone.</p>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
            <button type="button" className="ui-button-outlined" onClick={() => setShowDeleteConfirm(false)}>cancel</button>
            <button type="button" className="ui-button-danger" onClick={async () => { setShowDeleteConfirm(false); await onDelete(); }}>yes, delete invoice</button>
          </div>
        </Modal>
      </main>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ fontSize: 9, color: "#9EA2B0", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 12 }}>{value}</div>
    </div>
  );
}

function Summary({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ fontSize: 8, color: "#6B7084", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 13, fontWeight: 700 }}>{value}</div>
    </div>
  );
}

function titleCase(value: string) {
  return value
    .split("-")
    .map((chunk) => chunk.charAt(0).toUpperCase() + chunk.slice(1))
    .join(" ");
}

function pickAmount(row: any) {
  if (typeof row?.total_usd === "number") return row.total_usd;
  if (typeof row?.amount_usd === "number") return row.amount_usd;
  if (typeof row?.total === "number") return row.total;
  if (typeof row?.amount === "number") return row.amount;
  return 0;
}

function fmtUSD(value: number) {
  return `$${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatDate(value: unknown) {
  if (typeof value !== "string" || !value) return "—";
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function round2(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
