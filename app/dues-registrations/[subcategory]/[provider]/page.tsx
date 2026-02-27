"use client";

import Link from "next/link";
import { useMemo } from "react";
import { useParams } from "next/navigation";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import NavBar from "@/components/NavBar";

export default function DuesProviderPage() {
  const params = useParams<{ subcategory: string; provider: string }>();
  const subcategory = params?.subcategory ?? "memberships";
  const providerSlug = params?.provider ?? "other";

  const provider = useQuery(api.providers.getProviderBySlug, {
    categorySlug: "dues-registrations",
    providerSlug,
    subcategorySlug: subcategory
  });
  const bills: any[] = useQuery(api.bills.getBillsByProvider, provider ? { providerId: provider._id } : "skip") ?? [];
  const filtered = useMemo(() => bills.filter((bill) => bill.duesSubcategory === subcategory), [bills, subcategory]);

  return (
    <div className="page-shell">
      <NavBar
        items={[
          { label: "old-oak-horses", href: "/dashboard", brand: true },
          { label: "dues-registrations", href: "/dues-registrations" },
          { label: subcategory, href: `/dues-registrations/${subcategory}` },
          { label: providerSlug, current: true }
        ]}
      />

      <main className="page-main">
        <Link href={`/dues-registrations/${subcategory}`} className="ui-back-link">← cd /dues-registrations/{subcategory}</Link>

        <section className="ui-card">
          <div className="ui-label">DUES & REGISTRATIONS · {titleCase(subcategory)}</div>
          <h1 style={{ fontSize: 32, marginTop: 8 }}>{provider?.name ?? providerSlug}</h1>
        </section>

        <section className="ui-card" style={{ marginTop: 16 }}>
          <div style={{ fontWeight: 700, marginBottom: 10 }}>invoices</div>
          <div style={{ display: "grid", gap: 8 }}>
            {filtered.map((bill) => (
              <Link key={bill._id} href={`/dues-registrations/${subcategory}/${providerSlug}/${bill._id}`}>
                {String((bill.extractedData as any)?.invoice_number ?? bill.fileName)} · {formatDate((bill.extractedData as any)?.invoice_date)}
              </Link>
            ))}
            {filtered.length === 0 ? <div style={{ color: "#9EA2B0" }}>no invoices yet.</div> : null}
          </div>
        </section>
      </main>
    </div>
  );
}

function titleCase(value: string) {
  return value.split("-").map((chunk) => chunk.charAt(0).toUpperCase() + chunk.slice(1)).join(" ");
}

function formatDate(value: unknown) {
  if (typeof value !== "string" || !value) return "—";
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}
