"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import Modal from "@/components/Modal";
import NavBar from "@/components/NavBar";

type EntityType = "none" | "horse" | "person" | "general";

export default function DuesInvoicePage() {
  const params = useParams<{ subcategory: string; provider: string; billId: string }>();
  const subcategory = params?.subcategory ?? "memberships";
  const providerSlug = params?.provider ?? "other";
  const billId = params?.billId as Id<"bills">;
  const router = useRouter();

  const bill = useQuery(api.bills.getBillById, billId ? { billId } : "skip");
  const provider = useQuery(api.providers.getProviderBySlug, {
    categorySlug: "dues-registrations",
    providerSlug,
    subcategorySlug: subcategory
  });
  const horses = useQuery(api.horses.getActiveHorses) ?? [];
  const people = useQuery(api.people.getAllPeople) ?? [];

  const saveDuesAssignments = useMutation(api.bills.saveDuesAssignments);
  const approveBill = useMutation(api.bills.approveBill);
  const deleteBill = useMutation(api.bills.deleteBill);

  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  const extracted = (bill?.extractedData ?? {}) as Record<string, any>;
  const lineItems = Array.isArray(extracted.line_items) ? extracted.line_items : [];

  const [entityTypes, setEntityTypes] = useState<Record<number, EntityType>>({});
  const [entityIds, setEntityIds] = useState<Record<number, string>>({});

  const total = useMemo(() => {
    if (typeof extracted.invoice_total_usd === "number") return extracted.invoice_total_usd;
    return lineItems.reduce((sum, row) => sum + pickAmount(row), 0);
  }, [extracted.invoice_total_usd, lineItems]);

  const initialRows = useMemo(() => {
    const types: Record<number, EntityType> = {};
    const ids: Record<number, string> = {};
    lineItems.forEach((row, index) => {
      const typeRaw = String(row?.entityType ?? row?.entity_type ?? "").toLowerCase();
      if (typeRaw === "horse" || typeRaw === "person" || typeRaw === "general") {
        types[index] = typeRaw;
      } else {
        types[index] = "none";
      }
      const id = row?.entityId ?? row?.entity_id;
      if (typeof id === "string") ids[index] = id;
    });
    return { types, ids };
  }, [lineItems]);

  useEffect(() => {
    if (lineItems.length === 0) return;
    if (Object.keys(entityTypes).length > 0 || Object.keys(entityIds).length > 0) return;
    setEntityTypes(initialRows.types);
    setEntityIds(initialRows.ids);
  }, [entityIds, entityTypes, initialRows.ids, initialRows.types, lineItems.length]);

  const completion = useMemo(() => {
    let complete = true;
    for (let i = 0; i < lineItems.length; i += 1) {
      const type = entityTypes[i] ?? "none";
      if (type === "none") {
        complete = false;
        break;
      }
      if ((type === "horse" || type === "person") && !entityIds[i]) {
        complete = false;
        break;
      }
    }
    return complete;
  }, [entityIds, entityTypes, lineItems.length]);

  const assignmentSummary = useMemo(() => {
    const horseRows: Array<{ label: string; amount: number }> = [];
    const personRows: Array<{ label: string; amount: number }> = [];
    const generalRows: Array<{ label: string; amount: number }> = [];
    const unassignedRows: Array<{ label: string; amount: number }> = [];

    lineItems.forEach((row, index) => {
      const amount = pickAmount(row);
      const type = entityTypes[index] ?? "none";
      const id = entityIds[index];
      const label = String(row?.description ?? "Line item");
      if (type === "horse") {
        const horse = horses.find((entry) => String(entry._id) === id);
        horseRows.push({ label: `${horse?.name ?? "Horse"} — ${label}`, amount });
      } else if (type === "person") {
        const person = people.find((entry) => String(entry._id) === id);
        personRows.push({ label: `${person?.name ?? "Person"} — ${label}`, amount });
      } else if (type === "general") {
        generalRows.push({ label, amount });
      } else {
        unassignedRows.push({ label, amount });
      }
    });

    return {
      horseRows,
      personRows,
      generalRows,
      unassignedRows,
      horseTotal: round2(horseRows.reduce((sum, row) => sum + row.amount, 0)),
      personTotal: round2(personRows.reduce((sum, row) => sum + row.amount, 0)),
      generalTotal: round2(generalRows.reduce((sum, row) => sum + row.amount, 0)),
      unassignedTotal: round2(unassignedRows.reduce((sum, row) => sum + row.amount, 0))
    };
  }, [entityIds, entityTypes, horses, lineItems, people]);

  if (!bill) {
    return (
      <div className="page-shell">
        <main className="page-main"><section className="ui-card">Loading invoice...</section></main>
      </div>
    );
  }

  async function onSave() {
    setSaving(true);
    try {
      await saveDuesAssignments({
        billId,
        assignments: lineItems.map((row, index) => {
          const type = entityTypes[index] ?? "none";
          const id = entityIds[index];
          const entityName =
            type === "horse"
              ? horses.find((entry) => String(entry._id) === id)?.name
              : type === "person"
                ? people.find((entry) => String(entry._id) === id)?.name
                : type === "general"
                  ? "General"
                  : undefined;
          return {
            lineItemIndex: index,
            entityType: type,
            entityId: id || undefined,
            entityName
          };
        })
      });
      setDirty(false);
    } finally {
      setSaving(false);
    }
  }

  async function onApprove() {
    if (!completion) return;
    await approveBill({ billId });
  }

  async function onDelete() {
    await deleteBill({ billId });
    router.push(`/dues-registrations/${subcategory}/${providerSlug}`);
  }

  return (
    <div className="page-shell">
      <NavBar
        items={[
          { label: "old-oak-horses", href: "/dashboard", brand: true },
          { label: "dues_registrations", href: "/dues-registrations" },
          { label: subcategory, href: `/dues-registrations/${subcategory}` },
          { label: providerSlug, href: `/dues-registrations/${subcategory}/${providerSlug}` },
          { label: String(extracted.invoice_number ?? "invoice"), current: true }
        ]}
        actions={bill.originalPdfUrl ? [{ label: "view original PDF", href: bill.originalPdfUrl, variant: "link", newTab: true }] : []}
      />

      <main className="page-main">
        <Link href={`/dues-registrations/${subcategory}/${providerSlug}`} className="ui-back-link">← cd /dues-registrations/{subcategory}/{providerSlug}</Link>

        <section className="ui-card">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 24 }}>
            <div>
              <div className="ui-label">DUES & REGISTRATIONS INVOICE</div>
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
          <div style={{ fontWeight: 700, marginBottom: 10 }}>line_items</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 100px 220px 90px", gap: 10, alignItems: "center", paddingBottom: 10, borderBottom: "1px solid #E8EAF0", fontSize: 9, color: "#9EA2B0", letterSpacing: "0.1em" }}>
            <div>DESCRIPTION</div><div>TYPE</div><div>ASSIGN TO</div><div style={{ textAlign: "right" }}>AMOUNT</div>
          </div>
          <div>
            {lineItems.map((row, index) => {
              const type = entityTypes[index] ?? "none";
              return (
                <div key={`${index}-${String(row?.description ?? "line")}`} style={{ display: "grid", gridTemplateColumns: "1fr 100px 220px 90px", gap: 10, alignItems: "center", padding: "12px 0", borderBottom: "1px solid #F0F1F5" }}>
                  <div style={{ fontSize: 12 }}>{String(row?.description ?? "—")}</div>
                  <select
                    value={type}
                    onChange={(event) => {
                      setEntityTypes((prev) => ({ ...prev, [index]: event.target.value as EntityType }));
                      if (event.target.value === "general" || event.target.value === "none") {
                        setEntityIds((prev) => ({ ...prev, [index]: "" }));
                      }
                      setDirty(true);
                    }}
                    style={{ fontFamily: "'Space Mono', monospace", fontSize: 11, padding: "6px 8px", borderRadius: 6, border: "1px solid #E8EAF0", background: "#F2F3F7" }}
                  >
                    <option value="none">—</option>
                    <option value="horse">🐴 horse</option>
                    <option value="person">👤 person</option>
                    <option value="general">📋 general</option>
                  </select>

                  <select
                    value={entityIds[index] ?? ""}
                    disabled={type !== "horse" && type !== "person"}
                    onChange={(event) => {
                      setEntityIds((prev) => ({ ...prev, [index]: event.target.value }));
                      setDirty(true);
                    }}
                    style={{ fontFamily: "'Space Mono', monospace", fontSize: 11, padding: "6px 8px", borderRadius: 6, border: "1px solid #E8EAF0", background: "#F2F3F7" }}
                  >
                    <option value="">{type === "horse" || type === "person" ? "select..." : "select type first"}</option>
                    {type === "horse"
                      ? horses.map((horse) => <option key={horse._id} value={String(horse._id)}>{horse.name}</option>)
                      : null}
                    {type === "person"
                      ? people.map((person) => <option key={person._id} value={String(person._id)}>{person.name}</option>)
                      : null}
                  </select>

                  <strong style={{ textAlign: "right", fontSize: 12 }}>{fmtUSD(pickAmount(row))}</strong>
                </div>
              );
            })}
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 12 }}>
            <button type="button" className="ui-button-filled" onClick={onSave} disabled={saving}>{saving ? "saving..." : "save assignment"}</button>
          </div>
        </section>

        <section className="ui-card" style={{ marginTop: 16 }}>
          <div style={{ color: "#22C583", fontWeight: 700, marginBottom: 10 }}>✓ assignment summary</div>
          <SummaryGroup title="🐴 Horses" rows={assignmentSummary.horseRows} total={assignmentSummary.horseTotal} color="#4A5BDB" />
          <SummaryGroup title="👤 People" rows={assignmentSummary.personRows} total={assignmentSummary.personTotal} color="#EC4899" />
          <SummaryGroup title="📋 General" rows={assignmentSummary.generalRows} total={assignmentSummary.generalTotal} color="#6B7084" />
          <SummaryGroup title="⚠ Unassigned" rows={assignmentSummary.unassignedRows} total={assignmentSummary.unassignedTotal} color="#F59E0B" />
        </section>

        <div style={{ display: "flex", gap: 10, marginTop: 16, marginBottom: 16 }}>
          {bill.isApproved ? (
            <div style={{ flex: 1, padding: "14px 20px", borderRadius: 8, background: "rgba(34,197,131,0.08)", border: "1px solid #22C583", color: "#22C583", fontWeight: 700 }}>✓ invoice approved</div>
          ) : (
            <button type="button" onClick={onApprove} disabled={!completion || dirty} style={{ flex: 1, fontFamily: "'Space Mono', monospace", fontSize: 12, fontWeight: 700, padding: "14px 20px", borderRadius: 8, border: "none", background: !completion || dirty ? "#E8EAF0" : "#22C583", color: !completion || dirty ? "#9EA2B0" : "#fff" }}>
              {!completion ? "assign all line items before approving" : dirty ? "save assignment before approving" : "approve invoice"}
            </button>
          )}
          <button type="button" onClick={() => setShowDeleteConfirm(true)} style={{ fontFamily: "'Space Mono', monospace", fontSize: 12, padding: "14px 20px", borderRadius: 8, border: "1px solid #E8EAF0", background: "transparent", color: "#6B7084" }}>delete</button>
        </div>

        <section style={{ background: "#1A1A2E", color: "#fff", borderRadius: 10, padding: "20px 26px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ display: "flex", gap: 24 }}>
            <SummaryStat label="ITEMS" value={String(lineItems.length)} />
            <SummaryStat label="HORSES" value={String(assignmentSummary.horseRows.length)} />
            <SummaryStat label="PEOPLE" value={String(assignmentSummary.personRows.length)} />
            <SummaryStat label="SUBCATEGORY" value={titleCase(subcategory)} />
            <SummaryStat label="STATUS" value={bill.isApproved ? "APPROVED" : "PENDING"} />
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 9, color: "#6B7084" }}>TOTAL DUE</div>
            <div style={{ fontSize: 22, fontWeight: 700 }}>{fmtUSD(total)}</div>
          </div>
        </section>

        <div className="ui-footer">OLD_OAK_HORSES // DUES_REGISTRATIONS // {subcategory.toUpperCase()} // {providerSlug.toUpperCase()}</div>

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

function SummaryGroup({ title, rows, total, color }: { title: string; rows: Array<{ label: string; amount: number }>; total: number; color: string }) {
  if (rows.length === 0) return null;
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", color, fontWeight: 700, marginBottom: 6 }}>
        <span>{title} ({rows.length} items)</span>
        <span>{fmtUSD(total)}</span>
      </div>
      <div style={{ display: "grid", gap: 4 }}>
        {rows.map((row, index) => (
          <div key={`${row.label}-${index}`} style={{ display: "flex", justifyContent: "space-between", color: "#6B7084", fontSize: 11 }}>
            <span>{row.label}</span>
            <span>{fmtUSD(row.amount)}</span>
          </div>
        ))}
      </div>
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

function SummaryStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ fontSize: 8, color: "#6B7084", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 13, fontWeight: 700 }}>{value}</div>
    </div>
  );
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

function titleCase(value: string) {
  return value.split("-").map((chunk) => chunk.charAt(0).toUpperCase() + chunk.slice(1)).join(" ");
}

function round2(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
