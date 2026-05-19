"use client";

import Link from "next/link";
import React, { useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import Modal from "@/components/Modal";
import NavBar from "@/components/NavBar";
import { formatInvoiceName } from "@/lib/formatInvoiceName";
import { useAuth } from "@/contexts/AuthContext";
import styles from "./records.module.css";

type RecordType = "veterinary" | "medication" | "farrier" | "bodywork" | "other";
type VetSubcategory =
  | "vaccination"
  | "treatment"
  | "medication"
  | "joint_injections"
  | "exams_diagnostics"
  | "vaccinations"
  | "shockwave"
  | "sedation"
  | "fees"
  | "lab_work"
  | "exam"
  | "imaging"
  | "other";

const VET_SUBCATEGORY_OPTIONS: Array<{ value: VetSubcategory; label: string }> = [
  { value: "exam", label: "Exam" },
  { value: "vaccinations", label: "Vaccinations" },
  { value: "medication", label: "Medication" },
  { value: "joint_injections", label: "Joint Injections" },
  { value: "imaging", label: "Imaging" },
  { value: "lab_work", label: "Lab Work" },
  { value: "shockwave", label: "Shockwave" },
  { value: "sedation", label: "Sedation" },
  { value: "exams_diagnostics", label: "Exams & Diagnostics" },
  { value: "fees", label: "Fees" },
  { value: "other", label: "Other" },
];

function vetSubcategoryLabel(value?: string | null) {
  if (!value) return null;
  const found = VET_SUBCATEGORY_OPTIONS.find((o) => o.value === value);
  if (found) return found.label;
  if (value === "vaccination") return "Vaccinations";
  if (value === "treatment") return "Treatment";
  return value.replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function getVetVisitTypeLabels(record: { visitType?: string; visitTypes?: string[]; vetOtherDescription?: string }): string[] {
  const types = record.visitTypes?.length ? record.visitTypes : record.visitType ? [record.visitType] : [];
  return types.map((t) => {
    if (t === "other" && record.vetOtherDescription) return record.vetOtherDescription;
    return vetSubcategoryLabel(t) || t;
  });
}
type Tab = "upcoming" | "past";
type SortColumn = "record" | "detail" | "date" | "category" | "horse";
type UpcomingRange = "all" | "7d" | "30d" | "3m" | "6m";
type PastRange = "all" | "7d" | "30d" | "3m" | "6m" | "1y";

type GlobalRecord = {
  _id: Id<"horseRecords">;
  horseId: Id<"horses">;
  horseName: string;
  horse: { _id: Id<"horses">; name: string; status: "active" | "inactive" | "past" } | null;
  title?: string;
  type: RecordType;
  customType?: string;
  date: number;
  contactName?: string;
  visitType?: VetSubcategory;
  visitTypes?: string[];
  vetOtherDescription?: string;
  vaccineName?: string;
  treatmentDescription?: string;
  serviceType?: string;
  isUpcoming?: boolean;
  linkedRecordId?: Id<"horseRecords">;
  medications?: string[];
  notes?: string;
  attachmentStorageId?: string;
  attachmentUrl?: string | null;
  billId?: Id<"bills">;
  billInfo?: { billId: Id<"bills">; contactName: string; invoiceDate: string } | null;
};

type DisplayRecord = {
  base: GlobalRecord;
  eventDate: number;
  isFollowup: boolean;
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
  billId: string;
};

type RecordFormState = {
  horseIds: Id<"horses">[];
  title: string;
  date: string;
  contactName: string;
  customType: string;
  visitType: "" | VetSubcategory;
  visitTypes: VetSubcategory[];
  vetOtherDescription: string;
  vaccineName: string;
  treatmentDescription: string;
  serviceType: string;
  medications: string[];
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
const MEDICATION_OPTIONS = [
  "adequan", "aspirin", "banamine", "bute", "dexamethasone",
  "gastroguard", "gentamicin", "legend", "marquis", "metacam",
  "pentosan", "traumeel", "other",
];

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
  contactName: string | undefined,
  originalFileName: string
) {
  const ext = originalFileName.includes(".") ? originalFileName.split(".").pop()!.toLowerCase() : "pdf";
  const parts = [slugifyPart(horseName), slugifyPart(recordType)];
  if (contactName) parts.push(slugifyPart(contactName));
  if (date) parts.push(date);
  return `${parts.join("-")}.${ext}`;
}

function createInitialRecordForm(): RecordFormState {
  return {
    horseIds: [],
    title: "",
    date: getTodayDate(),
    contactName: "",
    customType: "",
    visitType: "",
    visitTypes: [],
    vetOtherDescription: "",
    vaccineName: "",
    treatmentDescription: "",
    serviceType: "",
    medications: [],
    nextVisitDate: "",
    notes: "",
    billId: "",
  };
}

export default function RecordsPage() {
  const { user } = useAuth();
  const allRecords = (useQuery(api.horseRecords.getAll) as GlobalRecord[] | undefined) ?? [];
  const activeHorses = useQuery(api.horses.getActiveHorses) ?? [];

  const [activeTab, setActiveTab] = useState<Tab>("past");
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<"all" | RecordType>("all");
  const [horseFilter, setHorseFilter] = useState<"all" | Id<"horses">>("all");
  const [upcomingRange, setUpcomingRange] = useState<UpcomingRange>("all");
  const [pastRange, setPastRange] = useState<PastRange>("all");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const filtersPopoverRef = useRef<HTMLDivElement | null>(null);
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
  const [contactDropdownOpen, setContactDropdownOpen] = useState(false);
  const contactDropdownRef = useRef<HTMLDivElement | null>(null);
  const [editProviderDropdownOpen, setEditProviderDropdownOpen] = useState(false);
  const editContactDropdownRef = useRef<HTMLDivElement | null>(null);
  const [recordAttachment, setRecordAttachment] = useState<File | null>(null);
  const [recordSubmitting, setRecordSubmitting] = useState(false);
  const [recordSuccess, setRecordSuccess] = useState(false);
  const [recordError, setRecordError] = useState("");
  const [horseDropdownOpen, setHorseDropdownOpen] = useState(false);
  const [subcatDropdownOpen, setSubcatDropdownOpen] = useState(false);
  const subcatDropdownRef = useRef<HTMLDivElement | null>(null);

  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const horseDropdownRef = useRef<HTMLDivElement | null>(null);

  const recordProviderCategory = selectedRecordType ? RECORD_TYPE_TO_CATEGORY[selectedRecordType] : "";
  const allContactsForRecord = useQuery(api.contacts.getAllContacts) ?? [];
  const recordProviders = useMemo(
    () => allContactsForRecord.filter((c: any) => recordProviderCategory && c.category === recordProviderCategory),
    [allContactsForRecord, recordProviderCategory]
  );
  const allInvoicesForLinking = useQuery(api.bills.listForLinking) ?? [];

  const createHorseRecord = useMutation(api.horseRecords.createHorseRecord);
  const updateRecordWithNextVisit = useMutation(api.horseRecords.updateRecordWithNextVisit);
  const updateHorseRecord = useMutation(api.horseRecords.updateHorseRecord);
  const deleteHorseRecord = useMutation(api.horseRecords.deleteHorseRecord);
  const generateUploadUrl = useMutation(api.bills.generateUploadUrl);
  const findOrCreateContact = useMutation(api.contacts.findOrCreateContact);

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
      if (contactDropdownRef.current && !contactDropdownRef.current.contains(event.target as Node)) {
        setContactDropdownOpen(false);
      }
      if (subcatDropdownRef.current && !subcatDropdownRef.current.contains(event.target as Node)) {
        setSubcatDropdownOpen(false);
      }
      if (editContactDropdownRef.current && !editContactDropdownRef.current.contains(event.target as Node)) {
        setEditProviderDropdownOpen(false);
      }
      if (filtersPopoverRef.current && !filtersPopoverRef.current.contains(event.target as Node)) {
        setFiltersOpen(false);
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
    const fromTs = fromDate ? new Date(`${fromDate}T00:00:00`).getTime() : null;
    const toTs = toDate ? new Date(`${toDate}T23:59:59.999`).getTime() : null;

    return tabRecords.filter((row) => {
      const record = row.base;
      if (typeFilter !== "all" && record.type !== typeFilter) return false;
      if (horseFilter !== "all" && record.horseId !== horseFilter) return false;
      if (fromTs !== null && row.eventDate < fromTs) return false;
      if (toTs !== null && row.eventDate > toTs) return false;

      if (!term) return true;
      const bag = [
        record.title,
        record.type,
        record.contactName,
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
  }, [tabRecords, typeFilter, horseFilter, search, fromDate, toDate]);

  const sortedRecords = useMemo(() => {
    const rows = [...filteredRecords];
    rows.sort((a, b) => {
      let cmp = 0;
      switch (sortColumn) {
        case "record":
          cmp = getRecordLabel(a.base).localeCompare(getRecordLabel(b.base));
          break;
        case "detail":
          cmp = getRecordSubtitle(a.base).localeCompare(getRecordSubtitle(b.base));
          break;
        case "horse":
          cmp = a.base.horseName.localeCompare(b.base.horseName);
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

  function sortArrow(col: SortColumn) {
    if (sortColumn !== col) return " ↕";
    return sortDirection === "asc" ? " ↑" : " ↓";
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
        contactName: "",
        customType: "",
        visitType: "",
        visitTypes: [],
        vetOtherDescription: "",
        vaccineName: "",
        treatmentDescription: "",
        serviceType: "",
        medications: [],
      }));
      return;
    }

    const nextType = type as RecordType;
    setSelectedRecordType(nextType);
    setRecordForm((prev) => ({
      ...prev,
      contactName: "",
      customType: nextType === "other" ? prev.customType : "",
      visitType: "",
      visitTypes: [],
      vetOtherDescription: "",
      vaccineName: "",
      treatmentDescription: "",
      serviceType: "",
      medications: nextType === "medication" ? prev.medications : [],
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
    if (!recordForm.contactName.trim()) {
      setRecordError("Contact is required.");
      return;
    }
    setRecordError("");
    setRecordSubmitting(true);
    try {
      const contactName = recordForm.contactName.trim() || undefined;
      let resolvedContactId: Id<"contacts"> | undefined;
      if (contactName && recordProviderCategory) {
        const cid = await findOrCreateContact({ name: contactName, category: recordProviderCategory });
        if (cid) resolvedContactId = cid;
      }

      const attachmentStorageId = await uploadAttachmentIfPresent();
      for (const horseId of recordForm.horseIds) {
        const horse = activeHorses.find((h) => h._id === horseId);
        const attachmentName = attachmentStorageId && recordAttachment
          ? buildAttachmentName(horse?.name ?? "horse", selectedRecordType, recordForm.date, contactName, recordAttachment.name)
          : undefined;
        const mainRecordId = await createHorseRecord({
          horseId,
          title: recordForm.title.trim() || undefined,
          createdBy: user?.name,
          type: selectedRecordType,
          customType: selectedRecordType === "other" ? recordForm.customType.trim() || undefined : undefined,
          date: new Date(`${recordForm.date}T00:00:00`).getTime(),
          contactName,
          contactId: resolvedContactId,
          visitType: selectedRecordType === "veterinary" && recordForm.visitTypes.length > 0 ? recordForm.visitTypes[0] as VetSubcategory : undefined,
          visitTypes: selectedRecordType === "veterinary" && recordForm.visitTypes.length > 0 ? recordForm.visitTypes : undefined,
          vetOtherDescription: selectedRecordType === "veterinary" && recordForm.visitTypes.includes("other") ? recordForm.vetOtherDescription.trim() || undefined : undefined,
          vaccineName: selectedRecordType === "veterinary" && recordForm.visitTypes.includes("vaccinations") ? recordForm.vaccineName.trim() || undefined : undefined,
          treatmentDescription: selectedRecordType === "veterinary" && recordForm.visitTypes.includes("treatment") ? recordForm.treatmentDescription.trim() || undefined : undefined,
          serviceType: selectedRecordType === "farrier" ? recordForm.serviceType || undefined : undefined,
          medications: selectedRecordType === "medication" && recordForm.medications.length > 0 ? recordForm.medications : undefined,
          isUpcoming: false,
          notes: recordForm.notes.trim() || undefined,
          attachmentStorageId,
          attachmentName,
          billId: recordForm.billId ? recordForm.billId as Id<"bills"> : undefined,
        });
        if (recordForm.nextVisitDate) {
          const upcomingRecordId = await createHorseRecord({
            horseId,
            title: recordForm.title.trim() || undefined,
            createdBy: user?.name,
            type: selectedRecordType,
            customType: selectedRecordType === "other" ? recordForm.customType.trim() || undefined : undefined,
            date: new Date(`${recordForm.nextVisitDate}T00:00:00`).getTime(),
            contactName,
            contactId: resolvedContactId,
            visitType: selectedRecordType === "veterinary" && recordForm.visitTypes.length > 0 ? recordForm.visitTypes[0] as VetSubcategory : undefined,
            visitTypes: selectedRecordType === "veterinary" && recordForm.visitTypes.length > 0 ? recordForm.visitTypes : undefined,
            vetOtherDescription: selectedRecordType === "veterinary" && recordForm.visitTypes.includes("other") ? recordForm.vetOtherDescription.trim() || undefined : undefined,
            vaccineName: selectedRecordType === "veterinary" && recordForm.visitTypes.includes("vaccinations") ? recordForm.vaccineName.trim() || undefined : undefined,
            treatmentDescription: selectedRecordType === "veterinary" && recordForm.visitTypes.includes("treatment") ? recordForm.treatmentDescription.trim() || undefined : undefined,
            serviceType: selectedRecordType === "farrier" ? recordForm.serviceType || undefined : undefined,
            medications: selectedRecordType === "medication" && recordForm.medications.length > 0 ? recordForm.medications : undefined,
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
    const editProviderName = editState.contactName?.trim() || undefined;
    let editContactId: Id<"contacts"> | undefined;
    if (editProviderName) {
      const category = RECORD_TYPE_TO_CATEGORY[editState.type] || "other";
      const contactId = await findOrCreateContact({ name: editProviderName, category });
      if (contactId) editContactId = contactId;
    }
    const nextVisitTimestamp = editState.nextVisitDate ? new Date(`${editState.nextVisitDate}T00:00:00`).getTime() : undefined;
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
        </section>

        <div className={styles.tabs} role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "past"}
            className={`${styles.tab} ${activeTab === "past" ? styles.tabActive : ""}`}
            onClick={() => setActiveTab("past")}
          >
            Past <span className={styles.tabCount}>{pastRecordsBase.length}</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "upcoming"}
            className={`${styles.tab} ${activeTab === "upcoming" ? styles.tabActive : ""}`}
            onClick={() => setActiveTab("upcoming")}
          >
            Upcoming <span className={styles.tabCount}>{upcomingRecordsBase.length}</span>
          </button>
        </div>

        {(() => {
          const categoryLabel =
            typeFilter === "all" ? null : (
              typeFilter === "veterinary" ? "Veterinary" :
              typeFilter === "medication" ? "Medication" :
              typeFilter === "farrier" ? "Farrier" :
              typeFilter === "bodywork" ? "Bodywork" : "Other"
            );
          const horseLabel = horseFilter === "all"
            ? null
            : activeHorses.find((h) => h._id === horseFilter)?.name ?? "Horse";
          const dateLabel = fromDate || toDate
            ? `${fromDate || "…"} → ${toDate || "…"}`
            : null;
          const activeCount = [categoryLabel, horseLabel, dateLabel].filter(Boolean).length;

          return (
            <>
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
                    className={`${styles.toolbarFiltersBtn} ${activeCount > 0 ? styles.toolbarFiltersBtnActive : ""}`}
                    onClick={() => setFiltersOpen((v) => !v)}
                    aria-expanded={filtersOpen}
                  >
                    <span>filters</span>
                    {activeCount > 0 ? <span className={styles.toolbarFiltersCount}>{activeCount}</span> : null}
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
                          <option value="medication">Medication</option>
                          <option value="farrier">Farrier</option>
                          <option value="bodywork">Bodywork</option>
                          <option value="other">Other</option>
                        </select>
                      </label>
                      <label className={styles.popField}>
                        <span>Horse</span>
                        <select
                          value={horseFilter}
                          onChange={(event) => setHorseFilter((event.target.value as Id<"horses"> | "all") || "all")}
                        >
                          <option value="all">All</option>
                          {activeHorses.map((horse) => (
                            <option key={horse._id} value={horse._id}>{horse.name}</option>
                          ))}
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
                      {activeCount > 0 ? (
                        <button
                          type="button"
                          className={styles.popClearBtn}
                          onClick={() => {
                            setTypeFilter("all");
                            setHorseFilter("all");
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
              {activeCount > 0 ? (
                <div className={styles.filterChips}>
                  {categoryLabel ? (
                    <button type="button" className={styles.filterChip} onClick={() => setTypeFilter("all")}>
                      category: {categoryLabel} <span className={styles.filterChipX}>×</span>
                    </button>
                  ) : null}
                  {horseLabel ? (
                    <button type="button" className={styles.filterChip} onClick={() => setHorseFilter("all")}>
                      horse: {horseLabel} <span className={styles.filterChipX}>×</span>
                    </button>
                  ) : null}
                  {dateLabel ? (
                    <button type="button" className={styles.filterChip} onClick={() => { setFromDate(""); setToDate(""); }}>
                      date: {dateLabel} <span className={styles.filterChipX}>×</span>
                    </button>
                  ) : null}
                </div>
              ) : null}
            </>
          );
        })()}

        <div className={styles.resultsCount}>
          {filteredCount === totalCount
            ? `showing ${filteredCount} ${activeTab} records`
            : `showing ${filteredCount} of ${totalCount} ${activeTab} records`}
        </div>

        <section className={styles.recordsCard}>
          <div className={styles.tableHeader}>
            <span className={`${styles.colRecord} ${styles.sortableHeader}`} onClick={() => handleSort("record")}>Record{sortArrow("record")}</span>
            <span className={`${styles.colSubtitle} ${styles.sortableHeader}`} onClick={() => handleSort("detail")}>Detail{sortArrow("detail")}</span>
            <span className={`${styles.colDate} ${styles.sortableHeader}`} onClick={() => handleSort("date")}>Date{sortArrow("date")}</span>
            <span className={`${styles.colCategory} ${styles.sortableHeader}`} onClick={() => handleSort("category")}>Category{sortArrow("category")}</span>
            <span className={`${styles.colHorse} ${styles.sortableHeader}`} onClick={() => handleSort("horse")}>Horse{sortArrow("horse")}</span>
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
              const dateSoon = activeTab === "upcoming" && daysUntil(row.eventDate) <= 3;
              const subtitle = getRecordSubtitle(record);

              return (
                <div key={`${record._id}-${row.isFollowup ? "f" : "s"}-${row.eventDate}`}>
                  <div
                    className={`${styles.recordRow} ${expanded ? styles.recordRowExpanded : ""}`}
                    onClick={() => {
                      setExpandedId((prev) => (prev === record._id ? null : record._id));
                      setMenuOpenId(null);
                      setEditingRecordId(null);
                      setEditState(null);
                    }}
                  >
                    <span className={styles.colRecord}>
                      <span className={styles.recordIcon}>{recordIcon(record.type)}</span>
                      <span className={styles.recordLabel}>{getRecordLabel(record)}</span>
                      {activeTab === "upcoming" && row.isFollowup ? <span className={styles.followupBadge}>f/u</span> : null}
                    </span>
                    <span className={styles.colSubtitle}>{subtitle || <span className={styles.muted}>—</span>}</span>
                    <span className={`${styles.colDate} ${dateSoon ? styles.recordDateSoon : ""}`}>{formatDateShort(row.eventDate)}</span>
                    <span className={styles.colCategory}>
                      <span className={styles.categoryBadge} style={{ background: badgeColors.bg, color: badgeColors.color }}>
                        {prettyType(record.type)}
                      </span>
                    </span>
                    <span className={styles.colHorse}>
                      <Link
                        href={record.horseId ? `/horses/${record.horseId}` : "/horses"}
                        className={styles.recordHorseLink}
                        onClick={(event) => event.stopPropagation()}
                      >
                        {record.horseName}
                      </Link>
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
                            <ExpandedInput label={contactLabel(editState.type)}>
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
                                {editProviderDropdownOpen && editState.contactName.trim() && (() => {
                                  const term = editState.contactName.trim().toLowerCase();
                                  const matches = allContactsForRecord.filter((c) => c.name.toLowerCase().includes(term));
                                  if (matches.length === 0) return null;
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
                            <ExpandedInput label="RECORD TYPE">
                              <select
                                className={styles.expandedInput}
                                value={editState.type}
                                onChange={(event) => setEditState({ ...editState, type: event.target.value as RecordType, visitType: event.target.value === "veterinary" ? editState.visitType : "", serviceType: event.target.value === "farrier" ? editState.serviceType : "", customType: event.target.value === "other" ? editState.customType : "" })}
                              >
                                <option value="veterinary">Veterinary</option>
                                <option value="medication">Medication</option>
                                <option value="farrier">Farrier</option>
                                <option value="bodywork">Bodywork</option>
                                <option value="other">Other</option>
                              </select>
                            </ExpandedInput>
                            {editState.type === "veterinary" ? (
                              <>
                                <ExpandedInput label="VISIT TYPE">
                                  <div className={styles.chipRow}>
                                    {VET_SUBCATEGORY_OPTIONS.map((opt) => {
                                      const active = editState.visitTypes.includes(opt.value);
                                      return (
                                        <button
                                          type="button"
                                          key={opt.value}
                                          className={`${styles.serviceChip} ${active ? styles.serviceChipActive : ""}`}
                                          onClick={(event) => {
                                            event.stopPropagation();
                                            setEditState({
                                              ...editState,
                                              visitTypes: active
                                                ? editState.visitTypes.filter((v) => v !== opt.value)
                                                : [...editState.visitTypes, opt.value],
                                            });
                                          }}
                                        >
                                          {opt.label}
                                        </button>
                                      );
                                    })}
                                  </div>
                                </ExpandedInput>
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
                            {editState.type === "farrier" ? (
                              <ExpandedInput label="SERVICE TYPE">
                                <select
                                  className={styles.expandedInput}
                                  value={editState.serviceType}
                                  onChange={(event) => setEditState({ ...editState, serviceType: event.target.value })}
                                >
                                  <option value="">select...</option>
                                  {farrierServiceTypes.map((service) => (
                                    <option key={service} value={service}>{service}</option>
                                  ))}
                                </select>
                              </ExpandedInput>
                            ) : null}
                            {editState.type === "other" ? (
                              <ExpandedInput label="DESCRIBE TYPE">
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
                              <ExpandedField label="HORSE" value={record.horseName} />
                              <ExpandedField label={contactLabel(record.type)} value={record.contactName} />
                              <ExpandedField label="DATE" value={formatDateLong(row.eventDate)} />
                              <ExpandedField label="CREATED BY" value={(record as any).createdBy} />
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
                                    title: record.title || "",
                                    type: record.type,
                                    visitType: (record.visitType || "") as "" | VetSubcategory,
                                    visitTypes: (record.visitTypes?.length ? record.visitTypes : record.visitType ? [record.visitType] : []) as VetSubcategory[],
                                    vetOtherDescription: record.vetOtherDescription || "",
                                    contactName: record.contactName || "",
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
            <RecordField label="TITLE">
              <input
                className={styles.recordInput}
                value={recordForm.title}
                onChange={(event) => setRecordForm((prev) => ({ ...prev, title: event.target.value }))}
                placeholder="e.g., Spring Vaccinations, Annual Coggins"
              />
            </RecordField>

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

            <RecordField label="CATEGORY" required>
              <select className={styles.recordInput} value={selectedRecordType ?? ""} onChange={(event) => handleRecordTypeChange(event.target.value)}>
                <option value="">select category...</option>
                <option value="veterinary">Veterinary</option>
                <option value="farrier">Farrier</option>
                <option value="bodywork">Bodywork</option>
                <option value="other">Other</option>
              </select>
            </RecordField>

            {selectedRecordType ? (
              <>
                {selectedRecordType === "veterinary" ? (
                  <>
                    <RecordField label="SUBCATEGORY">
                      <div className={styles.multiSelectContainer} ref={subcatDropdownRef}>
                        <div
                          className={`${styles.multiSelectInput} ${subcatDropdownOpen ? styles.multiSelectInputOpen : ""}`}
                          onClick={() => setSubcatDropdownOpen((prev) => !prev)}
                        >
                          {recordForm.visitTypes.length > 0 ? (
                            <>
                              {recordForm.visitTypes.map((vt) => {
                                const label = VET_SUBCATEGORY_OPTIONS.find((o) => o.value === vt)?.label ?? vt;
                                return (
                                  <span key={vt} className={styles.horsePill}>
                                    {label}
                                    <button
                                      type="button"
                                      className={styles.horsePillRemove}
                                      onClick={(event) => {
                                        event.stopPropagation();
                                        setRecordForm((prev) => ({ ...prev, visitTypes: prev.visitTypes.filter((v) => v !== vt) }));
                                      }}
                                    >
                                      ✕
                                    </button>
                                  </span>
                                );
                              })}
                            </>
                          ) : (
                            <span className={styles.multiSelectPlaceholder}>select subcategory...</span>
                          )}
                          <span className={styles.multiSelectCaret}>▼</span>
                        </div>
                        {subcatDropdownOpen ? (
                          <div className={styles.multiSelectDropdown}>
                            {VET_SUBCATEGORY_OPTIONS.map((opt) => {
                              const checked = recordForm.visitTypes.includes(opt.value);
                              return (
                                <button
                                  type="button"
                                  key={opt.value}
                                  className={styles.multiSelectOption}
                                  onClick={() =>
                                    setRecordForm((prev) => ({
                                      ...prev,
                                      visitTypes: checked
                                        ? prev.visitTypes.filter((v) => v !== opt.value)
                                        : [...prev.visitTypes, opt.value],
                                    }))
                                  }
                                >
                                  <span className={`${styles.checkbox} ${checked ? styles.checkboxChecked : styles.checkboxUnchecked}`}>✓</span>
                                  <span>{opt.label}</span>
                                </button>
                              );
                            })}
                          </div>
                        ) : null}
                      </div>
                    </RecordField>
                    {recordForm.visitTypes.includes("medication") ? (
                      <RecordField label="MEDICATION(S)">
                        <div className={styles.chipRow}>
                          {MEDICATION_OPTIONS.map((med) => {
                            const active = recordForm.medications.includes(med);
                            return (
                              <button
                                type="button"
                                key={med}
                                className={`${styles.serviceChip} ${active ? styles.serviceChipActive : ""}`}
                                onClick={() =>
                                  setRecordForm((prev) => ({
                                    ...prev,
                                    medications: active
                                      ? prev.medications.filter((m) => m !== med)
                                      : [...prev.medications, med],
                                  }))
                                }
                              >
                                {med}
                              </button>
                            );
                          })}
                        </div>
                      </RecordField>
                    ) : null}
                    {recordForm.visitTypes.includes("other") ? (
                      <RecordField label="DESCRIBE OTHER">
                        <input
                          className={styles.recordInput}
                          value={recordForm.vetOtherDescription}
                          onChange={(event) => setRecordForm((prev) => ({ ...prev, vetOtherDescription: event.target.value }))}
                          placeholder="e.g., Dental, Chiropractic"
                        />
                      </RecordField>
                    ) : null}
                  </>
                ) : null}

                {selectedRecordType === "other" ? (
                  <RecordField label="DESCRIBE CATEGORY">
                    <input
                      className={styles.recordInput}
                      value={recordForm.customType}
                      onChange={(event) => setRecordForm((prev) => ({ ...prev, customType: event.target.value }))}
                      placeholder="e.g., Dentist, Chiropractor"
                    />
                  </RecordField>
                ) : null}

                <RecordField label="CONTACT" required>
                  <div className={styles.contactSearchWrap} ref={contactDropdownRef}>
                    <input
                      className={styles.recordInput}
                      value={recordForm.contactName}
                      onChange={(event) => {
                        setRecordForm((prev) => ({ ...prev, contactName: event.target.value }));
                        setContactDropdownOpen(true);
                      }}
                      onFocus={() => setContactDropdownOpen(true)}
                      placeholder={contactPlaceholder(selectedRecordType)}
                    />
                    {contactDropdownOpen && (() => {
                      const contactPool = recordProviderCategory ? recordProviders : allContactsForRecord;
                      const term = recordForm.contactName.trim().toLowerCase();
                      const matches = term
                        ? contactPool.filter((c) => c.name.toLowerCase().includes(term))
                        : contactPool;
                      const exactMatch = matches.some((c) => c.name.toLowerCase() === term);
                      return (
                        <div className={styles.contactDropdown}>
                          {matches.slice(0, 8).map((c) => (
                            <button
                              type="button"
                              key={c._id}
                              className={styles.contactDropdownItem}
                              onClick={() => {
                                setRecordForm((prev) => ({ ...prev, contactName: c.name }));
                                setContactDropdownOpen(false);
                              }}
                            >
                              {c.name}
                            </button>
                          ))}
                          {term && !exactMatch ? (
                            <button
                              type="button"
                              className={`${styles.contactDropdownItem} ${styles.contactDropdownAdd}`}
                              onClick={() => setContactDropdownOpen(false)}
                            >
                              + Add &ldquo;{recordForm.contactName.trim()}&rdquo;
                            </button>
                          ) : null}
                          {!term && matches.length === 0 ? (
                            <div className={styles.contactDropdownEmpty}>no contacts found — type to add new</div>
                          ) : null}
                        </div>
                      );
                    })()}
                  </div>
                </RecordField>
              </>
            ) : null}

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
                        return linked ? formatInvoiceName({ contactName: linked.contactName, date: linked.invoiceDate }) : "linked invoice";
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
                                setRecordForm((prev) => ({ ...prev, billId: String(b._id) }));
                                setInvoiceSearch("");
                                setInvoiceDropdownOpen(false);
                              }}
                            >
                              {formatInvoiceName({ contactName: b.contactName, date: b.invoiceDate })}
                            </button>
                          ))}
                        {allInvoicesForLinking.filter((b) => {
                          if (!invoiceSearch.trim()) return true;
                          const term = invoiceSearch.toLowerCase();
                          return b.contactName.toLowerCase().includes(term) || b.invoiceNumber.toLowerCase().includes(term) || b.invoiceDate.includes(term);
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
                  accept=".pdf,.jpg,.jpeg,.png,.mp4,.mov,.webm"
                  onChange={(event: ChangeEvent<HTMLInputElement>) => setRecordAttachment(event.target.files?.[0] ?? null)}
                />
                <div className={styles.dropZoneText}>
                  drop file or <span className={styles.dropZoneBrowse}>browse</span>
                </div>
                <div className={styles.dropZoneSubtext}>PDF, JPG, PNG, MP4, MOV — max 10MB</div>
                {recordAttachment ? <div className={styles.dropZoneFile}>{recordAttachment.name}</div> : null}
              </label>
            </RecordField>

            <RecordField label="NEXT VISIT">
              <div style={{ position: "relative" }}>
                <input
                  className={styles.recordInput}
                  type="date"
                  value={recordForm.nextVisitDate}
                  onChange={(event) => setRecordForm((prev) => ({ ...prev, nextVisitDate: event.target.value }))}
                />
                {recordForm.nextVisitDate ? (
                  <button
                    type="button"
                    className={styles.clearDateBtn}
                    onClick={() => setRecordForm((prev) => ({ ...prev, nextVisitDate: "" }))}
                    aria-label="Clear next visit date"
                  >
                    ✕
                  </button>
                ) : null}
              </div>
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
  if (record.type === "veterinary") {
    const labels = getVetVisitTypeLabels(record);
    if (labels.length > 0) return labels.join(", ");
  }
  if (record.type === "farrier" && record.serviceType) {
    return record.serviceType;
  }
  if (record.type === "other" && record.customType) {
    return record.customType;
  }
  return null;
}

function getRecordSubtitle(record: GlobalRecord): string {
  if (record.contactName) return record.contactName;
  if (record.type === "medication") {
    return record.medications?.length ? record.medications.join(", ") : "";
  }
  return "";
}

function getRecordLabel(record: GlobalRecord) {
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

function getRecordDetail(record: GlobalRecord): React.ReactNode {
  if (record.type === "medication") {
    const meds = record.medications?.length ? record.medications.join(", ") : null;
    return (
      <>
        {meds ? <span className={styles.recordDetailPrimary}>{meds}</span> : null}
        {record.contactName ? <span className={styles.recordDetailSecondary}>{record.contactName}{record.notes ? ` · ${record.notes}` : ""}</span> : record.notes ? <span className={styles.recordDetailSecondary}>{record.notes}</span> : null}
      </>
    );
  }
  if (record.type === "veterinary") {
    return (
      <>
        {record.contactName ? <span className={styles.recordDetailPrimary}>{record.contactName}</span> : null}
      </>
    );
  }
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

function contactLabel(_type: RecordType) {
  return "CONTACT";
}

function contactPlaceholder(type: RecordType) {
  if (type === "veterinary") return "Dr. Sarah Buthe";
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
