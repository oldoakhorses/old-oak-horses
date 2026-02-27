"use client";

import Link from "next/link";
import { useMemo } from "react";
import { useParams } from "next/navigation";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import NavBar from "@/components/NavBar";

export default function AdminSubcategoryPage() {
  const params = useParams<{ subcategory: string }>();
  const subcategory = params?.subcategory ?? "payroll";
  const categories: any[] = useQuery(api.categories.getAllCategories) ?? [];
  const adminCategory = categories.find((row) => row.slug === "admin");
  const providers: any[] = useQuery(
    api.providers.getProvidersByCategoryAndSubcategory,
    adminCategory ? { categoryId: adminCategory._id, subcategorySlug: subcategory } : "skip"
  ) ?? [];
  const bills: any[] = useQuery(api.bills.getBillsByCategory, adminCategory ? { categoryId: adminCategory._id } : "skip") ?? [];

  const filteredBills = useMemo(() => bills.filter((row) => row.adminSubcategory === subcategory), [bills, subcategory]);

  return (
    <div className="page-shell">
      <NavBar
        items={[
          { label: "old-oak-horses", href: "/dashboard", brand: true },
          { label: "admin", href: "/admin" },
          { label: subcategory, current: true }
        ]}
        actions={[
          { label: "upload invoices", href: "/upload", variant: "outlined" },
          { label: "biz overview", href: "/biz-overview", variant: "filled" }
        ]}
      />

      <main className="page-main">
        <Link href="/admin" className="ui-back-link">← cd /admin</Link>
        <section className="ui-card">
          <div className="ui-label">// admin</div>
          <h1 style={{ fontSize: 32, marginTop: 8 }}>{titleCase(subcategory)}</h1>
          <p style={{ color: "var(--ui-text-secondary)" }}>{filteredBills.length} invoices</p>
        </section>

        <section className="ui-card" style={{ marginTop: 16 }}>
          <div style={{ fontWeight: 700, marginBottom: 10 }}>providers</div>
          <div style={{ display: "grid", gap: 8 }}>
            {providers.map((provider) => (
              <Link key={provider._id} href={`/admin/${subcategory}/${provider.slug ?? slugify(provider.name)}`}>
                {provider.name}
              </Link>
            ))}
            {providers.length === 0 ? <div style={{ color: "#9EA2B0" }}>no seeded providers for this subcategory.</div> : null}
          </div>
        </section>

        <section className="ui-card" style={{ marginTop: 16 }}>
          <div style={{ fontWeight: 700, marginBottom: 10 }}>invoices</div>
          <div style={{ display: "grid", gap: 8 }}>
            {filteredBills.map((bill) => {
              const providerName = bill.provider?.name ?? bill.customProviderName ?? "Other";
              const providerSlug = bill.provider?.slug ?? slugify(providerName);
              const number = String((bill.extractedData as any)?.invoice_number ?? bill.fileName);
              return (
                <Link key={bill._id} href={`/admin/${subcategory}/${providerSlug}/${bill._id}`}>
                  {number} · {providerName}
                </Link>
              );
            })}
            {filteredBills.length === 0 ? <div style={{ color: "#9EA2B0" }}>no invoices yet.</div> : null}
          </div>
        </section>
      </main>
    </div>
  );
}

function titleCase(value: string) {
  return value.split("-").map((chunk) => chunk.charAt(0).toUpperCase() + chunk.slice(1)).join(" ");
}

function slugify(value: string) {
  return value.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)+/g, "");
}
