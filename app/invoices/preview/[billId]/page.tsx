"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import Modal from "@/components/Modal";
import NavBar from "@/components/NavBar";
import { formatInvoiceName } from "@/lib/formatInvoiceName";
import { useOrgArgs } from "@/lib/useOrgArgs";
import styles from "./preview.module.css";

type RecordType = "veterinary" | "medication" | "farrier" | "bodywork" | "other";

type RecordFormState = {
  horseIds: string[];
  date: string;
  recordType: RecordType;
  customType: string;
  visitType: "" | "vaccination" | "treatment" | "exams_diagnostics" | "other";
  vaccineName: string;
  treatmentDescription: string;
  serviceType: string;
  contactName: string;
  notes: string;
};

function categoryToRecordType(slug: string): RecordType {
  if (slug === "veterinary") return "veterinary";
  if (slug === "farrier") return "farrier";
  if (slug === "bodywork") return "bodywork";
  return "other";
}

type AssignType = "horse" | "person";
type WholeAssignMode = "single" | "split" | "business_general";

type ParsedLine = {
  description?: string;
  quantity?: number;
  amount?: number;
  total_usd?: number;
  category?: string;
  subcategory?: string;
  subcategoryAutoDetected?: boolean;
  horse_name?: string;
  horseName?: string;
  matchedHorseId?: string;
  matched_horse_id?: string;
  assignee?: string;
  assigneeType?: AssignType;
  assigneeId?: string;
  confidence?: "auto" | "manual";
  confirmed?: boolean;
  percentOwned?: number;
};

type LineState = {
  assignees: string[];
  confirmed: boolean;
  category: string;
  subcategory: string;
  subcategoryAutoDetected: boolean;
  autoDetected: boolean;
};

const HORSE_CATEGORY_SLUGS = new Set([
  "veterinary",
  "farrier",
  "horse-transport",
  "stabling",
  "feed-bedding",
  "bodywork",
  "supplies",
  "show-expenses",
  "riding-training",
  "prize-money",
  "grooming"
]);
const PERSON_CATEGORY_SLUGS = new Set(["travel", "admin", "grooming"]);
const NO_ASSIGNMENT_CATEGORY_SLUGS = new Set(["marketing"]);
const SPLIT_ALL = "__split_all__";
const SPLIT_INVOICE = "__split_invoice__";
const BUSINESS_GENERAL = "__business_general__";
const VET_SUBCATEGORY_OPTIONS = [
  { value: "medication", label: "Medication" },
  { value: "joint_injections", label: "Joint Injections" },
  { value: "exams_diagnostics", label: "Exams & Diagnostics" },
  { value: "vaccinations", label: "Vaccinations" },
  { value: "shockwave", label: "Shockwave" },
  { value: "sedation", label: "Sedation" },
  { value: "fees", label: "Fees" },
  { value: "lab_work", label: "Lab Work" },
  { value: "other", label: "Other" },
] as const;

/** All available invoice categories for line-item classification */
const ALL_CATEGORY_OPTIONS = [
  { value: "veterinary", label: "Veterinary" },
  { value: "farrier", label: "Farrier" },
  { value: "stabling", label: "Stabling" },
  { value: "feed-bedding", label: "Feed & Bedding" },
  { value: "horse-transport", label: "Horse Transport" },
  { value: "bodywork", label: "Bodywork" },
  { value: "supplies", label: "Supplies" },
  { value: "travel", label: "Travel" },
  { value: "admin", label: "Admin" },
  { value: "dues-registrations", label: "Dues & Registrations" },
  { value: "marketing", label: "Marketing" },
  { value: "show-expenses", label: "Show Expenses" },
  { value: "grooming", label: "Grooming" },
  { value: "riding-training", label: "Riding & Training" },
  { value: "commissions", label: "Commissions" },
  { value: "prize-money", label: "Prize Money" },
  { value: "income", label: "Income" },
  { value: "equity", label: "Equity" },
] as const;

const VALID_CATEGORIES = new Set<string>(ALL_CATEGORY_OPTIONS.map((o) => o.value));

/** Normalize a parsed category value to a valid category slug */
function normalizeCategory(raw: string, fallback: string): string {
  if (!raw) return fallback;
  const lower = raw.toLowerCase().replace(/\s+/g, "-");
  if (VALID_CATEGORIES.has(lower)) return lower;
  // Map common invalid values
  const aliases: Record<string, string> = {
    general: "supplies",
    "feed_bedding": "feed-bedding",
    "feed-and-bedding": "feed-bedding",
    "horse_transport": "horse-transport",
    "horse transport": "horse-transport",
    "show_expenses": "show-expenses",
    "dues_registrations": "dues-registrations",
    tack: "supplies",
    equipment: "supplies",
    grooming: "supplies",
    housing: "admin",
  };
  return aliases[lower] ?? fallback;
}

/** Subcategory options per category */
const SUBCATEGORY_OPTIONS: Record<string, Array<{ value: string; label: string }>> = {
  veterinary: [
    { value: "medication", label: "Medication" },
    { value: "joint_injections", label: "Joint Injections" },
    { value: "exams_diagnostics", label: "Exams & Diagnostics" },
    { value: "vaccinations", label: "Vaccinations" },
    { value: "shockwave", label: "Shockwave" },
    { value: "sedation", label: "Sedation" },
    { value: "fees", label: "Fees" },
    { value: "lab_work", label: "Lab Work" },
    { value: "other", label: "Other" },
  ],
  travel: [
    { value: "flights", label: "Flights" },
    { value: "hotels", label: "Hotels" },
    { value: "rental-car", label: "Rental Car" },
    { value: "gas", label: "Gas" },
    { value: "meals", label: "Meals" },
    { value: "other", label: "Other" },
  ],
  "feed-bedding": [
    { value: "hay", label: "Hay" },
    { value: "grain", label: "Grain" },
    { value: "supplements", label: "Supplements" },
    { value: "bedding", label: "Bedding" },
    { value: "other", label: "Other" },
  ],
  supplies: [
    { value: "grooming", label: "Grooming Supplies" },
    { value: "stable", label: "Stable Supplies" },
    { value: "tack", label: "Tack" },
    { value: "other", label: "Other" },
  ],
  admin: [
    { value: "accounting", label: "Accounting" },
    { value: "legal", label: "Legal" },
    { value: "insurance", label: "Insurance" },
    { value: "software-subscriptions", label: "Software & Subscriptions" },
    { value: "housing", label: "Housing" },
    { value: "bank-fees", label: "Bank & Other Fees" },
    { value: "other", label: "Other" },
  ],
  income: [
    { value: "reimbursements", label: "Reimbursements" },
    { value: "other", label: "Other" },
  ],
  equity: [
    { value: "investor-dues", label: "Investor Dues" },
    { value: "horse-purchases", label: "Horse Purchases" },
  ],
};

const CATEGORY_COLORS: Record<string, { bg: string; color: string }> = {
  veterinary: { bg: "rgba(74,91,219,0.08)", color: "#4A5BDB" },
  farrier: { bg: "rgba(20,184,166,0.08)", color: "#14B8A6" },
  stabling: { bg: "rgba(245,158,11,0.08)", color: "#F59E0B" },
  "feed-bedding": { bg: "rgba(107,112,132,0.12)", color: "#6B7084" },
  "horse-transport": { bg: "rgba(239,68,68,0.08)", color: "#E5484D" },
  bodywork: { bg: "rgba(167,139,250,0.08)", color: "#A78BFA" },
  supplies: { bg: "rgba(34,197,131,0.08)", color: "#22C583" },
  travel: { bg: "rgba(236,72,153,0.08)", color: "#EC4899" },
  housing: { bg: "rgba(6,182,212,0.08)", color: "#06B6D4" },
  admin: { bg: "rgba(100,116,139,0.12)", color: "#64748B" },
  "dues-registrations": { bg: "rgba(168,85,247,0.12)", color: "#A855F7" },
  marketing: { bg: "rgba(99,102,241,0.08)", color: "#6366F1" },
  "show-expenses": { bg: "rgba(249,115,22,0.08)", color: "#F97316" },
  grooming: { bg: "rgba(14,165,233,0.08)", color: "#0EA5E9" },
  "riding-training": { bg: "rgba(236,72,153,0.08)", color: "#EC4899" },
  "prize-money": { bg: "rgba(34,197,94,0.08)", color: "#22C55E" },
  income: { bg: "rgba(34,197,94,0.08)", color: "#16A34A" },
  equity: { bg: "rgba(139,92,246,0.08)", color: "#8B5CF6" }
};

export default function InvoicePreviewPage() {
  const params = useParams<{ billId: string }>();
  const searchParams = useSearchParams();
  const billId = params.billId as Id<"bills">;
  const router = useRouter();
  const isManualEntry = searchParams.get("manual") === "1";

  const bill = useQuery(api.bills.getById, { billId });
  const previewUrl = bill?.originalPdfUrl || undefined;
  const linkedRecords = useQuery(api.horseRecords.getByBill, { billId }) ?? [];
  const categories = useQuery(api.categories.getAllCategories) ?? [];
  const orgArgs = useOrgArgs();
  // Picker source: respect the active org filter so the dropdown only
  // offers horses you can assign within this context.
  const horses = useQuery(api.horses.getActiveHorses, orgArgs) ?? [];
  // Display source: every active horse, unfiltered. Used to resolve
  // names for horses already assigned to this bill but living in
  // another org — without this fallback they'd render as "Unknown".
  const allHorses = useQuery(api.horses.getActiveHorses, {}) ?? [];
  const horseNameById = useMemo(
    () => new Map(allHorses.map((h) => [String(h._id), h.name])),
    [allHorses],
  );
  const people = useQuery(api.people.getAllPeople) ?? [];

  const [vendorEdit, setVendorEdit] = useState(false);
  const [selectedCategoryId, setSelectedCategoryId] = useState<Id<"categories"> | "">("");
  const [customProviderName, setCustomProviderName] = useState("");

  const [detailsEdit, setDetailsEdit] = useState(false);
  const [details, setDetails] = useState({
    invoiceName: "",
    invoiceNumber: "",
    invoiceDate: "",
    dueDate: "",
    shipDate: "",
    terms: "",
    transactionId: "",
    customerId: "",
    origin: "",
    destination: "",
    totalUsd: ""
  });

  const [mode, setMode] = useState<"line" | "whole">("line");
  const [assignType, setAssignType] = useState<AssignType>("horse");
  const [lineStates, setLineStates] = useState<Record<number, LineState>>({});
  const [openDropdownId, setOpenDropdownId] = useState<number | null>(null);
  const dropdownRefs = useRef<Record<number, HTMLDivElement | null>>({});
  const [wholeSplitType, setWholeSplitType] = useState<"even" | "custom">("even");
  const [wholeAssignedIds, setWholeAssignedIds] = useState<string[]>([]);
  const [wholeAmounts, setWholeAmounts] = useState<Record<string, string>>({});
  const [wholeAssignMode, setWholeAssignMode] = useState<WholeAssignMode>("split");
  const [wholeCategoryOverride, setWholeCategoryOverride] = useState("");
  const [wholeSubcategoryOverride, setWholeSubcategoryOverride] = useState("");

  const [savingProvider, setSavingProvider] = useState(false);
  const [savingDetails, setSavingDetails] = useState(false);
  const [approving, setApproving] = useState(false);
  const [reparsing, setReparsing] = useState(false);
  const [error, setError] = useState("");

  // Inline "add line item" form state. Used when the parser pulled no line
  // items off the invoice (especially common with image uploads) so the
  // user can enter them by hand.
  const [showAddLineItem, setShowAddLineItem] = useState(false);
  const [addingLineItem, setAddingLineItem] = useState(false);
  const [newLineItemDesc, setNewLineItemDesc] = useState("");
  const [newLineItemAmount, setNewLineItemAmount] = useState("");

  // Manual currency-override picker. Used when the parser didn't detect the
  // source currency (e.g. a CAD invoice that just shows "$" with no "CAD"
  // code). Picking a non-USD value multiplies every amount on the bill
  // through the rate to land in USD.
  const [convertFromCurrency, setConvertFromCurrency] = useState<"USD" | "CAD" | "EUR" | "GBP">("USD");
  const [convertingCurrency, setConvertingCurrency] = useState(false);

  const [contactEdit, setContactEdit] = useState(false);
  const [savingContact, setSavingContact] = useState(false);
  const [contactSearch, setContactSearch] = useState("");
  const [showContactSuggestions, setShowContactSuggestions] = useState(false);
  const [selectedContactId, setSelectedContactId] = useState<Id<"contacts"> | null>(null);
  const [contactForm, setContactForm] = useState({
    name: "",
    companyName: "",
    phone: "",
    email: "",
    address: "",
    website: "",
    accountNumber: "",
  });

  const allContacts = useQuery(api.contacts.getAllContacts) ?? [];
  const contactSuggestions = useMemo(() => {
    const q = contactSearch.trim().toLowerCase();
    if (!q) return allContacts.slice(0, 8);
    return allContacts
      .filter((c) => {
        const haystack = [c.name, c.companyName, c.email, c.phone].filter(Boolean).join(" ").toLowerCase();
        return haystack.includes(q);
      })
      .slice(0, 8);
  }, [allContacts, contactSearch]);

  const parseUploadedInvoice = useAction((api as any).uploads.parseUploadedInvoice);
  const reassignAndReparse = useAction((api as any).uploads.reassignAndReparse);
  const updatePreviewFields = useMutation(api.bills.updatePreviewFields);
  const updateBillContact = useMutation(api.bills.updateBillContact);
  const createContact = useMutation(api.contacts.createContact);
  const saveHorseAssignment = useMutation(api.bills.saveHorseAssignment);
  const savePersonAssignment = useMutation(api.bills.savePersonAssignment);
  const saveDuesAssignments = useMutation(api.bills.saveDuesAssignments);
  const approveBill = useMutation(api.bills.approveBill);
  const deleteBill = useMutation(api.bills.deleteBill);
  const deleteLineItem = useMutation(api.bills.deleteLineItem);
  const addLineItem = useMutation(api.bills.addLineItem);
  const convertBillCurrency = useMutation(api.bills.convertBillCurrency);
  const updateBillNotes = useMutation(api.bills.updateBillNotes);
  const createHorseRecord = useMutation(api.horseRecords.createHorseRecord);
  const generateUploadUrl = useMutation(api.bills.generateUploadUrl);
  const triggerBillParsing = useMutation(api.bills.triggerBillParsing);
  const attachPdfToBill = useMutation(api.bills.attachPdfToBill);
  const [showRecordModal, setShowRecordModal] = useState(false);
  const [recordForm, setRecordForm] = useState<RecordFormState>({
    horseIds: [], date: "", recordType: "other", customType: "",
    visitType: "", vaccineName: "", treatmentDescription: "",
    serviceType: "", contactName: "", notes: ""
  });
  const [savingRecord, setSavingRecord] = useState(false);
  const [recordSavedCount, setRecordSavedCount] = useState(0);
  const [recordAttachment, setRecordAttachment] = useState<File | null>(null);
  const recordFileRef = useRef<HTMLInputElement>(null);

  const [notes, setNotes] = useState("");

  const categorySlug = String(bill?.category?.slug ?? "");
  const isVeterinary = categorySlug === "veterinary";
  const extracted = ((bill?.extractedData ?? {}) as Record<string, unknown>) ?? {};
  const lineItems = useMemo(() => getLineItems(extracted), [extracted]) as ParsedLine[];
  const total = useMemo(() => getTotal(extracted, lineItems), [extracted, lineItems]);

  // If no bill-level category, check line-item categories to determine assignment type
  const lineItemCats = (bill?.lineItemCategories ?? []) as string[];
  const hasHorseCat = categorySlug ? HORSE_CATEGORY_SLUGS.has(categorySlug) : lineItemCats.some((c) => HORSE_CATEGORY_SLUGS.has(c));
  const hasPersonCat = categorySlug ? PERSON_CATEGORY_SLUGS.has(categorySlug) : lineItemCats.some((c) => PERSON_CATEGORY_SLUGS.has(c));
  const requiresHorse = hasHorseCat;
  const requiresPerson = hasPersonCat;
  const requiresAssignment = categorySlug ? !NO_ASSIGNMENT_CATEGORY_SLUGS.has(categorySlug) : true;

  useEffect(() => {
    if (!bill) return;

    setSelectedCategoryId(bill.categoryId ?? "");
    setVendorEdit(false);

    setDetails({
      invoiceName: String(bill.invoiceName ?? ""),
      invoiceNumber: String(extracted.invoice_number ?? extracted.invoiceNumber ?? ""),
      invoiceDate: String(extracted.invoice_date ?? extracted.invoiceDate ?? ""),
      dueDate: String(extracted.due_date ?? extracted.dueDate ?? ""),
      shipDate: String(extracted.ship_date ?? extracted.shipDate ?? ""),
      terms: String(extracted.terms ?? ""),
      transactionId: String(extracted.transaction_id ?? extracted.transactionId ?? ""),
      customerId: String(extracted.customer_id ?? extracted.customerId ?? ""),
      origin: String(extracted.origin ?? ""),
      destination: String(extracted.destination ?? ""),
      totalUsd: String(getTotal(extracted, lineItems))
    });

    // Initialize the always-editable contact field so the dirty check doesn't
    // mark the form as having unsaved changes on first load.
    const initialContactName = String(
      bill.extractedVendorContact?.vendorName || bill.contactName || bill.customProviderName || ""
    );
    setContactSearch(initialContactName);
    setContactForm((p) => ({ ...p, name: initialContactName }));
    setSelectedContactId(bill.contactId ?? null);
    setShowContactSuggestions(false);

    setAssignType((bill.assignType as AssignType | undefined) ?? (requiresPerson ? "person" : "horse"));

    const nextLineStates: Record<number, LineState> = {};
    lineItems.forEach((row, index) => {
      const matchedHorseId = String(row.matchedHorseId ?? row.matched_horse_id ?? "");
      const savedHorses = (bill.horseAssignments ?? [])
        .filter((entry) => entry.lineItemIndex === index)
        .map((entry) => entry.horseId)
        .filter(Boolean) as string[];
      const savedPerson = bill.personAssignments?.find((entry) => entry.lineItemIndex === index)?.personId;
      const savedSplitAll = bill.splitLineItems?.some((entry) => entry.lineItemIndex === index);
      const splitAllByParsedHorse =
        String(row.horse_name ?? row.horseName ?? "").toLowerCase().trim() === SPLIT_ALL;

      const savedAssigneeId = (row as any).assigneeId ?? (row as any).entityId;
      const savedAssigneeType = (row as any).assigneeType ?? (row as any).entityType;
      const isGeneralEntity = savedAssigneeType === "general" || savedAssigneeType === "business_general";
      const isSplitAll = savedSplitAll
        || String(row.horse_name ?? row.horseName ?? "").toLowerCase().trim() === SPLIT_ALL
        || (Array.isArray((row as any).horses) && (row as any).horses.includes(SPLIT_ALL));

      let assignees: string[] = [];
      if (isSplitAll || splitAllByParsedHorse) assignees = [SPLIT_ALL];
      else if (savedHorses.length > 0) assignees = savedHorses.map(String);
      else if (savedPerson) assignees = [String(savedPerson)];
      else if (isGeneralEntity) assignees = [BUSINESS_GENERAL];
      else if (savedAssigneeId) assignees = [String(savedAssigneeId)];
      else if (matchedHorseId) assignees = [matchedHorseId];

      nextLineStates[index] = {
        assignees,
        // Default: all line items start CHECKED. Users can uncheck to exclude.
        // Only honor an explicit `false` from a previously saved state.
        confirmed: row.confirmed !== false,
        category: normalizeCategory(String(row.category ?? ""), categorySlug),
        subcategory: String(row.subcategory ?? ""),
        subcategoryAutoDetected: Boolean(row.subcategoryAutoDetected),
        autoDetected: splitAllByParsedHorse || row.confidence === "auto" || Boolean(matchedHorseId)
      };
    });

    setLineStates(nextLineStates);
    setMode("line");
    setWholeSplitType("even"); // will be overridden below if horses/people have custom amounts
    setWholeAssignMode("split");
    setNotes(String(bill.notes ?? ""));

    // Restore the whole-invoice category/subcategory overrides by inspecting
    // the saved line items: if they all share a single category that differs
    // from the bill-level category, that's the override the user picked.
    // Same logic for subcategory. If line items disagree, leave the override
    // empty (the user can only have used line-item mode).
    const lineCategories = new Set<string>();
    const lineSubcategories = new Set<string>();
    for (const row of lineItems) {
      const cat = String((row as any).category ?? "").trim().toLowerCase();
      if (cat) lineCategories.add(cat);
      const sub = String((row as any).subcategory ?? "").trim();
      if (sub) lineSubcategories.add(sub);
    }
    if (lineCategories.size === 1) {
      const onlyCat = [...lineCategories][0];
      setWholeCategoryOverride(onlyCat === categorySlug.toLowerCase() ? "" : onlyCat);
    } else {
      setWholeCategoryOverride("");
    }
    if (lineSubcategories.size === 1) {
      setWholeSubcategoryOverride([...lineSubcategories][0]);
    } else {
      setWholeSubcategoryOverride("");
    }

    if (requiresHorse && bill.assignedHorses?.length) {
      setMode("whole");
      setWholeAssignedIds(bill.assignedHorses.map((entry) => String(entry.horseId)));
      setWholeAmounts(
        Object.fromEntries(bill.assignedHorses.map((entry) => [String(entry.horseId), String(entry.amount)]))
      );
      // Restore split type: explicit field, or infer from amounts
      if ((bill as any).splitMode === "custom") {
        setWholeSplitType("custom");
      } else if ((bill as any).splitMode === "even") {
        setWholeSplitType("even");
      } else if (bill.assignedHorses.length > 1) {
        // Infer: if all amounts are equal → even, otherwise custom
        const amounts = bill.assignedHorses.map((h) => Math.round(h.amount * 100));
        const allSame = amounts.every((a) => a === amounts[0]);
        setWholeSplitType(allSame ? "even" : "custom");
      }
    } else if (requiresPerson && bill.assignedPeople?.length) {
      setMode("whole");
      setWholeAssignedIds(bill.assignedPeople.map((entry) => String(entry.personId)));
      setWholeAmounts(
        Object.fromEntries(bill.assignedPeople.map((entry) => [String(entry.personId), String(entry.amount)]))
      );
      // Restore split type for people too
      if ((bill as any).splitMode === "custom") {
        setWholeSplitType("custom");
      } else if ((bill as any).splitMode === "even") {
        setWholeSplitType("even");
      } else if (bill.assignedPeople.length > 1) {
        const amounts = bill.assignedPeople.map((p) => Math.round(p.amount * 100));
        const allSame = amounts.every((a) => a === amounts[0]);
        setWholeSplitType(allSame ? "even" : "custom");
      }
    } else {
      setWholeAssignedIds([]);
      setWholeAmounts({});
    }
  }, [bill?._id, bill?.contactId, bill?.categoryId, bill?.status, bill?.extractedData, requiresPerson, categorySlug]);

  useEffect(() => {
    if (openDropdownId === null) return;
    const handleClick = (event: MouseEvent) => {
      const container = dropdownRefs.current[openDropdownId];
      if (!container) {
        setOpenDropdownId(null);
        return;
      }
      if (!container.contains(event.target as Node)) {
        setOpenDropdownId(null);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [openDropdownId]);

  const contactName = bill?.extractedVendorContact?.vendorName || (bill?.contactName ?? bill?.customProviderName ?? "Unknown");
  const previewTitle = formatInvoiceName({ contactName: bill?.contactName ?? contactName, date: bill?.date });
  // Display name for the "INVOICE NAME" field. Priority:
  //   1. Saved bill.invoiceName (user-edited or pre-set, e.g. CC txn description)
  //   2. For uploaded bills: "{contact/provider} — {invoice date}"
  //   3. For CC bills (no PDF): the CC line-item / txn description
  const displayInvoiceName = (() => {
    const saved = String(bill?.invoiceName ?? "").trim();
    if (saved) return saved;
    const isCc = bill?.source === "cc_transaction" || !bill?.fileId;
    if (isCc) {
      const lineDesc = String((Array.isArray((extracted as any)?.line_items) ? (extracted as any).line_items[0]?.description : "") ?? "").trim();
      const fromExtracted = String((extracted as any)?.contact_name ?? "").trim();
      return lineDesc || fromExtracted || previewTitle;
    }
    const invoiceDate = String((extracted as any)?.invoice_date ?? (extracted as any)?.invoiceDate ?? "").trim();
    return formatInvoiceName({ contactName: bill?.contactName ?? contactName, date: invoiceDate || bill?.date });
  })();
  const vendorDetected = Boolean(bill?.vendorDetected ?? bill?.contactId);
  const vendorConfirmed = Boolean((bill?.vendorConfirmed ?? bill?.contactId) && !vendorEdit);

  const assignedDirectIds = useMemo(() => {
    if (mode !== "line") return [];
    const ids = lineItems.flatMap((_, index) => {
      const row = lineStates[index];
      if (!row?.confirmed || !row.assignees?.length) return [];
      if (row.assignees[0] === SPLIT_ALL || row.assignees[0] === SPLIT_INVOICE || row.assignees[0] === BUSINESS_GENERAL) return [];
      return row.assignees;
    });
    return [...new Set(ids)];
  }, [mode, lineStates, lineItems]);

  const splitRows = useMemo(
    () =>
      lineItems
        .map((line, index) => ({ line, index, state: lineStates[index] }))
        .filter((row) => row.state?.confirmed && (row.state.assignees?.[0] === SPLIT_ALL || row.state.assignees?.[0] === SPLIT_INVOICE)),
    [lineItems, lineStates]
  );

  // When there are split-all items but no direct horse assignments, fall back to all active horses
  // split-in-invoice items always use only the directly assigned horses
  const splitTargetIds = useMemo(() => {
    if (assignedDirectIds.length > 0) return assignedDirectIds;
    const hasSplitAll = lineItems.some((_, index) => lineStates[index]?.confirmed && lineStates[index]?.assignees?.[0] === SPLIT_ALL);
    if (hasSplitAll && assignType === "horse") return horses.map((h) => String(h._id));
    return assignedDirectIds;
  }, [assignedDirectIds, lineItems, lineStates, horses, assignType]);

  const groupedLineItems = useMemo(() => {
    if (categorySlug !== "veterinary") return null;
    const hasEqSportsSignal =
      String(bill?.contactName ?? contactName).toLowerCase().includes("eq sports") ||
      String(extracted.contact_name ?? extracted.contactName ?? "").toLowerCase().includes("eq sports");
    if (!hasEqSportsSignal) return null;

    const groups = new Map<string, Array<{ line: ParsedLine; index: number }>>();
    for (let index = 0; index < lineItems.length; index += 1) {
      const line = lineItems[index];
      const horseName = String(line.horse_name ?? line.horseName ?? "").trim() || "Unassigned";
      const key = horseName.toLowerCase() === SPLIT_ALL ? "__split_all__" : horseName;
      const existing = groups.get(key) ?? [];
      existing.push({ line, index });
      groups.set(key, existing);
    }
    return [...groups.entries()].map(([key, rows]) => ({
      key,
      label: key === "__split_all__" ? "Barn Supplies (split across all)" : key,
      isSplit: key === "__split_all__",
      total: round2(rows.reduce((sum, row) => sum + getLineAmount(row.line), 0)),
      rows
    }));
  }, [categorySlug, bill?.contactName, extracted.contact_name, extracted.contactName, lineItems, contactName]);

  const businessGeneralTotal = useMemo(() => {
    if (mode !== "line") return 0;
    return round2(
      lineItems.reduce((sum, row, index) => {
        const state = lineStates[index];
        if (state?.confirmed && state.assignees?.[0] === BUSINESS_GENERAL) {
          return sum + getLineAmount(row);
        }
        return sum;
      }, 0)
    );
  }, [mode, lineItems, lineStates]);

  const costBreakdown = useMemo(() => {
    if (mode !== "line" || splitTargetIds.length === 0) return [];

    const map = new Map<string, { direct: number; shared: number }>();

    for (const id of splitTargetIds) {
      map.set(id, { direct: 0, shared: 0 });
    }

    lineItems.forEach((row, index) => {
      const state = lineStates[index];
      if (!state?.confirmed || !state.assignees?.length) return;
      if (state.assignees[0] === SPLIT_ALL || state.assignees[0] === SPLIT_INVOICE || state.assignees[0] === BUSINESS_GENERAL) return;
      const perEntity = getLineAmount(row) / state.assignees.length;
      for (const entityId of state.assignees) {
        if (!map.has(entityId)) continue;
        map.get(entityId)!.direct += perEntity;
      }
    });

    for (const row of splitRows) {
      const amount = getLineAmount(row.line);
      const isSplitInvoice = row.state?.assignees?.[0] === SPLIT_INVOICE;
      // "split in invoice" only splits across directly assigned horses
      // "split all" splits across all target IDs (which may be all horses)
      const targetForThisRow = isSplitInvoice ? assignedDirectIds : splitTargetIds;
      if (targetForThisRow.length === 0) continue;
      const even = splitEven(amount, targetForThisRow.length);
      targetForThisRow.forEach((id, idx) => {
        if (map.has(id)) {
          map.get(id)!.shared += even[idx] ?? 0;
        }
      });
    }

    return splitTargetIds.map((id) => {
      // Display name fallback: look in the (filtered) picker list first,
      // then the full unfiltered horse list — that catches horses owned
      // by another org that this bill still legitimately splits to.
      const entity = (assignType === "horse" ? horses : people).find((row) => String(row._id) === id);
      const displayName = entity?.name
        ?? (assignType === "horse" ? horseNameById.get(id) : undefined)
        ?? "Unknown";
      const parts = map.get(id) ?? { direct: 0, shared: 0 };
      return {
        id,
        name: displayName,
        direct: round2(parts.direct),
        shared: round2(parts.shared),
        total: round2(parts.direct + parts.shared)
      };
    });
  }, [mode, splitRows, splitTargetIds, lineItems, lineStates, horses, people, assignType]);

  const previewDiscount = useMemo(() => {
    const raw = Number(extracted.discount ?? extracted.professional_discount ?? bill?.discount ?? 0);
    return Number.isFinite(raw) ? raw : 0;
  }, [extracted.discount, extracted.professional_discount, bill?.discount]);

  const allLineAssigned = useMemo(() => {
    if (!requiresAssignment || mode !== "line") return true;

    // Only confirmed (checked) items need assignment — unchecked items are excluded
    const confirmedItems = lineItems.filter((_, index) => lineStates[index]?.confirmed);
    if (confirmedItems.length === 0) return false; // must have at least one confirmed item
    return lineItems.every((_, index) => {
      const row = lineStates[index];
      if (!row?.confirmed) return true; // unchecked items are excluded, skip them
      return Boolean(row.assignees?.length);
    });
  }, [requiresAssignment, mode, lineItems, lineStates]);

  const wholeTotalAssigned = useMemo(() => {
    if (wholeAssignMode === "business_general") return total;
    if (wholeAssignedIds.length === 0) return 0;
    if (wholeSplitType === "even") return total;
    return round2(wholeAssignedIds.reduce((sum, id) => sum + Number(wholeAmounts[id] || 0), 0));
  }, [wholeAssignMode, wholeAssignedIds, wholeSplitType, wholeAmounts, total]);

  const wholeBalanced = wholeSplitType === "even" || Math.abs(wholeTotalAssigned - total) < 0.01;

  const assignmentReady = useMemo(() => {
    if (!requiresAssignment) return true;
    if (mode === "line") return allLineAssigned;
    if (wholeAssignMode === "business_general") return true;
    if (wholeAssignMode === "single") return wholeAssignedIds.length === 1;
    if (wholeAssignedIds.length === 0) return false;
    if (wholeSplitType === "custom") return wholeBalanced;
    return true;
  }, [requiresAssignment, mode, allLineAssigned, wholeAssignMode, wholeAssignedIds.length, wholeSplitType, wholeBalanced]);

  // Provider confirmation is no longer required — contacts are auto-detected
  const approveDisabled = !assignmentReady;
  const isEditing = Boolean(bill?.isApproved);

  const entityList = assignType === "horse" ? horses : people;

  function switchAssignType(newType: AssignType) {
    if (newType === assignType) return;
    setAssignType(newType);
    setLineStates((prev) => Object.fromEntries(
      Object.entries(prev).map(([key, value]) => [
        key,
        { ...value, assignees: [], confirmed: false, autoDetected: false }
      ])
    ));
    setWholeAssignedIds([]);
    setWholeAmounts({});
    setWholeAssignMode("split");
  }

  function toggleEntityOnItem(index: number, entityId: string) {
    setLineStates((prev) => {
      const row = prev[index] ?? {
        assignees: [],
        confirmed: false,
        category: categorySlug,
        subcategory: "",
        subcategoryAutoDetected: false,
        autoDetected: false
      };

      if (entityId === SPLIT_ALL || entityId === SPLIT_INVOICE || entityId === BUSINESS_GENERAL) {
        return {
          ...prev,
          [index]: {
            ...row,
            assignees: [entityId],
            confirmed: true,
            autoDetected: false
          }
        };
      }

      let current = row.assignees.filter((id) => id !== SPLIT_ALL && id !== SPLIT_INVOICE && id !== BUSINESS_GENERAL);
      if (current.includes(entityId)) {
        current = current.filter((id) => id !== entityId);
      } else {
        current = [...current, entityId];
      }

      return {
        ...prev,
        [index]: {
          ...row,
          assignees: current,
          confirmed: current.length > 0,
          autoDetected: false
        }
      };
    });
  }

  function renderLineRow(line: ParsedLine, index: number) {
    const row = lineStates[index] ?? {
      assignees: [],
      confirmed: false,
      category: categorySlug,
      subcategory: String(line.subcategory ?? ""),
      subcategoryAutoDetected: Boolean(line.subcategoryAutoDetected),
      autoDetected: false
    };
    const amount = getLineAmount(line);
    const firstAssignee = row.assignees[0];
    const hasSplitAll = firstAssignee === SPLIT_ALL;
    const hasSplitInvoice = firstAssignee === SPLIT_INVOICE;
    const hasAnySplit = hasSplitAll || hasSplitInvoice;
    const hasBusinessGeneral = firstAssignee === BUSINESS_GENERAL;
    const selectedEntityIds = row.assignees.filter((id) => id !== SPLIT_ALL && id !== SPLIT_INVOICE && id !== BUSINESS_GENERAL);

    const horseButtonTitle =
      row.autoDetected && row.assignees.length > 0 && !hasAnySplit && !hasBusinessGeneral
        ? "auto-detected"
        : hasAnySplit && costBreakdown.length === 0
          ? "assign other items first"
          : undefined;

    return (
      <div
        key={index}
        className={`${styles.lineRow} ${styles.lineRowVet} ${hasAnySplit ? styles.lineRowShared : hasBusinessGeneral ? styles.lineRowBusinessGeneral : row.confirmed ? (assignType === "horse" ? styles.lineRowHorse : styles.lineRowPerson) : ""}`}
        style={!row.confirmed ? { opacity: 0.4 } : undefined}
      >
        <div className={styles.lineDescription}>{line.description || `Line item ${index + 1}`}</div>

        <div className={styles.lineHorseMultiselect} ref={(el) => { dropdownRefs.current[index] = el; }}>
          <button
            type="button"
            title={horseButtonTitle}
            className={`${styles.lineHorseInput} ${
              hasAnySplit
                ? costBreakdown.length === 0 ? styles.assignSelectSplitWarn : styles.assignSelectShared
                : hasBusinessGeneral
                  ? styles.assignSelectBusinessGeneral
                  : row.autoDetected && row.assignees.length > 0
                    ? styles.assignSelectAutoDetected
                    : row.confirmed
                      ? (assignType === "horse" ? styles.assignSelectHorse : styles.assignSelectPerson)
                      : ""
            }`}
            onClick={() => setOpenDropdownId((prev) => (prev === index ? null : index))}
          >
            {hasSplitAll ? <span className={`${styles.lineHorsePill} ${styles.lineHorsePillSplit}`}>↔ split all</span> : null}
            {hasSplitInvoice ? <span className={`${styles.lineHorsePill} ${styles.lineHorsePillSplit}`}>↔ split in invoice</span> : null}
            {hasBusinessGeneral ? <span className={`${styles.lineHorsePill} ${styles.lineHorsePillGeneral}`}>◼ general</span> : null}
            {!hasAnySplit && !hasBusinessGeneral ? selectedEntityIds.map((id) => {
              const name = entityList.find((entry) => String(entry._id) === id)?.name
                ?? (assignType === "horse" ? horseNameById.get(id) : undefined)
                ?? "Unknown";
              return (
                <span key={id} className={`${styles.lineHorsePill} ${assignType === "person" ? styles.lineHorsePillPerson : ""}`}>
                  {name}
                  <span
                    className={styles.lineHorsePillRemove}
                    onClick={(event) => {
                      event.stopPropagation();
                      toggleEntityOnItem(index, id);
                    }}
                  >
                    ✕
                  </span>
                </span>
              );
            }) : null}
            {!hasAnySplit && !hasBusinessGeneral && selectedEntityIds.length === 0 ? <span className={styles.lineHorsePlaceholder}>assign...</span> : null}
            <span className={styles.lineHorseCaret}>▾</span>
          </button>

          {openDropdownId === index ? (
            <div className={styles.lineHorseDropdown}>
              <button type="button" className={styles.lineHorseOption} onClick={() => toggleEntityOnItem(index, SPLIT_INVOICE)}>
                ↔ split across {assignType === "horse" ? "horses" : "people"} in this invoice
              </button>
              <button type="button" className={styles.lineHorseOption} onClick={() => toggleEntityOnItem(index, SPLIT_ALL)}>
                ↔ split across ALL {assignType === "horse" ? "horses" : "people"}
              </button>
              <button type="button" className={styles.lineHorseOption} onClick={() => toggleEntityOnItem(index, BUSINESS_GENERAL)}>◼ business general</button>
              <div className={styles.lineHorseDivider} />
              {entityList.map((entry) => {
                const selected = selectedEntityIds.includes(String(entry._id));
                return (
                  <button
                    type="button"
                    key={entry._id}
                    className={styles.lineHorseOption}
                    onClick={() => toggleEntityOnItem(index, String(entry._id))}
                  >
                    <span>{selected ? "☑" : "☐"}</span>
                    <span>{entry.name}</span>
                  </button>
                );
              })}
            </div>
          ) : null}
        </div>

        <select
          className={styles.categorySelect}
          value={row.category || categorySlug || ""}
          onChange={(event) => setLineStates((prev) => ({ ...prev, [index]: { ...row, category: event.target.value, subcategory: "" } }))}
        >
          <option value="">category...</option>
          {ALL_CATEGORY_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>

        {SUBCATEGORY_OPTIONS[row.category || categorySlug || ""] ? (
          <select
            className={`${styles.categorySelect} ${row.subcategoryAutoDetected ? styles.subcategorySelectAuto : ""}`}
            title={row.subcategoryAutoDetected && row.subcategory ? "auto-detected" : undefined}
            value={row.subcategory}
            onChange={(event) =>
              setLineStates((prev) => ({
                ...prev,
                [index]: {
                  ...row,
                  subcategory: event.target.value,
                  subcategoryAutoDetected: false,
                }
              }))
            }
          >
            <option value="">subcategory...</option>
            {(SUBCATEGORY_OPTIONS[row.category || categorySlug || ""] ?? []).map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        ) : <div />}

        <div className={styles.lineAmount}>{formatUsd(amount)}</div>

        <div className={styles.lineActions}>
          <button
            type="button"
            className={`${styles.confirmCheck} ${row.confirmed ? styles.confirmCheckChecked : styles.confirmCheckUnchecked}`}
            onClick={() => setLineStates((prev) => ({ ...prev, [index]: { ...row, confirmed: !row.confirmed } }))}
            aria-label={row.confirmed ? "uncheck line" : "check line"}
          >
            ✓
          </button>
          {!row.confirmed ? (
            <button
              type="button"
              className={styles.deleteLineBtn}
              onClick={() => void deleteLineItem({ billId, lineItemIndex: index })}
              aria-label="delete line item"
              title="Remove this line item from the invoice"
            >
              ✕
            </button>
          ) : null}
        </div>
      </div>
    );
  }

  async function onReparseBill() {
    if (!bill) return;
    if (!confirm("Re-parse this invoice from scratch? Any manual edits to extracted line items will be overwritten.")) return;
    setError("");
    try {
      setReparsing(true);
      await triggerBillParsing({ billId });
    } catch (err) {
      setReparsing(false);
      setError(err instanceof Error ? err.message : "Failed to re-parse");
    }
  }

  const [uploadingPdf, setUploadingPdf] = useState(false);
  const pdfUploadRef = useRef<HTMLInputElement>(null);

  async function onFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !bill) return;
    const allowed = /\.(pdf|png|jpe?g|gif|webp|tiff?|bmp|heic)$/i;
    if (!allowed.test(file.name)) {
      setError("Please select a PDF or image file");
      return;
    }
    setError("");
    setUploadingPdf(true);
    try {
      const uploadUrl = await generateUploadUrl();
      const res = await fetch(uploadUrl, {
        method: "POST",
        headers: { "Content-Type": file.type || "application/octet-stream" },
        body: file,
      });
      if (!res.ok) throw new Error("Upload failed");
      const { storageId } = await res.json();
      await attachPdfToBill({ billId, fileId: storageId, fileName: file.name });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to upload file");
    } finally {
      setUploadingPdf(false);
    }
  }

  async function onConfirmProvider() {
    if (!bill || !selectedCategoryId) return;
    setSavingProvider(true);
    setError("");
    try {
      const selectedCategory = categories.find((c) => c._id === selectedCategoryId);
      const newCategorySlug = selectedCategory?.slug ?? "";

      setReparsing(true);
      await reassignAndReparse({
        billId,
        categoryId: selectedCategoryId,
        contactId: selectedContactId ?? undefined,
        customProviderName: customProviderName.trim() || undefined,
        adminSubcategory: newCategorySlug === "admin" ? bill.adminSubcategory || undefined : undefined,
        duesSubcategory: newCategorySlug === "dues-registrations" ? bill.duesSubcategory || undefined : undefined
      });

      setVendorEdit(false);
    } catch (err) {
      setReparsing(false);
      setError(err instanceof Error ? err.message : "Failed to confirm provider");
    } finally {
      setSavingProvider(false);
    }
  }

  function openContactEdit() {
    const c = bill?.extractedVendorContact;
    setContactForm({
      name: c?.vendorName ?? contactName ?? "",
      companyName: (c as any)?.fullName ?? c?.vendorName ?? "",
      phone: c?.phone ?? "",
      email: c?.email ?? "",
      address: c?.address ?? "",
      website: c?.website ?? "",
      accountNumber: c?.accountNumber ?? "",
    });
    setContactSearch(c?.vendorName ?? contactName ?? "");
    setSelectedContactId(bill?.contactId ?? null);
    setShowContactSuggestions(false);
    setContactEdit(true);
  }

  function selectExistingContact(contact: (typeof allContacts)[number]) {
    setSelectedContactId(contact._id);
    setContactSearch(contact.name);
    setShowContactSuggestions(false);
    setContactForm({
      name: contact.name,
      companyName: contact.companyName ?? "",
      phone: contact.phone ?? "",
      email: contact.email ?? "",
      address: contact.address ?? "",
      website: contact.website ?? "",
      accountNumber: contact.accountNumber ?? "",
    });
  }

  async function onSaveContact() {
    if (!bill) return;
    setSavingContact(true);
    setError("");
    try {
      const contactData = {
        vendorName: contactForm.name || undefined,
        phone: contactForm.phone || undefined,
        email: contactForm.email || undefined,
        address: contactForm.address || undefined,
        website: contactForm.website || undefined,
        accountNumber: contactForm.accountNumber || undefined,
      };

      let contactId = selectedContactId ?? undefined;
      const trimmedName = contactForm.name?.trim();

      // If no existing contact selected but we have a name, look for one
      // with the same (case-insensitive) name first to avoid duplicates,
      // otherwise create a new one — pull across every auto-extracted
      // field from the invoice so the new contact starts fully populated.
      if (!contactId && trimmedName) {
        const existing = allContacts.find(
          (c) => c.name.trim().toLowerCase() === trimmedName.toLowerCase()
        );
        if (existing) {
          contactId = existing._id;
        } else {
          contactId = await createContact({
            name: trimmedName,
            category: categorySlug || "other",
            companyName: contactForm.companyName || undefined,
            phone: contactForm.phone || undefined,
            email: contactForm.email || undefined,
            address: contactForm.address || undefined,
            website: contactForm.website || undefined,
            accountNumber: contactForm.accountNumber || undefined,
          });
        }
        setSelectedContactId(contactId ?? null);
      }

      await updateBillContact({
        billId,
        contactId,
        extractedVendorContact: contactData,
      });
      setContactEdit(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save contact");
    } finally {
      setSavingContact(false);
    }
  }

  async function onConvertCurrency() {
    if (!bill) return;
    if (convertFromCurrency === "USD" && (bill as any).originalCurrency !== undefined && (bill as any).originalCurrency !== "USD") {
      // No-op safeguard — picking USD when the bill was already marked USD
      // does nothing useful. Skip silently.
    }
    setConvertingCurrency(true);
    setError("");
    try {
      await convertBillCurrency({ billId, fromCurrency: convertFromCurrency });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to convert currency");
    } finally {
      setConvertingCurrency(false);
    }
  }

  async function onAddLineItem() {
    if (!bill) return;
    const amountNum = Number.parseFloat(newLineItemAmount);
    if (!Number.isFinite(amountNum)) {
      setError("Enter a valid amount");
      return;
    }
    setAddingLineItem(true);
    setError("");
    try {
      await addLineItem({
        billId,
        description: newLineItemDesc.trim(),
        amount: amountNum,
        category: categorySlug || undefined,
      });
      setNewLineItemDesc("");
      setNewLineItemAmount("");
      setShowAddLineItem(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add line item");
    } finally {
      setAddingLineItem(false);
    }
  }

  /** Save the combined 4-field details card (name + date + invoice# + contact)
   *  in one go. Contact is resolved against existing contacts by name; a new
   *  contact is created if no match. */
  async function onSaveCombinedDetails() {
    if (!bill) return;
    setSavingDetails(true);
    setSavingContact(true);
    setError("");
    try {
      // 1. Resolve contact (existing → reuse, otherwise create)
      const trimmedName = (contactSearch || contactForm.name || "").trim();
      let contactId = selectedContactId ?? undefined;
      if (!contactId && trimmedName) {
        const existing = allContacts.find(
          (c) => c.name.trim().toLowerCase() === trimmedName.toLowerCase()
        );
        if (existing) {
          contactId = existing._id;
        } else {
          contactId = await createContact({
            name: trimmedName,
            category: categorySlug || "other",
          });
        }
        setSelectedContactId(contactId ?? null);
      }

      await updateBillContact({
        billId,
        contactId,
        extractedVendorContact: { vendorName: trimmedName || undefined },
      });

      // 2. Save invoice details (only the 3 editable invoice fields).
      await updatePreviewFields({
        billId,
        invoiceName: details.invoiceName || undefined,
        invoiceNumber: details.invoiceNumber || undefined,
        invoiceDate: details.invoiceDate || undefined,
      });

      setDetailsEdit(false);
      setShowContactSuggestions(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSavingDetails(false);
      setSavingContact(false);
    }
  }

  async function onSaveDetails() {
    if (!bill) return;
    setSavingDetails(true);
    setError("");
    try {
      await updatePreviewFields({
        billId,
        invoiceName: details.invoiceName || undefined,
        invoiceNumber: details.invoiceNumber || undefined,
        invoiceDate: details.invoiceDate || undefined,
        dueDate: details.dueDate || undefined,
        shipDate: details.shipDate || undefined,
        terms: details.terms || undefined,
        transactionId: details.transactionId || undefined,
        customerId: details.customerId || undefined,
        totalUsd: details.totalUsd ? Number(details.totalUsd) : undefined,
        origin: details.origin || undefined,
        destination: details.destination || undefined
      });
      setDetailsEdit(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save details");
    } finally {
      setSavingDetails(false);
    }
  }

  async function persistAssignments() {
    if (!bill || !requiresAssignment) return;

    if (mode === "whole") {
      if (wholeAssignMode === "business_general") {
        if (assignType === "horse") {
          await saveHorseAssignment({
            billId,
            horseSplitType: "single",
            assignedHorses: [],
            horseAssignments: [],
            splitLineItems: []
          });
        } else {
          await savePersonAssignment({
            billId,
            isSplit: false,
            assignedPeople: []
          });
        }
        return;
      }
      if (assignType === "horse") {
        const evenlySplit = splitEven(total, wholeAssignedIds.length);
        const activeIds = wholeAssignMode === "single" ? wholeAssignedIds.slice(0, 1) : wholeAssignedIds;
        const assignedHorses = activeIds.map((id, index) => {
          const horse = horses.find((entry) => String(entry._id) === id);
          const amount = wholeSplitType === "even" ? evenlySplit[index] ?? 0 : Number(wholeAmounts[id] || 0);
          return {
            horseId: id as Id<"horses">,
            horseName: horse?.name ?? "Unknown",
            amount: round2(amount),
            direct: round2(amount),
            shared: 0
          };
        });

        await saveHorseAssignment({
          billId,
          horseSplitType: assignedHorses.length > 1 ? "split" : "single",
          assignedHorses,
          horseAssignments: [],
          splitLineItems: []
        });
        return;
      }

      if (assignType === "person") {
        const evenlySplit = splitEven(total, wholeAssignedIds.length);
        const activeIds = wholeAssignMode === "single" ? wholeAssignedIds.slice(0, 1) : wholeAssignedIds;
        await savePersonAssignment({
          billId,
          isSplit: activeIds.length > 1,
          assignedPeople: activeIds.map((id, index) => ({
            personId: id as Id<"people">,
            amount: round2(wholeSplitType === "even" ? evenlySplit[index] ?? 0 : Number(wholeAmounts[id] || 0))
          }))
        });
        return;
      }
    }

    if (categorySlug === "dues-registrations") {
      await saveDuesAssignments({
        billId,
        assignments: lineItems.map((_, index) => {
          const row = lineStates[index];
          const entityId = row?.assignees?.[0];
          const isGeneral = entityId === BUSINESS_GENERAL;
          const resolvedType: string = isGeneral ? "general" : entityId ? assignType : "none";
          const resolvedId = isGeneral ? undefined : (entityId || undefined);
          const entityName = isGeneral
            ? "General"
            : assignType === "horse"
              ? horses.find((entry) => String(entry._id) === resolvedId)?.name
              : people.find((entry) => String(entry._id) === resolvedId)?.name;
          return {
            lineItemIndex: index,
            entityType: resolvedType as "horse" | "person" | "general" | "none",
            entityId: resolvedId,
            entityName
          };
        })
      });
      return;
    }

    if (assignType === "horse") {
      const directAssignments = lineItems
        .map((line, index) => ({ line, index, state: lineStates[index] }))
        .filter((row) => row.state?.confirmed)
        .map((row) => ({
          ...row,
          assignees: (row.state?.assignees ?? []).filter((id) => id !== SPLIT_ALL && id !== SPLIT_INVOICE && id !== BUSINESS_GENERAL),
        }))
        .filter((row) => row.assignees.length > 0);
      const directHorseIds = [...new Set(directAssignments.flatMap((row) => row.assignees))];

      // Determine split targets: "split in invoice" uses only horses directly assigned in THIS invoice
      // "split all" uses all horses in the system if no direct assignments exist
      const hasSplitAllItems = lineItems.some((_, index) => {
        const state = lineStates[index];
        return state?.confirmed && state.assignees?.[0] === SPLIT_ALL;
      });
      const hasSplitInvoiceItems = lineItems.some((_, index) => {
        const state = lineStates[index];
        return state?.confirmed && state.assignees?.[0] === SPLIT_INVOICE;
      });
      // For "split all": use all horses if no direct assignments, otherwise use direct ones
      const splitAllTargetIds = directHorseIds.length > 0
        ? directHorseIds
        : hasSplitAllItems
          ? horses.map((h) => String(h._id))
          : [];
      // For "split in invoice": ONLY use horses directly assigned in this invoice
      const splitInvoiceTargetIds = directHorseIds;

      const horseAssignments = directAssignments.flatMap((row) => (
        row.assignees.map((horseId) => {
          const horse = horses.find((entry) => String(entry._id) === horseId);
          return {
            lineItemIndex: row.index,
            horseId: horseId as Id<"horses">,
            horseName: horse?.name ?? "Unknown"
          };
        })
      ));

      const splitLineItems = lineItems
        .map((line, index) => ({ line, index, state: lineStates[index] }))
        .filter((row) => row.state?.confirmed && (row.state.assignees?.[0] === SPLIT_ALL || row.state.assignees?.[0] === SPLIT_INVOICE))
        .map((row) => {
          const isSplitAll = row.state?.assignees?.[0] === SPLIT_ALL;
          const targetIds = isSplitAll ? splitAllTargetIds : splitInvoiceTargetIds;
          if (targetIds.length === 0) return null;
          const splitAmounts = splitEven(getLineAmount(row.line), targetIds.length);
          return {
            lineItemIndex: row.index,
            splits: targetIds.map((horseId, idx) => {
              const horse = horses.find((entry) => String(entry._id) === horseId);
              return {
                horseId: horseId as Id<"horses">,
                horseName: horse?.name ?? "Unknown",
                amount: splitAmounts[idx] ?? 0
              };
            })
          };
        }).filter(Boolean) as Array<{ lineItemIndex: number; splits: Array<{ horseId: Id<"horses">; horseName: string; amount: number }> }>;

      const horseTotals = new Map<string, { horseName: string; direct: number; shared: number }>();
      for (const row of directAssignments) {
        const perHorse = getLineAmount(row.line) / row.assignees.length;
        for (const horseId of row.assignees) {
          const horse = horses.find((entry) => String(entry._id) === horseId);
          const curr = horseTotals.get(String(horseId)) ?? { horseName: horse?.name ?? "Unknown", direct: 0, shared: 0 };
          curr.direct += perHorse;
          horseTotals.set(String(horseId), curr);
        }
      }
      for (const split of splitLineItems) {
        for (const row of split.splits) {
          const curr = horseTotals.get(String(row.horseId)) ?? { horseName: row.horseName, direct: 0, shared: 0 };
          curr.shared += row.amount;
          horseTotals.set(String(row.horseId), curr);
        }
      }
      const assignedHorses = [...horseTotals.entries()].map(([horseId, row]) => ({
        horseId: horseId as Id<"horses">,
        horseName: row.horseName,
        direct: round2(row.direct),
        shared: round2(row.shared),
        amount: round2(row.direct + row.shared)
      }));

      await saveHorseAssignment({
        billId,
        horseSplitType: splitLineItems.length > 0 || assignedHorses.length > 1 ? "split" : "single",
        assignedHorses,
        horseAssignments,
        splitLineItems
      });
      return;
    }

    if (assignType === "person") {
      const directAssignments = lineItems
        .map((line, index) => ({ line, index, state: lineStates[index] }))
        .filter((row) => row.state?.confirmed)
        .map((row) => ({
          ...row,
          assignees: (row.state?.assignees ?? []).filter((id) => id !== SPLIT_ALL && id !== BUSINESS_GENERAL),
        }))
        .filter((row) => row.assignees.length > 0);
      const directPeopleIds = [...new Set(directAssignments.flatMap((row) => row.assignees))];
      const totals = new Map<string, number>();

      for (const row of directAssignments) {
        const perPerson = getLineAmount(row.line) / row.assignees.length;
        for (const personId of row.assignees) {
          totals.set(personId, (totals.get(personId) ?? 0) + perPerson);
        }
      }

      const sharedRows = lineItems
        .map((line, index) => ({ line, index, state: lineStates[index] }))
        .filter((row) => row.state?.confirmed && row.state.assignees?.[0] === SPLIT_ALL);

      for (const row of sharedRows) {
        const split = splitEven(getLineAmount(row.line), directPeopleIds.length);
        directPeopleIds.forEach((id, idx) => {
          totals.set(id, (totals.get(id) ?? 0) + (split[idx] ?? 0));
        });
      }

      await savePersonAssignment({
        billId,
        isSplit: totals.size > 1,
        assignedPeople: [...totals.entries()].map(([personId, amount]) => ({ personId: personId as Id<"people">, amount: round2(amount) }))
      });
      return;
    }

    await saveDuesAssignments({
      billId,
      assignments: lineItems.map((_, index) => {
        const row = lineStates[index];
        const entityId = row?.assignees?.[0];
        const entityName =
          assignType === "horse"
            ? horses.find((entry) => String(entry._id) === entityId)?.name
            : people.find((entry) => String(entry._id) === entityId)?.name;
        return {
          lineItemIndex: index,
          entityType: entityId ? assignType : "none",
          entityId: entityId || undefined,
          entityName
        };
      })
    });
  }

  async function onApprove() {
    if (!bill) return;
    setApproving(true);
    setError("");
    try {
      await saveNotesIfNeeded();
      await persistAssignments();
      const payloadLineItems = lineItems
        .map((line, index) => {
          const state = lineStates[index];
          const selectedAssignees = state?.assignees ?? [];
          const isBusinessGeneral = mode === "line" && selectedAssignees[0] === BUSINESS_GENERAL;
          const isWholeBusinessGeneral = mode === "whole" && wholeAssignMode === "business_general";
          return {
            ...line,
            description: line.description || `Line item ${index + 1}`,
            amount: getLineAmount(line),
            category: (mode === "whole" && wholeCategoryOverride) ? wholeCategoryOverride : (state?.category || categorySlug),
            subcategory: (mode === "whole" && wholeSubcategoryOverride) ? wholeSubcategoryOverride : (state?.subcategory || line.subcategory || null),
            subcategoryAutoDetected: Boolean(state?.subcategoryAutoDetected),
            horses: assignType === "horse" ? selectedAssignees : undefined,
            people: assignType === "person" ? selectedAssignees : undefined,
            assignee: isBusinessGeneral || isWholeBusinessGeneral ? null : (selectedAssignees[0] || ""),
            assigneeType: isBusinessGeneral || isWholeBusinessGeneral ? "business_general" : assignType,
            assigneeId: isBusinessGeneral || isWholeBusinessGeneral ? null : (selectedAssignees[0] || ""),
            confidence: state?.autoDetected ? "auto" : "manual",
            confirmed: mode === "whole" ? true : Boolean(state?.confirmed)
          };
        })
        .filter((item) => mode === "whole" || item.confirmed);
      await approveBill({
        billId,
        lineItems: payloadLineItems,
        assignMode: mode,
        assignType,
        splitMode: mode === "whole" ? wholeSplitType : undefined,
        splitEntities:
          mode === "whole" && wholeAssignMode !== "business_general"
            ? wholeAssignedIds.map((id) => {
                const entity = entityList.find((entry) => String(entry._id) === id);
                const evenAmounts = splitEven(total, wholeAssignedIds.length);
                const index = wholeAssignedIds.indexOf(id);
                const fallback = assignType === "horse" ? horseNameById.get(id) : undefined;
                return {
                  entityId: id,
                  entityName: entity?.name ?? fallback ?? "Unknown",
                  amount: round2(wholeSplitType === "even" ? evenAmounts[index] ?? 0 : Number(wholeAmounts[id] || 0))
                };
              })
            : undefined,
        notes: notes.trim() || undefined
      });
      // Determine redirect based on line item categories (which may have been changed by the user)
      const dominantLineCat = (mode === "whole" && wholeCategoryOverride) ? wholeCategoryOverride : (() => {
        const lineCatFreq = new Map<string, number>();
        for (const ls of Object.values(lineStates)) {
          if (ls?.category) lineCatFreq.set(ls.category, (lineCatFreq.get(ls.category) || 0) + 1);
        }
        return lineCatFreq.size > 0
          ? [...lineCatFreq.entries()].sort((a, b) => b[1] - a[1])[0][0]
          : null;
      })();
      // If line items were recategorized, build path using the new category
      const effectiveBill = dominantLineCat && dominantLineCat !== categorySlug
        ? { ...bill, category: { ...(bill?.category ?? {}), slug: dominantLineCat } }
        : bill;
      router.push(isEditing ? "/invoices" : buildPermanentInvoicePath(effectiveBill));
    } catch (err) {
      setError(err instanceof Error ? err.message : isEditing ? "Failed to save" : "Failed to approve");
    } finally {
      setApproving(false);
    }
  }

  async function onDelete() {
    if (!bill) return;
    if (!window.confirm(`Delete invoice \"${bill.fileName}\"? This cannot be undone.`)) return;
    await deleteBill({ billId });
    router.push("/invoices");
  }

  function buildHorseNotes(horseId: string): string {
    const descriptions: string[] = [];
    lineItems.forEach((item, index) => {
      const state = lineStates[index];
      if (!state?.confirmed) return;
      const assigned = state.assignees.includes(horseId) || state.assignees.includes(SPLIT_ALL);
      if (!assigned) return;
      const desc = String(item.description ?? "").trim();
      if (desc) descriptions.push(desc);
    });
    if (descriptions.length === 0) return "";
    if (descriptions.length === 1) return descriptions[0];
    return descriptions.join(", ");
  }

  function openRecordModal() {
    const assignedHorseIds = Object.values(lineStates)
      .flatMap((s) => s.assignees)
      .filter((id) => id && id !== SPLIT_ALL && id !== BUSINESS_GENERAL);
    const wholeHorseIds = wholeAssignedIds.filter((id) => id !== SPLIT_ALL && id !== BUSINESS_GENERAL);
    const allIds = [...new Set([...assignedHorseIds, ...wholeHorseIds])];

    setRecordForm({
      horseIds: allIds,
      date: details.invoiceDate || "",
      recordType: categoryToRecordType(categorySlug),
      customType: "",
      visitType: "",
      vaccineName: "",
      treatmentDescription: "",
      serviceType: "",
      contactName: contactName !== "Unknown" ? contactName : "",
      notes: ""
    });
    setRecordAttachment(null);
    setShowRecordModal(true);
  }

  async function onSaveRecord() {
    // Only save for IDs that are real horses (exist in the horses list)
    const validHorseIds = recordForm.horseIds.filter((id) => horses.some((h) => String(h._id) === id));
    if (validHorseIds.length === 0 || !recordForm.date || !recordForm.recordType) return;
    setSavingRecord(true);
    try {
      const dateTs = new Date(`${recordForm.date}T00:00:00`).getTime();
      if (!Number.isFinite(dateTs)) throw new Error("Invalid date");

      let attachmentStorageId: string | undefined;
      let attachmentName: string | undefined;
      if (recordAttachment) {
        const uploadUrl = await generateUploadUrl();
        const resp = await fetch(uploadUrl, {
          method: "POST",
          headers: { "Content-Type": recordAttachment.type || "application/octet-stream" },
          body: recordAttachment,
        });
        if (!resp.ok) throw new Error("Failed to upload attachment");
        const payload = await resp.json();
        attachmentStorageId = typeof payload.storageId === "string" ? payload.storageId : undefined;
        attachmentName = recordAttachment.name;
      }

      let saved = 0;
      for (const hId of validHorseIds) {
        const autoNotes = buildHorseNotes(hId);
        const combinedNotes = [autoNotes, recordForm.notes].filter(Boolean).join("\n") || undefined;
        await createHorseRecord({
          horseId: hId as Id<"horses">,
          type: recordForm.recordType,
          customType: recordForm.recordType === "other" ? recordForm.customType || undefined : undefined,
          date: dateTs,
          contactName: recordForm.contactName || undefined,
          visitType: recordForm.recordType === "veterinary" && recordForm.visitType ? recordForm.visitType as "vaccination" | "treatment" | "exams_diagnostics" | "other" : undefined,
          vaccineName: recordForm.recordType === "veterinary" && recordForm.visitType === "vaccination" ? recordForm.vaccineName || undefined : undefined,
          treatmentDescription: recordForm.recordType === "veterinary" && (recordForm.visitType === "treatment" || recordForm.visitType === "exams_diagnostics" || recordForm.visitType === "other") ? recordForm.treatmentDescription || undefined : undefined,
          serviceType: recordForm.recordType === "farrier" ? recordForm.serviceType || undefined : undefined,
          isUpcoming: false,
          notes: combinedNotes,
          attachmentStorageId,
          attachmentName,
          billId
        });
        saved++;
      }
      setShowRecordModal(false);
      setRecordSavedCount(saved);
      setRecordForm((prev) => ({ ...prev, horseIds: [], notes: "" }));
      setRecordAttachment(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save record");
    } finally {
      setSavingRecord(false);
    }
  }

  async function saveNotesIfNeeded() {
    if (!bill) return;
    const current = String(bill.notes ?? "").trim();
    const next = notes.trim();
    if (current === next) return;
    await updateBillNotes({ billId, notes: next });
  }

  const isParsing = bill && (bill.status === "parsing" || bill.status === "uploading");

  // True when any of the 4 always-editable detail fields differs from the
  // bill's persisted values. Drives whether the cancel/save buttons are
  // visible on the always-editable invoice details card.
  const detailsDirty = useMemo(() => {
    if (!bill) return false;
    const extracted = (bill.extractedData ?? {}) as Record<string, unknown>;
    const savedInvoiceName = String(bill.invoiceName ?? "");
    const savedInvoiceNumber = String((extracted as any).invoice_number ?? (extracted as any).invoiceNumber ?? "");
    const savedInvoiceDate = String((extracted as any).invoice_date ?? (extracted as any).invoiceDate ?? "");
    const savedContactName = String(
      bill.extractedVendorContact?.vendorName || bill.contactName || bill.customProviderName || ""
    );
    return (
      details.invoiceName !== savedInvoiceName ||
      details.invoiceNumber !== savedInvoiceNumber ||
      details.invoiceDate !== savedInvoiceDate ||
      contactSearch !== savedContactName ||
      // contact link changed (e.g. user picked a different existing contact)
      String(selectedContactId ?? "") !== String(bill.contactId ?? "")
    );
  }, [bill, details.invoiceName, details.invoiceNumber, details.invoiceDate, contactSearch, selectedContactId]);

  useEffect(() => {
    if (bill && bill.status !== "parsing" && bill.status !== "uploading" && reparsing) {
      setReparsing(false);
    }
  }, [bill, reparsing]);

  if (!bill || (isParsing && !reparsing)) {
    return (
      <div
        style={{
          minHeight: "100vh",
          background: "#F8F9FB",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: "inherit",
          fontSize: 12,
          color: "#9EA2B0",
        }}
      >
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 11, letterSpacing: "0.05em", marginBottom: 8 }}>⏳</div>
          <div>doing things...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="page-shell">
      <NavBar
        items={[
          { label: "team-ldk", href: "/dashboard", brand: true },
          { label: "invoices", href: "/invoices" },
          { label: isEditing ? "edit" : "preview", current: true }
        ]}
      />

      <main className="page-main">
        <Link href="/invoices" className="ui-back-link">← cd /invoices</Link>

        <section className={styles.previewLayout}>
          <div className={styles.previewDetails}>
            {reparsing && isParsing ? (
              <div className={styles.card} style={{ background: "rgba(74,91,219,0.06)", borderColor: "#4A5BDB", textAlign: "center", padding: "20px 16px" }}>
                <div style={{ fontSize: 11, letterSpacing: "0.05em", marginBottom: 6, color: "#4A5BDB" }}>⏳</div>
                <div style={{ fontSize: 12, color: "#4A5BDB", fontWeight: 600 }}>doing things...</div>
              </div>
            ) : null}

            {/* Combined contact + invoice details. Always-editable inline form —
                no view/edit toggle. Save + cancel only appear when there are
                unsaved changes vs the bill's current values. */}
            <div className={styles.detailsCard}>
              <div className={styles.cardHeader}>
                <div className={styles.cardTitle}>invoice details</div>
                <div className={styles.cardHeaderActions}>
                  <button
                    type="button"
                    className={styles.changeLink}
                    onClick={onReparseBill}
                    disabled={reparsing || !!isParsing}
                    title="Re-run the bill parser on this invoice"
                  >
                    {reparsing || isParsing ? "re-parsing..." : "re-parse"}
                  </button>
                </div>
              </div>

              <div className={styles.detailsStack}>
                {/* 1. Invoice Name (required, blank by default — no autofill on upload/email) */}
                <div>
                  <div className={styles.label}>INVOICE NAME *</div>
                  <input
                    className={styles.inputCompact}
                    value={details.invoiceName}
                    onChange={(e) => setDetails((prev) => ({ ...prev, invoiceName: e.target.value }))}
                    placeholder="e.g. Hagyard Pharmacy — Apr 27, 2026"
                  />
                </div>

                {/* 2. Invoice Date (required, pre-populated) */}
                <div>
                  <div className={styles.label}>INVOICE DATE *</div>
                  <input
                    type="date"
                    className={styles.inputCompact}
                    value={toIsoDateInputValue(details.invoiceDate)}
                    onChange={(e) => setDetails((prev) => ({ ...prev, invoiceDate: e.target.value }))}
                  />
                </div>

                {/* 3. Invoice # (optional, pre-populated) */}
                <div>
                  <div className={styles.label}>INVOICE #</div>
                  <input
                    className={styles.inputCompact}
                    value={details.invoiceNumber}
                    onChange={(e) => setDetails((prev) => ({ ...prev, invoiceNumber: e.target.value }))}
                  />
                </div>

                {/* 4. Contact (required, pre-populated, typeahead) */}
                <div style={{ position: "relative" }}>
                  <div className={styles.label}>CONTACT *</div>
                  <input
                    className={styles.inputCompact}
                    value={contactSearch}
                    onChange={(e) => {
                      setContactSearch(e.target.value);
                      setContactForm((p) => ({ ...p, name: e.target.value }));
                      setSelectedContactId(null);
                      setShowContactSuggestions(true);
                    }}
                    onFocus={() => setShowContactSuggestions(true)}
                    placeholder="search or type contact name..."
                    autoComplete="off"
                  />
                  {showContactSuggestions && contactSuggestions.length > 0 && (
                    <div className={styles.contactSuggestions}>
                      {contactSuggestions.map((c) => (
                        <button
                          key={String(c._id)}
                          type="button"
                          className={styles.contactSuggestionItem}
                          onMouseDown={(e) => { e.preventDefault(); selectExistingContact(c); }}
                        >
                          <span className={styles.contactSuggestionName}>{c.name}</span>
                          {c.email ? <span className={styles.contactSuggestionMeta}>{c.email}</span> : null}
                          {c.category ? <span className={styles.contactSuggestionMeta}>{c.category}</span> : null}
                        </button>
                      ))}
                    </div>
                  )}
                  {selectedContactId && (
                    <div style={{ fontSize: 9, color: "#22C583", marginTop: 2 }}>✓ linked to existing contact</div>
                  )}
                </div>
              </div>

              {detailsDirty ? (
                <div className={styles.rowActions}>
                  <button
                    type="button"
                    className="ui-button-outlined"
                    onClick={() => {
                      // Revert local form state to what's on the bill.
                      const extracted = (bill?.extractedData ?? {}) as Record<string, unknown>;
                      setDetails((prev) => ({
                        ...prev,
                        invoiceName: String(bill?.invoiceName ?? ""),
                        invoiceNumber: String((extracted as any).invoice_number ?? (extracted as any).invoiceNumber ?? ""),
                        invoiceDate: String((extracted as any).invoice_date ?? (extracted as any).invoiceDate ?? ""),
                      }));
                      const billContactName = bill?.extractedVendorContact?.vendorName || (bill?.contactName ?? bill?.customProviderName ?? "");
                      setContactSearch(billContactName);
                      setContactForm((p) => ({ ...p, name: billContactName }));
                      setSelectedContactId(bill?.contactId ?? null);
                      setShowContactSuggestions(false);
                    }}
                  >
                    cancel
                  </button>
                  <button
                    type="button"
                    className="ui-button-filled"
                    disabled={savingDetails || savingContact || !details.invoiceName.trim() || !details.invoiceDate.trim() || !contactSearch.trim()}
                    onClick={() => void onSaveCombinedDetails()}
                  >
                    {savingDetails || savingContact ? "saving..." : "save"}
                  </button>
                </div>
              ) : null}

              <div className={styles.totalBlock}>
                <div className={styles.label}>TOTAL</div>
                <div className={styles.totalValue}>{formatUsd(Number(details.totalUsd || total))}</div>
              </div>

              {/* Manual currency override. Use when the PDF doesn't make it
                  clear what currency it's in (common with CAD invoices that
                  only show "$"). Picking CAD/EUR/GBP multiplies every amount
                  on the bill by the rate to land in USD. Re-parse the bill
                  to reset to the parsed values. */}
              <div className={styles.currencyOverride}>
                <div className={styles.currencyOverrideHeader}>
                  <span className={styles.label}>CONVERT TO USD FROM</span>
                  {(bill as any)?.originalCurrency && (bill as any).originalCurrency !== "USD" ? (
                    <span className={styles.currencyAppliedTag}>
                      converted from {(bill as any).originalCurrency}
                      {typeof (bill as any).exchangeRate === "number"
                        ? ` @ ${(bill as any).exchangeRate}`
                        : ""}
                    </span>
                  ) : null}
                </div>
                <div className={styles.currencyOverrideRow}>
                  <select
                    className={styles.inputCompact}
                    value={convertFromCurrency}
                    onChange={(e) => setConvertFromCurrency(e.target.value as "USD" | "CAD" | "EUR" | "GBP")}
                  >
                    <option value="USD">USD (no conversion)</option>
                    <option value="CAD">CAD (Canadian Dollar)</option>
                    <option value="EUR">EUR (Euro)</option>
                    <option value="GBP">GBP (British Pound)</option>
                  </select>
                  <button
                    type="button"
                    className="ui-button-filled"
                    disabled={convertingCurrency || convertFromCurrency === "USD"}
                    onClick={() => void onConvertCurrency()}
                    title={
                      convertFromCurrency === "USD"
                        ? "Pick a source currency first"
                        : `Multiply every amount on this bill by the ${convertFromCurrency}→USD rate.`
                    }
                  >
                    {convertingCurrency ? "converting..." : "convert"}
                  </button>
                </div>
              </div>

              {bill?.createdBy ? (
                <div className={styles.createdByRow}>
                  <span className={styles.createdByLabel}>CREATED BY</span>
                  <span className={styles.createdByValue}>{bill.createdBy}</span>
                </div>
              ) : null}
            </div>

            <div className={styles.lineItemsCard}>
              <div className={styles.cardHeader}>
                <div>
                  <div className={styles.cardTitle}>line items</div>
                  <div className={styles.cardMeta}>{lineItems.length} items · {formatUsd(total)}</div>
                </div>
                {requiresAssignment ? (
                  <div className={styles.headerToggleRow}>
                    <div className={styles.modeToggle}>
                      <button type="button" className={mode === "line" ? styles.modeToggleActive : styles.modeToggleInactive} onClick={() => setMode("line")}>by line item</button>
                      <button type="button" className={mode === "whole" ? styles.modeToggleActive : styles.modeToggleInactive} onClick={() => setMode("whole")}>split whole invoice</button>
                    </div>
                    {/* Compact entity toggle — secondary to the mode choice */}
                    <div className={styles.entityToggleCompact}>
                      <button
                        type="button"
                        className={`${styles.entityToggleCompactBtn} ${assignType === "horse" ? styles.entityToggleCompactActive : ""}`}
                        onClick={() => switchAssignType("horse")}
                        aria-label="assign to horses"
                      >
                        🐴
                      </button>
                      <button
                        type="button"
                        className={`${styles.entityToggleCompactBtn} ${assignType === "person" ? styles.entityToggleCompactActive : ""}`}
                        onClick={() => switchAssignType("person")}
                        aria-label="assign to people"
                      >
                        👤
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>

              {mode === "line" || !requiresAssignment ? (
                <>
                  <div className={`${styles.lineHeader} ${styles.lineHeaderVet}`}>
                    <div>DESCRIPTION</div>
                    <div>{assignType === "horse" ? "HORSE" : "PERSON"}</div>
                    <div>CATEGORY</div>
                    <div>SUBCATEGORY</div>
                    <div style={{ textAlign: "right" }}>AMOUNT</div>
                    <div />
                  </div>

                  {groupedLineItems
                    ? groupedLineItems.map((group) => (
                        <div key={group.key}>
                          <div className={styles.horseGroupHeader}>
                            <div className={styles.horseGroupName}>
                              <span>{group.isSplit ? "↔" : "🐴"}</span>
                              {group.label}
                              {!group.isSplit ? <span className={styles.subLabelAuto}>auto-detected</span> : null}
                            </div>
                            <div className={styles.horseGroupTotal}>{formatUsd(group.total)}</div>
                          </div>
                          <div className={styles.horseGroupDivider} />
                          {group.rows.map((row) => renderLineRow(row.line, row.index))}
                        </div>
                      ))
                    : lineItems.map((line, index) => renderLineRow(line, index))}

                  {showAddLineItem ? (
                    <div className={styles.addLineForm}>
                      <input
                        className={styles.addLineDesc}
                        value={newLineItemDesc}
                        onChange={(e) => setNewLineItemDesc(e.target.value)}
                        placeholder="description..."
                        autoFocus
                      />
                      <input
                        className={styles.addLineAmount}
                        type="number"
                        step="0.01"
                        value={newLineItemAmount}
                        onChange={(e) => setNewLineItemAmount(e.target.value)}
                        placeholder="0.00"
                      />
                      <button
                        type="button"
                        className="ui-button-outlined"
                        onClick={() => { setShowAddLineItem(false); setNewLineItemDesc(""); setNewLineItemAmount(""); }}
                      >
                        cancel
                      </button>
                      <button
                        type="button"
                        className="ui-button-filled"
                        disabled={addingLineItem || !newLineItemAmount.trim()}
                        onClick={() => void onAddLineItem()}
                      >
                        {addingLineItem ? "adding..." : "add"}
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      className={styles.addLineButton}
                      onClick={() => setShowAddLineItem(true)}
                    >
                      + add line item
                    </button>
                  )}

                  {costBreakdown.length > 0 || businessGeneralTotal > 0 ? (
                    <div className={styles.costBreakdown}>
                      <div className={styles.breakdownTitle}>COST BREAKDOWN PER {assignType === "horse" ? "HORSE" : "PERSON"}</div>
                      {costBreakdown.map((row) => (
                        <div key={row.id} className={styles.breakdownRow}>
                          <div>{assignType === "horse" ? "🐴" : "👤"} {row.name} <span className={styles.muted}>({formatUsd(row.direct)} + {formatUsd(row.shared)} shared)</span></div>
                          <div>{formatUsd(row.total)}</div>
                        </div>
                      ))}
                      {businessGeneralTotal > 0 ? (
                        <div className={styles.businessGeneralRow}>
                          <div><span className={styles.businessGeneralIcon}>◼</span> Business general expenses</div>
                          <div>{formatUsd(businessGeneralTotal)}</div>
                        </div>
                      ) : null}
                      {previewDiscount < 0 ? (
                        <div className={styles.businessGeneralRow}>
                          <div><span className={styles.businessGeneralIcon}>◼</span> Discount</div>
                          <div>{formatUsd(previewDiscount)}</div>
                        </div>
                      ) : null}
                      <div className={styles.breakdownTotal}><span>TOTAL</span><span>{formatUsd(costBreakdown.reduce((sum, row) => sum + row.total, 0) + businessGeneralTotal + (previewDiscount < 0 ? previewDiscount : 0))}</span></div>
                    </div>
                  ) : null}

                  <div className={`${styles.assignmentStatus} ${allLineAssigned ? styles.assignmentStatusComplete : styles.assignmentStatusIncomplete}`}>
                    {allLineAssigned ? (() => {
                      const confirmedCount = lineItems.filter((_, i) => lineStates[i]?.confirmed).length;
                      const excludedCount = lineItems.length - confirmedCount;
                      return excludedCount > 0
                        ? `✓ ${confirmedCount} of ${lineItems.length} items assigned (${excludedCount} excluded)`
                        : "✓ all items assigned";
                    })() : (isEditing ? "⚠ assign checked items to save" : "⚠ assign checked items to approve")}
                  </div>
                </>
              ) : (
                <div className={styles.wholeWrap}>
                  {/* STEP 1 — split type: pick the shape of the assignment */}
                  <div className={styles.wholeStep}>
                    <div className={styles.wholeStepLabel}>
                      <span className={styles.wholeStepNum}>1</span>
                      <span>SPLIT TYPE</span>
                    </div>
                    <div className={styles.wholeAssignMode}>
                      <button type="button" className={`${styles.segmentBtn} ${wholeAssignMode === "single" ? styles.segmentBtnActive : ""}`} onClick={() => { setWholeAssignMode("single"); setWholeAssignedIds((prev) => prev.slice(0, 1)); }}>
                        {assignType === "horse" ? "one horse" : "one person"}
                      </button>
                      <button type="button" className={`${styles.segmentBtn} ${wholeAssignMode === "split" ? styles.segmentBtnActive : ""}`} onClick={() => setWholeAssignMode("split")}>
                        split across {assignType === "horse" ? "horses" : "people"}
                      </button>
                      <button type="button" className={`${styles.segmentBtn} ${wholeAssignMode === "business_general" ? styles.segmentBtnActive : ""}`} onClick={() => { setWholeAssignMode("business_general"); setWholeAssignedIds([]); setWholeAmounts({}); }}>
                        business general
                      </button>
                    </div>
                  </div>

                  {wholeAssignMode === "business_general" ? (
                    <div className={styles.wholeBusinessNote}>◼ This invoice will be recorded as a general business expense with no horse or person assignment.</div>
                  ) : null}

                  {/* STEP 2 — even or custom amounts (only shown when splitting across multiple) */}
                  {wholeAssignMode === "split" ? (
                    <div className={styles.wholeStep}>
                      <div className={styles.wholeStepLabel}>
                        <span className={styles.wholeStepNum}>2</span>
                        <span>SPLIT AMOUNTS</span>
                      </div>
                      <div className={styles.segmented}>
                        <button type="button" className={`${styles.segmentBtn} ${wholeSplitType === "even" ? styles.segmentBtnActive : ""}`} onClick={() => setWholeSplitType("even")}>even</button>
                        <button type="button" className={`${styles.segmentBtn} ${wholeSplitType === "custom" ? styles.segmentBtnActive : ""}`} onClick={() => setWholeSplitType("custom")}>custom</button>
                      </div>
                    </div>
                  ) : null}

                  {/* STEP 3 — category & subcategory */}
                  <div className={styles.wholeStep}>
                    <div className={styles.wholeStepLabel}>
                      <span className={styles.wholeStepNum}>{wholeAssignMode === "split" ? 3 : 2}</span>
                      <span>CATEGORY</span>
                    </div>
                    <div className={styles.formField}>
                      <select
                        className={styles.categorySelect}
                        value={wholeCategoryOverride}
                        onChange={(event) => { setWholeCategoryOverride(event.target.value); setWholeSubcategoryOverride(""); }}
                      >
                        <option value="">use invoice category</option>
                        {ALL_CATEGORY_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>{option.label}</option>
                        ))}
                      </select>
                    </div>
                    {SUBCATEGORY_OPTIONS[wholeCategoryOverride || categorySlug || ""] ? (
                      <div className={styles.formField}>
                        <div className={styles.label}>SUBCATEGORY</div>
                        <select
                          className={styles.categorySelect}
                          value={wholeSubcategoryOverride}
                          onChange={(event) => setWholeSubcategoryOverride(event.target.value)}
                        >
                          <option value="">—</option>
                          {(SUBCATEGORY_OPTIONS[wholeCategoryOverride || categorySlug || ""] ?? []).map((option) => (
                            <option key={option.value} value={option.value}>{option.label}</option>
                          ))}
                        </select>
                      </div>
                    ) : null}
                  </div>

                  <div className={styles.lineSummary}>
                    {lineItems.map((line, index) => (
                      <div key={index} className={styles.splitSummaryRow}><span>{line.description || `Line ${index + 1}`}</span><span>{formatUsd(getLineAmount(line))}</span></div>
                    ))}
                    <div className={styles.splitSummaryTotal}><span>TOTAL</span><span>{formatUsd(total)}</span></div>
                  </div>

                  {/* STEP 4 — select horses/people (skipped for business_general) */}
                  {wholeAssignMode !== "business_general" ? (
                    <div className={styles.wholeStep}>
                      <div className={styles.wholeStepLabel}>
                        <span className={styles.wholeStepNum}>{wholeAssignMode === "split" ? 4 : 3}</span>
                        <span>{assignType === "horse" ? "SELECT HORSES" : "SELECT PEOPLE"}</span>
                      </div>
                      <div className={styles.formField}>
                        <select
                          className={`${styles.assignSelect} ${assignType === "horse" ? styles.addEntityHorse : styles.addEntityPerson}`}
                          value=""
                          onChange={(event) => {
                            const value = event.target.value;
                            if (value === BUSINESS_GENERAL) {
                              setWholeAssignMode("business_general");
                              setWholeAssignedIds([]);
                              setWholeAmounts({});
                              return;
                            }
                            if (!value || wholeAssignedIds.includes(value)) return;
                            setWholeAssignedIds((prev) => wholeAssignMode === "single" ? [value] : [...prev, value]);
                          }}
                        >
                          <option value="">+ add {assignType === "horse" ? "horse" : "person"}...</option>
                          {entityList
                            .filter((entry) => !wholeAssignedIds.includes(String(entry._id)))
                            .map((entry) => (
                              <option key={entry._id} value={entry._id}>{entry.name}</option>
                            ))}
                        </select>
                      </div>
                    </div>
                  ) : null}

                  {wholeAssignMode !== "business_general" ? wholeAssignedIds.map((id, index) => {
                    const entry = entityList.find((row) => String(row._id) === id);
                    const evenAmounts = splitEven(total, wholeAssignedIds.length);
                    const amount = wholeAssignMode === "single" ? total : (wholeSplitType === "even" ? evenAmounts[index] ?? 0 : Number(wholeAmounts[id] || 0));
                    const entryName = entry?.name
                      ?? (assignType === "horse" ? horseNameById.get(id) : undefined)
                      ?? "Unknown";
                    return (
                      <div key={id} className={styles.wholeRow}>
                        <div>{assignType === "horse" ? "🐴" : "👤"} {entryName}</div>
                        <div className={styles.wholeAmountWrap}>
                          {wholeAssignMode === "split" && wholeSplitType === "custom" ? (
                            <input
                              className={styles.wholeAmountInput}
                              value={wholeAmounts[id] || ""}
                              onChange={(event) => setWholeAmounts((prev) => ({ ...prev, [id]: event.target.value }))}
                            />
                          ) : (
                            <span className={styles.lineAmount}>{formatUsd(amount)}</span>
                          )}
                          <button
                            type="button"
                            className={styles.removeBtn}
                            onClick={() => {
                              setWholeAssignedIds((prev) => prev.filter((row) => row !== id));
                              setWholeAmounts((prev) => {
                                const next = { ...prev };
                                delete next[id];
                                return next;
                              });
                            }}
                          >
                            ✕
                          </button>
                        </div>
                      </div>
                    );
                  }) : null}

                  {wholeAssignMode !== "business_general" && wholeAssignedIds.length > 0 ? (
                    <div className={`${styles.balanceIndicator} ${wholeBalanced ? styles.balanceOk : styles.balanceBad}`}>
                      <span>assigned</span>
                      <span>{formatUsd(wholeTotalAssigned)} / {formatUsd(total)}</span>
                    </div>
                  ) : null}
                </div>
              )}
            </div>

            <div className={styles.detailsCard}>
              <div className={styles.cardTitle} style={{ marginBottom: 12 }}>notes</div>
              <textarea
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                onBlur={() => void saveNotesIfNeeded()}
                placeholder="add notes about this invoice..."
                className={styles.notesTextarea}
              />
              <div className={styles.notesFooter}>
                <span className={styles.notesHint}>optional</span>
                {recordSavedCount > 0 && (
                  <span className={styles.recordSavedLabel}>{recordSavedCount === 1 ? "record logged" : `${recordSavedCount} records logged`}</span>
                )}
                <button type="button" className={styles.logRecordBtn} onClick={openRecordModal}>
                  + log record
                </button>
              </div>
            </div>

            <Modal open={showRecordModal} title="log record" onClose={() => setShowRecordModal(false)}>
              <div className={styles.recordModalBody}>
                <div className={styles.recordModalField}>
                  <div className={styles.recordModalLabel}>horses *</div>
                  <div className={styles.horseChipGrid}>
                    {horses.map((h) => {
                      const id = String(h._id);
                      const selected = recordForm.horseIds.includes(id);
                      return (
                        <button
                          key={id}
                          type="button"
                          className={`${styles.horseChip} ${selected ? styles.horseChipSelected : ""}`}
                          onClick={() => setRecordForm((prev) => ({
                            ...prev,
                            horseIds: selected
                              ? prev.horseIds.filter((x) => x !== id)
                              : [...prev.horseIds, id]
                          }))}
                        >
                          {h.name}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className={styles.recordModalField}>
                  <div className={styles.recordModalLabel}>date *</div>
                  <input
                    type="date"
                    className={styles.recordModalInput}
                    value={recordForm.date}
                    onChange={(e) => setRecordForm((prev) => ({ ...prev, date: e.target.value }))}
                  />
                </div>

                <div className={styles.recordModalField}>
                  <div className={styles.recordModalLabel}>record type *</div>
                  <select
                    className={styles.recordModalSelect}
                    value={recordForm.recordType}
                    onChange={(e) => setRecordForm((prev) => ({
                      ...prev,
                      recordType: e.target.value as RecordType,
                      visitType: "",
                      vaccineName: "",
                      treatmentDescription: "",
                      serviceType: "",
                      customType: ""
                    }))}
                  >
                    <option value="veterinary">veterinary</option>
                    <option value="medication">medication</option>
                    <option value="farrier">farrier</option>
                    <option value="bodywork">bodywork</option>
                    <option value="other">other</option>
                  </select>
                </div>

                {recordForm.recordType === "veterinary" && (
                  <div className={styles.recordModalField}>
                    <div className={styles.recordModalLabel}>visit type</div>
                    <select
                      className={styles.recordModalSelect}
                      value={recordForm.visitType}
                      onChange={(e) => setRecordForm((prev) => ({ ...prev, visitType: e.target.value as RecordFormState["visitType"] }))}
                    >
                      <option value="">select</option>
                      <option value="vaccination">vaccination</option>
                      <option value="treatment">treatment</option>
                      <option value="exams_diagnostics">exam</option>
                      <option value="other">other</option>
                    </select>
                  </div>
                )}

                {recordForm.recordType === "veterinary" && recordForm.visitType === "vaccination" && (
                  <div className={styles.recordModalField}>
                    <div className={styles.recordModalLabel}>vaccine name</div>
                    <input
                      className={styles.recordModalInput}
                      value={recordForm.vaccineName}
                      onChange={(e) => setRecordForm((prev) => ({ ...prev, vaccineName: e.target.value }))}
                      placeholder="e.g. rabies, flu/rhino..."
                    />
                  </div>
                )}

                {recordForm.recordType === "veterinary" && recordForm.visitType === "treatment" && (
                  <div className={styles.recordModalField}>
                    <div className={styles.recordModalLabel}>treatment description</div>
                    <input
                      className={styles.recordModalInput}
                      value={recordForm.treatmentDescription}
                      onChange={(e) => setRecordForm((prev) => ({ ...prev, treatmentDescription: e.target.value }))}
                      placeholder="describe treatment..."
                    />
                  </div>
                )}

                {recordForm.recordType === "veterinary" && (recordForm.visitType === "exams_diagnostics" || recordForm.visitType === "other") && (
                  <div className={styles.recordModalField}>
                    <div className={styles.recordModalLabel}>
                      {recordForm.visitType === "exams_diagnostics" ? "exam details" : "what happened"}
                    </div>
                    <input
                      className={styles.recordModalInput}
                      value={recordForm.treatmentDescription}
                      onChange={(e) => setRecordForm((prev) => ({ ...prev, treatmentDescription: e.target.value }))}
                      placeholder={recordForm.visitType === "exams_diagnostics" ? "e.g. lameness exam, pre-purchase..." : "describe what happened..."}
                    />
                  </div>
                )}

                {recordForm.recordType === "farrier" && (
                  <div className={styles.recordModalField}>
                    <div className={styles.recordModalLabel}>service type</div>
                    <select
                      className={styles.recordModalSelect}
                      value={recordForm.serviceType}
                      onChange={(e) => setRecordForm((prev) => ({ ...prev, serviceType: e.target.value }))}
                    >
                      <option value="">select</option>
                      <option value="Full Set">full set</option>
                      <option value="Reset">reset</option>
                      <option value="Trim">trim</option>
                      <option value="Front Only">front only</option>
                      <option value="Other">other</option>
                    </select>
                  </div>
                )}

                {recordForm.recordType === "other" && (
                  <div className={styles.recordModalField}>
                    <div className={styles.recordModalLabel}>describe type</div>
                    <input
                      className={styles.recordModalInput}
                      value={recordForm.customType}
                      onChange={(e) => setRecordForm((prev) => ({ ...prev, customType: e.target.value }))}
                      placeholder="e.g. dental, chiro..."
                    />
                  </div>
                )}

                <div className={styles.recordModalField}>
                  <div className={styles.recordModalLabel}>provider</div>
                  <input
                    className={styles.recordModalInput}
                    value={recordForm.contactName}
                    onChange={(e) => setRecordForm((prev) => ({ ...prev, contactName: e.target.value }))}
                  />
                </div>

                {recordForm.horseIds.length > 0 && (() => {
                  const previews = recordForm.horseIds.map((hId) => {
                    const horse = horses.find((h) => String(h._id) === hId);
                    return { name: horse?.name ?? "unknown", notes: buildHorseNotes(hId) };
                  }).filter((p) => p.notes);
                  if (previews.length === 0) return null;
                  return (
                    <div className={styles.recordModalField}>
                      <div className={styles.recordModalLabel}>services (auto-included)</div>
                      <div className={styles.autoNotesPreview}>
                        {previews.map((p, i) => (
                          <div key={i} className={styles.autoNotesHorse}>
                            {recordForm.horseIds.length > 1 && <div className={styles.autoNotesName}>{p.name}</div>}
                            <div className={styles.autoNotesText}>{p.notes}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })()}

                <div className={styles.recordModalField}>
                  <div className={styles.recordModalLabel}>additional notes</div>
                  <textarea
                    className={styles.recordModalTextarea}
                    value={recordForm.notes}
                    onChange={(e) => setRecordForm((prev) => ({ ...prev, notes: e.target.value }))}
                    placeholder="add any details..."
                    rows={3}
                  />
                </div>

                <div className={styles.recordModalField}>
                  <div className={styles.recordModalLabel}>attachment</div>
                  <input
                    ref={recordFileRef}
                    type="file"
                    style={{ display: "none" }}
                    onChange={(e) => {
                      const file = e.target.files?.[0] ?? null;
                      setRecordAttachment(file);
                      if (file && !recordForm.notes.trim()) {
                        const baseName = file.name.replace(/\.[^.]+$/, "").replace(/[-_]/g, " ");
                        setRecordForm((prev) => ({ ...prev, notes: prev.notes.trim() ? prev.notes : baseName }));
                      }
                    }}
                  />
                  {recordAttachment ? (
                    <div className={styles.recordAttachmentRow}>
                      <span className={styles.recordAttachmentName}>📎 {recordAttachment.name}</span>
                      <button
                        type="button"
                        className={styles.recordAttachmentRemove}
                        onClick={() => {
                          setRecordAttachment(null);
                          if (recordFileRef.current) recordFileRef.current.value = "";
                        }}
                      >
                        ✕
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      className={styles.recordAttachmentBtn}
                      onClick={() => recordFileRef.current?.click()}
                    >
                      + add attachment
                    </button>
                  )}
                </div>

                <div className={styles.recordModalActions}>
                  <button type="button" className={styles.recordModalCancel} onClick={() => setShowRecordModal(false)}>
                    cancel
                  </button>
                  <button
                    type="button"
                    className={styles.recordModalSave}
                    disabled={recordForm.horseIds.length === 0 || !recordForm.date || savingRecord}
                    onClick={() => void onSaveRecord()}
                  >
                    {savingRecord ? "saving..." : recordForm.horseIds.length > 1 ? `save ${recordForm.horseIds.length} records` : "save record"}
                  </button>
                </div>
              </div>
            </Modal>

            {linkedRecords.length > 0 && (
              <div className={styles.linkedRecordsCard}>
                <div className={styles.linkedRecordsHeader}>linked records ({linkedRecords.length})</div>
                {linkedRecords.map((rec) => (
                  <Link
                    key={String(rec._id)}
                    href={`/horses/${rec.horseId}/records`}
                    className={styles.linkedRecordRow}
                  >
                    <span className={styles.linkedRecordIcon}>
                      {rec.type === "veterinary" ? "🩺" : rec.type === "medication" ? "💊" : rec.type === "farrier" ? "🔧" : rec.type === "bodywork" ? "🦴" : "📋"}
                    </span>
                    <span className={styles.linkedRecordInfo}>
                      <span className={styles.linkedRecordName}>{rec.horseName}</span>
                      <span className={styles.linkedRecordType}>{rec.type}{rec.contactName ? ` · ${rec.contactName}` : ""}</span>
                    </span>
                    <span className={styles.linkedRecordDate}>
                      {new Date(rec.date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                    </span>
                  </Link>
                ))}
              </div>
            )}

            <div className={styles.approveCard}>
              <button type="button" className={styles.btnDelete} onClick={() => void onDelete()}>delete invoice</button>
              <div className={styles.approveRight}>
                {approveDisabled ? <div className={styles.helper}>{isEditing ? "confirm assignments to save" : "confirm assignments to approve"}</div> : null}
                <button type="button" className={styles.btnApprove} disabled={approveDisabled || approving} onClick={() => void onApprove()}>
                  {approving ? (isEditing ? "saving..." : "approving...") : (isEditing ? "save changes" : "approve invoice")}
                </button>
              </div>
            </div>

            {error ? <div className={styles.error}>{error}</div> : null}

            <div className={styles.footer}>TEAM_LDK // INVOICES // {isEditing ? "EDIT" : "PREVIEW"}</div>
          </div>

          <div className={styles.pdfPreviewPanel}>
            <div className={styles.pdfPreviewHeader}>
              <div className={styles.pdfPreviewTitle}>Preview</div>
              <div className={styles.pdfPreviewActions}>
                {previewUrl ? (
                  <a href={previewUrl} target="_blank" rel="noreferrer">open in new tab ↗</a>
                ) : null}
                <input
                  ref={pdfUploadRef}
                  type="file"
                  accept="application/pdf,.pdf,image/*"
                  style={{ display: "none" }}
                  onChange={onFileSelected}
                />
                <button
                  type="button"
                  onClick={() => pdfUploadRef.current?.click()}
                  disabled={uploadingPdf}
                >
                  {uploadingPdf ? "uploading..." : previewUrl ? "replace" : "upload file"}
                </button>
              </div>
            </div>
            {previewUrl ? (
              <PreviewContent url={previewUrl} fileName={bill.fileName} />
            ) : (
              <div className={styles.pdfPlaceholder}>
                <div className={styles.pdfPlaceholderIcon}>📄</div>
                <div className={styles.pdfPlaceholderText}>
                  No document attached to this invoice.<br />
                  Upload a PDF or image to preview here.
                </div>
                <button
                  type="button"
                  className={styles.pdfUploadBtn}
                  onClick={() => pdfUploadRef.current?.click()}
                  disabled={uploadingPdf}
                >
                  {uploadingPdf ? "uploading..." : "upload file"}
                </button>
              </div>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}

function PreviewContent({ url, fileName }: { url: string; fileName: string }) {
  const lowerName = fileName.toLowerCase();
  const isImage = /\.(png|jpe?g|gif|webp|tiff?|bmp|heic)$/.test(lowerName) ||
    /^image\//.test(lowerName);

  if (isImage) {
    return (
      <div className={styles.pdfFrame} style={{ overflow: "auto", display: "flex", alignItems: "flex-start", justifyContent: "center", padding: 16 }}>
        <img
          src={url}
          alt="Invoice attachment"
          style={{ maxWidth: "100%", height: "auto", borderRadius: 4 }}
        />
      </div>
    );
  }

  return (
    <iframe
      className={styles.pdfFrame}
      src={url}
      title="Invoice preview"
    />
  );
}

function DisplayField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className={styles.label}>{label}</div>
      <div className={styles.value}>{value}</div>
    </div>
  );
}

function InputField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <div>
      <div className={styles.label}>{label}</div>
      <input className={styles.inputCompact} value={value} onChange={(event) => onChange(event.target.value)} />
    </div>
  );
}

function getLineItems(extracted: Record<string, unknown>) {
  const value = extracted.line_items ?? extracted.lineItems;
  return Array.isArray(value) ? (value as ParsedLine[]) : [];
}

/** Coerce a parsed date string (any common shape) to "YYYY-MM-DD" so it
 *  works as the value of an <input type="date">. Returns "" if unparseable. */
function toIsoDateInputValue(value: string): string {
  if (!value) return "";
  // Already ISO yyyy-mm-dd
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  const yyyy = parsed.getFullYear();
  const mm = String(parsed.getMonth() + 1).padStart(2, "0");
  const dd = String(parsed.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function getLineAmount(line: ParsedLine) {
  return Number(line.total_usd ?? line.amount ?? 0);
}

function getTotal(extracted: Record<string, unknown>, lineItems: ParsedLine[]) {
  const fromExtracted = Number(extracted.invoice_total_usd ?? extracted.invoiceTotalUsd ?? extracted.total ?? 0);
  if (Number.isFinite(fromExtracted) && fromExtracted > 0) return round2(fromExtracted);
  return round2(lineItems.reduce((sum, line) => sum + getLineAmount(line), 0));
}

function splitEven(total: number, count: number) {
  if (!count) return [] as number[];
  const cents = Math.round(total * 100);
  const base = Math.floor(cents / count);
  const remainder = cents - base * count;
  return Array.from({ length: count }, (_, index) => (base + (index === count - 1 ? remainder : 0)) / 100);
}

function badgeStyle(slug: string) {
  const color = CATEGORY_COLORS[slug] ?? { bg: "#F0F1F5", color: "#6B7084" };
  return {
    background: color.bg,
    color: color.color
  };
}

function formatDate(value: string) {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function formatUsd(value: number) {
  const v = Number.isFinite(value) ? value : 0;
  const abs = Math.abs(v);
  const formatted = `$${abs.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  return v < 0 ? `(${formatted})` : formatted;
}

function round2(value: number) {
  return Math.round(value * 100) / 100;
}

function buildPermanentInvoicePath(bill: any) {
  // Invoices no longer have category/provider-scoped routes.
  // The preview page is the canonical location for every bill.
  const id = String(bill?._id ?? "");
  return id ? `/invoices/preview/${id}` : `/invoices`;
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)+/g, "");
}
