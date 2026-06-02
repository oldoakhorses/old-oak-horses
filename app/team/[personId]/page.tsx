"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import NavBar from "@/components/NavBar";
import Modal from "@/components/Modal";
import styles from "./profile.module.css";

type PersonRole = "rider" | "groom" | "freelance" | "trainer" | "admin";

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

const ROLE_LABELS: Record<PersonRole, string> = {
  rider: "Rider",
  groom: "Groom",
  trainer: "Trainer",
  freelance: "Freelance",
  admin: "Admin",
};

const ROLE_ICONS: Record<PersonRole, string> = {
  rider: "🏇",
  groom: "🧹",
  trainer: "🎯",
  freelance: "🧑‍💼",
  admin: "👔",
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

const CATEGORY_COLORS: Record<string, string> = {
  veterinary: "#4A5BDB",
  farrier: "#14B8A6",
  stabling: "#F59E0B",
  supplies: "#6B7084",
  bodywork: "#A78BFA",
  travel: "#EC4899",
  salaries: "#22C583",
  admin: "#6B7084",
  "horse-transport": "#4A5BDB",
  "feed-bedding": "#F59E0B",
  "dues-registrations": "#4A5BDB",
  "show-expenses": "#EC4899",
  marketing: "#A78BFA",
};

export default function TeamProfilePage() {
  const params = useParams<{ personId: string }>();
  const router = useRouter();
  const personId = params?.personId as Id<"people">;

  const person = useQuery(api.people.getPersonById, personId ? { id: personId } : "skip");
  const spendSummary = useQuery(api.bills.getPersonSpendSummary, personId ? { personId } : "skip");
  const documents = useQuery(api.documents.listByPerson, personId ? { personId } : "skip") ?? [];

  const setPersonActive = useMutation(api.people.setPersonActive);
  const updatePerson = useMutation(api.people.updatePerson);
  const deletePerson = useMutation(api.people.deletePerson);
  const deleteDocument = useMutation(api.documents.deleteDocument);

  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [form, setForm] = useState<{ name: string; role: PersonRole }>({ name: "", role: "rider" });
  const [showAllInvoices, setShowAllInvoices] = useState(false);
  const [openDocumentMenu, setOpenDocumentMenu] = useState<Id<"documents"> | null>(null);
  const [documentToDelete, setDocumentToDelete] = useState<{ id: Id<"documents">; name: string } | null>(null);
  const [isDeletingDocument, setIsDeletingDocument] = useState(false);
  const [showDeletePersonModal, setShowDeletePersonModal] = useState(false);
  const [isDeletingPerson, setIsDeletingPerson] = useState(false);

  const displayInvoices = useMemo(() => {
    const rows = spendSummary?.invoices ?? [];
    return showAllInvoices ? rows : rows.slice(0, 10);
  }, [spendSummary, showAllInvoices]);

  const spendMomPct = useMemo(() => {
    if (!spendSummary) return 0;
    if (spendSummary.previousMonthSpend === 0) {
      return spendSummary.currentMonthSpend > 0 ? 100 : 0;
    }
    return (
      ((spendSummary.currentMonthSpend - spendSummary.previousMonthSpend) / spendSummary.previousMonthSpend) * 100
    );
  }, [spendSummary]);

  const grandTotalForPct = spendSummary?.totalSpend ?? 0;

  function startEdit() {
    if (!person) return;
    setForm({ name: person.name, role: person.role as PersonRole });
    setIsEditing(true);
  }

  async function onSave() {
    if (!person) return;
    if (!form.name.trim()) return;
    setIsSaving(true);
    try {
      await updatePerson({ id: person._id, name: form.name.trim(), role: form.role });
      setIsEditing(false);
    } finally {
      setIsSaving(false);
    }
  }

  async function toggleActive() {
    if (!person) return;
    await setPersonActive({ id: person._id, isActive: !person.isActive });
  }

  async function confirmDeletePerson() {
    if (!person) return;
    setIsDeletingPerson(true);
    try {
      await deletePerson({ id: person._id });
      router.push("/team");
    } finally {
      setIsDeletingPerson(false);
    }
  }

  async function confirmDeleteDocument() {
    if (!documentToDelete) return;
    setIsDeletingDocument(true);
    try {
      await deleteDocument({ documentId: documentToDelete.id });
      setDocumentToDelete(null);
    } finally {
      setIsDeletingDocument(false);
    }
  }

  if (person === undefined) {
    return (
      <div className="page-shell">
        <NavBar
          items={[
            { label: "team-ldk", href: "/dashboard", brand: true },
            { label: "team", href: "/team" },
            { label: "...", current: true },
          ]}
        />
        <main className="page-main">
          <div className={styles.loadingState}>loading...</div>
        </main>
      </div>
    );
  }

  if (person === null) {
    return (
      <div className="page-shell">
        <NavBar
          items={[
            { label: "team-ldk", href: "/dashboard", brand: true },
            { label: "team", href: "/team" },
            { label: "not found", current: true },
          ]}
        />
        <main className="page-main">
          <div className={styles.loadingState}>team member not found</div>
          <Link href="/team" className="ui-back-link">
            ← back to team
          </Link>
        </main>
      </div>
    );
  }

  const role = person.role as PersonRole;

  return (
    <div className="page-shell">
      <NavBar
        items={[
          { label: "team-ldk", href: "/dashboard", brand: true },
          { label: "team", href: "/team" },
          { label: person.name, current: true },
        ]}
        actions={[
          { label: "upload invoices", href: "/dashboard?panel=invoice", variant: "outlined" },
        ]}
      />
      <main className="page-main">
        <Link href="/team" className="ui-back-link">
          ← cd /team
        </Link>

        <section className={styles.headerCard}>
          <div className={styles.headerTop}>
            <div className={styles.headerLeft}>
              <div className={styles.personAvatar}>{ROLE_ICONS[role] ?? "👤"}</div>
              <div>
                {isEditing ? (
                  <input
                    className={styles.editNameInput}
                    value={form.name}
                    onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
                  />
                ) : (
                  <h1 className={styles.personName}>{person.name}</h1>
                )}
                <div className={styles.personMeta}>
                  {isEditing ? (
                    <select
                      className={styles.editRoleSelect}
                      value={form.role}
                      onChange={(e) => setForm((p) => ({ ...p, role: e.target.value as PersonRole }))}
                    >
                      <option value="rider">Rider</option>
                      <option value="groom">Groom</option>
                      <option value="trainer">Trainer</option>
                      <option value="freelance">Freelance</option>
                      <option value="admin">Admin</option>
                    </select>
                  ) : (
                    <span className={styles.roleBadge}>{ROLE_LABELS[role] ?? role}</span>
                  )}
                  {person.isActive ? (
                    <span className={styles.statusActive}>active</span>
                  ) : (
                    <span className={styles.statusInactive}>inactive</span>
                  )}
                </div>
              </div>
            </div>
            <div className={styles.headerActions}>
              {isEditing ? (
                <>
                  <button type="button" className={styles.btnCancel} onClick={() => setIsEditing(false)}>
                    cancel
                  </button>
                  <button type="button" className={styles.btnSave} onClick={onSave} disabled={isSaving}>
                    {isSaving ? "saving..." : "save"}
                  </button>
                </>
              ) : (
                <>
                  <button type="button" className={styles.btnDelete} onClick={() => setShowDeletePersonModal(true)}>
                    delete
                  </button>
                  <button type="button" className={styles.btnOutlined} onClick={toggleActive}>
                    {person.isActive ? "deactivate" : "activate"}
                  </button>
                  <button type="button" className={styles.btnFilled} onClick={startEdit}>
                    edit
                  </button>
                </>
              )}
            </div>
          </div>
        </section>

        <section className={styles.spendRow}>
          <div className={styles.spendTotalCard}>
            <div className={styles.spendLabel}>COST TO BUSINESS</div>
            <div className={styles.spendTotal}>{formatUsd(spendSummary?.totalSpend ?? 0)}</div>
            <div className={spendMomPct >= 0 ? styles.momUp : styles.momDown}>
              {spendMomPct >= 0 ? "↗" : "↘"} {spendMomPct >= 0 ? "+" : ""}
              {Math.abs(spendMomPct).toFixed(1)}% vs last month
            </div>
            <div className={styles.spendSubRow}>
              <span className={styles.spendSubLabel}>THIS MONTH</span>
              <span className={styles.spendSubValue}>{formatUsd(spendSummary?.currentMonthSpend ?? 0)}</span>
            </div>
            <div className={styles.spendSubRow}>
              <span className={styles.spendSubLabel}>LAST MONTH</span>
              <span className={styles.spendSubValue}>{formatUsd(spendSummary?.previousMonthSpend ?? 0)}</span>
            </div>
            <div className={styles.spendSubRow}>
              <span className={styles.spendSubLabel}>INVOICES</span>
              <span className={styles.spendSubValue}>{spendSummary?.invoiceCount ?? 0}</span>
            </div>
          </div>
          <div className={styles.spendBreakdownCard}>
            <div className={styles.spendLabel}>SPEND BY CATEGORY</div>
            {(spendSummary?.byCategory ?? []).length === 0 ? (
              <div className={styles.breakdownEmpty}>no categorized spend yet</div>
            ) : (
              <div className={styles.breakdownList}>
                {(spendSummary?.byCategory ?? []).map((row) => {
                  const color = CATEGORY_COLORS[row.slug] ?? "#6B7084";
                  const pct = grandTotalForPct > 0 ? (row.amount / grandTotalForPct) * 100 : 0;
                  return (
                    <div key={row.slug} className={styles.breakdownRow}>
                      <span className={styles.breakdownName}>{pretty(row.slug)}</span>
                      <span className={styles.breakdownTrack}>
                        <span
                          className={styles.breakdownFill}
                          style={{ width: `${Math.min(100, pct)}%`, background: color }}
                        />
                      </span>
                      <span className={styles.breakdownAmount}>{formatUsd(row.amount)}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </section>

        <section className={styles.invoicesSection}>
          <div className={styles.sectionHeader}>
            <div className={styles.sectionTitle}>invoices</div>
            <div className={styles.sectionCount}>
              {spendSummary?.invoiceCount ?? 0} invoice{(spendSummary?.invoiceCount ?? 0) === 1 ? "" : "s"}
            </div>
          </div>
          {displayInvoices.length === 0 ? (
            <div className={styles.emptyInvoices}>no invoices assigned to this team member</div>
          ) : (
            displayInvoices.map((row) => (
              <Link key={row.billId} href={`/invoices/${row.billId}`} className={styles.invoiceRow}>
                <div className={styles.invoiceLeft}>
                  <span className={styles.dotApproved} />
                  <div className={styles.invoiceLabelBlock}>
                    <span className={styles.invoiceLabel}>{row.contactName}</span>
                    <span className={styles.invoiceMeta}>
                      {row.categorySlug ? pretty(row.categorySlug) : "Uncategorized"}
                      {row.invoiceDate ? ` • ${formatDateLong(row.invoiceDate)}` : ""}
                    </span>
                  </div>
                </div>
                <span className={styles.invoiceAmount}>{formatUsd(row.amount)}</span>
              </Link>
            ))
          )}
          {(spendSummary?.invoices.length ?? 0) > 10 ? (
            <button type="button" className={styles.viewAll} onClick={() => setShowAllInvoices((prev) => !prev)}>
              {showAllInvoices ? "show less" : "view all"}
            </button>
          ) : null}
        </section>

        <section className={styles.documentsCard}>
          <div className={styles.documentsHeader}>
            <div>
              <div className={styles.documentsTitle}>documents</div>
              <div className={styles.documentsCount}>
                {documents.length} document{documents.length === 1 ? "" : "s"}
              </div>
            </div>
            <Link href={`/dashboard?panel=document&personId=${person._id}`} className={styles.btnAddDoc}>
              + add
            </Link>
          </div>

          {documents.length === 0 ? (
            <div className={styles.documentsEmpty}>
              <div className={styles.documentsEmptyTitle}>no documents yet</div>
              <div className={styles.documentsEmptySub}>upload contracts, IDs, tax forms and other personal documents</div>
            </div>
          ) : (
            <>
              <div className={styles.docHeader}>
                <span>NAME</span>
                <span>TAG</span>
                <span>DATE</span>
                <span />
              </div>
              {documents.map((doc) => {
                const tag = doc.tag as DocumentTag;
                const tagStyle = TAG_COLORS[tag] ?? TAG_COLORS.other;
                return (
                  <div
                    key={doc._id}
                    className={styles.docRow}
                    onClick={() => {
                      if (doc.fileUrl) window.open(doc.fileUrl, "_blank", "noopener,noreferrer");
                    }}
                  >
                    <div className={styles.docName}>📄 {doc.name}</div>
                    <span className={styles.tagBadge} style={{ background: tagStyle.bg, color: tagStyle.color }}>
                      {TAG_LABELS[tag] ?? tag}
                    </span>
                    <span className={styles.docDate}>{formatDateLong(doc.documentDate ?? doc.uploadedAt)}</span>
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
                              setOpenDocumentMenu(null);
                            }}
                          >
                            Delete
                          </button>
                        </div>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </>
          )}
        </section>

        <div className="ui-footer">TEAM_LDK // TEAM // {person.name.toUpperCase()}</div>
      </main>

      <Modal
        open={showDeletePersonModal}
        title="delete team member"
        onClose={() => setShowDeletePersonModal(false)}
      >
        <p className={styles.deleteText}>
          Are you sure you want to delete <strong>{person.name}</strong>? This cannot be undone. Any
          invoices already assigned to them will keep their record but the team member will no longer
          appear anywhere.
        </p>
        <div className={styles.deleteActions}>
          <button type="button" className="ui-button-outlined" onClick={() => setShowDeletePersonModal(false)}>
            cancel
          </button>
          <button
            type="button"
            className={styles.btnDelete}
            onClick={confirmDeletePerson}
            disabled={isDeletingPerson}
          >
            {isDeletingPerson ? "deleting..." : "delete"}
          </button>
        </div>
      </Modal>

      <Modal
        open={documentToDelete !== null}
        title="delete document"
        onClose={() => setDocumentToDelete(null)}
      >
        <p className={styles.deleteText}>
          Are you sure you want to delete <strong>{documentToDelete?.name}</strong>? This cannot be undone.
        </p>
        <div className={styles.deleteActions}>
          <button type="button" className="ui-button-outlined" onClick={() => setDocumentToDelete(null)}>
            cancel
          </button>
          <button
            type="button"
            className={styles.btnDelete}
            onClick={confirmDeleteDocument}
            disabled={isDeletingDocument}
          >
            {isDeletingDocument ? "deleting..." : "delete"}
          </button>
        </div>
      </Modal>
    </div>
  );
}

function formatUsd(value: number) {
  const abs = Math.abs(value);
  const formatted = `$${abs.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  return value < 0 ? `(${formatted})` : formatted;
}

function formatDateLong(timestamp: number) {
  return new Date(timestamp).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function pretty(value: string) {
  return value
    .replace(/[-_]+/g, " ")
    .split(" ")
    .filter(Boolean)
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join(" ");
}
