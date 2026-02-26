"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import NavBar from "@/components/NavBar";
import Modal from "@/components/Modal";

type LineItem = {
  description?: string;
  horse_name?: string | null;
  total_usd?: number;
};

export default function BodyworkInvoicePage() {
  const router = useRouter();
  const params = useParams<{ provider: string; billId: string }>();
  const providerSlug = params?.provider ?? "";
  const billId = params?.billId ?? "";

  const bill = useQuery(api.bills.getBillById, billId ? { billId: billId as any } : "skip");
  const provider = useQuery(api.providers.getProviderBySlug, providerSlug ? { categorySlug: "bodywork", providerSlug } : "skip");
  const approveInvoice = useMutation(api.bills.approveInvoice);
  const deleteBill = useMutation(api.bills.deleteBill);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const extracted = (bill?.extractedData ?? {}) as Record<string, unknown>;
  const lineItems: LineItem[] = Array.isArray(extracted.line_items) ? (extracted.line_items as LineItem[]) : [];
  const total =
    typeof extracted.invoice_total_usd === "number"
      ? extracted.invoice_total_usd
      : lineItems.reduce((sum, row) => sum + (typeof row.total_usd === "number" ? row.total_usd : 0), 0);

  const grouped = useMemo(() => {
    const map = new Map<string, LineItem[]>();
    for (const row of lineItems) {
      const key = row.horse_name?.trim() || "Unassigned / General";
      map.set(key, [...(map.get(key) ?? []), row]);
    }
    return [...map.entries()];
  }, [lineItems]);

  async function onApprove() {
    if (!bill) return;
    await approveInvoice({ billId: bill._id });
  }

  async function onDelete() {
    if (!bill) return;
    await deleteBill({ billId: bill._id });
    router.push(`/bodywork/${providerSlug}`);
  }

  return (
    <div className="page-shell">
      <NavBar
        items={[
          { label: "old-oak-horses", href: "/dashboard", brand: true },
          { label: "bodywork", href: "/bodywork" },
          { label: providerSlug, href: `/bodywork/${providerSlug}` },
          { label: String(extracted.invoice_number ?? "invoice"), current: true }
        ]}
        actions={[{ label: "biz overview", href: "/biz-overview", variant: "filled" }]}
      />
      <main className="page-main">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
          <Link className="ui-back-link" href={`/bodywork/${providerSlug}`}>
            ← cd /{providerSlug}
          </Link>
          {bill?.originalPdfUrl ? (
            <a href={bill.originalPdfUrl} target="_blank" rel="noreferrer">
              view original PDF
            </a>
          ) : null}
        </div>

        <section className="ui-card">
          <div className="ui-label">// bodywork invoice</div>
          <h1 style={{ fontSize: 28, marginTop: 8 }}>{provider?.fullName ?? provider?.name ?? providerSlug}</h1>
          <p style={{ marginTop: 8, color: "var(--ui-text-secondary)" }}>
            {String(extracted.invoice_number ?? "—")} · {formatDate(extracted.invoice_date)} · due {formatDate(extracted.due_date)}
          </p>
          <div style={{ marginTop: 10, fontSize: 34, fontWeight: 700 }}>{fmtUSD(total)}</div>
        </section>

        {grouped.map(([horseName, items]) => (
          <section className="ui-card" style={{ marginTop: 16 }} key={horseName}>
            <h2 style={{ fontSize: 18, marginBottom: 10 }}>{horseName}</h2>
            <ul style={{ paddingLeft: 18 }}>
              {items.map((row, idx) => (
                <li key={`${horseName}-${idx}`} style={{ marginBottom: 8 }}>
                  {row.description ?? "—"} · {fmtUSD(typeof row.total_usd === "number" ? row.total_usd : 0)}
                </li>
              ))}
            </ul>
          </section>
        ))}

        <section className="ui-card" style={{ marginTop: 16, display: "flex", gap: 10 }}>
          <button type="button" className="ui-button-filled" onClick={onApprove} disabled={bill?.status === "done"}>
            approve invoice
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
          <div style={{ display: "flex", gap: 24 }}>
            <Summary label="ITEMS" value={String(lineItems.length)} />
            <Summary label="HORSES" value={String(grouped.filter(([name]) => name !== "Unassigned / General").length)} />
            <Summary label="STATUS" value={bill?.status === "done" ? "APPROVED" : "PENDING"} />
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 10, color: "#9EA2B0" }}>TOTAL DUE</div>
            <div style={{ fontSize: 24, fontWeight: 700 }}>{fmtUSD(total)}</div>
          </div>
        </section>

        <div className="ui-footer">OLD_OAK_HORSES // BODYWORK // {providerSlug.toUpperCase()}</div>

        <Modal open={showDeleteConfirm} title="delete invoice?" onClose={() => setShowDeleteConfirm(false)}>
          <p style={{ marginTop: 0, color: "var(--ui-text-secondary)" }}>
            this will permanently delete invoice <strong>{String(extracted.invoice_number ?? billId)}</strong> from {provider?.name ?? providerSlug}.
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

function fmtUSD(v: number) {
  return `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatDate(value: unknown) {
  if (typeof value !== "string" || !value) return "—";
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}
