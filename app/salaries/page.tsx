"use client";

import Link from "next/link";
import { useMemo } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import NavBar from "@/components/NavBar";

const LABELS: Record<string, string> = {
  rider: "Rider",
  groom: "Groom",
  freelance: "Freelance",
  other: "Other"
};

export default function SalariesOverviewPage() {
  const categories = useQuery(api.categories.getAllCategories) ?? [];
  const salaries = categories.find((row) => row.slug === "salaries");

  const bills = useQuery(api.bills.getSalaryBills, salaries ? { categoryId: salaries._id } : "skip") ?? [];
  const spendBySubcategory = useQuery(api.bills.getSalarySpendBySubcategory, salaries ? { categoryId: salaries._id } : "skip") ?? [];
  const spendByProvider = useQuery(api.bills.getSalarySpendByProvider, salaries ? { categoryId: salaries._id } : "skip") ?? [];
  const spendByPerson = useQuery(api.bills.getSalarySpendByPerson, salaries ? { categoryId: salaries._id } : "skip") ?? [];

  const totalSpend = useMemo(() => bills.reduce((sum, row) => sum + row.totalUsd, 0), [bills]);

  return (
    <div className="page-shell">
      <NavBar
        items={[
          { label: "old-oak-horses", href: "/dashboard", brand: true },
          { label: "salaries", current: true }
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
          <div className="ui-label">// category</div>
          <h1 style={{ fontSize: 32, marginTop: 8 }}>salaries</h1>
          <div style={{ fontSize: 34, fontWeight: 700, marginTop: 10 }}>{fmtUSD(totalSpend)}</div>
          <p style={{ color: "var(--ui-text-muted)", marginTop: 6 }}>{bills.length} invoices</p>
        </section>

        <section className="ui-card" style={{ marginTop: 16 }}>
          <h2 style={{ fontSize: 16, marginBottom: 10 }}>spend_by_subcategory</h2>
          {spendBySubcategory.length === 0 ? (
            <p>no salary invoices yet.</p>
          ) : (
            <ul style={{ paddingLeft: 18 }}>
              {spendBySubcategory.map((row) => (
                <li key={row.subcategory} style={{ marginBottom: 8 }}>
                  <Link href={`/salaries/${row.subcategory}`}>{LABELS[row.subcategory] ?? titleCase(row.subcategory)}</Link> · {fmtUSD(row.totalSpend)} · {row.invoiceCount} invoices
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="ui-card" style={{ marginTop: 16 }}>
          <h2 style={{ fontSize: 16, marginBottom: 10 }}>spend_by_provider</h2>
          {spendByProvider.length === 0 ? (
            <p>no provider data yet.</p>
          ) : (
            <ul style={{ paddingLeft: 18 }}>
              {spendByProvider.map((row) => (
                <li key={row.providerName} style={{ marginBottom: 8 }}>
                  {row.providerName} · {fmtUSD(row.totalSpend)} · {row.invoiceCount} invoices
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="ui-card" style={{ marginTop: 16 }}>
          <h2 style={{ fontSize: 16, marginBottom: 10 }}>spend_by_person</h2>
          {spendByPerson.length === 0 ? (
            <p>no person assignments yet.</p>
          ) : (
            <ul style={{ paddingLeft: 18 }}>
              {spendByPerson.map((row) => (
                <li key={`${row.personName}-${row.role}`} style={{ marginBottom: 8 }}>
                  {row.personName} ({row.role}) · {fmtUSD(row.totalSpend)} · {row.invoiceCount} invoices
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="ui-card" style={{ marginTop: 16 }}>
          <h2 style={{ fontSize: 16, marginBottom: 10 }}>all_invoices</h2>
          {bills.length === 0 ? (
            <p>no invoices found.</p>
          ) : (
            <ul style={{ paddingLeft: 18 }}>
              {bills.map((bill) => (
                <li key={bill._id} style={{ marginBottom: 8 }}>
                  <Link href={`/salaries/${bill.salariesSubcategory ?? "other"}/${bill._id}`}>
                    {bill.invoiceNumber} · {bill.providerName} · {fmtUSD(bill.totalUsd)} · {bill.approvalStatus}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <div className="ui-footer">OLD_OAK_HORSES // SALARIES</div>
      </main>
    </div>
  );
}

function fmtUSD(v: number) {
  return `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function titleCase(value: string) {
  return value
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
