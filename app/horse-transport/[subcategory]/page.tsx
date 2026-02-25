"use client";

import Link from "next/link";
import { useMemo } from "react";
import { useParams } from "next/navigation";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import NavBar from "@/components/NavBar";

export default function HorseTransportSubcategoryPage() {
  const params = useParams<{ subcategory: string }>();
  const subcategory = params?.subcategory ?? "";
  const categories = useQuery(api.categories.getAllCategories) ?? [];
  const horseTransportCategory = categories.find((row) => row.slug === "horse-transport");
  const providers = useQuery(
    api.providers.getProvidersByCategoryAndSubcategory,
    horseTransportCategory ? { categoryId: horseTransportCategory._id, subcategorySlug: subcategory } : "skip"
  );

  const title = useMemo(() => {
    if (subcategory === "ground-transport") return "Ground Transport";
    if (subcategory === "air-transport") return "Air Transport";
    return subcategory;
  }, [subcategory]);

  return (
    <div className="page-shell">
      <NavBar
        items={[
          { label: "old-oak-horses", href: "/dashboard", brand: true },
          { label: "horse_transport", href: "/horse-transport" },
          { label: subcategory, current: true }
        ]}
        actions={[
          { label: "upload invoices", href: "/upload", variant: "outlined" },
          { label: "biz overview", href: "/biz-overview", variant: "filled" }
        ]}
      />
      <main className="page-main">
        <Link className="ui-back-link" href="/horse-transport">
          ← cd /horse-transport
        </Link>
        <section className="ui-card">
          <div className="ui-label">// horse transport</div>
          <h1 style={{ fontSize: 28, marginTop: 8 }}>{title}</h1>
          <p style={{ color: "var(--ui-text-muted)", marginTop: 8 }}>providers</p>
          {providers === undefined ? (
            <p>loading...</p>
          ) : providers.length === 0 ? (
            <p>no providers seeded for this subcategory yet.</p>
          ) : (
            <ul style={{ marginTop: 12, paddingLeft: 18 }}>
              {providers.map((provider) => (
                <li key={provider._id}>
                  <Link href={`/horse-transport/${subcategory}/${provider.slug ?? provider.name.toLowerCase().replace(/\s+/g, "-")}`}>{provider.name}</Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </div>
  );
}
