import { redirect } from "next/navigation";

export default async function GroomingSubcategoryPage({ params }: { params: Promise<{ subcategory: string }> }) {
  const { subcategory } = await params;
  redirect(`/admin/${subcategory || "groom"}`);
}
