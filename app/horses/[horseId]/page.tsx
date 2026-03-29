"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams, useParams, useRouter } from "next/navigation";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { formatInvoiceName, toIsoDateString } from "@/lib/formatInvoiceName";
import Modal from "@/components/Modal";
import NavBar from "@/components/NavBar";
import styles from "./profile.module.css";

type DocumentTag = "coggins" | "health_certificate" | "horse_agreement" | "insurance" | "registration" | "other";
type RecordType = "veterinary" | "medication" | "farrier" | "bodywork" | "other";

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
};

type RecordEditState = {
  providerName: string;
  date: string;
  nextVisitDate: string;
  notes: string;
  serviceType: string;
  customType: string;
  vaccineName: string;
  treatmentDescription: string;
};

type FormState = {
  name: string;
  yearOfBirth: string;
  sex: "" | "gelding" | "mare" | "stallion";
  usefNumber: string;
  feiNumber: string;
  owner: string;
  ownerId: string;
};

type PrizeForm = {
  amount: string;
  description: string;
  showName: string;
  className: string;
  placing: string;
  date: string;
};

const CATEGORY_COLORS: Record<string, string> = {
  veterinary: "#4A5BDB",
  farrier: "#14B8A6",
  stabling: "#F59E0B",
  supplies: "#6B7084",
  bodywork: "#A78BFA",
  travel: "#EC4899",
  housing: "#A78BFA",
  feed_bedding: "#22C583",
  "feed-bedding": "#22C583",
  admin: "#6B7084",
  dues_registrations: "#4A5BDB",
  "dues-registrations": "#4A5BDB",
  horse_transport: "#4A5BDB",
  "horse-transport": "#4A5BDB",
};

const TAG_COLORS: Record<DocumentTag, { bg: string; color: string }> = {
  coggins: { bg: "rgba(74,91,219,0.08)", color: "#4A5BDB" },
  health_certificate: { bg: "rgba(34,197,131,0.08)", color: "#22C583" },
  horse_agreement: { bg: "rgba(245,158,11,0.08)", color: "#F59E0B" },
  insurance: { bg: "rgba(236,72,153,0.08)", color: "#EC4899" },
  registration: { bg: "rgba(167,139,250,0.08)", color: "#A78BFA" },
  other: { bg: "#F0F1F5", color: "#6B7084" },
};

const TAG_LABELS: Record<DocumentTag, string> = {
  coggins: "Coggins",
  health_certificate: "Health Cert",
  horse_agreement: "Agreement",
  insurance: "Insurance",
  registration: "Registration",
  other: "Other",
};

const RECORD_ICONS: Record<RecordType, string> = {
  veterinary: "🩺",
  medication: "💊",
  farrier: "🔧",
  bodywork: "🦴",
  other: "📋",
};

export default function HorseProfilePage() {
  const params = useParams<{ horseId: string }>();
  const searchParams = useSearchParams();
  const horseId = params?.horseId as Id<"horses">;
  const startsInEditMode = searchParams.get("edit") === "1";

  const horse = useQuery(api.horses.getHorseById, horseId ? { horseId } : "skip");
  const spendMeta = useQuery(api.horses.getHorseSpendMeta, horseId ? { horseId } : "skip");
  const spendByCategory = useQuery(api.horses.getHorseSpendByCategory, horseId ? { horseId } : "skip") ?? [];
  const invoices = useQuery(api.horses.getInvoicesByHorse, horseId ? { horseId } : "skip") ?? [];
  const recordCounts = useQuery(api.horses.getHorseRecordCounts, horseId ? { horseId } : "skip");
  const prizeMoneyData = useQuery(api.incomeEntries.getHorsePrizeMoney, horseId ? { horseId } : "skip");
  const recordsAll = (useQuery(api.horseRecords.getAllByHorse, horseId ? { horseId } : "skip") as HorseRecord[] | undefined) ?? [];
  const documents = useQuery(api.documents.listByHorse, horseId ? { horseId } : "skip") ?? [];
  const ownersList = useQuery(api.owners.list) ?? [];

  const updateHorseProfile = useMutation(api.horses.updateHorseProfile);
  const addIncomeEntry = useMutation(api.incomeEntries.addEntry);
  const deleteIncomeEntry = useMutation(api.incomeEntries.deleteEntry);
  const assignHorseToOwner = useMutation(api.owners.assignHorseToOwner);
  const deleteHorse = useMutation(api.horses.deleteHorse);
  const router = useRouter();
  const updateRecordWithNextVisit = useMutation(api.horseRecords.updateRecordWithNextVisit);
  const deleteDocument = useMutation(api.documents.deleteDocument);

  const [isEditing, setIsEditing] = useState(startsInEditMode);
  const [isSaving, setIsSaving] = useState(false);
  const [showAllInvoices, setShowAllInvoices] = useState(false);
  const [recordsSearch, setRecordsSearch] = useState("");
  const [expandedRecordId, setExpandedRecordId] = useState<Id<"horseRecords"> | null>(null);
  const [editingRecordId, setEditingRecordId] = useState<Id<"horseRecords"> | null>(null);
  const [recordEdit, setRecordEdit] = useState<RecordEditState | null>(null);
  const [openDocumentMenu, setOpenDocumentMenu] = useState<Id<"documents"> | null>(null);
  const [documentToDelete, setDocumentToDelete] = useState<{ id: Id<"documents">; name: string } | null>(null);
  const [isDeletingDocument, setIsDeletingDocument] = useState(false);

  const [form, setForm] = useState<FormState>({
    name: "",
    yearOfBirth: "",
    sex: "",
    usefNumber: "",
    feiNumber: "",
    owner: "",
    ownerId: "",
  });
  const [showPrizeForm, setShowPrizeForm] = useState(false);
  const [prizeForm, setPrizeForm] = useState<PrizeForm>({
    amount: "", description: "", showName: "", className: "", placing: "", date: "",
  });

  const documentsCardRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!horse) return;
    setForm({
      name: horse.name ?? "",
      yearOfBirth: horse.yearOfBirth ? String(horse.yearOfBirth) : "",
      sex: horse.sex ?? "",
      usefNumber: horse.usefNumber ?? "",
      feiNumber: horse.feiNumber ?? "",
      owner: horse.owner ?? "",
      ownerId: (horse as Record<string, unknown>).ownerId ? String((horse as Record<string, unknown>).ownerId) : "",
    });
  }, [horse]);

  useEffect(() => {
    const onClickOutside = (event: MouseEvent) => {
      if (documentsCardRef.current && !documentsCardRef.current.contains(event.target as Node)) {
        setOpenDocumentMenu(null);
      }
    };
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  const visibleInvoices = showAllInvoices ? invoices : invoices.slice(0, 10);

  const matchedRecords = useMemo(() => {
    const term = recordsSearch.trim().toLowerCase();
    if (!term) return recordsAll;
    return recordsAll.filter((record) => {
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
  }, [recordsAll, recordsSearch]);
  const recordById = useMemo(() => {
    const map = new Map<string, HorseRecord>();
    for (const row of recordsAll) map.set(String(row._id), row);
    return map;
  }, [recordsAll]);

  const recentMatchedRecords = matchedRecords.slice(0, 3);

  if (horse === undefined || spendMeta === undefined) {
    return (
      <div className="page-shell">
        <main className="page-main">
          <section className="ui-card">loading horse profile...</section>
        </main>
      </div>
    );
  }

  if (!horse || !spendMeta) {
    return (
      <div className="page-shell">
        <main className="page-main">
          <section className="ui-card">horse not found</section>
        </main>
      </div>
    );
  }

  async function onSave() {
    setIsSaving(true);
    try {
      await updateHorseProfile({
        horseId,
        name: form.name || undefined,
        yearOfBirth: form.yearOfBirth ? Number(form.yearOfBirth) : undefined,
        sex: form.sex || undefined,
        usefNumber: form.usefNumber || undefined,
        feiNumber: form.feiNumber || undefined,
        owner: form.owner || undefined,
        prizeMoney: undefined,
      });
      // Sync owner relationship
      const currentOwnerId = (horse as Record<string, unknown>).ownerId ? String((horse as Record<string, unknown>).ownerId) : "";
      if (form.ownerId !== currentOwnerId) {
        await assignHorseToOwner({
          horseId,
          ownerId: form.ownerId ? (form.ownerId as Id<"owners">) : undefined,
        });
      }
      setIsEditing(false);
    } finally {
      setIsSaving(false);
    }
  }

  function getLinkedUpcomingDateInput(record: HorseRecord) {
    if (record.isUpcoming || !record.linkedRecordId) return "";
    const linked = recordsAll.find((row) => row._id === record.linkedRecordId);
    return typeof linked?.date === "number" ? toDateInput(linked.date) : "";
  }

  async function onSaveRecordEdit() {
    if (!editingRecordId || !recordEdit) return;
    const nextVisitTimestamp = recordEdit.nextVisitDate ? new Date(`${recordEdit.nextVisitDate}T00:00:00`).getTime() : undefined;
    await updateRecordWithNextVisit({
      recordId: editingRecordId,
      updates: {
        providerName: recordEdit.providerName || undefined,
        date: recordEdit.date ? new Date(`${recordEdit.date}T00:00:00`).getTime() : undefined,
        notes: recordEdit.notes || undefined,
        serviceType: recordEdit.serviceType || undefined,
        customType: recordEdit.customType || undefined,
        vaccineName: recordEdit.vaccineName || undefined,
        treatmentDescription: recordEdit.treatmentDescription || undefined,
      },
      nextVisitDate: nextVisitTimestamp,
    });
    setEditingRecordId(null);
    setRecordEdit(null);
  }

  async function onDeleteDocument() {
    if (!documentToDelete) return;
    setIsDeletingDocument(true);
    try {
      await deleteDocument({ documentId: documentToDelete.id });
      setDocumentToDelete(null);
      setOpenDocumentMenu(null);
    } finally {
      setIsDeletingDocument(false);
    }
  }

  return (
    <div className="page-shell">
      <NavBar
        items={[
          { label: "old-oak-horses", href: "/dashboard", brand: true },
          { label: "horses", href: "/horses" },
          { label: horse.name, current: true },
        ]}
        actions={[
          { label: "upload invoices", href: "/dashboard?panel=invoice", variant: "outlined" },
          { label: "biz overview", href: "/biz-overview", variant: "filled" },
        ]}
      />

      <main className="page-main">
        <Link href="/horses" className="ui-back-link">
          ← cd /horses
        </Link>

        <section className={styles.headerRow}>
          <div>
            <div className="ui-label">// HORSE PROFILE</div>
            <div className={styles.titleRow}>
              <h1 className={styles.title}>{horse.name}</h1>
              {horse.isSold ? (
                <span className={styles.statusSold}>sold</span>
              ) : horse.status === "active" ? (
                <span className={styles.statusActive}>active</span>
              ) : (
                <span className={styles.statusInactive}>inactive</span>
              )}
            </div>
            <div className={styles.subtitle}>
              {horse.sex ? capitalize(horse.sex) : ""}
              {horse.sex && horse.owner ? " · " : ""}
              {horse.owner ? (
                (horse as Record<string, unknown>).ownerId ? (
                  <Link href={`/owners/${(horse as Record<string, unknown>).ownerId}`} style={{ color: "#4A5BDB", textDecoration: "none" }}>{horse.owner}</Link>
                ) : horse.owner
              ) : !horse.sex ? "—" : ""}
            </div>
          </div>
          {!isEditing ? (
            <button type="button" className={styles.btnEdit} onClick={() => setIsEditing(true)}>
              edit profile
            </button>
          ) : null}
        </section>

        <section className={styles.profileCard}>
          <div className={styles.profileFields}>
            <Field label="NAME" value={horse.name} editing={isEditing}>
              <input value={form.name} onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))} />
            </Field>
            <Field label="YEAR OF BIRTH" value={horse.yearOfBirth ? String(horse.yearOfBirth) : "—"} editing={isEditing}>
              <input value={form.yearOfBirth} onChange={(event) => setForm((prev) => ({ ...prev, yearOfBirth: event.target.value }))} />
            </Field>
            <Field label="SEX" value={horse.sex ? capitalize(horse.sex) : "—"} editing={isEditing}>
              <select value={form.sex} onChange={(event) => setForm((prev) => ({ ...prev, sex: event.target.value as FormState["sex"] }))}>
                <option value="">-- select --</option>
                <option value="gelding">Gelding</option>
                <option value="mare">Mare</option>
                <option value="stallion">Stallion</option>
              </select>
            </Field>
            <Field label="OWNER" value={horse.owner ? ((horse as Record<string, unknown>).ownerId ? horse.owner : horse.owner) : "—"} editing={isEditing}>
              <select
                value={form.ownerId}
                onChange={(event) => {
                  const selectedId = event.target.value;
                  const selectedOwner = ownersList.find((o) => String(o._id) === selectedId);
                  setForm((prev) => ({
                    ...prev,
                    ownerId: selectedId,
                    owner: selectedOwner?.name ?? "",
                  }));
                }}
              >
                <option value="">-- no owner --</option>
                {ownersList.map((o) => (
                  <option key={o._id} value={String(o._id)}>{o.name}</option>
                ))}
              </select>
            </Field>
            <Field label="USEF #" value={horse.usefNumber || "—"} editing={isEditing}>
              <input value={form.usefNumber} onChange={(event) => setForm((prev) => ({ ...prev, usefNumber: event.target.value }))} />
            </Field>
            <Field label="FEI #" value={horse.feiNumber || "—"} editing={isEditing}>
              <input value={form.feiNumber} onChange={(event) => setForm((prev) => ({ ...prev, feiNumber: event.target.value }))} />
            </Field>
            <Field label="PRIZE MONEY" value={(prizeMoneyData?.total ?? 0) > 0 ? formatUsd(prizeMoneyData!.total) : "—"} editing={false}>
              <span />
            </Field>
          </div>
          {isEditing ? (
            <div className={styles.editActions}>
              <button
                type="button"
                className={styles.btnDelete}
                onClick={async () => {
                  if (window.confirm(`Are you sure you want to delete ${horse.name}? This cannot be undone.`)) {
                    await deleteHorse({ horseId });
                    router.push("/horses");
                  }
                }}
              >
                delete horse
              </button>
              <div style={{ flex: 1 }} />
              <button type="button" className={styles.btnCancel} onClick={() => setIsEditing(false)}>
                cancel
              </button>
              <button type="button" className={styles.btnSave} onClick={onSave} disabled={isSaving}>
                {isSaving ? "saving..." : "save changes"}
              </button>
            </div>
          ) : null}
        </section>

        <section className={styles.spendRow}>
          <div className={styles.spendTotalCard}>
            <div className={styles.spendLabel}>TOTAL SPEND</div>
            <div className={styles.spendTotal}>{formatUsd(spendMeta.totalSpend)}</div>
            <div className={spendMeta.momPct > 0 ? styles.momUp : styles.momDown}>
              {spendMeta.momPct >= 0 ? "↗" : "↘"} {spendMeta.momPct >= 0 ? "+" : ""}
              {Math.abs(spendMeta.momPct).toFixed(1)}% vs last month
            </div>
            {(prizeMoneyData?.total ?? 0) > 0 ? (
              <>
                <div className={styles.prizeMoneyRow}>
                  <span className={styles.prizeMoneyLabel}>PRIZE MONEY</span>
                  <span className={styles.prizeMoneyValue}>+{formatUsd(prizeMoneyData!.total)}</span>
                </div>
                <div className={styles.netCostRow}>
                  <span className={styles.netCostLabel}>NET COST</span>
                  <span className={styles.netCostValue}>{formatUsd(spendMeta.totalSpend - prizeMoneyData!.total)}</span>
                </div>
              </>
            ) : null}
          </div>
          <div className={styles.spendBreakdownCard}>
            <div className={styles.spendLabel}>SPEND BY CATEGORY</div>
            <div className={styles.breakdownList}>
              {spendByCategory.map((row) => {
                const color = CATEGORY_COLORS[row.category] ?? "#6B7084";
                return (
                  <div key={row.category} className={styles.breakdownRow}>
                    <span className={styles.breakdownName}>{pretty(row.category)}</span>
                    <span className={styles.breakdownTrack}>
                      <span className={styles.breakdownFill} style={{ width: `${Math.min(100, row.pct)}%`, background: color }} />
                    </span>
                    <span className={styles.breakdownAmount}>{formatUsd(row.amount)}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        <section className={styles.invoicesSection}>
          <div className={styles.invoicesHeader}>
            <div className={styles.invoicesTitle}>invoices</div>
          </div>
          {visibleInvoices.length === 0 ? (
            <div className={styles.emptyInvoices}>no invoices for this horse</div>
          ) : (
            visibleInvoices.map((row) => (
              <Link key={row._id} href={row.href} className={styles.invoiceRow}>
                <div className={styles.invoiceLeft}>
                  <span className={row.status === "approved" ? styles.dotApproved : styles.dotPending} />
                  <span className={styles.invoiceLabel}>
                    {formatInvoiceName({
                      category: row.category,
                      providerName: row.providerName,
                      date: toIsoDateString(row.date || ""),
                    })}
                  </span>
                </div>
                <span className={styles.invoiceAmount}>{formatUsd(row.amount)}</span>
              </Link>
            ))
          )}
          {invoices.length > 10 ? (
            <button type="button" className={styles.viewAll} onClick={() => setShowAllInvoices((prev) => !prev)}>
              {showAllInvoices ? "show less" : "view all"}
            </button>
          ) : null}
        </section>

        <section className={styles.prizeSection}>
          <div className={styles.prizeHeader}>
            <div className={styles.prizeTitle}>prize money</div>
            <button type="button" className={styles.addPrizeBtn} onClick={() => setShowPrizeForm((prev) => !prev)}>
              {showPrizeForm ? "cancel" : "+ add"}
            </button>
          </div>
          {showPrizeForm ? (
            <div className={styles.prizeFormGrid}>
              <input className={styles.prizeInput} type="number" step="0.01" placeholder="Amount ($)" value={prizeForm.amount} onChange={(e) => setPrizeForm((p) => ({ ...p, amount: e.target.value }))} />
              <input className={styles.prizeInput} placeholder="Show name" value={prizeForm.showName} onChange={(e) => setPrizeForm((p) => ({ ...p, showName: e.target.value }))} />
              <input className={styles.prizeInput} placeholder="Class" value={prizeForm.className} onChange={(e) => setPrizeForm((p) => ({ ...p, className: e.target.value }))} />
              <input className={styles.prizeInput} placeholder="Placing (e.g. 1st)" value={prizeForm.placing} onChange={(e) => setPrizeForm((p) => ({ ...p, placing: e.target.value }))} />
              <input className={styles.prizeInput} type="date" value={prizeForm.date} onChange={(e) => setPrizeForm((p) => ({ ...p, date: e.target.value }))} />
              <input className={styles.prizeInput} placeholder="Description" value={prizeForm.description} onChange={(e) => setPrizeForm((p) => ({ ...p, description: e.target.value }))} />
              <button type="button" className={styles.btnSave} onClick={async () => {
                if (!prizeForm.amount) return;
                await addIncomeEntry({
                  horseId: horse._id,
                  type: "prize_money",
                  amount: Number(prizeForm.amount),
                  description: prizeForm.description || `Prize money${prizeForm.showName ? ` - ${prizeForm.showName}` : ""}`,
                  showName: prizeForm.showName || undefined,
                  className: prizeForm.className || undefined,
                  placing: prizeForm.placing || undefined,
                  date: prizeForm.date || undefined,
                });
                setPrizeForm({ amount: "", description: "", showName: "", className: "", placing: "", date: "" });
                setShowPrizeForm(false);
              }}>save</button>
            </div>
          ) : null}
          {(prizeMoneyData?.entries ?? []).length === 0 && !showPrizeForm ? (
            <div className={styles.emptyInvoices}>no prize money recorded</div>
          ) : (
            (prizeMoneyData?.entries ?? []).map((entry) => (
              <div key={entry._id} className={styles.prizeEntryRow}>
                <div className={styles.prizeEntryLeft}>
                  <span className={styles.prizeEntryAmount}>+{formatUsd(entry.amount)}</span>
                  <span className={styles.prizeEntryDesc}>
                    {entry.showName ?? entry.description}
                    {entry.className ? ` · ${entry.className}` : ""}
                    {entry.placing ? ` · ${entry.placing}` : ""}
                  </span>
                  {entry.date ? <span className={styles.prizeEntryDate}>{entry.date}</span> : null}
                </div>
                <button type="button" className={styles.prizeDeleteBtn} onClick={() => deleteIncomeEntry({ entryId: entry._id })}>×</button>
              </div>
            ))
          )}
        </section>

        <section className={styles.recordsCard}>
          <div className={styles.recordsHeaderNew}>
            <div>
              <div className={styles.recordsTitle}>records</div>
              <div className={styles.recordsSubhead}>3 most recent</div>
            </div>
            <Link href={`/horses/${horse._id}/records`} className={styles.seeAllLink}>
              see all →
            </Link>
          </div>

          <div className={styles.recordsSearchRow}>
            <div className={styles.recordsSearchWrapper}>
              <span className={styles.recordsSearchIcon}>🔍</span>
              <input
                className={styles.recordsSearch}
                value={recordsSearch}
                onChange={(event) => setRecordsSearch(event.target.value)}
                placeholder="search records..."
              />
            </div>
          </div>

          {recordsSearch.trim() && matchedRecords.length > 3 ? (
            <div className={styles.recordsSearchNote}>
              showing 3 of {matchedRecords.length} matches — <Link href={`/horses/${horse._id}/records`} className={styles.recordsSearchNoteLink}>see all →</Link>
            </div>
          ) : null}

          {recentMatchedRecords.length === 0 ? (
            <div className={styles.recordsEmpty}>
              <div className={styles.recordsEmptyTitle}>no records yet</div>
              <div className={styles.recordsEmptySub}>log vet visits, farrier, and other horse records</div>
            </div>
          ) : (
            recentMatchedRecords.map((record) => {
              const expanded = expandedRecordId === record._id;
              const subtype = getRecordSubtype(record);
              const detail = getRecordDetail(record);
              const isEditingRecord = editingRecordId === record._id && recordEdit !== null;

              return (
                <div key={record._id}>
                  <div
                    className={styles.recordRowNew}
                    onClick={() => {
                      setExpandedRecordId((prev) => (prev === record._id ? null : record._id));
                      setEditingRecordId(null);
                      setRecordEdit(null);
                    }}
                  >
                    <div>
                      <div className={styles.recordTitle}>
                        <span>{RECORD_ICONS[record.type]}</span>
                        <span>
                          {pretty(record.type)}
                          {subtype ? ` — ${subtype}` : ""}
                        </span>
                      </div>
                      {detail ? <div className={styles.recordDetail}>{detail}</div> : null}
                      {record.linkedRecordId ? (
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            setExpandedRecordId(record.linkedRecordId || null);
                            setEditingRecordId(null);
                            setRecordEdit(null);
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
                    <div className={styles.recordDate}>{formatDateLong(record.date)}</div>
                  </div>

                  {expanded ? (
                    <div className={styles.recordExpanded}>
                      <div className={styles.recordExpandedFields}>
                        {isEditingRecord ? (
                          <>
                            <ExpandedInput label="PROVIDER">
                              <input
                                className={styles.expandedInput}
                                value={recordEdit.providerName}
                                onChange={(event) => setRecordEdit({ ...recordEdit, providerName: event.target.value })}
                              />
                            </ExpandedInput>
                            <ExpandedInput label="DATE">
                              <input
                                type="date"
                                className={styles.expandedInput}
                                value={recordEdit.date}
                                onChange={(event) => setRecordEdit({ ...recordEdit, date: event.target.value })}
                              />
                            </ExpandedInput>
                            <ExpandedInput label="NOTES">
                              <textarea
                                className={styles.expandedTextarea}
                                value={recordEdit.notes}
                                onChange={(event) => setRecordEdit({ ...recordEdit, notes: event.target.value })}
                              />
                            </ExpandedInput>
                            {!record.isUpcoming ? (
                              <ExpandedInput label="NEXT VISIT">
                                <>
                                  <input
                                    type="date"
                                    className={styles.expandedInput}
                                    value={recordEdit.nextVisitDate}
                                    onChange={(event) => setRecordEdit({ ...recordEdit, nextVisitDate: event.target.value })}
                                  />
                                  <div style={{ fontSize: 9, color: "#9EA2B0", marginTop: 6 }}>
                                    {record.linkedRecordId
                                      ? "editing this will update the scheduled follow-up"
                                      : "setting a date will create a scheduled follow-up"}
                                  </div>
                                </>
                              </ExpandedInput>
                            ) : null}
                          </>
                        ) : (
                          <>
                            <ExpandedField label="PROVIDER" value={record.providerName} />
                            <ExpandedField label="DATE" value={formatDateLong(record.date)} />
                            <ExpandedField label="NOTES" value={record.notes} />
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
                        {isEditingRecord ? (
                          <>
                            <button
                              type="button"
                              className={styles.expandedEditBtn}
                              onClick={(event) => {
                                event.stopPropagation();
                                void onSaveRecordEdit();
                              }}
                            >
                              save
                            </button>
                            <button
                              type="button"
                              className={styles.expandedCloseBtn}
                              onClick={(event) => {
                                event.stopPropagation();
                                setEditingRecordId(null);
                                setRecordEdit(null);
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
                                setRecordEdit({
                                  providerName: record.providerName || "",
                                  date: toDateInput(record.date),
                                  nextVisitDate: getLinkedUpcomingDateInput(record),
                                  notes: record.notes || "",
                                  serviceType: record.serviceType || "",
                                  customType: record.customType || "",
                                  vaccineName: record.vaccineName || "",
                                  treatmentDescription: record.treatmentDescription || "",
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
                                setExpandedRecordId(null);
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

        {/* Feed Plan link block */}
        <Link href={`/horses/${horseId}/feed-plan`} className={styles.feedPlanBlock}>
          <div className={styles.feedPlanBlockLeft}>
            <div className={styles.feedPlanBlockIcon}>🌾</div>
            <div>
              <div className={styles.feedPlanBlockTitle}>feed plan</div>
              <div className={styles.feedPlanBlockSub}>view &amp; edit feeding schedule</div>
            </div>
          </div>
          <div className={styles.feedPlanBlockArrow}>→</div>
        </Link>

        <section className={styles.documentsCard} ref={documentsCardRef}>
          <div className={styles.documentsHeader}>
            <div>
              <div className={styles.documentsTitle}>documents</div>
              <div className={styles.documentsCount}>{documents.length} document{documents.length === 1 ? "" : "s"}</div>
            </div>
            <Link href={`/dashboard?panel=document&horseId=${horse._id}`} className={styles.btnAddDoc}>
              + add
            </Link>
          </div>

          {documents.length === 0 ? (
            <div className={styles.documentsEmpty}>
              <div className={styles.documentsEmptyTitle}>no documents yet</div>
              <div className={styles.documentsEmptySub}>upload coggins, health certs, and other horse documents</div>
            </div>
          ) : (
            <>
              <div className={styles.docHeader}>
                <span>NAME</span>
                <span>TAG</span>
                <span>DATE</span>
                <span />
              </div>
              {documents.map((doc) => (
                <div
                  key={doc._id}
                  className={styles.docRow}
                  onClick={() => {
                    if (doc.fileUrl) window.open(doc.fileUrl, "_blank", "noopener,noreferrer");
                  }}
                >
                  <div className={styles.docName}>📄 {doc.name}</div>
                  <span className={styles.tagBadge} style={{ background: TAG_COLORS[doc.tag].bg, color: TAG_COLORS[doc.tag].color }}>
                    {TAG_LABELS[doc.tag]}
                  </span>
                  <span className={styles.docDate}>{formatDateLong(doc.uploadedAt)}</span>
                  <div className={styles.docMenuWrap}>
                    <button
                      type="button"
                      className={styles.docMenuButton}
                      onClick={(event) => {
                        event.stopPropagation();
                        setOpenDocumentMenu((prev) => (prev === doc._id ? null : doc._id));
                      }}
                    >
                      ⋮
                    </button>
                    {openDocumentMenu === doc._id ? (
                      <div className={styles.docMenuDropdown}>
                        <button
                          type="button"
                          className={styles.docMenuItem}
                          onClick={(event) => {
                            event.stopPropagation();
                            if (doc.fileUrl) window.open(doc.fileUrl, "_blank", "noopener,noreferrer");
                            setOpenDocumentMenu(null);
                          }}
                        >
                          Open Document
                        </button>
                        <button
                          type="button"
                          className={styles.docMenuItem}
                          onClick={(event) => {
                            event.stopPropagation();
                            if (doc.fileUrl) {
                              const link = document.createElement("a");
                              link.href = doc.fileUrl;
                              link.download = doc.fileName || doc.name;
                              link.click();
                            }
                            setOpenDocumentMenu(null);
                          }}
                        >
                          Download
                        </button>
                        <div className={styles.docMenuDivider} />
                        <button
                          type="button"
                          className={`${styles.docMenuItem} ${styles.docMenuItemDanger}`}
                          onClick={(event) => {
                            event.stopPropagation();
                            setDocumentToDelete({ id: doc._id, name: doc.name });
                          }}
                        >
                          Delete
                        </button>
                      </div>
                    ) : null}
                  </div>
                </div>
              ))}
            </>
          )}
        </section>

        <div className="ui-footer">OLD_OAK_HORSES // HORSES // {horse.name.toUpperCase()}</div>
      </main>

      <Modal open={documentToDelete !== null} title="delete document?" onClose={() => setDocumentToDelete(null)}>
        <p className={styles.deleteBody}>
          Are you sure you want to delete "{documentToDelete?.name}"?
          <br />
          This cannot be undone.
        </p>
        <div className={styles.deleteActions}>
          <button type="button" className="ui-button-outlined" onClick={() => setDocumentToDelete(null)}>
            cancel
          </button>
          <button type="button" className={styles.deleteButton} onClick={onDeleteDocument} disabled={isDeletingDocument}>
            {isDeletingDocument ? "deleting..." : "yes, delete"}
          </button>
        </div>
      </Modal>
    </div>
  );
}

function Field({
  label,
  value,
  editing,
  children,
}: {
  label: string;
  value: string;
  editing: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={styles.field}>
      <div className={styles.fieldLabel}>{label}</div>
      {editing ? <div className={styles.fieldInput}>{children}</div> : <div className={value === "—" ? styles.fieldValueEmpty : styles.fieldValue}>{value}</div>}
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

function pretty(value: string) {
  return value
    .replace(/[-_]+/g, " ")
    .split(" ")
    .filter(Boolean)
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join(" ");
}

function formatUsd(value: number) {
  return `$${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function capitalize(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function formatDateLong(timestamp: number) {
  return new Date(timestamp).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function toDateInput(timestamp: number) {
  return new Date(timestamp).toISOString().slice(0, 10);
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
