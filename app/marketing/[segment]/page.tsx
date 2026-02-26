"use client";

import Link from "next/link";
import { useMemo } from "react";
import { useParams } from "next/navigation";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import NavBar from "@/components/NavBar";
import { formatInvoiceTitle, toIsoDateString } from "@/lib/invoiceTitle";

const SUBCATEGORIES = new Set(["vip-tickets", "photography", "social-media"]);
const LABELS: Record<string, string> = {
  "vip-tickets": "VIP Tickets",
  photography: "Photography",
  "social-media": "Social Media"
};

export default function MarketingSegmentPage() {
  const params = useParams<{ segment: string }>();
  const segment = params?.segment ?? "";
  const categories = useQuery(api.categories.getAllCategories) ?? [];
  const marketing = categories.find((row) => row.slug === "marketing");
  const bills = useQuery(
    api.bills.getMarketingBills,
    marketing ? { categoryId: marketing._id, subcategory: SUBCATEGORIES.has(segment) ? segment : undefined } : "skip"
  );
  const provider = useQuery(api.providers.getProviderBySlug, !SUBCATEGORIES.has(segment) ? { categorySlug: "marketing", providerSlug: segment } : "skip");
  const providerBills = useQuery(api.bills.getBillsByProvider, provider ? { providerId: provider._id } : "skip");

  const isSubcategoryPage = SUBCATEGORIES.has(segment);
  const displayName = LABELS[segment] ?? segment;
  const subcategoryTotal = useMemo(() => (bills ?? []).reduce((sum, bill) => sum + bill.totalUsd, 0), [bills]);

  return (
    <div className="page-shell">
      <NavBar
        items={[
          { label: "old-oak-horses", href: "/dashboard", brand: true },
          { label: "marketing", href: "/marketing" },
          { label: segment, current: true }
        ]}
        actions={[
          { label: "upload invoices", href: "/upload", variant: "outlined" },
          { label: "biz overview", href: "/biz-overview", variant: "filled" }
        ]}
      />
      <main className="page-main">
        <Link className="ui-back-link" href="/marketing">
          ← cd /marketing
        </Link>

        {isSubcategoryPage ? (
          <section className="ui-card">
            <div className="ui-label">// marketing subcategory</div>
            <h1 style={{ fontSize: 28, marginTop: 8 }}>{displayName}</h1>
            <p style={{ color: "var(--ui-text-muted)", marginTop: 6 }}>{(bills ?? []).length} invoices</p>
            <div style={{ fontSize: 30, fontWeight: 700, marginTop: 10 }}>{fmtUSD(subcategoryTotal)}</div>
            <ul style={{ paddingLeft: 18, marginTop: 14 }}>
              {(bills ?? []).map((bill) => (
                <li key={bill._id} style={{ marginBottom: 8 }}>
                  <Link href={`/marketing/${segment}/${bill._id}`}>
                    {formatInvoiceTitle({
                      category: "marketing",
                      providerName: bill.providerName,
                      subcategory: segment,
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
        ) : (
          <section className="ui-card">
            <div className="ui-label">// provider</div>
            <h1 style={{ fontSize: 28, marginTop: 8 }}>{provider?.fullName ?? provider?.name ?? segment}</h1>
            {providerBills === undefined ? <p>loading...</p> : null}
            {providerBills && providerBills.length === 0 ? <p style={{ marginTop: 10 }}>no invoices for this provider yet.</p> : null}
            {providerBills && providerBills.length > 0 ? (
              <ul style={{ paddingLeft: 18, marginTop: 14 }}>
                {providerBills.map((bill) => (
                  <li key={bill._id} style={{ marginBottom: 8 }}>
                    <Link href={`/marketing/${bill.marketingSubcategory ?? "other"}/${bill._id}`}>
                      {formatInvoiceTitle({
                        category: "marketing",
                        providerName: provider?.name ?? segment,
                        subcategory: bill.marketingSubcategory ?? "other",
                        date: String((bill.extractedData as any)?.invoice_date ?? ""),
                      })}
                      {" · "}
                      <span style={{ color: "var(--ui-text-muted)", fontSize: 10 }}>
                        #{String((bill.extractedData as any)?.invoice_number ?? bill.fileName)} · {toIsoDateString(String((bill.extractedData as any)?.invoice_date ?? ""))}
                      </span>
                      {" · "}
                      {fmtUSD((bill.extractedData as any)?.invoice_total_usd ?? 0)}
                    </Link>
                  </li>
                ))}
              </ul>
            ) : null}
          </section>
        )}
      </main>
    </div>
  );
}

function fmtUSD(v: number) {
  return `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
