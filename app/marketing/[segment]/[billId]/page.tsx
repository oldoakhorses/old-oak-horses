"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import NavBar from "@/components/NavBar";
import Modal from "@/components/Modal";

const COLORS: Record<string, string> = {
  "vip-tickets": "#A78BFA",
  photography: "#4A5BDB",
  "social-media": "#EC4899"
};

export default function MarketingInvoicePage() {
  const router = useRouter();
  const params = useParams<{ segment: string; billId: string }>();
  const subcategory = params?.segment ?? "";
  const billId = params?.billId ?? "";

  const bill = useQuery(api.bills.getBillById, billId ? { billId: billId as any } : "skip");
  const approveBill = useMutation(api.bills.approveBill);
  const deleteBill = useMutation(api.bills.deleteBill);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const extracted = (bill?.extractedData ?? {}) as Record<string, unknown>;
  const lineItems = Array.isArray(extracted.line_items) ? (extracted.line_items as Array<Record<string, unknown>>) : [];
  const total = typeof extracted.invoice_total_usd === "number" ? extracted.invoice_total_usd : lineItems.reduce((sum, row) => sum + safe(row.total_usd), 0);

  const providerName = useMemo(() => {
    if (bill?.provider?.fullName) return bill.provider.fullName;
    if (bill?.provider?.name) return bill.provider.name;
    if (typeof extracted.provider_name === "string") return extracted.provider_name;
    if (bill?.customProviderName) return bill.customProviderName;
    return "Unknown Vendor";
  }, [bill?.customProviderName, bill?.provider?.fullName, bill?.provider?.name, extracted.provider_name]);

  async function onApprove() {
    if (!bill) return;
    console.log("Approve clicked, billId:", bill._id);
    try {
      await approveBill({ billId: bill._id });
      console.log("Approve mutation succeeded");
    } catch (error) {
      console.error("Approve mutation failed:", error);
    }
  }

  async function onDelete() {
    if (!bill) return;
    await deleteBill({ billId: bill._id });
    router.push(`/marketing/${subcategory}`);
  }

  return (
    <div className="page-shell">
      <NavBar
        items={[
          { label: "old-oak-horses", href: "/dashboard", brand: true },
          { label: "marketing", href: "/marketing" },
          { label: subcategory, href: `/marketing/${subcategory}` },
          { label: String(extracted.invoice_number ?? "invoice"), current: true }
        ]}
        actions={bill?.originalPdfUrl ? [{ label: "view original PDF", href: bill.originalPdfUrl, variant: "link", newTab: true }] : []}
      />
      <main className="page-main">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
          <Link className="ui-back-link" href={`/marketing/${subcategory}`}>
            ← cd /{subcategory}
          </Link>
        </div>

        <section className="ui-card">
          <div className="ui-label">// marketing invoice</div>
          <div style={{ display: "inline-flex", gap: 8, alignItems: "center", marginTop: 6 }}>
            <span
              style={{
                background: `${COLORS[subcategory] ?? "#6B7084"}22`,
                color: COLORS[subcategory] ?? "#6B7084",
                padding: "2px 8px",
                borderRadius: 6,
                fontSize: 11,
                fontWeight: 700
              }}
            >
              {subcategory}
            </span>
          </div>
          <h1 style={{ fontSize: 28, marginTop: 10 }}>{providerName}</h1>
          <p style={{ color: "var(--ui-text-secondary)", marginTop: 8 }}>
            {String(extracted.invoice_number ?? "—")} · {formatDate(extracted.invoice_date)} · due {formatDate(extracted.due_date)}
          </p>
          <div style={{ fontSize: 34, fontWeight: 700, marginTop: 10 }}>{fmtUSD(total)}</div>
        </section>

        {(bill?.provider?.address || bill?.provider?.phone || bill?.provider?.email) ? (
          <section className="ui-card" style={{ marginTop: 16 }}>
            <div className="ui-label">// provider contact</div>
            <p style={{ marginTop: 8 }}>{bill?.provider?.address ?? "—"}</p>
            <p>{bill?.provider?.phone ?? "—"}</p>
            <p>{bill?.provider?.email ?? "—"}</p>
          </section>
        ) : null}

        <section className="ui-card" style={{ marginTop: 16 }}>
          <h2 style={{ fontSize: 16, marginBottom: 10 }}>line_items</h2>
          {lineItems.length === 0 ? (
            <p>no parsed line items.</p>
          ) : (
            <ul style={{ paddingLeft: 18 }}>
              {lineItems.map((row, idx) => (
                <li key={idx} style={{ marginBottom: 8 }}>
                  {String(row.description ?? "—")} · {fmtUSD(safe(row.total_usd))}
                </li>
              ))}
            </ul>
          )}
        </section>

        <div style={{ marginTop: 16, marginBottom: 20, display: "flex", gap: 10 }}>
          {bill?.status === "done" ? (
            <div
              style={{
                flex: 1,
                background: "rgba(34, 197, 131, 0.08)",
                border: "1px solid #22C583",
                borderRadius: 8,
                padding: "14px 20px",
                display: "flex",
                alignItems: "center",
                gap: 8,
                fontSize: 12,
                fontWeight: 700,
                color: "#22C583"
              }}
            >
              ✓ invoice approved
            </div>
          ) : (
            <button type="button" className="ui-button-filled" onClick={onApprove} style={{ background: "#22C583", borderColor: "#22C583" }}>
              approve invoice
            </button>
          )}
          <button type="button" className="ui-button-outlined" onClick={() => setShowDeleteConfirm(true)}>
            delete
          </button>
        </div>

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
            <Summary label="SUBCATEGORY" value={subcategory} />
            <Summary label="ITEMS" value={String(lineItems.length)} />
            <Summary label="STATUS" value={bill?.status === "done" ? "APPROVED" : "PENDING"} />
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 10, color: "#9EA2B0" }}>TOTAL DUE</div>
            <div style={{ fontSize: 24, fontWeight: 700 }}>{fmtUSD(total)}</div>
          </div>
        </section>

        <div className="ui-footer">OLD_OAK_HORSES // MARKETING // {subcategory.toUpperCase()}</div>

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

function safe(v: unknown) {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

function formatDate(value: unknown) {
  if (typeof value !== "string" || !value) return "—";
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}
