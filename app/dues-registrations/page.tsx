"use client";

import Link from "next/link";
import { useMemo } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import NavBar from "@/components/NavBar";

const SUBCATEGORIES = [
  { slug: "horse-registrations", label: "Horse Registrations" },
  { slug: "rider-registrations", label: "Rider Registrations" },
  { slug: "memberships", label: "Memberships" }
] as const;

export default function DuesOverviewPage() {
  const categories: any[] = useQuery(api.categories.getAllCategories) ?? [];
  const category = categories.find((row) => row.slug === "dues-registrations");
  const bills: any[] = useQuery(api.bills.getBillsByCategory, category ? { categoryId: category._id } : "skip") ?? [];

  const summary = useMemo(
    () =>
      SUBCATEGORIES.map((row) => {
        const rows = bills.filter((bill) => bill.duesSubcategory === row.slug);
        const total = rows.reduce((sum, bill) => sum + getTotal(bill), 0);
        return { ...row, total, count: rows.length };
      }),
    [bills]
  );

  return (
    <div className="page-shell">
      <NavBar
        items={[
          { label: "old-oak-horses", href: "/dashboard", brand: true },
          { label: "dues_registrations", current: true }
        ]}
        actions={[
          { label: "upload invoices", href: "/upload", variant: "outlined" },
          { label: "biz overview", href: "/biz-overview", variant: "filled" }
        ]}
      />

      <main className="page-main">
        <Link href="/dashboard" className="ui-back-link">← cd /dashboard</Link>

        <section className="ui-card">
          <div className="ui-label">// dues_registrations</div>
          <h1 style={{ fontSize: 36, marginTop: 8 }}>dues & registrations</h1>
          <p style={{ color: "var(--ui-text-secondary)" }}>{bills.length} invoices · {fmtUSD(summary.reduce((sum, row) => sum + row.total, 0))}</p>
        </section>

        <section className="ui-card" style={{ marginTop: 16 }}>
          <div style={{ fontWeight: 700, marginBottom: 10 }}>spend_by_subcategory</div>
          <div style={{ display: "grid", gap: 8 }}>
            {summary.map((row) => (
              <Link key={row.slug} href={`/dues-registrations/${row.slug}`}>
                {row.label} · {fmtUSD(row.total)} · {row.count} invoices
              </Link>
            ))}
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
