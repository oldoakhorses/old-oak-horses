"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useAuth } from "@/contexts/AuthContext";
import NavBar from "@/components/NavBar";
import { formatInvoiceFileName, formatInvoiceName } from "@/lib/formatInvoiceName";
import styles from "./invoices.module.css";

type SortMode = "date" | "amount" | "name-asc" | "name-desc";

const SORT_LABELS: Record<SortMode, string> = {
  date: "date",
  amount: "amount",
  "name-asc": "name a–z",
  "name-desc": "name z–a",
};

/** Clean up raw CC descriptions and ALL-CAPS names into readable abbreviated titles */
function abbreviateInvoiceName(name: string, maxLen = 50): string {
  if (!name) return name;
  // Remove common CC noise prefixes/suffixes
  let cleaned = name
    .replace(/\b(ORIG CO NAME:|ORIG ID:\S+|DESC DATE:\S+|CO ENTRY DESCR?:\S+|SEC:\S+|TRACE#?:\S+|EED:\S+|IND ID:\S+|IND NAME:\S+|TRN:\S+|CCD|PPD)\b/gi, "")
    .replace(/\b(CHIPS CREDIT VIA:.*?B\/O:\s*)/gi, "")
    .replace(/\b(C\/O\s+\w+\s+\w+\s+\w+)/gi, "")
    .replace(/\b(REF:\s*NBNF=\S+)/gi, "")
    .replace(/\b(US\/AC-\S+|ORG=\/\S+|OGB=\S+|OBI=\/\S+)/gi, "")
    .replace(/\bSSN:\s*\S+/gi, "")
    .replace(/\b(UNITED STATES OF AM\s*ERICA|UNITED STATES)\b/gi, "")
    .replace(/\b(THE\)|THE)\b/gi, "")
    .replace(/\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/g, "") // phone numbers
    .replace(/\b\d{5,}\b/g, "") // long numeric codes
    .replace(/\b[A-Z]{2}\s+\d{5}\b/g, "") // state + zip (e.g., "FL 33071")
    .replace(/\s{2,}/g, " ")
    .trim();

  // Convert to title case if all caps
  if (cleaned === cleaned.toUpperCase() && cleaned.length > 3) {
    cleaned = cleaned
      .toLowerCase()
      .split(" ")
      .filter(Boolean)
      .map((word) => {
        // Keep short words like "of", "and", "the" lowercase unless first
        if (["of", "and", "the", "in", "at", "to", "for", "on", "by", "or"].includes(word)) return word;
        // Keep common abbreviations uppercase
        if (["llc", "inc", "usa", "ca", "fl", "ny", "tx"].includes(word)) return word.toUpperCase();
        return word.charAt(0).toUpperCase() + word.slice(1);
      })
      .join(" ");
    // Capitalize first word always
    if (cleaned.length > 0) {
      cleaned = cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
    }
  }

  // Remove trailing location codes like "FL 03/25" or "CA 03/02"
  cleaned = cleaned.replace(/\s+[A-Za-z]{2}\s+\d{2}\/\d{2}\s*$/, "");

  // Truncate if still too long
  if (cleaned.length > maxLen) {
    cleaned = cleaned.slice(0, maxLen - 1).trim() + "…";
  }

  return cleaned || name;
}

/** Categories where money comes IN (income) — amounts shown as positive */
const INCOME_CATEGORIES = new Set(["prize-money", "prize_money", "income"]);

/** A row represents money coming IN if its category is income OR if a CC
 *  transaction was a credit (positive amount on the statement). */
function isIncomeRow(row: any) {
  const key = (row.categorySlug ?? "").toString().toLowerCase().replace(/\s+/g, "_").replace(/-/g, "_");
  if (INCOME_CATEGORIES.has(key)) return true;
  return row?.extractedData?.isCredit === true;
}

const CATEGORY_COLORS: Record<string, { bg: string; color: string; label: string }> = {
  veterinary: { bg: "rgba(74,91,219,0.08)", color: "#4A5BDB", label: "Veterinary" },
  farrier: { bg: "rgba(20,184,166,0.08)", color: "#14B8A6", label: "Farrier" },
  stabling: { bg: "rgba(245,158,11,0.08)", color: "#F59E0B", label: "Stabling" },
  travel: { bg: "rgba(236,72,153,0.08)", color: "#EC4899", label: "Travel" },
  housing: { bg: "rgba(167,139,250,0.08)", color: "#A78BFA", label: "Housing" },
  horse_transport: { bg: "rgba(74,91,219,0.08)", color: "#4A5BDB", label: "Horse Transport" },
  marketing: { bg: "rgba(167,139,250,0.08)", color: "#A78BFA", label: "Marketing" },
  bodywork: { bg: "rgba(167,139,250,0.08)", color: "#A78BFA", label: "Bodywork" },
  feed_bedding: { bg: "rgba(34,197,131,0.08)", color: "#22C583", label: "Feed & Bedding" },
  admin: { bg: "rgba(107,112,132,0.08)", color: "#6B7084", label: "Admin" },
  dues_registrations: { bg: "rgba(74,91,219,0.08)", color: "#4A5BDB", label: "Dues & Registrations" },
  supplies: { bg: "rgba(107,112,132,0.08)", color: "#6B7084", label: "Supplies" },
  grooming: { bg: "rgba(14,165,233,0.08)", color: "#0EA5E9", label: "Grooming" },
  "riding-training": { bg: "rgba(236,72,153,0.08)", color: "#EC4899", label: "Riding & Training" },
  "prize-money": { bg: "rgba(34,197,94,0.08)", color: "#22C55E", label: "Prize Money" },
  income: { bg: "rgba(34,197,94,0.08)", color: "#16A34A", label: "Income" },
  equity: { bg: "rgba(139,92,246,0.08)", color: "#8B5CF6", label: "Equity" },
};

export default function InvoicesPage() {
  const router = useRouter();
  const { user } = useAuth();
  const isOwnerRole = user?.role === "owner";
  const ownerIdForFilter = isOwnerRole && user?.ownerId ? (user.ownerId as Id<"owners">) : undefined;

  const allRows = useQuery(api.bills.listAll, isOwnerRole ? "skip" : {}) ?? [];
  const ownerRows = useQuery(api.bills.listByOwner, ownerIdForFilter ? { ownerId: ownerIdForFilter } : "skip") ?? [];
  const rows = isOwnerRole ? ownerRows : allRows;

  const deleteBill = useMutation(api.bills.deleteBill);
  const updateBillNotes = useMutation(api.bills.updateBillNotes);

  const [categoryFilter, setCategoryFilter] = useState("all");
  const [horseFilter, setHorseFilter] = useState<string>("all");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const activeHorses = useQuery(api.horses.getActiveHorses) ?? [];
  const [sortMode, setSortMode] = useState<SortMode>("date");
  const [sortOpen, setSortOpen] = useState(false);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<any | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [editingNotesFor, setEditingNotesFor] = useState<string | null>(null);
  const [editingNotes, setEditingNotes] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const hasActiveFilters = categoryFilter !== "all" || horseFilter !== "all" || fromDate || toDate;

  const categories = useMemo(() => ["all", ...new Set(rows.map((row) => row.categoryName))], [rows]);

  const filtered = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    const base = rows.filter((row) => {
      const date = getInvoiceDate(row);
      const categoryPass = categoryFilter === "all" || row.categoryName === categoryFilter;
      const assignedHorseIds = Array.isArray(row.assignedHorses) ? row.assignedHorses.map((entry: any) => String(entry.horseId ?? "")).filter(Boolean) : [];
      const horsePass = horseFilter === "all" || assignedHorseIds.includes(horseFilter);
      const fromPass = !fromDate || date >= fromDate;
      const toPass = !toDate || date <= toDate;
      const searchPass = !q || abbreviateInvoiceName(row.invoiceName || formatInvoiceName({ contactName: getProvider(row), date })).toLowerCase().includes(q)
        || (row.categoryName ?? "").toLowerCase().includes(q)
        || (getProvider(row)).toLowerCase().includes(q)
        || date.includes(q);
      return categoryPass && horsePass && fromPass && toPass && searchPass;
    });

    const sorted = [...base];
    sorted.sort((a, b) => {
      if (sortMode === "date") {
        return Date.parse(getInvoiceDate(b)) - Date.parse(getInvoiceDate(a));
      }
      if (sortMode === "amount") {
        const aAmount = Math.abs(getTotal(a));
        const bAmount = Math.abs(getTotal(b));
        return bAmount - aAmount;
      }
      const aName = abbreviateInvoiceName(a.invoiceName || formatInvoiceName({ contactName: getProvider(a), date: getInvoiceDate(a) })).toLowerCase();
      const bName = abbreviateInvoiceName(b.invoiceName || formatInvoiceName({ contactName: getProvider(b), date: getInvoiceDate(b) })).toLowerCase();
      return sortMode === "name-asc" ? aName.localeCompare(bName) : bName.localeCompare(aName);
    });
    return sorted;
  }, [rows, categoryFilter, horseFilter, fromDate, toDate, searchQuery, sortMode]);

  async function handleDownloadPdf(row: any) {
    const url = row.originalPdfUrl;
    if (!url) return;
    const a = document.createElement("a");
    a.href = url;
    a.download = formatInvoiceFileName({ contactName: getProvider(row), date: getInvoiceDate(row) });
    a.click();
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    await deleteBill({ billId: deleteTarget._id });
    setDeleteTarget(null);
  }

  async function saveNotes(billId: string) {
    await updateBillNotes({ billId: billId as any, notes: editingNotes });
    setEditingNotesFor(null);
  }

  return (
    <div className="page-shell">
      <NavBar
        items={[
          { label: "old-oak-horses", href: "/dashboard", brand: true },
          { label: "invoices", current: true },
        ]}
        actions={[
          { label: "upload invoices", href: "/dashboard?panel=invoice", variant: "outlined" },
          { label: "biz overview", href: "/biz-overview", variant: "filled" },
        ]}
      />

      <main className={`page-main ${styles.pageMain}`}>
        <Link href="/dashboard" className="ui-back-link">
          ← cd /dashboard
        </Link>
        <div className={styles.header}>
          <div className="ui-label">// Invoices</div>
          <h1 className={styles.title}>Invoices</h1>
        </div>

        <section className={styles.filterBar}>
          <div className={styles.searchRow}>
            <input
              type="text"
              className={styles.searchInput}
              placeholder="search invoices..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            <button
              type="button"
              className={`${styles.filterToggle} ${hasActiveFilters ? styles.filterToggleActive : ""}`}
              onClick={() => {
                setFiltersOpen((prev) => !prev);
                setSortOpen(false);
              }}
            >
              {filtersOpen ? "hide filters" : "filters"}{hasActiveFilters ? ` •` : ""}
            </button>
            <div className={styles.sortWrap}>
              <button
                type="button"
                className={`${styles.filterToggle} ${sortOpen ? styles.filterToggleActive : ""}`}
                onClick={() => {
                  setSortOpen((prev) => !prev);
                  setFiltersOpen(false);
                }}
              >
                sort: {SORT_LABELS[sortMode]}
              </button>
              {sortOpen && (
                <div className={styles.sortDropdown}>
                  {(Object.keys(SORT_LABELS) as SortMode[]).map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      className={`${styles.sortDropdownItem} ${sortMode === mode ? styles.sortDropdownItemActive : ""}`}
                      onClick={() => {
                        setSortMode(mode);
                        setSortOpen(false);
                      }}
                    >
                      {SORT_LABELS[mode]}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {filtersOpen && (
            <div className={styles.filterGrid}>
              <label>
                <span>Category</span>
                <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
                  {categories.map((name) => (
                    <option key={name} value={name}>
                      {name === "all" ? "All" : name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>Horse</span>
                <select value={horseFilter} onChange={(e) => setHorseFilter(e.target.value)}>
                  <option value="all">All</option>
                  {activeHorses.map((horse) => (
                    <option key={horse._id} value={String(horse._id)}>{horse.name}</option>
                  ))}
                </select>
              </label>
              <label>
                <span>From</span>
                <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
              </label>
              <label>
                <span>To</span>
                <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
              </label>
              {hasActiveFilters && (
                <button
                  type="button"
                  className={styles.clearFiltersBtn}
                  onClick={() => {
                    setCategoryFilter("all");
                    setHorseFilter("all");
                    setFromDate("");
                    setToDate("");
                  }}
                >
                  clear all
                </button>
              )}
            </div>
          )}
        </section>

        <section className={styles.listCard}>
          <div className={styles.tableHeader}>
            <span className={styles.colName}>Invoice</span>
            <span className={styles.colDate}>Date</span>
            <span className={styles.colContact}>Contact</span>
            <span className={styles.colCategory}>Category</span>
            <span className={styles.colHorses}>Horses</span>
            <span className={styles.colAmount}>Amount</span>
            <span className={styles.colMenu} />
          </div>

          {filtered.map((row) => {
            const date = getInvoiceDate(row);
            const rawTotal = getTotal(row);
            const isIncome = isIncomeRow(row);
            const total = isIncome ? rawTotal : -rawTotal;
            const categoryKey = normalizeKey(row.categorySlug ?? slugify(row.categoryName ?? ""));
            const categoryColor = CATEGORY_COLORS[categoryKey] ?? {
              bg: "rgba(107,112,132,0.08)",
              color: "#6B7084",
              label: prettyCategory(categoryKey),
            };
            const url = getInvoiceUrl(row);
            const rowId = String(row._id);
            const isExpanded = expandedId === rowId;
            const assignedHorses = Array.isArray(row.assignedHorses) ? row.assignedHorses.map((entry: any) => entry.horseName).filter(Boolean) : [];
            const contact = getProvider(row);
            const displayName = abbreviateInvoiceName(row.invoiceName || formatInvoiceName({ contactName: contact }));
            return (
              <div key={rowId}>
                <div
                  className={`${styles.invoiceRow} ${isExpanded ? styles.invoiceRowExpanded : ""}`}
                  onClick={() => {
                    setExpandedId((prev) => (prev === rowId ? null : rowId));
                    setEditingNotesFor(null);
                    setOpenMenuId(null);
                  }}
                >
                  <a
                    className={`${styles.colName} ${styles.invoiceNameLink}`}
                    href={url}
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      router.push(url);
                    }}
                  >
                    {displayName}
                    {row.source === "cc_transaction" && <span className={styles.ccBadge}>CC</span>}
                  </a>
                  <span className={styles.colDate}>{formatDate(date)}</span>
                  <span className={styles.colContact}>{contact}</span>
                  <span className={styles.colCategory}>
                    <span className={styles.categoryBadge} style={{ background: categoryColor.bg, color: categoryColor.color }}>
                      {categoryColor.label}
                    </span>
                  </span>
                  <span className={styles.colHorses}>
                    {assignedHorses.length > 0 ? assignedHorses.join(", ") : <span className={styles.muted}>—</span>}
                  </span>
                  <span className={`${styles.colAmount} ${styles.amountCol}`} style={total >= 0 ? { color: "#16A34A" } : undefined}>{formatUsd(total)}</span>
                  <div className={`${styles.colMenu} ${styles.menuWrap}`} onClick={(e) => e.stopPropagation()}>
                    <button type="button" className={styles.invoiceMenuBtn} onClick={(e) => { e.stopPropagation(); setOpenMenuId((prev) => (prev === rowId ? null : rowId)); }}>
                      ⋮
                    </button>
                    {openMenuId === rowId ? (
                      <div className={styles.menuDropdown}>
                        <button type="button" className={styles.menuItem} onClick={() => { setOpenMenuId(null); router.push(`/invoices/preview/${row._id}`); }}>
                          Edit Invoice
                        </button>
                        {row.source !== "cc_transaction" && (
                          <button type="button" className={styles.menuItem} onClick={() => handleDownloadPdf(row)}>
                            Download PDF
                          </button>
                        )}
                        <div className={styles.menuDivider} />
                        <button
                          type="button"
                          className={`${styles.menuItem} ${styles.menuItemDanger}`}
                          onClick={() => {
                            setOpenMenuId(null);
                            setDeleteTarget(row);
                          }}
                        >
                          Delete Invoice
                        </button>
                      </div>
                    ) : null}
                  </div>
                </div>

                {isExpanded ? (
                  <div className={styles.invoiceExpanded}>
                    {editingNotesFor === rowId ? (
                      <div className={styles.notesEditor}>
                        <textarea
                          value={editingNotes}
                          onChange={(e) => setEditingNotes(e.target.value)}
                          placeholder="add notes..."
                          className={styles.notesTextarea}
                          onClick={(e) => e.stopPropagation()}
                        />
                        <div className={styles.notesButtons}>
                          <button
                            type="button"
                            className={styles.secondaryAction}
                            onClick={(e) => {
                              e.stopPropagation();
                              setEditingNotesFor(null);
                            }}
                          >
                            cancel
                          </button>
                          <button
                            type="button"
                            className={styles.primaryAction}
                            onClick={(e) => {
                              e.stopPropagation();
                              void saveNotes(rowId);
                            }}
                          >
                            save notes
                          </button>
                        </div>
                      </div>
                    ) : row.notes ? (
                      <div className={styles.notesBlock}>
                        <div className={styles.detailLabel}>NOTES</div>
                        <div className={styles.notesText}>{row.notes}</div>
                      </div>
                    ) : (
                      <div className={styles.noNotes}>no notes</div>
                    )}

                    <div className={styles.expandedActions}>
                      <button
                        type="button"
                        className={styles.viewInvoiceBtn}
                        onClick={(e) => {
                          e.stopPropagation();
                          router.push(url);
                        }}
                      >
                        view invoice →
                      </button>
                      <button
                        type="button"
                        className={styles.secondaryAction}
                        onClick={(e) => {
                          e.stopPropagation();
                          setEditingNotesFor(rowId);
                          setEditingNotes(row.notes ?? "");
                        }}
                      >
                        {row.notes ? "edit notes" : "+ add notes"}
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
            );
          })}
          {filtered.length === 0 ? <div className={styles.empty}>No invoices found.</div> : null}
        </section>
      </main>

      {deleteTarget ? (
        <div className={styles.modalBackdrop}>
          <div className={styles.modalCard}>
            <div className={styles.modalIcon}>⚠</div>
            <div className={styles.modalTitle}>delete invoice?</div>
            <div className={styles.modalText}>
              Are you sure you want to delete "{formatInvoiceName({ contactName: getProvider(deleteTarget), date: getInvoiceDate(deleteTarget) })}"?
              <br />
              This cannot be undone.
            </div>
            <div className={styles.modalButtons}>
              <button type="button" className={styles.modalBtnCancel} onClick={() => setDeleteTarget(null)}>
                cancel
              </button>
              <button type="button" className={styles.modalBtnDelete} onClick={confirmDelete}>
                yes, delete invoice
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function getInvoiceDate(row: any) {
  const raw = row?.extractedData?.invoice_date ?? row?.extractedData?.invoiceDate;
  if (typeof raw === "string" && raw.trim().length > 0) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
    const parsed = new Date(raw);
    if (!isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);
  }
  return new Date(row.uploadedAt).toISOString().slice(0, 10);
}

function getTotal(row: any) {
  const extracted = row?.extractedData ?? {};
  const value = extracted.invoice_total_usd ?? extracted.total_usd ?? extracted.invoice_total ?? extracted.total ?? row.originalTotal ?? 0;
  return typeof value === "number" ? value : Number(value) || 0;
}

function getProvider(row: any) {
  return row?.contactName ?? row?.customProviderName ?? "Unassigned Invoice";
}

function getInvoiceUrl(bill: any) {
  return `/invoices/preview/${bill._id}`;
}

function prettyCategory(value: string) {
  const key = normalizeKey(value);
  return CATEGORY_COLORS[key]?.label ?? key.split(/[-_]+/).map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
}

function normalizeKey(value: string) {
  return value.toLowerCase().replace(/\s+/g, "_").replace(/-/g, "_");
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-");
}

function formatDate(iso: string) {
  const d = new Date(iso + "T00:00:00");
  if (isNaN(d.getTime())) return iso;
  const m = (d.getMonth() + 1).toString().padStart(2, "0");
  const day = d.getDate().toString().padStart(2, "0");
  const y = d.getFullYear().toString().slice(2);
  return `${m}/${day}/${y}`;
}

function formatUsd(value: number) {
  const abs = Math.abs(value);
  const formatted = `$${abs.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  return value < 0 ? `(${formatted})` : formatted;
}
