"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";

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
    status: string;
    errorMessage?: string;
    extractedData?: unknown;
  };
  extracted: ParsedInvoice;
  lineItems: ParsedLineItem[];
  invoiceDateMs: number;
};

type UploadRow = {
  id: string;
  file: File;
  batchIndex: number;
  batchDateIso: string;
  billId?: string;
  localStatus: "pending" | "uploading" | "parsing" | "done" | "error";
  localError?: string;
};

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

export default function ButheProviderPage() {
  const [filterMode, setFilterMode] = useState<FilterMode>("all");
  const [selectedYear, setSelectedYear] = useState<number>(new Date().getFullYear());
  const [selectedMonth, setSelectedMonth] = useState<number>(new Date().getMonth() + 1);
  const [search, setSearch] = useState("");

  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadRows, setUploadRows] = useState<UploadRow[]>([]);
  const [uploadStep, setUploadStep] = useState<1 | 2 | 3>(1);
  const [dismissedWarnings, setDismissedWarnings] = useState<Record<string, true>>({});

  const generateUploadUrl = useMutation(api.bills.generateUploadUrl);
  const createBillRecord = useMutation(api.bills.createBillRecord);
  const triggerBillParsing = useMutation(api.bills.triggerBillParsing);

  const categories = useQuery(api.categories.getAllCategories) ?? [];
  const veterinaryCategory = categories.find((c) => c.slug === "veterinary") ?? null;

  const butheProvider =
    useQuery(
      api.providers.getProviderByNameInCategory,
      veterinaryCategory ? { categoryId: veterinaryCategory._id, name: "Buthe" } : "skip"
    ) ?? null;

  const allBills = useQuery(api.bills.getBillsByProvider, butheProvider ? { providerId: butheProvider._id } : "skip") ?? [];

  const allParsedBills = useMemo(() => allBills.map((bill) => toParsedBill(bill)), [allBills]);

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
    const currentYear = now.getFullYear();

    if (filterMode === "ytd") {
      const start = new Date(currentYear, 0, 1).getTime();
      const end = now.getTime();
      return allParsedBills.filter((row) => row.invoiceDateMs >= start && row.invoiceDateMs <= end);
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

    return allParsedBills.filter(({ bill, extracted, lineItems }) => {
      const haystack = [
        extracted.invoice_number ?? "",
        extracted.invoice_date ?? "",
        bill.fileName ?? "",
        ...lineItems.flatMap((line) => [line.horse_name ?? "", line.description ?? "", line.vet_subcategory ?? "", line.date ?? ""])
      ]
        .join(" ")
        .toLowerCase();

      return haystack.includes(term);
    });
  }, [allParsedBills, search]);

  const summary = useMemo(() => {
    const invoiceCount = filteredBills.length;
    const lineItemCount = filteredBills.reduce((sum, row) => sum + row.lineItems.length, 0);

    const horseTotals = new Map<string, number>();
    const subcategoryTotals = new Map<string, number>();

    let totalSpend = 0;

    for (const row of filteredBills) {
      const invoiceTotal = getInvoiceTotalUsd(row.extracted, row.lineItems);
      totalSpend += invoiceTotal;

      for (const item of row.lineItems) {
        const horse = (item.horse_name ?? "Unassigned").trim() || "Unassigned";
        const subcategory = (item.vet_subcategory ?? "Other").trim() || "Other";
        const amount = getLineTotalUsd(item);

        horseTotals.set(horse, (horseTotals.get(horse) ?? 0) + amount);
        subcategoryTotals.set(subcategory, (subcategoryTotals.get(subcategory) ?? 0) + amount);
      }
    }

    const horseRows = [...horseTotals.entries()]
      .map(([name, value]) => ({ name, value, pct: totalSpend > 0 ? (value / totalSpend) * 100 : 0 }))
      .sort((a, b) => b.value - a.value);

    const subcategoryRows = [...subcategoryTotals.entries()]
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
      uniqueHorseCount: horseRows.length,
      averagePerInvoice: invoiceCount > 0 ? totalSpend / invoiceCount : 0,
      totalSpend,
      horseRows,
      subcategoryRows
    };
  }, [filteredBills]);

  const warningRows = useMemo(() => {
    return allParsedBills.filter(({ bill, extracted }) => {
      const status = String(bill.status);
      const isStatement = status === "statement";
      const noInvoiceNumber = !extracted.invoice_number;
      return (isStatement || noInvoiceNumber) && !dismissedWarnings[bill._id];
    });
  }, [allParsedBills, dismissedWarnings]);

  const allUploadsTerminal = useMemo(() => {
    if (uploadRows.length === 0) return false;
    const byId = new Map(allBills.map((b) => [b._id, b.status]));
    return uploadRows.every((row) => {
      if (!row.billId) return row.localStatus === "error";
      const status = byId.get(row.billId);
      return status === "done" || status === "error";
    });
  }, [allBills, uploadRows]);

  async function beginUploadFlow() {
    if (!butheProvider || !veterinaryCategory) return;
    setUploadStep(3);

    for (const row of uploadRows) {
      await uploadSingle(row, butheProvider._id, veterinaryCategory._id);
    }
  }

  async function uploadSingle(row: UploadRow, providerId: string, categoryId: string) {
    setUploadRows((rows) => rows.map((r) => (r.id === row.id ? { ...r, localStatus: "uploading", localError: undefined, billId: undefined } : r)));

    try {
      const uploadUrl = await generateUploadUrl();
      const uploadResult = await fetch(uploadUrl, {
        method: "POST",
        headers: { "Content-Type": "application/pdf" },
        body: row.file
      });

      if (!uploadResult.ok) throw new Error("Upload failed");

      const { storageId } = (await uploadResult.json()) as { storageId: string };
      const fileName = `Veterinary - Buthe - ${row.batchDateIso}-${String(row.batchIndex).padStart(2, "0")}`;

      const billId = await createBillRecord({
        providerId: providerId as never,
        categoryId: categoryId as never,
        fileId: storageId as never,
        fileName,
        billingPeriod: new Date().toISOString().slice(0, 7)
      });

      setUploadRows((rows) => rows.map((r) => (r.id === row.id ? { ...r, billId, localStatus: "parsing" } : r)));
      await triggerBillParsing({ billId });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      setUploadRows((rows) => rows.map((r) => (r.id === row.id ? { ...r, localStatus: "error", localError: message } : r)));
    }
  }

  const filterLabel =
    filterMode === "all"
      ? "All"
      : filterMode === "ytd"
      ? "YTD"
      : filterMode === "year"
      ? `Year ${selectedYear}`
      : `${monthName(selectedMonth)} ${selectedYear}`;

  return (
    <div style={{ maxWidth: 1040, margin: "0 auto", padding: "36px 24px" }}>
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
          justifyContent: "space-between",
          alignItems: "center",
          color: "#fff"
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span style={{ fontFamily: "Playfair Display", fontStyle: "italic", fontSize: 22 }}>Old Oak Horses</span>
          <span style={{ color: "#444" }}>/</span>
          <span style={{ color: "#888" }}>Veterinary</span>
          <span style={{ color: "#444" }}>/</span>
          <span style={{ color: "#fff" }}>Buthe</span>
        </div>
      </div>

      {warningRows.map((row) => (
        <div
          key={row.bill._id}
          style={{
            marginTop: 12,
            background: "#FFFBEA",
            border: "1px solid #F6E05E",
            color: "#92400E",
            borderRadius: 12,
            padding: "10px 12px",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 12
          }}
        >
          <span>{row.bill.fileName} appears to be an account statement, not an invoice. It has been stored but not parsed.</span>
          <button
            type="button"
            className="secondary"
            onClick={() => setDismissedWarnings((prev) => ({ ...prev, [row.bill._id]: true }))}
          >
            ×
          </button>
        </div>
      ))}

      <section className="card" style={{ marginTop: 20 }}>
        <div className="section-label">Provider</div>
        <h1 style={{ margin: 0, fontFamily: "Playfair Display" }}>Buthe</h1>
        <small style={{ fontFamily: "DM Mono" }}>Showing: {filterLabel} · {summary.invoiceCount} invoices</small>

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

          {filterMode === "year" || filterMode === "month" ? (
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
              <div>
                Invoices: <span style={{ color: "#fff" }}>{summary.invoiceCount}</span>
              </div>
              <div>
                Line items: <span style={{ color: "#fff" }}>{summary.lineItemCount}</span>
              </div>
              <div>
                Unique horses: <span style={{ color: "#fff" }}>{summary.uniqueHorseCount}</span>
              </div>
              <div>
                Avg / invoice: <span style={{ color: "#fff" }}>{fmtUSD(summary.averagePerInvoice)}</span>
              </div>
            </div>
          </div>

          <div style={{ display: "grid", gap: 20 }}>
            <SummaryBars title="Spend by Horse" rows={summary.horseRows} emptyLabel="No data for this period" />
            <SummaryBars title="Spend by Subcategory" rows={summary.subcategoryRows} emptyLabel="No data for this period" />
          </div>
        </div>
      </section>

      <section className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: 12 }}>
          <div>
            <div className="section-label">Invoice List</div>
            <h2 style={{ margin: 0, fontFamily: "Playfair Display", fontSize: 28 }}>Buthe Invoices</h2>
          </div>
          <button type="button" onClick={() => setUploadOpen(true)} style={{ background: "#1C1C1C", color: "#fff" }}>
            + Upload Bills
          </button>
        </div>

        <input
          placeholder="Search invoices, horses, dates, subcategories..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ marginBottom: 8 }}
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
            searchableBills.map((row) => <InvoiceRow key={row.bill._id} row={row} />)
          )}
        </div>
      </section>

      {uploadOpen ? (
        <BatchUploadModal
          rows={uploadRows}
          step={uploadStep}
          allTerminal={allUploadsTerminal}
          onClose={() => {
            setUploadOpen(false);
            setUploadRows([]);
            setUploadStep(1);
          }}
          onSelectFiles={(files) => {
            const batchDateIso = new Date().toISOString().slice(0, 10);
            setUploadRows(
              files
                .filter((file) => file.type === "application/pdf")
                .map((file, index) => ({
                  id: `${file.name}-${file.size}-${Math.random().toString(36).slice(2)}`,
                  file,
                  batchIndex: index + 1,
                  batchDateIso,
                  localStatus: "pending"
                }))
            );
            setUploadStep(2);
          }}
          onConfirm={beginUploadFlow}
          onRetry={async (row) => {
            if (!butheProvider || !veterinaryCategory) return;
            await uploadSingle(row, butheProvider._id, veterinaryCategory._id);
          }}
        />
      ) : null}

      <div style={{ textAlign: "center", fontFamily: "DM Mono", fontSize: 11, color: "#CCC", marginTop: 8 }}>
        OLD OAK HORSES · VETERINARY · BUTHE
      </div>
    </div>
  );
}

function SummaryBars({
  title,
  rows,
  emptyLabel
}: {
  title: string;
  rows: Array<{ name: string; value: number; pct: number; color?: string }>;
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
                <span style={{ fontWeight: 600 }}>{truncate(row.name, 32)}</span>
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

function InvoiceRow({ row }: { row: ParsedBill }) {
  const horseNames = [...new Set(row.lineItems.map((item) => (item.horse_name ?? "Unassigned").trim() || "Unassigned"))];
  const total = getInvoiceTotalUsd(row.extracted, row.lineItems);
  const bySubcategory = aggregateBySubcategory(row.lineItems);

  return (
    <div
      className="invoice-row"
      style={{
        padding: "14px 10px",
        borderBottom: "1px solid #F0EDE8",
        transition: "background-color 120ms ease"
      }}
    >
      <div style={{ display: "grid", gridTemplateColumns: "200px 1fr auto", gap: 12, alignItems: "center" }}>
        <div>
          <div style={{ fontFamily: "DM Mono", fontWeight: 700 }}>{row.extracted.invoice_date ?? "-"}</div>
          <div style={{ color: "#999", fontFamily: "DM Mono", fontSize: 11 }}>{row.extracted.invoice_number ?? "No invoice #"}</div>
        </div>

        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
          {horseNames.map((horseName) => (
            <span
              key={horseName}
              style={{
                background: "#1C1C1C",
                color: "#fff",
                borderRadius: 99,
                padding: "3px 10px",
                fontFamily: "DM Sans",
                fontSize: 11,
                fontWeight: 600
              }}
            >
              {horseName}
            </span>
          ))}
          <small>{row.lineItems.length} line items</small>
        </div>

        <div style={{ textAlign: "right" }}>
          <div style={{ fontFamily: "Playfair Display", fontSize: 30 }}>{fmtUSD(total)}</div>
          <Link href={`/veterinary/buthe/invoices/${row.bill._id}`} style={{ color: "#3B5BDB", fontFamily: "DM Mono", fontSize: 12 }}>
            View -&gt;
          </Link>
        </div>
      </div>

      <div style={{ marginTop: 10, display: "flex", flexWrap: "wrap", gap: 8 }}>
        {bySubcategory.map((sub) => {
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
}

function BatchUploadModal({
  rows,
  step,
  allTerminal,
  onClose,
  onSelectFiles,
  onConfirm,
  onRetry
}: {
  rows: UploadRow[];
  step: 1 | 2 | 3;
  allTerminal: boolean;
  onClose: () => void;
  onSelectFiles: (files: File[]) => void;
  onConfirm: () => void;
  onRetry: (row: UploadRow) => void;
}) {
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.45)",
        display: "grid",
        placeItems: "center",
        padding: 20,
        zIndex: 60
      }}
    >
      <div style={{ width: "100%", maxWidth: 520, background: "#fff", borderRadius: 16, padding: 22 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <h3 style={{ margin: 0, fontFamily: "Playfair Display" }}>Batch Upload</h3>
          <button type="button" className="secondary" onClick={onClose}>
            Close
          </button>
        </div>

        {step === 1 ? (
          <label
            style={{
              border: "2px dashed #EDEAE4",
              borderRadius: 12,
              padding: 20,
              display: "block",
              textAlign: "center",
              cursor: "pointer",
              background: "#FAFAF8"
            }}
            onDragOver={(e) => {
              e.preventDefault();
              (e.currentTarget as HTMLLabelElement).style.borderColor = "#1C1C1C";
            }}
            onDragLeave={(e) => {
              (e.currentTarget as HTMLLabelElement).style.borderColor = "#EDEAE4";
            }}
            onDrop={(e) => {
              e.preventDefault();
              (e.currentTarget as HTMLLabelElement).style.borderColor = "#EDEAE4";
              onSelectFiles(Array.from(e.dataTransfer.files));
            }}
          >
            <input type="file" multiple accept="application/pdf" style={{ display: "none" }} onChange={(e) => onSelectFiles(Array.from(e.target.files ?? []))} />
            <div>Drop Buthe invoices here or click to browse</div>
            <small style={{ display: "block", marginTop: 6 }}>Accepts multiple PDF files · invoices only, not statements</small>
            {rows.length > 0 ? (
              <div style={{ marginTop: 10, textAlign: "left" }}>
                {rows.map((row) => (
                  <div key={row.id} style={{ display: "flex", justifyContent: "space-between", padding: "4px 0" }}>
                    <span>{row.file.name}</span>
                    <small>{formatFileSize(row.file.size)}</small>
                  </div>
                ))}
              </div>
            ) : null}
          </label>
        ) : null}

        {step === 2 ? (
          <div>
            <div className="panel" style={{ marginBottom: 12 }}>
              <p style={{ margin: "0 0 8px" }}><strong>Category:</strong> Veterinary</p>
              <p style={{ margin: "0 0 8px" }}><strong>Provider:</strong> Buthe</p>
              <p style={{ margin: "0 0 8px" }}><strong>Files selected:</strong> {rows.length}</p>
              <small style={{ fontFamily: "DM Mono" }}>Files will be saved as: Veterinary - Buthe - YYYY-MM-DD</small>
            </div>
            <div style={{ maxHeight: 160, overflowY: "auto", marginBottom: 12 }}>
              {rows.map((row) => (
                <div key={row.id} style={{ display: "flex", justifyContent: "space-between", padding: "4px 0" }}>
                  <span>{row.file.name}</span>
                  <small>{formatFileSize(row.file.size)}</small>
                </div>
              ))}
            </div>
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button type="button" className="secondary" onClick={onClose}>Cancel</button>
              <button type="button" onClick={onConfirm}>Confirm & Upload</button>
            </div>
          </div>
        ) : null}

        {step === 3 ? (
          <div>
            <div style={{ maxHeight: 320, overflowY: "auto", display: "grid", gap: 8 }}>
              {rows.map((row) => (
                <UploadStatusRow key={row.id} row={row} onRetry={() => onRetry(row)} />
              ))}
            </div>
            {allTerminal ? (
              <div style={{ marginTop: 12, display: "flex", justifyContent: "flex-end" }}>
                <button type="button" onClick={onClose}>View All Invoices</button>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function UploadStatusRow({ row, onRetry }: { row: UploadRow; onRetry: () => void }) {
  const liveBill = useQuery(api.bills.getBillById, row.billId ? { billId: row.billId as never } : "skip");
  const status = liveBill?.status ?? row.localStatus;
  const isError = status === "error" || row.localStatus === "error";
  const errorMessage = row.localError || liveBill?.errorMessage;

  return (
    <div className="panel" style={{ padding: "10px 12px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start", gap: 10 }}>
        <div>
          <div style={{ fontWeight: 600 }}>{row.file.name}</div>
          <small>{formatFileSize(row.file.size)}</small>
        </div>
        <div style={{ textAlign: "right", fontFamily: "DM Mono", fontSize: 11 }}>
          {status === "uploading" ? "Uploading..." : null}
          {status === "parsing" ? "Parsing..." : null}
          {status === "done" ? "Done ✓" : null}
          {status === "error" ? "Error ✗" : null}
          {isError ? (
            <div>
              <button type="button" className="secondary" onClick={onRetry} style={{ marginTop: 4 }}>Retry</button>
            </div>
          ) : null}
        </div>
      </div>
      {errorMessage ? <small style={{ color: "#B91C1C" }}>{errorMessage}</small> : null}
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
  if (typeof extracted.invoice_total_usd === "number" && Number.isFinite(extracted.invoice_total_usd)) {
    return extracted.invoice_total_usd;
  }
  return lineItems.reduce((sum, item) => sum + getLineTotalUsd(item), 0);
}

function aggregateBySubcategory(lineItems: ParsedLineItem[]) {
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

function formatFileSize(size: number) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function truncate(value: string, max: number) {
  if (value.length <= max) return value;
  return `${value.slice(0, max - 1)}…`;
}
