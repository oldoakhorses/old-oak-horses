import { redirect } from "next/navigation";

export default async function SalariesSubcategoryPage({ params }: { params: Promise<{ subcategory: string }> }) {
  const { subcategory } = await params;
  redirect(`/admin/${subcategory || "payroll"}`);
}
