"use client";

import Link from "next/link";
import { useMemo } from "react";
import { useParams } from "next/navigation";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import NavBar from "@/components/NavBar";

type ProviderInvoiceRow = {
  _id: Id<"bills">;
  invoice_number: string;
  invoice_date: string | null;
  total_usd: number;
};

export default function HorseTransportProviderPage() {
  const params = useParams<{ subcategory: string; provider: string }>();
  const subcategory = params?.subcategory ?? "";
  const providerSlug = params?.provider ?? "";

  const provider = useQuery(api.providers.getProviderBySlug, { categorySlug: "horse-transport", providerSlug });
  const invoices = useQuery(api.bills.getBillsByProvider, provider ? { providerId: provider._id } : "skip");

  const rows = useMemo(() => {
    const data = (invoices ?? []) as ProviderInvoiceRow[];
    return data.filter((row) => row && row._id);
  }, [invoices]);

  return (
    <div className="page-shell">
      <NavBar
        items={[
          { label: "old-oak-horses", href: "/dashboard", brand: true },
          { label: "horse_transport", href: "/horse-transport" },
          { label: subcategory, href: `/horse-transport/${subcategory}` },
          { label: providerSlug, current: true }
        ]}
        actions={[
          { label: "upload invoices", href: "/upload", variant: "outlined" },
          { label: "biz overview", href: "/biz-overview", variant: "filled" }
        ]}
      />
      <main className="page-main">
        <Link className="ui-back-link" href={`/horse-transport/${subcategory}`}>
          ← cd /horse-transport/{subcategory}
        </Link>
        <section className="ui-card">
          <div className="ui-label">// provider</div>
          <h1 style={{ fontSize: 28, marginTop: 8 }}>{provider?.fullName ?? provider?.name ?? providerSlug}</h1>
          <p style={{ color: "var(--ui-text-muted)", marginTop: 8 }}>invoices</p>
          {rows.length === 0 ? (
            <p style={{ marginTop: 12 }}>no invoices yet.</p>
          ) : (
            <ul style={{ marginTop: 12, paddingLeft: 18 }}>
              {rows.map((row) => (
                <li key={row._id}>
                  <Link href={`/horse-transport/${subcategory}/${providerSlug}/${row._id}`}>
                    {row.invoice_number} · {row.invoice_date ?? "no date"} · {fmtUSD(row.total_usd)}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </div>
  );
}

function fmtUSD(v: number) {
  return `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
