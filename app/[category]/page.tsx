"use client";

import { useParams } from "next/navigation";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import CategoryOverviewPage from "@/components/CategoryOverviewPage";

export default function CategoryPage() {
  const params = useParams<{ category: string }>();
  const categorySlug = params?.category ?? "";
  const categories: any[] = useQuery(api.categories.getAllCategories) ?? [];

  const category = categories.find((row: any) => row.slug === categorySlug);
  if (!category) {
    return (
      <div className="page-shell">
        <main className="page-main">
          <section className="ui-card">Category not found.</section>
        </main>
      </div>
    );
  }

  return <CategoryOverviewPage categoryId={category._id} categoryName={category.name} categorySlug={category.slug} />;
}
