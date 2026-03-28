"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import NavBar from "@/components/NavBar";
import styles from "./billing.module.css";

const STATUS_LABELS: Record<string, { label: string; color: string; bg: string }> = {
  draft: { label: "DRAFT", color: "#F59E0B", bg: "rgba(245,158,11,0.1)" },
  finalized: { label: "FINALIZED", color: "#4A5BDB", bg: "rgba(74,91,219,0.1)" },
  sent: { label: "SENT", color: "#14B8A6", bg: "rgba(20,184,166,0.1)" },
  paid: { label: "PAID", color: "#22C583", bg: "rgba(34,197,131,0.1)" },
};

const STMT_STATUS: Record<string, { label: string; color: string; bg: string }> = {
  uploaded: { label: "UPLOADED", color: "#6B7084", bg: "rgba(107,112,132,0.1)" },
  matching: { label: "MATCHING", color: "#F59E0B", bg: "rgba(245,158,11,0.1)" },
  review: { label: "IN REVIEW", color: "#4A5BDB", bg: "rgba(74,91,219,0.1)" },
  approved: { label: "APPROVED", color: "#22C583", bg: "rgba(34,197,131,0.1)" },
};

function fmtUSD(amount: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(amount);
}

function fmtPeriod(period: string) {
  const [y, m] = period.split("-");
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${months[Number(m) - 1]} ${y}`;
}

function fmtDate(ts: number) {
  return new Date(ts).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function parseCSV(text: string): Array<{ details: string; postingDate: string; description: string; amount: number; type: string; balance?: number }> {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  if (lines.length < 2) return [];

  // Skip header
  const rows: Array<{ details: string; postingDate: string; description: string; amount: number; type: string; balance?: number }> = [];

  for (let i = 1; i < lines.length; i++) {
    // Parse CSV properly handling quoted fields
    const fields: string[] = [];
    let current = "";
    let inQuotes = false;
    for (const char of lines[i]) {
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === "," && !inQuotes) {
        fields.push(current.trim());
        current = "";
      } else {
        current += char;
      }
    }
    fields.push(current.trim());

    if (fields.length < 5) continue;

    const amount = parseFloat(fields[3]);
    if (isNaN(amount)) continue;

    const balance = fields[5] ? parseFloat(fields[5]) : undefined;

    rows.push({
      details: fields[0],
      postingDate: fields[1],
      description: fields[2],
      amount,
      type: fields[4],
      balance: balance && !isNaN(balance) ? balance : undefined,
    });
  }

  return rows;
}

export default function BillingPage() {
  const periods = useQuery(api.billing.getAvailablePeriods) ?? [];
  const [selectedPeriod, setSelectedPeriod] = useState("");
  const activePeriod = selectedPeriod || (periods.length > 0 ? periods[0] : "");

  const invoices = useQuery(api.billing.listOwnerInvoices, activePeriod ? { billingPeriod: activePeriod } : {}) ?? [];
  const preview = useQuery(api.billing.previewBillingPeriod, activePeriod ? { billingPeriod: activePeriod } : "skip");
  const generateInvoices = useMutation(api.billing.generateOwnerInvoices);
  const [generating, setGenerating] = useState(false);

  // CC Statements
  const statements = useQuery(api.ccReconcile.listStatements) ?? [];
  const uploadStatement = useMutation(api.ccReconcile.uploadStatement);
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  async function handleGenerate() {
    if (!activePeriod) return;
    setGenerating(true);
    try {
      await generateInvoices({ billingPeriod: activePeriod });
    } finally {
      setGenerating(false);
    }
  }

  async function handleCSVUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const text = await file.text();
      const rows = parseCSV(text);
      if (rows.length === 0) {
        alert("No valid transactions found in CSV");
        return;
      }
      await uploadStatement({ fileName: file.name, csvRows: rows });
    } catch (err) {
      console.error("Upload error:", err);
      alert("Failed to upload statement");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  const hasUnbilledItems = preview?.some((p) => !p.alreadyBilled && p.lineItemCount > 0);

  return (
    <div className="page-shell">
      <NavBar items={[{ label: "billing" }]} />
      <main className="page-content">
        <div className={styles.headerRow}>
          <h1 className={styles.title}>billing</h1>
        </div>

        {/* CC Statement Upload Section */}
        <div className={styles.sectionCard}>
          <div className={styles.sectionHeader}>
            <div>
              <div className={styles.sectionTitle}>credit card statements</div>
              <div className={styles.sectionSub}>upload a CSV bank statement to reconcile charges with invoices</div>
            </div>
            <label className={styles.btnUpload}>
              {uploading ? "uploading..." : "upload CSV"}
              <input
                ref={fileRef}
                type="file"
                accept=".csv"
                style={{ display: "none" }}
                onChange={handleCSVUpload}
                disabled={uploading}
              />
            </label>
          </div>

          {statements.length > 0 ? (
            <div className={styles.stmtList}>
              {statements.map((stmt) => {
                const si = STMT_STATUS[stmt.status] ?? STMT_STATUS.uploaded;
                return (
                  <Link key={stmt._id} href={`/billing/statement/${stmt._id}`} className={styles.stmtRow}>
                    <div className={styles.stmtInfo}>
                      <div className={styles.stmtName}>
                        {stmt.accountLast4 ? `•••• ${stmt.accountLast4}` : stmt.fileName}
                      </div>
                      <div className={styles.stmtMeta}>
                        {stmt.transactionCount} transactions &middot; uploaded {fmtDate(stmt.uploadedAt)}
                      </div>
                    </div>
                    <div className={styles.stmtStats}>
                      <span className={styles.stmtMatched}>{stmt.matchedCount} matched</span>
                      <span className={styles.stmtUnmatched}>{stmt.unmatchedCount} unmatched</span>
                    </div>
                    <div className={styles.stmtAmount}>{fmtUSD(stmt.totalDebits)}</div>
                    <span className={styles.statusBadge} style={{ color: si.color, background: si.bg }}>
                      {si.label}
                    </span>
                  </Link>
                );
              })}
            </div>
          ) : (
            <div className={styles.stmtEmpty}>no statements uploaded yet</div>
          )}
        </div>

        {/* Divider */}
        <div className={styles.divider} />

        {/* Owner invoices section */}
        <div className={styles.sectionCard}>
          <div className={styles.sectionHeader}>
            <div>
              <div className={styles.sectionTitle}>owner invoices</div>
              <div className={styles.sectionSub}>batch approved invoice line items by owner</div>
            </div>
          </div>
        </div>

        {/* Period selector */}
        <div className={styles.periodRow}>
          <label className={styles.periodLabel}>BILLING PERIOD</label>
          <select
            className={styles.periodSelect}
            value={activePeriod}
            onChange={(e) => setSelectedPeriod(e.target.value)}
          >
            {periods.map((p) => (
              <option key={p} value={p}>{fmtPeriod(p)}</option>
            ))}
          </select>
          {hasUnbilledItems ? (
            <button
              type="button"
              className={styles.btnGenerate}
              onClick={handleGenerate}
              disabled={generating}
            >
              {generating ? "generating..." : "generate owner invoices"}
            </button>
          ) : null}
        </div>

        {/* Preview of what would be generated */}
        {preview && preview.length > 0 && invoices.length === 0 ? (
          <div className={styles.previewCard}>
            <div className={styles.previewTitle}>preview for {fmtPeriod(activePeriod)}</div>
            <div className={styles.previewSub}>
              These are the approved invoices ready to be batched into owner invoices.
            </div>
            {preview.map((row) => (
              <div key={row.ownerId} className={styles.previewRow}>
                <div className={styles.previewOwner}>{row.ownerName}</div>
                <div className={styles.previewMeta}>
                  {row.horseCount} horse{row.horseCount !== 1 ? "s" : ""} &middot; {row.lineItemCount} line item{row.lineItemCount !== 1 ? "s" : ""}
                </div>
                <div className={styles.previewAmount}>{fmtUSD(row.total)}</div>
              </div>
            ))}
          </div>
        ) : null}

        {/* Existing owner invoices */}
        {invoices.length > 0 ? (
          <div className={styles.invoicesList}>
            <div className={styles.listHeader}>
              <div>OWNER</div>
              <div>PERIOD</div>
              <div>LINE ITEMS</div>
              <div>APPROVED</div>
              <div>TOTAL</div>
              <div>STATUS</div>
            </div>
            {invoices.map((inv) => {
              const statusInfo = STATUS_LABELS[inv.status] ?? STATUS_LABELS.draft;
              return (
                <Link key={inv._id} href={`/billing/${inv._id}`} className={styles.invoiceRow}>
                  <div className={styles.invoiceOwner}>{inv.ownerName}</div>
                  <div className={styles.invoicePeriod}>{fmtPeriod(inv.billingPeriod)}</div>
                  <div className={styles.invoiceMeta}>{inv.lineItemCount}</div>
                  <div className={styles.invoiceMeta}>
                    {inv.approvedLineItemCount}/{inv.lineItemCount}
                  </div>
                  <div className={styles.invoiceTotal}>{fmtUSD(inv.totalAmount)}</div>
                  <div>
                    <span className={styles.statusBadge} style={{ color: statusInfo.color, background: statusInfo.bg }}>
                      {statusInfo.label}
                    </span>
                  </div>
                </Link>
              );
            })}
          </div>
        ) : activePeriod && (!preview || preview.length === 0) ? (
          <div className={styles.emptyState}>
            <div className={styles.emptyTitle}>no billing data for {fmtPeriod(activePeriod)}</div>
            <div className={styles.emptySub}>
              approve invoices for this period first, then generate owner invoices
            </div>
          </div>
        ) : null}
      </main>
    </div>
  );
}
