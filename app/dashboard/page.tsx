"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type ChangeEvent, type DragEvent, type FormEvent, type ReactNode } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import Modal from "@/components/Modal";
import NavBar from "@/components/NavBar";
import { useAuth } from "@/contexts/AuthContext";
import { useOrgArgs } from "@/lib/useOrgArgs";
import styles from "./dashboard.module.css";

type RecordType = "veterinary" | "medication" | "farrier" | "bodywork" | "other";
type PanelMode = "record" | "document" | "invoice" | null;
type DocumentTag = "coggins" | "health_certificate" | "horse_agreement" | "insurance" | "registration" | "other";

type HorseFormState = {
  name: string;
  barnName: string;
  yearOfBirth: string;
  usefNumber: string;
  feiNumber: string;
  owner: string;
};

type RecordFormState = {
  horseIds: Id<"horses">[];
  date: string;
  contactName: string;
  customType: string;
  visitType: "" | "vaccination" | "treatment";
  vaccineName: string;
  treatmentDescription: string;
  serviceType: string;
  nextVisitDate: string;
  notes: string;
};

type DocumentFormState = {
  horseId: Id<"horses"> | "";
  name: string;
  tag: DocumentTag | "";
  notes: string;
};

type DetectionConfidence = "exact" | "partial" | "none";

type InvoiceDetectionState = {
  extractedName: string;
  extractedText?: string;
  matched: boolean;
  confidence: DetectionConfidence;
  contactName: string | null;
  contactId: Id<"contacts"> | null;
  category: string | null;
  subcategory: string | null;
  categoryId: Id<"categories"> | null;
};

const farrierServiceTypes = ["Full Set", "Reset", "Trim", "Front Only", "Other"];

const initialHorseForm: HorseFormState = {
  name: "",
  barnName: "",
  yearOfBirth: "",
  usefNumber: "",
  feiNumber: "",
  owner: "",
};

const DOCUMENT_TAG_LABELS: Record<DocumentTag, string> = {
  coggins: "Coggins",
  health_certificate: "Health Certificate",
  horse_agreement: "Horse Agreement",
  insurance: "Insurance",
  registration: "Registration",
  other: "Other",
};

function getTodayDate() {
  return new Date().toISOString().split("T")[0];
}

function createInitialRecordForm(): RecordFormState {
  return {
    horseIds: [],
    date: getTodayDate(),
    contactName: "",
    customType: "",
    visitType: "",
    vaccineName: "",
    treatmentDescription: "",
    serviceType: "",
    nextVisitDate: "",
    notes: "",
  };
}

function createInitialDocumentForm(): DocumentFormState {
  return {
    horseId: "",
    name: "",
    tag: "",
    notes: "",
  };
}

const recordTypeOptions: Array<{ type: RecordType; label: string }> = [
  { type: "veterinary", label: "Veterinary" },
  { type: "medication", label: "Medication" },
  { type: "farrier", label: "Farrier" },
  { type: "bodywork", label: "Bodywork" },
  { type: "other", label: "Other" },
];

const RECORD_TYPE_TO_CATEGORY: Record<RecordType, string> = {
  veterinary: "veterinary",
  medication: "veterinary",
  farrier: "farrier",
  bodywork: "bodywork",
  other: "",
};

export default function DashboardPage() {
  const router = useRouter();
  const { user } = useAuth();
  const searchParams = useSearchParams();
  const [showHorseModal, setShowHorseModal] = useState(false);
  const [horseForm, setHorseForm] = useState<HorseFormState>(initialHorseForm);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState("");

  const [fabMenuOpen, setFabMenuOpen] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const [panelMode, setPanelMode] = useState<PanelMode>(null);
  const [selectedRecordType, setSelectedRecordType] = useState<RecordType | null>(null);
  const [recordForm, setRecordForm] = useState<RecordFormState>(createInitialRecordForm);
  const [recordAttachment, setRecordAttachment] = useState<File | null>(null);
  const [recordSubmitting, setRecordSubmitting] = useState(false);
  const [recordSuccess, setRecordSuccess] = useState(false);
  const [recordError, setRecordError] = useState("");
  const [horseDropdownOpen, setHorseDropdownOpen] = useState(false);
  const [documentForm, setDocumentForm] = useState<DocumentFormState>(createInitialDocumentForm);
  const [documentFile, setDocumentFile] = useState<File | null>(null);
  const [documentUploading, setDocumentUploading] = useState(false);
  const [documentSuccess, setDocumentSuccess] = useState(false);
  const [documentError, setDocumentError] = useState("");
  const [documentDragOver, setDocumentDragOver] = useState(false);
  const [invoiceFile, setInvoiceFile] = useState<File | null>(null);
  const [invoiceStage, setInvoiceStage] = useState<"idle" | "uploading" | "detecting" | "parsing" | "redirecting">("idle");
  const [invoiceError, setInvoiceError] = useState("");
  const [invoiceStatusMessage, setInvoiceStatusMessage] = useState("");

  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const horseDropdownRef = useRef<HTMLDivElement | null>(null);
  const fabRef = useRef<HTMLDivElement | null>(null);
  const fabMenuRef = useRef<HTMLDivElement | null>(null);
  const documentFileInputRef = useRef<HTMLInputElement | null>(null);
  const invoiceFileInputRef = useRef<HTMLInputElement | null>(null);
  const initializedFromQueryRef = useRef(false);

  const orgArgs = useOrgArgs();
  const activeHorses = useQuery(api.horses.getActiveHorses, orgArgs) ?? [];
  const categories = useQuery(api.categories.getAllCategories) ?? [];
  const upcomingRecords = useQuery(api.horseRecords.getUpcoming, orgArgs) ?? [];

  // Recent activity feed: 5 most-recently-logged records (incl. meds),
  // org-filtered. Used to populate the new "recent activity" panel.
  const allRecordsForFeed = useQuery(api.horseRecords.getAll, orgArgs) ?? [];
  const recentActivity = useMemo(() => {
    const sorted = [...allRecordsForFeed].sort((a: any, b: any) => (b.date ?? 0) - (a.date ?? 0));
    return sorted.slice(0, 5);
  }, [allRecordsForFeed]);

  // Today's plan: union of upcoming horseRecords whose date is today,
  // schedule events for today, and free-form calendar events for today.
  // Date math is done client-side (server queries return broad ranges and
  // we filter locally so org-filtering can fall in too).
  const todayBounds = useMemo(() => {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const end = start + 24 * 60 * 60 * 1000 - 1;
    const isoToday = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    return { start, end, isoToday };
  }, []);
  const todaysScheduleEvents = useQuery(api.scheduleEvents.getByDateRange, {
    startDate: todayBounds.isoToday,
    endDate: todayBounds.isoToday,
  }) ?? [];
  const todaysCalendarEvents = useQuery(api.calendarEvents.getByDateRange, {
    startDate: todayBounds.isoToday,
    endDate: todayBounds.isoToday,
  }) ?? [];
  const orgHorseIds = useMemo(() => new Set(activeHorses.map((h) => String(h._id))), [activeHorses]);
  const todaysItems = useMemo(() => {
    type TodayItem = {
      key: string;
      icon: string;
      title: string;
      detail?: string;
      timeLabel?: string;
      href?: string;
    };

    const out: TodayItem[] = [];

    // 1. Horse records due/scheduled today (vet visits, farrier, etc.).
    for (const r of upcomingRecords as any[]) {
      const t = r.eventDate ?? r.date;
      if (typeof t !== "number") continue;
      if (t < todayBounds.start || t > todayBounds.end) continue;
      // Respect active-org filter via horse membership.
      if (orgArgs.ownerId) {
        if (!orgHorseIds.has(String(r.horseId))) continue;
      }
      const recType = r.record?.type ?? r.type;
      const horseName = r.horse?.name ?? r.horseName ?? "—";
      const isFarrier = recType === "farrier";
      const followupSuffix = (r.type === "followup") ? (isFarrier ? " next due" : " follow-up") : "";
      out.push({
        key: `rec-${r._id ?? r.record?._id}`,
        icon: recordTypeIcon(recType),
        title: `${prettyType(recType)}${followupSuffix} — ${horseName}`,
        detail: r.record?.contactName ?? r.contactName ?? undefined,
        href: `/horses/${r.horseId ?? r.record?.horseId}/records`,
      });
    }

    // 2. Schedule events tied to a horse (showings, lessons targeted to a horse).
    for (const e of todaysScheduleEvents as any[]) {
      if (orgArgs.ownerId && !orgHorseIds.has(String(e.horseId))) continue;
      out.push({
        key: `sched-${e._id}`,
        icon: "📅",
        title: `${e.title || "Scheduled event"} — ${e.horseName ?? ""}`.trim(),
        detail: e.contactName ?? e.notes ?? undefined,
        timeLabel: e.time ?? undefined,
        href: "/calendar",
      });
    }

    // 3. Calendar events — show day, lesson schedule, generic items. These
    //    aren't horse-tied so they always pass the org filter.
    for (const e of todaysCalendarEvents as any[]) {
      out.push({
        key: `cal-${e._id}`,
        icon: "🗓️",
        title: e.title || "Calendar event",
        detail: e.description ?? e.notes ?? undefined,
        timeLabel: e.time ?? undefined,
        href: "/calendar",
      });
    }

    return out;
  }, [upcomingRecords, todaysScheduleEvents, todaysCalendarEvents, todayBounds, orgArgs.ownerId, orgHorseIds]);
  const recordProviderCategory = selectedRecordType ? RECORD_TYPE_TO_CATEGORY[selectedRecordType] : "";
  const allContactsForRecord = useQuery(api.contacts.getAllContacts) ?? [];
  const recordProviders = useMemo(
    () => allContactsForRecord.filter((c: any) => recordProviderCategory && c.category === recordProviderCategory),
    [allContactsForRecord, recordProviderCategory]
  );

  const createHorse = useMutation(api.horses.createHorse);
  const createHorseRecord = useMutation(api.horseRecords.createHorseRecord);
  const updateHorseRecord = useMutation(api.horseRecords.updateHorseRecord);
  const findOrCreateContact = useMutation(api.contacts.findOrCreateContact);
  const uploadDocument = useMutation(api.documents.upload);
  const generateUploadUrl = useMutation(api.bills.generateUploadUrl);
  const parseUploadedInvoice = useAction((api as any).uploads.parseUploadedInvoice);

  const todos = useQuery(api.todos.list) ?? [];
  const addTodo = useMutation(api.todos.add);
  const toggleTodo = useMutation(api.todos.toggle);
  const updateTodoText = useMutation(api.todos.updateText);
  const removeTodo = useMutation(api.todos.remove);
  const [newTodoText, setNewTodoText] = useState("");
  const [editingTodoId, setEditingTodoId] = useState<string | null>(null);
  const [editingTodoText, setEditingTodoText] = useState("");

  const shownHorses = activeHorses;

  const visibleUpcoming = useMemo(() => upcomingRecords.slice(0, 3), [upcomingRecords]);

  useEffect(() => {
    const onEsc = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setFabMenuOpen(false);
        closePanel();
      }
    };
    window.addEventListener("keydown", onEsc);
    return () => {
      window.removeEventListener("keydown", onEsc);
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
      if (resetTimerRef.current) clearTimeout(resetTimerRef.current);
    };
  }, []);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (horseDropdownRef.current && !horseDropdownRef.current.contains(event.target as Node)) {
        setHorseDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    if (!fabMenuOpen) return;
    const handleClickOutside = (event: MouseEvent) => {
      if (
        fabRef.current &&
        !fabRef.current.contains(event.target as Node) &&
        fabMenuRef.current &&
        !fabMenuRef.current.contains(event.target as Node)
      ) {
        setFabMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [fabMenuOpen]);

  useEffect(() => {
    if (initializedFromQueryRef.current) return;
    const panel = searchParams.get("panel");
    if (panel !== "document" && panel !== "record" && panel !== "invoice") {
      initializedFromQueryRef.current = true;
      return;
    }

    const horseId = searchParams.get("horseId") as Id<"horses"> | null;
    setPanelMode(panel);
    setPanelOpen(true);
    if (horseId) {
      if (panel === "document") {
        setDocumentForm((prev) => ({ ...prev, horseId }));
      } else {
        setRecordForm((prev) => ({ ...prev, horseIds: prev.horseIds.includes(horseId) ? prev.horseIds : [...prev.horseIds, horseId] }));
      }
    }
    initializedFromQueryRef.current = true;
  }, [searchParams]);

  async function onSubmitHorse(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!horseForm.name.trim()) {
      setFormError("Name is required.");
      return;
    }
    if (!horseForm.owner.trim()) {
      setFormError("Owner is required — every horse must be attached to an owner.");
      return;
    }

    setFormError("");
    setIsSubmitting(true);
    try {
      await createHorse({
        name: horseForm.name.trim(),
        barnName: horseForm.barnName.trim() || undefined,
        yearOfBirth: horseForm.yearOfBirth ? Number(horseForm.yearOfBirth) : undefined,
        usefNumber: horseForm.usefNumber || undefined,
        feiNumber: horseForm.feiNumber || undefined,
        owner: horseForm.owner || undefined,
      });
      setHorseForm(initialHorseForm);
      setShowHorseModal(false);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Failed to add horse");
    } finally {
      setIsSubmitting(false);
    }
  }

  function openRecordPanel(dateOverride?: string) {
    if (resetTimerRef.current) clearTimeout(resetTimerRef.current);
    setRecordForm((prev) => ({ ...prev, date: dateOverride || getTodayDate() }));
    setPanelMode("record");
    setPanelOpen(true);
  }

  function closePanel() {
    setPanelOpen(false);
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    if (resetTimerRef.current) clearTimeout(resetTimerRef.current);
    resetTimerRef.current = setTimeout(() => {
      setPanelMode(null);
      setSelectedRecordType(null);
      setRecordForm(createInitialRecordForm());
      setRecordAttachment(null);
      setRecordSuccess(false);
      setRecordError("");
      setRecordSubmitting(false);
      setHorseDropdownOpen(false);
      setDocumentForm(createInitialDocumentForm());
      setDocumentFile(null);
      setDocumentUploading(false);
      setDocumentSuccess(false);
      setDocumentError("");
      setDocumentDragOver(false);
      setInvoiceFile(null);
      setInvoiceStage("idle");
      setInvoiceError("");
      setInvoiceStatusMessage("");
    }, 300);
  }

  function handleFabClick() {
    setFabMenuOpen((prev) => !prev);
  }

  function handleFabOptionClick(option: "record" | "invoice" | "document") {
    setFabMenuOpen(false);
    if (option === "record") {
      openRecordPanel();
      return;
    }
    if (option === "invoice") {
      if (resetTimerRef.current) clearTimeout(resetTimerRef.current);
      setPanelMode("invoice");
      setPanelOpen(true);
      setInvoiceStage("idle");
      setInvoiceStatusMessage("");
      setInvoiceFile(null);
      setInvoiceError("");
      return;
    }
    if (option === "document") {
      if (resetTimerRef.current) clearTimeout(resetTimerRef.current);
      setPanelMode("document");
      setPanelOpen(true);
      setDocumentError("");
    }
  }

  function handleAddEvent() {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const date = tomorrow.toISOString().split("T")[0];
    router.push(`/dashboard?panel=record&date=${encodeURIComponent(date)}`);
  }

  function handleRecordTypeChange(type: string) {
    if (!type) {
      setSelectedRecordType(null);
      setRecordForm((prev) => ({
        ...prev,
        contactName: "",
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
      contactName: "",
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

  function handleDocumentFileSelect(file: File | null) {
    if (!file) return;
    setDocumentFile(file);
    const baseName = file.name.replace(/\.[^.]+$/, "");
    setDocumentForm((prev) => ({
      ...prev,
      name: prev.name.trim() ? prev.name : baseName,
    }));
  }

  function handleDocumentDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDocumentDragOver(false);
    handleDocumentFileSelect(event.dataTransfer.files?.[0] ?? null);
  }

  async function onUploadDocument(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!documentFile || !documentForm.horseId || !documentForm.name.trim() || !documentForm.tag) {
      setDocumentError("File, horse, document name, and tag are required.");
      return;
    }

    setDocumentError("");
    setDocumentUploading(true);
    try {
      const uploadUrl = await generateUploadUrl();
      const uploadResponse = await fetch(uploadUrl, {
        method: "POST",
        headers: { "Content-Type": documentFile.type || "application/octet-stream" },
        body: documentFile,
      });
      if (!uploadResponse.ok) {
        throw new Error("File upload failed");
      }
      const payload = await uploadResponse.json();
      const storageId = payload.storageId as Id<"_storage">;

      await uploadDocument({
        name: documentForm.name.trim(),
        tag: documentForm.tag,
        horseId: documentForm.horseId,
        fileStorageId: storageId,
        fileName: documentFile.name,
        fileType: documentFile.type || undefined,
        fileSize: documentFile.size || undefined,
        notes: documentForm.notes.trim() || undefined,
      });

      setDocumentSuccess(true);
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
      closeTimerRef.current = setTimeout(() => {
        closePanel();
      }, 1200);
    } catch (error) {
      setDocumentError(error instanceof Error ? error.message : "Failed to upload document");
    } finally {
      setDocumentUploading(false);
    }
  }

  async function processInvoiceUpload(file: File) {
    if (!file) return;

    setInvoiceError("");
    setInvoiceStatusMessage("uploading...");
    setInvoiceStage("uploading");
    try {
      const uploadUrl = await generateUploadUrl();
      const uploadResponse = await fetch(uploadUrl, {
        method: "POST",
        headers: { "Content-Type": file.type || "application/pdf" },
        body: file
      });
      if (!uploadResponse.ok) {
        throw new Error("Failed to upload invoice PDF");
      }
      const uploadPayload = await uploadResponse.json();
      const storageId = uploadPayload.storageId as Id<"_storage">;
      console.log("1. PDF uploaded, storageId:", storageId);

      // Skip provider/contact detection — we now let the user pick a contact
      // from the preview page while parseBillPdf runs in the background.
      // parseUploadedInvoice creates the bill and schedules the async parse,
      // then returns immediately so we can redirect without waiting on Claude.
      setInvoiceStatusMessage("starting parse...");
      setInvoiceStage("parsing");
      const result = await parseUploadedInvoice({
        fileStorageId: storageId,
        createdBy: user?.name,
      });
      console.log("2. Bill created, parse scheduled:", result);

      setInvoiceStatusMessage("redirecting...");
      setInvoiceStage("redirecting");
      closePanel();
      router.push(`/invoices/preview/${result.billId}`);
    } catch (error) {
      setInvoiceStage("idle");
      setInvoiceStatusMessage("");
      setInvoiceError(error instanceof Error ? error.message : "Failed to upload invoice");
    }
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
      const contactName = recordForm.contactName.trim() || undefined;
      let resolvedContactId: Id<"contacts"> | undefined;
      if (contactName && recordProviderCategory) {
        const cid = await findOrCreateContact({ name: contactName, category: recordProviderCategory });
        if (cid) resolvedContactId = cid;
      }

      const attachmentStorageId = await uploadAttachmentIfPresent();
      for (const horseId of recordForm.horseIds) {
        const mainRecordId = await createHorseRecord({
          horseId,
          type: selectedRecordType,
          customType: selectedRecordType === "other" ? recordForm.customType.trim() || undefined : undefined,
          date: new Date(`${recordForm.date}T00:00:00`).getTime(),
          contactName,
          contactId: resolvedContactId,
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
        });
        if (recordForm.nextVisitDate) {
          const upcomingRecordId = await createHorseRecord({
            horseId,
            type: selectedRecordType,
            customType: selectedRecordType === "other" ? recordForm.customType.trim() || undefined : undefined,
            date: new Date(`${recordForm.nextVisitDate}T00:00:00`).getTime(),
            contactName,
            contactId: resolvedContactId,
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

  return (
    <div className="page-shell">
      <NavBar
        items={[
          { label: "team-ldk", href: "/dashboard", brand: true },
          { label: "dashboard", current: true },
        ]}


      />

      <main className="page-main">
        {/* TO-DO section temporarily hidden — flip `false` to `true` to
            restore. Backend queries (api.todos.*) still fire so the data
            stays warm; toggle the useQuery args at the top of the file to
            "skip" if you want them quiet too. */}
        {false && (
        <section className={styles.card}>
          <div className={styles.upcomingLabel}>// TO-DO</div>
          <div className={styles.sectionHeader}>
            <h2 className={styles.sectionTitle}>to-do</h2>
          </div>

          <div className={styles.todoInputRow}>
            <input
              className={styles.todoInput}
              placeholder="add a task..."
              value={newTodoText}
              onChange={(e) => setNewTodoText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && newTodoText.trim()) {
                  void addTodo({ text: newTodoText.trim() });
                  setNewTodoText("");
                }
              }}
            />
            <button
              type="button"
              className={styles.todoAddBtn}
              disabled={!newTodoText.trim()}
              onClick={() => {
                if (newTodoText.trim()) {
                  void addTodo({ text: newTodoText.trim() });
                  setNewTodoText("");
                }
              }}
            >
              +
            </button>
          </div>

          {todos.filter((t) => !t.completed).length === 0 && todos.filter((t) => t.completed).length === 0 ? (
            <div className={styles.todoEmpty}>no tasks yet</div>
          ) : null}

          {todos.filter((t) => !t.completed).map((todo) => (
            <div key={todo._id} className={styles.todoRow}>
              <button
                type="button"
                className={styles.todoCheck}
                onClick={() => void toggleTodo({ id: todo._id })}
              />
              {editingTodoId === todo._id ? (
                <input
                  className={styles.todoEditInput}
                  value={editingTodoText}
                  autoFocus
                  onChange={(e) => setEditingTodoText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      void updateTodoText({ id: todo._id, text: editingTodoText.trim() || todo.text });
                      setEditingTodoId(null);
                    }
                    if (e.key === "Escape") setEditingTodoId(null);
                  }}
                  onBlur={() => {
                    void updateTodoText({ id: todo._id, text: editingTodoText.trim() || todo.text });
                    setEditingTodoId(null);
                  }}
                />
              ) : (
                <span
                  className={styles.todoText}
                  onDoubleClick={() => {
                    setEditingTodoId(todo._id);
                    setEditingTodoText(todo.text);
                  }}
                >
                  {todo.text}
                </span>
              )}
              <button
                type="button"
                className={styles.todoRemove}
                onClick={() => void removeTodo({ id: todo._id })}
              >
                ×
              </button>
            </div>
          ))}

          {todos.filter((t) => t.completed).length > 0 ? (
            <div className={styles.todoDoneSection}>
              <div className={styles.todoDoneLabel}>completed</div>
              {todos.filter((t) => t.completed).map((todo) => (
                <div key={todo._id} className={`${styles.todoRow} ${styles.todoRowDone}`}>
                  <button
                    type="button"
                    className={`${styles.todoCheck} ${styles.todoCheckDone}`}
                    onClick={() => void toggleTodo({ id: todo._id })}
                  >
                    ✓
                  </button>
                  <span className={`${styles.todoText} ${styles.todoTextDone}`}>{todo.text}</span>
                  <button
                    type="button"
                    className={styles.todoRemove}
                    onClick={() => void removeTodo({ id: todo._id })}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          ) : null}
        </section>
        )}

        {/* TODAY — what's on the plate for the day. Pulls from upcoming
            horse records due today + horse-tied schedule events for today
            + free-form calendar events (show plan / lesson schedule). */}
        <section className={`${styles.card} ${styles.todayCard}`}>
          <div className={styles.upcomingLabel}>// TODAY</div>
          <div className={styles.sectionHeader}>
            <h2 className={styles.sectionTitle}>today</h2>
            <Link href="/calendar" className={styles.viewAll}>
              calendar →
            </Link>
          </div>

          {todaysItems.length === 0 ? (
            <div className={styles.upcomingEmpty}>
              <div className={styles.upcomingEmptyTitle}>nothing on the schedule</div>
              <div className={styles.upcomingEmptySub}>upcoming records, scheduled events, and calendar items will appear here on the day they happen</div>
            </div>
          ) : (
            <div className={styles.todayGrid}>
              {todaysItems.map((item) => {
                const inner = (
                  <>
                    <span className={styles.todayIcon}>{item.icon}</span>
                    <div className={styles.todayContent}>
                      <div className={styles.todayTitle}>
                        {item.timeLabel ? <span className={styles.todayTime}>{item.timeLabel}</span> : null}
                        <span>{item.title}</span>
                      </div>
                      {item.detail ? <div className={styles.todayDetail}>{item.detail}</div> : null}
                    </div>
                  </>
                );
                return item.href ? (
                  <Link key={item.key} href={item.href} className={styles.todayItem}>
                    {inner}
                  </Link>
                ) : (
                  <div key={item.key} className={styles.todayItem}>
                    {inner}
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* HORSES — now top of the page per the user's reorg request. */}
        <section className={styles.horsesSection}>
          <div className={styles.horsesHead}>
            <div className="ui-label">// HORSES</div>
            <Link href="/horses" className={styles.viewAll}>
              view all →
            </Link>
          </div>

          <div className={styles.grid}>
            {shownHorses.map((horse) => (
              <Link href={`/horses/${horse._id}`} key={horse._id} className={styles.horseCard}>
                <div className={styles.horseCardTop}>
                  <div className={styles.horseAvatar}>🐴</div>
                </div>
                <div className={styles.horseCardBody}>
                  <h3 className={styles.horseName}>{horse.name}</h3>
                  <div className={styles.horseMetaLine}>{horseOwnerSexLine(horse.owner, horse.sex)}</div>
                </div>
              </Link>
            ))}

            <button type="button" className={styles.addCard} onClick={() => setShowHorseModal(true)}>
              <div className={styles.plus}>+</div>
              <div>add horse</div>
            </button>
          </div>
        </section>

        {/* Two-column row: RECENT ACTIVITY (left 2/3) + UPCOMING (right 1/3). */}
        <div className={styles.activityRow}>
          <section className={`${styles.card} ${styles.recentActivityCard}`}>
            <div className={styles.upcomingLabel}>// RECENT ACTIVITY</div>
            <div className={styles.sectionHeader}>
              <h2 className={styles.sectionTitle}>recent activity</h2>
              <Link href="/records" className={styles.viewAll}>
                see all →
              </Link>
            </div>

            {recentActivity.length === 0 ? (
              <div className={styles.upcomingEmpty}>
                <div className={styles.upcomingEmptyTitle}>nothing logged yet</div>
                <div className={styles.upcomingEmptySub}>records and meds will show up here as they're added</div>
              </div>
            ) : (
              recentActivity.map((rec: any) => {
                const icon = rec.type === "medication"
                  ? "💊"
                  : rec.type === "veterinary"
                    ? "🩺"
                    : rec.type === "farrier"
                      ? "🔧"
                      : rec.type === "bodywork"
                        ? "🦴"
                        : "📋";
                const d = new Date(rec.date ?? 0);
                const month = d.toLocaleString("en-US", { month: "short" }).toUpperCase();
                const day = String(d.getDate());
                const detail = rec.type === "medication"
                  ? (Array.isArray(rec.medications) && rec.medications.length > 0 ? rec.medications.join(", ") : (rec.treatmentDescription ?? ""))
                  : (rec.visitTypes?.join(", ") || rec.visitType || rec.vaccineName || rec.serviceType || rec.customType || "");
                return (
                  <div key={rec._id} className={styles.upcomingRow}>
                    <div className={styles.upcomingDateBlock}>
                      <div className={styles.upcomingDateMonth}>{month}</div>
                      <div className={styles.upcomingDateDay}>{day}</div>
                    </div>
                    <div className={styles.upcomingContent}>
                      <div className={styles.upcomingTitle}>
                        <span>{icon}</span>
                        <span>
                          {prettyType(rec.type)}
                          {" — "}
                          {rec.horseName ?? rec.horse?.name ?? "—"}
                        </span>
                      </div>
                      {rec.contactName || detail ? (
                        <div className={styles.upcomingDetail}>
                          {rec.contactName && detail ? `${rec.contactName} · ${detail}` : (rec.contactName || detail)}
                        </div>
                      ) : null}
                    </div>
                  </div>
                );
              })
            )}
          </section>

          <section className={`${styles.card} ${styles.upcomingCard}`}>
          <div className={styles.upcomingLabel}>// UPCOMING</div>
          <div className={styles.sectionHeader}>
            <h2 className={styles.sectionTitle}>upcoming</h2>
            <button type="button" className={styles.btnAddEvent} onClick={handleAddEvent}>
              + add event
            </button>
          </div>

          {visibleUpcoming.length === 0 ? (
            <div className={styles.upcomingEmpty}>
              <div className={styles.upcomingEmptyTitle}>no upcoming events</div>
              <div className={styles.upcomingEmptySub}>schedule visits using + add event</div>
            </div>
          ) : (
            visibleUpcoming.map((item, index) => {
              const icon = recordTypeIcon(item.record.type);
              const subtype = getUpcomingSubtype(item.record);
              const isFollowup = item.type === "followup";
              // Farrier upcoming events are recurring maintenance, not
              // follow-ups — relabel the pill + inline text accordingly.
              const isFarrier = item.record.type === "farrier";
              const followupLabel = isFarrier ? "next due" : "follow-up";
              const provider = item.record.contactName?.trim();
              const detail = getUpcomingDetail(item.record);
              const daysAway = daysUntil(item.eventDate);
              const isToday = daysAway === 0;
              const isSoon = daysAway > 0 && daysAway <= 3;

              return (
                <div key={`${item.record._id}-${item.type}-${item.eventDate}-${index}`} className={styles.upcomingRow}>
                  <div
                    className={`${styles.upcomingDateBlock} ${isToday ? styles.upcomingDateBlockToday : ""} ${isSoon ? styles.upcomingDateBlockSoon : ""}`}
                  >
                    <div className={styles.upcomingDateMonth}>{formatMonth(item.eventDate)}</div>
                    <div className={styles.upcomingDateDay}>{formatDay(item.eventDate)}</div>
                  </div>
                  <div className={styles.upcomingContent}>
                    <div className={styles.upcomingTitle}>
                      <span>{icon}</span>
                      <span>
                        {prettyType(item.record.type)}
                        {isFollowup ? ` ${followupLabel}` : subtype ? ` — ${subtype}` : ""}
                        {" — "}
                        {item.horse.name}
                      </span>
                      {isFollowup ? <span className={styles.followupBadge}>{followupLabel}</span> : null}
                    </div>
                    {provider || detail ? (
                      <div className={styles.upcomingDetail}>
                        {provider && detail ? `${provider} · ${detail}` : provider || detail}
                      </div>
                    ) : null}
                  </div>
                </div>
              );
            })
          )}

          <button type="button" className={styles.upcomingSeeAll} onClick={() => router.push("/records")}>
            see all records →
          </button>
          </section>
        </div>

        <div className="ui-footer">TEAM_LDK // DASHBOARD</div>
      </main>

      <Modal open={showHorseModal} title="add horse" onClose={() => setShowHorseModal(false)}>
        <form className={styles.form} onSubmit={onSubmitHorse}>
          <Field label="name *">
            <input className={styles.input} value={horseForm.name} onChange={(e) => setHorseForm((p) => ({ ...p, name: e.target.value }))} />
          </Field>
          <Field label="barn name">
            <input className={styles.input} value={horseForm.barnName} onChange={(e) => setHorseForm((p) => ({ ...p, barnName: e.target.value }))} placeholder="nickname / call name" />
          </Field>
          <Field label="year of birth">
            <input
              className={styles.input}
              type="number"
              value={horseForm.yearOfBirth}
              onChange={(e) => setHorseForm((p) => ({ ...p, yearOfBirth: e.target.value }))}
            />
          </Field>
          <div className={styles.twoCol}>
            <Field label="usef #">
              <input className={styles.input} value={horseForm.usefNumber} onChange={(e) => setHorseForm((p) => ({ ...p, usefNumber: e.target.value }))} />
            </Field>
            <Field label="fei #">
              <input className={styles.input} value={horseForm.feiNumber} onChange={(e) => setHorseForm((p) => ({ ...p, feiNumber: e.target.value }))} />
            </Field>
          </div>
          <Field label="owner">
            <input className={styles.input} value={horseForm.owner} onChange={(e) => setHorseForm((p) => ({ ...p, owner: e.target.value }))} />
          </Field>
          <ModalActions loading={isSubmitting} submitLabel="add horse" onCancel={() => setShowHorseModal(false)} error={formError} />
        </form>
      </Modal>

    </div>
  );
}

function horseOwnerSexLine(owner?: string, sex?: "gelding" | "mare" | "stallion") {
  const parts: string[] = [];
  if (owner) parts.push(owner);
  if (sex) parts.push(capitalize(sex));
  return parts.length > 0 ? parts.join(" · ") : "—";
}

function capitalize(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function contactLabel(type: RecordType) {
  if (type === "veterinary") return "VETERINARIAN";
  if (type === "medication") return "ADMINISTERED BY";
  if (type === "farrier") return "FARRIER";
  if (type === "bodywork") return "PRACTITIONER";
  return "PROVIDER";
}

function contactPlaceholder(type: RecordType) {
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

function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 102.4) / 10} KB`;
  return `${Math.round(bytes / (1024 * 102.4)) / 10} MB`;
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className={styles.field}>
      <span className={styles.fieldLabel}>{label}</span>
      {children}
    </label>
  );
}

function RecordField({ label, required, children }: { label: string; required?: boolean; children: ReactNode }) {
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

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className={styles.metaLabel}>{label}</div>
      <div className={styles.metaValue}>{value}</div>
    </div>
  );
}

function ModalActions({
  loading,
  submitLabel,
  onCancel,
  error,
}: {
  loading: boolean;
  submitLabel: string;
  onCancel: () => void;
  error: string;
}) {
  return (
    <>
      {error ? <p className={styles.error}>{error}</p> : null}
      <div className={styles.modalActions}>
        <button type="button" className="ui-button-outlined" onClick={onCancel}>
          cancel
        </button>
        <button type="submit" className="ui-button-filled" disabled={loading}>
          {loading ? "saving..." : submitLabel}
        </button>
      </div>
    </>
  );
}

function recordTypeIcon(type: RecordType) {
  if (type === "veterinary") return "🩺";
  if (type === "medication") return "💊";
  if (type === "farrier") return "🔧";
  if (type === "bodywork") return "🦴";
  return "📋";
}

function prettyType(type: RecordType) {
  if (type === "bodywork") return "Bodywork";
  return capitalize(type);
}

const VISIT_TYPE_LABELS: Record<string, string> = {
  vaccination: "Vaccination",
  vaccinations: "Vaccinations",
  treatment: "Treatment",
  medication: "Medication",
  joint_injections: "Joint Injections",
  exams_diagnostics: "Exams & Diagnostics",
  shockwave: "Shockwave",
  sedation: "Sedation",
  fees: "Fees",
  lab_work: "Lab Work",
  blood_test: "Blood Test",
  other: "Other",
};

function getUpcomingSubtype(record: {
  type: RecordType;
  visitType?: string;
  serviceType?: string;
  customType?: string;
}) {
  if (record.type === "veterinary" && record.visitType) {
    return VISIT_TYPE_LABELS[record.visitType] ?? record.visitType;
  }
  if (record.type === "farrier" && record.serviceType) {
    return record.serviceType;
  }
  if (record.type === "other" && record.customType) {
    return record.customType;
  }
  return null;
}

function getUpcomingDetail(record: {
  type: RecordType;
  visitType?: string;
  vaccineName?: string;
  treatmentDescription?: string;
  serviceType?: string;
  contactName?: string;
}) {
  if (record.type === "veterinary" && record.visitType === "vaccination" && record.vaccineName) return record.vaccineName;
  if (record.type === "veterinary" && record.treatmentDescription) return record.treatmentDescription;
  if (record.type === "farrier" && record.serviceType) return record.serviceType;
  return "";
}

function formatMonth(timestamp: number) {
  return new Date(timestamp).toLocaleDateString("en-US", { month: "short" }).toUpperCase();
}

function formatDay(timestamp: number) {
  return String(new Date(timestamp).getDate());
}

function daysUntil(timestamp: number) {
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const target = new Date(timestamp);
  target.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - startOfToday.getTime()) / 86400000);
}
