"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import NavBar from "@/components/NavBar";
import styles from "./invoices.module.css";

type StatusFilter = "all" | "pending" | "done";

export default function InvoicesPage() {
  const rows = useQuery(api.bills.listAll) ?? [];
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");

  const categories = useMemo(() => {
    return ["all", ...new Set(rows.map((row) => row.categoryName))];
  }, [rows]);

  const filtered = useMemo(() => {
    return rows.filter((row) => {
      const date = getInvoiceDate(row);
      const categoryPass = categoryFilter === "all" || row.categoryName === categoryFilter;
      const statusPass = statusFilter === "all" || row.status === statusFilter;
      const fromPass = !fromDate || date >= fromDate;
      const toPass = !toDate || date <= toDate;
      return categoryPass && statusPass && fromPass && toPass;
    });
  }, [rows, categoryFilter, statusFilter, fromDate, toDate]);

  return (
    <div className="page-shell">
      <NavBar
        items={[
          { label: "old-oak-horses", href: "/dashboard", brand: true },
          { label: "invoices", current: true },
        ]}
        actions={[
          { label: "upload invoices", href: "/upload", variant: "outlined" },
          { label: "biz overview", href: "/biz-overview", variant: "filled" },
        ]}
      />

      <main className="page-main">
        <Link href="/dashboard" className="ui-back-link">← cd /dashboard</Link>
        <div className={styles.header}>
          <div className="ui-label">// invoices</div>
          <h1 className={styles.title}>invoices</h1>
        </div>

        <section className={styles.filters}>
          <label>
            <span>CATEGORY</span>
            <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
              {categories.map((name) => (
                <option key={name} value={name}>{name === "all" ? "All" : name}</option>
              ))}
            </select>
          </label>
          <label>
            <span>STATUS</span>
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}>
              <option value="all">All</option>
              <option value="pending">Pending</option>
              <option value="done">Approved</option>
            </select>
          </label>
          <label>
            <span>FROM</span>
            <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
          </label>
          <label>
            <span>TO</span>
            <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
          </label>
        </section>

        <section className={styles.listCard}>
          {filtered.map((row) => {
            const date = getInvoiceDate(row);
            const provider = row.providerName ?? row.customProviderName ?? "Unknown";
            const title = `${row.categoryName} - ${provider} - ${date}`;
            const total = getTotal(row);
            return (
              <div key={String(row._id)} className={styles.row}>
                <div className={styles.titleCol}>
                  <div className={styles.titleText}>{title}</div>
                  <div className={styles.subText}>#{getInvoiceNumber(row)}</div>
                </div>
                <span className={`${styles.statusDot} ${row.status === "done" ? styles.statusDone : styles.statusPending}`} />
                <div className={styles.total}>{formatUsd(total)}</div>
              </div>
            );
          })}
          {filtered.length === 0 ? <div className={styles.empty}>No invoices found.</div> : null}
        </section>
      </main>
    </div>
  );
}

function getInvoiceDate(row: any) {
  const raw = row?.extractedData?.invoice_date;
  if (typeof raw === "string" && /^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  return new Date(row.uploadedAt).toISOString().slice(0, 10);
}

function getInvoiceNumber(row: any) {
  return String(row?.extractedData?.invoice_number ?? row.fileName ?? "invoice");
}

function getTotal(row: any) {
  const extracted = row?.extractedData ?? {};
  const value = extracted.invoice_total_usd ?? extracted.total_usd ?? extracted.invoice_total ?? extracted.total ?? row.originalTotal ?? 0;
  return typeof value === "number" ? value : Number(value) || 0;
}

function formatUsd(value: number) {
  return `$${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
