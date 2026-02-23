"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";

type ParsedLineItem = {
  date?: string;
  description?: string;
  vet_subcategory?: string;
  horse_name?: string;
  total_usd?: number;
};

type ParsedInvoice = {
  invoice_number?: string;
  invoice_total_usd?: number;
  line_items?: ParsedLineItem[];
};

const SUBCATEGORY_COLORS: Record<string, string> = {
  "Travel Cost": "#ce6f2d",
  "Physical Exam": "#4a7c59",
  Radiograph: "#6f58c9",
  Sedation: "#9775fa",
  "Joint Injection": "#d9480f",
  Ultrasound: "#0b7285",
  MRI: "#1864ab",
  Vaccine: "#0D7A5F",
  Medication: "#2b8a3e",
  Labs: "#9c36b5",
  Other: "#6b705c"
};

export default function ReportsPage() {
  const bills: any[] = useQuery(api.bills.listAll) ?? [];
  const [selectedBillId, setSelectedBillId] = useState<string>("");

  const vetBills = useMemo(
    () =>
      bills.filter((bill: any) => {
        const extracted = bill.extractedData as ParsedInvoice | undefined;
        return (
          bill.categoryName === "Veterinary" &&
          bill.status === "done" &&
          Array.isArray(extracted?.line_items) &&
          extracted.line_items.length > 0
        );
      }),
    [bills]
  );

  useEffect(() => {
    if (!selectedBillId && vetBills[0]) {
      setSelectedBillId(vetBills[0]._id);
      return;
    }
    if (selectedBillId && !vetBills.some((bill: any) => bill._id === selectedBillId)) {
      setSelectedBillId("");
    }
  }, [selectedBillId, vetBills]);

  const selectedBill = vetBills.find((bill: any) => bill._id === selectedBillId);
  const extracted = (selectedBill?.extractedData ?? {}) as ParsedInvoice;
  const lineItems = useMemo(() => sanitizeLineItems(extracted.line_items), [extracted.line_items]);

  const invoiceTotal = useMemo(() => {
    if (typeof extracted.invoice_total_usd === "number" && Number.isFinite(extracted.invoice_total_usd) && extracted.invoice_total_usd > 0) {
      return extracted.invoice_total_usd;
    }
    return lineItems.reduce((sum, item) => sum + getTotalUsd(item), 0);
  }, [extracted.invoice_total_usd, lineItems]);

  const horses = useMemo(() => {
    const map = new Map<string, ParsedLineItem[]>();
    for (const item of lineItems) {
      const horse = item.horse_name?.trim() || "Unassigned";
      const bucket = map.get(horse) ?? [];
      bucket.push(item);
      map.set(horse, bucket);
    }

    return [...map.entries()]
      .map(([horseName, items]) => ({
        horseName,
        items,
        subtotal: items.reduce((sum, item) => sum + getTotalUsd(item), 0)
      }))
      .sort((a, b) => b.subtotal - a.subtotal);
  }, [lineItems]);

  const hasMultipleHorses = horses.length > 1;

  const subcategorySummary = useMemo(() => {
    const totals = new Map<string, number>();
    for (const item of lineItems) {
      const subcategory = item.vet_subcategory?.trim() || "Other";
      totals.set(subcategory, (totals.get(subcategory) ?? 0) + getTotalUsd(item));
    }

    return [...totals.entries()]
      .map(([subcategory, total]) => ({
        subcategory,
        total,
        pctOfInvoice: invoiceTotal > 0 ? (total / invoiceTotal) * 100 : 0
      }))
      .sort((a, b) => b.total - a.total);
  }, [invoiceTotal, lineItems]);

  return (
    <section className="panel">
      <h1>Veterinary Bill Report</h1>
      <p>
        <small>Derived from parsed Convex bill data. Displayed in USD.</small>
      </p>

      <div className="grid" style={{ marginBottom: 16 }}>
        <div>
          <label htmlFor="bill">Invoice</label>
          <select id="bill" value={selectedBillId} onChange={(e) => setSelectedBillId(e.target.value)}>
            <option value="">Select a veterinary bill</option>
            {vetBills.map((bill: any) => {
              const invoice = bill.extractedData as ParsedInvoice;
              const invoiceLabel = invoice.invoice_number ? `Invoice ${invoice.invoice_number}` : "Invoice";
              return (
                <option key={bill._id} value={bill._id}>
                  {`${invoiceLabel} · ${bill.providerName} · ${bill.billingPeriod}`}
                </option>
              );
            })}
          </select>
        </div>
      </div>

      {!selectedBill ? (
        <div className="panel">
          <small>Select a parsed veterinary invoice to view report details.</small>
        </div>
      ) : (
        <>
          <div className="panel" style={{ marginBottom: 16 }}>
            <h3 style={{ marginTop: 0 }}>Subcategory as % of Invoice Total</h3>
            {hasMultipleHorses ? <small>Across all horses on this invoice.</small> : null}
            <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
              {subcategorySummary.map((row) => (
                <div key={row.subcategory}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                    <strong>{row.subcategory}</strong>
                    <span>
                      {fmtUSD(row.total)} ({formatPct(row.pctOfInvoice)})
                    </span>
                  </div>
                  <ProgressBar color={SUBCATEGORY_COLORS[row.subcategory] ?? SUBCATEGORY_COLORS.Other} pct={row.pctOfInvoice} />
                </div>
              ))}
            </div>
          </div>

          {horses.map((horse) => {
            const horsePctOfInvoice = invoiceTotal > 0 ? (horse.subtotal / invoiceTotal) * 100 : 0;
            return (
              <div className="panel" style={{ marginBottom: 16 }} key={horse.horseName}>
                <h3 style={{ marginTop: 0 }}>
                  {horse.horseName}
                  {hasMultipleHorses ? <small style={{ marginLeft: 8 }}>{formatPct(horsePctOfInvoice)} of invoice</small> : null}
                </h3>
                <p>
                  <small>Horse subtotal: {fmtUSD(horse.subtotal)}</small>
                </p>

                <div className="panel" style={{ marginBottom: 12 }}>
                  <h4 style={{ marginTop: 0 }}>Each Fee as % of Horse Total</h4>
                  <div style={{ display: "grid", gap: 8 }}>
                    {horse.items.map((item, idx) => {
                      const amount = getTotalUsd(item);
                      const pctOfHorse = horse.subtotal > 0 ? (amount / horse.subtotal) * 100 : 0;
                      const subcategory = item.vet_subcategory?.trim() || "Other";
                      const color = SUBCATEGORY_COLORS[subcategory] ?? SUBCATEGORY_COLORS.Other;

                      return (
                        <div key={`${horse.horseName}-${item.description ?? "item"}-${idx}`}>
                          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4, gap: 8 }}>
                            <div>
                              <strong>{item.description || "(No description)"}</strong>
                              <span
                                style={{
                                  marginLeft: 8,
                                  background: `${color}22`,
                                  border: `1px solid ${color}`,
                                  color,
                                  borderRadius: 999,
                                  fontSize: 12,
                                  padding: "2px 8px"
                                }}
                              >
                                {subcategory}
                              </span>
                            </div>
                            <span>
                              {fmtUSD(amount)} ({formatPct(pctOfHorse)})
                            </span>
                          </div>
                          <ProgressBar color={color} pct={pctOfHorse} />
                        </div>
                      );
                    })}
                  </div>
                </div>

                <table>
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Description</th>
                      <th>Subcategory</th>
                      <th>Amount (USD)</th>
                      <th>% of horse</th>
                    </tr>
                  </thead>
                  <tbody>
                    {horse.items.map((item, idx) => {
                      const amount = getTotalUsd(item);
                      const pctOfHorse = horse.subtotal > 0 ? (amount / horse.subtotal) * 100 : 0;
                      const subcategory = item.vet_subcategory?.trim() || "Other";
                      const color = SUBCATEGORY_COLORS[subcategory] ?? SUBCATEGORY_COLORS.Other;

                      return (
                        <tr key={`${horse.horseName}-row-${item.description ?? "item"}-${idx}`}>
                          <td>{item.date ?? "-"}</td>
                          <td>{item.description ?? "-"}</td>
                          <td>
                            <span
                              style={{
                                background: `${color}22`,
                                border: `1px solid ${color}`,
                                color,
                                borderRadius: 999,
                                fontSize: 12,
                                padding: "2px 8px"
                              }}
                            >
                              {subcategory}
                            </span>
                          </td>
                          <td>{fmtUSD(amount)}</td>
                          <td>{formatPct(pctOfHorse)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            );
          })}
        </>
      )}
    </section>
  );
}

function sanitizeLineItems(value: ParsedInvoice["line_items"]): ParsedLineItem[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item) => item && typeof item === "object");
}

function getTotalUsd(item: ParsedLineItem): number {
  return typeof item.total_usd === "number" && Number.isFinite(item.total_usd) ? item.total_usd : 0;
}

function formatPct(value: number): string {
  return `${value.toFixed(1)}%`;
}

function fmtUSD(v: number): string {
  return `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function ProgressBar({ color, pct }: { color: string; pct: number }) {
  return (
    <div
      style={{
        width: "100%",
        height: 10,
        borderRadius: 999,
        border: "1px solid var(--line)",
        overflow: "hidden",
        background: "#fff"
      }}
    >
      <div
        style={{
          width: `${Math.max(0, Math.min(100, pct))}%`,
          height: "100%",
          background: color,
          transition: "width 200ms ease"
        }}
      />
    </div>
  );
}
