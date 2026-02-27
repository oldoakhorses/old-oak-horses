"use client";

import Link from "next/link";
import { useMemo } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import NavBar from "@/components/NavBar";

const SUBCATEGORIES = ["legal", "visas", "accounting", "payroll", "contractors"] as const;

export default function AdminOverviewPage() {
  const categories: any[] = useQuery(api.categories.getAllCategories) ?? [];
  const category = categories.find((row) => row.slug === "admin");
  const bills: any[] = useQuery(api.bills.getBillsByCategory, category ? { categoryId: category._id } : "skip") ?? [];
  const providers: any[] = useQuery(api.providers.getProvidersByCategory, category ? { categoryId: category._id } : "skip") ?? [];

  const bySubcategory = useMemo(() => {
    return SUBCATEGORIES.map((slug) => {
      const rows = bills.filter((bill) => bill.adminSubcategory === slug);
      const total = rows.reduce((sum, bill) => sum + getTotal(bill), 0);
      return { slug, count: rows.length, total };
    });
  }, [bills]);

  return (
    <div className="page-shell">
      <NavBar
        items={[
          { label: "old-oak-horses", href: "/dashboard", brand: true },
          { label: "admin", current: true }
        ]}
        actions={[
          { label: "upload invoices", href: "/upload", variant: "outlined" },
          { label: "biz overview", href: "/biz-overview", variant: "filled" }
        ]}
      />

      <main className="page-main">
        <Link href="/dashboard" className="ui-back-link">← cd /dashboard</Link>

        <section className="ui-card">
          <div className="ui-label">// admin</div>
          <h1 style={{ fontSize: 36, marginTop: 8 }}>admin</h1>
          <p style={{ color: "var(--ui-text-secondary)" }}>{bills.length} invoices · {fmtUSD(bySubcategory.reduce((sum, row) => sum + row.total, 0))}</p>
        </section>

        <section className="ui-card" style={{ marginTop: 16 }}>
          <div style={{ fontWeight: 700, marginBottom: 10 }}>spend_by_subcategory</div>
          <div style={{ display: "grid", gap: 8 }}>
            {bySubcategory.map((row) => (
              <Link key={row.slug} href={`/admin/${row.slug}`}>
                {titleCase(row.slug)} · {fmtUSD(row.total)} · {row.count} invoices
              </Link>
            ))}
          </div>
        </section>

        <section className="ui-card" style={{ marginTop: 16 }}>
          <div style={{ fontWeight: 700, marginBottom: 10 }}>providers</div>
          <div style={{ display: "grid", gap: 8 }}>
            {providers.map((provider) => (
              <div key={provider._id}>{provider.name} · {titleCase(provider.subcategorySlug ?? "")}</div>
            ))}
            {providers.length === 0 ? <div style={{ color: "#9EA2B0" }}>no providers yet.</div> : null}
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
  return value
    .split("-")
    .filter(Boolean)
    .map((chunk) => chunk.charAt(0).toUpperCase() + chunk.slice(1))
    .join(" ");
}
