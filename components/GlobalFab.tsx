"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type ChangeEvent, type DragEvent, type FormEvent, type ReactNode } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { formatInvoiceName } from "@/lib/formatInvoiceName";
import { useAuth } from "@/contexts/AuthContext";
import styles from "@/app/dashboard/dashboard.module.css";

type RecordType = "veterinary" | "medication" | "farrier" | "bodywork" | "other";
type PanelMode = "record" | "document" | "invoice" | null;
type DocumentTag =
  | "coggins"
  | "health_certificate"
  | "horse_agreement"
  | "insurance"
  | "registration"
  | "contract"
  | "id"
  | "tax"
  | "other";
type DocumentSubject = "horse" | "person";

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

const VET_VISIT_TYPE_OPTIONS: Array<{ value: VetSubcategory; label: string }> = [
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

type RecordFormState = {
  title: string;
  horseIds: Id<"horses">[];
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
  medicationRepeatValue: string;
  medicationRepeatUnit: "" | "days" | "weeks" | "months";
  nextVisitDate: string;
  notes: string;
  billId: string;
};

type DocumentFormState = {
  subject: DocumentSubject;
  horseId: Id<"horses"> | "";
  personId: Id<"people"> | "";
  name: string;
  tag: DocumentTag | "";
  documentDate: string;
  notes: string;
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

const MEDICATION_OPTIONS = [
  "Adequan",
  "Aspirin",
  "Banamine",
  "Bute",
  "Dexamethasone",
  "Gastroguard",
  "Gentamicin",
  "Ketofen",
  "Legend",
  "Marquis",
  "Metacam",
  "Pentosan",
  "Traumeel",
  "Other",
];

const farrierServiceTypes = ["Full Set", "Reset", "Trim", "Front Only", "Other"];
const HIDDEN_PATHS = new Set(["/", "/login", "/investor", "/investor/dashboard"]);

const DOCUMENT_TAG_LABELS: Record<DocumentTag, string> = {
  coggins: "Coggins",
  health_certificate: "Health Certificate",
  horse_agreement: "Horse Agreement",
  insurance: "Insurance",
  registration: "Registration",
  contract: "Contract",
  id: "ID",
  tax: "Tax",
  other: "Other",
};

const HORSE_DOCUMENT_TAGS: DocumentTag[] = [
  "coggins",
  "health_certificate",
  "horse_agreement",
  "insurance",
  "registration",
  "other",
];

const PERSON_DOCUMENT_TAGS: DocumentTag[] = [
  "contract",
  "id",
  "insurance",
  "tax",
  "other",
];

const recordTypeOptions: Array<{ type: RecordType; label: string }> = [
  { type: "veterinary", label: "Veterinary" },
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
    title: "",
    horseIds: [],
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
    medicationRepeatValue: "",
    medicationRepeatUnit: "",
    nextVisitDate: "",
    notes: "",
    billId: "",
  };
}

function createInitialDocumentForm(): DocumentFormState {
  return {
    subject: "horse",
    horseId: "",
    personId: "",
    name: "",
    tag: "",
    documentDate: getTodayDate(),
    notes: "",
  };
}

export default function GlobalFab() {
  const { user } = useAuth();
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
  const [recordInvoiceSearch, setRecordInvoiceSearch] = useState("");
  const [recordInvoiceDropdownOpen, setRecordInvoiceDropdownOpen] = useState(false);
  const recordInvoiceDropdownRef = useRef<HTMLDivElement | null>(null);
  const [contactDropdownOpen, setContactDropdownOpen] = useState(false);
  const contactDropdownRef = useRef<HTMLDivElement | null>(null);
  const [subcatDropdownOpen, setSubcatDropdownOpen] = useState(false);
  const subcatDropdownRef = useRef<HTMLDivElement | null>(null);
  const [moreOptionsOpen, setMoreOptionsOpen] = useState(false);
  const [newContactOpen, setNewContactOpen] = useState(false);
  const [newContactForm, setNewContactForm] = useState({ name: "", companyName: "", phone: "", email: "", category: "", location: "", notes: "" });
  const [newContactSaving, setNewContactSaving] = useState(false);
  const [newContactError, setNewContactError] = useState("");
  const [invoiceDragOver, setInvoiceDragOver] = useState(false);
  const [invoiceFile, setInvoiceFile] = useState<File | null>(null);
  const [invoiceStage, setInvoiceStage] = useState<"idle" | "uploading" | "detecting" | "parsing" | "redirecting">("idle");
  const [invoiceError, setInvoiceError] = useState("");
  const [invoiceStatusMessage, setInvoiceStatusMessage] = useState("");
  const [invoiceMode, setInvoiceMode] = useState<"upload" | "manual">("upload");
  const [manualInvoiceName, setManualInvoiceName] = useState("");
  const [manualInvoiceCreating, setManualInvoiceCreating] = useState(false);
  const manualReceiptRef = useRef<HTMLInputElement>(null);
  const [manualReceiptFile, setManualReceiptFile] = useState<File | null>(null);

  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dropdownJustOpened = useRef(false);
  const horseDropdownRef = useRef<HTMLDivElement | null>(null);
  const fabRef = useRef<HTMLDivElement | null>(null);
  const fabMenuRef = useRef<HTMLDivElement | null>(null);
  const documentFileInputRef = useRef<HTMLInputElement | null>(null);
  const invoiceFileInputRef = useRef<HTMLInputElement | null>(null);

  const activeHorses = useQuery(api.horses.getActiveHorses) ?? [];
  const activePeople = useQuery(api.people.getAllPeople) ?? [];
  const categories = useQuery(api.categories.getAllCategories) ?? [];
  const recordProviderCategory = selectedRecordType ? RECORD_TYPE_TO_CATEGORY[selectedRecordType] : "";
  const allContactsForRecord = useQuery(api.contacts.getAllContacts) ?? [];
  const recordProviders = useMemo(
    () => allContactsForRecord.filter((c: any) => recordProviderCategory && c.category === recordProviderCategory),
    [allContactsForRecord, recordProviderCategory]
  );

  const allInvoicesForLinking = useQuery(api.bills.listForLinking) ?? [];
  const createHorseRecord = useMutation(api.horseRecords.createHorseRecord);
  const updateHorseRecord = useMutation(api.horseRecords.updateHorseRecord);
  const uploadDocument = useMutation(api.documents.upload);
  const generateUploadUrl = useMutation(api.bills.generateUploadUrl);
  const createManualBill = useMutation(api.bills.createManualBill);
  const detectRecordReport = useAction((api as any).reportDetect.detectReportFromPdf);
  const parseUploadedInvoice = useAction((api as any).uploads.parseUploadedInvoice);
  const findOrCreateContact = useMutation(api.contacts.findOrCreateContact);
  const createContact = useMutation(api.contacts.createContact);

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
    const handleClickOutside = (event: MouseEvent) => {
      if (recordInvoiceDropdownRef.current && !recordInvoiceDropdownRef.current.contains(event.target as Node)) {
        setRecordInvoiceDropdownOpen(false);
      }
      if (contactDropdownRef.current && !contactDropdownRef.current.contains(event.target as Node)) {
        setContactDropdownOpen(false);
      }
      if (subcatDropdownRef.current && !subcatDropdownRef.current.contains(event.target as Node)) {
        setSubcatDropdownOpen(false);
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
    const personId = searchParams.get("personId") as Id<"people"> | null;
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

    if (panel === "document") {
      if (personId) {
        setDocumentForm((prev) => ({ ...prev, subject: "person", personId, horseId: "" }));
      } else if (horseId) {
        setDocumentForm((prev) => ({ ...prev, subject: "horse", horseId, personId: "" }));
      }
    } else if (panel === "record" && horseId) {
      setRecordForm((prev) => ({ ...prev, horseIds: prev.horseIds.includes(horseId) ? prev.horseIds : [...prev.horseIds, horseId] }));
    }

    const params = new URLSearchParams(searchParams.toString());
    params.delete("panel");
    params.delete("horseId");
    params.delete("personId");
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
      setMoreOptionsOpen(false);
      setNewContactOpen(false);
      setNewContactError("");
      setRecordInvoiceSearch("");
      setRecordInvoiceDropdownOpen(false);
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
      setInvoiceMode("upload");
      setManualInvoiceName("");
      setManualReceiptFile(null);
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
        contactName: "",
        customType: "",
        visitType: "",
        visitTypes: [],
        vetOtherDescription: "",
        vaccineName: "",
        treatmentDescription: "",
        serviceType: "",
        medications: [],
        medicationRepeatValue: "",
        medicationRepeatUnit: "",
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
      medicationRepeatValue: "",
      medicationRepeatUnit: "",
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
        contactName?: string | null;
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
        contactName: detection.contactName || "Fred Michelon",
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
    const hasSubject =
      documentForm.subject === "horse" ? !!documentForm.horseId : !!documentForm.personId;
    if (!documentFile || !hasSubject || !documentForm.name.trim() || !documentForm.tag) {
      setDocumentError(
        documentForm.subject === "horse"
          ? "File, horse, document name, and tag are required."
          : "File, person, document name, and tag are required."
      );
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

      const parsedDocumentDate = documentForm.documentDate
        ? new Date(`${documentForm.documentDate}T00:00:00`).getTime()
        : undefined;

      await uploadDocument({
        name: documentForm.name.trim(),
        tag: documentForm.tag,
        horseId: documentForm.subject === "horse" ? (documentForm.horseId as Id<"horses">) : undefined,
        personId: documentForm.subject === "person" ? (documentForm.personId as Id<"people">) : undefined,
        fileStorageId: storageId,
        fileName: documentFile.name,
        fileType: documentFile.type || undefined,
        fileSize: documentFile.size || undefined,
        documentDate: Number.isFinite(parsedDocumentDate) ? parsedDocumentDate : undefined,
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

    const isImage = file.type.startsWith("image/");

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
        throw new Error("Failed to upload file");
      }
      const uploadPayload = await uploadResponse.json();
      const storageId = uploadPayload.storageId as Id<"_storage">;

      if (isImage) {
        setInvoiceStatusMessage("creating record...");
        const billId = await createManualBill({
          fileId: storageId,
          fileName: file.name,
          createdBy: user?.name,
        });
        setInvoiceStatusMessage("redirecting...");
        setInvoiceStage("redirecting");
        closePanel();
        router.push(`/invoices/preview/${billId}?manual=1`);
      } else {
        setInvoiceStatusMessage("starting parse...");
        setInvoiceStage("parsing");
        const result = await parseUploadedInvoice({
          fileStorageId: storageId,
        });
        setInvoiceStatusMessage("redirecting...");
        setInvoiceStage("redirecting");
        closePanel();
        router.push(`/invoices/preview/${result.billId}`);
      }
    } catch (error) {
      setInvoiceStage("idle");
      setInvoiceStatusMessage("");
      setInvoiceError(error instanceof Error ? error.message : "Failed to upload invoice");
    }
  }

  async function onCreateManualInvoice() {
    const name = manualInvoiceName.trim() || "Manual Invoice";
    setManualInvoiceCreating(true);
    setInvoiceError("");
    try {
      let fileId: Id<"_storage"> | undefined;
      if (manualReceiptFile) {
        const uploadUrl = await generateUploadUrl();
        const res = await fetch(uploadUrl, {
          method: "POST",
          headers: { "Content-Type": manualReceiptFile.type },
          body: manualReceiptFile,
        });
        if (!res.ok) throw new Error("Failed to upload receipt");
        const payload = await res.json();
        fileId = payload.storageId as Id<"_storage">;
      }

      if (fileId) {
        const billId = await createManualBill({ fileId, fileName: name, createdBy: user?.name });
        closePanel();
        router.push(`/invoices/preview/${billId}?manual=1`);
      } else {
        const uploadUrl = await generateUploadUrl();
        const emptyBlob = new Blob([], { type: "application/octet-stream" });
        const res = await fetch(uploadUrl, { method: "POST", headers: { "Content-Type": "application/octet-stream" }, body: emptyBlob });
        if (!res.ok) throw new Error("Failed to create invoice");
        const payload = await res.json();
        const storageId = payload.storageId as Id<"_storage">;
        const billId = await createManualBill({ fileId: storageId, fileName: name, createdBy: user?.name });
        closePanel();
        router.push(`/invoices/preview/${billId}?manual=1`);
      }
    } catch (error) {
      setInvoiceError(error instanceof Error ? error.message : "Failed to create invoice");
    } finally {
      setManualInvoiceCreating(false);
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
      const perHorseNotes = recordReportDetection.perHorseNotes;
      for (const horseId of recordForm.horseIds) {
        const horseSpecificNotes = perHorseNotes?.find((p) => p.horseId === horseId)?.notes;
        const notesForHorse = horseSpecificNotes ?? recordForm.notes.trim();
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
          vaccineName:
            selectedRecordType === "veterinary" && recordForm.visitTypes.includes("vaccinations")
              ? recordForm.vaccineName.trim() || undefined
              : undefined,
          treatmentDescription:
            selectedRecordType === "veterinary" && recordForm.visitTypes.includes("treatment")
              ? recordForm.treatmentDescription.trim() || undefined
              : undefined,
          serviceType: selectedRecordType === "farrier" ? recordForm.serviceType || undefined : undefined,
          medications: recordForm.medications.length > 0 ? recordForm.medications : undefined,
          medicationRepeatValue: recordForm.medications.length > 0 && recordForm.medicationRepeatValue ? parseInt(recordForm.medicationRepeatValue, 10) : undefined,
          medicationRepeatUnit: recordForm.medications.length > 0 && recordForm.medicationRepeatUnit ? recordForm.medicationRepeatUnit : undefined,
          isUpcoming: false,
          notes: notesForHorse || undefined,
          attachmentStorageId,
          billId: recordForm.billId ? recordForm.billId as Id<"bills"> : undefined,
        });
        if (recordForm.nextVisitDate) {
          const upcomingRecordId = await createHorseRecord({
            horseId,
            createdBy: user?.name,
            type: selectedRecordType,
            customType: selectedRecordType === "other" ? recordForm.customType.trim() || undefined : undefined,
            date: new Date(`${recordForm.nextVisitDate}T00:00:00`).getTime(),
            contactName,
            contactId: resolvedContactId,
            visitType: selectedRecordType === "veterinary" && recordForm.visitTypes.length > 0 ? recordForm.visitTypes[0] as VetSubcategory : undefined,
            visitTypes: selectedRecordType === "veterinary" && recordForm.visitTypes.length > 0 ? recordForm.visitTypes : undefined,
            vetOtherDescription: selectedRecordType === "veterinary" && recordForm.visitTypes.includes("other") ? recordForm.vetOtherDescription.trim() || undefined : undefined,
            vaccineName:
              selectedRecordType === "veterinary" && recordForm.visitTypes.includes("vaccinations")
                ? recordForm.vaccineName.trim() || undefined
                : undefined,
            treatmentDescription:
              selectedRecordType === "veterinary" && recordForm.visitTypes.includes("treatment")
                ? recordForm.treatmentDescription.trim() || undefined
                : undefined,
            serviceType: selectedRecordType === "farrier" ? recordForm.serviceType || undefined : undefined,
            medications: recordForm.medications.length > 0 ? recordForm.medications : undefined,
            medicationRepeatValue: recordForm.medications.length > 0 && recordForm.medicationRepeatValue ? parseInt(recordForm.medicationRepeatValue, 10) : undefined,
            medicationRepeatUnit: recordForm.medications.length > 0 && recordForm.medicationRepeatUnit ? recordForm.medicationRepeatUnit : undefined,
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
    const fred = allContactsForRecord.find((c) => c.name === "Fred Michelon");
    if (!fred) return;
    setRecordForm((prev) => {
      if (prev.contactName === "Fred Michelon") return prev;
      return { ...prev, contactName: "Fred Michelon" };
    });
  }, [allContactsForRecord, recordReportDetection.detected, selectedRecordType]);

  function openDropdown(setter: (updater: (prev: boolean) => boolean) => void) {
    setter((prev) => {
      if (!prev) {
        dropdownJustOpened.current = true;
        requestAnimationFrame(() => { dropdownJustOpened.current = false; });
      }
      return !prev;
    });
  }

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
                {documentForm.subject === "person"
                  ? activePeople.find((person) => person._id === documentForm.personId)?.name ?? "Person"
                  : activeHorses.find((horse) => horse._id === documentForm.horseId)?.name ?? "Horse"}
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
                  accept=".pdf,.jpg,.jpeg,.png,.mp4,.mov,.webm"
                  className={styles.fileInput}
                  onChange={(event: ChangeEvent<HTMLInputElement>) => handleDocumentFileSelect(event.target.files?.[0] ?? null)}
                />
                {!documentFile ? (
                  <>
                    <div className={styles.docDropzoneIcon}>📄</div>
                    <div className={styles.docDropzoneTitle}>drop file here</div>
                    <div className={styles.docDropzoneBrowse}>or click to browse</div>
                    <div className={styles.docDropzoneTypes}>PDF, JPG, PNG, MP4, MOV — max 10MB</div>
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

              <RecordField label="ASSIGN TO" required>
                <select
                  className={styles.recordInput}
                  value={documentForm.subject}
                  onChange={(event) =>
                    setDocumentForm((prev) => ({
                      ...prev,
                      subject: event.target.value as DocumentSubject,
                      tag: "",
                    }))
                  }
                >
                  <option value="horse">Horse</option>
                  <option value="person">Team member</option>
                </select>
              </RecordField>

              {documentForm.subject === "horse" ? (
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
              ) : (
                <RecordField label="TEAM MEMBER" required>
                  <select
                    className={styles.recordInput}
                    value={documentForm.personId}
                    onChange={(event) => setDocumentForm((prev) => ({ ...prev, personId: event.target.value as Id<"people"> | "" }))}
                  >
                    <option value="">select team member...</option>
                    {activePeople.map((person) => (
                      <option key={person._id} value={person._id}>
                        {person.name}
                      </option>
                    ))}
                  </select>
                </RecordField>
              )}

              <RecordField label="DOCUMENT NAME" required>
                <input
                  className={styles.recordInput}
                  value={documentForm.name}
                  onChange={(event) => setDocumentForm((prev) => ({ ...prev, name: event.target.value }))}
                  placeholder={
                    documentForm.subject === "person"
                      ? "e.g., 2026 Rider Contract - Lucy"
                      : "e.g., Q1 2026 Coggins - Ben"
                  }
                />
              </RecordField>

              <RecordField label="TAG" required>
                <select
                  className={styles.recordInput}
                  value={documentForm.tag}
                  onChange={(event) => setDocumentForm((prev) => ({ ...prev, tag: event.target.value as DocumentTag | "" }))}
                >
                  <option value="">select tag...</option>
                  {(documentForm.subject === "person" ? PERSON_DOCUMENT_TAGS : HORSE_DOCUMENT_TAGS).map((tag) => (
                    <option key={tag} value={tag}>
                      {DOCUMENT_TAG_LABELS[tag]}
                    </option>
                  ))}
                </select>
              </RecordField>

              <RecordField label="DOCUMENT DATE">
                <input
                  className={styles.recordInput}
                  type="date"
                  value={documentForm.documentDate}
                  onChange={(event) => setDocumentForm((prev) => ({ ...prev, documentDate: event.target.value }))}
                />
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
            <div className={styles.invoiceModeTabs}>
              <button
                type="button"
                className={invoiceMode === "upload" ? styles.invoiceModeTabActive : styles.invoiceModeTab}
                onClick={() => setInvoiceMode("upload")}
              >
                upload file
              </button>
              <button
                type="button"
                className={invoiceMode === "manual" ? styles.invoiceModeTabActive : styles.invoiceModeTab}
                onClick={() => setInvoiceMode("manual")}
              >
                create manually
              </button>
            </div>

            {invoiceMode === "upload" ? (
              <>
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
                    accept=".pdf,.jpg,.jpeg,.png,.heic,.webp"
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
                      <div className={styles.docDropzoneTypes}>PDF or photo — max 10MB</div>
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
              </>
            ) : (
              <div className={styles.manualInvoiceForm}>
                <div className={styles.manualField}>
                  <label className={styles.manualFieldLabel}>INVOICE NAME</label>
                  <input
                    className={styles.recordInput}
                    value={manualInvoiceName}
                    onChange={(e) => setManualInvoiceName(e.target.value)}
                    placeholder="e.g. Vet visit - May 2026"
                  />
                </div>
                <div className={styles.manualField}>
                  <label className={styles.manualFieldLabel}>ATTACH RECEIPT (optional)</label>
                  <div
                    className={styles.manualReceiptZone}
                    onClick={() => manualReceiptRef.current?.click()}
                  >
                    <input
                      ref={manualReceiptRef}
                      type="file"
                      accept=".pdf,.jpg,.jpeg,.png,.heic,.webp"
                      style={{ display: "none" }}
                      onChange={(e) => setManualReceiptFile(e.target.files?.[0] ?? null)}
                    />
                    {manualReceiptFile ? (
                      <span className={styles.manualReceiptName}>✓ {manualReceiptFile.name}</span>
                    ) : (
                      <span className={styles.manualReceiptPlaceholder}>click to attach PDF or photo</span>
                    )}
                  </div>
                </div>
                <button
                  type="button"
                  className={styles.manualCreateBtn}
                  onClick={onCreateManualInvoice}
                  disabled={manualInvoiceCreating}
                >
                  {manualInvoiceCreating ? "creating..." : "create invoice"}
                </button>
              </div>
            )}

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
                  onClick={() => openDropdown(setHorseDropdownOpen)}
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
                          onClick={() => { if (!dropdownJustOpened.current) toggleHorse(horse._id); }}
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

            <RecordField label="CATEGORY" required>
              <select
                className={styles.recordInput}
                value={selectedRecordType ?? ""}
                onChange={(e) => handleRecordTypeChange(e.target.value)}
              >
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
                          onClick={() => openDropdown(setSubcatDropdownOpen)}
                        >
                          {recordForm.visitTypes.length > 0 ? (
                            <>
                              {recordForm.visitTypes.map((vt) => {
                                const label = VET_VISIT_TYPE_OPTIONS.find((o) => o.value === vt)?.label ?? vt;
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
                            {VET_VISIT_TYPE_OPTIONS.map((opt) => {
                              const checked = recordForm.visitTypes.includes(opt.value);
                              return (
                                <button
                                  type="button"
                                  key={opt.value}
                                  className={styles.multiSelectOption}
                                  onClick={() => {
                                    if (dropdownJustOpened.current) return;
                                    setRecordForm((prev) => ({
                                      ...prev,
                                      visitTypes: checked
                                        ? prev.visitTypes.filter((v) => v !== opt.value)
                                        : [...prev.visitTypes, opt.value],
                                    }));
                                  }}
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
                        <div className={styles.chipRow} style={{ flexWrap: "wrap" }}>
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
                    {recordForm.medications.length > 0 ? (
                      <RecordField label="REPEAT">
                        <div className={styles.repeatRow}>
                          <input
                            className={styles.repeatNumberInput}
                            type="number"
                            min="1"
                            value={recordForm.medicationRepeatValue}
                            onChange={(e) => setRecordForm((prev) => ({ ...prev, medicationRepeatValue: e.target.value }))}
                            placeholder="#"
                          />
                          <select
                            className={styles.repeatUnitSelect}
                            value={recordForm.medicationRepeatUnit}
                            onChange={(e) => setRecordForm((prev) => ({ ...prev, medicationRepeatUnit: e.target.value as "" | "days" | "weeks" | "months" }))}
                          >
                            <option value="">select...</option>
                            <option value="days">Days</option>
                            <option value="weeks">Weeks</option>
                            <option value="months">Months</option>
                          </select>
                        </div>
                      </RecordField>
                    ) : null}
                    {recordForm.visitTypes.includes("other") ? (
                      <RecordField label="DESCRIBE OTHER">
                        <input
                          className={styles.recordInput}
                          value={recordForm.vetOtherDescription}
                          onChange={(e) => setRecordForm((prev) => ({ ...prev, vetOtherDescription: e.target.value }))}
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
                      onChange={(e) => setRecordForm((prev) => ({ ...prev, customType: e.target.value }))}
                      placeholder="e.g., Dentist, Chiropractor"
                    />
                  </RecordField>
                ) : null}

                <RecordField label="CONTACT">
                  <div className={styles.contactSearchWrap} ref={contactDropdownRef}>
                    <input
                      className={styles.recordInput}
                      value={recordForm.contactName}
                      onChange={(e) => {
                        setRecordForm((prev) => ({ ...prev, contactName: e.target.value }));
                        setContactDropdownOpen(true);
                        setNewContactOpen(false);
                      }}
                      onFocus={() => { setContactDropdownOpen(true); setNewContactOpen(false); }}
                      placeholder={contactPlaceholder(selectedRecordType)}
                    />
                    {contactDropdownOpen && !newContactOpen && (() => {
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
                              onClick={() => {
                                setContactDropdownOpen(false);
                                setNewContactOpen(true);
                                setNewContactError("");
                                setNewContactForm({
                                  name: recordForm.contactName.trim(),
                                  companyName: "",
                                  phone: "",
                                  email: "",
                                  category: recordProviderCategory || "",
                                  location: "",
                                  notes: "",
                                });
                              }}
                            >
                              + Add &ldquo;{recordForm.contactName.trim()}&rdquo;
                            </button>
                          ) : null}
                          {!term && matches.length === 0 ? (
                            <button
                              type="button"
                              className={`${styles.contactDropdownItem} ${styles.contactDropdownAdd}`}
                              onClick={() => {
                                setContactDropdownOpen(false);
                                setNewContactOpen(true);
                                setNewContactError("");
                                setNewContactForm({ name: "", companyName: "", phone: "", email: "", category: recordProviderCategory || "", location: "", notes: "" });
                              }}
                            >
                              + Create new contact
                            </button>
                          ) : null}
                        </div>
                      );
                    })()}
                  </div>
                </RecordField>
                {newContactOpen ? (
                  <div className={styles.newContactCard}>
                    <div className={styles.newContactCardTitle}>+ new contact</div>
                    <div className={styles.newContactGrid}>
                      <label className={styles.newContactField}>
                        <span className={styles.newContactLabel}>NAME *</span>
                        <input className={styles.recordInput} value={newContactForm.name} onChange={(e) => setNewContactForm((prev) => ({ ...prev, name: e.target.value }))} />
                      </label>
                      <label className={styles.newContactField}>
                        <span className={styles.newContactLabel}>COMPANY</span>
                        <input className={styles.recordInput} value={newContactForm.companyName} onChange={(e) => setNewContactForm((prev) => ({ ...prev, companyName: e.target.value }))} />
                      </label>
                      <label className={styles.newContactField}>
                        <span className={styles.newContactLabel}>PHONE</span>
                        <input className={styles.recordInput} value={newContactForm.phone} onChange={(e) => setNewContactForm((prev) => ({ ...prev, phone: e.target.value }))} />
                      </label>
                      <label className={styles.newContactField}>
                        <span className={styles.newContactLabel}>EMAIL</span>
                        <input className={styles.recordInput} type="email" value={newContactForm.email} onChange={(e) => setNewContactForm((prev) => ({ ...prev, email: e.target.value }))} />
                      </label>
                      <label className={styles.newContactField}>
                        <span className={styles.newContactLabel}>CATEGORY</span>
                        <select className={styles.recordInput} value={newContactForm.category} onChange={(e) => setNewContactForm((prev) => ({ ...prev, category: e.target.value }))}>
                          <option value="">select...</option>
                          <option value="veterinary">Veterinary</option>
                          <option value="farrier">Farrier</option>
                          <option value="bodywork">Bodywork</option>
                          <option value="stabling">Stabling</option>
                          <option value="travel">Travel</option>
                          <option value="supplies">Supplies</option>
                          <option value="admin">Admin</option>
                          <option value="other">Other</option>
                        </select>
                      </label>
                      <label className={styles.newContactField}>
                        <span className={styles.newContactLabel}>LOCATION</span>
                        <select className={styles.recordInput} value={newContactForm.location} onChange={(e) => setNewContactForm((prev) => ({ ...prev, location: e.target.value }))}>
                          <option value="">select...</option>
                          <option value="wellington">Wellington</option>
                          <option value="thermal">Thermal</option>
                          <option value="ocala">Ocala</option>
                          <option value="la">LA</option>
                          <option value="eu">EU</option>
                          <option value="can">CAN</option>
                        </select>
                      </label>
                    </div>
                    <label className={styles.newContactField} style={{ marginTop: 8 }}>
                      <span className={styles.newContactLabel}>NOTES</span>
                      <textarea className={styles.recordTextarea} rows={2} value={newContactForm.notes} onChange={(e) => setNewContactForm((prev) => ({ ...prev, notes: e.target.value }))} />
                    </label>
                    {newContactError ? <p className={styles.recordError}>{newContactError}</p> : null}
                    <div className={styles.newContactActions}>
                      <button type="button" className={styles.newContactCancelBtn} onClick={() => setNewContactOpen(false)}>cancel</button>
                      <button
                        type="button"
                        className={styles.newContactSaveBtn}
                        disabled={newContactSaving}
                        onClick={async () => {
                          if (!newContactForm.name.trim()) { setNewContactError("Name is required."); return; }
                          setNewContactSaving(true);
                          setNewContactError("");
                          try {
                            await createContact({
                              name: newContactForm.name.trim(),
                              companyName: newContactForm.companyName.trim() || undefined,
                              category: newContactForm.category || "other",
                              location: newContactForm.location ? (newContactForm.location as "wellington" | "thermal" | "ocala" | "la" | "eu" | "can") : undefined,
                              phone: newContactForm.phone.trim() || undefined,
                              email: newContactForm.email.trim() || undefined,
                              notes: newContactForm.notes.trim() || undefined,
                            });
                            setRecordForm((prev) => ({ ...prev, contactName: newContactForm.name.trim() }));
                            setNewContactOpen(false);
                          } catch (err) {
                            setNewContactError(err instanceof Error ? err.message : "Failed to create contact");
                          } finally {
                            setNewContactSaving(false);
                          }
                        }}
                      >
                        {newContactSaving ? "saving..." : "save contact"}
                      </button>
                    </div>
                  </div>
                ) : null}
              </>
            ) : null}

            <RecordField label="NOTES">
              <textarea
                className={styles.recordTextarea}
                rows={4}
                value={recordForm.notes}
                onChange={(e) => setRecordForm((prev) => ({ ...prev, notes: e.target.value }))}
                onFocus={(e) => { setTimeout(() => { e.target.scrollIntoView({ behavior: "smooth", block: "center" }); }, 300); }}
                placeholder="add any details..."
              />
            </RecordField>

            <button
              type="button"
              className={styles.moreOptionsToggle}
              onClick={() => setMoreOptionsOpen((prev) => !prev)}
            >
              <span>more options</span>
              <span className={`${styles.moreOptionsArrow} ${moreOptionsOpen ? styles.moreOptionsArrowOpen : ""}`}>&#9662;</span>
            </button>

            {moreOptionsOpen ? (
              <>
                <RecordField label="LINKED INVOICE">
                  <div className={styles.invoiceSearchWrap} ref={recordInvoiceDropdownRef}>
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
                          value={recordInvoiceSearch}
                          onChange={(e) => { setRecordInvoiceSearch(e.target.value); setRecordInvoiceDropdownOpen(true); }}
                          onFocus={() => setRecordInvoiceDropdownOpen(true)}
                          placeholder="search invoices..."
                        />
                        {recordInvoiceDropdownOpen && (
                          <div className={styles.invoiceDropdown}>
                            {allInvoicesForLinking
                              .filter((b) => {
                                if (!recordInvoiceSearch.trim()) return true;
                                const term = recordInvoiceSearch.toLowerCase();
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
                                    setRecordInvoiceSearch("");
                                    setRecordInvoiceDropdownOpen(false);
                                  }}
                                >
                                  {formatInvoiceName({ contactName: b.contactName, date: b.invoiceDate })}
                                </button>
                              ))}
                            {allInvoicesForLinking.filter((b) => {
                              if (!recordInvoiceSearch.trim()) return true;
                              const term = recordInvoiceSearch.toLowerCase();
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
                      onChange={(e) => {
                        void handleRecordAttachmentSelect(e.target.files?.[0] ?? null);
                      }}
                    />
                    <div className={styles.dropZoneText}>
                      drop file or <span className={styles.dropZoneBrowse}>browse</span>
                    </div>
                    <div className={styles.dropZoneSubtext}>PDF, JPG, PNG, MP4, MOV — max 10MB</div>
                    {recordAttachment ? <div className={styles.dropZoneFile}>{recordAttachment.name}</div> : null}
                    {recordDetecting ? <div className={styles.dropZoneFile}>detecting report...</div> : null}
                  </label>
                </RecordField>

                <RecordField label="NEXT VISIT">
                  <div style={{ position: "relative" }}>
                    <input
                      className={styles.recordInput}
                      type="date"
                      value={recordForm.nextVisitDate}
                      onChange={(e) => setRecordForm((prev) => ({ ...prev, nextVisitDate: e.target.value }))}
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
              </>
            ) : null}

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
              disabled={
                !documentFile ||
                (documentForm.subject === "horse" ? !documentForm.horseId : !documentForm.personId) ||
                !documentForm.name.trim() ||
                !documentForm.tag ||
                documentUploading
              }
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
