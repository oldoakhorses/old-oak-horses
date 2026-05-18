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
    contactId?: string;
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

  const contacts: any[] = useQuery(api.contacts.getAllContacts) ?? [];
  const bills: any[] = useQuery(api.bills.getBillsByCategory, { categoryId }) ?? [];

  const contactById = useMemo(
    () => new Map(contacts.map((c: any) => [String(c._id), c])),
    [contacts],
  );

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
    const contactTotals = new Map<string, number>();
    const horseTotals = new Map<string, number>();
    const subTotals = new Map<string, number>();
    let totalSpend = 0;
    let lineItems = 0;

    for (const row of filteredBills) {
      const invoiceTotal = getInvoiceTotalUsd(row.extracted, row.lineItems);
      totalSpend += invoiceTotal;
      const cId = row.bill.contactId ? String(row.bill.contactId) : "__unknown__";
      contactTotals.set(cId, (contactTotals.get(cId) ?? 0) + invoiceTotal);

      for (const item of row.lineItems) {
        lineItems += 1;
        const horse = (item.horse_name ?? "Unassigned").trim() || "Unassigned";
        const sub = (item.vet_subcategory ?? "Other").trim() || "Other";
        const amount = getLineTotalUsd(item);
        horseTotals.set(horse, (horseTotals.get(horse) ?? 0) + amount);
        subTotals.set(sub, (subTotals.get(sub) ?? 0) + amount);
      }
    }

    const spendByContact = [...contactTotals.entries()]
      .map(([cId, value]) => {
        const c = contactById.get(cId);
        const name = c?.name ?? "Unknown";
        const slug = c?.slug ?? (c ? slugify(name) : null);
        return {
          key: cId,
          name,
          value,
          percentage: totalSpend > 0 ? (value / totalSpend) * 100 : 0,
          href: slug ? `/contacts/${slug}` : null,
        };
      })
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
      activeContactCount: spendByContact.filter((r) => r.key !== "__unknown__").length,
      spendByContact,
      spendByHorse,
      spendBySubcategory,
    };
  }, [filteredBills, contactById]);

  const invoiceList: InvoiceListItem[] = useMemo(() => {
    return allParsedBills.map((row) => {
      const c = row.bill.contactId ? contactById.get(String(row.bill.contactId)) : null;
      const contactSlug = c?.slug ?? slugify(c?.name ?? "contact");
      return {
        id: row.bill._id,
        href: `/invoices/preview/${row.bill._id}`,
        category: categorySlug,
        invoiceNumber: row.extracted.invoice_number ?? row.bill.fileName,
        invoiceDate: row.extracted.invoice_date ?? null,
        contactName: c?.name ?? "Unknown",
        contactSlug,
        horses: [...new Set(row.lineItems.map((item) => item.horse_name ?? "Unassigned"))],
        lineItemCount: row.lineItems.length,
        fileName: row.bill.fileName,
        amountUsd: getInvoiceTotalUsd(row.extracted, row.lineItems),
      };
    });
  }, [allParsedBills, categorySlug, contactById]);

  // Contacts in this category (by their own category field)
  const contactCards = useMemo(() => {
    return contacts
      .filter((c: any) => c.category === categorySlug)
      .map((c: any) => {
        const cId = String(c._id);
        const cBills = filteredBills.filter((row) => row.bill.contactId && String(row.bill.contactId) === cId);
        const totalSpend = cBills.reduce((sum: number, row: ParsedBill) => sum + getInvoiceTotalUsd(row.extracted, row.lineItems), 0);
        const horses = [...new Set(cBills.flatMap((row) => row.lineItems.map((item) => item.horse_name ?? "Unassigned")))];
        const recent = cBills.length > 0 ? cBills[0].extracted.invoice_date : null;
        return { contact: c, invoiceCount: cBills.length, totalSpend, horses, recent };
      });
  }, [contacts, filteredBills, categorySlug]);

  return (
    <div className="page-shell">
      <NavBar
        items={[
          { label: "old-oak-horses", href: "/dashboard", brand: true },
          { label: categorySlug, current: true },
        ]}
        actions={[
          { label: "upload invoices", href: "/dashboard?panel=invoice", variant: "outlined" },
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
            {summary.activeContactCount} contacts · {summary.uniqueHorseCount} horses
          </div>
        </section>

        <section className={styles.twoCol}>
          <article className={styles.card}>
            <div className={styles.cardHead}>spend_by_contact</div>
            <div className={styles.list}>{summary.spendByContact.map((row) =>
              row.href ? (
                <Link href={row.href} key={row.key} className={styles.linkRow}>
                  <SpendBar label={row.name} amount={fmtUSD(row.value)} percentage={row.percentage} color="#4A5BDB" />
                </Link>
              ) : (
                <div key={row.key}>
                  <SpendBar label={row.name} amount={fmtUSD(row.value)} percentage={row.percentage} color="#4A5BDB" />
                </div>
              ),
            )}</div>
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

        <section className={styles.contactsGrid}>
          {contactCards.map(({ contact, invoiceCount, totalSpend, horses, recent }) => (
            <Link key={contact._id} href={`/contacts/${contact.slug ?? slugify(contact.name)}`} className={styles.contactCard}>
              <div className={styles.contactName}>{contact.name}</div>
              {invoiceCount === 0 ? (
                <div className={styles.muted}>no invoices in this period</div>
              ) : (
                <>
                  <div className={styles.contactAmount}>{fmtUSD(totalSpend)}</div>
                  <div className={styles.contactMeta}>{invoiceCount} invoices · {recent || "no date"}</div>
                  <div className={styles.contactMeta}>{horses.slice(0, 3).join(", ")}{horses.length > 3 ? "..." : ""}</div>
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
  const abs = Math.abs(v);
  const formatted = `$${abs.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  return v < 0 ? `(${formatted})` : formatted;
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)+/g, "");
}
