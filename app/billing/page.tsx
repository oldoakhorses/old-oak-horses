"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
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
  const abs = Math.abs(amount);
  const formatted = `$${abs.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  return amount < 0 ? `(${formatted})` : formatted;
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
  const rows: Array<{ details: string; postingDate: string; description: string; amount: number; type: string; balance?: number }> = [];
  for (let i = 1; i < lines.length; i++) {
    const fields: string[] = [];
    let current = "";
    let inQuotes = false;
    for (const char of lines[i]) {
      if (char === '"') inQuotes = !inQuotes;
      else if (char === "," && !inQuotes) { fields.push(current.trim()); current = ""; }
      else current += char;
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

function defaultStartDate() {
  const d = new Date();
  d.setDate(1);
  return d.toISOString().slice(0, 10);
}
function defaultEndDate() {
  return new Date().toISOString().slice(0, 10);
}
function dateToPeriod(dateStr: string) {
  return dateStr ? dateStr.slice(0, 7) : new Date().toISOString().slice(0, 7);
}

export default function BillingPage() {
  const router = useRouter();

  // ── Section 1: CC statements ────────────────────────────────────────
  const statements = useQuery(api.ccReconcile.listStatements) ?? [];
  const uploadStatement = useMutation(api.ccReconcile.uploadStatement);
  const deleteStatement = useMutation(api.ccReconcile.deleteStatement);
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

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

  async function handleDeleteStatement(e: React.MouseEvent, statementId: Id<"ccStatements">, name: string) {
    e.preventDefault();
    e.stopPropagation();
    if (!confirm(`Delete statement "${name}" and all its transactions? This cannot be undone.`)) return;
    await deleteStatement({ statementId });
  }

  // ── Section 2: Create new invoice ───────────────────────────────────
  const owners = useQuery(api.owners.list) ?? [];
  const createInvoice = useMutation(api.billing.createOwnerInvoiceForOwner);
  const [startDate, setStartDate] = useState(defaultStartDate);
  const [endDate, setEndDate] = useState(defaultEndDate);
  const [selectedOwnerId, setSelectedOwnerId] = useState<string>("");
  const [creating, setCreating] = useState(false);

  async function handleCreate(mode: "autofill" | "blank") {
    if (!selectedOwnerId || !startDate) return;
    setCreating(true);
    try {
      const billingPeriod = dateToPeriod(startDate);
      const newId = await createInvoice({
        ownerId: selectedOwnerId as Id<"owners">,
        billingPeriod,
        startDate,
        endDate: endDate || startDate,
        mode,
      });
      router.push(`/billing/${newId}`);
    } catch (err) {
      console.error("Create invoice error:", err);
      alert("Failed to create invoice");
    } finally {
      setCreating(false);
    }
  }

  // ── Section 3: Manage invoices ──────────────────────────────────────
  const allInvoices = useQuery(api.billing.listOwnerInvoices, {}) ?? [];
  const updateStatus = useMutation(api.billing.updateOwnerInvoiceStatus);
  const deleteInvoice = useMutation(api.billing.deleteOwnerInvoice);
  const [manageFilter, setManageFilter] = useState<"all" | "draft" | "sent">("all");

  const filteredInvoices = allInvoices.filter((inv) => {
    if (manageFilter === "all") return true;
    if (manageFilter === "draft") return inv.status === "draft" || inv.status === "finalized";
    if (manageFilter === "sent") return inv.status === "sent" || inv.status === "paid";
    return true;
  });

  async function handleMarkSent(e: React.MouseEvent, invoiceId: Id<"ownerInvoices">) {
    e.preventDefault();
    e.stopPropagation();
    await updateStatus({ ownerInvoiceId: invoiceId, status: "sent" });
  }

  async function handleDeleteInvoice(e: React.MouseEvent, invoiceId: Id<"ownerInvoices">, name: string) {
    e.preventDefault();
    e.stopPropagation();
    if (!confirm(`Delete invoice "${name}"? This cannot be undone.`)) return;
    await deleteInvoice({ ownerInvoiceId: invoiceId });
  }

  return (
    <div className="page-shell">
      <NavBar items={[{ label: "billing" }]} />
      <main className="page-content">
        <div className={styles.headerRow}>
          <h1 className={styles.title}>billing</h1>
        </div>

        {/* ── 1. Upload CC statements ─────────────────────────────────── */}
        <div className={styles.sectionCard}>
          <div className={styles.sectionHeader}>
            <div>
              <div className={styles.sectionTitle}>1. credit card statements</div>
              <div className={styles.sectionSub}>upload, review, and approve line items from CSV bank statements</div>
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
                const displayName = stmt.displayName ?? (stmt.accountLast4 ? `•••• ${stmt.accountLast4}` : stmt.fileName);
                return (
                  <div key={stmt._id} className={styles.stmtRow}>
                    <Link href={`/billing/statement/${stmt._id}`} className={styles.stmtInfo}>
                      <div className={styles.stmtName}>{displayName}</div>
                      <div className={styles.stmtMeta}>
                        {stmt.transactionCount} transactions &middot; uploaded {fmtDate(stmt.uploadedAt)}
                      </div>
                    </Link>
                    <div className={styles.stmtStats}>
                      <span className={styles.stmtMatched}>{stmt.matchedCount} matched</span>
                      <span className={styles.stmtUnmatched}>{stmt.unmatchedCount} unmatched</span>
                    </div>
                    <div className={styles.stmtAmount}>{fmtUSD(stmt.totalDebits)}</div>
                    <span className={styles.statusBadge} style={{ color: si.color, background: si.bg }}>
                      {si.label}
                    </span>
                    <Link href={`/billing/statement/${stmt._id}`} className={styles.rowActionLink}>
                      manage
                    </Link>
                    <button
                      type="button"
                      className={styles.rowActionDelete}
                      onClick={(e) => handleDeleteStatement(e, stmt._id, displayName)}
                    >
                      delete
                    </button>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className={styles.stmtEmpty}>no statements uploaded yet</div>
          )}
        </div>

        {/* ── 2. Create new invoice ──────────────────────────────────── */}
        <div className={styles.sectionCard}>
          <div className={styles.sectionHeader}>
            <div>
              <div className={styles.sectionTitle}>2. create new invoice</div>
              <div className={styles.sectionSub}>pick a date range and an owner, then choose autofill or start blank</div>
            </div>
          </div>

          <div className={styles.createForm}>
            <div className={styles.createField}>
              <span className={styles.dateLabel}>FROM</span>
              <input type="date" className={styles.dateInput} value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </div>
            <div className={styles.createField}>
              <span className={styles.dateLabel}>TO</span>
              <input type="date" className={styles.dateInput} value={endDate} onChange={(e) => setEndDate(e.target.value)} />
            </div>
            <div className={styles.createField}>
              <span className={styles.dateLabel}>OWNER</span>
              <select
                className={styles.ownerSelect}
                value={selectedOwnerId}
                onChange={(e) => setSelectedOwnerId(e.target.value)}
              >
                <option value="">select owner…</option>
                {owners.map((o) => (
                  <option key={o._id} value={o._id}>{o.name}</option>
                ))}
              </select>
            </div>
            <div className={styles.createActions}>
              <button
                type="button"
                className={styles.btnAutofill}
                onClick={() => handleCreate("autofill")}
                disabled={!selectedOwnerId || !startDate || creating}
              >
                {creating ? "creating…" : "autofill"}
              </button>
              <button
                type="button"
                className={styles.btnBlank}
                onClick={() => handleCreate("blank")}
                disabled={!selectedOwnerId || !startDate || creating}
              >
                start blank
              </button>
            </div>
          </div>
          <div className={styles.createHint}>
            <strong>autofill</strong> pulls every approved bill assigned to this owner&apos;s horses in the date range. <strong>start blank</strong> creates an empty invoice. you can add manual line items either way.
          </div>
        </div>

        {/* ── 3. Manage invoices ─────────────────────────────────────── */}
        <div className={styles.sectionCard}>
          <div className={styles.sectionHeader}>
            <div>
              <div className={styles.sectionTitle}>3. manage invoices</div>
              <div className={styles.sectionSub}>edit drafts, mark sent, or delete</div>
            </div>
            <div className={styles.tabRow}>
              {(["all", "draft", "sent"] as const).map((key) => (
                <button
                  key={key}
                  type="button"
                  className={`${styles.tabBtn} ${manageFilter === key ? styles.tabBtnActive : ""}`}
                  onClick={() => setManageFilter(key)}
                >
                  {key}
                </button>
              ))}
            </div>
          </div>

          {filteredInvoices.length > 0 ? (
            <div className={styles.invoicesList}>
              <div className={styles.listHeader}>
                <div>OWNER</div>
                <div>PERIOD</div>
                <div>ITEMS</div>
                <div>TOTAL</div>
                <div>STATUS</div>
                <div>ACTIONS</div>
              </div>
              {filteredInvoices.map((inv) => {
                const statusInfo = STATUS_LABELS[inv.status] ?? STATUS_LABELS.draft;
                const isSent = inv.status === "sent" || inv.status === "paid";
                return (
                  <div key={inv._id} className={styles.invoiceRow}>
                    <Link href={`/billing/${inv._id}`} className={styles.invoiceOwner}>
                      {inv.ownerName}
                    </Link>
                    <div className={styles.invoicePeriod}>{fmtPeriod(inv.billingPeriod)}</div>
                    <div className={styles.invoiceMeta}>{inv.lineItemCount}</div>
                    <div className={styles.invoiceTotal}>{fmtUSD(inv.totalAmount)}</div>
                    <div>
                      <span className={styles.statusBadge} style={{ color: statusInfo.color, background: statusInfo.bg }}>
                        {statusInfo.label}
                      </span>
                    </div>
                    <div className={styles.rowActions}>
                      <Link href={`/billing/${inv._id}`} className={styles.rowActionLink}>
                        {isSent ? "view" : "edit"}
                      </Link>
                      {!isSent ? (
                        <button
                          type="button"
                          className={styles.rowActionSent}
                          onClick={(e) => handleMarkSent(e, inv._id)}
                        >
                          mark sent
                        </button>
                      ) : null}
                      <button
                        type="button"
                        className={styles.rowActionDelete}
                        onClick={(e) => handleDeleteInvoice(e, inv._id, inv.ownerName)}
                      >
                        delete
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className={styles.stmtEmpty}>no invoices in this view</div>
          )}
        </div>
      </main>
    </div>
  );
}
