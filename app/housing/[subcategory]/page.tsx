"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import NavBar from "@/components/NavBar";
import styles from "./subcategory.module.css";

const PAGE_SIZE = 8;

export default function HousingSubcategoryPage() {
  const params = useParams<{ subcategory: string }>();
  const subcategory = params?.subcategory ?? "housing";

  const categories: any[] = useQuery(api.categories.getAllCategories) ?? [];
  const housingCategory = categories.find((row) => row.slug === "housing");
  const bills: any[] = useQuery(
    api.bills.getHousingBills,
    housingCategory ? { categoryId: housingCategory._id, subcategory } : "skip"
  ) ?? [];

  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);

  const filtered: any[] = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return bills;
    return bills.filter((bill) => {
      const extracted = (bill.extractedData ?? {}) as any;
      return [bill.providerName, extracted.invoice_number, extracted.invoice_date, bill.fileName].join(" ").toLowerCase().includes(q);
    });
  }, [bills, search]);

  const totalSpend = useMemo(() => {
    let total = 0;
    for (const bill of filtered) {
      const extractedData = (bill as any)["extractedData"] as unknown;
      total += getInvoiceTotalUsd(extractedData);
    }
    return total;
  }, [filtered]);

  const now = new Date().getFullYear();
  const ytdSpend = useMemo(() => {
    let total = 0;
    for (const bill of filtered) {
      const extractedData = (bill as any)["extractedData"] as any;
      if (String((extractedData?.invoice_date ?? "")).startsWith(String(now))) {
        total += getInvoiceTotalUsd(extractedData);
      }
    }
    return total;
  }, [filtered, now]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const paged = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  return (
    <div className="page-shell">
      <NavBar
        items={[
          { label: "old-oak-horses", href: "/dashboard", brand: true },
          { label: "housing", href: "/housing" },
          { label: subcategory, current: true }
        ]}
        actions={[
          { label: "upload invoices", href: "/upload", variant: "outlined" },
          { label: "biz overview", href: "/reports", variant: "filled" }
        ]}
      />

      <main className="page-main">
        <Link href="/housing" className="ui-back-link">
          ← cd /housing
        </Link>

        <section className={styles.headerCard}>
          <div className="ui-label">HOUSING · {subcategory.toUpperCase()}</div>
          <h1 className={styles.title}>{titleCase(subcategory)}</h1>
        </section>

        <section className={styles.stats}>
          <article className={styles.statCard}>
            <div className={styles.statLabel}>YTD SPEND ({now})</div>
            <div className={styles.amount}>{fmtUSD(ytdSpend)}</div>
            <div className={styles.meta}>{filtered.filter((row) => String(((row.extractedData as any)?.invoice_date ?? "")).startsWith(String(now))).length} invoices this year</div>
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
              <Link key={bill._id} href={`/housing/${subcategory}/${bill._id}`} className={styles.row}>
                <div>
                  <div className={styles.provider}>{bill.providerName}</div>
                  <div className={styles.metaLine}>#{extracted.invoice_number || bill.fileName} · {extracted.invoice_date || "no date"}</div>
                  <div className={styles.people}>
                    {(bill.assignedPeopleResolved ?? []).map((row: any) => (
                      <span key={`${bill._id}-${row.personId}`} className={styles.personPill}>{row.personName}</span>
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

        <div className="ui-footer">OLD_OAK_HORSES // HOUSING // {subcategory.toUpperCase()}</div>
      </main>
    </div>
  );
}

function titleCase(value: string) {
  return value
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
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
