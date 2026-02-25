"use client";

import Link from "next/link";
import { useMemo } from "react";
import { useParams } from "next/navigation";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import NavBar from "@/components/NavBar";
import SpendBar from "@/components/SpendBar";
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

const subcategoryColors: Record<string, string> = {
  "Joint Injection": "#22C583",
  "Physical Exam": "#4A5BDB",
  Radiograph: "#A78BFA",
  Vaccine: "#F59E0B",
  "Dental Work": "#EF4444",
  Bloodwork: "#FBBF24",
  Lameness: "#14B8A6",
  Ultrasound: "#EC4899",
  Chiropractic: "#818CF8",
  Surgery: "#F87171",
  Medication: "#34D399",
  Sedation: "#2DD4BF",
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
      subtotal: items.reduce((sum, item) => sum + safeAmount(item.total_usd), 0),
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

  return (
    <div className="page-shell">
      <NavBar
        items={[
          { label: "old-oak-horses", href: "/dashboard", brand: true },
          { label: categorySlug, href: `/${categorySlug}` },
          { label: providerSlug, href: `/${categorySlug}/${providerSlug}` },
          { label: extracted.invoice_number || "invoice", current: true },
        ]}
        actions={[{ label: "biz overview", href: "/biz-overview", variant: "filled" }]}
      />

      <main className="page-main">
        <div className={styles.topRow}>
          <Link href={`/${categorySlug}/${providerSlug}`} className="ui-back-link">
            ← cd /{providerSlug}
          </Link>
          <div className={styles.topActions}>
            {bill?.originalPdfUrl ? (
              <a href={bill.originalPdfUrl} target="_blank" rel="noreferrer" className={styles.pdfLink}>
                view original PDF
              </a>
            ) : null}
            <Link href="/upload" className="ui-button-filled">
              upload another
            </Link>
          </div>
        </div>

        <section className={styles.headerCard}>
          <div>
            <div className="ui-label">// {categorySlug} invoice</div>
            <h1 className={styles.providerName}>{provider?.fullName || provider?.name || providerSlug}</h1>
            <div className={styles.detailRow}>
              <Detail label="INVOICE #" value={extracted.invoice_number || "—"} />
              <Detail label="DATE" value={formatDate(extracted.invoice_date)} />
              <Detail label="ACCOUNT" value={extracted.account_number || provider?.accountNumber || "—"} />
              <Detail label="CLIENT" value={extracted.client_name || "—"} />
            </div>
            {typeof extracted.exchange_rate_used === "number" ? (
              <div className={styles.rate}>rate: 1 GBP = {extracted.exchange_rate_used.toFixed(2)} USD</div>
            ) : null}
          </div>

          <div className={styles.totalBox}>
            <div className="ui-label">INVOICE TOTAL</div>
            <div className={styles.total}>{fmtUSD(total)}</div>
            <div className={styles.totalMeta}>fees: {fmtUSD(fees)} · vat: {fmtUSD(vat)}</div>
          </div>
        </section>

        <section className={styles.card}>
          <div className="ui-label">// report</div>
          <h2 className={styles.sectionTitle}>spend_by_subcategory</h2>
          <div className={styles.list}>
            {subcategoryRows.map((row) => (
              <SpendBar
                key={row.name}
                label={row.name}
                amount={fmtUSD(row.amount)}
                percentage={row.pct}
                color={subcategoryColors[row.name] ?? "#4A5BDB"}
              />
            ))}
          </div>
        </section>

        {horseGroups.map((group) => (
          <section key={group.horseName} className={styles.card}>
            <div className={styles.horseHead}>
              <div className={styles.horseLeft}>
                <div className={styles.horseAvatar}>🐴</div>
                <div>
                  <div className={styles.horseName}>{group.horseName}</div>
                  <div className={styles.horseMeta}>
                    {group.items.length} line items{horseGroups.length > 1 ? ` · ${((group.subtotal / total) * 100).toFixed(1)}% of invoice` : ""}
                  </div>
                </div>
              </div>
              <div>
                <div className="ui-label">SUBTOTAL</div>
                <div className={styles.subtotal}>{fmtUSD(group.subtotal)}</div>
              </div>
            </div>

            <div className={styles.itemList}>
              {group.items.map((item, idx) => (
                <div key={`${group.horseName}-${idx}`} className={styles.itemRow}>
                  <div>
                    <div className={styles.itemDesc}>{item.description || "—"}</div>
                    <span className={styles.badge} style={{ background: subcategoryColors[item.vet_subcategory || ""] ?? "#6B7084" }}>
                      {item.vet_subcategory || "Other"}
                    </span>
                  </div>
                  <div className={styles.itemAmount}>{fmtUSD(safeAmount(item.total_usd))}</div>
                </div>
              ))}
            </div>
          </section>
        ))}

        <section className={styles.summaryBar}>
          <div className={styles.summaryLeft}>
            <Summary label="FEES" value={fmtUSD(fees)} />
            <Summary label="VAT" value={fmtUSD(vat)} />
            <Summary label="HORSES" value={String(horseGroups.length)} />
            <Summary label="LINE ITEMS" value={String(lineItems.length)} />
          </div>
          <div>
            <div className={styles.summaryLabel}>TOTAL DUE</div>
            <div className={styles.summaryTotal}>{fmtUSD(total)}</div>
          </div>
        </section>

        <div className="ui-footer">OLD_OAK_HORSES // {categorySlug.toUpperCase()} // {providerSlug.toUpperCase()}</div>
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

function Summary({ label, value }: { label: string; value: string }) {
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
