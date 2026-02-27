"use client";

import Link from "next/link";
import { useMemo } from "react";
import { useParams } from "next/navigation";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import NavBar from "@/components/NavBar";

export default function AdminProviderPage() {
  const params = useParams<{ subcategory: string; provider: string }>();
  const subcategory = params?.subcategory ?? "payroll";
  const providerSlug = params?.provider ?? "other";

  const provider = useQuery(api.providers.getProviderBySlug, {
    categorySlug: "admin",
    providerSlug,
    subcategorySlug: subcategory
  });
  const bills: any[] = useQuery(api.bills.getBillsByProvider, provider ? { providerId: provider._id } : "skip") ?? [];
  const filtered = useMemo(() => bills.filter((bill) => bill.adminSubcategory === subcategory), [bills, subcategory]);

  return (
    <div className="page-shell">
      <NavBar
        items={[
          { label: "old-oak-horses", href: "/dashboard", brand: true },
          { label: "admin", href: "/admin" },
          { label: subcategory, href: `/admin/${subcategory}` },
          { label: providerSlug, current: true }
        ]}
        actions={[
          { label: "upload invoices", href: "/upload", variant: "outlined" },
          { label: "biz overview", href: "/biz-overview", variant: "filled" }
        ]}
      />

      <main className="page-main">
        <Link href={`/admin/${subcategory}`} className="ui-back-link">← cd /admin/{subcategory}</Link>

        <section className="ui-card">
          <div className="ui-label">ADMIN · {titleCase(subcategory)}</div>
          <h1 style={{ fontSize: 32, marginTop: 8 }}>{provider?.name ?? providerSlug}</h1>
          <p style={{ color: "var(--ui-text-secondary)" }}>{filtered.length} invoices</p>
        </section>

        <section className="ui-card" style={{ marginTop: 16 }}>
          <div style={{ fontWeight: 700, marginBottom: 10 }}>invoices</div>
          <div style={{ display: "grid", gap: 8 }}>
            {filtered.map((bill) => {
              const invoiceNumber = String((bill.extractedData as any)?.invoice_number ?? bill.fileName);
              return (
                <Link key={bill._id} href={`/admin/${subcategory}/${providerSlug}/${bill._id}`}>
                  {invoiceNumber} · {formatDate((bill.extractedData as any)?.invoice_date)} · {fmtUSD(getTotal(bill))}
                </Link>
              );
            })}
            {filtered.length === 0 ? <div style={{ color: "#9EA2B0" }}>no invoices yet.</div> : null}
          </div>
        </section>
      </main>
    </div>
  );
}

function getTotal(bill: any) {
  if (typeof bill?.extractedData?.invoice_total_usd === "number") return bill.extractedData.invoice_total_usd;
  return 0;
}

function fmtUSD(value: number) {
  return `$${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function titleCase(value: string) {
  return value.split("-").map((chunk) => chunk.charAt(0).toUpperCase() + chunk.slice(1)).join(" ");
}

function formatDate(value: unknown) {
  if (typeof value !== "string" || !value) return "—";
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}
