"use client";

import Link from "next/link";
import { useMemo } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import NavBar from "@/components/NavBar";
import { formatInvoiceTitle, toIsoDateString } from "@/lib/invoiceTitle";

export default function BodyworkOverviewPage() {
  const categories = useQuery(api.categories.getAllCategories) ?? [];
  const category = categories.find((row) => row.slug === "bodywork");
  const providers = useQuery(api.providers.getProvidersByCategory, category ? { categoryId: category._id } : "skip") ?? [];
  const bills = useQuery(api.bills.getBillsByCategory, category ? { categoryId: category._id } : "skip") ?? [];

  const providerMap = useMemo(() => new Map(providers.map((row) => [String(row._id), row])), [providers]);
  const totalSpend = useMemo(
    () =>
      bills.reduce((sum, bill) => {
        const extracted = (bill.extractedData ?? {}) as { invoice_total_usd?: number; line_items?: Array<{ total_usd?: number }> };
        if (typeof extracted.invoice_total_usd === "number") return sum + extracted.invoice_total_usd;
        return sum + (extracted.line_items ?? []).reduce((s, row) => s + (typeof row.total_usd === "number" ? row.total_usd : 0), 0);
      }, 0),
    [bills]
  );

  const spendByProvider = useMemo(() => {
    const totals = new Map<string, number>();
    for (const bill of bills) {
      const provider = bill.providerId ? providerMap.get(String(bill.providerId)) : null;
      const name = provider?.name ?? bill.customProviderName ?? "Unknown";
      const extracted = (bill.extractedData ?? {}) as { invoice_total_usd?: number; line_items?: Array<{ total_usd?: number }> };
      const total =
        typeof extracted.invoice_total_usd === "number"
          ? extracted.invoice_total_usd
          : (extracted.line_items ?? []).reduce((sum, row) => sum + (typeof row.total_usd === "number" ? row.total_usd : 0), 0);
      totals.set(name, (totals.get(name) ?? 0) + total);
    }
    return [...totals.entries()].sort((a, b) => b[1] - a[1]);
  }, [bills, providerMap]);

  return (
    <div className="page-shell">
      <NavBar
        items={[
          { label: "old-oak-horses", href: "/dashboard", brand: true },
          { label: "bodywork", current: true }
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
          <div className="ui-label">// bodywork</div>
          <h1 style={{ fontSize: 30, marginTop: 8 }}>bodywork</h1>
          <p style={{ color: "var(--ui-text-muted)", marginTop: 6 }}>{bills.length} invoices</p>
          <div style={{ marginTop: 10, fontSize: 34, fontWeight: 700 }}>{fmtUSD(totalSpend)}</div>
        </section>

        <section className="ui-card" style={{ marginTop: 16 }}>
          <h2 style={{ fontSize: 16, marginBottom: 10 }}>spend_by_provider</h2>
          <ul style={{ paddingLeft: 18 }}>
            {spendByProvider.map(([name, amount]) => (
              <li key={name} style={{ marginBottom: 6 }}>
                {name} · {fmtUSD(amount)}
              </li>
            ))}
          </ul>
        </section>

        <section className="ui-card" style={{ marginTop: 16 }}>
          <h2 style={{ fontSize: 16, marginBottom: 10 }}>all_invoices</h2>
          <ul style={{ paddingLeft: 18 }}>
            {bills.map((bill) => {
              const provider = bill.providerId ? providerMap.get(String(bill.providerId)) : null;
              const providerSlug = provider?.slug ?? provider?.name.toLowerCase().replace(/[^a-z0-9]+/g, "-") ?? "unknown";
              const extracted = (bill.extractedData ?? {}) as { invoice_number?: string; invoice_total_usd?: number; invoice_date?: string };
              return (
                <li key={bill._id} style={{ marginBottom: 8 }}>
                  <Link href={`/bodywork/${providerSlug}/${bill._id}`}>
                    {formatInvoiceTitle({
                      category: "bodywork",
                      providerName: provider?.name ?? bill.customProviderName ?? "Unknown",
                      date: String(extracted.invoice_date ?? ""),
                    })}
                    {" · "}
                    <span style={{ color: "var(--ui-text-muted)", fontSize: 10 }}>
                      #{String(extracted.invoice_number ?? bill.fileName)} · {toIsoDateString(String(extracted.invoice_date ?? ""))}
                    </span>
                    {" · "}
                    {fmtUSD(typeof extracted.invoice_total_usd === "number" ? extracted.invoice_total_usd : 0)}
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>

        <div className="ui-footer">OLD_OAK_HORSES // BODYWORK</div>
      </main>
    </div>
  );
}

function fmtUSD(v: number) {
  return `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
