"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import Modal from "@/components/Modal";
import NavBar from "@/components/NavBar";
import { formatInvoiceName } from "@/lib/formatInvoiceName";
import styles from "./records.module.css";

type RecordType = "veterinary" | "medication" | "farrier" | "bodywork" | "other";
type Tab = "upcoming" | "past";
type SortColumn = "record" | "horse" | "provider" | "category" | "date";
type UpcomingRange = "all" | "7d" | "30d" | "3m" | "6m";
type PastRange = "all" | "7d" | "30d" | "3m" | "6m" | "1y";

type GlobalRecord = {
  _id: Id<"horseRecords">;
  horseId: Id<"horses">;
  horseName: string;
  horse: { _id: Id<"horses">; name: string; status: "active" | "inactive" | "past" } | null;
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

type DisplayRecord = {
  base: GlobalRecord;
  eventDate: number;
  isFollowup: boolean;
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

type RecordFormState = {
  horseIds: Id<"horses">[];
  date: string;
  selectedProvider: string;
  providerName: string;
  customType: string;
  visitType: "" | "vaccination" | "treatment";
  vaccineName: string;
  treatmentDescription: string;
  serviceType: string;
  nextVisitDate: string;
  notes: string;
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

const farrierServiceTypes = ["Full Set", "Reset", "Trim", "Front Only", "Other"];

function getTodayDate() {
  return new Date().toISOString().split("T")[0];
}

function slugifyPart(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function buildAttachmentName(
  horseName: string,
  recordType: string,
  date: string,
  providerName: string | undefined,
  originalFileName: string
) {
  const ext = originalFileName.includes(".") ? originalFileName.split(".").pop()!.toLowerCase() : "pdf";
  const parts = [slugifyPart(horseName), slugifyPart(recordType)];
  if (providerName) parts.push(slugifyPart(providerName));
  if (date) parts.push(date);
  return `${parts.join("-")}.${ext}`;
}

function createInitialRecordForm(): RecordFormState {
  return {
    horseIds: [],
    date: getTodayDate(),
    selectedProvider: "",
    providerName: "",
    customType: "",
    visitType: "",
    vaccineName: "",
    treatmentDescription: "",
    serviceType: "",
    nextVisitDate: "",
    notes: "",
    billId: "",
  };
}

export default function RecordsPage() {
  const allRecords = (useQuery(api.horseRecords.getAll) as GlobalRecord[] | undefined) ?? [];
  const activeHorses = useQuery(api.horses.getActiveHorses) ?? [];

  const [activeTab, setActiveTab] = useState<Tab>("upcoming");
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<"all" | RecordType>("all");
  const [horseFilter, setHorseFilter] = useState<"all" | Id<"horses">>("all");
  const [upcomingRange, setUpcomingRange] = useState<UpcomingRange>("all");
  const [pastRange, setPastRange] = useState<PastRange>("all");
  const [sortColumn, setSortColumn] = useState<SortColumn>("date");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");

  const [expandedId, setExpandedId] = useState<Id<"horseRecords"> | null>(null);
  const [menuOpenId, setMenuOpenId] = useState<Id<"horseRecords"> | null>(null);
  const [editingRecordId, setEditingRecordId] = useState<Id<"horseRecords"> | null>(null);
  const [editState, setEditState] = useState<EditState | null>(null);
  const [recordToDelete, setRecordToDelete] = useState<{ id: Id<"horseRecords">; name: string } | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [editInvoiceSearch, setEditInvoiceSearch] = useState("");
  const [editInvoiceDropdownOpen, setEditInvoiceDropdownOpen] = useState(false);

  const [panelOpen, setPanelOpen] = useState(false);
  const [recordForm, setRecordForm] = useState<RecordFormState>(createInitialRecordForm);
  const [selectedRecordType, setSelectedRecordType] = useState<RecordType | null>(null);
  const [invoiceSearch, setInvoiceSearch] = useState("");
  const [invoiceDropdownOpen, setInvoiceDropdownOpen] = useState(false);
  const invoiceDropdownRef = useRef<HTMLDivElement | null>(null);
  const [recordAttachment, setRecordAttachment] = useState<File | null>(null);
  const [recordSubmitting, setRecordSubmitting] = useState(false);
  const [recordSuccess, setRecordSuccess] = useState(false);
  const [recordError, setRecordError] = useState("");
  const [horseDropdownOpen, setHorseDropdownOpen] = useState(false);

  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const horseDropdownRef = useRef<HTMLDivElement | null>(null);

  const recordProviderCategory = selectedRecordType ? RECORD_TYPE_TO_CATEGORY[selectedRecordType] : "";
  const recordProviders =
    useQuery(api.providers.listByCategory, recordProviderCategory ? { category: recordProviderCategory } : "skip") ?? [];
  const allInvoicesForLinking = useQuery(api.bills.listForLinking) ?? [];

  const createHorseRecord = useMutation(api.horseRecords.createHorseRecord);
  const updateRecordWithNextVisit = useMutation(api.horseRecords.updateRecordWithNextVisit);
  const updateHorseRecord = useMutation(api.horseRecords.updateHorseRecord);
  const deleteHorseRecord = useMutation(api.horseRecords.deleteHorseRecord);
  const generateUploadUrl = useMutation(api.bills.generateUploadUrl);

  useEffect(() => {
    setSortColumn("date");
    setSortDirection(activeTab === "upcoming" ? "asc" : "desc");
  }, [activeTab]);

  useEffect(() => {
    const handleEsc = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closePanel();
      }
    };
    window.addEventListener("keydown", handleEsc);
    return () => {
      window.removeEventListener("keydown", handleEsc);
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
      if (resetTimerRef.current) clearTimeout(resetTimerRef.current);
    };
  }, []);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (horseDropdownRef.current && !horseDropdownRef.current.contains(event.target as Node)) {
        setHorseDropdownOpen(false);
      }
      if (invoiceDropdownRef.current && !invoiceDropdownRef.current.contains(event.target as Node)) {
        setInvoiceDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const now = Date.now();
  const recordById = useMemo(() => new Map(allRecords.map((row) => [String(row._id), row])), [allRecords]);
  const upcomingRecordsBase = useMemo(() => {
    return allRecords
      .filter((record) => record.isUpcoming && record.date > now)
      .map((record) => {
        return {
          base: record,
          eventDate: record.date,
          isFollowup: Boolean(record.linkedRecordId),
        } as DisplayRecord;
      });
  }, [allRecords, now]);

  const pastRecordsBase = useMemo(() => {
    return allRecords
      .filter((record) => !record.isUpcoming || (record.isUpcoming && record.date <= now))
      .map((record) => ({
        base: record,
        eventDate: record.date,
        isFollowup: false,
      } as DisplayRecord));
  }, [allRecords, now]);

  const tabRecords = activeTab === "upcoming" ? upcomingRecordsBase : pastRecordsBase;

  const filteredRecords = useMemo(() => {
    const term = search.trim().toLowerCase();
    const range = activeTab === "upcoming" ? upcomingRange : pastRange;

    return tabRecords.filter((row) => {
      const record = row.base;
      if (typeFilter !== "all" && record.type !== typeFilter) return false;
      if (horseFilter !== "all" && record.horseId !== horseFilter) return false;
      if (!filterByDate(row.eventDate, range, activeTab)) return false;

      if (!term) return true;
      const bag = [
        record.type,
        record.providerName,
        record.horseName,
        record.notes,
        record.vaccineName,
        record.treatmentDescription,
        record.serviceType,
        record.customType,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return bag.includes(term);
    });
  }, [tabRecords, activeTab, upcomingRange, pastRange, typeFilter, horseFilter, search]);

  const sortedRecords = useMemo(() => {
    const rows = [...filteredRecords];
    rows.sort((a, b) => {
      let cmp = 0;
      switch (sortColumn) {
        case "record":
          cmp = getRecordLabel(a.base).localeCompare(getRecordLabel(b.base));
          break;
        case "horse":
          cmp = a.base.horseName.localeCompare(b.base.horseName);
          break;
        case "provider":
          cmp = (a.base.providerName || "").localeCompare(b.base.providerName || "");
          break;
        case "category":
          cmp = a.base.type.localeCompare(b.base.type);
          break;
        case "date":
          cmp = a.eventDate - b.eventDate;
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

  function openRecordPanel() {
    if (resetTimerRef.current) clearTimeout(resetTimerRef.current);
    setRecordForm((prev) => ({ ...prev, date: getTodayDate() }));
    setPanelOpen(true);
  }

  function closePanel() {
    setPanelOpen(false);
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    if (resetTimerRef.current) clearTimeout(resetTimerRef.current);
    resetTimerRef.current = setTimeout(() => {
      setSelectedRecordType(null);
      setRecordForm(createInitialRecordForm());
      setRecordAttachment(null);
      setRecordSuccess(false);
      setRecordError("");
      setRecordSubmitting(false);
      setHorseDropdownOpen(false);
    }, 300);
  }

  function handleRecordTypeChange(type: string) {
    if (!type) {
      setSelectedRecordType(null);
      setRecordForm((prev) => ({
        ...prev,
        selectedProvider: "",
        providerName: "",
        customType: "",
        visitType: "",
        vaccineName: "",
        treatmentDescription: "",
        serviceType: "",
      }));
      return;
    }

    const nextType = type as RecordType;
    setSelectedRecordType(nextType);
    setRecordForm((prev) => ({
      ...prev,
      selectedProvider: "",
      providerName: "",
      customType: nextType === "other" ? prev.customType : "",
      visitType: "",
      vaccineName: "",
      treatmentDescription: "",
      serviceType: "",
    }));
  }

  async function uploadAttachmentIfPresent() {
    if (!recordAttachment) return undefined;
    const uploadUrl = await generateUploadUrl();
    const response = await fetch(uploadUrl, {
      method: "POST",
      headers: { "Content-Type": recordAttachment.type || "application/octet-stream" },
      body: recordAttachment,
    });
    if (!response.ok) {
      throw new Error("Failed to upload attachment");
    }
    const payload = await response.json();
    return typeof payload.storageId === "string" ? payload.storageId : undefined;
  }

  async function onSaveRecord(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedRecordType) {
      setRecordError("Select a record type.");
      return;
    }
    if (recordForm.horseIds.length === 0) {
      setRecordError("At least one horse is required.");
      return;
    }

    setRecordError("");
    setRecordSubmitting(true);
    try {
      const providerName =
        recordProviderCategory
          ? recordForm.selectedProvider === "__other"
            ? recordForm.providerName.trim() || undefined
            : recordForm.selectedProvider || undefined
          : recordForm.providerName.trim() || undefined;

      const attachmentStorageId = await uploadAttachmentIfPresent();
      for (const horseId of recordForm.horseIds) {
        const horse = activeHorses.find((h) => h._id === horseId);
        const attachmentName = attachmentStorageId && recordAttachment
          ? buildAttachmentName(horse?.name ?? "horse", selectedRecordType, recordForm.date, providerName, recordAttachment.name)
          : undefined;
        const mainRecordId = await createHorseRecord({
          horseId,
          type: selectedRecordType,
          customType: selectedRecordType === "other" ? recordForm.customType.trim() || undefined : undefined,
          date: new Date(`${recordForm.date}T00:00:00`).getTime(),
          providerName,
          visitType: selectedRecordType === "veterinary" ? recordForm.visitType || undefined : undefined,
          vaccineName:
            selectedRecordType === "veterinary" && recordForm.visitType === "vaccination"
              ? recordForm.vaccineName.trim() || undefined
              : undefined,
          treatmentDescription:
            selectedRecordType === "veterinary" && recordForm.visitType === "treatment"
              ? recordForm.treatmentDescription.trim() || undefined
              : undefined,
          serviceType: selectedRecordType === "farrier" ? recordForm.serviceType || undefined : undefined,
          isUpcoming: false,
          notes: recordForm.notes.trim() || undefined,
          attachmentStorageId,
          attachmentName,
          billId: recordForm.billId ? recordForm.billId as Id<"bills"> : undefined,
        });
        if (recordForm.nextVisitDate) {
          const upcomingRecordId = await createHorseRecord({
            horseId,
            type: selectedRecordType,
            customType: selectedRecordType === "other" ? recordForm.customType.trim() || undefined : undefined,
            date: new Date(`${recordForm.nextVisitDate}T00:00:00`).getTime(),
            providerName,
            visitType: selectedRecordType === "veterinary" ? recordForm.visitType || undefined : undefined,
            vaccineName:
              selectedRecordType === "veterinary" && recordForm.visitType === "vaccination"
                ? recordForm.vaccineName.trim() || undefined
                : undefined,
            treatmentDescription:
              selectedRecordType === "veterinary" && recordForm.visitType === "treatment"
                ? recordForm.treatmentDescription.trim() || undefined
                : undefined,
            serviceType: selectedRecordType === "farrier" ? recordForm.serviceType || undefined : undefined,
            isUpcoming: true,
            linkedRecordId: mainRecordId,
            notes: undefined,
          });
          await updateHorseRecord({
            recordId: mainRecordId,
            linkedRecordId: upcomingRecordId,
          });
        }
      }

      setRecordSuccess(true);
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
      closeTimerRef.current = setTimeout(() => {
        closePanel();
      }, 1200);
    } catch (error) {
      console.error("Save error:", error);
      setRecordError(error instanceof Error ? error.message : "Failed to save record");
    } finally {
      setRecordSubmitting(false);
    }
  }

  const selectedHorseNames = useMemo(
    () =>
      recordForm.horseIds
        .map((id) => activeHorses.find((horse) => horse._id === id)?.name)
        .filter((name): name is string => Boolean(name)),
    [activeHorses, recordForm.horseIds]
  );

  function toggleHorse(horseId: Id<"horses">) {
    setRecordForm((prev) => ({
      ...prev,
      horseIds: prev.horseIds.includes(horseId) ? prev.horseIds.filter((id) => id !== horseId) : [...prev.horseIds, horseId],
    }));
  }

  function selectAllHorses() {
    setRecordForm((prev) => ({ ...prev, horseIds: activeHorses.map((horse) => horse._id) }));
  }

  function clearAllHorses() {
    setRecordForm((prev) => ({ ...prev, horseIds: [] }));
  }

  function getLinkedUpcomingDateInput(record: GlobalRecord) {
    if (record.isUpcoming || !record.linkedRecordId) return "";
    const linked = allRecords.find((row) => row._id === record.linkedRecordId);
    return typeof linked?.date === "number" ? toDateInput(linked.date) : "";
  }

  async function saveEdit() {
    if (!editingRecordId || !editState) return;
    const nextVisitTimestamp = editState.nextVisitDate ? new Date(`${editState.nextVisitDate}T00:00:00`).getTime() : undefined;
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
        billId: editState.billId ? editState.billId as Id<"bills"> : undefined,
      },
      nextVisitDate: nextVisitTimestamp,
    });
    setEditingRecordId(null);
    setEditState(null);
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

  return (
    <div className="page-shell">
      <NavBar
        items={[
          { label: "old-oak-horses", href: "/dashboard", brand: true },
          { label: "records", current: true },
        ]}
        actions={[{ label: "biz overview", href: "/biz-overview", variant: "filled" }]}
      />

      <main className="page-main">
        <Link href="/dashboard" className="ui-back-link">
          ← cd /dashboard
        </Link>

        <section className={styles.headerRow}>
          <div>
            <div className="ui-label">// RECORDS</div>
            <h1 className={styles.title}>records</h1>
          </div>
          <button type="button" className={styles.btnLogRecord} onClick={openRecordPanel}>
            + log record
          </button>
        </section>

        <div className={styles.recordsTabs}>
          <button
            type="button"
            className={`${styles.recordsTab} ${activeTab === "upcoming" ? styles.recordsTabActive : styles.recordsTabInactive}`}
            onClick={() => setActiveTab("upcoming")}
          >
            Upcoming ({upcomingRecordsBase.length})
          </button>
          <button
            type="button"
            className={`${styles.recordsTab} ${activeTab === "past" ? styles.recordsTabActive : styles.recordsTabInactive}`}
            onClick={() => setActiveTab("past")}
          >
            Past ({pastRecordsBase.length})
          </button>
        </div>

        <section className={styles.filterRow}>
          <div className={styles.searchWrap}>
            <span className={styles.searchIcon}>🔍</span>
            <input className={styles.recordsSearch} value={search} onChange={(event) => setSearch(event.target.value)} placeholder="search records..." />
          </div>

          <select className={styles.filterDropdown} value={typeFilter} onChange={(event) => setTypeFilter(event.target.value as "all" | RecordType)}>
            <option value="all">All Types</option>
            <option value="veterinary">Veterinary</option>
            <option value="medication">Medication</option>
            <option value="farrier">Farrier</option>
            <option value="bodywork">Bodywork</option>
            <option value="other">Other</option>
          </select>

          <select className={styles.filterDropdown} value={horseFilter} onChange={(event) => setHorseFilter((event.target.value as Id<"horses"> | "all") || "all")}>
            <option value="all">All Horses</option>
            {activeHorses.map((horse) => (
              <option key={horse._id} value={horse._id}>
                {horse.name}
              </option>
            ))}
          </select>

          {activeTab === "upcoming" ? (
            <select className={styles.filterDropdown} value={upcomingRange} onChange={(event) => setUpcomingRange(event.target.value as UpcomingRange)}>
              <option value="all">All</option>
              <option value="7d">Next 7 Days</option>
              <option value="30d">Next 30 Days</option>
              <option value="3m">Next 3 Months</option>
              <option value="6m">Next 6 Months</option>
            </select>
          ) : (
            <select className={styles.filterDropdown} value={pastRange} onChange={(event) => setPastRange(event.target.value as PastRange)}>
              <option value="all">All Time</option>
              <option value="7d">Last 7 Days</option>
              <option value="30d">Last 30 Days</option>
              <option value="3m">Last 3 Months</option>
              <option value="6m">Last 6 Months</option>
              <option value="1y">Last Year</option>
            </select>
          )}
        </section>

        <div className={styles.resultsCount}>
          {filteredCount === totalCount
            ? `showing ${filteredCount} ${activeTab} records`
            : `showing ${filteredCount} of ${totalCount} ${activeTab} records`}
        </div>

        <section className={styles.recordsCard}>
          <div className={styles.recordsHeader}>
            <span />
            <button type="button" className={sortClass(sortColumn, "record", styles)} onClick={() => handleSort("record")}>
              RECORD
              {sortColumn === "record" ? <span className={styles.sortArrow}>{sortDirection === "asc" ? "↑" : "↓"}</span> : null}
            </button>
            <button type="button" className={sortClass(sortColumn, "horse", styles)} onClick={() => handleSort("horse")}>
              HORSE
              {sortColumn === "horse" ? <span className={styles.sortArrow}>{sortDirection === "asc" ? "↑" : "↓"}</span> : null}
            </button>
            <button type="button" className={sortClass(sortColumn, "provider", styles)} onClick={() => handleSort("provider")}>
              PROVIDER
              {sortColumn === "provider" ? <span className={styles.sortArrow}>{sortDirection === "asc" ? "↑" : "↓"}</span> : null}
            </button>
            <button type="button" className={sortClass(sortColumn, "category", styles)} onClick={() => handleSort("category")}>
              CATEGORY
              {sortColumn === "category" ? <span className={styles.sortArrow}>{sortDirection === "asc" ? "↑" : "↓"}</span> : null}
            </button>
            <button type="button" className={sortClass(sortColumn, "date", styles)} onClick={() => handleSort("date")}>
              DATE
              {sortColumn === "date" ? <span className={styles.sortArrow}>{sortDirection === "asc" ? "↑" : "↓"}</span> : null}
            </button>
            <span />
          </div>

          {sortedRecords.length === 0 ? (
            <div className={styles.emptyState}>
              {totalCount === 0 ? (
                activeTab === "upcoming" ? (
                  <>
                    <div className={styles.emptyTitle}>no upcoming records</div>
                    <div className={styles.emptySub}>schedule visits using + log record</div>
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
            sortedRecords.map((row) => {
              const record = row.base;
              const expanded = expandedId === record._id;
              const editing = editingRecordId === record._id && editState !== null;
              const badgeColors = RECORD_CATEGORY_COLORS[record.type];
              const detail = getRecordDetail(record);
              const dateSoon = activeTab === "upcoming" && daysUntil(row.eventDate) <= 3;

              return (
                <div key={`${record._id}-${row.isFollowup ? "f" : "s"}-${row.eventDate}`}>
                  <div
                    className={styles.recordRow}
                    onClick={() => {
                      setExpandedId((prev) => (prev === record._id ? null : record._id));
                      setMenuOpenId(null);
                      setEditingRecordId(null);
                      setEditState(null);
                    }}
                  >
                    <div className={styles.recordIcon}>{recordIcon(record.type)}</div>
                    <div>
                      <div className={styles.recordLabelWrap}>
                        <div className={styles.recordLabel}>{getRecordLabel(record)}</div>
                        {activeTab === "upcoming" && row.isFollowup ? <span className={styles.followupBadge}>follow-up</span> : null}
                      </div>
                      {detail ? <div className={styles.recordSublabel}>{detail}</div> : null}
                      {record.linkedRecordId ? (
                        <button
                          type="button"
                          className={styles.recordLinkedNote}
                          onClick={(event) => {
                            event.stopPropagation();
                            setExpandedId(record.linkedRecordId || null);
                            setActiveTab(record.isUpcoming ? "past" : "upcoming");
                          }}
                        >
                          {record.isUpcoming
                            ? `📋 follow-up from: ${formatDateLong(recordById.get(String(record.linkedRecordId))?.date ?? record.date)}`
                            : `📅 follow-up scheduled: ${formatDateLong(recordById.get(String(record.linkedRecordId))?.date ?? record.date)}`}
                        </button>
                      ) : null}
                    </div>
                    <Link
                      href={record.horseId ? `/horses/${record.horseId}` : "/horses"}
                      className={styles.recordHorse}
                      onClick={(event) => event.stopPropagation()}
                    >
                      🐴 {record.horseName}
                    </Link>
                    <div className={record.providerName ? styles.recordProvider : styles.recordProviderEmpty}>{record.providerName || "—"}</div>
                    <span className={styles.categoryBadge} style={{ background: badgeColors.bg, color: badgeColors.color }}>
                      {prettyType(record.type)}
                    </span>
                    <div className={`${styles.recordDate} ${dateSoon ? styles.recordDateSoon : ""}`}>{formatDateLong(row.eventDate)}</div>
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
                            <ExpandedInput label="LINKED INVOICE">
                              <div className={styles.invoiceSearchWrap}>
                                {editState.billId ? (
                                  <div className={styles.invoiceSelected}>
                                    <span className={styles.invoiceSelectedName}>
                                      {(() => {
                                        const linked = allInvoicesForLinking.find((b) => String(b._id) === editState.billId);
                                        return linked ? formatInvoiceName({ providerName: linked.providerName, date: linked.invoiceDate }) : "linked invoice";
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
                                            return b.providerName.toLowerCase().includes(term) ||
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
                                              {formatInvoiceName({ providerName: b.providerName, date: b.invoiceDate })}
                                            </button>
                                          ))}
                                        {allInvoicesForLinking.filter((b) => {
                                          if (!editInvoiceSearch.trim()) return true;
                                          const term = editInvoiceSearch.toLowerCase();
                                          return b.providerName.toLowerCase().includes(term) || b.invoiceNumber.toLowerCase().includes(term) || b.invoiceDate.includes(term);
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
                            <ExpandedField label="HORSE" value={record.horseName} />
                            <ExpandedField label="PROVIDER" value={record.providerName} />
                            <ExpandedField label="DATE" value={formatDateLong(row.eventDate)} />
                            <ExpandedField label="NOTES" value={record.notes} />
                            {record.billInfo ? (
                              <div className={styles.expandedFieldRow}>
                                <span className={styles.expandedFieldLabel}>LINKED INVOICE</span>
                                <Link
                                  href={`/invoices/preview/${record.billInfo.billId}`}
                                  className={styles.invoiceLink}
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

        <div className="ui-footer">OLD_OAK_HORSES // RECORDS</div>
      </main>

      <div className={`${styles.panelOverlay} ${panelOpen ? styles.panelOverlayOpen : ""}`} onClick={closePanel} />
      <aside className={`${styles.recordPanel} ${panelOpen ? styles.recordPanelOpen : ""}`}>
        <div className={styles.recordPanelHeader}>
          <div>
            <div className={styles.recordPanelLabel}>// NEW RECORD</div>
            <h3 className={styles.recordPanelTitle}>log horse record</h3>
          </div>
          <button type="button" className={styles.recordPanelClose} onClick={closePanel}>
            ✕
          </button>
        </div>

        {recordSuccess ? (
          <div className={styles.recordSuccessWrap}>
            <div className={styles.recordSuccessIcon}>✓</div>
            <div className={styles.recordSuccessTitle}>record saved</div>
            <div className={styles.recordSuccessSub}>
              {recordTypeLabel(selectedRecordType, recordForm.customType)} for {formatHorseSuccessLabel(selectedHorseNames)}
            </div>
          </div>
        ) : (
          <form id="record-form" className={styles.recordPanelBody} onSubmit={onSaveRecord}>
            <RecordField label="HORSE" required>
              <div className={styles.multiSelectContainer} ref={horseDropdownRef}>
                <div
                  className={`${styles.multiSelectInput} ${horseDropdownOpen ? styles.multiSelectInputOpen : ""}`}
                  onClick={() => setHorseDropdownOpen((prev) => !prev)}
                >
                  {recordForm.horseIds.length > 0 ? (
                    <>
                      {recordForm.horseIds.map((horseId) => {
                        const horseName = activeHorses.find((horse) => horse._id === horseId)?.name ?? "Unknown";
                        return (
                          <span key={horseId} className={styles.horsePill}>
                            {horseName}
                            <button
                              type="button"
                              className={styles.horsePillRemove}
                              onClick={(event) => {
                                event.stopPropagation();
                                toggleHorse(horseId);
                              }}
                            >
                              ✕
                            </button>
                          </span>
                        );
                      })}
                    </>
                  ) : (
                    <span className={styles.multiSelectPlaceholder}>select horse...</span>
                  )}
                  <span className={styles.multiSelectCaret}>▼</span>
                </div>

                {horseDropdownOpen ? (
                  <div className={styles.multiSelectDropdown}>
                    {activeHorses.map((horse) => {
                      const checked = recordForm.horseIds.includes(horse._id);
                      return (
                        <button type="button" key={horse._id} className={styles.multiSelectOption} onClick={() => toggleHorse(horse._id)}>
                          <span className={`${styles.checkbox} ${checked ? styles.checkboxChecked : styles.checkboxUnchecked}`}>✓</span>
                          <span>{horse.name}</span>
                        </button>
                      );
                    })}
                    <div className={styles.multiSelectFooter}>
                      <button type="button" className={styles.multiSelectAction} onClick={selectAllHorses}>
                        select all
                      </button>
                      <button type="button" className={styles.multiSelectAction} onClick={clearAllHorses}>
                        clear all
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
            </RecordField>

            <RecordField label="DATE" required>
              <input
                className={styles.recordInput}
                type="date"
                value={recordForm.date}
                onChange={(event) => setRecordForm((prev) => ({ ...prev, date: event.target.value }))}
              />
            </RecordField>

            <RecordField label="RECORD TYPE" required>
              <select className={styles.recordInput} value={selectedRecordType ?? ""} onChange={(event) => handleRecordTypeChange(event.target.value)}>
                <option value="">select type...</option>
                <option value="veterinary">Veterinary</option>
                <option value="medication">Medication</option>
                <option value="farrier">Farrier</option>
                <option value="bodywork">Bodywork</option>
                <option value="other">Other</option>
              </select>
            </RecordField>

            {selectedRecordType ? (
              <>
                {selectedRecordType === "veterinary" ? (
                  <RecordField label="VISIT TYPE">
                    <select
                      className={styles.recordInput}
                      value={recordForm.visitType}
                      onChange={(event) => setRecordForm((prev) => ({ ...prev, visitType: event.target.value as "" | "vaccination" | "treatment" }))}
                    >
                      <option value="">select...</option>
                      <option value="vaccination">Vaccination</option>
                      <option value="treatment">Treatment</option>
                    </select>
                  </RecordField>
                ) : null}

                {selectedRecordType === "veterinary" && recordForm.visitType === "vaccination" ? (
                  <RecordField label="VACCINE NAME">
                    <input
                      className={styles.recordInput}
                      value={recordForm.vaccineName}
                      onChange={(event) => setRecordForm((prev) => ({ ...prev, vaccineName: event.target.value }))}
                      placeholder="e.g., Flu/Rhino, Coggins, West Nile"
                    />
                  </RecordField>
                ) : null}

                {selectedRecordType === "veterinary" && recordForm.visitType === "treatment" ? (
                  <RecordField label="TREATMENT DESCRIPTION">
                    <input
                      className={styles.recordInput}
                      value={recordForm.treatmentDescription}
                      onChange={(event) => setRecordForm((prev) => ({ ...prev, treatmentDescription: event.target.value }))}
                      placeholder="e.g., Laceration repair, Lameness exam"
                    />
                  </RecordField>
                ) : null}

                {selectedRecordType === "other" ? (
                  <RecordField label="DESCRIBE RECORD TYPE">
                    <input
                      className={styles.recordInput}
                      value={recordForm.customType}
                      onChange={(event) => setRecordForm((prev) => ({ ...prev, customType: event.target.value }))}
                      placeholder="e.g., Dentist, Chiropractor"
                    />
                  </RecordField>
                ) : null}

                {selectedRecordType === "farrier" ? (
                  <RecordField label="SERVICE TYPE">
                    <div className={styles.chipRow}>
                      {farrierServiceTypes.map((service) => {
                        const active = recordForm.serviceType === service;
                        return (
                          <button
                            type="button"
                            key={service}
                            className={`${styles.serviceChip} ${active ? styles.serviceChipActive : ""}`}
                            onClick={() => setRecordForm((prev) => ({ ...prev, serviceType: service }))}
                          >
                            {service}
                          </button>
                        );
                      })}
                    </div>
                  </RecordField>
                ) : null}

                <RecordField label={providerLabel(selectedRecordType)}>
                  {RECORD_TYPE_TO_CATEGORY[selectedRecordType] ? (
                    <>
                      <select
                        className={styles.recordInput}
                        value={recordForm.selectedProvider}
                        onChange={(event) => setRecordForm((prev) => ({ ...prev, selectedProvider: event.target.value, providerName: "" }))}
                      >
                        <option value="">select...</option>
                        {recordProviders.map((provider) => (
                          <option key={provider._id} value={provider.name}>
                            {provider.name}
                          </option>
                        ))}
                        <option value="__other">+ Other...</option>
                      </select>
                      {recordForm.selectedProvider === "__other" ? (
                        <div className={styles.providerOtherWrap}>
                          <label className={styles.recordFieldLabel}>PROVIDER NAME</label>
                          <input
                            className={styles.recordInput}
                            value={recordForm.providerName}
                            onChange={(event) => setRecordForm((prev) => ({ ...prev, providerName: event.target.value }))}
                            placeholder={providerPlaceholder(selectedRecordType)}
                          />
                        </div>
                      ) : null}
                    </>
                  ) : (
                    <input
                      className={styles.recordInput}
                      value={recordForm.providerName}
                      onChange={(event) => setRecordForm((prev) => ({ ...prev, providerName: event.target.value }))}
                      placeholder={providerPlaceholder(selectedRecordType)}
                    />
                  )}
                </RecordField>
              </>
            ) : null}

            <RecordField label="NEXT VISIT">
              <input
                className={styles.recordInput}
                type="date"
                value={recordForm.nextVisitDate}
                onChange={(event) => setRecordForm((prev) => ({ ...prev, nextVisitDate: event.target.value }))}
              />
            </RecordField>

            <RecordField label="NOTES">
              <textarea
                className={styles.recordTextarea}
                rows={4}
                value={recordForm.notes}
                onChange={(event) => setRecordForm((prev) => ({ ...prev, notes: event.target.value }))}
                placeholder="add any details..."
              />
            </RecordField>

            <RecordField label="LINKED INVOICE">
              <div className={styles.invoiceSearchWrap} ref={invoiceDropdownRef}>
                {recordForm.billId ? (
                  <div className={styles.invoiceSelected}>
                    <span className={styles.invoiceSelectedName}>
                      {(() => {
                        const linked = allInvoicesForLinking.find((b) => String(b._id) === recordForm.billId);
                        return linked ? formatInvoiceName({ providerName: linked.providerName, date: linked.invoiceDate }) : "linked invoice";
                      })()}
                    </span>
                    <button type="button" className={styles.invoiceClearBtn} onClick={() => setRecordForm((prev) => ({ ...prev, billId: "" }))}>✕</button>
                  </div>
                ) : (
                  <>
                    <input
                      className={styles.recordInput}
                      value={invoiceSearch}
                      onChange={(e) => { setInvoiceSearch(e.target.value); setInvoiceDropdownOpen(true); }}
                      onFocus={() => setInvoiceDropdownOpen(true)}
                      placeholder="search invoices..."
                    />
                    {invoiceDropdownOpen && (
                      <div className={styles.invoiceDropdown}>
                        {allInvoicesForLinking
                          .filter((b) => {
                            if (!invoiceSearch.trim()) return true;
                            const term = invoiceSearch.toLowerCase();
                            return b.providerName.toLowerCase().includes(term) ||
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
                                setRecordForm((prev) => ({ ...prev, billId: String(b._id) }));
                                setInvoiceSearch("");
                                setInvoiceDropdownOpen(false);
                              }}
                            >
                              {formatInvoiceName({ providerName: b.providerName, date: b.invoiceDate })}
                            </button>
                          ))}
                        {allInvoicesForLinking.filter((b) => {
                          if (!invoiceSearch.trim()) return true;
                          const term = invoiceSearch.toLowerCase();
                          return b.providerName.toLowerCase().includes(term) || b.invoiceNumber.toLowerCase().includes(term) || b.invoiceDate.includes(term);
                        }).length === 0 && (
                          <div className={styles.invoiceDropdownEmpty}>no invoices found</div>
                        )}
                      </div>
                    )}
                  </>
                )}
              </div>
            </RecordField>

            <RecordField label="ATTACHMENT">
              <label className={styles.dropZone}>
                <input
                  type="file"
                  className={styles.fileInput}
                  accept=".pdf,.jpg,.jpeg,.png"
                  onChange={(event: ChangeEvent<HTMLInputElement>) => setRecordAttachment(event.target.files?.[0] ?? null)}
                />
                <div className={styles.dropZoneText}>
                  drop file or <span className={styles.dropZoneBrowse}>browse</span>
                </div>
                <div className={styles.dropZoneSubtext}>PDF, JPG, PNG — max 10MB</div>
                {recordAttachment ? <div className={styles.dropZoneFile}>{recordAttachment.name}</div> : null}
              </label>
            </RecordField>

            {recordError ? <p className={styles.recordError}>{recordError}</p> : null}
          </form>
        )}

        {selectedRecordType && !recordSuccess ? (
          <div className={styles.recordPanelFooter}>
            <button type="button" className={styles.recordCancelBtn} onClick={closePanel}>
              cancel
            </button>
            <button type="submit" form="record-form" className={styles.recordSaveBtn} disabled={recordForm.horseIds.length === 0 || recordSubmitting}>
              {recordSubmitting ? "saving..." : "save record"}
            </button>
          </div>
        ) : null}
      </aside>

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

function sortClass(sortColumn: SortColumn, column: SortColumn, css: Record<string, string>) {
  return sortColumn === column ? css.sortHeaderActive : css.sortHeader;
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

function RecordField({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <label className={styles.recordField}>
      <span className={styles.recordFieldLabel}>
        {label}
        {required ? " *" : ""}
      </span>
      {children}
    </label>
  );
}

function filterByDate(timestamp: number, range: UpcomingRange | PastRange, tab: Tab) {
  if (range === "all") return true;
  const now = Date.now();
  const ms: Record<string, number> = {
    "7d": 7 * 86400000,
    "30d": 30 * 86400000,
    "3m": 90 * 86400000,
    "6m": 180 * 86400000,
    "1y": 365 * 86400000,
  };
  if (tab === "upcoming") {
    return timestamp <= now + ms[range] && timestamp >= now;
  }
  return timestamp >= now - ms[range];
}

function getRecordSubtype(record: GlobalRecord) {
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

function getRecordLabel(record: GlobalRecord) {
  const subtype = getRecordSubtype(record);
  if (subtype) return subtype;
  return prettyType(record.type);
}

function getRecordDetail(record: GlobalRecord) {
  if (record.type === "veterinary" && record.visitType === "vaccination" && record.vaccineName) return record.vaccineName;
  if (record.type === "veterinary" && record.visitType === "treatment" && record.treatmentDescription) return record.treatmentDescription;
  if (record.type === "medication" && record.notes) return record.notes;
  return "";
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

function providerLabel(type: RecordType) {
  if (type === "veterinary") return "VETERINARIAN";
  if (type === "medication") return "ADMINISTERED BY";
  if (type === "farrier") return "FARRIER";
  if (type === "bodywork") return "PRACTITIONER";
  return "PROVIDER";
}

function providerPlaceholder(type: RecordType) {
  if (type === "veterinary") return "Dr. Sarah Buthe";
  if (type === "medication") return "optional";
  if (type === "farrier") return "Steve Lorenzo";
  if (type === "bodywork") return "Fred Michelon";
  return "optional";
}

function recordTypeLabel(type: RecordType | null, customType?: string) {
  if (type === "veterinary") return "Veterinary";
  if (type === "medication") return "Medication";
  if (type === "farrier") return "Farrier";
  if (type === "bodywork") return "Bodywork";
  if (type === "other") return customType?.trim() || "Other";
  return "Record";
}

function formatHorseSuccessLabel(names: string[]) {
  if (names.length === 0) return "horse";
  if (names.length <= 3) return names.join(", ");
  return `${names[0]}, ${names[1]} + ${names.length - 2} more`;
}
