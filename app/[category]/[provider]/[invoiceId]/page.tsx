"use client";

import Link from "next/link";
import { useMemo } from "react";
import { useParams } from "next/navigation";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import styles from "./invoice.module.css";

type LineItem = {
  description?: string;
  horse_name?: string;
  vet_subcategory?: string;
  total_usd?: number;
};

type Extracted = {
  invoice_number?: string;
  invoice_date?: string;
  account_number?: string;
  client_name?: string;
  exchange_rate_used?: number;
  total_fees_usd?: number;
  total_vat_usd?: number;
  invoice_total_usd?: number;
  line_items?: LineItem[];
};

const subcategoryColors: Record<string, { dot: string; bar: string; bg: string; text: string }> = {
  "Travel Cost": { bg: "#F0F4FF", text: "#3B5BDB", dot: "#3B5BDB", bar: "#3B5BDB" },
  "Physical Exam": { bg: "#F0FFF4", text: "#2F855A", dot: "#2F855A", bar: "#2F855A" },
  "Joint Injection": { bg: "#FFF5F5", text: "#C53030", dot: "#C53030", bar: "#C53030" },
  Ultrasound: { bg: "#FFFBF0", text: "#B7791F", dot: "#B7791F", bar: "#B7791F" },
  MRI: { bg: "#FAF0FF", text: "#6B21A8", dot: "#6B21A8", bar: "#6B21A8" },
  Radiograph: { bg: "#FFF0F6", text: "#9D174D", dot: "#9D174D", bar: "#9D174D" },
  Medication: { bg: "#F0FDFF", text: "#0E7490", dot: "#0E7490", bar: "#0E7490" },
  Sedation: { bg: "#FFF7ED", text: "#C2410C", dot: "#C2410C", bar: "#C2410C" },
  Vaccine: { bg: "#F0FFF9", text: "#0D7A5F", dot: "#0D7A5F", bar: "#0D7A5F" },
  Labs: { bg: "#F5F0FF", text: "#5B21B6", dot: "#5B21B6", bar: "#5B21B6" },
  Other: { bg: "#F9FAFB", text: "#6B7280", dot: "#6B7280", bar: "#6B7280" }
};

export default function InvoiceReportPage() {
  const params = useParams<{ category: string; provider: string; invoiceId: string }>();
  const categorySlug = params?.category ?? "";
  const providerSlug = params?.provider ?? "";
  const invoiceId = params?.invoiceId ?? "";

  const provider = useQuery(api.providers.getProviderBySlug, categorySlug && providerSlug ? { categorySlug, providerSlug } : "skip");
  const bill = useQuery(api.bills.getBillById, invoiceId ? { billId: invoiceId as any } : "skip");
  const extracted = ((bill?.extractedData ?? {}) as Extracted) || {};
  const lineItems = Array.isArray(extracted.line_items) ? extracted.line_items : [];

  const horseGroups = useMemo(() => {
    const map = new Map<string, LineItem[]>();
    for (const item of lineItems) {
      const horse = item.horse_name?.trim() || "Unassigned";
      map.set(horse, [...(map.get(horse) ?? []), item]);
    }
    return [...map.entries()].map(([horseName, items]) => ({
      horseName,
      items,
      subtotal: items.reduce((sum, item) => sum + safeAmount(item.total_usd), 0)
    }));
  }, [lineItems]);

  const total = useMemo(() => {
    if (typeof extracted.invoice_total_usd === "number") return extracted.invoice_total_usd;
    return lineItems.reduce((sum, item) => sum + safeAmount(item.total_usd), 0);
  }, [extracted.invoice_total_usd, lineItems]);

  const subcategoryRows = useMemo(() => {
    const map = new Map<string, number>();
    for (const item of lineItems) {
      const key = item.vet_subcategory?.trim() || "Other";
      map.set(key, (map.get(key) ?? 0) + safeAmount(item.total_usd));
    }
    return [...map.entries()]
      .map(([name, amount]) => ({ name, amount, pct: total > 0 ? (amount / total) * 100 : 0 }))
      .sort((a, b) => b.amount - a.amount);
  }, [lineItems, total]);

  const fees = typeof extracted.total_fees_usd === "number" ? extracted.total_fees_usd : total;
  const vat = typeof extracted.total_vat_usd === "number" ? extracted.total_vat_usd : 0;
  const providerName = provider?.fullName || provider?.name || providerSlug;
  const categoryName = provider?.category?.name || categorySlug;

  return (
    <div className={styles.page}>
      <nav className={styles.nav}>
        <div className={styles.crumbs}>
          <Link href="/dashboard" className={styles.brand}>
            Old Oak Horses
          </Link>
          <span className={styles.divider}>/</span>
          <Link href={`/${categorySlug}`} className={styles.muted}>
            {categoryName}
          </Link>
          <span className={styles.divider}>/</span>
          <Link href={`/${categorySlug}/${providerSlug}`} className={styles.muted}>
            {provider?.name || providerSlug}
          </Link>
          <span className={styles.divider}>/</span>
          <span className={styles.current}>{extracted.invoice_number || "Invoice"}</span>
        </div>
        <Link href="/reports" className={styles.bizBtn}>
          Biz Overview
        </Link>
      </nav>

      <main className={styles.main}>
        <div className={styles.topRow}>
          <Link href={`/${categorySlug}/${providerSlug}`} className={styles.backLink}>
            ← Back to {provider?.name || "Provider"}
          </Link>
          <div className={styles.topActions}>
            {bill?.originalPdfUrl ? (
              <a href={bill.originalPdfUrl} target="_blank" rel="noreferrer" className={styles.pdfLink}>
                View Original PDF
              </a>
            ) : null}
            <Link href="/upload" className={styles.uploadBtn}>
              Upload Another
            </Link>
          </div>
        </div>

        <section className={styles.card}>
          <div className={styles.headerGrid}>
            <div>
              <div className={styles.label}>{categoryName.toUpperCase()} INVOICE</div>
              <h1 className={styles.providerTitle}>{providerName}</h1>
              <div className={styles.detailRow}>
                <Detail label="Invoice #" value={extracted.invoice_number || "—"} />
                <Detail label="Date" value={formatDate(extracted.invoice_date)} />
                <Detail label="Account" value={extracted.account_number || provider?.accountNumber || "—"} />
                <Detail label="Client" value={extracted.client_name || "—"} />
              </div>
              {typeof extracted.exchange_rate_used === "number" ? (
                <div className={styles.rateNote}>Rate: 1 GBP = {extracted.exchange_rate_used.toFixed(2)} USD</div>
              ) : null}
            </div>
            <div className={styles.totalBox}>
              <div className={styles.label}>INVOICE TOTAL</div>
              <div className={styles.totalAmount}>{fmtUSD(total)}</div>
              <div className={styles.meta}>Fees: {fmtUSD(fees)} · VAT: {fmtUSD(vat)}</div>
            </div>
          </div>
        </section>

        <section className={styles.card}>
          <div className={styles.reportLabel}>REPORT</div>
          <h2 className={styles.sectionTitle}>Spend by Subcategory</h2>
          {subcategoryRows.map((row) => {
            const color = subcategoryColors[row.name] ?? subcategoryColors.Other;
            return (
              <div key={row.name} className={styles.subRow}>
                <div className={styles.subTop}>
                  <div className={styles.subName}>
                    <span className={styles.dot} style={{ background: color.dot }} />
                    {row.name}
                  </div>
                  <div className={styles.subMeta}>
                    {fmtUSD(row.amount)} · {row.pct.toFixed(1)}%
                  </div>
                </div>
                <div className={styles.track}>
                  <div className={styles.fill} style={{ width: `${Math.min(100, row.pct)}%`, background: color.bar }} />
                </div>
              </div>
            );
          })}
        </section>

        {horseGroups.map((group) => (
          <section key={group.horseName} className={styles.card}>
            <div className={styles.horseHead}>
              <div className={styles.horseLeft}>
                <div className={styles.horseAvatar}>🐴</div>
                <div>
                  <div className={styles.horseName}>{group.horseName}</div>
                  <div className={styles.horseMeta}>
                    {group.items.length} items
                    {horseGroups.length > 1 ? ` · ${((group.subtotal / total) * 100).toFixed(1)}% of invoice` : ""}
                  </div>
                </div>
              </div>
              <div className={styles.subtotal}>
                <div className={styles.label}>SUBTOTAL</div>
                <div className={styles.subtotalAmount}>{fmtUSD(group.subtotal)}</div>
              </div>
            </div>
            <div className={styles.itemList}>
              {group.items.map((item, idx) => {
                const sub = item.vet_subcategory?.trim() || "Other";
                const color = subcategoryColors[sub] ?? subcategoryColors.Other;
                return (
                  <div key={`${group.horseName}-${idx}`} className={styles.itemRow}>
                    <div>
                      <div className={styles.itemDesc}>{item.description || "—"}</div>
                      <span className={styles.badge} style={{ background: color.bg, color: color.text }}>
                        {sub}
                      </span>
                    </div>
                    <div className={styles.itemAmount}>{fmtUSD(safeAmount(item.total_usd))}</div>
                  </div>
                );
              })}
            </div>
          </section>
        ))}

        <section className={styles.summaryBar}>
          <div className={styles.summaryLeft}>
            <SummaryItem label="FEES" value={fmtUSD(fees)} />
            <SummaryItem label="VAT" value={fmtUSD(vat)} />
            <SummaryItem label="HORSES" value={String(horseGroups.length)} />
            <SummaryItem label="LINE ITEMS" value={String(lineItems.length)} />
          </div>
          <div>
            <div className={styles.summaryLabel}>TOTAL DUE</div>
            <div className={styles.summaryTotal}>{fmtUSD(total)}</div>
          </div>
        </section>

        <footer className={styles.footer}>
          OLD OAK HORSES · {categoryName.toUpperCase()} · {(provider?.name || providerSlug).toUpperCase()}
        </footer>
      </main>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className={styles.detailLabel}>{label}</div>
      <div className={styles.detailValue}>{value}</div>
    </div>
  );
}

function SummaryItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className={styles.summaryLabel}>{label}</div>
      <div className={styles.summaryValue}>{value}</div>
    </div>
  );
}

function safeAmount(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function fmtUSD(v: number) {
  return `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatDate(value?: string) {
  if (!value) return "—";
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}
