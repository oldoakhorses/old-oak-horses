"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type ChangeEvent, type DragEvent, type FormEvent, type ReactNode } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import Modal from "@/components/Modal";
import NavBar from "@/components/NavBar";
import styles from "./dashboard.module.css";

type RecordType = "veterinary" | "medication" | "farrier" | "bodywork" | "other";
type PanelMode = "record" | "document" | "invoice" | null;
type DocumentTag = "coggins" | "health_certificate" | "horse_agreement" | "insurance" | "registration" | "other";

type HorseFormState = {
  name: string;
  yearOfBirth: string;
  usefNumber: string;
  feiNumber: string;
  owner: string;
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
  providerName: string | null;
  providerId: Id<"providers"> | null;
  category: string | null;
  subcategory: string | null;
  categoryId: Id<"categories"> | null;
};

const farrierServiceTypes = ["Full Set", "Reset", "Trim", "Front Only", "Other"];

const initialHorseForm: HorseFormState = {
  name: "",
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
    selectedProvider: "",
    providerName: "",
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

  const activeHorses = useQuery(api.horses.getActiveHorses) ?? [];
  const categories = useQuery(api.categories.getAllCategories) ?? [];
  const upcomingRecords = useQuery(api.horseRecords.getUpcoming) ?? [];
  const recordProviderCategory = selectedRecordType ? RECORD_TYPE_TO_CATEGORY[selectedRecordType] : "";
  const recordProviders =
    useQuery(api.providers.listByCategory, recordProviderCategory ? { category: recordProviderCategory } : "skip") ?? [];

  const createHorse = useMutation(api.horses.createHorse);
  const createHorseRecord = useMutation(api.horseRecords.createHorseRecord);
  const updateHorseRecord = useMutation(api.horseRecords.updateHorseRecord);
  const uploadDocument = useMutation(api.documents.upload);
  const generateUploadUrl = useMutation(api.bills.generateUploadUrl);
  const detectProvider = useAction((api as any).invoiceDetect.detectProvider);
  const parseUploadedInvoice = useAction((api as any).uploads.parseUploadedInvoice);

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

    setFormError("");
    setIsSubmitting(true);
    try {
      await createHorse({
        name: horseForm.name.trim(),
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

      setInvoiceStatusMessage("detecting provider...");
      setInvoiceStage("detecting");
      console.log("2. Extracting text from PDF...");
      const detection = (await detectProvider({ fileStorageId: storageId })) as InvoiceDetectionState;
      if (typeof detection.extractedText === "string") {
        console.log("3. Extracted text length:", detection.extractedText.length);
        console.log("4. Extracted text preview:", detection.extractedText.substring(0, 500));
      }
      console.log("5. Provider match result:", detection);

      if (!detection.matched || !detection.providerId || !detection.categoryId) {
        const fallbackCategory = categories.find((row) => row.slug === "admin");
        if (!fallbackCategory) throw new Error("Fallback category not found");
        setInvoiceStatusMessage("doing things...");
        setInvoiceStage("parsing");
        const fallback = await parseUploadedInvoice({
          fileStorageId: storageId,
          categoryId: fallbackCategory._id,
          customProviderName:
            detection.extractedName && detection.extractedName.toUpperCase() !== "UNKNOWN"
              ? detection.extractedName
              : "Unknown Provider"
        });
        setInvoiceStatusMessage("redirecting...");
        setInvoiceStage("redirecting");
        closePanel();
        router.push(`/invoices/preview/${fallback.billId}`);
        return;
      }

      setInvoiceStatusMessage("doing things...");
      setInvoiceStage("parsing");
      const result = await parseUploadedInvoice({
        fileStorageId: storageId,
        categoryId: detection.categoryId,
        providerId: detection.providerId,
        adminSubcategory: detection.category === "admin" ? detection.subcategory || undefined : undefined,
        duesSubcategory: detection.category === "dues-registrations" ? detection.subcategory || undefined : undefined
      });
      console.log("6. Parsed invoice data:", result);

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
      const providerName =
        recordProviderCategory
          ? recordForm.selectedProvider === "__other"
            ? recordForm.providerName.trim() || undefined
            : recordForm.selectedProvider || undefined
          : recordForm.providerName.trim() || undefined;

      const attachmentStorageId = await uploadAttachmentIfPresent();
      for (const horseId of recordForm.horseIds) {
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

  return (
    <div className="page-shell">
      <NavBar
        items={[
          { label: "old-oak-horses", href: "/dashboard", brand: true },
          { label: "dashboard", current: true },
        ]}
        actions={[
          { label: "biz overview", href: "/biz-overview", variant: "filled" },
        ]}
      />

      <main className="page-main">
        <section className={styles.card}>
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
              const provider = item.record.providerName?.trim();
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
                        {isFollowup ? " follow-up" : subtype ? ` — ${subtype}` : ""}
                        {" — "}
                        {item.horse.name}
                      </span>
                      {isFollowup ? <span className={styles.followupBadge}>follow-up</span> : null}
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
                <div className={styles.horseAvatar}>🐴</div>
                <h3 className={styles.horseName}>{horse.name}</h3>
                <div className={styles.horseMetaLine}>{horseOwnerSexLine(horse.owner, horse.sex)}</div>
                <div className={styles.metaGrid}>
                  <Meta label="YEAR" value={horse.yearOfBirth ? String(horse.yearOfBirth) : "—"} />
                  <Meta label="USEF #" value={horse.usefNumber || "—"} />
                  <Meta label="FEI #" value={horse.feiNumber || "—"} />
                </div>
              </Link>
            ))}

            <button type="button" className={styles.addCard} onClick={() => setShowHorseModal(true)}>
              <div className={styles.plus}>+</div>
              <div>add horse</div>
            </button>
          </div>
        </section>

        <div className="ui-footer">OLD_OAK_HORSES // DASHBOARD</div>
      </main>

      <Modal open={showHorseModal} title="add horse" onClose={() => setShowHorseModal(false)}>
        <form className={styles.form} onSubmit={onSubmitHorse}>
          <Field label="name *">
            <input className={styles.input} value={horseForm.name} onChange={(e) => setHorseForm((p) => ({ ...p, name: e.target.value }))} />
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

function getUpcomingSubtype(record: {
  type: RecordType;
  visitType?: "vaccination" | "treatment";
  serviceType?: string;
  customType?: string;
}) {
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

function getUpcomingDetail(record: {
  type: RecordType;
  visitType?: "vaccination" | "treatment";
  vaccineName?: string;
  treatmentDescription?: string;
  serviceType?: string;
  providerName?: string;
}) {
  if (record.type === "veterinary" && record.visitType === "vaccination" && record.vaccineName) return record.vaccineName;
  if (record.type === "veterinary" && record.visitType === "treatment" && record.treatmentDescription) return record.treatmentDescription;
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
