"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import NavBar from "@/components/NavBar";
import { formatInvoiceFileName, formatInvoiceName } from "@/lib/formatInvoiceName";
import styles from "./invoices.module.css";

type SortColumn = "invoice" | "category" | "date" | "amount" | null;
type SortDirection = "asc" | "desc";

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
};

export default function InvoicesPage() {
  const router = useRouter();
  const rows = useQuery(api.bills.listAll) ?? [];
  const deleteBill = useMutation(api.bills.deleteBill);
  const updateBillNotes = useMutation(api.bills.updateBillNotes);

  const [categoryFilter, setCategoryFilter] = useState("all");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [sortColumn, setSortColumn] = useState<SortColumn>(null);
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<any | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [editingNotesFor, setEditingNotesFor] = useState<string | null>(null);
  const [editingNotes, setEditingNotes] = useState("");

  const categories = useMemo(() => ["all", ...new Set(rows.map((row) => row.categoryName))], [rows]);

  const filtered = useMemo(() => {
    const base = rows.filter((row) => {
      const date = getInvoiceDate(row);
      const categoryPass = categoryFilter === "all" || row.categoryName === categoryFilter;
      const fromPass = !fromDate || date >= fromDate;
      const toPass = !toDate || date <= toDate;
      return categoryPass && fromPass && toPass;
    });

    const sorted = [...base];
    if (!sortColumn) return sorted;
    sorted.sort((a, b) => {
      if (sortColumn === "invoice") {
        const aVal = (a.invoiceName || formatInvoiceName({ providerName: getProvider(a), date: getInvoiceDate(a) })).toLowerCase();
        const bVal = (b.invoiceName || formatInvoiceName({ providerName: getProvider(b), date: getInvoiceDate(b) })).toLowerCase();
        return sortDirection === "asc" ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
      }
      if (sortColumn === "category") {
        const aVal = prettyCategory(a.categorySlug ?? slugify(a.categoryName)).toLowerCase();
        const bVal = prettyCategory(b.categorySlug ?? slugify(b.categoryName)).toLowerCase();
        return sortDirection === "asc" ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
      }
      if (sortColumn === "date") {
        const aTime = Date.parse(getInvoiceDate(a));
        const bTime = Date.parse(getInvoiceDate(b));
        return sortDirection === "asc" ? aTime - bTime : bTime - aTime;
      }
      const aAmount = getTotal(a);
      const bAmount = getTotal(b);
      return sortDirection === "asc" ? aAmount - bAmount : bAmount - aAmount;
    });
    return sorted;
  }, [rows, categoryFilter, fromDate, toDate, sortColumn, sortDirection]);

  function handleSort(column: Exclude<SortColumn, null>) {
    if (sortColumn === column) {
      if (sortDirection === "asc") {
        setSortDirection("desc");
      } else {
        setSortColumn(null);
        setSortDirection("asc");
      }
    } else {
      setSortColumn(column);
      setSortDirection("asc");
    }
  }

  async function handleDownloadPdf(row: any) {
    const url = row.originalPdfUrl;
    if (!url) return;
    const a = document.createElement("a");
    a.href = url;
    a.download = formatInvoiceFileName({ providerName: getProvider(row), date: getInvoiceDate(row) });
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

      <main className="page-main">
        <Link href="/dashboard" className="ui-back-link">
          ← cd /dashboard
        </Link>
        <div className={styles.header}>
          <div className="ui-label">// invoices</div>
          <h1 className={styles.title}>invoices</h1>
        </div>

        <section className={styles.filters}>
          <label>
            <span>CATEGORY</span>
            <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
              {categories.map((name) => (
                <option key={name} value={name}>
                  {name === "all" ? "All" : name}
                </option>
              ))}
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
          <div className={styles.invoicesHeader}>
            <button type="button" className={headerClass(sortColumn === "invoice", styles)} onClick={() => handleSort("invoice")}>
              INVOICE {sortArrow(sortColumn === "invoice", sortDirection, styles)}
            </button>
            <button type="button" className={headerClass(sortColumn === "category", styles)} onClick={() => handleSort("category")}>
              CATEGORY {sortArrow(sortColumn === "category", sortDirection, styles)}
            </button>
            <button type="button" className={headerClass(sortColumn === "date", styles)} onClick={() => handleSort("date")}>
              DATE {sortArrow(sortColumn === "date", sortDirection, styles)}
            </button>
            <button type="button" className={headerClass(sortColumn === "amount", styles)} onClick={() => handleSort("amount")}>
              AMOUNT {sortArrow(sortColumn === "amount", sortDirection, styles)}
            </button>
            <div />
          </div>

          {filtered.map((row) => {
            const date = getInvoiceDate(row);
            const total = getTotal(row);
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
            const invoiceNumber = String(row?.extractedData?.invoice_number ?? row?.extractedData?.invoiceNumber ?? "—");
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
                  <div className={styles.invoiceCol}>
                    <span className={styles.expandChevron}>{isExpanded ? "▾" : "▸"}</span>
                    <a
                      className={styles.invoiceNameLink}
                      href={url}
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        router.push(url);
                      }}
                    >
                      {row.invoiceName || formatInvoiceName({ providerName: getProvider(row), date })}
                    </a>
                  </div>
                  <div>
                    <span className={styles.categoryBadge} style={{ background: categoryColor.bg, color: categoryColor.color }}>
                      {categoryColor.label}
                    </span>
                  </div>
                  <div className={styles.dateCol}>{date}</div>
                  <div className={styles.amountCol}>{formatUsd(total)}</div>
                  <div className={styles.menuWrap} onClick={(e) => e.stopPropagation()}>
                    <button type="button" className={styles.invoiceMenuBtn} onClick={(e) => { e.stopPropagation(); setOpenMenuId((prev) => (prev === rowId ? null : rowId)); }}>
                      ⋮
                    </button>
                    {openMenuId === rowId ? (
                      <div className={styles.menuDropdown}>
                        <button type="button" className={styles.menuItem} onClick={() => { setOpenMenuId(null); router.push(`/invoices/preview/${row._id}`); }}>
                          Edit Invoice
                        </button>
                        <button type="button" className={styles.menuItem} onClick={() => handleDownloadPdf(row)}>
                          Download PDF
                        </button>
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

                    <div className={styles.quickInfo}>
                      <div>
                        <div className={styles.detailLabel}>INVOICE #</div>
                        <div className={styles.detailValue}>{invoiceNumber}</div>
                      </div>
                      <div>
                        <div className={styles.detailLabel}>CATEGORY</div>
                        <div className={styles.detailValue}>{prettyCategory(categoryKey)}</div>
                      </div>
                      {assignedHorses.length > 0 ? (
                        <div>
                          <div className={styles.detailLabel}>HORSES</div>
                          <div className={styles.detailValue}>{assignedHorses.join(", ")}</div>
                        </div>
                      ) : null}
                    </div>

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
              Are you sure you want to delete "{formatInvoiceName({ providerName: getProvider(deleteTarget), date: getInvoiceDate(deleteTarget) })}"?
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

function headerClass(active: boolean, css: Record<string, string>) {
  return active ? `${css.columnHeader} ${css.columnHeaderActive}` : css.columnHeader;
}

function sortArrow(active: boolean, direction: SortDirection, css: Record<string, string>) {
  if (!active) return null;
  return <span className={css.sortArrow}>{direction === "asc" ? "↑" : "↓"}</span>;
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
  return row?.providerName ?? row?.customProviderName ?? "Unassigned Invoice";
}

function getInvoiceUrl(bill: any) {
  const category = bill.categorySlug ?? slugify(bill.categoryName ?? "");
  const providerSlug = bill.providerSlug || slugify(bill.providerName || bill.customProviderName || "provider");
  if (category === "travel") return `/travel/${bill.travelSubcategory ?? "rental-car"}/${bill._id}`;
  if (category === "housing") return `/housing/${bill.housingSubcategory ?? "rider-housing"}/${bill._id}`;
  if (category === "marketing") return `/marketing/${bill.marketingSubcategory ?? providerSlug}/${bill._id}`;
  if (category === "admin") return `/admin/${bill.adminSubcategory ?? "legal"}/${providerSlug}/${bill._id}`;
  if (category === "dues-registrations") return `/dues-registrations/${bill.duesSubcategory ?? "memberships"}/${providerSlug}/${bill._id}`;
  if (category === "horse-transport") return `/horse-transport/${bill.horseTransportSubcategory ?? "ground-transport"}/${providerSlug}/${bill._id}`;
  if (category === "grooming") return `/grooming/${bill.groomingSubcategory ?? "other"}/${bill._id}`;
  return `/${category}/${providerSlug}/${bill._id}`;
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

function formatUsd(value: number) {
  return `$${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
