"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import FilterTabs from "@/components/FilterTabs";
import HorseScrollRow from "@/components/HorseScrollRow";
import InvoiceList, { type InvoiceListItem } from "@/components/InvoiceList";
import NavBar from "@/components/NavBar";
import SpendBar from "@/components/SpendBar";
import styles from "./CategoryOverviewPage.module.css";

type FilterMode = "month" | "ytd" | "year2024" | "all";

type ParsedLineItem = {
  description?: string;
  horse_name?: string;
  vet_subcategory?: string;
  total_usd?: number;
};

type ParsedInvoice = {
  invoice_number?: string;
  invoice_date?: string;
  line_items?: ParsedLineItem[];
  invoice_total_usd?: number;
};

type ParsedBill = {
  bill: {
    _id: string;
    uploadedAt: number;
    fileName: string;
    providerId: string;
    extractedData?: unknown;
  };
  extracted: ParsedInvoice;
  lineItems: ParsedLineItem[];
  invoiceDateMs: number;
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

export default function CategoryOverviewPage({
  categoryId,
  categoryName,
  categorySlug,
}: {
  categoryId: Id<"categories">;
  categoryName: string;
  categorySlug: string;
}) {
  const [filterMode, setFilterMode] = useState<FilterMode>("month");

  const providers: any[] = useQuery(api.providers.getProvidersByCategory, { categoryId }) ?? [];
  const bills: any[] = useQuery(api.bills.getBillsByCategory, { categoryId }) ?? [];

  const providerById = useMemo(() => new Map(providers.map((provider: any) => [provider._id, provider])), [providers]);

  const allParsedBills = useMemo(
    () => bills.map((bill: any) => toParsedBill(bill)).sort((a: ParsedBill, b: ParsedBill) => b.invoiceDateMs - a.invoiceDateMs),
    [bills],
  );

  const filteredBills = useMemo(() => {
    const now = new Date();
    if (filterMode === "all") return allParsedBills;

    if (filterMode === "ytd") {
      const start = new Date(now.getFullYear(), 0, 1).getTime();
      return allParsedBills.filter((row) => row.invoiceDateMs >= start && row.invoiceDateMs <= now.getTime());
    }

    if (filterMode === "year2024") {
      const start = new Date(2024, 0, 1).getTime();
      const end = new Date(2024, 11, 31, 23, 59, 59, 999).getTime();
      return allParsedBills.filter((row) => row.invoiceDateMs >= start && row.invoiceDateMs <= end);
    }

    const start = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999).getTime();
    return allParsedBills.filter((row) => row.invoiceDateMs >= start && row.invoiceDateMs <= end);
  }, [allParsedBills, filterMode]);

  const summary = useMemo(() => {
    const providerTotals = new Map<string, number>();
    const horseTotals = new Map<string, number>();
    const subTotals = new Map<string, number>();
    let totalSpend = 0;
    let lineItems = 0;

    for (const row of filteredBills) {
      const invoiceTotal = getInvoiceTotalUsd(row.extracted, row.lineItems);
      totalSpend += invoiceTotal;
      providerTotals.set(row.bill.providerId, (providerTotals.get(row.bill.providerId) ?? 0) + invoiceTotal);

      for (const item of row.lineItems) {
        lineItems += 1;
        const horse = (item.horse_name ?? "Unassigned").trim() || "Unassigned";
        const sub = (item.vet_subcategory ?? "Other").trim() || "Other";
        const amount = getLineTotalUsd(item);
        horseTotals.set(horse, (horseTotals.get(horse) ?? 0) + amount);
        subTotals.set(sub, (subTotals.get(sub) ?? 0) + amount);
      }
    }

    const spendByProvider = [...providerTotals.entries()]
      .map(([providerId, value]) => ({
        key: providerId,
        name: providerById.get(providerId)?.name ?? "Unknown",
        value,
        percentage: totalSpend > 0 ? (value / totalSpend) * 100 : 0,
        href: `/${categorySlug}/${providerById.get(providerId)?.slug ?? slugify(providerById.get(providerId)?.name ?? "provider")}`,
      }))
      .sort((a, b) => b.value - a.value);

    const spendByHorse = [...horseTotals.entries()]
      .map(([name, value]) => ({ key: name, name, amount: value, percentage: totalSpend > 0 ? (value / totalSpend) * 100 : 0 }))
      .sort((a, b) => b.amount - a.amount);

    const spendBySubcategory = [...subTotals.entries()]
      .map(([name, value]) => ({
        key: name,
        name,
        value,
        percentage: totalSpend > 0 ? (value / totalSpend) * 100 : 0,
        color: subcategoryColors[name] ?? "#4A5BDB",
      }))
      .sort((a, b) => b.value - a.value);

    return {
      totalSpend,
      invoiceCount: filteredBills.length,
      lineItemCount: lineItems,
      uniqueHorseCount: spendByHorse.length,
      activeProviderCount: spendByProvider.length,
      spendByProvider,
      spendByHorse,
      spendBySubcategory,
    };
  }, [categorySlug, filteredBills, providerById]);

  const invoiceList: InvoiceListItem[] = useMemo(() => {
    return allParsedBills.map((row) => {
      const provider = providerById.get(row.bill.providerId);
      const providerSlug = provider?.slug ?? slugify(provider?.name ?? "provider");
      return {
        id: row.bill._id,
        href: `/${categorySlug}/${providerSlug}/${row.bill._id}`,
        invoiceNumber: row.extracted.invoice_number ?? row.bill.fileName,
        invoiceDate: row.extracted.invoice_date ?? null,
        providerName: provider?.name ?? "Unknown",
        providerSlug,
        horses: [...new Set(row.lineItems.map((item) => item.horse_name ?? "Unassigned"))],
        lineItemCount: row.lineItems.length,
        fileName: row.bill.fileName,
        amountUsd: getInvoiceTotalUsd(row.extracted, row.lineItems),
      };
    });
  }, [allParsedBills, categorySlug, providerById]);

  const providerCards = useMemo(() => {
    return providers.map((provider: any) => {
      const providerBills = filteredBills.filter((row) => row.bill.providerId === provider._id);
      const totalSpend = providerBills.reduce((sum: number, row: ParsedBill) => sum + getInvoiceTotalUsd(row.extracted, row.lineItems), 0);
      const horses = [...new Set(providerBills.flatMap((row) => row.lineItems.map((item) => item.horse_name ?? "Unassigned")))];
      const recent = providerBills.length > 0 ? providerBills[0].extracted.invoice_date : null;
      return {
        provider,
        invoiceCount: providerBills.length,
        totalSpend,
        horses,
        recent,
      };
    });
  }, [filteredBills, providers]);

  return (
    <div className="page-shell">
      <NavBar
        items={[
          { label: "old-oak-horses", href: "/dashboard", brand: true },
          { label: categorySlug, current: true },
        ]}
        actions={[
          { label: "upload invoices", href: "/upload", variant: "outlined" },
          { label: "biz overview", href: "/biz-overview", variant: "filled" },
        ]}
      />

      <main className="page-main">
        <Link href="/dashboard" className="ui-back-link">
          ← cd /dashboard
        </Link>

        <section className={styles.headerRow}>
          <div>
            <div className="ui-label">// category</div>
            <h1 className={styles.title}>{categoryName}</h1>
          </div>
          <FilterTabs
            value={filterMode}
            onChange={setFilterMode}
            options={[
              { key: "month", label: "This Month" },
              { key: "ytd", label: "YTD" },
              { key: "year2024", label: "2024" },
              { key: "all", label: "All" },
            ]}
          />
        </section>

        <section className={styles.totalCard}>
          <div>
            <div className={styles.totalLabel}>Total Spend</div>
            <div className={styles.totalAmount}>{fmtUSD(summary.totalSpend)}</div>
            <div className={styles.totalSub}>{summary.invoiceCount} invoices · {summary.lineItemCount} line items</div>
          </div>
          <div className={styles.deltaPill}>
            {summary.activeProviderCount} providers · {summary.uniqueHorseCount} horses
          </div>
        </section>

        <section className={styles.twoCol}>
          <article className={styles.card}>
            <div className={styles.cardHead}>spend_by_provider</div>
            <div className={styles.list}>{summary.spendByProvider.map((row) => (
              <Link href={row.href} key={row.key} className={styles.linkRow}>
                <SpendBar label={row.name} amount={fmtUSD(row.value)} percentage={row.percentage} color="#4A5BDB" />
              </Link>
            ))}</div>
          </article>

          <article className={styles.card}>
            <div className={styles.cardHead}>spend_by_subcategory</div>
            <div className={styles.list}>{summary.spendBySubcategory.map((row) => (
              <SpendBar key={row.key} label={row.name} amount={fmtUSD(row.value)} percentage={row.percentage} color={row.color} />
            ))}</div>
          </article>
        </section>

        <section className={styles.cardSection}>
          <HorseScrollRow items={summary.spendByHorse} formatter={fmtUSD} />
        </section>

        <section className={styles.providersGrid}>
          {providerCards.map(({ provider, invoiceCount, totalSpend, horses, recent }) => (
            <Link key={provider._id} href={`/${categorySlug}/${provider.slug ?? slugify(provider.name)}`} className={styles.providerCard}>
              <div className={styles.providerName}>{provider.name}</div>
              {invoiceCount === 0 ? (
                <div className={styles.muted}>no invoices in this period</div>
              ) : (
                <>
                  <div className={styles.providerAmount}>{fmtUSD(totalSpend)}</div>
                  <div className={styles.providerMeta}>{invoiceCount} invoices · {recent || "no date"}</div>
                  <div className={styles.providerMeta}>{horses.slice(0, 3).join(", ")}{horses.length > 3 ? "..." : ""}</div>
                </>
              )}
            </Link>
          ))}
        </section>

        <InvoiceList title="all_invoices" items={invoiceList} showProviderTag searchPlaceholder="search invoices..." />

        <div className="ui-footer">OLD_OAK_HORSES // {categorySlug.toUpperCase()}</div>
      </main>
    </div>
  );
}

function toParsedBill(bill: any): ParsedBill {
  const extracted = (bill.extractedData ?? {}) as ParsedInvoice;
  const lineItems = Array.isArray(extracted.line_items) ? extracted.line_items : [];
  const invoiceDateMs = parseInvoiceDateMs(extracted.invoice_date, bill.uploadedAt);
  return { bill, extracted, lineItems, invoiceDateMs };
}

function parseInvoiceDateMs(invoiceDate: string | undefined, uploadedAt: number) {
  if (!invoiceDate) return uploadedAt;
  const parsed = new Date(`${invoiceDate}T00:00:00`).getTime();
  return Number.isFinite(parsed) ? parsed : uploadedAt;
}

function getLineTotalUsd(item: ParsedLineItem) {
  return typeof item.total_usd === "number" && Number.isFinite(item.total_usd) ? item.total_usd : 0;
}

function getInvoiceTotalUsd(extracted: ParsedInvoice, lineItems: ParsedLineItem[]) {
  if (typeof extracted.invoice_total_usd === "number" && Number.isFinite(extracted.invoice_total_usd)) {
    return extracted.invoice_total_usd;
  }
  return lineItems.reduce((sum, item) => sum + getLineTotalUsd(item), 0);
}

function fmtUSD(v: number) {
  return `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)+/g, "");
}
