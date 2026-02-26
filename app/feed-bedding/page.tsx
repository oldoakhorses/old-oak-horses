"use client";

import Link from "next/link";
import { useMemo } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import NavBar from "@/components/NavBar";
import { formatInvoiceTitle, toIsoDateString } from "@/lib/invoiceTitle";

export default function FeedBeddingOverviewPage() {
  const categories = useQuery(api.categories.getAllCategories) ?? [];
  const category = categories.find((row) => row.slug === "feed-bedding");
  const bills = useQuery(api.bills.getFeedBeddingBills, category ? { categoryId: category._id } : "skip") ?? [];

  const totalSpend = useMemo(() => bills.reduce((sum, bill) => sum + bill.totalUsd, 0), [bills]);
  const feedTotal = useMemo(() => bills.reduce((sum, bill) => sum + bill.feedTotal, 0), [bills]);
  const beddingTotal = useMemo(() => bills.reduce((sum, bill) => sum + bill.beddingTotal, 0), [bills]);

  const providerTotals = useMemo(() => {
    const map = new Map<string, number>();
    for (const bill of bills) {
      map.set(bill.providerName, (map.get(bill.providerName) ?? 0) + bill.totalUsd);
    }
    return [...map.entries()].sort((a, b) => b[1] - a[1]);
  }, [bills]);

  return (
    <div className="page-shell">
      <NavBar
        items={[
          { label: "old-oak-horses", href: "/dashboard", brand: true },
          { label: "feed-bedding", current: true }
        ]}
        actions={[
          { label: "upload invoices", href: "/upload", variant: "outlined" },
          { label: "biz overview", href: "/biz-overview", variant: "filled" }
        ]}
      />
      <main className="page-main">
        <Link className="ui-back-link" href="/dashboard">
          ← cd /dashboard
        </Link>
        <section className="ui-card">
          <div className="ui-label">// feed_bedding</div>
          <h1 style={{ fontSize: 30, marginTop: 8 }}>feed-bedding</h1>
          <div style={{ marginTop: 10, fontSize: 34, fontWeight: 700 }}>{fmtUSD(totalSpend)}</div>
          <p style={{ marginTop: 8, color: "var(--ui-text-secondary)" }}>
            Feed {fmtUSD(feedTotal)} · Bedding {fmtUSD(beddingTotal)}
          </p>
        </section>

        <section className="ui-card" style={{ marginTop: 16 }}>
          <h2 style={{ fontSize: 16, marginBottom: 10 }}>spend_by_provider</h2>
          <ul style={{ paddingLeft: 18 }}>
            {providerTotals.map(([name, amount]) => (
              <li key={name} style={{ marginBottom: 6 }}>
                {name} · {fmtUSD(amount)}
              </li>
            ))}
          </ul>
        </section>

        <section className="ui-card" style={{ marginTop: 16 }}>
          <h2 style={{ fontSize: 16, marginBottom: 10 }}>all_invoices</h2>
          <ul style={{ paddingLeft: 18 }}>
            {bills.map((bill) => (
                <li key={bill._id} style={{ marginBottom: 8 }}>
                  <Link href={`/feed-bedding/${bill.providerSlug}/${bill._id}`}>
                    {formatInvoiceTitle({
                      category: "feed-bedding",
                      providerName: bill.providerName,
                      date: bill.invoiceDate || "",
                    })}
                    {" · "}
                    <span style={{ color: "var(--ui-text-muted)", fontSize: 10 }}>
                      #{bill.invoiceNumber} · {toIsoDateString(bill.invoiceDate || "")}
                    </span>
                    {" · "}
                    {fmtUSD(bill.totalUsd)}
                  </Link>
                </li>
              ))}
          </ul>
        </section>
        <div className="ui-footer">OLD_OAK_HORSES // FEED_BEDDING</div>
      </main>
    </div>
  );
}

function fmtUSD(v: number) {
  return `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
