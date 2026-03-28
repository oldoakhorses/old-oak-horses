export type InvoiceNameInput = {
  providerName?: string | null;
  provider?: string | null;
  date?: string | number | Date | null;
  invoiceDate?: string | number | Date | null;
  invoice_date?: string | number | Date | null;
  [key: string]: unknown;
};

export function formatInvoiceDate(value?: string | number | Date | null) {
  if (value === null || value === undefined || value === "") return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function toIsoDateString(value?: string | number | Date | null) {
  if (value === null || value === undefined || value === "") return "Unknown Date";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown Date";
  return date.toISOString().slice(0, 10);
}

export function formatInvoiceName(input: InvoiceNameInput) {
  const provider =
    input.providerName?.trim() ||
    input.provider?.trim() ||
    "Unassigned Invoice";

  const date = formatInvoiceDate(input.date ?? input.invoiceDate ?? input.invoice_date);
  if (!provider && !date) return "Unassigned Invoice";
  if (!date) return provider || "Unassigned Invoice";
  return `${provider || "Unassigned Invoice"} — ${date}`;
}

export function formatInvoiceFileName(input: InvoiceNameInput) {
  const provider =
    input.providerName?.trim() ||
    input.provider?.trim() ||
    "unassigned-invoice";
  const slug = slugifyProvider(provider);

  const dateValue = input.date ?? input.invoiceDate ?? input.invoice_date;
  const date = dateValue instanceof Date ? dateValue : new Date(dateValue ?? "");
  const iso = Number.isNaN(date.getTime()) ? "undated" : date.toISOString().slice(0, 10);
  return `${slug}-${iso}.pdf`;
}

function slugifyProvider(value: string) {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-") || "unassigned-invoice";
}
