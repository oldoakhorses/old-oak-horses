"use client";

import Link from "next/link";
import { useMemo } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import NavBar from "@/components/NavBar";
import SpendBar from "@/components/SpendBar";
import styles from "./travel.module.css";

const SUBCATEGORY_ORDER = ["flights", "trains", "rental-car", "gas", "meals", "hotels"] as const;

export default function TravelOverviewPage() {
  const categories = useQuery(api.categories.getAllCategories) ?? [];
  const travelCategory = categories.find((row) => row.slug === "travel");

  const spendBySubcategory = useQuery(api.bills.getTravelSpendBySubcategory, travelCategory ? { categoryId: travelCategory._id } : "skip") ?? [];
  const spendByPerson = useQuery(api.bills.getTravelSpendByPerson, travelCategory ? { categoryId: travelCategory._id } : "skip") ?? [];
  const bills = useQuery(api.bills.getTravelBills, travelCategory ? { categoryId: travelCategory._id } : "skip") ?? [];

  const orderedSubcategory = useMemo(() => {
    const rank = new Map<string, number>(SUBCATEGORY_ORDER.map((name, idx) => [name, idx]));
    return [...spendBySubcategory].sort((a, b) => {
      const ra = rank.get(a.subcategory) ?? 99;
      const rb = rank.get(b.subcategory) ?? 99;
      if (ra !== rb) return ra - rb;
      return b.totalSpend - a.totalSpend;
    });
  }, [spendBySubcategory]);

  const total = useMemo(() => spendBySubcategory.reduce((sum, row) => sum + row.totalSpend, 0), [spendBySubcategory]);

  if (!travelCategory) {
    return (
      <div className="page-shell">
        <main className="page-main">
          <section className="ui-card">Travel category not found. Run category seed first.</section>
        </main>
      </div>
    );
  }

  return (
    <div className="page-shell">
      <NavBar
        items={[
          { label: "old-oak-horses", href: "/dashboard", brand: true },
          { label: "travel", current: true }
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
          <h1 className={styles.title}>travel</h1>
          <div className={styles.total}>{fmtUSD(total)}</div>
          <div className={styles.meta}>{bills.length} invoices</div>
        </section>

        <section className={styles.twoCol}>
          <article className={styles.card}>
            <h2 className={styles.head}>spend_by_subcategory</h2>
            <div className={styles.list}>
              {orderedSubcategory.map((row) => (
                <Link key={row.subcategory} href={`/travel/${row.subcategory}`} className={styles.linkRow}>
                  <SpendBar label={titleCase(row.subcategory)} amount={fmtUSD(row.totalSpend)} percentage={row.pctOfTotal} />
                </Link>
              ))}
            </div>
          </article>

          <article className={styles.card}>
            <h2 className={styles.head}>spend_by_person</h2>
            <div className={styles.list}>
              {spendByPerson.map((row) => (
                <SpendBar
                  key={String(row.personId)}
                  label={`${row.personName} (${row.role})`}
                  amount={fmtUSD(row.totalSpend)}
                  percentage={row.pctOfTotal}
                />
              ))}
            </div>
          </article>
        </section>

        <section className={styles.card}>
          <h2 className={styles.head}>all_invoices</h2>
          <div className={styles.invoiceList}>
            {bills.map((bill) => (
              <Link key={bill._id} href={`/travel/${bill.travelSubcategory || "travel"}/${bill._id}`} className={styles.invoiceRow}>
                <div>
                  <div className={styles.invoiceTop}>
                    <span className={styles.provider}>{bill.providerName}</span>
                    <span className={styles.tag}>{titleCase(bill.travelSubcategory || "travel")}</span>
                  </div>
                  <div className={styles.invoiceMeta}>{(bill.extractedData as any)?.invoice_number || bill.fileName}</div>
                  <div className={styles.persons}>
                    {(bill.assignedPeopleResolved ?? []).map((row: any) => (
                      <span key={`${bill._id}-${row.personId}`} className={styles.personPill}>{row.personName}</span>
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

        <div className="ui-footer">OLD_OAK_HORSES // TRAVEL</div>
      </main>
    </div>
  );
}

function getInvoiceTotalUsd(extractedData: unknown): number {
  if (!extractedData || typeof extractedData !== "object") return 0;
  const extracted = extractedData as { invoice_total_usd?: unknown; line_items?: unknown[] };
  if (typeof extracted.invoice_total_usd === "number") return extracted.invoice_total_usd as number;
  if (!Array.isArray(extracted.line_items)) return 0;
  const rows = extracted.line_items as any[];
  return rows.reduce((sum: number, item: any) => sum + (typeof item?.total_usd === "number" ? (item.total_usd as number) : 0), 0);
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
