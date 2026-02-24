"use client";

import Link from "next/link";
import { useMemo, type ReactNode } from "react";
import { useParams } from "next/navigation";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import styles from "./provider.module.css";

type ParsedLineItem = {
  horse_name?: string;
  total_usd?: number;
};

type ParsedInvoice = {
  invoice_number?: string;
  invoice_date?: string;
  invoice_total_usd?: number;
  line_items?: ParsedLineItem[];
};

export default function ProviderPage() {
  const params = useParams<{ category: string; provider: string }>();
  const categorySlug = params?.category ?? "";
  const providerSlug = params?.provider ?? "";

  const provider = useQuery(api.providers.getProviderBySlug, categorySlug && providerSlug ? { categorySlug, providerSlug } : "skip");
  const bills = useQuery(api.bills.getBillsByProvider, provider ? { providerId: provider._id } : "skip") ?? [];
  const stats = useQuery(api.bills.getProviderStats, provider ? { providerId: provider._id } : "skip");

  const year = new Date().getFullYear();

  const invoiceRows = useMemo(() => {
    return bills.map((bill) => {
      const extracted = (bill.extractedData ?? {}) as ParsedInvoice;
      const lineItems = Array.isArray(extracted.line_items) ? extracted.line_items : [];
      const horses = [...new Set(lineItems.map((item) => item.horse_name?.trim()).filter((value): value is string => Boolean(value)))];
      const total =
        typeof extracted.invoice_total_usd === "number"
          ? extracted.invoice_total_usd
          : lineItems.reduce((sum, item) => sum + (typeof item.total_usd === "number" ? item.total_usd : 0), 0);

      const invoiceDate = extracted.invoice_date ?? new Date(bill.uploadedAt).toISOString().slice(0, 10);
      return {
        id: bill._id,
        invoiceNumber: extracted.invoice_number ?? "Unknown invoice",
        invoiceDate,
        horses,
        lineItemCount: lineItems.length,
        total
      };
    });
  }, [bills]);

  const sortedInvoices = useMemo(() => {
    return [...invoiceRows].sort((a, b) => Date.parse(b.invoiceDate) - Date.parse(a.invoiceDate));
  }, [invoiceRows]);

  if (provider === null) {
    return (
      <main className={styles.page}>
        <div className={styles.main}>Provider not found.</div>
      </main>
    );
  }

  const categoryLabel = provider?.category?.name ?? categorySlug;
  const providerLabel = provider?.name ?? providerSlug;

  return (
    <div className={styles.page}>
      <nav className={styles.nav}>
        <div className={styles.crumbs}>
          <Link href="/dashboard" className={styles.brand}>
            Old Oak Horses
          </Link>
          <span className={styles.divider}>/</span>
          <Link href={`/${categorySlug}`} className={styles.muted}>
            {categoryLabel}
          </Link>
          <span className={styles.divider}>/</span>
          <span className={styles.current}>{providerLabel}</span>
        </div>
        <div className={styles.actions}>
          <Link href="/upload" className={styles.uploadBtn}>
            Upload Invoice
          </Link>
          <Link href="/reports" className={styles.bizBtn}>
            Biz Overview
          </Link>
        </div>
      </nav>

      <main className={styles.main}>
        <Link href={`/${categorySlug}`} className={styles.backLink}>
          ← Back to {categoryLabel}
        </Link>

        <section className={styles.card}>
          <div className={styles.label}>{categoryLabel.toUpperCase()} PROVIDER</div>
          <h1 className={styles.providerName}>{provider?.fullName || providerLabel}</h1>
          <div className={styles.contactGrid}>
            <Info label="Address" value={provider?.address ?? "—"} />
            <Info label="Phone" value={provider?.phone ? <a href={`tel:${provider.phone}`}>{provider.phone}</a> : "—"} />
            <Info label="Email" value={provider?.email ? <a href={`mailto:${provider.email}`}>{provider.email}</a> : "—"} />
            <Info label="Account #" value={provider?.accountNumber ?? "—"} />
          </div>
        </section>

        <section className={styles.statsGrid}>
          <div className={styles.darkCard}>
            <div className={styles.darkLabel}>YTD SPEND ({year})</div>
            <div className={styles.darkAmount}>{fmtUSD(stats?.ytdSpend ?? 0)}</div>
            <div className={styles.darkSub}>{stats?.ytdInvoices ?? 0} invoices this year</div>
          </div>
          <div className={styles.card}>
            <div className={styles.label}>TOTAL SPEND</div>
            <div className={styles.totalAmount}>{fmtUSD(stats?.totalSpend ?? 0)}</div>
            <div className={styles.sub}>{stats?.totalInvoices ?? 0} invoices total</div>
          </div>
        </section>

        <section className={styles.card}>
          <div className={styles.rowHead}>
            <h2 className={styles.invoiceTitle}>Invoices</h2>
            <span className={styles.count}>{sortedInvoices.length} TOTAL</span>
          </div>
          {sortedInvoices.map((invoice) => (
            <Link key={invoice.id} href={`/${categorySlug}/${providerSlug}/${invoice.id}`} className={styles.invoiceRow}>
              <div>
                <div className={styles.invoiceMeta}>
                  {invoice.invoiceNumber} · <span>{formatDate(invoice.invoiceDate)}</span>
                </div>
                <div className={styles.horsePills}>
                  {invoice.horses.map((horse) => (
                    <span key={horse} className={styles.pill}>
                      {horse}
                    </span>
                  ))}
                  <span className={styles.itemCount}>{invoice.lineItemCount} items</span>
                </div>
              </div>
              <div className={styles.invoiceRight}>
                <div className={styles.invoiceAmount}>{fmtUSD(invoice.total)}</div>
                <div className={styles.chevron}>›</div>
              </div>
            </Link>
          ))}
        </section>

        <footer className={styles.footer}>
          OLD OAK HORSES · {categoryLabel.toUpperCase()} · {providerLabel.toUpperCase()}
        </footer>
      </main>
    </div>
  );
}

function Info({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <div className={styles.infoLabel}>{label}</div>
      <div className={styles.infoValue}>{value}</div>
    </div>
  );
}

function formatDate(value: string) {
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function fmtUSD(v: number) {
  return `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
