import { redirect } from "next/navigation";

export default async function GroomingBillPage({ params }: { params: Promise<{ subcategory: string; billId: string }> }) {
  const { billId } = await params;
  redirect(`/invoices/preview/${billId}`);
}
