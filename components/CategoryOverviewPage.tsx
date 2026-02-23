"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";

type FilterMode = "all" | "ytd" | "year" | "month";

type ParsedLineItem = {
  date?: string;
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

type SummaryRow = { name: string; value: number; pct: number; color?: string; href?: string };

const subcategoryColors: Record<string, { bg: string; text: string; dot: string; bar: string }> = {
  "Travel Cost": { bg: "#F0F4FF", text: "#3B5BDB", dot: "#3B5BDB", bar: "#3B5BDB" },
  "Physical Exam": { bg: "#F0FFF4", text: "#2F855A", dot: "#2F855A", bar: "#2F855A" },
  "Joint Injection": { bg: "#FFF5F5", text: "#C53030", dot: "#C53030", bar: "#C53030" },
  Ultrasound: { bg: "#FFFBF0", text: "#B7791F", dot: "#B7791F", bar: "#B7791F" },
  MRI: { bg: "#FAF0FF", text: "#6B21A8", dot: "#6B21A8", bar: "#6B21A8" },
  Radiograph: { bg: "#FFF0F6", text: "#9D174D", dot: "#9D174D", bar: "#9D174D" },
  Medication: { bg: "#F0FDFF", text: "#0E7490", dot: "#0E7490", bar: "#0E7490" },
  Sedation: { bg: "#FFF7ED", text: "#C2410C", dot: "#C2410C", bar: "#C2410C" },
  Vaccine: { bg: "#F0FFF9", text: "#0D7A5F", dot: "#0D7A5F", bar: "#0D7A5F" },
  Labs: { bg: "#F5F0FF", text: "#5B21B6", dot: "#5B21B6", bar: "#5B21B6" },
  Other: { bg: "#F9FAFB", text: "#6B7280", dot: "#6B7280", bar: "#6B7280" }
};

export default function CategoryOverviewPage({
  categoryId,
  categoryName,
  categorySlug
}: {
  categoryId: Id<"categories">;
  categoryName: string;
  categorySlug: string;
}) {
  const [filterMode, setFilterMode] = useState<FilterMode>("all");
  const [selectedYear, setSelectedYear] = useState<number>(new Date().getFullYear());
  const [selectedMonth, setSelectedMonth] = useState<number>(new Date().getMonth() + 1);
  const [search, setSearch] = useState("");

  const providers: any[] = useQuery(api.providers.getProvidersByCategory, { categoryId }) ?? [];
  const bills: any[] = useQuery(api.bills.getBillsByCategory, { categoryId }) ?? [];

  const providerById = useMemo(() => new Map(providers.map((provider: any) => [provider._id, provider])), [providers]);

  const allParsedBills = useMemo(
    () => bills.map((bill: any) => toParsedBill(bill)).sort((a: ParsedBill, b: ParsedBill) => b.invoiceDateMs - a.invoiceDateMs),
    [bills]
  );

  const availableYears = useMemo(() => {
    const years = new Set<number>();
    for (const row of allParsedBills) {
      years.add(new Date(row.invoiceDateMs).getFullYear());
    }
    return [...years].sort((a, b) => b - a);
  }, [allParsedBills]);

  const filteredBills = useMemo(() => {
    if (filterMode === "all") return allParsedBills;

    const now = new Date();
    if (filterMode === "ytd") {
      const start = new Date(now.getFullYear(), 0, 1).getTime();
      return allParsedBills.filter((row) => row.invoiceDateMs >= start && row.invoiceDateMs <= now.getTime());
    }

    if (filterMode === "year") {
      const start = new Date(selectedYear, 0, 1).getTime();
      const end = new Date(selectedYear, 11, 31, 23, 59, 59, 999).getTime();
      return allParsedBills.filter((row) => row.invoiceDateMs >= start && row.invoiceDateMs <= end);
    }

    const start = new Date(selectedYear, selectedMonth - 1, 1).getTime();
    const end = new Date(selectedYear, selectedMonth, 0, 23, 59, 59, 999).getTime();
    return allParsedBills.filter((row) => row.invoiceDateMs >= start && row.invoiceDateMs <= end);
  }, [allParsedBills, filterMode, selectedMonth, selectedYear]);

  const searchableBills = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return allParsedBills;

    return allParsedBills.filter(({ bill, extracted, lineItems }: ParsedBill) => {
      const providerName = providerById.get(bill.providerId)?.name ?? "";
      const haystack = [
        providerName,
        extracted.invoice_number ?? "",
        extracted.invoice_date ?? "",
        bill.fileName ?? "",
        ...lineItems.flatMap((line: ParsedLineItem) => [line.horse_name ?? "", line.description ?? "", line.vet_subcategory ?? "", line.date ?? ""])
      ]
        .join(" ")
        .toLowerCase();

      return haystack.includes(term);
    });
  }, [allParsedBills, providerById, search]);

  const summary = useMemo(() => {
    const invoiceCount = filteredBills.length;
    const lineItemCount = filteredBills.reduce((sum: number, row: ParsedBill) => sum + row.lineItems.length, 0);

    let totalSpend = 0;
    const horseTotals = new Map<string, number>();
    const subcategoryTotals = new Map<string, number>();
    const providerTotals = new Map<string, number>();

    for (const row of filteredBills) {
      const invoiceTotal = getInvoiceTotalUsd(row.extracted, row.lineItems);
      totalSpend += invoiceTotal;
      providerTotals.set(row.bill.providerId, (providerTotals.get(row.bill.providerId) ?? 0) + invoiceTotal);

      for (const item of row.lineItems) {
        const horse = (item.horse_name ?? "Unassigned").trim() || "Unassigned";
        const subcategory = (item.vet_subcategory ?? "Other").trim() || "Other";
        const amount = getLineTotalUsd(item);

        horseTotals.set(horse, (horseTotals.get(horse) ?? 0) + amount);
        subcategoryTotals.set(subcategory, (subcategoryTotals.get(subcategory) ?? 0) + amount);
      }
    }

    const spendByProvider: SummaryRow[] = [...providerTotals.entries()]
      .map(([providerId, value]) => ({
        name: providerById.get(providerId)?.name ?? "Unknown",
        value,
        pct: totalSpend > 0 ? (value / totalSpend) * 100 : 0,
        href: `/${categorySlug}/${slugify(providerById.get(providerId)?.name ?? "unknown")}`
      }))
      .sort((a, b) => b.value - a.value);

    const spendByHorse: SummaryRow[] = [...horseTotals.entries()]
      .map(([name, value]) => ({ name, value, pct: totalSpend > 0 ? (value / totalSpend) * 100 : 0 }))
      .sort((a, b) => b.value - a.value);

    const spendBySubcategory: SummaryRow[] = [...subcategoryTotals.entries()]
      .map(([name, value]) => ({
        name,
        value,
        pct: totalSpend > 0 ? (value / totalSpend) * 100 : 0,
        color: subcategoryColors[name]?.bar ?? subcategoryColors.Other.bar
      }))
      .sort((a, b) => b.value - a.value);

    return {
      invoiceCount,
      lineItemCount,
      uniqueHorseCount: spendByHorse.length,
      activeProviderCount: spendByProvider.length,
      averagePerInvoice: invoiceCount > 0 ? totalSpend / invoiceCount : 0,
      totalSpend,
      spendByProvider,
      spendByHorse,
      spendBySubcategory
    };
  }, [categorySlug, filteredBills, providerById]);

  const providerCards = useMemo(() => {
    return providers.map((provider: any) => {
      const providerBills = filteredBills.filter((row) => row.bill.providerId === provider._id);
      const totalSpend = providerBills.reduce((sum: number, row: ParsedBill) => sum + getInvoiceTotalUsd(row.extracted, row.lineItems), 0);
      const recentDateMs = providerBills.length > 0 ? Math.max(...providerBills.map((row) => row.invoiceDateMs)) : null;

      const horseSet = new Set<string>();
      const subcategoryTotals = new Map<string, number>();
      let lineItemCount = 0;
      for (const row of providerBills) {
        lineItemCount += row.lineItems.length;
        for (const item of row.lineItems) {
          const horse = (item.horse_name ?? "Unassigned").trim() || "Unassigned";
          horseSet.add(horse);
          const sub = (item.vet_subcategory ?? "Other").trim() || "Other";
          subcategoryTotals.set(sub, (subcategoryTotals.get(sub) ?? 0) + getLineTotalUsd(item));
        }
      }

      const topSubcategories = [...subcategoryTotals.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([name]) => name);

      return {
        provider,
        invoiceCount: providerBills.length,
        lineItemCount,
        totalSpend,
        recentDate: recentDateMs ? new Date(recentDateMs).toISOString().slice(0, 10) : null,
        horseNames: [...horseSet],
        topSubcategories,
        muted: providerBills.length === 0
      };
    });
  }, [filteredBills, providers]);

  const filterLabel =
    filterMode === "all"
      ? "All"
      : filterMode === "ytd"
      ? "YTD"
      : filterMode === "year"
      ? `Year ${selectedYear}`
      : `${monthName(selectedMonth)} ${selectedYear}`;

  return (
    <div style={{ maxWidth: 1040, margin: "0 auto", padding: "28px 16px" }}>
      <div
        style={{
          position: "sticky",
          top: 0,
          zIndex: 50,
          width: "100%",
          minHeight: 56,
          background: "#1C1C1C",
          borderRadius: 12,
          padding: "12px 18px",
          display: "flex",
          alignItems: "center",
          color: "#fff"
        }}
      >
        <span style={{ fontFamily: "Playfair Display", fontStyle: "italic", fontSize: 22 }}>Old Oak Horses</span>
        <span style={{ color: "#444", margin: "0 8px" }}>/</span>
        <span style={{ color: "#fff" }}>{categoryName}</span>
      </div>

      <section className="card" style={{ marginTop: 20 }}>
        <div className="section-label">Category Overview</div>
        <h1 style={{ margin: 0, fontFamily: "Playfair Display" }}>{categoryName}</h1>
        <small style={{ fontFamily: "DM Mono" }}>
          Showing: {filterLabel} · {summary.invoiceCount} invoices across {summary.activeProviderCount} providers
        </small>

        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginTop: 14, marginBottom: 18 }}>
          {(["all", "ytd", "year", "month"] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => setFilterMode(mode)}
              style={{
                background: filterMode === mode ? "#1C1C1C" : "#F0EDE8",
                color: filterMode === mode ? "#fff" : "#1C1C1C",
                borderRadius: 99,
                border: "none",
                padding: "8px 12px",
                fontFamily: "DM Mono"
              }}
            >
              {mode === "all" ? "All" : mode.toUpperCase()}
            </button>
          ))}

          {(filterMode === "year" || filterMode === "month") && availableYears.length > 0 ? (
            <select value={selectedYear} onChange={(e) => setSelectedYear(Number(e.target.value))} style={{ width: 140 }}>
              {availableYears.map((year) => (
                <option key={year} value={year}>
                  {year}
                </option>
              ))}
            </select>
          ) : null}

          {filterMode === "month" ? (
            <select value={selectedMonth} onChange={(e) => setSelectedMonth(Number(e.target.value))} style={{ width: 140 }}>
              {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                <option key={m} value={m}>
                  {monthName(m)}
                </option>
              ))}
            </select>
          ) : null}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "minmax(260px, 1fr) minmax(0, 2fr)", gap: 20 }}>
          <div style={{ background: "#1C1C1C", borderRadius: 12, padding: 18 }}>
            <div style={{ fontFamily: "DM Mono", fontSize: 10, color: "#555", letterSpacing: "0.12em", textTransform: "uppercase" }}>
              Total Spend
            </div>
            <div style={{ marginTop: 6, color: "#fff", fontFamily: "Playfair Display", fontSize: 42 }}>{fmtUSD(summary.totalSpend)}</div>
            <div style={{ height: 1, background: "#2C2C2C", margin: "12px 0" }} />
            <div style={{ display: "grid", gap: 6, fontFamily: "DM Mono", fontSize: 12, color: "#666" }}>
              <div>Total invoices: <span style={{ color: "#fff" }}>{summary.invoiceCount}</span></div>
              <div>Total line items: <span style={{ color: "#fff" }}>{summary.lineItemCount}</span></div>
              <div>Total unique horses: <span style={{ color: "#fff" }}>{summary.uniqueHorseCount}</span></div>
              <div>Active providers: <span style={{ color: "#fff" }}>{summary.activeProviderCount}</span></div>
              <div>Avg / invoice: <span style={{ color: "#fff" }}>{fmtUSD(summary.averagePerInvoice)}</span></div>
            </div>
          </div>

          <div style={{ display: "grid", gap: 20 }}>
            <SummaryBars title="Spend by Provider" rows={summary.spendByProvider} emptyLabel="No data for this period" />
            <SummaryBars title="Spend by Horse" rows={summary.spendByHorse} emptyLabel="No data for this period" />
            <SummaryBars title="Spend by Subcategory" rows={summary.spendBySubcategory} emptyLabel="No data for this period" />
          </div>
        </div>
      </section>

      <section className="card">
        <div className="section-label">Providers</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 16 }}>
          {providerCards.map((card: any) => (
            <Link
              key={card.provider._id}
              href={`/${categorySlug}/${slugify(card.provider.name)}` as any}
              style={{
                display: "block",
                textDecoration: "none",
                background: card.muted ? "#FAFAF8" : "#fff",
                borderRadius: 12,
                boxShadow: "0 1px 4px rgba(0,0,0,0.06)",
                padding: 16,
                transition: "transform 140ms ease, box-shadow 140ms ease"
              }}
            >
              <h3 style={{ margin: 0, fontFamily: "Playfair Display", color: "#1C1C1C" }}>{card.provider.name}</h3>
              {card.muted ? (
                <small style={{ color: "#888" }}>No invoices in this period</small>
              ) : (
                <>
                  <p style={{ margin: "8px 0 2px", fontFamily: "DM Mono", color: "#666" }}>{card.invoiceCount} invoices</p>
                  <div style={{ fontFamily: "Playfair Display", fontSize: 30, color: "#1C1C1C" }}>{fmtUSD(card.totalSpend)}</div>
                  <p style={{ margin: "0 0 8px", fontFamily: "DM Mono", color: "#999" }}>Most recent: {card.recentDate}</p>
                  <small style={{ color: "#666" }}>
                    Horses: {card.horseNames.length > 3 ? `${card.horseNames.slice(0, 3).join(", ")}...` : card.horseNames.join(", ")}
                  </small>
                  <div style={{ marginTop: 8, display: "flex", flexWrap: "wrap", gap: 6 }}>
                    {card.topSubcategories.map((subcategory: string) => {
                      const palette = subcategoryColors[subcategory] ?? subcategoryColors.Other;
                      return (
                        <span
                          key={subcategory}
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 6,
                            padding: "3px 10px",
                            borderRadius: 99,
                            background: palette.bg,
                            color: palette.text,
                            fontSize: 11,
                            fontWeight: 600
                          }}
                        >
                          <span style={{ width: 6, height: 6, borderRadius: 99, background: palette.dot }} />
                          {subcategory}
                        </span>
                      );
                    })}
                  </div>
                </>
              )}
            </Link>
          ))}
        </div>
      </section>

      <section className="card">
        <div className="section-label">All Invoices</div>
        <input
          placeholder="Search invoices, horses, dates, subcategories..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{
            width: "100%",
            marginBottom: 8,
            border: "1px solid #EDEAE4",
            borderRadius: 8,
            background: "#fff",
            padding: "10px 12px",
            fontFamily: "DM Sans"
          }}
        />
        <small style={{ display: "block", marginBottom: 12, fontFamily: "DM Mono" }}>
          {searchableBills.length} of {allParsedBills.length} invoices
        </small>

        <div style={{ maxHeight: 560, overflowY: "auto", display: "grid", gap: 0 }}>
          {searchableBills.length === 0 ? (
            <div className="card" style={{ marginBottom: 0, textAlign: "center", color: "#888" }}>
              No invoices match your search.
            </div>
          ) : (
            searchableBills.map((row: ParsedBill) => {
              const providerName = providerById.get(row.bill.providerId)?.name ?? "Unknown";
              const providerSlug = slugify(providerName);
              const horseNames = [...new Set(row.lineItems.map((item: ParsedLineItem) => (item.horse_name ?? "Unassigned").trim() || "Unassigned"))];
              const bySubcategory = aggregateBySubcategory(row.lineItems);
              return (
                <div key={row.bill._id} style={{ padding: "14px 10px", borderBottom: "1px solid #F0EDE8" }}>
                  <div style={{ display: "grid", gridTemplateColumns: "220px 1fr auto", gap: 12, alignItems: "center" }}>
                    <div>
                      <div style={{ fontFamily: "DM Mono", fontWeight: 700 }}>{row.extracted.invoice_date ?? "-"}</div>
                      <div style={{ color: "#999", fontFamily: "DM Mono", fontSize: 11 }}>{row.extracted.invoice_number ?? "No invoice #"}</div>
                    </div>

                    <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
                      <span style={{ background: "#F0EDE8", color: "#1C1C1C", borderRadius: 99, padding: "3px 10px", fontSize: 11 }}>
                        {providerName}
                      </span>
                      {horseNames.map((horseName) => (
                        <span key={horseName} style={{ background: "#1C1C1C", color: "#fff", borderRadius: 99, padding: "3px 10px", fontSize: 11 }}>
                          {horseName}
                        </span>
                      ))}
                    </div>

                    <div style={{ textAlign: "right" }}>
                      <div style={{ fontFamily: "Playfair Display", fontSize: 30 }}>{fmtUSD(getInvoiceTotalUsd(row.extracted, row.lineItems))}</div>
                      <Link href={`/${categorySlug}/${providerSlug}/invoices/${row.bill._id}` as any} style={{ color: "#3B5BDB", fontFamily: "DM Mono", fontSize: 12 }}>
                        View -&gt;
                      </Link>
                    </div>
                  </div>

                  <div style={{ marginTop: 8, display: "flex", flexWrap: "wrap", gap: 8 }}>
                    {bySubcategory.map((sub: { name: string; value: number }) => {
                      const palette = subcategoryColors[sub.name] ?? subcategoryColors.Other;
                      return (
                        <span
                          key={sub.name}
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 6,
                            padding: "3px 10px",
                            borderRadius: 99,
                            background: palette.bg,
                            color: palette.text,
                            fontSize: 11,
                            fontWeight: 600
                          }}
                        >
                          <span style={{ width: 6, height: 6, borderRadius: 99, background: palette.dot }} />
                          {sub.name}
                        </span>
                      );
                    })}
                  </div>

                  <div style={{ marginTop: 8, fontFamily: "DM Mono", fontSize: 11, color: "#CCC" }}>{row.bill.fileName}</div>
                </div>
              );
            })
          )}
        </div>
      </section>
    </div>
  );
}

function SummaryBars({
  title,
  rows,
  emptyLabel
}: {
  title: string;
  rows: SummaryRow[];
  emptyLabel: string;
}) {
  return (
    <div className="card" style={{ marginBottom: 0 }}>
      <div className="section-label">{title}</div>
      {rows.length === 0 ? (
        <small>{emptyLabel}</small>
      ) : (
        <div style={{ display: "grid", gap: 10 }}>
          {rows.map((row) => (
            <div key={row.name}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8, marginBottom: 4 }}>
                {row.href ? (
                  <Link href={row.href as any} style={{ color: "#1C1C1C", textDecoration: "none", fontWeight: 600 }}>
                    {truncate(row.name, 32)}
                  </Link>
                ) : (
                  <span style={{ fontWeight: 600 }}>{truncate(row.name, 32)}</span>
                )}
                <span style={{ fontFamily: "DM Mono" }}>
                  {fmtUSD(row.value)} ({row.pct.toFixed(1)}%)
                </span>
              </div>
              <div style={{ width: "100%", height: 5, borderRadius: 99, background: "#F0EDE8", overflow: "hidden" }}>
                <div
                  style={{
                    width: `${Math.max(0, Math.min(100, row.pct))}%`,
                    height: "100%",
                    background: row.color ?? "#1C1C1C"
                  }}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function toParsedBill(bill: any): ParsedBill {
  const extracted = (bill.extractedData ?? {}) as ParsedInvoice;
  const lineItems = sanitizeLineItems(extracted.line_items);
  const parsedInvoiceDate = typeof extracted.invoice_date === "string" ? Date.parse(extracted.invoice_date) : NaN;

  return {
    bill,
    extracted,
    lineItems,
    invoiceDateMs: Number.isFinite(parsedInvoiceDate) ? parsedInvoiceDate : bill.uploadedAt
  };
}

function sanitizeLineItems(value: unknown): ParsedLineItem[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is ParsedLineItem => !!item && typeof item === "object");
}

function getLineTotalUsd(item: ParsedLineItem): number {
  return typeof item.total_usd === "number" && Number.isFinite(item.total_usd) ? item.total_usd : 0;
}

function getInvoiceTotalUsd(extracted: ParsedInvoice, lineItems: ParsedLineItem[]): number {
  if (typeof extracted.invoice_total_usd === "number" && Number.isFinite(extracted.invoice_total_usd)) return extracted.invoice_total_usd;
  return lineItems.reduce((sum, item) => sum + getLineTotalUsd(item), 0);
}

function aggregateBySubcategory(lineItems: ParsedLineItem[]): Array<{ name: string; value: number }> {
  const map = new Map<string, number>();
  for (const item of lineItems) {
    const key = (item.vet_subcategory ?? "Other").trim() || "Other";
    map.set(key, (map.get(key) ?? 0) + getLineTotalUsd(item));
  }
  return [...map.entries()].map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
}

function fmtUSD(v: number): string {
  return `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function monthName(month: number) {
  return new Date(2000, month - 1, 1).toLocaleString("en-US", { month: "long" });
}

function truncate(value: string, max: number) {
  if (value.length <= max) return value;
  return `${value.slice(0, max - 1)}…`;
}

function slugify(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}
