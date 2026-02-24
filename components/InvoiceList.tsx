"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import styles from "./InvoiceList.module.css";

const ITEMS_PER_PAGE = 5;

export type InvoiceListItem = {
  id: string;
  href: string;
  invoiceNumber: string;
  invoiceDate: string | null;
  providerName?: string;
  providerSlug?: string;
  horses: string[];
  lineItemCount: number;
  fileName?: string;
  amountUsd: number;
};

export default function InvoiceList({
  title,
  items,
  showProviderTag = false,
  searchPlaceholder = "search invoices...",
}: {
  title: string;
  items: InvoiceListItem[];
  showProviderTag?: boolean;
  searchPlaceholder?: string;
}) {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return items;

    return items.filter((item) => {
      const haystack = [
        item.invoiceNumber,
        item.invoiceDate ?? "",
        item.providerName ?? "",
        item.fileName ?? "",
        ...item.horses,
      ]
        .join(" ")
        .toLowerCase();

      return haystack.includes(query);
    });
  }, [items, search]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / ITEMS_PER_PAGE));
  const safePage = Math.min(page, totalPages);
  const startIndex = (safePage - 1) * ITEMS_PER_PAGE;
  const endIndex = Math.min(filtered.length, startIndex + ITEMS_PER_PAGE);
  const paged = filtered.slice(startIndex, endIndex);

  return (
    <section className={styles.card}>
      <div className={styles.header}>
        <h3 className={styles.title}>{title}</h3>
        <div className={styles.searchWrap}>
          <span className={styles.searchIcon}>⌕</span>
          <input
            className={styles.search}
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(1);
            }}
            placeholder={searchPlaceholder}
          />
        </div>
        <div className={styles.count}>{filtered.length} results</div>
      </div>

      {paged.length === 0 ? (
        <div className={styles.empty}>no matches for '{search}'</div>
      ) : (
        paged.map((item) => (
          <Link className={styles.row} key={item.id} href={item.href}>
            <div className={styles.left}>
              <div className={styles.line1}>
                <span className={styles.invoice}>{item.invoiceNumber}</span>
                {showProviderTag && item.providerName ? (
                  <span className={styles.providerTag}>{item.providerName}</span>
                ) : null}
              </div>
              <div className={styles.line2}>
                <span>{formatDate(item.invoiceDate)}</span>
                {item.horses.slice(0, 3).map((horse) => (
                  <span className={styles.horseTag} key={`${item.id}-${horse}`}>
                    {horse}
                  </span>
                ))}
                <span>{item.lineItemCount} items</span>
              </div>
            </div>
            <div className={styles.right}>
              <span className={styles.amount}>{fmtUSD(item.amountUsd)}</span>
              <span className={styles.arrow}>→</span>
            </div>
          </Link>
        ))
      )}

      {totalPages > 1 ? (
        <div className={styles.pagination}>
          <span className={styles.pageMeta}>
            {startIndex + 1}–{endIndex} of {filtered.length}
          </span>
          <div className={styles.pageControls}>
            <button type="button" className={styles.pageBtn} onClick={() => setPage((p) => Math.max(1, p - 1))}>
              ‹
            </button>
            {Array.from({ length: totalPages }, (_, i) => i + 1).map((n) => (
              <button
                key={n}
                type="button"
                className={n === safePage ? styles.pageBtnActive : styles.pageBtn}
                onClick={() => setPage(n)}
              >
                {n}
              </button>
            ))}
            <button type="button" className={styles.pageBtn} onClick={() => setPage((p) => Math.min(totalPages, p + 1))}>
              ›
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function formatDate(value: string | null) {
  if (!value) return "no date";
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function fmtUSD(v: number) {
  return `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
