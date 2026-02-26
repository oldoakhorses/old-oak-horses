"use client";

import Link from "next/link";
import { useMemo } from "react";
import { useParams } from "next/navigation";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import NavBar from "@/components/NavBar";
import { formatInvoiceTitle, toIsoDateString } from "@/lib/invoiceTitle";

const LABELS: Record<string, string> = {
  rider: "Rider",
  groom: "Groom",
  freelance: "Freelance",
  other: "Other"
};

export default function SalariesSubcategoryPage() {
  const params = useParams<{ subcategory: string }>();
  const subcategory = params?.subcategory ?? "other";

  const categories = useQuery(api.categories.getAllCategories) ?? [];
  const salaries = categories.find((row) => row.slug === "salaries");

  const bills = useQuery(api.bills.getSalaryBills, salaries ? { categoryId: salaries._id, subcategory } : "skip") ?? [];

  const totals = useMemo(() => {
    const totalSpend = bills.reduce((sum, row) => sum + row.totalUsd, 0);
    const currentYear = new Date().getFullYear();
    const ytd = bills.filter((row) => typeof row.invoiceDate === "string" && row.invoiceDate.startsWith(String(currentYear)));
    const ytdSpend = ytd.reduce((sum, row) => sum + row.totalUsd, 0);
    return {
      totalSpend,
      totalInvoices: bills.length,
      ytdSpend,
      ytdInvoices: ytd.length
    };
  }, [bills]);

  const title = LABELS[subcategory] ?? titleCase(subcategory);

  return (
    <div className="page-shell">
      <NavBar
        items={[
          { label: "old-oak-horses", href: "/dashboard", brand: true },
          { label: "salaries", href: "/salaries" },
          { label: subcategory, current: true }
        ]}
        actions={[
          { label: "upload invoices", href: "/upload", variant: "outlined" },
          { label: "biz overview", href: "/biz-overview", variant: "filled" }
        ]}
      />

      <main className="page-main">
        <Link href="/salaries" className="ui-back-link">
          ← cd /salaries
        </Link>

        <section className="ui-card">
          <div className="ui-label">SALARIES · {subcategory.toUpperCase()}</div>
          <h1 style={{ fontSize: 30, marginTop: 8 }}>{title}</h1>
        </section>

        <section style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginTop: 16 }}>
          <article className="ui-card">
            <div className="ui-label">YTD SPEND ({new Date().getFullYear()})</div>
            <div style={{ fontSize: 30, fontWeight: 700, marginTop: 8 }}>{fmtUSD(totals.ytdSpend)}</div>
            <div style={{ color: "var(--ui-text-muted)", marginTop: 6 }}>{totals.ytdInvoices} invoices this year</div>
          </article>
          <article className="ui-card">
            <div className="ui-label">TOTAL SPEND</div>
            <div style={{ fontSize: 30, fontWeight: 700, marginTop: 8 }}>{fmtUSD(totals.totalSpend)}</div>
            <div style={{ color: "var(--ui-text-muted)", marginTop: 6 }}>{totals.totalInvoices} invoices total</div>
          </article>
        </section>

        <section className="ui-card" style={{ marginTop: 16 }}>
          <h2 style={{ fontSize: 16, marginBottom: 10 }}>invoices</h2>
          {bills.length === 0 ? (
            <p>no invoices for this subcategory yet.</p>
          ) : (
            <ul style={{ paddingLeft: 18 }}>
              {bills.map((bill) => (
                <li key={bill._id} style={{ marginBottom: 8 }}>
                  <Link href={`/salaries/${subcategory}/${bill._id}`}>
                    {formatInvoiceTitle({
                      category: "salaries",
                      providerName: bill.providerName,
                      subcategory,
                      date: bill.invoiceDate || "",
                    })}
                    {" · "}
                    <span style={{ color: "var(--ui-text-muted)", fontSize: 10 }}>
                      #{bill.invoiceNumber} · {toIsoDateString(bill.invoiceDate || "")}
                    </span>
                    {" · "}
                    {fmtUSD(bill.totalUsd)}
                    {" · "}
                    {bill.approvalStatus}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <div className="ui-footer">OLD_OAK_HORSES // SALARIES // {subcategory.toUpperCase()}</div>
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
