export type InvoiceNameInput = {
  /** User-saved/canonical name. If present, takes precedence over computed. */
  invoiceName?: string | null;
  contactName?: string | null;
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

function stripTrailingDate(name: string): string {
  return name
    .replace(/\s*[—–-]\s*(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{1,2},?\s*\d{4}\s*$/i, "")
    .replace(/\s*[—–-]\s*\d{1,2}\/\d{1,2}\/\d{2,4}\s*$/, "")
    .replace(/\s*[—–-]\s*\d{4}-\d{2}-\d{2}\s*$/, "")
    .trim();
}

export function formatInvoiceName(input: InvoiceNameInput) {
  const saved = input.invoiceName?.trim();
  if (saved) return stripTrailingDate(saved);

  const provider =
    input.contactName?.trim() ||
    input.provider?.trim() ||
    "Unassigned Invoice";

  // Fallback default: "Provider - Date". Falls back to just the provider
  // when no usable date is present.
  const dateValue = input.date ?? input.invoiceDate ?? input.invoice_date;
  const formattedDate = formatInvoiceDate(dateValue as any);
  if (provider && formattedDate) return `${provider} - ${formattedDate}`;
  return provider || "Unassigned Invoice";
}

export function formatInvoiceFileName(input: InvoiceNameInput) {
  const provider =
    input.contactName?.trim() ||
    input.provider?.trim() ||
    "unassigned-invoice";
  const slug = slugifyContact(provider);

  const dateValue = input.date ?? input.invoiceDate ?? input.invoice_date;
  const date = dateValue instanceof Date ? dateValue : new Date(dateValue ?? "");
  const iso = Number.isNaN(date.getTime()) ? "undated" : date.toISOString().slice(0, 10);
  return `${slug}-${iso}.pdf`;
}

function slugifyContact(value: string) {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-") || "unassigned-invoice";
}
