"use client";

import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import Modal from "@/components/Modal";
import NavBar from "@/components/NavBar";
import { formatInvoiceName } from "@/lib/formatInvoiceName";
import styles from "./records.module.css";

const RECORD_TYPES = [
  { key: "veterinary", icon: "📋", label: "Veterinary Records" },
  { key: "farrier", icon: "🔧", label: "Farrier Records" },
  { key: "health", icon: "💉", label: "Health & Vaccinations" },
  { key: "registration", icon: "📄", label: "Registration Documents" },
];

function formatDateTime(dateStr: string | null, uploadedAt: number) {
  if (dateStr) {
    const d = new Date(dateStr);
    if (!isNaN(d.getTime())) {
      const uploaded = new Date(uploadedAt);
      d.setHours(uploaded.getHours(), uploaded.getMinutes());
      return d.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      }) + " · " + uploaded.toLocaleTimeString("en-US", {
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
      });
    }
  }
  const d = new Date(uploadedAt);
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }) + " · " + d.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

function formatUsd(n: number) {
  return "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

type RecordType = "veterinary" | "medication" | "farrier" | "bodywork" | "other";
type DateRange = "all" | "7d" | "30d" | "3m" | "6m" | "1y";
type SortColumn = "record" | "provider" | "category" | "date";

type HorseRecord = {
  _id: Id<"horseRecords">;
  type: RecordType;
  customType?: string;
  date: number;
  providerName?: string;
  visitType?: "vaccination" | "treatment";
  vaccineName?: string;
  treatmentDescription?: string;
  serviceType?: string;
  isUpcoming?: boolean;
  linkedRecordId?: Id<"horseRecords">;
  notes?: string;
  attachmentStorageId?: string;
  attachmentUrl?: string | null;
  billId?: Id<"bills">;
  billInfo?: { billId: Id<"bills">; providerName: string; invoiceDate: string } | null;
};

type EditState = {
  providerName: string;
  date: string;
  nextVisitDate: string;
  notes: string;
  serviceType: string;
  customType: string;
  vaccineName: string;
  treatmentDescription: string;
  billId: string;
};

const RECORD_ICONS: Record<RecordType, string> = {
  veterinary: "🩺",
  medication: "💊",
  farrier: "🔧",
  bodywork: "🦴",
  other: "📋",
};

const RECORD_CATEGORY_COLORS: Record<RecordType, { bg: string; color: string }> = {
  veterinary: { bg: "rgba(74,91,219,0.08)", color: "#4A5BDB" },
  medication: { bg: "rgba(34,197,131,0.08)", color: "#22C583" },
  farrier: { bg: "rgba(20,184,166,0.08)", color: "#14B8A6" },
  bodywork: { bg: "rgba(167,139,250,0.08)", color: "#A78BFA" },
  other: { bg: "#F0F1F5", color: "#6B7084" },
};

export default function HorseRecordsPage() {
  const params = useParams<{ horseId: string }>();
  const horseId = params?.horseId as Id<"horses">;

  const horse = useQuery(api.horses.getHorseById, horseId ? { horseId } : "skip");
  const allRecords = (useQuery(api.horseRecords.getAllByHorse, horseId ? { horseId } : "skip") as HorseRecord[] | undefined) ?? [];

  const allInvoicesForLinking = useQuery(api.bills.listForLinking) ?? [];
  const updateRecordWithNextVisit = useMutation(api.horseRecords.updateRecordWithNextVisit);
  const deleteHorseRecord = useMutation(api.horseRecords.deleteHorseRecord);
  const generateUploadUrl = useMutation(api.bills.generateUploadUrl);

  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<"all" | RecordType>("all");
  const [dateRange, setDateRange] = useState<DateRange>("all");
  const [sortColumn, setSortColumn] = useState<SortColumn>("date");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");

  const [expandedId, setExpandedId] = useState<Id<"horseRecords"> | null>(null);
  const [menuOpenId, setMenuOpenId] = useState<Id<"horseRecords"> | null>(null);
  const [editingRecordId, setEditingRecordId] = useState<Id<"horseRecords"> | null>(null);
  const [editState, setEditState] = useState<EditState | null>(null);
  const [recordToDelete, setRecordToDelete] = useState<{ id: Id<"horseRecords">; name: string } | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [editAttachment, setEditAttachment] = useState<File | null>(null);
  const editFileRef = useRef<HTMLInputElement>(null);
  const [editInvoiceSearch, setEditInvoiceSearch] = useState("");
  const [editInvoiceDropdownOpen, setEditInvoiceDropdownOpen] = useState(false);

  const filteredRecords = useMemo(() => {
    const term = search.trim().toLowerCase();

    return allRecords.filter((record) => {
      if (typeFilter !== "all" && record.type !== typeFilter) return false;
      if (!filterByDate(record.date, dateRange)) return false;

      if (!term) return true;
      const bag = [
        record.type,
        record.providerName,
        record.notes,
        record.vaccineName,
        record.treatmentDescription,
        record.serviceType,
        record.customType,
        record.visitType,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      return bag.includes(term);
    });
  }, [allRecords, search, typeFilter, dateRange]);

  const sortedRecords = useMemo(() => {
    const rows = [...filteredRecords];
    rows.sort((a, b) => {
      let cmp = 0;
      switch (sortColumn) {
        case "record":
          cmp = getRecordLabel(a).localeCompare(getRecordLabel(b));
          break;
        case "provider":
          cmp = (a.providerName || "").localeCompare(b.providerName || "");
          break;
        case "category":
          cmp = a.type.localeCompare(b.type);
          break;
        case "date":
          cmp = a.date - b.date;
          break;
      }
      return sortDirection === "asc" ? cmp : -cmp;
    });
    return rows;
  }, [filteredRecords, sortColumn, sortDirection]);
  const recordById = useMemo(() => {
    const map = new Map<string, HorseRecord>();
    for (const row of allRecords) map.set(String(row._id), row);
    return map;
  }, [allRecords]);

  function handleSort(column: SortColumn) {
    if (sortColumn === column) {
      if (sortDirection === "desc") {
        setSortDirection("asc");
      } else {
        setSortColumn("date");
        setSortDirection("desc");
      }
      return;
    }

    setSortColumn(column);
    setSortDirection(column === "date" ? "desc" : "asc");
  }

  function getLinkedUpcomingDateInput(record: HorseRecord) {
    if (record.isUpcoming || !record.linkedRecordId) return "";
    const linked = allRecords.find((row) => row._id === record.linkedRecordId);
    return typeof linked?.date === "number" ? toDateInput(linked.date) : "";
  }

  async function saveEdit() {
    if (!editingRecordId || !editState) return;
    const nextVisitTimestamp = editState.nextVisitDate ? new Date(`${editState.nextVisitDate}T00:00:00`).getTime() : undefined;

    let attachmentStorageId: string | undefined;
    let attachmentName: string | undefined;
    if (editAttachment) {
      const uploadUrl = await generateUploadUrl();
      const resp = await fetch(uploadUrl, {
        method: "POST",
        headers: { "Content-Type": editAttachment.type || "application/octet-stream" },
        body: editAttachment,
      });
      if (!resp.ok) throw new Error("Failed to upload attachment");
      const payload = await resp.json();
      attachmentStorageId = typeof payload.storageId === "string" ? payload.storageId : undefined;
      attachmentName = editAttachment.name;
    }

    await updateRecordWithNextVisit({
      recordId: editingRecordId,
      updates: {
        providerName: editState.providerName || undefined,
        date: editState.date ? new Date(`${editState.date}T00:00:00`).getTime() : undefined,
        notes: editState.notes || undefined,
        serviceType: editState.serviceType || undefined,
        customType: editState.customType || undefined,
        vaccineName: editState.vaccineName || undefined,
        treatmentDescription: editState.treatmentDescription || undefined,
        ...(attachmentStorageId ? { attachmentStorageId, attachmentName } : {}),
        billId: editState.billId ? editState.billId as Id<"bills"> : undefined,
      },
      nextVisitDate: nextVisitTimestamp,
    });
    setEditingRecordId(null);
    setEditState(null);
    setEditAttachment(null);
  }

  async function confirmDelete() {
    if (!recordToDelete) return;
    setIsDeleting(true);
    try {
      await deleteHorseRecord({ recordId: recordToDelete.id });
      if (expandedId === recordToDelete.id) setExpandedId(null);
      setMenuOpenId(null);
      setRecordToDelete(null);
    } finally {
      setIsDeleting(false);
    }
  }

  const totalCount = allRecords.length;
  const filteredCount = filteredRecords.length;

  const vetRecords = useQuery(api.horses.getRecordsByType, horseId ? { horseId, type: "veterinary" } : "skip") ?? [];
  const farrierRecords = useQuery(api.horses.getRecordsByType, horseId ? { horseId, type: "farrier" } : "skip") ?? [];
  const healthRecords = useQuery(api.horses.getRecordsByType, horseId ? { horseId, type: "health" } : "skip") ?? [];
  const regRecords = useQuery(api.horses.getRecordsByType, horseId ? { horseId, type: "registration" } : "skip") ?? [];

  const recordsByType: Record<string, typeof vetRecords> = {
    veterinary: vetRecords,
    farrier: farrierRecords,
    health: healthRecords,
    registration: regRecords,
  };

  if (!horse) {
    return (
      <div className="page-shell">
        <main className="page-main">
          <section className="ui-card">loading records...</section>
        </main>
      </div>
    );
  }

  return (
    <div className="page-shell">
      <NavBar
        items={[
          { label: "old-oak-horses", href: "/dashboard", brand: true },
          { label: "horses", href: "/horses" },
          { label: horse.name, href: `/horses/${horse._id}` },
          { label: "records", current: true },
        ]}
        actions={[
          { label: "upload invoices", href: "/dashboard?panel=invoice", variant: "outlined" },
          { label: "biz overview", href: "/biz-overview", variant: "filled" },
        ]}
      />

      <main className="page-main">
        <Link href={horse ? `/horses/${horse._id}` : "/horses"} className="ui-back-link">
          ← cd /{horse?.name ?? "horse"}
        </Link>

        <section className={styles.headerRow}>
          <div>
            <div className="ui-label">// RECORDS</div>
            <h1 className={styles.title}>{horse?.name ?? "horse"} records</h1>
            <div className={styles.totalCount}>{totalCount} records</div>
          </div>
          <Link href={horse ? `/dashboard?panel=record&horseId=${horse._id}` : "/dashboard?panel=record"} className={styles.logButton}>
            + log record
          </Link>
        </section>

        <section className={styles.filterRow}>
          <div className={styles.searchWrap}>
            <span className={styles.searchIcon}>🔍</span>
            <input
              className={styles.searchInput}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="search records..."
            />
          </div>

          <select className={styles.typeFilter} value={typeFilter} onChange={(event) => setTypeFilter(event.target.value as "all" | RecordType)}>
            <option value="all">All Types</option>
            <option value="veterinary">Veterinary</option>
            <option value="medication">Medication</option>
            <option value="farrier">Farrier</option>
            <option value="bodywork">Bodywork</option>
            <option value="other">Other</option>
          </select>

          <select className={styles.dateFilter} value={dateRange} onChange={(event) => setDateRange(event.target.value as DateRange)}>
            <option value="all">All Time</option>
            <option value="7d">Last 7 Days</option>
            <option value="30d">Last 30 Days</option>
            <option value="3m">Last 3 Months</option>
            <option value="6m">Last 6 Months</option>
            <option value="1y">Last Year</option>
          </select>
        </section>

        <div className={styles.resultsCount}>
          {filteredCount === totalCount ? `showing ${filteredCount} records` : `showing ${filteredCount} of ${totalCount} records`}
        </div>

        <section className={styles.allRecordsCard}>
          <div className={styles.recordsListHeader}>
            <span />
            <button type="button" className={sortColumn === "record" ? styles.sortHeaderActive : styles.sortHeader} onClick={() => handleSort("record")}>
              RECORD
              {sortColumn === "record" ? <span className={styles.sortArrow}>{sortDirection === "asc" ? "↑" : "↓"}</span> : null}
            </button>
            <button type="button" className={sortColumn === "provider" ? styles.sortHeaderActive : styles.sortHeader} onClick={() => handleSort("provider")}>
              PROVIDER
              {sortColumn === "provider" ? <span className={styles.sortArrow}>{sortDirection === "asc" ? "↑" : "↓"}</span> : null}
            </button>
            <button type="button" className={sortColumn === "category" ? styles.sortHeaderActive : styles.sortHeader} onClick={() => handleSort("category")}>
              CATEGORY
              {sortColumn === "category" ? <span className={styles.sortArrow}>{sortDirection === "asc" ? "↑" : "↓"}</span> : null}
            </button>
            <button type="button" className={sortColumn === "date" ? styles.sortHeaderActive : styles.sortHeader} onClick={() => handleSort("date")}>
              DATE
              {sortColumn === "date" ? <span className={styles.sortArrow}>{sortDirection === "asc" ? "↑" : "↓"}</span> : null}
            </button>
            <span />
          </div>

          {sortedRecords.length === 0 ? (
            <div className={styles.emptyState}>{totalCount === 0 ? "no records yet — log your first record using the button above" : "no records found — try adjusting your filters"}</div>
          ) : (
            sortedRecords.map((record) => {
              const expanded = expandedId === record._id;
              const editing = editingRecordId === record._id && editState !== null;
              const detail = getRecordDetail(record);
              const badgeColors = RECORD_CATEGORY_COLORS[record.type];

              return (
                <div key={record._id}>
                  <div
                    className={styles.recordListRow}
                    onClick={() => {
                      setExpandedId((prev) => (prev === record._id ? null : record._id));
                      setMenuOpenId(null);
                      setEditingRecordId(null);
                      setEditState(null);
                    }}
                  >
                    <div className={styles.recordIcon}>{RECORD_ICONS[record.type]}</div>

                    <div>
                      <div className={styles.recordLabel}>{getRecordLabel(record)}</div>
                      {detail ? <div className={styles.recordSublabel}>{detail}</div> : null}
                      {record.linkedRecordId ? (
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            setExpandedId(record.linkedRecordId || null);
                            setEditingRecordId(null);
                            setEditState(null);
                          }}
                          style={{
                            marginTop: 3,
                            fontSize: 9,
                            color: record.isUpcoming ? "#9EA2B0" : "#4A5BDB",
                            background: "transparent",
                            border: "none",
                            padding: 0,
                            cursor: "pointer",
                            fontFamily: "inherit",
                          }}
                        >
                          {record.isUpcoming
                            ? `📋 follow-up from: ${formatDateLong(recordById.get(String(record.linkedRecordId))?.date ?? record.date)}`
                            : `📅 follow-up scheduled: ${formatDateLong(recordById.get(String(record.linkedRecordId))?.date ?? record.date)}`}
                        </button>
                      ) : null}
                    </div>

                    <div className={record.providerName ? styles.recordProvider : styles.recordProviderEmpty}>{record.providerName || "—"}</div>

                    <span className={styles.recordCategoryBadge} style={{ background: badgeColors.bg, color: badgeColors.color }}>
                      {pretty(record.type)}
                    </span>

                    <div className={styles.recordDateCol}>{formatDateLong(record.date)}</div>

                    <div className={styles.menuWrap}>
                      <button
                        type="button"
                        className={styles.menuButton}
                        onClick={(event) => {
                          event.stopPropagation();
                          setMenuOpenId((prev) => (prev === record._id ? null : record._id));
                        }}
                      >
                        ⋮
                      </button>
                      {menuOpenId === record._id ? (
                        <div className={styles.menuDropdown} onClick={(event) => event.stopPropagation()}>
                          <button
                            type="button"
                            className={styles.menuItem}
                            onClick={() => {
                              setExpandedId(record._id);
                              setMenuOpenId(null);
                            }}
                          >
                            View Details
                          </button>
                          <button
                            type="button"
                            className={styles.menuItem}
                            onClick={() => {
                              setExpandedId(record._id);
                              setEditingRecordId(record._id);
                              setEditState({
                                providerName: record.providerName || "",
                                date: toDateInput(record.date),
                                nextVisitDate: getLinkedUpcomingDateInput(record),
                                notes: record.notes || "",
                                serviceType: record.serviceType || "",
                                customType: record.customType || "",
                                vaccineName: record.vaccineName || "",
                                treatmentDescription: record.treatmentDescription || "",
                                billId: record.billId ? String(record.billId) : "",
                              });
                              setEditAttachment(null);
                              setMenuOpenId(null);
                            }}
                          >
                            Edit Record
                          </button>
                          <div className={styles.menuDivider} />
                          <button
                            type="button"
                            className={`${styles.menuItem} ${styles.menuItemDanger}`}
                            onClick={() => {
                              setRecordToDelete({ id: record._id, name: getRecordLabel(record) });
                              setMenuOpenId(null);
                            }}
                          >
                            Delete
                          </button>
                        </div>
                      ) : null}
                    </div>
                  </div>

                  {expanded ? (
                    <div className={styles.recordExpanded}>
                      <div className={styles.expandedFields}>
                        {editing ? (
                          <>
                            <ExpandedInput label="PROVIDER">
                              <input
                                className={styles.expandedInput}
                                value={editState.providerName}
                                onChange={(event) => setEditState({ ...editState, providerName: event.target.value })}
                              />
                            </ExpandedInput>
                            <ExpandedInput label="DATE">
                              <input
                                className={styles.expandedInput}
                                type="date"
                                value={editState.date}
                                onChange={(event) => setEditState({ ...editState, date: event.target.value })}
                              />
                            </ExpandedInput>
                            <ExpandedInput label="NOTES">
                              <textarea
                                className={styles.expandedTextarea}
                                value={editState.notes}
                                onChange={(event) => setEditState({ ...editState, notes: event.target.value })}
                              />
                            </ExpandedInput>
                            {!record.isUpcoming ? (
                              <ExpandedInput label="NEXT VISIT">
                                <>
                                  <input
                                    className={styles.expandedInput}
                                    type="date"
                                    value={editState.nextVisitDate}
                                    onChange={(event) => setEditState({ ...editState, nextVisitDate: event.target.value })}
                                  />
                                  <div style={{ fontSize: 9, color: "#9EA2B0", marginTop: 6 }}>
                                    {record.linkedRecordId
                                      ? "editing this will update the scheduled follow-up"
                                      : "setting a date will create a scheduled follow-up"}
                                  </div>
                                </>
                              </ExpandedInput>
                            ) : null}
                            <ExpandedInput label="ATTACHMENT">
                              <>
                                <input
                                  ref={editFileRef}
                                  type="file"
                                  style={{ display: "none" }}
                                  onChange={(event) => {
                                    const file = event.target.files?.[0] ?? null;
                                    setEditAttachment(file);
                                    if (file && !editState.notes.trim()) {
                                      const baseName = file.name.replace(/\.[^.]+$/, "").replace(/[-_]/g, " ");
                                      setEditState({ ...editState, notes: baseName });
                                    }
                                  }}
                                />
                                {editAttachment ? (
                                  <div className={styles.editAttachmentRow}>
                                    <span className={styles.editAttachmentName}>📎 {editAttachment.name}</span>
                                    <button
                                      type="button"
                                      className={styles.editAttachmentRemove}
                                      onClick={() => {
                                        setEditAttachment(null);
                                        if (editFileRef.current) editFileRef.current.value = "";
                                      }}
                                    >
                                      ✕
                                    </button>
                                  </div>
                                ) : record.attachmentUrl ? (
                                  <div className={styles.editAttachmentRow}>
                                    <span className={styles.editAttachmentName}>📎 {(record as any).attachmentName || "attachment"}</span>
                                    <span style={{ fontSize: 9, color: "#9EA2B0" }}>already attached</span>
                                  </div>
                                ) : (
                                  <button
                                    type="button"
                                    className={styles.editAttachmentBtn}
                                    onClick={() => editFileRef.current?.click()}
                                  >
                                    + add attachment
                                  </button>
                                )}
                              </>
                            </ExpandedInput>
                            <ExpandedInput label="LINKED INVOICE">
                              <div style={{ position: "relative" }}>
                                {editState.billId ? (
                                  <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "#1a1a2e" }}>
                                    <span>
                                      {(() => {
                                        const linked = allInvoicesForLinking.find((b) => String(b._id) === editState.billId);
                                        return linked ? formatInvoiceName({ providerName: linked.providerName, date: linked.invoiceDate }) : "linked invoice";
                                      })()}
                                    </span>
                                    <button type="button" style={{ background: "none", border: "none", color: "#EF4444", cursor: "pointer", fontSize: 14, padding: 0 }} onClick={() => setEditState({ ...editState, billId: "" })}>✕</button>
                                  </div>
                                ) : (
                                  <>
                                    <input
                                      className={styles.expandedInput}
                                      value={editInvoiceSearch}
                                      onChange={(e) => { setEditInvoiceSearch(e.target.value); setEditInvoiceDropdownOpen(true); }}
                                      onFocus={() => setEditInvoiceDropdownOpen(true)}
                                      placeholder="search invoices to link..."
                                    />
                                    {editInvoiceDropdownOpen && (
                                      <div style={{ position: "absolute", top: "100%", left: 0, right: 0, background: "#fff", border: "1px solid #e8eaf0", borderRadius: 8, maxHeight: 200, overflowY: "auto", zIndex: 20, marginTop: 4 }}>
                                        {allInvoicesForLinking
                                          .filter((b) => {
                                            if (!editInvoiceSearch.trim()) return true;
                                            const term = editInvoiceSearch.toLowerCase();
                                            return b.providerName.toLowerCase().includes(term) || b.invoiceNumber.toLowerCase().includes(term) || b.invoiceDate.includes(term);
                                          })
                                          .slice(0, 8)
                                          .map((b) => (
                                            <button
                                              key={String(b._id)}
                                              type="button"
                                              style={{ display: "block", width: "100%", textAlign: "left", padding: "8px 12px", border: "none", borderBottom: "1px solid #f0f1f5", background: "transparent", cursor: "pointer", fontSize: 11, color: "#1a1a2e" }}
                                              onClick={() => {
                                                setEditState({ ...editState, billId: String(b._id) });
                                                setEditInvoiceSearch("");
                                                setEditInvoiceDropdownOpen(false);
                                              }}
                                            >
                                              {formatInvoiceName({ providerName: b.providerName, date: b.invoiceDate })}
                                            </button>
                                          ))}
                                        {allInvoicesForLinking.filter((b) => {
                                          if (!editInvoiceSearch.trim()) return true;
                                          const term = editInvoiceSearch.toLowerCase();
                                          return b.providerName.toLowerCase().includes(term) || b.invoiceNumber.toLowerCase().includes(term) || b.invoiceDate.includes(term);
                                        }).length === 0 && (
                                          <div style={{ padding: "12px", fontSize: 11, color: "#9ea2b0", textAlign: "center" }}>no invoices found</div>
                                        )}
                                      </div>
                                    )}
                                  </>
                                )}
                              </div>
                            </ExpandedInput>
                          </>
                        ) : (
                          <>
                            <ExpandedField label="PROVIDER" value={record.providerName} />
                            <ExpandedField label="DATE" value={formatDateLong(record.date)} />
                            <ExpandedField label="NOTES" value={record.notes} />
                            {record.billInfo ? (
                              <div style={{ minWidth: 120 }}>
                                <div style={{ fontSize: 9, color: "#9ea2b0", letterSpacing: "0.05em", textTransform: "uppercase", marginBottom: 4 }}>LINKED INVOICE</div>
                                <Link
                                  href={`/invoices/preview/${record.billInfo.billId}`}
                                  style={{ fontSize: 12, color: "#4A5BDB", textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 4, padding: "4px 10px", border: "1px solid rgba(74, 91, 219, 0.2)", borderRadius: 6 }}
                                  onClick={(event) => event.stopPropagation()}
                                >
                                  📄 {formatInvoiceName({ providerName: record.billInfo.providerName, date: record.billInfo.invoiceDate })}
                                </Link>
                              </div>
                            ) : null}
                          </>
                        )}
                      </div>

                      {record.attachmentUrl ? (
                        <div className={styles.attachmentRow}>
                          <span className={styles.attachmentLabel}>ATTACHMENT</span>
                          <div className={styles.attachmentValue}>
                            <span>📎 {(record as any).attachmentName || "attachment"}</span>
                            <button
                              type="button"
                              className={styles.attachmentLink}
                              onClick={(event) => {
                                event.stopPropagation();
                                window.open(record.attachmentUrl || "", "_blank", "noopener,noreferrer");
                              }}
                            >
                              open
                            </button>
                            <button
                              type="button"
                              className={styles.attachmentLink}
                              onClick={(event) => {
                                event.stopPropagation();
                                const link = document.createElement("a");
                                link.href = record.attachmentUrl || "";
                                link.download = (record as any).attachmentName || "attachment";
                                link.click();
                              }}
                            >
                              download
                            </button>
                          </div>
                        </div>
                      ) : null}

                      <div className={styles.expandedActions}>
                        {editing ? (
                          <>
                            <button
                              type="button"
                              className={styles.expandedEditBtn}
                              onClick={(event) => {
                                event.stopPropagation();
                                void saveEdit();
                              }}
                            >
                              save changes
                            </button>
                            <button
                              type="button"
                              className={styles.expandedCloseBtn}
                              onClick={(event) => {
                                event.stopPropagation();
                                setEditingRecordId(null);
                                setEditState(null);
                              }}
                            >
                              cancel
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              type="button"
                              className={styles.expandedEditBtn}
                              onClick={(event) => {
                                event.stopPropagation();
                                setEditingRecordId(record._id);
                                setEditState({
                                  providerName: record.providerName || "",
                                  date: toDateInput(record.date),
                                  nextVisitDate: getLinkedUpcomingDateInput(record),
                                  notes: record.notes || "",
                                  serviceType: record.serviceType || "",
                                  customType: record.customType || "",
                                  vaccineName: record.vaccineName || "",
                                  treatmentDescription: record.treatmentDescription || "",
                                  billId: record.billId ? String(record.billId) : "",
                                });
                              }}
                            >
                              edit
                            </button>
                            <button
                              type="button"
                              className={styles.expandedCloseBtn}
                              onClick={(event) => {
                                event.stopPropagation();
                                setExpandedId(null);
                              }}
                            >
                              close
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  ) : null}
                </div>
              );
            })
          )}
        </section>

        <div className="ui-footer">OLD_OAK_HORSES // HORSES // {(horse?.name || "HORSE").toUpperCase()} // RECORDS</div>
      </main>

      <Modal open={recordToDelete !== null} title="delete record?" onClose={() => setRecordToDelete(null)}>
        <p className={styles.deleteBody}>
          Are you sure you want to delete "{recordToDelete?.name}"?
          <br />
          This cannot be undone.
        </p>
        <div className={styles.deleteActions}>
          <button type="button" className="ui-button-outlined" onClick={() => setRecordToDelete(null)}>
            cancel
          </button>
          <button type="button" className={styles.deleteButton} onClick={confirmDelete} disabled={isDeleting}>
            {isDeleting ? "deleting..." : "yes, delete"}
          </button>
        </div>
      </Modal>
    </div>
  );
}

function ExpandedField({ label, value }: { label: string; value?: string }) {
  return (
    <div className={styles.expandedField}>
      <div className={styles.expandedFieldLabel}>{label}</div>
      <div className={value ? styles.expandedFieldValue : styles.expandedFieldEmpty}>{value || "—"}</div>
    </div>
  );
}

function ExpandedInput({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className={styles.expandedField}>
      <div className={styles.expandedFieldLabel}>{label}</div>
      {children}
    </div>
  );
}

function getRecordSubtype(record: HorseRecord) {
  if (record.type === "veterinary" && record.visitType) {
    return record.visitType === "vaccination" ? "Vaccination" : "Treatment";
  }
  if (record.type === "farrier" && record.serviceType) {
    return record.serviceType;
  }
  if (record.type === "other" && record.customType) {
    return record.customType;
  }
  return null;
}

function getRecordLabel(record: HorseRecord) {
  const subtype = getRecordSubtype(record);
  if (subtype) return `${pretty(record.type)} — ${subtype}`;
  return pretty(record.type);
}

function getRecordDetail(record: HorseRecord) {
  const detail =
    record.type === "veterinary"
      ? record.visitType === "vaccination"
        ? record.vaccineName
        : record.visitType === "treatment"
          ? record.treatmentDescription
          : undefined
      : record.type === "medication"
        ? record.notes
        : undefined;

  if (record.providerName && detail) return `${record.providerName} · ${detail}`;
  if (record.providerName) return record.providerName;
  if (detail) return detail;
  return "";
}

function filterByDate(dateValue: number, range: DateRange) {
  if (range === "all") return true;
  const now = Date.now();
  const ms: Record<Exclude<DateRange, "all">, number> = {
    "7d": 7 * 86400000,
    "30d": 30 * 86400000,
    "3m": 90 * 86400000,
    "6m": 180 * 86400000,
    "1y": 365 * 86400000,
  };
  return dateValue >= now - ms[range];
}

function pretty(value: string) {
  return value
    .replace(/[-_]+/g, " ")
    .split(" ")
    .filter(Boolean)
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join(" ");
}

function formatDateLong(timestamp: number) {
  return new Date(timestamp).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function toDateInput(timestamp: number) {
  return new Date(timestamp).toISOString().slice(0, 10);
}
