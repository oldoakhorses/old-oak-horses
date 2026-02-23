"use client";

import CategoryOverviewPage from "@/components/CategoryOverviewPage";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";

export default function VeterinaryCategoryPage() {
  const categories = useQuery(api.categories.getAllCategories) ?? [];
  const veterinary = categories.find((category) => category.slug === "veterinary");

  if (!veterinary) {
    return <section className="panel">Veterinary category not found.</section>;
  }

  return (
    <CategoryOverviewPage
      categoryId={veterinary._id}
      categoryName={veterinary.name}
      categorySlug={veterinary.slug}
    />
  );
}
