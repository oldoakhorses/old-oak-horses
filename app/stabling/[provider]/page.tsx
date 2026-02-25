"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import NavBar from "@/components/NavBar";
import styles from "./provider.module.css";

const PAGE_SIZE = 8;

export default function StablingProviderPage() {
  const params = useParams<{ provider: string }>();
  const providerSlug = params?.provider ?? "";

  const provider = useQuery(api.providers.getProviderBySlug, {
    categorySlug: "stabling",
    providerSlug
  });
  const bills: any[] = useQuery(
    api.bills.getStablingBills,
    provider ? { categoryId: provider.category._id, providerId: provider._id } : "skip"
  ) ?? [];

  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return bills;
    return bills.filter((bill) => {
      const extracted = (bill.extractedData ?? {}) as any;
      return [extracted.invoice_number, extracted.invoice_date, bill.fileName].join(" ").toLowerCase().includes(q);
    });
  }, [bills, search]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const paged = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  const totalSpend = useMemo(() => filtered.reduce((sum, row) => sum + getInvoiceTotalUsd(row.extractedData), 0), [filtered]);
  const currentYear = new Date().getFullYear();
  const ytdInvoices = useMemo(
    () => filtered.filter((row) => String(((row.extractedData as any)?.invoice_date ?? "")).startsWith(String(currentYear))),
    [filtered, currentYear]
  );
  const ytdSpend = useMemo(() => ytdInvoices.reduce((sum, row) => sum + getInvoiceTotalUsd(row.extractedData), 0), [ytdInvoices]);

  if (provider === undefined) {
    return (
      <div className="page-shell">
        <main className="page-main">
          <section className="ui-card">Loading provider...</section>
        </main>
      </div>
    );
  }

  if (!provider) {
    return (
      <div className="page-shell">
        <main className="page-main">
          <section className="ui-card">Provider not found.</section>
        </main>
      </div>
    );
  }

  return (
    <div className="page-shell">
      <NavBar
        items={[
          { label: "old-oak-horses", href: "/dashboard", brand: true },
          { label: "stabling", href: "/stabling" },
          { label: provider.slug ?? providerSlug, current: true }
        ]}
        actions={[
          { label: "upload invoices", href: "/upload", variant: "outlined" },
          { label: "biz overview", href: "/biz-overview", variant: "filled" }
        ]}
      />

      <main className="page-main">
        <Link href="/stabling" className="ui-back-link">
          ← cd /stabling
        </Link>

        <section className={styles.headerCard}>
          <div className="ui-label">STABLING PROVIDER</div>
          <h1 className={styles.title}>{provider.fullName || provider.name}</h1>
          <div className={styles.details}>
            <Detail label="PRIMARY CONTACT" value={provider.primaryContactName || "—"} extra={provider.primaryContactPhone} />
            <Detail label="ADDRESS" value={provider.address || "—"} />
            <Detail label="PHONE" value={provider.phone || "—"} isLink={provider.phone ? `tel:${provider.phone}` : undefined} />
            <Detail label="EMAIL" value={provider.email || "—"} isLink={provider.email ? `mailto:${provider.email}` : undefined} />
            <Detail label="ACCOUNT #" value={provider.accountNumber || "—"} />
          </div>
        </section>

        <section className={styles.stats}>
          <article className={styles.statCard}>
            <div className={styles.statLabel}>YTD SPEND ({currentYear})</div>
            <div className={styles.amount}>{fmtUSD(ytdSpend)}</div>
            <div className={styles.meta}>{ytdInvoices.length} invoices this year</div>
          </article>
          <article className={styles.statCard}>
            <div className={styles.statLabel}>TOTAL SPEND</div>
            <div className={styles.amount}>{fmtUSD(totalSpend)}</div>
            <div className={styles.meta}>{filtered.length} invoices total</div>
          </article>
        </section>

        <section className={styles.listCard}>
          <div className={styles.listHead}>
            <h2 className={styles.head}>invoices</h2>
            <input
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(1);
              }}
              className={styles.search}
              placeholder="search invoices..."
            />
          </div>

          {paged.map((bill) => {
            const extracted = (bill.extractedData ?? {}) as any;
            return (
              <Link key={bill._id} href={`/stabling/${provider.slug ?? providerSlug}/${bill._id}`} className={styles.row}>
                <div>
                  <div className={styles.provider}>{extracted.invoice_number || bill.fileName}</div>
                  <div className={styles.metaLine}>{extracted.invoice_date || "no date"}</div>
                  <div className={styles.people}>
                    {(bill.horses ?? []).map((row: any) => (
                      <span key={`${bill._id}-${row.horseName}`} className={styles.personPill}>{row.horseName}</span>
                    ))}
                  </div>
                </div>
                <div className={styles.right}>
                  <span className={bill.approvalStatus === "approved" ? styles.dotGreen : styles.dotAmber} />
                  <span className={styles.rowAmount}>{fmtUSD(getInvoiceTotalUsd(bill.extractedData))}</span>
                </div>
              </Link>
            );
          })}

          {totalPages > 1 ? (
            <div className={styles.pagination}>
              <button type="button" className="ui-button-outlined" onClick={() => setPage((p) => Math.max(1, p - 1))}>prev</button>
              <span className={styles.pageText}>{safePage} / {totalPages}</span>
              <button type="button" className="ui-button-outlined" onClick={() => setPage((p) => Math.min(totalPages, p + 1))}>next</button>
            </div>
          ) : null}
        </section>

        <div className="ui-footer">OLD_OAK_HORSES // STABLING // {(provider.slug ?? providerSlug).toUpperCase()}</div>
      </main>
    </div>
  );
}

function Detail({ label, value, extra, isLink }: { label: string; value: string; extra?: string; isLink?: string }) {
  return (
    <div>
      <div className={styles.detailLabel}>{label}</div>
      {isLink ? (
        <a href={isLink} className={styles.detailLink}>{value}</a>
      ) : (
        <div className={styles.detailValue}>{value}</div>
      )}
      {extra ? <div className={styles.extra}>{extra}</div> : null}
    </div>
  );
}

function getInvoiceTotalUsd(extractedData: unknown): number {
  if (!extractedData || typeof extractedData !== "object") return 0;
  const extracted = extractedData as { invoice_total_usd?: unknown; line_items?: unknown };
  if (typeof extracted.invoice_total_usd === "number") return extracted.invoice_total_usd as number;
  if (!Array.isArray(extracted.line_items)) return 0;
  const rows = extracted.line_items as Array<{ total_usd?: unknown }>;
  return rows.reduce((sum, row) => sum + (typeof row?.total_usd === "number" ? row.total_usd : 0), 0);
}

function fmtUSD(v: number) {
  return `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
