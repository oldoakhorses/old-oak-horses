"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type ChangeEvent, type DragEvent, type FormEvent, type ReactNode } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import styles from "@/app/dashboard/dashboard.module.css";

type RecordType = "veterinary" | "medication" | "farrier" | "bodywork" | "other";
type PanelMode = "record" | "document" | "invoice" | null;
type DocumentTag = "coggins" | "health_certificate" | "horse_agreement" | "insurance" | "registration" | "other";

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

type DetectedHorseNotes = {
  horseId: Id<"horses">;
  horseName: string;
  notes: string;
};

type RecordReportDetectionState = {
  detected: boolean;
  reportType: "bodywork" | "invoice" | "unknown";
  message: string;
  perHorseNotes?: DetectedHorseNotes[];
};

const farrierServiceTypes = ["Full Set", "Reset", "Trim", "Front Only", "Other"];
const HIDDEN_PATHS = new Set(["/", "/login", "/investor", "/investor/dashboard"]);

const DOCUMENT_TAG_LABELS: Record<DocumentTag, string> = {
  coggins: "Coggins",
  health_certificate: "Health Certificate",
  horse_agreement: "Horse Agreement",
  insurance: "Insurance",
  registration: "Registration",
  other: "Other",
};

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

export default function GlobalFab() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const isHidden =
    HIDDEN_PATHS.has(pathname) ||
    pathname.startsWith("/sign-in") ||
    pathname.startsWith("/sign-up") ||
    pathname.startsWith("/investor/");

  const [fabMenuOpen, setFabMenuOpen] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const [panelMode, setPanelMode] = useState<PanelMode>(null);
  const [selectedRecordType, setSelectedRecordType] = useState<RecordType | null>(null);
  const [recordForm, setRecordForm] = useState<RecordFormState>(createInitialRecordForm);
  const [recordAttachment, setRecordAttachment] = useState<File | null>(null);
  const [recordAttachmentStorageId, setRecordAttachmentStorageId] = useState<Id<"_storage"> | null>(null);
  const [recordDetecting, setRecordDetecting] = useState(false);
  const [recordReportDetection, setRecordReportDetection] = useState<RecordReportDetectionState>({
    detected: false,
    reportType: "unknown",
    message: ""
  });
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
  const [invoiceDragOver, setInvoiceDragOver] = useState(false);
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

  const activeHorses = useQuery(api.horses.getActiveHorses) ?? [];
  const categories = useQuery(api.categories.getAllCategories) ?? [];
  const recordProviderCategory = selectedRecordType ? RECORD_TYPE_TO_CATEGORY[selectedRecordType] : "";
  const recordProviders =
    useQuery(api.providers.listByCategory, recordProviderCategory ? { category: recordProviderCategory } : "skip") ?? [];

  const createHorseRecord = useMutation(api.horseRecords.createHorseRecord);
  const updateHorseRecord = useMutation(api.horseRecords.updateHorseRecord);
  const uploadDocument = useMutation(api.documents.upload);
  const generateUploadUrl = useMutation(api.bills.generateUploadUrl);
  const detectProvider = useAction((api as any).invoiceDetect.detectProvider);
  const detectRecordReport = useAction((api as any).reportDetect.detectReportFromPdf);
  const parseUploadedInvoice = useAction((api as any).uploads.parseUploadedInvoice);

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
    const panel = searchParams.get("panel");
    if (panel !== "document" && panel !== "record" && panel !== "invoice") return;

    const horseId = searchParams.get("horseId") as Id<"horses"> | null;
    const date = searchParams.get("date") || undefined;

    if (panel === "record") {
      openRecordPanel(date);
    } else {
      if (resetTimerRef.current) clearTimeout(resetTimerRef.current);
      setPanelMode(panel);
      setPanelOpen(true);
      if (panel === "invoice") {
        setInvoiceStage("idle");
        setInvoiceStatusMessage("");
        setInvoiceFile(null);
        setInvoiceError("");
      }
    }

    if (horseId) {
      if (panel === "document") {
        setDocumentForm((prev) => ({ ...prev, horseId }));
      } else {
        setRecordForm((prev) => ({ ...prev, horseIds: prev.horseIds.includes(horseId) ? prev.horseIds : [...prev.horseIds, horseId] }));
      }
    }

    const params = new URLSearchParams(searchParams.toString());
    params.delete("panel");
    params.delete("horseId");
    params.delete("date");
    const next = params.toString();
    router.replace(next ? `${pathname}?${next}` : pathname);
  }, [pathname, router, searchParams]);

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
      setRecordAttachmentStorageId(null);
      setRecordDetecting(false);
      setRecordReportDetection({ detected: false, reportType: "unknown", message: "" });
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
    if (recordAttachmentStorageId) return recordAttachmentStorageId;
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
    const storageId = typeof payload.storageId === "string" ? (payload.storageId as Id<"_storage">) : undefined;
    if (storageId) setRecordAttachmentStorageId(storageId);
    return storageId;
  }

  async function handleRecordAttachmentSelect(file: File | null) {
    setRecordAttachment(file);
    setRecordAttachmentStorageId(null);
    setRecordReportDetection({ detected: false, reportType: "unknown", message: "" });
    if (!file || file.type !== "application/pdf") return;

    setRecordDetecting(true);
    try {
      const uploadUrl = await generateUploadUrl();
      const uploadResponse = await fetch(uploadUrl, {
        method: "POST",
        headers: { "Content-Type": file.type || "application/pdf" },
        body: file
      });
      if (!uploadResponse.ok) throw new Error("Failed to upload attachment for detection");
      const payload = await uploadResponse.json();
      const storageId = payload.storageId as Id<"_storage">;
      setRecordAttachmentStorageId(storageId);

      const detection = await detectRecordReport({ fileStorageId: storageId }) as {
        reportType: "bodywork" | "invoice" | "unknown";
        matchedHorseName?: string | null;
        reportDate?: string | null;
        providerName?: string | null;
        treatmentNotes?: string | null;
        horses?: Array<{
          extractedHorseName: string;
          matchedHorseName: string | null;
          treatmentNotes: string;
          sessionNumber: number | null;
        }>;
      };

      if (detection.reportType !== "bodywork") return;

      // Match all detected horses to active horses
      const detectedHorses = detection.horses ?? [];
      const matchedHorseIds: Id<"horses">[] = [];
      const perHorseNotes: DetectedHorseNotes[] = [];

      for (const dh of detectedHorses) {
        const matchName = dh.matchedHorseName ?? dh.extractedHorseName;
        const horse = matchName
          ? activeHorses.find((h) => h.name.toLowerCase() === matchName.toLowerCase())
          : undefined;
        if (horse) {
          matchedHorseIds.push(horse._id);
          perHorseNotes.push({
            horseId: horse._id,
            horseName: horse.name,
            notes: dh.treatmentNotes || "",
          });
        }
      }

      // Fallback to single-horse matching if multi-horse didn't work
      if (matchedHorseIds.length === 0 && detection.matchedHorseName) {
        const horse = activeHorses.find((h) => h.name.toLowerCase() === detection.matchedHorseName!.toLowerCase());
        if (horse) {
          matchedHorseIds.push(horse._id);
          perHorseNotes.push({
            horseId: horse._id,
            horseName: horse.name,
            notes: detection.treatmentNotes?.trim() || "",
          });
        }
      }

      // Build combined notes for display — individual notes will be used per-horse on save
      const combinedNotes = perHorseNotes.length === 1
        ? perHorseNotes[0].notes
        : perHorseNotes.map((p) => `${p.horseName}:\n${p.notes}`).join("\n\n");

      setSelectedRecordType("bodywork");
      setRecordForm((prev) => ({
        ...prev,
        horseIds: matchedHorseIds.length > 0 ? matchedHorseIds : prev.horseIds,
        date: detection.reportDate || prev.date,
        selectedProvider: "__other",
        providerName: detection.providerName || "Fred Michelon",
        notes: combinedNotes || detection.treatmentNotes?.trim() || prev.notes
      }));
      setRecordReportDetection({
        detected: true,
        reportType: "bodywork",
        message: `✓ report detected — ${matchedHorseIds.length > 1 ? `${matchedHorseIds.length} horses` : "fields"} pre-filled from PDF`,
        perHorseNotes: perHorseNotes.length > 0 ? perHorseNotes : undefined,
      });
    } catch (error) {
      setRecordError(error instanceof Error ? error.message : "Failed to detect report type from attachment");
    } finally {
      setRecordDetecting(false);
    }
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

  function handleInvoiceDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setInvoiceDragOver(false);
    const file = event.dataTransfer.files?.[0] ?? null;
    if (file) {
      setInvoiceFile(file);
      void processInvoiceUpload(file);
    }
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

      setInvoiceStatusMessage("detecting provider...");
      setInvoiceStage("detecting");
      const detection = (await detectProvider({ fileStorageId: storageId })) as InvoiceDetectionState;

      if (!detection.matched || !detection.providerId || !detection.categoryId) {
        // Don't default to "admin" — let AI auto-detect category from line items
        setInvoiceStatusMessage("doing things...");
        setInvoiceStage("parsing");
        const fallback = await parseUploadedInvoice({
          fileStorageId: storageId,
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
      const perHorseNotes = recordReportDetection.perHorseNotes;
      for (const horseId of recordForm.horseIds) {
        // Use per-horse notes from detection if available, otherwise use the general notes field
        const horseSpecificNotes = perHorseNotes?.find((p) => p.horseId === horseId)?.notes;
        const notesForHorse = horseSpecificNotes ?? recordForm.notes.trim();
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
          notes: notesForHorse || undefined,
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

  useEffect(() => {
    if (!recordReportDetection.detected) return;
    if (selectedRecordType !== "bodywork") return;
    const fred = recordProviders.find((provider) => provider.name === "Fred Michelon");
    if (!fred) return;
    setRecordForm((prev) => {
      if (prev.selectedProvider === "Fred Michelon" && !prev.providerName) return prev;
      return { ...prev, selectedProvider: "Fred Michelon", providerName: "" };
    });
  }, [recordProviders, recordReportDetection.detected, selectedRecordType]);

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

  if (isHidden) return null;

  return (
    <>
      <div className={`${styles.panelOverlay} ${panelOpen ? styles.panelOverlayOpen : ""}`} onClick={closePanel} />

      <aside className={`${styles.recordPanel} ${panelOpen ? styles.recordPanelOpen : ""}`}>
        <div className={styles.recordPanelHeader}>
          <div>
            <div className={styles.recordPanelLabel}>
              {panelMode === "document" ? "// NEW DOCUMENT" : panelMode === "invoice" ? "// NEW INVOICE" : "// NEW RECORD"}
            </div>
            <h3 className={styles.recordPanelTitle}>
              {panelMode === "document" ? "add document" : panelMode === "invoice" ? "upload invoice" : "log horse record"}
            </h3>
          </div>
          <button type="button" className={styles.recordPanelClose} onClick={closePanel}>
            ✕
          </button>
        </div>

        {panelMode === "document" ? (
          documentSuccess ? (
            <div className={styles.recordSuccessWrap}>
              <div className={styles.recordSuccessIcon}>✓</div>
              <div className={styles.recordSuccessTitle}>document uploaded</div>
              <div className={styles.recordSuccessSub}>
                {(documentForm.tag ? DOCUMENT_TAG_LABELS[documentForm.tag] : "Document")} —{" "}
                {activeHorses.find((horse) => horse._id === documentForm.horseId)?.name ?? "Horse"}
              </div>
            </div>
          ) : (
            <form id="document-form" className={styles.recordPanelBody} onSubmit={onUploadDocument}>
              <div
                className={`${styles.docDropzone} ${documentDragOver ? styles.docDropzoneDragover : ""}`}
                onClick={() => documentFileInputRef.current?.click()}
                onDragOver={(event) => {
                  event.preventDefault();
                  setDocumentDragOver(true);
                }}
                onDragLeave={(event) => {
                  event.preventDefault();
                  setDocumentDragOver(false);
                }}
                onDrop={handleDocumentDrop}
              >
                <input
                  ref={documentFileInputRef}
                  type="file"
                  accept=".pdf,.jpg,.jpeg,.png"
                  className={styles.fileInput}
                  onChange={(event: ChangeEvent<HTMLInputElement>) => handleDocumentFileSelect(event.target.files?.[0] ?? null)}
                />
                {!documentFile ? (
                  <>
                    <div className={styles.docDropzoneIcon}>📄</div>
                    <div className={styles.docDropzoneTitle}>drop file here</div>
                    <div className={styles.docDropzoneBrowse}>or click to browse</div>
                    <div className={styles.docDropzoneTypes}>PDF, JPG, PNG — max 10MB</div>
                  </>
                ) : (
                  <>
                    <div className={styles.docDropzoneCheck}>✓ {documentFile.name}</div>
                    <div className={styles.docDropzoneSize}>{formatFileSize(documentFile.size)}</div>
                    <button
                      type="button"
                      className={styles.docDropzoneRemove}
                      onClick={(event) => {
                        event.stopPropagation();
                        setDocumentFile(null);
                      }}
                    >
                      remove
                    </button>
                  </>
                )}
              </div>

              <RecordField label="HORSE" required>
                <select
                  className={styles.recordInput}
                  value={documentForm.horseId}
                  onChange={(event) => setDocumentForm((prev) => ({ ...prev, horseId: event.target.value as Id<"horses"> | "" }))}
                >
                  <option value="">select horse...</option>
                  {activeHorses.map((horse) => (
                    <option key={horse._id} value={horse._id}>
                      {horse.name}
                    </option>
                  ))}
                </select>
              </RecordField>

              <RecordField label="DOCUMENT NAME" required>
                <input
                  className={styles.recordInput}
                  value={documentForm.name}
                  onChange={(event) => setDocumentForm((prev) => ({ ...prev, name: event.target.value }))}
                  placeholder="e.g., Q1 2026 Coggins - Ben"
                />
              </RecordField>

              <RecordField label="TAG" required>
                <select
                  className={styles.recordInput}
                  value={documentForm.tag}
                  onChange={(event) => setDocumentForm((prev) => ({ ...prev, tag: event.target.value as DocumentTag | "" }))}
                >
                  <option value="">select tag...</option>
                  <option value="coggins">Coggins</option>
                  <option value="health_certificate">Health Certificate</option>
                  <option value="horse_agreement">Horse Agreement</option>
                  <option value="insurance">Insurance</option>
                  <option value="registration">Registration</option>
                  <option value="other">Other</option>
                </select>
              </RecordField>

              <RecordField label="NOTES">
                <textarea
                  className={styles.recordTextarea}
                  rows={3}
                  value={documentForm.notes}
                  onChange={(event) => setDocumentForm((prev) => ({ ...prev, notes: event.target.value }))}
                  placeholder="add any details..."
                />
              </RecordField>

              {documentError ? <p className={styles.recordError}>{documentError}</p> : null}
            </form>
          )
        ) : panelMode === "invoice" ? (
          <div className={styles.recordPanelBody}>
            <div
              className={`${styles.docDropzone} ${invoiceDragOver ? styles.docDropzoneDragover : ""}`}
              onClick={() => invoiceFileInputRef.current?.click()}
              onDragOver={(event) => {
                event.preventDefault();
                setInvoiceDragOver(true);
              }}
              onDragLeave={(event) => {
                event.preventDefault();
                setInvoiceDragOver(false);
              }}
              onDrop={handleInvoiceDrop}
            >
              <input
                ref={invoiceFileInputRef}
                type="file"
                accept=".pdf"
                className={styles.fileInput}
                onChange={(event: ChangeEvent<HTMLInputElement>) => {
                  const file = event.target.files?.[0] ?? null;
                  setInvoiceFile(file);
                  if (file) {
                    void processInvoiceUpload(file);
                  } else {
                    setInvoiceStage("idle");
                    setInvoiceStatusMessage("");
                  }
                }}
              />
              {!invoiceFile ? (
                <>
                  <div className={styles.docDropzoneIcon}>📄</div>
                  <div className={styles.docDropzoneTitle}>drop invoice here</div>
                  <div className={styles.docDropzoneBrowse}>or click to browse</div>
                  <div className={styles.docDropzoneTypes}>PDF — max 10MB</div>
                </>
              ) : (
                <>
                  <div className={styles.docDropzoneCheck}>✓ {invoiceFile.name}</div>
                  <div className={styles.docDropzoneSize}>{formatFileSize(invoiceFile.size)}</div>
                </>
              )}
            </div>

            {invoiceStage !== "idle" && invoiceFile ? (
              <div className={styles.processingWrap}>
                {invoiceStage !== "redirecting" ? <div className={styles.spinner} /> : null}
                <div className={styles.processingFile}>✓ {invoiceFile.name}</div>
                <div className={styles.processingSub}>{formatFileSize(invoiceFile.size)}</div>
                <div className={styles.processingTitle}>
                  {invoiceStatusMessage || "uploading..."}
                </div>
                <div className={styles.processingSub}>this may take a moment</div>
              </div>
            ) : null}

            {invoiceError ? <p className={styles.recordError}>{invoiceError}</p> : null}
          </div>
        ) : recordSuccess ? (
          <div className={styles.recordSuccessWrap}>
            <div className={styles.recordSuccessIcon}>✓</div>
            <div className={styles.recordSuccessTitle}>record saved</div>
            <div className={styles.recordSuccessSub}>
              {recordTypeLabel(selectedRecordType, recordForm.customType)} for {formatHorseSuccessLabel(selectedHorseNames)}
            </div>
          </div>
        ) : (
          <form id="record-form" className={styles.recordPanelBody} onSubmit={onSaveRecord}>
            {recordReportDetection.detected ? (
              <div className={styles.reportDetectedBanner}>
                <div className={styles.reportDetectedTitle}>{recordReportDetection.message}</div>
                <div className={styles.reportDetectedSubtitle}>review and confirm before saving</div>
              </div>
            ) : null}
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
                        <button
                          type="button"
                          key={horse._id}
                          className={styles.multiSelectOption}
                          onClick={() => toggleHorse(horse._id)}
                        >
                          <span className={`${styles.checkbox} ${checked ? styles.checkboxChecked : styles.checkboxUnchecked}`}>
                            ✓
                          </span>
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
                onChange={(e) => setRecordForm((prev) => ({ ...prev, date: e.target.value }))}
              />
            </RecordField>

            <RecordField label="RECORD TYPE" required>
              <select
                className={styles.recordInput}
                value={selectedRecordType ?? ""}
                onChange={(e) => handleRecordTypeChange(e.target.value)}
              >
                <option value="">select type...</option>
                {recordTypeOptions.map((option) => (
                  <option key={option.type} value={option.type}>
                    {option.label}
                  </option>
                ))}
              </select>
            </RecordField>

            {selectedRecordType ? (
              <>
                {selectedRecordType === "veterinary" ? (
                  <RecordField label="VISIT TYPE">
                    <select
                      className={styles.recordInput}
                      value={recordForm.visitType}
                      onChange={(e) => setRecordForm((prev) => ({ ...prev, visitType: e.target.value as "" | "vaccination" | "treatment" }))}
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
                      onChange={(e) => setRecordForm((prev) => ({ ...prev, vaccineName: e.target.value }))}
                      placeholder="e.g., Flu/Rhino, Coggins, West Nile"
                    />
                  </RecordField>
                ) : null}

                {selectedRecordType === "veterinary" && recordForm.visitType === "treatment" ? (
                  <RecordField label="TREATMENT DESCRIPTION">
                    <input
                      className={styles.recordInput}
                      value={recordForm.treatmentDescription}
                      onChange={(e) => setRecordForm((prev) => ({ ...prev, treatmentDescription: e.target.value }))}
                      placeholder="e.g., Laceration repair, Lameness exam"
                    />
                  </RecordField>
                ) : null}

                {selectedRecordType === "other" ? (
                  <RecordField label="DESCRIBE RECORD TYPE">
                    <input
                      className={styles.recordInput}
                      value={recordForm.customType}
                      onChange={(e) => setRecordForm((prev) => ({ ...prev, customType: e.target.value }))}
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
                        onChange={(e) => setRecordForm((prev) => ({ ...prev, selectedProvider: e.target.value, providerName: "" }))}
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
                            onChange={(e) => setRecordForm((prev) => ({ ...prev, providerName: e.target.value }))}
                            placeholder={providerPlaceholder(selectedRecordType)}
                          />
                        </div>
                      ) : null}
                    </>
                  ) : (
                    <input
                      className={styles.recordInput}
                      value={recordForm.providerName}
                      onChange={(e) => setRecordForm((prev) => ({ ...prev, providerName: e.target.value }))}
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
                onChange={(e) => setRecordForm((prev) => ({ ...prev, nextVisitDate: e.target.value }))}
              />
            </RecordField>

            <RecordField label="NOTES">
              <textarea
                className={styles.recordTextarea}
                rows={4}
                value={recordForm.notes}
                onChange={(e) => setRecordForm((prev) => ({ ...prev, notes: e.target.value }))}
                placeholder="add any details..."
              />
            </RecordField>

            <RecordField label="ATTACHMENT">
              <label className={styles.dropZone}>
                <input
                  type="file"
                  className={styles.fileInput}
                  accept=".pdf,.jpg,.jpeg,.png"
                  onChange={(e) => {
                    void handleRecordAttachmentSelect(e.target.files?.[0] ?? null);
                  }}
                />
                <div className={styles.dropZoneText}>
                  drop file or <span className={styles.dropZoneBrowse}>browse</span>
                </div>
                <div className={styles.dropZoneSubtext}>PDF, JPG, PNG — max 10MB</div>
                {recordAttachment ? <div className={styles.dropZoneFile}>{recordAttachment.name}</div> : null}
                {recordDetecting ? <div className={styles.dropZoneFile}>detecting report...</div> : null}
              </label>
            </RecordField>

            {recordError ? <p className={styles.recordError}>{recordError}</p> : null}
          </form>
        )}

        {panelMode === "record" && selectedRecordType && !recordSuccess ? (
          <div className={styles.recordPanelFooter}>
            <button type="button" className={styles.recordCancelBtn} onClick={closePanel}>
              cancel
            </button>
            <button type="submit" form="record-form" className={styles.recordSaveBtn} disabled={recordForm.horseIds.length === 0 || recordSubmitting}>
              {recordSubmitting ? "saving..." : "save record"}
            </button>
          </div>
        ) : null}
        {panelMode === "document" && !documentSuccess ? (
          <div className={styles.recordPanelFooter}>
            <button type="button" className={styles.recordCancelBtn} onClick={closePanel}>
              cancel
            </button>
            <button
              type="submit"
              form="document-form"
              className={styles.recordSaveBtn}
              disabled={!documentFile || !documentForm.horseId || !documentForm.name.trim() || !documentForm.tag || documentUploading}
            >
              {documentUploading ? "uploading..." : "upload document"}
            </button>
          </div>
        ) : null}
        {panelMode === "invoice" ? (
          <div className={styles.recordPanelFooter}>
            <button type="button" className={styles.recordCancelBtn} onClick={closePanel}>
              cancel
            </button>
          </div>
        ) : null}
      </aside>

      <div className={styles.fabContainer} ref={fabRef}>
        <div className={`${styles.fabMenu} ${fabMenuOpen ? styles.fabMenuOpen : ""}`} ref={fabMenuRef}>
          <button type="button" className={styles.fabMenuItem} onClick={() => handleFabOptionClick("record")}>
            <span className={styles.fabMenuIcon}>📋</span>
            <span className={styles.fabMenuLabel}>log record</span>
          </button>
          <button type="button" className={styles.fabMenuItem} onClick={() => handleFabOptionClick("invoice")}>
            <span className={styles.fabMenuIcon}>📄</span>
            <span className={styles.fabMenuLabel}>upload invoice</span>
          </button>
          <button type="button" className={styles.fabMenuItem} onClick={() => handleFabOptionClick("document")}>
            <span className={styles.fabMenuIcon}>📎</span>
            <span className={styles.fabMenuLabel}>add document</span>
          </button>
        </div>
        <button
          type="button"
          className={styles.fabButton}
          onClick={handleFabClick}
          aria-label="open actions"
        >
          <span className={`${styles.fabIcon} ${fabMenuOpen ? styles.fabIconOpen : ""}`}>+</span>
        </button>
      </div>
    </>
  );
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
