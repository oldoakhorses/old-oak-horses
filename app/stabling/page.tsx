"use client";

import Link from "next/link";
import { useMemo } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import NavBar from "@/components/NavBar";
import SpendBar from "@/components/SpendBar";
import styles from "./stabling.module.css";

const SUBCATEGORY_ORDER = ["board", "turnout", "bedding", "hay-feed", "facility-fees", "other"] as const;

export default function StablingOverviewPage() {
  const categories = useQuery(api.categories.getAllCategories) ?? [];
  const stablingCategory = categories.find((row) => row.slug === "stabling");

  const spendByProvider = useQuery(
    api.bills.getStablingSpendByProvider,
    stablingCategory ? { categoryId: stablingCategory._id } : "skip"
  ) ?? [];
  const spendBySubcategory = useQuery(
    api.bills.getStablingSpendBySubcategory,
    stablingCategory ? { categoryId: stablingCategory._id } : "skip"
  ) ?? [];
  const spendByHorse = useQuery(
    api.bills.getStablingSpendByHorse,
    stablingCategory ? { categoryId: stablingCategory._id } : "skip"
  ) ?? [];
  const bills = useQuery(api.bills.getStablingBills, stablingCategory ? { categoryId: stablingCategory._id } : "skip") ?? [];

  const orderedSubcategory = useMemo(() => {
    const rank = new Map<string, number>(SUBCATEGORY_ORDER.map((name, idx) => [name, idx]));
    return [...spendBySubcategory].sort((a, b) => {
      const ra = rank.get(a.subcategory) ?? 99;
      const rb = rank.get(b.subcategory) ?? 99;
      if (ra !== rb) return ra - rb;
      return b.totalSpend - a.totalSpend;
    });
  }, [spendBySubcategory]);

  const totalSpend = useMemo(() => spendByProvider.reduce((sum, row) => sum + row.totalSpend, 0), [spendByProvider]);

  if (!stablingCategory) {
    return (
      <div className="page-shell">
        <main className="page-main">
          <section className="ui-card">Stabling category not found. Run category seed first.</section>
        </main>
      </div>
    );
  }

  return (
    <div className="page-shell">
      <NavBar
        items={[
          { label: "old-oak-horses", href: "/dashboard", brand: true },
          { label: "stabling", current: true }
        ]}
        actions={[
          { label: "upload invoices", href: "/upload", variant: "outlined" },
          { label: "biz overview", href: "/reports", variant: "filled" }
        ]}
      />

      <main className="page-main">
        <Link href="/dashboard" className="ui-back-link">
          ← cd /dashboard
        </Link>

        <section className={styles.summaryCard}>
          <div className="ui-label">// category</div>
          <h1 className={styles.title}>stabling</h1>
          <div className={styles.total}>{fmtUSD(totalSpend)}</div>
          <div className={styles.meta}>{bills.length} invoices</div>
        </section>

        <section className={styles.twoCol}>
          <article className={styles.card}>
            <h2 className={styles.head}>spend_by_provider</h2>
            <div className={styles.list}>
              {spendByProvider.map((row) => (
                <Link key={row.providerId} href={`/stabling/${slugify(row.providerName)}`} className={styles.linkRow}>
                  <SpendBar label={row.providerName} amount={fmtUSD(row.totalSpend)} percentage={row.pctOfTotal} />
                </Link>
              ))}
            </div>
          </article>

          <article className={styles.card}>
            <h2 className={styles.head}>spend_by_subcategory</h2>
            <div className={styles.list}>
              {orderedSubcategory.map((row) => (
                <SpendBar
                  key={row.subcategory}
                  label={titleCase(row.subcategory)}
                  amount={fmtUSD(row.totalSpend)}
                  percentage={row.pctOfTotal}
                />
              ))}
            </div>
          </article>
        </section>

        <section className={styles.card}>
          <h2 className={styles.head}>spend_by_horse</h2>
          <div className={styles.list}>
            {spendByHorse.map((row) => (
              <SpendBar
                key={row.horseName}
                label={row.horseName}
                amount={fmtUSD(row.totalSpend)}
                percentage={row.pctOfTotal}
              />
            ))}
          </div>
        </section>

        <section className={styles.card}>
          <h2 className={styles.head}>all_invoices</h2>
          <div className={styles.invoiceList}>
            {bills.map((bill) => (
              <Link key={bill._id} href={`/stabling/${slugify(bill.providerName)}/${bill._id}`} className={styles.invoiceRow}>
                <div>
                  <div className={styles.invoiceTop}>
                    <span className={styles.provider}>{(bill.extractedData as any)?.invoice_number || bill.fileName}</span>
                    <span className={styles.tag}>{bill.providerName}</span>
                  </div>
                  <div className={styles.invoiceMeta}>{(bill.extractedData as any)?.invoice_date || "no date"}</div>
                  <div className={styles.persons}>
                    {(bill.horses ?? []).map((row: any) => (
                      <span key={`${bill._id}-${row.horseName}`} className={styles.personPill}>{row.horseName}</span>
                    ))}
                  </div>
                </div>
                <div className={styles.right}>
                  <div className={bill.approvalStatus === "approved" ? styles.dotGreen : styles.dotAmber} />
                  <div className={styles.amount}>{fmtUSD(getInvoiceTotalUsd(bill.extractedData))}</div>
                </div>
              </Link>
            ))}
          </div>
        </section>

        <div className="ui-footer">OLD_OAK_HORSES // STABLING</div>
      </main>
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

function titleCase(value: string) {
  return value
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)+/g, "");
}
