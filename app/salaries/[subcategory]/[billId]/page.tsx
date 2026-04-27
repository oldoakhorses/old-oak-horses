import { redirect } from "next/navigation";

export default async function SalariesBillPage({ params }: { params: Promise<{ subcategory: string; billId: string }> }) {
  const { billId } = await params;
  redirect(`/invoices/preview/${billId}`);
}
