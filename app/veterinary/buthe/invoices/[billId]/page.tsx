"use client";

import Link from "next/link";
import { useMemo } from "react";
import { useQuery } from "convex/react";
import { useParams } from "next/navigation";
import { api } from "@/convex/_generated/api";

type LineItem = {
  date?: string;
  description?: string;
  horse_name?: string;
  vet_subcategory?: string;
  fee_type?: string;
  total_usd?: number;
};

type Extracted = {
  invoice_number?: string;
  invoice_date?: string;
  invoice_total_usd?: number;
  line_items?: LineItem[];
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

export default function ButheInvoicePage() {
  const params = useParams<{ billId: string }>();
  const bill = useQuery(api.bills.getBillById, params?.billId ? { billId: params.billId as never } : "skip");

  const extracted = (bill?.extractedData ?? {}) as Extracted;
  const lineItems = useMemo(() => (Array.isArray(extracted.line_items) ? extracted.line_items : []), [extracted.line_items]);

  const total = useMemo(() => {
    if (typeof extracted.invoice_total_usd === "number") return extracted.invoice_total_usd;
    return lineItems.reduce((sum, item) => sum + getAmountUsd(item), 0);
  }, [extracted.invoice_total_usd, lineItems]);

  const byHorse = useMemo(() => {
    const map = new Map<string, LineItem[]>();
    for (const item of lineItems) {
      const horse = item.horse_name?.trim() || "Unassigned";
      map.set(horse, [...(map.get(horse) ?? []), item]);
    }
    return [...map.entries()].map(([horseName, items]) => ({
      horseName,
      items,
      subtotal: items.reduce((sum, item) => sum + getAmountUsd(item), 0)
    }));
  }, [lineItems]);

  return (
    <div style={{ maxWidth: 1040, margin: "0 auto", padding: "36px 24px" }}>
      <div
        style={{
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
          <Link href="/veterinary/buthe" style={{ color: "#888" }}>
            Buthe
          </Link>
          <span style={{ color: "#444" }}>/</span>
          <span style={{ color: "#fff" }}>Invoice</span>
        </div>
      </div>

      <section className="card" style={{ marginTop: 20 }}>
        <div className="section-label">Veterinary Invoice</div>
        <h1 style={{ fontFamily: "Playfair Display", margin: "0 0 6px" }}>
          {extracted.invoice_number ? `Invoice ${extracted.invoice_number}` : "Invoice"}
        </h1>
        <p style={{ margin: 0, color: "#666", fontFamily: "DM Mono" }}>{extracted.invoice_date ?? "-"}</p>
        <div style={{ marginTop: 12, fontFamily: "Playfair Display", fontSize: 36 }}>{fmtUSD(total)}</div>
      </section>

      {byHorse.map((horse) => (
        <section key={horse.horseName} className="card">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div
                style={{
                  width: 38,
                  height: 38,
                  borderRadius: 999,
                  background: "#1C1C1C",
                  color: "#fff",
                  display: "grid",
                  placeItems: "center"
                }}
              >
                🐎
              </div>
              <div>
                <h3 style={{ margin: 0, fontFamily: "Playfair Display", fontSize: 24 }}>{horse.horseName}</h3>
                <small>{horse.items.length} items</small>
              </div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div className="section-label">Horse Subtotal</div>
              <div style={{ fontFamily: "Playfair Display", fontSize: 28 }}>{fmtUSD(horse.subtotal)}</div>
            </div>
          </div>

          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Description</th>
                <th>Subcategory</th>
                <th>Fee Type</th>
                <th style={{ textAlign: "right" }}>Amount</th>
              </tr>
            </thead>
            <tbody>
              {horse.items.map((item, idx) => {
                const subcategory = item.vet_subcategory?.trim() || "Other";
                const color = subcategoryColors[subcategory] ?? subcategoryColors.Other;
                return (
                  <tr key={`${horse.horseName}-${idx}`}>
                    <td>{item.date ?? "-"}</td>
                    <td>{item.description ?? "-"}</td>
                    <td>
                      <span
                        style={{
                          borderRadius: 999,
                          padding: "3px 10px",
                          background: color.bg,
                          color: color.text,
                          fontSize: 11,
                          fontWeight: 600
                        }}
                      >
                        {subcategory}
                      </span>
                    </td>
                    <td>{item.fee_type ?? "-"}</td>
                    <td style={{ textAlign: "right", fontFamily: "DM Mono" }}>{fmtUSD(getAmountUsd(item))}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      ))}

      <div
        style={{
          marginTop: 12,
          textAlign: "center",
          fontFamily: "DM Mono",
          fontSize: 11,
          color: "#CCC"
        }}
      >
        OLD OAK HORSES · VETERINARY · BUTHE
      </div>
    </div>
  );
}

function getAmountUsd(item: LineItem) {
  return typeof item.total_usd === "number" && Number.isFinite(item.total_usd) ? item.total_usd : 0;
}

function fmtUSD(v: number) {
  return `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
