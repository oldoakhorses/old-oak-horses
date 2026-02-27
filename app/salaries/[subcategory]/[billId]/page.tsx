import { redirect } from "next/navigation";

export default async function SalariesBillPage({ params }: { params: Promise<{ subcategory: string; billId: string }> }) {
  const { subcategory, billId } = await params;
  redirect(`/admin/${subcategory || "payroll"}/other/${billId}`);
}
