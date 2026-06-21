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

type AssignType = "horse" | "person" | "business";
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
/** Per-line-item assignment to a specific business (= owner). Stored in
 *  `assignees` as `BIZ_PREFIX + ownerId` so it doesn't collide with
 *  horse/person IDs in the same array. */
const BIZ_PREFIX = "biz:";
const isBizId = (id: string) => id.startsWith(BIZ_PREFIX);
const unwrapBizId = (id: string) => id.slice(BIZ_PREFIX.length);
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

/**
 * Read-only summary of an approved bill's line items + assignments. Replaces
 * the live editing controls until the user clicks "edit". For line-item
 * mode it shows each row's description, the assignee pills (resolving
 * horse/person/business names from the parent maps), and the amount. For
 * whole-invoice mode it shows the saved split (assignedHorses /
 * assignedPeople / assignedBusinesses) as a labeled list.
 */
function LockedAssignmentSummary({
  bill,
  lineItems,
  total,
  mode,
  assignType,
  horseNameById,
  peopleById,
  businessesById,
  formatUsd,
  getLineAmount,
}: {
  bill: any;
  lineItems: any[];
  total: number;
  mode: "line" | "whole";
  assignType: "horse" | "person" | "business";
  horseNameById: Map<string, string>;
  peopleById: Map<string, string>;
  businessesById: Map<string, string>;
  formatUsd: (n: number) => string;
  getLineAmount: (line: any) => number;
}) {
  const resolveName = (id: string, type: string | undefined): string => {
    if (isBizId(id)) return businessesById.get(unwrapBizId(id)) ?? "Business";
    if (type === "business") return businessesById.get(id) ?? "Business";
    if (type === "person") return peopleById.get(id) ?? "Unknown";
    return horseNameById.get(id) ?? "Unknown";
  };
  const iconFor = (type: string | undefined, id?: string): string => {
    if (id && isBizId(id)) return "🏢";
    if (type === "business") return "🏢";
    if (type === "person") return "👤";
    if (type === "business_general") return "◼";
    return "🐴";
  };

  // Whole-invoice mode: render the saved split list.
  if (mode === "whole") {
    const isBizGeneral = !bill?.assignedHorses?.length
      && !bill?.assignedPeople?.length
      && !bill?.assignedBusinesses?.length;
    if (isBizGeneral) {
      return (
        <div style={{ padding: "16px 22px" }}>
          <div style={{ color: "#6b7084", fontSize: 13 }}>
            ◼ business general — no specific horse, person, or business
          </div>
        </div>
      );
    }
    const rows: { name: string; icon: string; amount: number }[] = [
      ...(bill?.assignedHorses ?? []).map((h: any) => ({ icon: "🐴", name: h.horseName, amount: h.amount })),
      ...(bill?.assignedPeople ?? []).map((p: any) => ({ icon: "👤", name: p.personName ?? peopleById.get(String(p.personId)) ?? "Unknown", amount: p.amount })),
      ...(bill?.assignedBusinesses ?? []).map((b: any) => ({ icon: "🏢", name: b.ownerName, amount: b.amount })),
    ];
    return (
      <div style={{ padding: "8px 22px 22px" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {rows.map((row, i) => (
            <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: "1px solid #eef0f3", fontSize: 13 }}>
              <span>{row.icon} {row.name}</span>
              <span style={{ fontWeight: 600 }}>{formatUsd(row.amount)}</span>
            </div>
          ))}
          <div style={{ display: "flex", justifyContent: "space-between", padding: "10px 0 0", fontWeight: 700, fontSize: 13 }}>
            <span>TOTAL</span>
            <span>{formatUsd(total)}</span>
          </div>
        </div>
      </div>
    );
  }

  // Line-item mode: render each line with its assignment.
  return (
    <div style={{ padding: "8px 22px 22px" }}>
      <div style={{ display: "flex", flexDirection: "column" }}>
        {lineItems.map((line: any, idx: number) => {
          const amount = getLineAmount(line);
          const at = String(line.assigneeType ?? "");
          const horseIds: string[] = Array.isArray(line.horses) ? line.horses : [];
          const peopleIds: string[] = Array.isArray(line.people) ? line.people : [];
          const singleId = String(line.assigneeId ?? line.assignee ?? "").trim();

          // Detect "split in invoice" / "split all" sentinels persisted on
          // the line. When found, expand them by reading the splits array
          // from bill.splitLineItems for this lineItemIndex so the pill
          // shows the actual horse names that share the cost — not the
          // raw sentinel string (which renders as "Unknown").
          const rawIds = horseIds.length > 0
            ? horseIds.map(String)
            : peopleIds.length > 0
              ? peopleIds.map(String)
              : singleId
                ? [singleId]
                : [];
          const hasSplitSentinel = rawIds.some(
            (id) => id === "__split_invoice__" || id === "__split_all__",
          );
          let resolvedIds = rawIds;
          let splitLabel: string | null = null;
          if (hasSplitSentinel) {
            const splitEntry = (bill?.splitLineItems ?? []).find(
              (s: any) => s.lineItemIndex === idx,
            );
            const splitHorseIds: string[] = Array.isArray(splitEntry?.splits)
              ? splitEntry.splits.map((s: any) => String(s.horseId))
              : [];
            if (splitHorseIds.length > 0) {
              resolvedIds = splitHorseIds;
              // Tag the row with which kind of split this was so the user
              // can see "split in invoice" / "split all" at a glance.
              splitLabel = splitEntry?.splitType === "all"
                ? "↔ split all"
                : "↔ split in invoice";
            } else {
              resolvedIds = [];
              splitLabel = rawIds[0] === "__split_all__" ? "↔ split all" : "↔ split in invoice";
            }
          }
          const isSplitInvoice = rawIds[0] === "__split_invoice__";
          const ids = resolvedIds;
          return (
            <div key={idx} style={{ display: "grid", gridTemplateColumns: "1fr auto auto", gap: 16, alignItems: "center", padding: "10px 0", borderBottom: "1px solid #eef0f3", fontSize: 13 }}>
              <span>{line.description || `Line ${idx + 1}`}</span>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 4, justifyContent: "flex-end", alignItems: "center" }}>
                {splitLabel ? (
                  <span style={{ background: "rgba(74,91,219,0.10)", color: "#4a5bdb", padding: "2px 8px", borderRadius: 4, fontSize: 11, fontWeight: 600, marginRight: 2 }}>{splitLabel}</span>
                ) : null}
                {at === "business_general" ? (
                  <span style={{ background: "rgba(107,112,132,0.10)", color: "#6b7084", padding: "2px 8px", borderRadius: 4, fontSize: 11, fontWeight: 600 }}>◼ general</span>
                ) : ids.length === 0 ? (
                  splitLabel ? null : (
                    <span style={{ color: "#6b7084", fontSize: 11 }}>—</span>
                  )
                ) : (
                  ids.map((id) => (
                    <span key={id} style={{ background: "rgba(74,91,219,0.08)", color: "#1a1a2e", padding: "2px 8px", borderRadius: 4, fontSize: 11, fontWeight: 600 }}>
                      🐴 {resolveName(id, hasSplitSentinel ? "horse" : at)}
                    </span>
                  ))
                )}
              </div>
              <span style={{ fontWeight: 600, minWidth: 80, textAlign: "right" }}>{formatUsd(amount)}</span>
            </div>
          );
        })}
        <div style={{ display: "flex", justifyContent: "space-between", padding: "12px 0 0", fontWeight: 700, fontSize: 13 }}>
          <span>TOTAL</span>
          <span>{formatUsd(total)}</span>
        </div>
      </div>
    </div>
  );
}

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
  // Owners are surfaced as "businesses" in this flow — when the user
  // picks "🏢 businesses" the same entity-list slot pulls from here.
  const businessesRaw = useQuery(api.owners.list) ?? [];
  const businesses = useMemo(
    () =>
      businessesRaw
        .filter((o: any) => o.isActive !== false)
        .map((o: any) => ({ _id: o._id, name: o.name })),
    [businessesRaw],
  );

  // Reverse CC matching: only ask the server when there's something to ask
  // about. Skip for already-linked bills and for the brief window before
  // bill loads.
  const ccMatchSuggestions =
    useQuery(
      api.ccReconcile.findMatchingTransactionsForBill,
      bill && !((bill as any).ccTransactionId) ? { billId } : "skip",
    ) ?? [];
  const linkBillToTransaction = useMutation(api.ccReconcile.linkBillToTransaction);
  const dismissCcMatchSuggestion = useMutation(api.ccReconcile.dismissCcMatchSuggestion);
  const unlinkBillFromTransaction = useMutation(api.ccReconcile.unlinkBillFromTransaction);
  const [ccLinkBusy, setCcLinkBusy] = useState(false);

  const [vendorEdit, setVendorEdit] = useState(false);
  const [selectedCategoryId, setSelectedCategoryId] = useState<Id<"categories"> | "">("");
  const [customProviderName, setCustomProviderName] = useState("");

  const [detailsEdit, setDetailsEdit] = useState(false);
  const [details, setDetails] = useState({
    invoiceName: "",
    /** Free-form details/description shown under the invoice name on the
     *  preview and as small subtext on the invoices list. */
    invoiceDetails: "",
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
  /** Invoice-level person tags. Optional reference — does NOT drive
   *  cost-per-person breakdowns. Stored using the existing
   *  bills.assignedPeople field with isSplit=false, so the schema doesn't
   *  need to change for this MVP. */
  const [taggedPersonIds, setTaggedPersonIds] = useState<string[]>([]);
  const [taggedPeoplePickerOpen, setTaggedPeoplePickerOpen] = useState(false);
  const [taggedPeoplePickerSearch, setTaggedPeoplePickerSearch] = useState("");
  const taggedPeoplePickerRef = useRef<HTMLDivElement | null>(null);
  const [lineStates, setLineStates] = useState<Record<number, LineState>>({});
  const [openDropdownId, setOpenDropdownId] = useState<number | null>(null);
  const dropdownRefs = useRef<Record<number, HTMLDivElement | null>>({});
  /** State for the new whole-invoice multi-select picker (Step 4). */
  const [wholePickerOpen, setWholePickerOpen] = useState(false);
  const [wholePickerSearch, setWholePickerSearch] = useState("");
  const wholePickerRef = useRef<HTMLDivElement | null>(null);
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
  const saveBusinessAssignment = useMutation(api.bills.saveBusinessAssignment);
  const saveDuesAssignments = useMutation(api.bills.saveDuesAssignments);
  const approveBill = useMutation(api.bills.approveBill);
  const deleteBill = useMutation(api.bills.deleteBill);
  const deleteLineItem = useMutation(api.bills.deleteLineItem);
  const addLineItem = useMutation(api.bills.addLineItem);
  const convertBillCurrency = useMutation(api.bills.convertBillCurrency);
  const clearBillCurrencyConversion = useMutation(api.bills.clearBillCurrencyConversion);
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
      invoiceDetails: String((bill as any).invoiceDetails ?? ""),
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

    // Seed invoice-level person tags from the bill's saved assignedPeople
    // list. Works for both the new "tag" semantics (whatever's saved is a
    // tag) AND legacy person-assigned bills (people on the old bill
    // become tags on load).
    if (Array.isArray(bill.assignedPeople) && bill.assignedPeople.length > 0) {
      setTaggedPersonIds(bill.assignedPeople.map((p) => String(p.personId)));
    } else {
      setTaggedPersonIds([]);
    }

    // People are no longer an assignment type — they're tags. If an old
    // bill was saved with assignType "person", flip to "horse" on load
    // so the assignment UI is still usable. The saved assignedPeople list
    // is preserved and surfaces as the invoice-level person tags instead.
    const savedAssignType = bill.assignType as string | undefined;
    setAssignType(
      savedAssignType === "horse" || savedAssignType === "business"
        ? (savedAssignType as AssignType)
        : "horse",
    );

    const nextLineStates: Record<number, LineState> = {};
    lineItems.forEach((row, index) => {
      const matchedHorseId = String(row.matchedHorseId ?? row.matched_horse_id ?? "");
      const savedHorses = (bill.horseAssignments ?? [])
        .filter((entry) => entry.lineItemIndex === index)
        .map((entry) => entry.horseId)
        .filter(Boolean) as string[];
      const savedPerson = bill.personAssignments?.find((entry) => entry.lineItemIndex === index)?.personId;
      // Find the saved split entry for this line item and read its
      // discriminator. Treat missing splitType as "invoice" (the more
      // common case for legacy rows) UNLESS the split covered horses
      // that aren't directly assigned anywhere on the bill — that's
      // the signature of an old "split all" entry.
      const savedSplitEntry = bill.splitLineItems?.find((entry) => entry.lineItemIndex === index);
      const splitAllByParsedHorse =
        String(row.horse_name ?? row.horseName ?? "").toLowerCase().trim() === SPLIT_ALL;

      const savedAssigneeId = (row as any).assigneeId ?? (row as any).entityId;
      const savedAssigneeType = (row as any).assigneeType ?? (row as any).entityType;
      const isGeneralEntity = savedAssigneeType === "general" || savedAssigneeType === "business_general";
      const splitFromMarker =
        String(row.horse_name ?? row.horseName ?? "").toLowerCase().trim() === SPLIT_ALL
        || (Array.isArray((row as any).horses) && (row as any).horses.includes(SPLIT_ALL));

      // Resolve which sentinel to load. Explicit splitType wins; legacy
      // rows fall back to "invoice" unless we can prove "all" via the
      // horse-set comparison below.
      let splitSentinel: typeof SPLIT_ALL | typeof SPLIT_INVOICE | null = null;
      if (savedSplitEntry) {
        if (savedSplitEntry.splitType === "all") splitSentinel = SPLIT_ALL;
        else if (savedSplitEntry.splitType === "invoice") splitSentinel = SPLIT_INVOICE;
        else {
          // Legacy row: infer from data. If the split covered horses
          // that weren't directly assigned anywhere else on the bill,
          // it was the broader "split all". Otherwise (the typical
          // case) treat as "split in invoice".
          const directIds = new Set<string>();
          for (const entry of bill.horseAssignments ?? []) {
            if (entry.horseId) directIds.add(String(entry.horseId));
          }
          const splitIds = savedSplitEntry.splits.map((s) => String(s.horseId));
          const allWithinDirect = splitIds.every((id) => directIds.has(id));
          splitSentinel = allWithinDirect ? SPLIT_INVOICE : SPLIT_ALL;
        }
      } else if (splitFromMarker || splitAllByParsedHorse) {
        splitSentinel = SPLIT_ALL;
      }

      let assignees: string[] = [];
      if (splitSentinel) assignees = [splitSentinel];
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

    // Saved assignMode is the source of truth — if a prior save explicitly
    // recorded "line", honor that even if stale assignedHorses from an
    // earlier whole-mode save still linger on the row. Only fall back to
    // the assignedHorses-based heuristic when assignMode is unset.
    const savedAssignMode = (bill as any).assignMode;
    if (savedAssignMode === "line") {
      // Already set to "line" above — nothing to do.
    } else if (savedAssignMode === "whole" && bill.assignedHorses?.length) {
      setMode("whole");
      setWholeAssignedIds(bill.assignedHorses.map((entry) => String(entry.horseId)));
      setWholeAmounts(
        Object.fromEntries(bill.assignedHorses.map((entry) => [String(entry.horseId), String(entry.amount)]))
      );
      if ((bill as any).splitMode === "custom") setWholeSplitType("custom");
      else if ((bill as any).splitMode === "even") setWholeSplitType("even");
      else if (bill.assignedHorses.length > 1) {
        const amounts = bill.assignedHorses.map((h) => Math.round(h.amount * 100));
        const allSame = amounts.every((a) => a === amounts[0]);
        setWholeSplitType(allSame ? "even" : "custom");
      }
    } else if (savedAssignMode === "whole" && bill.assignedPeople?.length) {
      setMode("whole");
      setWholeAssignedIds(bill.assignedPeople.map((entry) => String(entry.personId)));
      setWholeAmounts(
        Object.fromEntries(bill.assignedPeople.map((entry) => [String(entry.personId), String(entry.amount)]))
      );
    } else if (savedAssignMode === undefined && requiresHorse && bill.assignedHorses?.length) {
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
    } else if (savedAssignMode === undefined && requiresPerson && bill.assignedPeople?.length) {
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

  /** Close the whole-invoice multi-select popover on outside-click. */
  useEffect(() => {
    if (!wholePickerOpen) return;
    const handleClick = (event: MouseEvent) => {
      const container = wholePickerRef.current;
      if (!container) {
        setWholePickerOpen(false);
        return;
      }
      if (!container.contains(event.target as Node)) {
        setWholePickerOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [wholePickerOpen]);

  /** Same for the person-tag multi-select popover. */
  useEffect(() => {
    if (!taggedPeoplePickerOpen) return;
    const handleClick = (event: MouseEvent) => {
      const container = taggedPeoplePickerRef.current;
      if (!container) {
        setTaggedPeoplePickerOpen(false);
        return;
      }
      if (!container.contains(event.target as Node)) {
        setTaggedPeoplePickerOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [taggedPeoplePickerOpen]);

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

  // After approval the line-items / assignment card flips to a read-only
  // report. The user clicks "edit" to unlock and make changes; saving
  // re-locks it. Unapproved bills are always unlocked.
  const [assignmentsUnlocked, setAssignmentsUnlocked] = useState(false);
  const assignmentsLocked = isEditing && !assignmentsUnlocked;
  // Same view/edit gate for the invoice-details card so an approved
  // invoice's fields render as read-only summary by default; clicking
  // "edit" unlocks the form and "save" re-locks it.
  const [detailsUnlocked, setDetailsUnlocked] = useState(false);
  const detailsLocked = isEditing && !detailsUnlocked;

  const entityList = (
    assignType === "horse" ? horses
      : assignType === "business" ? businesses
      : people
  ) as { _id: any; name: string }[];

  function switchAssignType(newType: AssignType) {
    if (newType === assignType) return;
    setAssignType(newType);
    // Business assignments default to "everything included" — the common
    // case is the whole invoice belongs to one LLC, so checking every
    // line item out of the gate saves the user from confirming each row.
    // Horse/person still default to unconfirmed since those need an
    // explicit per-line pick before assignment makes sense.
    const autoConfirm = newType === "business";
    setLineStates((prev) => Object.fromEntries(
      Object.entries(prev).map(([key, value]) => [
        key,
        { ...value, assignees: [], confirmed: autoConfirm, autoDetected: false }
      ])
    ));
    setWholeAssignedIds([]);
    setWholeAmounts({});
    setWholeAssignMode("split");
    // Business mode now supports BOTH whole-invoice business assignment
    // AND per-line horse/person tagging (so a business-owned invoice can
    // still feed cost-per-horse breakdowns). Don't force the mode here —
    // let the user pick.
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

      // Business assignments are exclusive — pick a business and the line
      // belongs entirely to that LLC. Clear any horse/person picks.
      if (isBizId(entityId)) {
        const already = row.assignees.includes(entityId);
        return {
          ...prev,
          [index]: {
            ...row,
            // Toggle: clicking the selected business removes it.
            assignees: already ? [] : [entityId],
            confirmed: !already,
            autoDetected: false,
          },
        };
      }

      let current = row.assignees.filter((id) => id !== SPLIT_ALL && id !== SPLIT_INVOICE && id !== BUSINESS_GENERAL && !isBizId(id));
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
              // Resolve each pill's entity from the ID, not the global
              // assignType — so a horse picked under business mode shows
              // as 🐴 (and feeds the horse cost breakdown), not 🏢.
              const isBiz = isBizId(id);
              const ownerId = isBiz ? unwrapBizId(id) : undefined;
              const isHorse = !isBiz && Boolean(horses.find((h) => String(h._id) === id));
              const isPerson = !isBiz && !isHorse && Boolean(people.find((p) => String(p._id) === id));
              const name = isBiz
                ? (businesses.find((b: any) => String(b._id) === ownerId)?.name ?? "Business")
                : isHorse
                  ? (horses.find((h) => String(h._id) === id)?.name ?? horseNameById.get(id) ?? "Unknown")
                  : isPerson
                    ? (people.find((p) => String(p._id) === id)?.name ?? "Unknown")
                    : (entityList.find((entry) => String(entry._id) === id)?.name ?? "Unknown");
              const pillClass = isBiz
                ? styles.lineHorsePillBusiness
                : isPerson
                  ? styles.lineHorsePillPerson
                  : "";
              const icon = isBiz ? "🏢 " : isPerson ? "👤 " : isHorse ? "🐴 " : "";
              return (
                <span
                  key={id}
                  className={`${styles.lineHorsePill} ${pillClass}`}
                >
                  {icon}{name}
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
              {/* Split & general options reference the *global* assignType
                  for labeling, but business mode hides the "split across
                  {entities}" rows since splitting across businesses at
                  line-item level isn't supported. */}
              {assignType !== "business" && (
                <>
                  <button type="button" className={styles.lineHorseOption} onClick={() => toggleEntityOnItem(index, SPLIT_INVOICE)}>
                    ↔ split across {assignType === "horse" ? "horses" : "people"} in this invoice
                  </button>
                  <button type="button" className={styles.lineHorseOption} onClick={() => toggleEntityOnItem(index, SPLIT_ALL)}>
                    ↔ split across ALL {assignType === "horse" ? "horses" : "people"}
                  </button>
                </>
              )}
              <button type="button" className={styles.lineHorseOption} onClick={() => toggleEntityOnItem(index, BUSINESS_GENERAL)}>◼ business general</button>
              <div className={styles.lineHorseDivider} />

              {/* Primary entity list — for horse/person assignType this is
                  the assignType's entities. For business assignType, the
                  primary list is businesses; the horses/people sections
                  below let any line still be attributed to a horse/person
                  for cost-per breakdowns. */}
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
                    <span>{assignType === "business" ? "🏢 " : ""}{entry.name}</span>
                  </button>
                );
              })}

              {/* In business mode, surface horses + people too so admin
                  invoices can still tag specific lines to a horse or
                  person for the cost-per breakdowns. */}
              {assignType === "business" && horses.length > 0 && (
                <>
                  <div className={styles.lineHorseDivider} />
                  <div className={styles.lineHorseDropdownLabel}>HORSES</div>
                  {horses.map((h) => {
                    const selected = selectedEntityIds.includes(String(h._id));
                    return (
                      <button
                        type="button"
                        key={h._id}
                        className={styles.lineHorseOption}
                        onClick={() => toggleEntityOnItem(index, String(h._id))}
                      >
                        <span>{selected ? "☑" : "☐"}</span>
                        <span>🐴 {h.name}</span>
                      </button>
                    );
                  })}
                </>
              )}
              {assignType === "business" && people.length > 0 && (
                <>
                  <div className={styles.lineHorseDivider} />
                  <div className={styles.lineHorseDropdownLabel}>PEOPLE</div>
                  {people.map((p) => {
                    const selected = selectedEntityIds.includes(String(p._id));
                    return (
                      <button
                        type="button"
                        key={p._id}
                        className={styles.lineHorseOption}
                        onClick={() => toggleEntityOnItem(index, String(p._id))}
                      >
                        <span>{selected ? "☑" : "☐"}</span>
                        <span>👤 {p.name}</span>
                      </button>
                    );
                  })}
                </>
              )}

              {/* For non-business modes, the BUSINESSES section appears at
                  the bottom (so admin lines on a horse/person invoice can
                  still target an LLC). */}
              {assignType !== "business" && businesses.length > 0 && (
                <>
                  <div className={styles.lineHorseDivider} />
                  <div className={styles.lineHorseDropdownLabel}>BUSINESSES</div>
                  {businesses.map((biz: any) => {
                    const bizKey = BIZ_PREFIX + String(biz._id);
                    const selected = row.assignees.includes(bizKey);
                    return (
                      <button
                        type="button"
                        key={biz._id}
                        className={styles.lineHorseOption}
                        onClick={() => toggleEntityOnItem(index, bizKey)}
                      >
                        <span>{selected ? "☑" : "☐"}</span>
                        <span>🏢 {biz.name}</span>
                      </button>
                    );
                  })}
                </>
              )}
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

  /**
   * Inverse of onConvertCurrency. Restores every line item and the
   * total to its pre-conversion value, clears the originalCurrency /
   * exchangeRate stamps, and snaps the selector back to USD. Used when
   * the parser auto-flagged a non-USD currency that the user later
   * realized was wrong.
   */
  async function onClearConversion() {
    if (!bill) return;
    if (!confirm("Clear the currency conversion on this invoice? Every line item and the total will be restored to the pre-conversion (parsed) values.")) return;
    setConvertingCurrency(true);
    setError("");
    try {
      await clearBillCurrencyConversion({ billId });
      setConvertFromCurrency("USD");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to clear conversion");
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

    // Save invoice fields FIRST so a contact mutation failure can't drop
    // the user's edits. Each step is wrapped in its own try so a partial
    // success is still better than nothing.
    let detailsSaved = false;
    try {
      await updatePreviewFields({
        billId,
        invoiceName: details.invoiceName || undefined,
        invoiceDetails: details.invoiceDetails || undefined,
        invoiceNumber: details.invoiceNumber || undefined,
        invoiceDate: details.invoiceDate || undefined,
      });
      detailsSaved = true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[onSaveCombinedDetails] updatePreviewFields failed:", msg);
      setError(`Failed to save invoice details: ${msg}`);
    }

    try {
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
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[onSaveCombinedDetails] updateBillContact failed:", msg);
      // Don't overwrite a details-save error if both fired.
      setError((prev) => prev || `Failed to save contact: ${msg}`);
    }

    setSavingDetails(false);
    setSavingContact(false);
    if (detailsSaved) {
      setDetailsEdit(false);
      setShowContactSuggestions(false);
      // Re-lock the card after a save on an approved bill so the user
      // lands back in the read-only summary view.
      setDetailsUnlocked(false);
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
        invoiceDetails: details.invoiceDetails || undefined,
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

      if (assignType === "business") {
        const evenlySplit = splitEven(total, wholeAssignedIds.length);
        const activeIds = wholeAssignMode === "single" ? wholeAssignedIds.slice(0, 1) : wholeAssignedIds;
        await saveBusinessAssignment({
          billId,
          isSplit: activeIds.length > 1,
          assignedBusinesses: activeIds.map((id, index) => {
            const biz = businesses.find((b) => String(b._id) === id);
            return {
              ownerId: id as Id<"owners">,
              ownerName: biz?.name ?? "Unknown",
              amount: round2(wholeSplitType === "even" ? evenlySplit[index] ?? 0 : Number(wholeAmounts[id] || 0)),
            };
          }),
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
          // Stamp which kind of split this was so the next load can tell
          // them apart — the targets alone don't distinguish "split all"
          // from "split in invoice" once the directly-assigned horse set
          // happens to equal the all-horses set.
          const splitTypeTag: "all" | "invoice" = isSplitAll ? "all" : "invoice";
          const splitAmounts = splitEven(getLineAmount(row.line), targetIds.length);
          return {
            lineItemIndex: row.index,
            splitType: splitTypeTag,
            splits: targetIds.map((horseId, idx) => {
              const horse = horses.find((entry) => String(entry._id) === horseId);
              return {
                horseId: horseId as Id<"horses">,
                horseName: horse?.name ?? "Unknown",
                amount: splitAmounts[idx] ?? 0
              };
            })
          };
        }).filter(Boolean) as Array<{ lineItemIndex: number; splitType: "all" | "invoice"; splits: Array<{ horseId: Id<"horses">; horseName: string; amount: number }> }>;

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

    // Dues-registrations per-line save path only supports horse/person/general.
    // Business is whole-invoice only (switchAssignType forces mode=whole) so
    // we should never reach here with assignType="business" — but guard anyway.
    if (assignType === "business") return;
    const lineAssignType = assignType as "horse" | "person";
    await saveDuesAssignments({
      billId,
      assignments: lineItems.map((_, index) => {
        const row = lineStates[index];
        const entityId = row?.assignees?.[0];
        const entityName =
          lineAssignType === "horse"
            ? horses.find((entry) => String(entry._id) === entityId)?.name
            : people.find((entry) => String(entry._id) === entityId)?.name;
        return {
          lineItemIndex: index,
          entityType: entityId ? lineAssignType : "none",
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

      // Persist invoice-level person tags. People are no longer an
      // assignment type — they're a tag. Reuse the existing
      // assignedPeople slot with isSplit=false and zero amount so the
      // tags don't show up in cost-per-person breakdowns by mistake.
      // Skip when assignType is "person" — that's the legacy person
      // assignment path which persistAssignments above already handled.
      if ((assignType as string) !== "person") {
        await savePersonAssignment({
          billId,
          isSplit: false,
          assignedPeople: taggedPersonIds.map((id) => ({
            personId: id as Id<"people">,
            amount: 0,
          })),
        });
      }
      const payloadLineItems = lineItems
        .map((line, index) => {
          const state = lineStates[index];
          const selectedAssignees = state?.assignees ?? [];
          const isBusinessGeneral = mode === "line" && selectedAssignees[0] === BUSINESS_GENERAL;
          const isWholeBusinessGeneral = mode === "whole" && wholeAssignMode === "business_general";

          // Resolve each line's per-line entity type by matching the raw
          // ID against horses / people / businesses sets — instead of
          // assuming the global assignType. Lets a single bill have a
          // mix of line-level horse/person/business assignments (e.g.
          // a business-owned admin invoice with one line attributed to
          // a horse for cost-per-horse tracking).
          const resolveLine = (raw: string | undefined): {
            type: "horse" | "person" | "business" | null;
            id: string | null;
            name: string | undefined;
          } => {
            if (!raw) return { type: null, id: null, name: undefined };
            if (isBizId(raw)) {
              const ownerId = unwrapBizId(raw);
              return { type: "business", id: ownerId, name: businesses.find((b: any) => String(b._id) === ownerId)?.name };
            }
            if (horses.find((h) => String(h._id) === raw)) {
              return { type: "horse", id: raw, name: horses.find((h) => String(h._id) === raw)?.name };
            }
            if (people.find((p) => String(p._id) === raw)) {
              return { type: "person", id: raw, name: people.find((p) => String(p._id) === raw)?.name };
            }
            if (businesses.find((b: any) => String(b._id) === raw)) {
              return { type: "business", id: raw, name: businesses.find((b: any) => String(b._id) === raw)?.name };
            }
            // Unknown id — fall back to global assignType so legacy data
            // still saves the same way it always did.
            return { type: assignType, id: raw, name: undefined };
          };

          const resolved = resolveLine(selectedAssignees[0]);
          // Per-line entity arrays: horses[]/people[] feed the cost-per
          // breakdowns. A single line can only contribute to one
          // breakdown at a time, but selectedAssignees can hold multiple
          // horses (or multiple people) in horse/person mode.
          const horseLineIds = selectedAssignees.filter((id) => horses.find((h) => String(h._id) === id));
          const personLineIds = selectedAssignees.filter((id) => people.find((p) => String(p._id) === id));

          return {
            ...line,
            description: line.description || `Line item ${index + 1}`,
            amount: getLineAmount(line),
            category: (mode === "whole" && wholeCategoryOverride) ? wholeCategoryOverride : (state?.category || categorySlug),
            subcategory: (mode === "whole" && wholeSubcategoryOverride) ? wholeSubcategoryOverride : (state?.subcategory || line.subcategory || null),
            subcategoryAutoDetected: Boolean(state?.subcategoryAutoDetected),
            // horses[]/people[] reflect what was actually picked, regardless
            // of the global assignType — so cost-per-horse picks up
            // horse-tagged lines on a business-owned invoice.
            horses: horseLineIds.length > 0 ? horseLineIds : undefined,
            people: personLineIds.length > 0 ? personLineIds : undefined,
            assignee: isBusinessGeneral || isWholeBusinessGeneral
              ? null
              : resolved.id ?? (selectedAssignees[0] || ""),
            assigneeType: isBusinessGeneral || isWholeBusinessGeneral
              ? "business_general"
              : resolved.type ?? assignType,
            assigneeId: isBusinessGeneral || isWholeBusinessGeneral
              ? null
              : resolved.id ?? (selectedAssignees[0] || ""),
            assigneeName: resolved.name ?? undefined,
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
      if (isEditing) {
        // Re-editing an already-approved bill: stay on the page and snap
        // the assignment card back to the locked report so the user can
        // see their saved state. No navigation.
        setAssignmentsUnlocked(false);
      } else {
        // First approval: route to the permanent invoice URL.
        router.push(buildPermanentInvoicePath(effectiveBill));
      }
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
    const savedInvoiceDetails = String((bill as any).invoiceDetails ?? "");
    const savedInvoiceNumber = String((extracted as any).invoice_number ?? (extracted as any).invoiceNumber ?? "");
    const savedInvoiceDate = String((extracted as any).invoice_date ?? (extracted as any).invoiceDate ?? "");
    const savedContactName = String(
      bill.extractedVendorContact?.vendorName || bill.contactName || bill.customProviderName || ""
    );
    return (
      details.invoiceName !== savedInvoiceName ||
      details.invoiceDetails !== savedInvoiceDetails ||
      details.invoiceNumber !== savedInvoiceNumber ||
      details.invoiceDate !== savedInvoiceDate ||
      contactSearch !== savedContactName ||
      // contact link changed (e.g. user picked a different existing contact)
      String(selectedContactId ?? "") !== String(bill.contactId ?? "")
    );
  }, [bill, details.invoiceName, details.invoiceDetails, details.invoiceNumber, details.invoiceDate, contactSearch, selectedContactId]);

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

            {/* CC reverse-match suggestion banner. Surfaces if this bill
                isn't already linked AND the server found at least one
                unmatched CC transaction with a strong-enough signal
                overlap (amount + contact keywords + date proximity). */}
            {bill && !((bill as any).ccTransactionId) && ccMatchSuggestions.length > 0 && (
              <div className={styles.ccMatchCard}>
                <div className={styles.ccMatchHeader}>
                  <span className={styles.ccMatchIcon}>💳</span>
                  <div>
                    <div className={styles.ccMatchTitle}>looks like an existing CC charge</div>
                    <div className={styles.ccMatchSubtitle}>
                      {ccMatchSuggestions.length === 1
                        ? "we found a matching credit-card transaction"
                        : `we found ${ccMatchSuggestions.length} possible credit-card matches`}
                    </div>
                  </div>
                </div>
                {ccMatchSuggestions.map((s: any) => (
                  <div key={s.transactionId} className={styles.ccMatchRow}>
                    <div className={styles.ccMatchRowMain}>
                      <div className={styles.ccMatchDesc}>{s.description}</div>
                      <div className={styles.ccMatchMeta}>
                        <span>{formatUsd(Math.abs(s.amount))}</span>
                        <span className={styles.ccMatchMetaDot}>·</span>
                        <span>{s.postingDate}</span>
                        {s.daysDiff != null && (
                          <>
                            <span className={styles.ccMatchMetaDot}>·</span>
                            <span>{s.daysDiff === 0 ? "same day" : `${s.daysDiff}d off`}</span>
                          </>
                        )}
                        <span
                          className={`${styles.ccMatchConfidence} ${
                            s.confidence === "exact"
                              ? styles.ccMatchExact
                              : s.confidence === "high"
                                ? styles.ccMatchHigh
                                : s.confidence === "medium"
                                  ? styles.ccMatchMedium
                                  : styles.ccMatchLow
                          }`}
                        >
                          {s.confidence}
                        </span>
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                      <button
                        type="button"
                        className="ui-button-filled"
                        disabled={ccLinkBusy}
                        onClick={async () => {
                          setCcLinkBusy(true);
                          try {
                            await linkBillToTransaction({
                              billId,
                              transactionId: s.transactionId,
                            });
                          } catch (err: any) {
                            alert(`Failed to link: ${err?.message ?? err}`);
                          } finally {
                            setCcLinkBusy(false);
                          }
                        }}
                      >
                        link
                      </button>
                      <button
                        type="button"
                        title="Dismiss this suggestion — don't show it again for this invoice"
                        aria-label="Dismiss this suggestion"
                        disabled={ccLinkBusy}
                        style={{
                          width: 28,
                          height: 28,
                          borderRadius: 6,
                          border: "1px solid #e6e7ed",
                          background: "#fff",
                          color: "#6B7084",
                          fontSize: 12,
                          cursor: "pointer",
                          display: "inline-flex",
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                        onClick={async () => {
                          setCcLinkBusy(true);
                          try {
                            await dismissCcMatchSuggestion({
                              billId,
                              transactionId: s.transactionId,
                            });
                          } catch (err: any) {
                            alert(`Failed to dismiss: ${err?.message ?? err}`);
                          } finally {
                            setCcLinkBusy(false);
                          }
                        }}
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Already-linked indicator + unlink action */}
            {bill && (bill as any).ccTransactionId && bill.source !== "cc_transaction" && (
              <div className={styles.ccLinkedCard}>
                <div className={styles.ccLinkedRow}>
                  <span className={styles.ccMatchIcon}>🔗</span>
                  <span>linked to a CC transaction</span>
                  <button
                    type="button"
                    className={styles.changeLink}
                    disabled={ccLinkBusy}
                    onClick={async () => {
                      if (!confirm("Unlink this invoice from its CC transaction?")) return;
                      setCcLinkBusy(true);
                      try {
                        await unlinkBillFromTransaction({ billId });
                      } catch (err: any) {
                        alert(`Failed to unlink: ${err?.message ?? err}`);
                      } finally {
                        setCcLinkBusy(false);
                      }
                    }}
                  >
                    unlink
                  </button>
                </div>
              </div>
            )}

            {/* Combined contact + invoice details. Always-editable inline form —
                no view/edit toggle. Save + cancel only appear when there are
                unsaved changes vs the bill's current values. */}
            <div className={styles.detailsCard}>
              <div className={styles.cardHeader}>
                <div className={styles.cardTitle}>
                  invoice details
                  {detailsLocked ? <span className={styles.lockedBadge} style={{ marginLeft: 8 }}>approved</span> : null}
                </div>
                <div className={styles.cardHeaderActions}>
                  {detailsLocked ? (
                    <button
                      type="button"
                      className="ui-button-outlined"
                      onClick={() => setDetailsUnlocked(true)}
                    >
                      edit
                    </button>
                  ) : (
                    <button
                      type="button"
                      className={styles.changeLink}
                      onClick={onReparseBill}
                      disabled={reparsing || !!isParsing}
                      title="Re-run the bill parser on this invoice"
                    >
                      {reparsing || isParsing ? "re-parsing..." : "re-parse"}
                    </button>
                  )}
                </div>
              </div>

              {detailsLocked ? (
                /* Read-only summary view. Each row shows the saved value or
                   a muted "—" when blank. Mirrors the field order of the
                   editable form so the layout doesn't shift on edit. */
                <div className={styles.detailsStack}>
                  <div>
                    <div className={styles.label}>INVOICE NAME</div>
                    <div className={styles.value}>
                      {details.invoiceName || (
                        <span className={styles.muted}>
                          {formatInvoiceName({ contactName: contactSearch, date: details.invoiceDate })}
                        </span>
                      )}
                    </div>
                  </div>
                  <div>
                    <div className={styles.label}>DETAILS</div>
                    <div className={styles.value}>{details.invoiceDetails || <span className={styles.muted}>—</span>}</div>
                  </div>
                  <div>
                    <div className={styles.label}>INVOICE DATE</div>
                    <div className={styles.value}>{details.invoiceDate || <span className={styles.muted}>—</span>}</div>
                  </div>
                  <div>
                    <div className={styles.label}>INVOICE #</div>
                    <div className={styles.value}>{details.invoiceNumber || <span className={styles.muted}>—</span>}</div>
                  </div>
                  <div>
                    <div className={styles.label}>CONTACT</div>
                    <div className={styles.value}>{contactSearch || <span className={styles.muted}>—</span>}</div>
                  </div>
                </div>
              ) : (
              <>
              <div className={styles.detailsStack}>
                {/* 1. Invoice Name (optional — defaults to "Provider - Date"
                    when blank, computed on display via formatInvoiceName). */}
                <div>
                  <div className={styles.label}>INVOICE NAME</div>
                  <input
                    className={styles.inputCompact}
                    value={details.invoiceName}
                    onChange={(e) => setDetails((prev) => ({ ...prev, invoiceName: e.target.value }))}
                    placeholder={`defaults to "${contactSearch || "provider"} - ${details.invoiceDate || "date"}"`}
                  />
                </div>

                {/* 1a. Invoice Details — free-form subtitle. Shown on the
                    main invoices list as small subtext under the name. */}
                <div>
                  <div className={styles.label}>DETAILS</div>
                  <input
                    className={styles.inputCompact}
                    value={details.invoiceDetails}
                    onChange={(e) => setDetails((prev) => ({ ...prev, invoiceDetails: e.target.value }))}
                    placeholder="optional description shown as subtext on the invoices list"
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

              {error ? (
                <div style={{ marginTop: 8, fontSize: 12, color: "#dc2626", padding: "8px 12px", background: "rgba(220, 38, 38, 0.08)", borderRadius: 6 }}>
                  {error}
                </div>
              ) : null}
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
                        invoiceDetails: String((bill as any)?.invoiceDetails ?? ""),
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
                    /* invoiceName is now optional — when blank the display
                       falls back to "{provider} - {date}". So only date +
                       contact are required for save. */
                    disabled={savingDetails || savingContact || !details.invoiceDate.trim() || !contactSearch.trim()}
                    onClick={() => void onSaveCombinedDetails()}
                  >
                    {savingDetails || savingContact ? "saving..." : "save"}
                  </button>
                </div>
              ) : null}
              </>
              )}

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
                {/* Clear-conversion button. Visible only when a non-USD
                    conversion is currently applied to this bill. */}
                {(bill as any)?.originalCurrency && (bill as any).originalCurrency !== "USD" ? (
                  <div className={styles.currencyOverrideRow} style={{ marginTop: 8 }}>
                    <button
                      type="button"
                      className="ui-button-outlined"
                      disabled={convertingCurrency}
                      onClick={() => void onClearConversion()}
                      title="Restore every amount to the pre-conversion value the parser extracted, and remove the converted-from tag."
                    >
                      {convertingCurrency ? "clearing..." : "clear conversion"}
                    </button>
                  </div>
                ) : null}
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
                  <div className={styles.cardMeta}>
                    {lineItems.length} items · {formatUsd(total)}
                    {assignmentsLocked ? (
                      <span className={styles.lockedBadge}>approved</span>
                    ) : null}
                  </div>
                </div>
                {/* When approved and locked: show edit button instead of toggles. */}
                {assignmentsLocked ? (
                  <div className={styles.headerToggleRow}>
                    <button
                      type="button"
                      className="ui-button-outlined"
                      onClick={() => setAssignmentsUnlocked(true)}
                    >
                      edit
                    </button>
                  </div>
                ) : requiresAssignment ? (
                  <div className={styles.headerToggleRow}>
                    <div className={styles.modeToggle}>
                      <button type="button" className={mode === "line" ? styles.modeToggleActive : styles.modeToggleInactive} onClick={() => setMode("line")}>by line item</button>
                      <button type="button" className={mode === "whole" ? styles.modeToggleActive : styles.modeToggleInactive} onClick={() => setMode("whole")}>split whole invoice</button>
                    </div>
                    {/* Compact entity toggle — invoices and line items
                        are assignable to horses or businesses. People
                        moved out of assignment and live in the separate
                        "TAG PEOPLE" section further down. */}
                    <div className={styles.entityToggleCompact}>
                      <button
                        type="button"
                        className={`${styles.entityToggleCompactBtn} ${assignType === "horse" ? styles.entityToggleCompactActive : ""}`}
                        onClick={() => switchAssignType("horse")}
                        aria-label="assign to horses"
                        title="horses"
                      >
                        🐴
                      </button>
                      <button
                        type="button"
                        className={`${styles.entityToggleCompactBtn} ${assignType === "business" ? styles.entityToggleCompactActive : ""}`}
                        onClick={() => switchAssignType("business")}
                        aria-label="assign to businesses"
                        title="businesses"
                      >
                        🏢
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>

              {assignmentsLocked ? (
                <LockedAssignmentSummary
                  bill={bill}
                  lineItems={lineItems}
                  total={total}
                  mode={mode}
                  assignType={assignType}
                  horseNameById={horseNameById}
                  peopleById={new Map(people.map((p) => [String(p._id), p.name]))}
                  businessesById={new Map(businesses.map((b: any) => [String(b._id), b.name]))}
                  formatUsd={formatUsd}
                  getLineAmount={getLineAmount}
                />
              ) : mode === "line" || !requiresAssignment ? (
                <>
                  <div className={`${styles.lineHeader} ${styles.lineHeaderVet}`}>
                    <div>DESCRIPTION</div>
                    <div>{assignType === "horse" ? "HORSE" : assignType === "business" ? "BUSINESS" : "PERSON"}</div>
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
                      <div className={styles.breakdownTitle}>COST BREAKDOWN PER {assignType === "horse" ? "HORSE" : assignType === "business" ? "BUSINESS" : "PERSON"}</div>
                      {costBreakdown.map((row) => (
                        <div key={row.id} className={styles.breakdownRow}>
                          <div>{assignType === "horse" ? "🐴" : assignType === "business" ? "🏢" : "👤"} {row.name} <span className={styles.muted}>({formatUsd(row.direct)} + {formatUsd(row.shared)} shared)</span></div>
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
                        {assignType === "horse" ? "one horse" : assignType === "business" ? "one business" : "one person"}
                      </button>
                      <button type="button" className={`${styles.segmentBtn} ${wholeAssignMode === "split" ? styles.segmentBtnActive : ""}`} onClick={() => setWholeAssignMode("split")}>
                        split across {assignType === "horse" ? "horses" : assignType === "business" ? "businesses" : "people"}
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

                  {/* STEP 4 — select horses/people/businesses (skipped for business_general) */}
                  {wholeAssignMode !== "business_general" ? (
                    <div className={styles.wholeStep}>
                      <div className={styles.wholeStepLabel}>
                        <span className={styles.wholeStepNum}>{wholeAssignMode === "split" ? 4 : 3}</span>
                        <span>
                          {assignType === "horse"
                            ? "SELECT HORSES"
                            : assignType === "business"
                              ? "SELECT BUSINESSES"
                              : "SELECT PEOPLE"}
                        </span>
                      </div>
                      <div className={styles.formField} ref={wholePickerRef} style={{ position: "relative" }}>
                        {(() => {
                          const entityLabel = assignType === "horse" ? "horse" : assignType === "business" ? "business" : "person";
                          const entityLabelPlural = assignType === "horse" ? "horses" : assignType === "business" ? "businesses" : "people";
                          const isSingle = wholeAssignMode === "single";
                          const selectedCount = wholeAssignedIds.length;
                          const filtered = entityList.filter((entry) =>
                            !wholePickerSearch.trim()
                              ? true
                              : entry.name.toLowerCase().includes(wholePickerSearch.trim().toLowerCase()),
                          );
                          const toggleEntity = (id: string) => {
                            setWholeAssignedIds((prev) => {
                              if (isSingle) {
                                // Single mode: behaves like a radio. Picking
                                // replaces the selection; picking the same
                                // entity again clears it.
                                if (prev[0] === id) return [];
                                setWholePickerOpen(false);
                                return [id];
                              }
                              return prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id];
                            });
                          };
                          return (
                            <>
                              <button
                                type="button"
                                className={`${styles.assignSelect} ${assignType === "horse" ? styles.addEntityHorse : styles.addEntityPerson}`}
                                style={{ display: "flex", alignItems: "center", justifyContent: "space-between", textAlign: "left" }}
                                onClick={() => setWholePickerOpen((v) => !v)}
                              >
                                <span>
                                  {selectedCount === 0
                                    ? `+ add ${entityLabel}${isSingle ? "" : "(s)"}...`
                                    : isSingle
                                      ? "change selection"
                                      : `add more ${entityLabelPlural}... (${selectedCount} picked)`}
                                </span>
                                <span style={{ fontSize: 10, opacity: 0.7, marginLeft: 8 }}>▾</span>
                              </button>
                              {wholePickerOpen ? (
                                <div
                                  style={{
                                    position: "absolute",
                                    top: "100%",
                                    left: 0,
                                    right: 0,
                                    marginTop: 4,
                                    background: "#fff",
                                    border: "1px solid #e6e7ed",
                                    borderRadius: 8,
                                    boxShadow: "0 6px 18px rgba(15, 23, 42, 0.08)",
                                    zIndex: 50,
                                    maxHeight: 340,
                                    overflowY: "auto",
                                  }}
                                >
                                  <div style={{ padding: 8, borderBottom: "1px solid #f1f2f5", position: "sticky", top: 0, background: "#fff" }}>
                                    <input
                                      type="text"
                                      value={wholePickerSearch}
                                      onChange={(e) => setWholePickerSearch(e.target.value)}
                                      placeholder={`search ${entityLabelPlural}...`}
                                      style={{ width: "100%", padding: "6px 8px", border: "1px solid #e6e7ed", borderRadius: 6, fontSize: 12 }}
                                      autoFocus
                                    />
                                  </div>
                                  {filtered.length === 0 ? (
                                    <div style={{ padding: 12, fontSize: 12, color: "#6B7084" }}>no matches</div>
                                  ) : (
                                    filtered.map((entry) => {
                                      const id = String(entry._id);
                                      const selected = wholeAssignedIds.includes(id);
                                      return (
                                        <button
                                          key={id}
                                          type="button"
                                          onClick={() => toggleEntity(id)}
                                          style={{
                                            display: "flex",
                                            alignItems: "center",
                                            gap: 8,
                                            width: "100%",
                                            padding: "8px 12px",
                                            background: selected ? "rgba(74, 91, 219, 0.06)" : "transparent",
                                            border: "none",
                                            cursor: "pointer",
                                            textAlign: "left",
                                            fontSize: 13,
                                            color: "#1a1a2e",
                                          }}
                                          onMouseEnter={(e) => {
                                            if (!selected) (e.currentTarget as HTMLElement).style.background = "#f5f6f9";
                                          }}
                                          onMouseLeave={(e) => {
                                            if (!selected) (e.currentTarget as HTMLElement).style.background = "transparent";
                                          }}
                                        >
                                          <span style={{ width: 16, display: "inline-flex", justifyContent: "center" }}>
                                            {isSingle ? (selected ? "●" : "○") : (selected ? "☑" : "☐")}
                                          </span>
                                          <span style={{ flex: 1 }}>{entry.name}</span>
                                        </button>
                                      );
                                    })
                                  )}
                                  {!isSingle && selectedCount > 0 ? (
                                    <div style={{ padding: 8, borderTop: "1px solid #f1f2f5", display: "flex", justifyContent: "space-between", gap: 8, position: "sticky", bottom: 0, background: "#fff" }}>
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setWholeAssignedIds([]);
                                          setWholeAmounts({});
                                        }}
                                        style={{ fontSize: 11, color: "#dc2626", background: "transparent", border: "none", cursor: "pointer" }}
                                      >
                                        clear all
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => setWholePickerOpen(false)}
                                        style={{ fontSize: 11, color: "#1a1a2e", background: "transparent", border: "none", cursor: "pointer", fontWeight: 600 }}
                                      >
                                        done
                                      </button>
                                    </div>
                                  ) : null}
                                </div>
                              ) : null}
                            </>
                          );
                        })()}
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
                        <div>{assignType === "horse" ? "🐴" : assignType === "business" ? "🏢" : "👤"} {entryName}</div>
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

            {/* TAG PEOPLE (optional, invoice-level). People are a reference
                tag, not an assignment — they don't drive the cost-per
                breakdown. Stored via the existing bill.assignedPeople
                slot so no schema change was needed. Available in both
                line-item and whole-invoice modes. */}
            <div className={styles.detailsCard}>
              <div className={styles.cardHeader}>
                <div>
                  <div className={styles.cardTitle}>tag people</div>
                  <div className={styles.cardMeta}>
                    optional · {taggedPersonIds.length === 0 ? "no people tagged" : `${taggedPersonIds.length} tagged`}
                  </div>
                </div>
              </div>
              <div style={{ padding: "12px 22px 22px" }}>
                <div ref={taggedPeoplePickerRef} style={{ position: "relative" }}>
                  {(() => {
                    const filtered = (people as { _id: any; name: string }[]).filter((p) =>
                      !taggedPeoplePickerSearch.trim()
                        ? true
                        : p.name.toLowerCase().includes(taggedPeoplePickerSearch.trim().toLowerCase()),
                    );
                    const togglePerson = (id: string) => {
                      setTaggedPersonIds((prev) =>
                        prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
                      );
                    };
                    return (
                      <>
                        <button
                          type="button"
                          className={styles.assignSelect}
                          style={{ display: "flex", alignItems: "center", justifyContent: "space-between", textAlign: "left" }}
                          onClick={() => setTaggedPeoplePickerOpen((v) => !v)}
                        >
                          <span>
                            {taggedPersonIds.length === 0
                              ? "+ tag a person..."
                              : `add or remove people... (${taggedPersonIds.length} tagged)`}
                          </span>
                          <span style={{ fontSize: 10, opacity: 0.7, marginLeft: 8 }}>▾</span>
                        </button>
                        {taggedPeoplePickerOpen ? (
                          <div
                            style={{
                              position: "absolute",
                              top: "100%",
                              left: 0,
                              right: 0,
                              marginTop: 4,
                              background: "#fff",
                              border: "1px solid #e6e7ed",
                              borderRadius: 8,
                              boxShadow: "0 6px 18px rgba(15, 23, 42, 0.08)",
                              zIndex: 50,
                              maxHeight: 340,
                              overflowY: "auto",
                            }}
                          >
                            <div style={{ padding: 8, borderBottom: "1px solid #f1f2f5", position: "sticky", top: 0, background: "#fff" }}>
                              <input
                                type="text"
                                value={taggedPeoplePickerSearch}
                                onChange={(e) => setTaggedPeoplePickerSearch(e.target.value)}
                                placeholder="search people..."
                                style={{ width: "100%", padding: "6px 8px", border: "1px solid #e6e7ed", borderRadius: 6, fontSize: 12 }}
                                autoFocus
                              />
                            </div>
                            {filtered.length === 0 ? (
                              <div style={{ padding: 12, fontSize: 12, color: "#6B7084" }}>no matches</div>
                            ) : (
                              filtered.map((p) => {
                                const id = String(p._id);
                                const selected = taggedPersonIds.includes(id);
                                return (
                                  <button
                                    key={id}
                                    type="button"
                                    onClick={() => togglePerson(id)}
                                    style={{
                                      display: "flex",
                                      alignItems: "center",
                                      gap: 8,
                                      width: "100%",
                                      padding: "8px 12px",
                                      background: selected ? "rgba(74, 91, 219, 0.06)" : "transparent",
                                      border: "none",
                                      cursor: "pointer",
                                      textAlign: "left",
                                      fontSize: 13,
                                      color: "#1a1a2e",
                                    }}
                                  >
                                    <span style={{ width: 16, display: "inline-flex", justifyContent: "center" }}>
                                      {selected ? "☑" : "☐"}
                                    </span>
                                    <span style={{ flex: 1 }}>👤 {p.name}</span>
                                  </button>
                                );
                              })
                            )}
                            {taggedPersonIds.length > 0 ? (
                              <div style={{ padding: 8, borderTop: "1px solid #f1f2f5", display: "flex", justifyContent: "space-between", gap: 8, position: "sticky", bottom: 0, background: "#fff" }}>
                                <button
                                  type="button"
                                  onClick={() => setTaggedPersonIds([])}
                                  style={{ fontSize: 11, color: "#dc2626", background: "transparent", border: "none", cursor: "pointer" }}
                                >
                                  clear all
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setTaggedPeoplePickerOpen(false)}
                                  style={{ fontSize: 11, color: "#1a1a2e", background: "transparent", border: "none", cursor: "pointer", fontWeight: 600 }}
                                >
                                  done
                                </button>
                              </div>
                            ) : null}
                          </div>
                        ) : null}
                      </>
                    );
                  })()}
                </div>
                {taggedPersonIds.length > 0 ? (
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 10 }}>
                    {taggedPersonIds.map((id) => {
                      const name = (people as { _id: any; name: string }[]).find((p) => String(p._id) === id)?.name ?? "Unknown";
                      return (
                        <span
                          key={id}
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 4,
                            fontSize: 11,
                            padding: "4px 8px",
                            background: "rgba(236, 72, 153, 0.08)",
                            color: "#ec4899",
                            borderRadius: 6,
                            fontWeight: 600,
                          }}
                        >
                          👤 {name}
                          <button
                            type="button"
                            onClick={() => setTaggedPersonIds((prev) => prev.filter((x) => x !== id))}
                            style={{ background: "transparent", border: "none", color: "#ec4899", cursor: "pointer", padding: 0, fontSize: 11 }}
                            aria-label={`remove ${name} tag`}
                          >
                            ✕
                          </button>
                        </span>
                      );
                    })}
                  </div>
                ) : null}
              </div>
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
  // Authoritative content-type via HEAD request — bill.fileName loses its
  // extension once markDone rebuilds it after parsing, so filename-only
  // heuristics were misclassifying parsed image bills as PDFs.
  const [serverContentType, setServerContentType] = useState<string | null>(null);
  // onError fallback for the <img> render — if the browser can't decode
  // the response as an image, swap to an iframe so the user at least sees
  // *something* (and the open-in-new-tab link still works).
  const [imageFailed, setImageFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setServerContentType(null);
    setImageFailed(false);
    fetch(url, { method: "HEAD" })
      .then((r) => {
        if (cancelled) return;
        setServerContentType(r.headers.get("content-type"));
      })
      .catch(() => {
        // Ignore — fall back to filename heuristic below.
      });
    return () => {
      cancelled = true;
    };
  }, [url]);

  const lowerName = (fileName || "").toLowerCase();
  const ct = (serverContentType ?? "").toLowerCase();
  const isImageByCt = ct.startsWith("image/");
  const isPdfByCt = ct.startsWith("application/pdf");
  // Permissive filename hint — extension can be anywhere in the name now
  // (after markDone reformats it). Looks for `.png` as a token boundary
  // so "team-png-receipts" doesn't false-match.
  const isImageByName = /\.(png|jpe?g|gif|webp|tiff?|bmp|heic|avif)(\b|$|[?#])/i.test(lowerName);

  const renderImage = !imageFailed && (isImageByCt || (!isPdfByCt && isImageByName));

  if (renderImage) {
    return (
      <div className={styles.pdfFrame} style={{ overflow: "auto", display: "flex", alignItems: "flex-start", justifyContent: "center", padding: 16 }}>
        <img
          src={url}
          alt="Invoice attachment"
          style={{ maxWidth: "100%", height: "auto", borderRadius: 4 }}
          onError={() => setImageFailed(true)}
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
