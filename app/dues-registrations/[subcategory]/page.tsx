"use client";

import Link from "next/link";
import { useMemo } from "react";
import { useParams } from "next/navigation";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import NavBar from "@/components/NavBar";

export default function DuesSubcategoryPage() {
  const params = useParams<{ subcategory: string }>();
  const subcategory = params?.subcategory ?? "memberships";
  const categories: any[] = useQuery(api.categories.getAllCategories) ?? [];
  const category = categories.find((row) => row.slug === "dues-registrations");
  const providers: any[] = useQuery(
    api.providers.getProvidersByCategoryAndSubcategory,
    category ? { categoryId: category._id, subcategorySlug: subcategory } : "skip"
  ) ?? [];
  const bills: any[] = useQuery(api.bills.getBillsByCategory, category ? { categoryId: category._id } : "skip") ?? [];
  const filtered = useMemo(() => bills.filter((bill) => bill.duesSubcategory === subcategory), [bills, subcategory]);

  return (
    <div className="page-shell">
      <NavBar
        items={[
          { label: "old-oak-horses", href: "/dashboard", brand: true },
          { label: "dues-registrations", href: "/dues-registrations" },
          { label: subcategory, current: true }
        ]}
        actions={[
          { label: "upload invoices", href: "/upload", variant: "outlined" },
          { label: "biz overview", href: "/biz-overview", variant: "filled" }
        ]}
      />

      <main className="page-main">
        <Link href="/dues-registrations" className="ui-back-link">← cd /dues-registrations</Link>

        <section className="ui-card">
          <div className="ui-label">// dues_registrations</div>
          <h1 style={{ fontSize: 32, marginTop: 8 }}>{titleCase(subcategory)}</h1>
          <p style={{ color: "var(--ui-text-secondary)" }}>{filtered.length} invoices</p>
        </section>

        <section className="ui-card" style={{ marginTop: 16 }}>
          <div style={{ fontWeight: 700, marginBottom: 10 }}>providers</div>
          <div style={{ display: "grid", gap: 8 }}>
            {providers.map((provider) => (
              <Link key={provider._id} href={`/dues-registrations/${subcategory}/${provider.slug ?? slugify(provider.name)}`}>
                {provider.name}
              </Link>
            ))}
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
