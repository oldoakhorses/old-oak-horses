"use client";

import Link from "next/link";
import { useMemo } from "react";
import { useParams } from "next/navigation";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import NavBar from "@/components/NavBar";

type LineItem = {
  description?: string;
  horse_name?: string;
  total_usd?: number;
};

type Extracted = {
  invoice_number?: string;
  invoice_date?: string;
  due_date?: string;
  origin?: string;
  destination?: string;
  invoice_total_usd?: number;
  line_items?: LineItem[];
};

export default function HorseTransportInvoicePage() {
  const params = useParams<{ subcategory: string; provider: string; billId: string }>();
  const subcategory = params?.subcategory ?? "";
  const providerSlug = params?.provider ?? "";
  const billId = params?.billId ?? "";

  const bill = useQuery(api.bills.getBillById, billId ? { billId: billId as any } : "skip");
  const provider = useQuery(api.providers.getProviderBySlug, { categorySlug: "horse-transport", providerSlug });
  const extracted = (bill?.extractedData ?? {}) as Extracted;
  const lineItems = Array.isArray(extracted.line_items) ? extracted.line_items : [];

  const grouped = useMemo(() => {
    const map = new Map<string, LineItem[]>();
    for (const item of lineItems) {
      const key = item.horse_name?.trim() || "General / Unassigned";
      map.set(key, [...(map.get(key) ?? []), item]);
    }
    return [...map.entries()];
  }, [lineItems]);

  const total = typeof extracted.invoice_total_usd === "number"
    ? extracted.invoice_total_usd
    : lineItems.reduce((sum, item) => sum + safe(item.total_usd), 0);

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
        actions={[{ label: "biz overview", href: "/biz-overview", variant: "filled" }]}
      />
      <main className="page-main">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
          <Link className="ui-back-link" href={`/horse-transport/${subcategory}/${providerSlug}`}>
            ← cd /{providerSlug}
          </Link>
          {bill?.originalPdfUrl ? (
            <a href={bill.originalPdfUrl} target="_blank" rel="noreferrer">
              view original PDF
            </a>
          ) : null}
        </div>

        <section className="ui-card">
          <div className="ui-label">// horse transport invoice</div>
          <h1 style={{ fontSize: 26, marginTop: 8 }}>{provider?.fullName ?? provider?.name ?? providerSlug}</h1>
          <div style={{ marginTop: 10, color: "var(--ui-text-secondary)" }}>
            {extracted.invoice_number ?? "—"} · {formatDate(extracted.invoice_date)} · Due {formatDate(extracted.due_date)} · {extracted.origin ?? "—"} →{" "}
            {extracted.destination ?? "—"}
          </div>
          <div style={{ fontSize: 28, fontWeight: 700, marginTop: 12 }}>{fmtUSD(total)}</div>
        </section>

        {grouped.map(([horse, items]) => (
          <section className="ui-card" key={horse} style={{ marginTop: 16 }}>
            <h3 style={{ fontSize: 18 }}>{horse}</h3>
            <ul style={{ marginTop: 10, paddingLeft: 18 }}>
              {items.map((item, idx) => (
                <li key={`${horse}-${idx}`}>
                  {item.description ?? "—"} · {fmtUSD(safe(item.total_usd))}
                </li>
              ))}
            </ul>
          </section>
        ))}
      </main>
    </div>
  );
}

function fmtUSD(v: number) {
  return `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function safe(v: unknown) {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

function formatDate(value?: string) {
  if (!value) return "—";
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}
