"use client";

import Link from "next/link";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import Modal from "@/components/Modal";
import NavBar from "@/components/NavBar";
import { formatInvoiceName } from "@/lib/formatInvoiceName";
import styles from "./records.module.css";

type RecordType = "veterinary" | "medication" | "farrier" | "bodywork" | "other";
type VetSubcategory =
  | "vaccination" | "treatment" | "medication" | "joint_injections"
  | "exams_diagnostics" | "vaccinations" | "shockwave" | "sedation"
  | "fees" | "lab_work" | "blood_test" | "exam" | "imaging" | "other";

// "exam" + "fees" no longer offered as new selections; legacy values still
// validate against the schema and map to "Exams & Diagnostics" / "Fees" via
// vetSubcategoryLabel below.
const VET_SUBCATEGORY_OPTIONS: Array<{ value: VetSubcategory; label: string }> = [
  { value: "vaccinations", label: "Vaccinations" },
  { value: "joint_injections", label: "Joint Injections" },
  { value: "imaging", label: "Imaging" },
  { value: "lab_work", label: "Lab Work" },
  { value: "blood_test", label: "Blood Test" },
  { value: "shockwave", label: "Shockwave" },
  { value: "sedation", label: "Sedation" },
  { value: "exams_diagnostics", label: "Exams & Diagnostics" },
  { value: "other", label: "Other" },
];

function vetSubcategoryLabel(value?: string | null) {
  if (!value) return null;
  const found = VET_SUBCATEGORY_OPTIONS.find((o) => o.value === value);
  if (found) return found.label;
  if (value === "vaccination") return "Vaccinations";
  if (value === "treatment") return "Treatment";
  // Legacy values no longer in the picker — render under the merged label.
  if (value === "exam") return "Exams & Diagnostics";
  if (value === "fees") return "Fees";
  if (value === "medication") return "Medication";
  return value.replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function getVetVisitTypeLabels(record: { visitType?: string; visitTypes?: string[]; vetOtherDescription?: string }): string[] {
  const types = record.visitTypes?.length ? record.visitTypes : record.visitType ? [record.visitType] : [];
  return types.map((t) => {
    if (t === "other" && record.vetOtherDescription) return record.vetOtherDescription;
    return vetSubcategoryLabel(t) || t;
  });
}

type Tab = "past" | "upcoming";
type SortColumn = "record" | "detail" | "date" | "category";

type HorseRecord = {
  _id: Id<"horseRecords">;
  title?: string;
  type: RecordType;
  customType?: string;
  date: number;
  contactName?: string;
  visitType?: string;
  visitTypes?: string[];
  vetOtherDescription?: string;
  vaccineName?: string;
  treatmentDescription?: string;
  serviceType?: string;
  isUpcoming?: boolean;
  linkedRecordId?: Id<"horseRecords">;
  medications?: string[];
  medicationRepeatValue?: number;
  medicationRepeatUnit?: "days" | "weeks" | "months";
  notes?: string;
  attachmentStorageId?: string;
  attachmentUrl?: string | null;
  billId?: Id<"bills">;
  billInfo?: { billId: Id<"bills">; contactName: string; invoiceDate: string } | null;
};

type EditState = {
  title: string;
  type: RecordType;
  visitType: "" | VetSubcategory;
  visitTypes: VetSubcategory[];
  vetOtherDescription: string;
  contactName: string;
  date: string;
  nextVisitDate: string;
  notes: string;
  serviceType: string;
  customType: string;
  vaccineName: string;
  treatmentDescription: string;
  medications: string[];
  medicationRepeatValue: string;
  medicationRepeatUnit: "" | "days" | "weeks" | "months";
  billId: string;
};

const RECORD_CATEGORY_COLORS: Record<RecordType, { bg: string; color: string }> = {
  veterinary: { bg: "rgba(74,91,219,0.08)", color: "#4A5BDB" },
  medication: { bg: "rgba(34,197,131,0.08)", color: "#22C583" },
  farrier: { bg: "rgba(20,184,166,0.08)", color: "#14B8A6" },
  bodywork: { bg: "rgba(167,139,250,0.08)", color: "#A78BFA" },
  other: { bg: "#F0F1F5", color: "#6B7084" },
};

const RECORD_TYPE_TO_CATEGORY: Record<RecordType, string> = {
  veterinary: "veterinary",
  medication: "veterinary",
  farrier: "farrier",
  bodywork: "bodywork",
  other: "",
};

const MEDICATION_OPTIONS = [
  "adequan", "aspirin", "banamine", "bute", "dexamethasone",
  "gastroguard", "gentamicin", "ketofen", "legend", "marquis", "metacam",
  "pentosan", "traumeel", "other",
];

export default function HorseRecordsPage() {
  const params = useParams<{ horseId: string }>();
  const horseId = params?.horseId as Id<"horses">;
  const searchParams = useSearchParams();
  const focusRecordId = searchParams?.get("focus") || null;

  const horse = useQuery(api.horses.getHorseById, horseId ? { horseId } : "skip");
  // Medications live on /meds (and the horse profile's MEDS tile), so we
  // filter them out of the per-horse records page to avoid duplication.
  // Two flavors to drop:
  //   - top-level type === "medication" (the new shape)
  //   - legacy veterinary records whose visitType / visitTypes is
  //     "medication" (pre-migration data that still resolves to a
  //     "Medication" label)
  const allRecordsRaw = (useQuery(api.horseRecords.getAllByHorse, horseId ? { horseId } : "skip") as HorseRecord[] | undefined) ?? [];
  const allRecords = useMemo(
    () => allRecordsRaw.filter((r) => {
      if (r.type === "medication") return false;
      const visitTypes = r.visitTypes?.length ? r.visitTypes : r.visitType ? [r.visitType] : [];
      if (visitTypes.includes("medication")) return false;
      return true;
    }),
    [allRecordsRaw],
  );

  const allInvoicesForLinking = useQuery(api.bills.listForLinking) ?? [];
  const allContactsForRecord = useQuery(api.contacts.getAllContacts) ?? [];
  const updateRecordWithNextVisit = useMutation(api.horseRecords.updateRecordWithNextVisit);
  const deleteHorseRecord = useMutation(api.horseRecords.deleteHorseRecord);
  const generateUploadUrl = useMutation(api.bills.generateUploadUrl);
  const findOrCreateContact = useMutation(api.contacts.findOrCreateContact);

  const [activeTab, setActiveTab] = useState<Tab>("past");
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<"all" | RecordType>("all");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const filtersPopoverRef = useRef<HTMLDivElement | null>(null);
  const [sortColumn, setSortColumn] = useState<SortColumn>("date");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");

  const [expandedId, setExpandedId] = useState<Id<"horseRecords"> | null>(null);
  const [menuOpenId, setMenuOpenId] = useState<Id<"horseRecords"> | null>(null);
  const [editingRecordId, setEditingRecordId] = useState<Id<"horseRecords"> | null>(null);
  const [editState, setEditState] = useState<EditState | null>(null);
  const [recordToDelete, setRecordToDelete] = useState<{ id: Id<"horseRecords">; name: string } | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  /** Newly-queued files to upload on save. Stacks alongside the
   *  existing attachments — those live in editKeptAttachments. */
  const [editNewAttachments, setEditNewAttachments] = useState<File[]>([]);
  /** Existing attachments on the record that the user wants to keep.
   *  Removing a chip drops the entry. Save persists this list (plus any
   *  newly-uploaded files) onto the record. */
  const [editKeptAttachments, setEditKeptAttachments] = useState<Array<{ storageId: string; name: string; mimeType?: string }>>([]);
  const editFileRef = useRef<HTMLInputElement>(null);
  const [editProviderDropdownOpen, setEditProviderDropdownOpen] = useState(false);
  const editContactDropdownRef = useRef<HTMLDivElement | null>(null);
  const [editInvoiceSearch, setEditInvoiceSearch] = useState("");
  const [editInvoiceDropdownOpen, setEditInvoiceDropdownOpen] = useState(false);
  const [editSubcatDropdownOpen, setEditSubcatDropdownOpen] = useState(false);
  const editSubcatDropdownRef = useRef<HTMLDivElement | null>(null);
  const dropdownJustOpened = useRef(false);

  useEffect(() => {
    setSortColumn("date");
    setSortDirection(activeTab === "upcoming" ? "asc" : "desc");
  }, [activeTab]);

  // When linked from the all-records page with ?focus=<recordId>, expand
  // that record and scroll it into view once data is loaded.
  useEffect(() => {
    if (!focusRecordId || !allRecordsRaw.length) return;
    const match = allRecordsRaw.find((r) => r._id === focusRecordId);
    if (!match) return;
    setExpandedId(match._id);
    // Defer scroll until after the expanded row paints.
    requestAnimationFrame(() => {
      const el = document.getElementById(`record-${match._id}`);
      el?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  }, [focusRecordId, allRecordsRaw]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (editContactDropdownRef.current && !editContactDropdownRef.current.contains(event.target as Node)) {
        setEditProviderDropdownOpen(false);
      }
      if (editSubcatDropdownRef.current && !editSubcatDropdownRef.current.contains(event.target as Node)) {
        setEditSubcatDropdownOpen(false);
      }
      if (filtersPopoverRef.current && !filtersPopoverRef.current.contains(event.target as Node)) {
        setFiltersOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const todayEnd = useMemo(() => {
    const d = new Date();
    d.setHours(23, 59, 59, 999);
    return d.getTime();
  }, []);

  const upcomingRecords = useMemo(() => allRecords.filter((r) => r.date > todayEnd), [allRecords, todayEnd]);
  const pastRecords = useMemo(() => allRecords.filter((r) => r.date <= todayEnd), [allRecords, todayEnd]);
  const tabRecords = activeTab === "upcoming" ? upcomingRecords : pastRecords;

  const filteredRecords = useMemo(() => {
    const term = search.trim().toLowerCase();
    const fromTs = fromDate ? new Date(`${fromDate}T00:00:00`).getTime() : null;
    const toTs = toDate ? new Date(`${toDate}T23:59:59.999`).getTime() : null;

    return tabRecords.filter((record) => {
      if (typeFilter !== "all") {
        if (typeFilter === "veterinary") {
          if (record.type !== "veterinary" && record.type !== "medication") return false;
        } else if (record.type !== typeFilter) return false;
      }
      if (fromTs !== null && record.date < fromTs) return false;
      if (toTs !== null && record.date > toTs) return false;

      if (!term) return true;
      const bag = [
        record.title,
        record.type,
        record.contactName,
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
  }, [tabRecords, search, typeFilter, fromDate, toDate]);

  const sortedRecords = useMemo(() => {
    const rows = [...filteredRecords];
    rows.sort((a, b) => {
      let cmp = 0;
      switch (sortColumn) {
        case "record":
          cmp = getRecordLabel(a).localeCompare(getRecordLabel(b));
          break;
        case "detail":
          cmp = getRecordSubtitle(a).localeCompare(getRecordSubtitle(b));
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

  function handleSort(column: SortColumn) {
    const defaultDirection = activeTab === "upcoming" ? "asc" : "desc";
    const secondaryDirection = defaultDirection === "asc" ? "desc" : "asc";
    if (sortColumn === column) {
      if (sortDirection === defaultDirection) {
        setSortDirection(secondaryDirection);
      } else {
        setSortColumn("date");
        setSortDirection(defaultDirection);
      }
      return;
    }
    setSortColumn(column);
    setSortDirection(column === "date" ? defaultDirection : "asc");
  }

  function sortArrow(col: SortColumn) {
    if (sortColumn !== col) return " ↕";
    return sortDirection === "asc" ? " ↑" : " ↓";
  }

  function openDropdown(setter: (updater: (prev: boolean) => boolean) => void) {
    setter((prev) => {
      if (!prev) {
        dropdownJustOpened.current = true;
        requestAnimationFrame(() => { dropdownJustOpened.current = false; });
      }
      return !prev;
    });
  }

  function getLinkedUpcomingDateInput(record: HorseRecord) {
    if (record.isUpcoming || !record.linkedRecordId) return "";
    const linked = allRecords.find((row) => row._id === record.linkedRecordId);
    return typeof linked?.date === "number" ? toDateInput(linked.date) : "";
  }

  async function saveEdit() {
    if (!editingRecordId || !editState) return;
    const editProviderName = editState.contactName?.trim() || undefined;
    let editContactId: Id<"contacts"> | undefined;
    if (editProviderName) {
      const category = RECORD_TYPE_TO_CATEGORY[editState.type] || "other";
      const contactId = await findOrCreateContact({ name: editProviderName, category });
      if (contactId) editContactId = contactId;
    }
    const nextVisitTimestamp = editState.nextVisitDate ? new Date(`${editState.nextVisitDate}T00:00:00`).getTime() : undefined;

    // Upload every newly-queued file in parallel, then merge with the
    // existing kept attachments. The backend's updateRecordWithNextVisit
    // accepts the full attachments array — when present, it replaces the
    // record's attachments entirely (and schedules Dropbox uploads only
    // for new storage ids).
    const newlyUploaded = await Promise.all(
      editNewAttachments.map(async (file) => {
        const uploadUrl = await generateUploadUrl();
        const resp = await fetch(uploadUrl, {
          method: "POST",
          headers: { "Content-Type": file.type || "application/octet-stream" },
          body: file,
        });
        if (!resp.ok) throw new Error(`Failed to upload ${file.name}`);
        const payload = await resp.json();
        const storageId = typeof payload.storageId === "string" ? payload.storageId : undefined;
        if (!storageId) throw new Error(`Upload of ${file.name} returned no storage id`);
        return { storageId, name: file.name, mimeType: file.type || undefined };
      }),
    );
    const mergedAttachments = [...editKeptAttachments, ...newlyUploaded];

    await updateRecordWithNextVisit({
      recordId: editingRecordId,
      updates: {
        title: editState.title.trim() || undefined,
        type: editState.type,
        visitType: editState.type === "veterinary" && editState.visitTypes.length > 0 ? editState.visitTypes[0] : undefined,
        visitTypes: editState.type === "veterinary" && editState.visitTypes.length > 0 ? editState.visitTypes : undefined,
        vetOtherDescription: editState.type === "veterinary" && editState.visitTypes.includes("other") ? editState.vetOtherDescription || undefined : undefined,
        contactName: editProviderName,
        contactId: editContactId,
        date: editState.date ? new Date(`${editState.date}T00:00:00`).getTime() : undefined,
        notes: editState.notes || undefined,
        serviceType: editState.type === "farrier" ? editState.serviceType || undefined : undefined,
        customType: editState.type === "other" ? editState.customType || undefined : undefined,
        vaccineName: editState.vaccineName || undefined,
        treatmentDescription: editState.treatmentDescription || undefined,
        medications: editState.medications.length > 0 ? editState.medications : undefined,
        medicationRepeatValue: editState.medications.length > 0 && editState.medicationRepeatValue ? parseInt(editState.medicationRepeatValue, 10) : undefined,
        medicationRepeatUnit: editState.medications.length > 0 && editState.medicationRepeatUnit ? editState.medicationRepeatUnit : undefined,
        billId: editState.billId ? editState.billId as Id<"bills"> : undefined,
        attachments: mergedAttachments,
      },
      nextVisitDate: nextVisitTimestamp,
    });
    setEditingRecordId(null);
    setEditState(null);
    setEditNewAttachments([]);
    setEditKeptAttachments([]);
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

  const totalCount = tabRecords.length;
  const filteredCount = filteredRecords.length;

  if (!horse) {
    return (
      <div className="page-shell">
        <main className="page-main">
          <section className="ui-card">loading records...</section>
        </main>
      </div>
    );
  }

  const categoryLabel = typeFilter === "all" ? null : prettyType(typeFilter as RecordType);
  const dateLabel = fromDate || toDate ? `${fromDate || "…"} → ${toDate || "…"}` : null;
  const activeFilterCount = [categoryLabel, dateLabel].filter(Boolean).length;

  return (
    <div className="page-shell">
      <NavBar
        items={[
          { label: "team-ldk", href: "/dashboard", brand: true },
          { label: "horses", href: "/horses" },
          { label: horse.name, href: `/horses/${horse._id}` },
          { label: "records", current: true },
        ]}
        actions={[]}
      />

      <main className="page-main">
        <Link href={`/horses/${horse._id}`} className="ui-back-link">
          ← cd /{horse.name}
        </Link>

        <section className={styles.headerRow}>
          <div>
            <h1 className={styles.title}>{horse.name} records</h1>
          </div>
        </section>

        <div className={styles.tabs} role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "past"}
            className={`${styles.tab} ${activeTab === "past" ? styles.tabActive : ""}`}
            onClick={() => setActiveTab("past")}
          >
            Past <span className={styles.tabCount}>{pastRecords.length}</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "upcoming"}
            className={`${styles.tab} ${activeTab === "upcoming" ? styles.tabActive : ""}`}
            onClick={() => setActiveTab("upcoming")}
          >
            Upcoming <span className={styles.tabCount}>{upcomingRecords.length}</span>
          </button>
        </div>

        <section className={styles.toolbar}>
          <input
            type="text"
            className={styles.toolbarSearch}
            placeholder="search records..."
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <div className={styles.toolbarFiltersWrap} ref={filtersPopoverRef}>
            <button
              type="button"
              className={`${styles.toolbarFiltersBtn} ${activeFilterCount > 0 ? styles.toolbarFiltersBtnActive : ""}`}
              onClick={() => setFiltersOpen((v) => !v)}
              aria-expanded={filtersOpen}
            >
              <span>filters</span>
              {activeFilterCount > 0 ? <span className={styles.toolbarFiltersCount}>{activeFilterCount}</span> : null}
              <span className={styles.toolbarFiltersChevron}>▾</span>
            </button>
            {filtersOpen ? (
              <div className={styles.toolbarFiltersPopover} role="dialog">
                <label className={styles.popField}>
                  <span>Category</span>
                  <select
                    value={typeFilter}
                    onChange={(event) => setTypeFilter(event.target.value as "all" | RecordType)}
                  >
                    <option value="all">All</option>
                    <option value="veterinary">Veterinary</option>
                    <option value="farrier">Farrier</option>
                    <option value="bodywork">Bodywork</option>
                    <option value="other">Other</option>
                  </select>
                </label>
                <div className={styles.popFieldRow}>
                  <label className={styles.popField}>
                    <span>From</span>
                    <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
                  </label>
                  <label className={styles.popField}>
                    <span>To</span>
                    <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
                  </label>
                </div>
                {activeFilterCount > 0 ? (
                  <button
                    type="button"
                    className={styles.popClearBtn}
                    onClick={() => {
                      setTypeFilter("all");
                      setFromDate("");
                      setToDate("");
                    }}
                  >
                    clear all
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>
        </section>

        {activeFilterCount > 0 ? (
          <div className={styles.filterChips}>
            {categoryLabel ? (
              <button type="button" className={styles.filterChip} onClick={() => setTypeFilter("all")}>
                category: {categoryLabel} <span className={styles.filterChipX}>×</span>
              </button>
            ) : null}
            {dateLabel ? (
              <button type="button" className={styles.filterChip} onClick={() => { setFromDate(""); setToDate(""); }}>
                date: {dateLabel} <span className={styles.filterChipX}>×</span>
              </button>
            ) : null}
          </div>
        ) : null}

        <div className={styles.resultsCount}>
          {filteredCount === totalCount
            ? `showing ${filteredCount} ${activeTab} records`
            : `showing ${filteredCount} of ${totalCount} ${activeTab} records`}
        </div>

        <section className={styles.recordsCard}>
          <div className={styles.tableHeader}>
            <span className={`${styles.colRecord} ${styles.sortableHeader}`} onClick={() => handleSort("record")}>Record{sortArrow("record")}</span>
            <span className={`${styles.colSubtitle} ${styles.sortableHeader}`} onClick={() => handleSort("detail")}>Contact{sortArrow("detail")}</span>
            <span className={`${styles.colDate} ${styles.sortableHeader}`} onClick={() => handleSort("date")}>Date{sortArrow("date")}</span>
            <span className={`${styles.colCategory} ${styles.sortableHeader}`} onClick={() => handleSort("category")}>Category{sortArrow("category")}</span>
          </div>

          {sortedRecords.length === 0 ? (
            <div className={styles.emptyState}>
              {totalCount === 0 ? (
                activeTab === "upcoming" ? (
                  <>
                    <div className={styles.emptyTitle}>no upcoming records</div>
                    <div className={styles.emptySub}>schedule visits from the dashboard</div>
                  </>
                ) : (
                  <>
                    <div className={styles.emptyTitle}>no past records</div>
                    <div className={styles.emptySub}>records will appear here after events occur</div>
                  </>
                )
              ) : (
                <>
                  <div className={styles.emptyTitle}>no records found</div>
                  <div className={styles.emptySub}>try adjusting your filters</div>
                </>
              )}
            </div>
          ) : (
            sortedRecords.map((record) => {
              const expanded = expandedId === record._id;
              const editing = editingRecordId === record._id && editState !== null;
              const badgeColors = RECORD_CATEGORY_COLORS[record.type];
              const dateSoon = activeTab === "upcoming" && daysUntil(record.date) <= 3;
              const subtitle = getRecordSubtitle(record);

              return (
                <div key={record._id} id={`record-${record._id}`}>
                  <div
                    className={`${styles.recordRow} ${expanded ? styles.recordRowExpanded : ""}`}
                    onClick={() => {
                      setExpandedId((prev) => (prev === record._id ? null : record._id));
                      setMenuOpenId(null);
                      setEditingRecordId(null);
                      setEditState(null);
                      setEditNewAttachments([]);
                      setEditKeptAttachments([]);
                    }}
                  >
                    <span className={styles.colRecord}>
                      <span className={styles.recordIcon}>{recordIcon(record.type)}</span>
                      <span className={styles.recordLabel}>{getRecordLabel(record)}</span>
                      {activeTab === "upcoming" && record.linkedRecordId ? <span className={styles.followupBadge}>f/u</span> : null}
                    </span>
                    <span className={styles.colSubtitle}>{subtitle || <span className={styles.muted}>—</span>}</span>
                    <span className={`${styles.colDate} ${dateSoon ? styles.recordDateSoon : ""}`}>{formatDateShort(record.date)}</span>
                    <span className={styles.colCategory}>
                      <span className={styles.categoryBadge} style={{ background: badgeColors.bg, color: badgeColors.color }}>
                        {prettyType(record.type)}
                      </span>
                    </span>
                  </div>

                  {expanded ? (
                    <div className={styles.recordExpanded}>
                      <div className={styles.expandedFields}>
                        {editing ? (
                          <>
                            <ExpandedInput label="TITLE">
                              <input
                                className={styles.expandedInput}
                                value={editState.title}
                                onClick={(event) => event.stopPropagation()}
                                onChange={(event) => setEditState({ ...editState, title: event.target.value })}
                                placeholder="e.g., Spring Vaccinations"
                              />
                            </ExpandedInput>
                            <ExpandedInput label="CONTACT">
                              <div className={styles.contactSearchWrap} ref={editContactDropdownRef}>
                                <input
                                  className={styles.expandedInput}
                                  value={editState.contactName}
                                  onChange={(event) => {
                                    setEditState({ ...editState, contactName: event.target.value });
                                    setEditProviderDropdownOpen(true);
                                  }}
                                  onFocus={() => setEditProviderDropdownOpen(true)}
                                />
                                {editProviderDropdownOpen && (() => {
                                  const editCategory = RECORD_TYPE_TO_CATEGORY[editState.type] || "";
                                  const editPool = editCategory ? allContactsForRecord.filter((c: any) => c.category === editCategory) : allContactsForRecord;
                                  const term = editState.contactName.trim().toLowerCase();
                                  const matches = term ? editPool.filter((c) => c.name.toLowerCase().includes(term)) : editPool;
                                  const exactMatch = matches.some((c) => c.name.toLowerCase() === term);
                                  return (
                                    <div className={styles.contactDropdown}>
                                      {matches.slice(0, 8).map((c) => (
                                        <button
                                          type="button"
                                          key={c._id}
                                          className={styles.contactDropdownItem}
                                          onClick={() => {
                                            setEditState({ ...editState, contactName: c.name });
                                            setEditProviderDropdownOpen(false);
                                          }}
                                        >
                                          {c.name}
                                        </button>
                                      ))}
                                      {term && !exactMatch ? (
                                        <button
                                          type="button"
                                          className={`${styles.contactDropdownItem} ${styles.contactDropdownAdd}`}
                                          onClick={() => setEditProviderDropdownOpen(false)}
                                        >
                                          + Add &ldquo;{editState.contactName.trim()}&rdquo;
                                        </button>
                                      ) : null}
                                    </div>
                                  );
                                })()}
                              </div>
                            </ExpandedInput>
                            <ExpandedInput label="DATE">
                              <input
                                className={styles.expandedInput}
                                type="date"
                                value={editState.date}
                                onChange={(event) => setEditState({ ...editState, date: event.target.value })}
                              />
                            </ExpandedInput>
                            <ExpandedInput label="CATEGORY">
                              <select
                                className={styles.expandedInput}
                                value={editState.type}
                                onChange={(event) => setEditState({ ...editState, type: event.target.value as RecordType, visitType: "", visitTypes: [], serviceType: "", customType: event.target.value === "other" ? editState.customType : "", medications: [], medicationRepeatValue: "", medicationRepeatUnit: "" })}
                              >
                                <option value="veterinary">Veterinary</option>
                                <option value="farrier">Farrier</option>
                                <option value="bodywork">Bodywork</option>
                                <option value="other">Other</option>
                              </select>
                            </ExpandedInput>
                            {editState.type === "veterinary" ? (
                              <>
                                <ExpandedInput label="SUBCATEGORY">
                                  <div className={styles.multiSelectContainer} ref={editSubcatDropdownRef}>
                                    <div
                                      className={`${styles.multiSelectInput} ${editSubcatDropdownOpen ? styles.multiSelectInputOpen : ""}`}
                                      onClick={(event) => { event.stopPropagation(); openDropdown(setEditSubcatDropdownOpen); }}
                                    >
                                      {editState.visitTypes.length > 0 ? (
                                        editState.visitTypes.map((vt) => {
                                          const label = VET_SUBCATEGORY_OPTIONS.find((o) => o.value === vt)?.label ?? vt;
                                          return (
                                            <span key={vt} className={styles.horsePill}>
                                              {label}
                                              <button type="button" className={styles.horsePillRemove} onClick={(e) => { e.stopPropagation(); setEditState({ ...editState, visitTypes: editState.visitTypes.filter((v) => v !== vt) }); }}>✕</button>
                                            </span>
                                          );
                                        })
                                      ) : (
                                        <span className={styles.multiSelectPlaceholder}>select subcategory...</span>
                                      )}
                                      <span className={styles.multiSelectCaret}>▼</span>
                                    </div>
                                    {editSubcatDropdownOpen ? (
                                      <div className={styles.multiSelectDropdown}>
                                        {VET_SUBCATEGORY_OPTIONS.map((opt) => {
                                          const checked = editState.visitTypes.includes(opt.value);
                                          return (
                                            <button type="button" key={opt.value} className={styles.multiSelectOption} onClick={(e) => { e.stopPropagation(); if (dropdownJustOpened.current) return; setEditState({ ...editState, visitTypes: checked ? editState.visitTypes.filter((v) => v !== opt.value) : [...editState.visitTypes, opt.value] }); }}>
                                              <span className={`${styles.checkbox} ${checked ? styles.checkboxChecked : styles.checkboxUnchecked}`}>✓</span>
                                              <span>{opt.label}</span>
                                            </button>
                                          );
                                        })}
                                      </div>
                                    ) : null}
                                  </div>
                                </ExpandedInput>
                                {editState.visitTypes.includes("medication") ? (
                                  <ExpandedInput label="MEDICATION(S)">
                                    <div className={styles.chipRow}>
                                      {MEDICATION_OPTIONS.map((med) => {
                                        const active = editState.medications.includes(med);
                                        return (
                                          <button type="button" key={med} className={`${styles.serviceChip} ${active ? styles.serviceChipActive : ""}`} onClick={(e) => { e.stopPropagation(); setEditState({ ...editState, medications: active ? editState.medications.filter((m) => m !== med) : [...editState.medications, med] }); }}>
                                            {med}
                                          </button>
                                        );
                                      })}
                                    </div>
                                  </ExpandedInput>
                                ) : null}
                                {editState.medications.length > 0 ? (
                                  <ExpandedInput label="REPEAT">
                                    <div className={styles.repeatRow}>
                                      <input className={styles.repeatNumberInput} type="number" min="1" value={editState.medicationRepeatValue} onChange={(e) => setEditState({ ...editState, medicationRepeatValue: e.target.value })} placeholder="#" />
                                      <select className={styles.repeatUnitSelect} value={editState.medicationRepeatUnit} onChange={(e) => setEditState({ ...editState, medicationRepeatUnit: e.target.value as "" | "days" | "weeks" | "months" })}>
                                        <option value="">select...</option>
                                        <option value="days">Days</option>
                                        <option value="weeks">Weeks</option>
                                        <option value="months">Months</option>
                                      </select>
                                    </div>
                                  </ExpandedInput>
                                ) : null}
                                {editState.visitTypes.includes("other") ? (
                                  <ExpandedInput label="DESCRIBE OTHER">
                                    <input
                                      className={styles.expandedInput}
                                      value={editState.vetOtherDescription}
                                      onClick={(event) => event.stopPropagation()}
                                      onChange={(event) => setEditState({ ...editState, vetOtherDescription: event.target.value })}
                                      placeholder="e.g., Dental, Chiropractic"
                                    />
                                  </ExpandedInput>
                                ) : null}
                              </>
                            ) : null}
                            {editState.type === "other" ? (
                              <ExpandedInput label="DESCRIBE CATEGORY">
                                <input
                                  className={styles.expandedInput}
                                  value={editState.customType}
                                  onChange={(event) => setEditState({ ...editState, customType: event.target.value })}
                                  placeholder="e.g., Dentist, Chiropractor"
                                />
                              </ExpandedInput>
                            ) : null}
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
                            <ExpandedInput label={editKeptAttachments.length + editNewAttachments.length > 1 ? "ATTACHMENTS" : "ATTACHMENT"}>
                              <>
                                <input
                                  ref={editFileRef}
                                  type="file"
                                  multiple
                                  style={{ display: "none" }}
                                  accept=".pdf,.jpg,.jpeg,.png,.mp4,.mov,.webm"
                                  onChange={(event) => {
                                    const picked = Array.from(event.target.files ?? []);
                                    if (picked.length === 0) return;
                                    setEditNewAttachments((prev) => [...prev, ...picked]);
                                    if (editFileRef.current) editFileRef.current.value = "";
                                  }}
                                />
                                {/* Existing files on the record — removable. */}
                                {editKeptAttachments.map((a, idx) => (
                                  <div key={`kept-${a.storageId}-${idx}`} className={styles.editAttachmentRow}>
                                    <span className={styles.editAttachmentName}>📎 {a.name}</span>
                                    <button
                                      type="button"
                                      className={styles.editAttachmentRemove}
                                      onClick={() => setEditKeptAttachments((prev) => prev.filter((_, i) => i !== idx))}
                                    >
                                      ✕
                                    </button>
                                  </div>
                                ))}
                                {/* New files queued this edit session. */}
                                {editNewAttachments.map((file, idx) => (
                                  <div key={`new-${file.name}-${idx}`} className={styles.editAttachmentRow}>
                                    <span className={styles.editAttachmentName}>📎 {file.name}</span>
                                    <button
                                      type="button"
                                      className={styles.editAttachmentRemove}
                                      onClick={() => setEditNewAttachments((prev) => prev.filter((_, i) => i !== idx))}
                                    >
                                      ✕
                                    </button>
                                  </div>
                                ))}
                                <button
                                  type="button"
                                  className={styles.editAttachmentBtn}
                                  onClick={() => editFileRef.current?.click()}
                                >
                                  + add attachment
                                </button>
                              </>
                            </ExpandedInput>
                            <ExpandedInput label="LINKED INVOICE">
                              <div className={styles.invoiceSearchWrap}>
                                {editState.billId ? (
                                  <div className={styles.invoiceSelected}>
                                    <span className={styles.invoiceSelectedName}>
                                      {(() => {
                                        const linked = allInvoicesForLinking.find((b) => String(b._id) === editState.billId);
                                        return linked ? formatInvoiceName({ contactName: linked.contactName, date: linked.invoiceDate }) : "linked invoice";
                                      })()}
                                    </span>
                                    <button type="button" className={styles.invoiceClearBtn} onClick={() => setEditState({ ...editState, billId: "" })}>✕</button>
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
                                      <div className={styles.invoiceDropdown}>
                                        {allInvoicesForLinking
                                          .filter((b) => {
                                            if (!editInvoiceSearch.trim()) return true;
                                            const term = editInvoiceSearch.toLowerCase();
                                            return b.contactName.toLowerCase().includes(term) ||
                                              b.invoiceNumber.toLowerCase().includes(term) ||
                                              b.invoiceDate.includes(term);
                                          })
                                          .slice(0, 8)
                                          .map((b) => (
                                            <button
                                              key={String(b._id)}
                                              type="button"
                                              className={styles.invoiceDropdownItem}
                                              onClick={() => {
                                                setEditState({ ...editState, billId: String(b._id) });
                                                setEditInvoiceSearch("");
                                                setEditInvoiceDropdownOpen(false);
                                              }}
                                            >
                                              {formatInvoiceName({ contactName: b.contactName, date: b.invoiceDate })}
                                            </button>
                                          ))}
                                        {allInvoicesForLinking.filter((b) => {
                                          if (!editInvoiceSearch.trim()) return true;
                                          const term = editInvoiceSearch.toLowerCase();
                                          return b.contactName.toLowerCase().includes(term) || b.invoiceNumber.toLowerCase().includes(term) || b.invoiceDate.includes(term);
                                        }).length === 0 && (
                                          <div className={styles.invoiceDropdownEmpty}>no invoices found</div>
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
                            <div className={styles.expandedMetaRow}>
                              <ExpandedField label="CONTACT" value={record.contactName} />
                              <ExpandedField label="DATE" value={formatDateLong(record.date)} />
                            </div>
                            {record.notes ? (
                              <div className={styles.expandedNotesBlock}>
                                <div className={styles.expandedFieldLabel}>NOTES</div>
                                <div className={styles.expandedNotesText}>{record.notes}</div>
                              </div>
                            ) : null}
                            {record.billInfo ? (
                              <div className={styles.expandedFieldRow}>
                                <span className={styles.expandedFieldLabel}>LINKED INVOICE</span>
                                <Link
                                  href={`/invoices/preview/${record.billInfo.billId}`}
                                  className={styles.invoiceLink}
                                  onClick={(event) => event.stopPropagation()}
                                >
                                  📄 {formatInvoiceName({ contactName: record.billInfo.contactName, date: record.billInfo.invoiceDate })}
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
                                setEditNewAttachments([]);
                                setEditKeptAttachments([]);
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
                                const remappedType = record.type === "medication" ? "veterinary" : record.type;
                                const baseVisitTypes = (record.visitTypes?.length ? record.visitTypes : record.visitType ? [record.visitType] : []) as VetSubcategory[];
                                const visitTypes = record.type === "medication" && !baseVisitTypes.includes("medication" as VetSubcategory)
                                  ? [...baseVisitTypes, "medication" as VetSubcategory]
                                  : baseVisitTypes;
                                setEditState({
                                  title: record.title || "",
                                  type: remappedType,
                                  visitType: (record.visitType || "") as "" | VetSubcategory,
                                  visitTypes,
                                  vetOtherDescription: record.vetOtherDescription || "",
                                  contactName: record.contactName || "",
                                  date: toDateInput(record.date),
                                  nextVisitDate: getLinkedUpcomingDateInput(record),
                                  notes: record.notes || "",
                                  serviceType: record.serviceType || "",
                                  customType: record.customType || "",
                                  vaccineName: record.vaccineName || "",
                                  treatmentDescription: record.treatmentDescription || "",
                                  medications: record.medications || [],
                                  medicationRepeatValue: record.medicationRepeatValue ? String(record.medicationRepeatValue) : "",
                                  medicationRepeatUnit: (record.medicationRepeatUnit || "") as "" | "days" | "weeks" | "months",
                                  billId: record.billId ? String(record.billId) : "",
                                });
                                // Seed the kept-attachment chips from the record's
                                // existing attachments[]; fall back to the legacy
                                // single-attachment fields for older rows.
                                const existing = Array.isArray((record as any).attachmentUrls) && (record as any).attachmentUrls.length > 0
                                  ? (record as any).attachmentUrls.map((a: any) => ({
                                      storageId: String(a.storageId),
                                      name: String(a.name),
                                      mimeType: a.mimeType,
                                    }))
                                  : (record.attachmentStorageId
                                      ? [{
                                          storageId: String(record.attachmentStorageId),
                                          name: String((record as any).attachmentName || "attachment"),
                                          mimeType: undefined,
                                        }]
                                      : []);
                                setEditKeptAttachments(existing);
                                setEditNewAttachments([]);
                              }}
                            >
                              edit
                            </button>
                            <button
                              type="button"
                              className={styles.expandedDeleteBtn}
                              onClick={(event) => {
                                event.stopPropagation();
                                setRecordToDelete({ id: record._id, name: getRecordLabel(record) });
                              }}
                            >
                              delete
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

        <div className="ui-footer">TEAM_LDK // HORSES // {horse.name.toUpperCase()} // RECORDS</div>
      </main>

      <Modal open={recordToDelete !== null} title="delete record?" onClose={() => setRecordToDelete(null)}>
        <p className={styles.deleteBody}>
          Are you sure you want to delete &ldquo;{recordToDelete?.name}&rdquo;?
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
  if (record.type === "veterinary") {
    const labels = getVetVisitTypeLabels(record);
    if (labels.length > 0) return labels.join(", ");
  }
  if (record.type === "farrier" && record.serviceType) return record.serviceType;
  if (record.type === "other" && record.customType) return record.customType;
  return null;
}

function getRecordSubtitle(record: HorseRecord): string {
  if (record.contactName) return record.contactName;
  if (record.type === "medication") {
    return record.medications?.length ? record.medications.join(", ") : "";
  }
  return "";
}

function getRecordLabel(record: HorseRecord) {
  if (record.title) return record.title;
  if (record.type === "veterinary") {
    const labels = getVetVisitTypeLabels(record);
    if (labels.length > 0) return labels.join(", ");
    return "Veterinary";
  }
  const subtype = getRecordSubtype(record);
  if (subtype) return subtype;
  return prettyType(record.type);
}

function recordIcon(type: RecordType) {
  if (type === "veterinary") return "🩺";
  if (type === "medication") return "💊";
  if (type === "farrier") return "🔧";
  if (type === "bodywork") return "🦴";
  return "📋";
}

function prettyType(type: RecordType) {
  if (type === "bodywork") return "Bodywork";
  return type.charAt(0).toUpperCase() + type.slice(1);
}

function formatDateLong(timestamp: number) {
  return new Date(timestamp).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function formatDateShort(timestamp: number) {
  const d = new Date(timestamp);
  const m = (d.getMonth() + 1).toString().padStart(2, "0");
  const day = d.getDate().toString().padStart(2, "0");
  const y = d.getFullYear().toString().slice(2);
  return `${m}/${day}/${y}`;
}

function toDateInput(timestamp: number) {
  return new Date(timestamp).toISOString().slice(0, 10);
}

function daysUntil(timestamp: number) {
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const target = new Date(timestamp);
  target.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - startOfToday.getTime()) / 86400000);
}
