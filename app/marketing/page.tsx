"use client";

import Link from "next/link";
import { useMemo } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import NavBar from "@/components/NavBar";

const SUBCATEGORY_LABELS: Record<string, string> = {
  "vip-tickets": "VIP Tickets",
  photography: "Photography",
  "social-media": "Social Media"
};

export default function MarketingOverviewPage() {
  const categories = useQuery(api.categories.getAllCategories) ?? [];
  const marketing = categories.find((row) => row.slug === "marketing");
  const bills = useQuery(api.bills.getMarketingBills, marketing ? { categoryId: marketing._id } : "skip");
  const spendBySubcategory = useQuery(api.bills.getMarketingSpendBySubcategory, marketing ? { categoryId: marketing._id } : "skip");
  const spendByProvider = useQuery(api.bills.getMarketingSpendByProvider, marketing ? { categoryId: marketing._id } : "skip");

  const totalSpend = useMemo(() => (bills ?? []).reduce((sum, bill) => sum + bill.totalUsd, 0), [bills]);

  return (
    <div className="page-shell">
      <NavBar
        items={[
          { label: "old-oak-horses", href: "/dashboard", brand: true },
          { label: "marketing", current: true }
        ]}
        actions={[
          { label: "upload invoices", href: "/upload", variant: "outlined" },
          { label: "biz overview", href: "/biz-overview", variant: "filled" }
        ]}
      />
      <main className="page-main">
        <Link href="/dashboard" className="ui-back-link">
          ← cd /dashboard
        </Link>

        <section className="ui-card">
          <div className="ui-label">// billing</div>
          <h1 style={{ fontSize: 30, marginTop: 8 }}>marketing</h1>
          <p style={{ marginTop: 6, color: "var(--ui-text-muted)" }}>{(bills ?? []).length} invoices</p>
          <div style={{ fontSize: 34, fontWeight: 700, marginTop: 10 }}>{fmtUSD(totalSpend)}</div>
        </section>

        <section className="ui-card" style={{ marginTop: 16 }}>
          <h2 style={{ fontSize: 16, marginBottom: 10 }}>spend_by_subcategory</h2>
          {spendBySubcategory?.length ? (
            <ul style={{ paddingLeft: 18 }}>
              {spendBySubcategory.map((row) => (
                <li key={row.subcategory} style={{ marginBottom: 6 }}>
                  <Link href={`/marketing/${row.subcategory}`}>{SUBCATEGORY_LABELS[row.subcategory] ?? row.subcategory}</Link> · {fmtUSD(row.totalSpend)} ·{" "}
                  {row.invoiceCount} invoices
                </li>
              ))}
            </ul>
          ) : (
            <p>no marketing invoices yet.</p>
          )}
        </section>

        <section className="ui-card" style={{ marginTop: 16 }}>
          <h2 style={{ fontSize: 16, marginBottom: 10 }}>spend_by_provider</h2>
          {spendByProvider?.length ? (
            <ul style={{ paddingLeft: 18 }}>
              {spendByProvider.map((row) => (
                <li key={row.providerName} style={{ marginBottom: 6 }}>
                  {row.providerName} · {fmtUSD(row.totalSpend)} · {row.invoiceCount} invoices
                </li>
              ))}
            </ul>
          ) : (
            <p>no provider data yet.</p>
          )}
        </section>

        <section className="ui-card" style={{ marginTop: 16 }}>
          <h2 style={{ fontSize: 16, marginBottom: 10 }}>all_invoices</h2>
          {bills?.length ? (
            <ul style={{ paddingLeft: 18 }}>
              {bills.map((bill) => (
                <li key={bill._id} style={{ marginBottom: 8 }}>
                  <Link href={`/marketing/${bill.marketingSubcategory ?? "other"}/${bill._id}`}>
                    {bill.invoiceNumber} · {bill.providerName} · {fmtUSD(bill.totalUsd)}
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p>no invoices found.</p>
          )}
        </section>

        <div className="ui-footer">OLD_OAK_HORSES // MARKETING</div>
      </main>
    </div>
  );
}

function fmtUSD(v: number) {
  return `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
