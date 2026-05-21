"use client";

import Link from "next/link";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams, useParams, useRouter } from "next/navigation";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";

import Modal from "@/components/Modal";
import NavBar from "@/components/NavBar";
import { useAuth } from "@/contexts/AuthContext";
import styles from "./profile.module.css";

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
type RecordType = "veterinary" | "medication" | "farrier" | "bodywork" | "other";

type HorseRecord = {
  _id: Id<"horseRecords">;
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
  notes?: string;
  attachmentStorageId?: string;
  attachmentUrl?: string | null;
};


type FormState = {
  name: string;
  barnName: string;
  yearOfBirth: string;
  sex: "" | "gelding" | "mare" | "stallion";
  usefNumber: string;
  feiNumber: string;
  owner: string;
  ownerId: string;
};



const TAG_COLORS: Record<DocumentTag, { bg: string; color: string }> = {
  coggins: { bg: "rgba(74,91,219,0.08)", color: "#4A5BDB" },
  health_certificate: { bg: "rgba(34,197,131,0.08)", color: "#22C583" },
  horse_agreement: { bg: "rgba(245,158,11,0.08)", color: "#F59E0B" },
  insurance: { bg: "rgba(236,72,153,0.08)", color: "#EC4899" },
  registration: { bg: "rgba(167,139,250,0.08)", color: "#A78BFA" },
  contract: { bg: "rgba(245,158,11,0.08)", color: "#F59E0B" },
  id: { bg: "rgba(74,91,219,0.08)", color: "#4A5BDB" },
  tax: { bg: "rgba(34,197,131,0.08)", color: "#22C583" },
  other: { bg: "#F0F1F5", color: "#6B7084" },
};

const TAG_LABELS: Record<DocumentTag, string> = {
  coggins: "Coggins",
  health_certificate: "Health Cert",
  horse_agreement: "Agreement",
  insurance: "Insurance",
  registration: "Registration",
  contract: "Contract",
  id: "ID",
  tax: "Tax",
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
  const { user } = useAuth();
  const isTeam = user?.role === "team";
  const params = useParams<{ horseId: string }>();
  const searchParams = useSearchParams();
  const horseId = params?.horseId as Id<"horses">;
  const startsInEditMode = searchParams.get("edit") === "1";

  const horse = useQuery(api.horses.getHorseById, horseId ? { horseId } : "skip");
  const recordCounts = useQuery(api.horses.getHorseRecordCounts, horseId ? { horseId } : "skip");
  const prizeMoneyData = useQuery(api.incomeEntries.getHorsePrizeMoney, horseId ? { horseId } : "skip");
  const recordsAll = (useQuery(api.horseRecords.getAllByHorse, horseId ? { horseId } : "skip") as HorseRecord[] | undefined) ?? [];
  const documents = useQuery(api.documents.listByHorse, horseId ? { horseId } : "skip") ?? [];
  const ownersList = useQuery(api.owners.list) ?? [];

  const updateHorseProfile = useMutation(api.horses.updateHorseProfile);
  const assignHorseToOwner = useMutation(api.owners.assignHorseToOwner);
  const deleteHorse = useMutation(api.horses.deleteHorse);
  const transferOwnership = useMutation(api.horses.transferOwnership);
  const router = useRouter();
  const deleteDocument = useMutation(api.documents.deleteDocument);

  const [isEditing, setIsEditing] = useState(startsInEditMode);
  const [isSaving, setIsSaving] = useState(false);
  const [docSearch, setDocSearch] = useState("");
  const [documentToDelete, setDocumentToDelete] = useState<{ id: Id<"documents">; name: string } | null>(null);
  const [isDeletingDocument, setIsDeletingDocument] = useState(false);

  // Transfer ownership state
  const [showTransferModal, setShowTransferModal] = useState(false);
  const [transferStep, setTransferStep] = useState<1 | 2 | 3>(1);
  const [transferOwnerId, setTransferOwnerId] = useState<Id<"owners"> | null>(null);
  const [transferOwnerSearch, setTransferOwnerSearch] = useState("");
  const [transferItems, setTransferItems] = useState<Set<string>>(new Set());
  const [transferOriginalAction, setTransferOriginalAction] = useState<"deactivate" | "delete">("deactivate");
  const [isTransferring, setIsTransferring] = useState(false);

  const [form, setForm] = useState<FormState>({
    name: "",
    barnName: "",
    yearOfBirth: "",
    sex: "",
    usefNumber: "",
    feiNumber: "",
    owner: "",
    ownerId: "",
  });
  const documentsCardRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!horse) return;
    setForm({
      name: horse.name ?? "",
      barnName: (horse as any).barnName ?? "",
      yearOfBirth: horse.yearOfBirth ? String(horse.yearOfBirth) : "",
      sex: horse.sex ?? "",
      usefNumber: horse.usefNumber ?? "",
      feiNumber: horse.feiNumber ?? "",
      owner: horse.owner ?? "",
      ownerId: (horse as Record<string, unknown>).ownerId ? String((horse as Record<string, unknown>).ownerId) : "",
    });
  }, [horse]);

  const todayEnd = useMemo(() => {
    const d = new Date();
    d.setHours(23, 59, 59, 999);
    return d.getTime();
  }, []);

  const pastRecordCount = useMemo(
    () => recordsAll.filter((r) => r.date <= todayEnd).length,
    [recordsAll, todayEnd],
  );
  const upcomingRecordCount = useMemo(
    () => recordsAll.filter((r) => r.date > todayEnd).length,
    [recordsAll, todayEnd],
  );

  if (horse === undefined) {
    return (
      <div className="page-shell">
        <main className="page-main">
          <section className="ui-card">loading horse profile...</section>
        </main>
      </div>
    );
  }

  if (!horse) {
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
        barnName: form.barnName || undefined,
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

  async function onDeleteDocument() {
    if (!documentToDelete) return;
    setIsDeletingDocument(true);
    try {
      await deleteDocument({ documentId: documentToDelete.id });
      setDocumentToDelete(null);
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
            <Field label="BARN NAME" value={(horse as any).barnName || "—"} editing={isEditing}>
              <input value={form.barnName} onChange={(event) => setForm((prev) => ({ ...prev, barnName: event.target.value }))} placeholder="nickname / call name" />
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
            {!isTeam && (
              <Field label="PRIZE MONEY" value={(prizeMoneyData?.total ?? 0) > 0 ? formatUsd(prizeMoneyData!.total) : "—"} editing={false}>
                <span />
              </Field>
            )}
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
              <button
                type="button"
                className={styles.btnTransfer}
                onClick={() => {
                  setShowTransferModal(true);
                  setTransferStep(1);
                  setTransferOwnerId(null);
                  setTransferOwnerSearch("");
                  setTransferItems(new Set());
                  setTransferOriginalAction("deactivate");
                }}
              >
                transfer ownership
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

        {!isTeam && (
          <Link href={`/horses/${horse._id}/financials`} className={styles.financialsBlock}>
            <div className={styles.financialsBlockLeft}>
              <span className={styles.financialsBlockIcon}>💰</span>
              <div>
                <div className={styles.financialsBlockTitle}>financials</div>
                <div className={styles.financialsBlockSub}>view spend, invoices & prize money</div>
              </div>
            </div>
            <span className={styles.financialsBlockArrow}>→</span>
          </Link>
        )}

        <Link href={`/horses/${horse._id}/records`} className={styles.recordsBlock}>
          <div className={styles.recordsBlockLeft}>
            <span className={styles.recordsBlockIcon}>📋</span>
            <div>
              <div className={styles.recordsBlockTitle}>records</div>
              <div className={styles.recordsBlockSub}>
                {upcomingRecordCount > 0 ? `${upcomingRecordCount} upcoming · ` : ""}
                {pastRecordCount} past
              </div>
            </div>
          </div>
          <span className={styles.recordsBlockArrow}>→</span>
        </Link>

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
          </div>

          {documents.length === 0 ? (
            <div className={styles.documentsEmpty}>
              <div className={styles.documentsEmptyTitle}>no documents yet</div>
              <div className={styles.documentsEmptySub}>upload coggins, health certs, and other horse documents</div>
            </div>
          ) : (
            <div className={styles.docBody}>
              <input
                className={styles.docSearchBar}
                type="text"
                placeholder="search documents..."
                value={docSearch}
                onChange={(e) => setDocSearch(e.target.value)}
              />
              <div className={styles.docScroll}>
                {documents
                  .filter((doc) => {
                    if (!docSearch.trim()) return true;
                    const term = docSearch.trim().toLowerCase();
                    const hay = [doc.name, TAG_LABELS[doc.tag]].join(" ").toLowerCase();
                    return hay.includes(term);
                  })
                  .map((doc) => (
                    <div
                      key={doc._id}
                      className={styles.docCard}
                      onClick={() => {
                        if (doc.fileUrl) window.open(doc.fileUrl, "_blank", "noopener,noreferrer");
                      }}
                    >
                      <div className={styles.docCardTop}>
                        <span className={styles.docCardIcon}>📄</span>
                      </div>
                      <div className={styles.docCardBody}>
                        <div className={styles.docCardName}>{doc.name}</div>
                        <span className={styles.tagBadge} style={{ background: TAG_COLORS[doc.tag].bg, color: TAG_COLORS[doc.tag].color }}>
                          {TAG_LABELS[doc.tag]}
                        </span>
                        <div className={styles.docCardDate}>{formatDateLong(doc.documentDate ?? doc.uploadedAt)}</div>
                      </div>
                    </div>
                  ))}
              </div>
            </div>
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

      {/* Transfer Ownership Modal */}
      <Modal
        open={showTransferModal}
        title={`transfer ownership — ${horse?.name ?? ""}`}
        onClose={() => setShowTransferModal(false)}
      >
        {transferStep === 1 ? (
          <div className={styles.transferStep}>
            <p className={styles.transferLabel}>Select new owner</p>
            <input
              className={styles.transferSearch}
              type="text"
              placeholder="search owners..."
              value={transferOwnerSearch}
              onChange={(e) => setTransferOwnerSearch(e.target.value)}
              autoFocus
            />
            <div className={styles.transferOwnerList}>
              {ownersList
                .filter((o) => o.isActive && o.name.toLowerCase().includes(transferOwnerSearch.toLowerCase()))
                .map((o) => (
                  <button
                    key={o._id}
                    type="button"
                    className={`${styles.transferOwnerItem} ${transferOwnerId === o._id ? styles.transferOwnerItemSelected : ""}`}
                    onClick={() => setTransferOwnerId(o._id as Id<"owners">)}
                  >
                    {o.name}
                  </button>
                ))}
            </div>
            <div className={styles.transferActions}>
              <button type="button" className="ui-button-outlined" onClick={() => setShowTransferModal(false)}>
                cancel
              </button>
              <button
                type="button"
                className="ui-button-filled"
                disabled={!transferOwnerId}
                onClick={() => setTransferStep(2)}
              >
                next
              </button>
            </div>
          </div>
        ) : transferStep === 2 ? (
          <div className={styles.transferStep}>
            <p className={styles.transferLabel}>What should be transferred to the new profile?</p>
            {[
              { key: "full", label: "Full profile (records, documents, feed plan)" },
              { key: "records", label: "Records" },
              { key: "documents", label: "Documents" },
              { key: "feedPlan", label: "Feed plan" },
              { key: "none", label: "None (basic info only)" },
            ].map((option) => {
              const isFullSelected = transferItems.has("full");
              const isDisabled = option.key !== "full" && option.key !== "none" && isFullSelected;
              const isChecked = transferItems.has(option.key);
              return (
                <label key={option.key} className={`${styles.transferCheckbox} ${isDisabled ? styles.transferCheckboxDisabled : ""}`}>
                  <input
                    type="checkbox"
                    checked={isChecked}
                    disabled={isDisabled}
                    onChange={() => {
                      setTransferItems((prev) => {
                        const next = new Set(prev);
                        if (option.key === "full") {
                          if (next.has("full")) {
                            next.delete("full");
                          } else {
                            next.clear();
                            next.add("full");
                          }
                        } else if (option.key === "none") {
                          if (next.has("none")) {
                            next.delete("none");
                          } else {
                            next.clear();
                            next.add("none");
                          }
                        } else {
                          next.delete("none");
                          next.delete("full");
                          if (next.has(option.key)) {
                            next.delete(option.key);
                          } else {
                            next.add(option.key);
                          }
                        }
                        return next;
                      });
                    }}
                  />
                  <span>{option.label}</span>
                </label>
              );
            })}
            <div className={styles.transferActions}>
              <button type="button" className="ui-button-outlined" onClick={() => setTransferStep(1)}>
                back
              </button>
              <button
                type="button"
                className="ui-button-filled"
                disabled={transferItems.size === 0}
                onClick={() => setTransferStep(3)}
              >
                next
              </button>
            </div>
          </div>
        ) : (
          <div className={styles.transferStep}>
            <p className={styles.transferLabel}>What should happen to the original profile?</p>
            <label className={styles.transferRadio}>
              <input
                type="radio"
                name="originalAction"
                checked={transferOriginalAction === "deactivate"}
                onChange={() => setTransferOriginalAction("deactivate")}
              />
              <span>Deactivate (keep for reference)</span>
            </label>
            <label className={styles.transferRadio}>
              <input
                type="radio"
                name="originalAction"
                checked={transferOriginalAction === "delete"}
                onChange={() => setTransferOriginalAction("delete")}
              />
              <span>Delete permanently</span>
            </label>
            <div className={styles.transferActions}>
              <button type="button" className="ui-button-outlined" onClick={() => setTransferStep(2)}>
                back
              </button>
              <button
                type="button"
                className="ui-button-filled"
                disabled={isTransferring}
                onClick={async () => {
                  if (!transferOwnerId) return;
                  setIsTransferring(true);
                  try {
                    const items = transferItems.has("none")
                      ? ["none" as const]
                      : ([...transferItems] as Array<"full" | "records" | "documents" | "feedPlan" | "none">);
                    const newId = await transferOwnership({
                      horseId,
                      newOwnerId: transferOwnerId,
                      transferItems: items,
                      originalAction: transferOriginalAction,
                    });
                    setShowTransferModal(false);
                    router.push(`/horses/${newId}`);
                  } catch (err) {
                    alert(err instanceof Error ? err.message : "Transfer failed");
                  } finally {
                    setIsTransferring(false);
                  }
                }}
              >
                {isTransferring ? "transferring..." : "confirm transfer"}
              </button>
            </div>
          </div>
        )}
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
  const abs = Math.abs(value);
  const formatted = `$${abs.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  return value < 0 ? `(${formatted})` : formatted;
}

function capitalize(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function contactLabel(type: RecordType) {
  if (type === "veterinary") return "VETERINARIAN";
  if (type === "medication") return "ADMINISTERED BY";
  if (type === "farrier") return "FARRIER";
  if (type === "bodywork") return "PRACTITIONER";
  return "CONTACT";
}

function formatDateLong(timestamp: number) {
  return new Date(timestamp).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function toDateInput(timestamp: number) {
  return new Date(timestamp).toISOString().slice(0, 10);
}

function vetSubcategoryLabel(value?: string | null) {
  if (!value) return null;
  const labelMap: Record<string, string> = {
    exam: "Exam", vaccinations: "Vaccinations", vaccination: "Vaccinations",
    medication: "Medication", joint_injections: "Joint Injections",
    imaging: "Imaging", lab_work: "Lab Work", shockwave: "Shockwave",
    sedation: "Sedation", exams_diagnostics: "Exams & Diagnostics",
    fees: "Fees", treatment: "Treatment", other: "Other",
  };
  return labelMap[value] || value.replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function getVetVisitTypeLabels(record: { visitType?: string; visitTypes?: string[]; vetOtherDescription?: string }): string[] {
  const types = record.visitTypes?.length ? record.visitTypes : record.visitType ? [record.visitType] : [];
  return types.map((t) => {
    if (t === "other" && record.vetOtherDescription) return record.vetOtherDescription;
    return vetSubcategoryLabel(t) || t;
  });
}

function getRecordSubtype(record: HorseRecord) {
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

function getRecordDetail(record: HorseRecord): React.ReactNode {
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
        {record.notes ? <span className={styles.recordDetailSecondary}>{record.notes}</span> : null}
      </>
    );
  }

  if (record.contactName) return record.contactName;
  return "";
}
