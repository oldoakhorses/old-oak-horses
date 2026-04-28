"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import Link from "next/link";
import NavBar from "@/components/NavBar";
import Modal from "@/components/Modal";
import { formatInvoiceName } from "@/lib/formatInvoiceName";
import styles from "./contact.module.css";

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
  equity: { bg: "rgba(139,92,246,0.08)", color: "#8B5CF6" },
};

function formatUsd(amount: number) {
  const abs = Math.abs(amount);
  const formatted = `$${abs.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  return amount < 0 ? `(${formatted})` : formatted;
}

function formatCategoryLabel(slug: string) {
  return slug
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ")
    .replace("Feed Bedding", "Feed & Bedding")
    .replace("Dues Registrations", "Dues & Registrations");
}

export default function ContactDetailPage() {
  const params = useParams<{ slug: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const slug = params.slug;

  // Try slug lookup first, fall back to ID lookup
  const contactBySlug = useQuery(api.contacts.getContactBySlug, { slug });
  const contactById = useQuery(
    api.contacts.getContactById,
    contactBySlug === null ? { id: slug as any } : "skip"
  );
  const contact = contactBySlug ?? contactById;
  const bills = useQuery(
    api.bills.getBillsByContact,
    contact?._id ? { contactId: contact._id } : "skip"
  );
  const costSummary = useQuery(
    api.bills.getContactCostSummary,
    contact?._id ? { contactId: contact._id } : "skip"
  );

  const updateContact = useMutation(api.contacts.updateContact);
  const deleteContact = useMutation(api.contacts.deleteContact);

  const shouldEdit = searchParams.get("edit") === "true";
  const [editing, setEditing] = useState(false);
  const [didAutoEdit, setDidAutoEdit] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (shouldEdit && contact && !didAutoEdit) {
      startEdit();
      setDidAutoEdit(true);
    }
  }, [shouldEdit, contact, didAutoEdit]); // eslint-disable-line react-hooks/exhaustive-deps
  const [saving, setSaving] = useState(false);
  const [editForm, setEditForm] = useState({
    name: "",
    companyName: "",
    phone: "",
    email: "",
    address: "",
    website: "",
    accountNumber: "",
    category: "",
    location: "",
    notes: "",
  });

  function startEdit() {
    if (!contact) return;
    setEditForm({
      name: contact.name ?? "",
      companyName: contact.companyName ?? "",
      phone: contact.phone ?? "",
      email: contact.email ?? "",
      address: contact.address ?? "",
      website: contact.website ?? "",
      accountNumber: contact.accountNumber ?? "",
      category: contact.category ?? "",
      location: contact.location ?? "",
      notes: contact.notes ?? "",
    });
    setEditing(true);
  }

  async function handleDelete() {
    if (!contact) return;
    setDeleting(true);
    try {
      await deleteContact({ contactId: contact._id });
      router.push("/contacts");
    } finally {
      setDeleting(false);
    }
  }

  async function handleSave() {
    if (!contact) return;
    setSaving(true);
    try {
      await updateContact({
        contactId: contact._id,
        name: editForm.name || undefined,
        companyName: editForm.companyName || undefined,
        phone: editForm.phone || undefined,
        email: editForm.email || undefined,
        address: editForm.address || undefined,
        website: editForm.website || undefined,
        accountNumber: editForm.accountNumber || undefined,
        category: editForm.category || undefined,
        location: editForm.location || undefined,
        notes: editForm.notes || undefined,
      });
      setEditing(false);
    } catch {
      // silently fail
    } finally {
      setSaving(false);
    }
  }

  if (contact === undefined) return <div className="page-loading">Loading...</div>;
  if (contact === null) return <div className="page-loading">Contact not found</div>;

  const approvedBills = (bills ?? []).filter(
    (b) => b.status === "done" || b.isApproved
  );

  return (
    <div className="page-shell">
      <NavBar
        items={[
          { label: "old-oak-horses", href: "/dashboard", brand: true },
          { label: "contacts", href: "/contacts" },
          { label: contact.name, current: true },
        ]}
      />
      <main className="page-main">
      <Link href="/contacts" className="ui-back-link">
        &larr; cd /contacts
      </Link>

      <div className={styles.header}>
        <div>
          <h1 className={styles.contactName}>{contact.name}</h1>
          <div className={styles.contactType}>
            {contact.category ? formatCategoryLabel(contact.category) : "contact"}
          </div>
        </div>
        {!editing && (
          <div style={{ display: "flex", gap: 8 }}>
            <button type="button" className={styles.deleteBtn} onClick={() => setShowDeleteModal(true)}>delete</button>
            <button type="button" className={styles.editBtn} onClick={startEdit}>edit</button>
          </div>
        )}
      </div>

      {/* Contact details */}
      <div className={styles.detailsCard}>
        {editing ? (
          <div className={styles.editGrid}>
            <div className={styles.editField}>
              <span className={styles.label}>NAME</span>
              <input className={styles.editInput} value={editForm.name} onChange={(e) => setEditForm((p) => ({ ...p, name: e.target.value }))} />
            </div>
            <div className={styles.editField}>
              <span className={styles.label}>COMPANY NAME</span>
              <input className={styles.editInput} value={editForm.companyName} onChange={(e) => setEditForm((p) => ({ ...p, companyName: e.target.value }))} />
            </div>
            <div className={styles.editField}>
              <span className={styles.label}>PHONE</span>
              <input className={styles.editInput} value={editForm.phone} onChange={(e) => setEditForm((p) => ({ ...p, phone: e.target.value }))} />
            </div>
            <div className={styles.editField}>
              <span className={styles.label}>EMAIL</span>
              <input className={styles.editInput} value={editForm.email} onChange={(e) => setEditForm((p) => ({ ...p, email: e.target.value }))} type="email" />
            </div>
            <div className={styles.editField}>
              <span className={styles.label}>ADDRESS</span>
              <input className={styles.editInput} value={editForm.address} onChange={(e) => setEditForm((p) => ({ ...p, address: e.target.value }))} />
            </div>
            <div className={styles.editField}>
              <span className={styles.label}>WEBSITE</span>
              <input className={styles.editInput} value={editForm.website} onChange={(e) => setEditForm((p) => ({ ...p, website: e.target.value }))} />
            </div>
            <div className={styles.editField}>
              <span className={styles.label}>ACCOUNT #</span>
              <input className={styles.editInput} value={editForm.accountNumber} onChange={(e) => setEditForm((p) => ({ ...p, accountNumber: e.target.value }))} />
            </div>
            <div className={styles.editField}>
              <span className={styles.label}>CATEGORY</span>
              <select className={styles.editInput} value={editForm.category} onChange={(e) => setEditForm((p) => ({ ...p, category: e.target.value }))}>
                <option value="">— select category —</option>
                <option value="veterinary">Veterinary</option>
                <option value="farrier">Farrier</option>
                <option value="stabling">Stabling</option>
                <option value="feed-bedding">Feed & Bedding</option>
                <option value="horse-transport">Horse Transport</option>
                <option value="bodywork">Bodywork</option>
                <option value="supplies">Supplies</option>
                <option value="travel">Travel</option>
                <option value="admin">Admin</option>
                <option value="dues-registrations">Dues & Registrations</option>
                <option value="marketing">Marketing</option>
                <option value="show-expenses">Show Expenses</option>
                <option value="grooming">Grooming</option>
                <option value="riding-training">Riding & Training</option>
                <option value="commissions">Commissions</option>
                <option value="prize-money">Prize Money</option>
                <option value="income">Income</option>
                <option value="equity">Equity</option>
              </select>
            </div>
            <div className={styles.editField}>
              <span className={styles.label}>LOCATION</span>
              <select className={styles.editInput} value={editForm.location} onChange={(e) => setEditForm((p) => ({ ...p, location: e.target.value }))}>
                <option value="">— select location —</option>
                <option value="wellington">Wellington</option>
                <option value="thermal">Thermal</option>
                <option value="ocala">Ocala</option>
                <option value="la">LA</option>
                <option value="eu">EU</option>
                <option value="can">Canada</option>
              </select>
            </div>
            <div className={styles.editField} style={{ gridColumn: "1 / -1" }}>
              <span className={styles.label}>NOTES</span>
              <textarea
                className={styles.editInput}
                value={editForm.notes}
                onChange={(e) => setEditForm((p) => ({ ...p, notes: e.target.value }))}
                rows={3}
                style={{ resize: "vertical", minHeight: 60, fontFamily: "inherit" }}
              />
            </div>
            <div style={{ gridColumn: "1 / -1", display: "flex", gap: 8, marginTop: 8 }}>
              <button type="button" className={styles.cancelBtn} onClick={() => setEditing(false)}>cancel</button>
              <button type="button" className={styles.saveBtn} disabled={saving} onClick={() => void handleSave()}>
                {saving ? "saving..." : "save"}
              </button>
            </div>
          </div>
        ) : (
          <div className={styles.detailsGrid}>
            {contact.companyName ? (
              <div><span className={styles.label}>COMPANY NAME</span><span className={styles.value}>{contact.companyName}</span></div>
            ) : null}
            {contact.phone ? (
              <div><span className={styles.label}>PHONE</span><span className={styles.value}>{contact.phone}</span></div>
            ) : null}
            {contact.email ? (
              <div><span className={styles.label}>EMAIL</span><span className={styles.value}>{contact.email}</span></div>
            ) : null}
            {contact.address ? (
              <div><span className={styles.label}>ADDRESS</span><span className={styles.value}>{contact.address}</span></div>
            ) : null}
            {contact.website ? (
              <div><span className={styles.label}>WEBSITE</span><span className={styles.value}>{contact.website}</span></div>
            ) : null}
            {contact.accountNumber ? (
              <div><span className={styles.label}>ACCOUNT #</span><span className={styles.value}>{contact.accountNumber}</span></div>
            ) : null}
            {contact.location ? (
              <div><span className={styles.label}>LOCATION</span><span className={styles.value}>{contact.location}</span></div>
            ) : null}
            {contact.notes ? (
              <div style={{ gridColumn: "1 / -1" }}><span className={styles.label}>NOTES</span><span className={styles.value} style={{ whiteSpace: "pre-wrap" }}>{contact.notes}</span></div>
            ) : null}
          </div>
        )}
      </div>

      {/* Stats */}
      <div className={styles.statsRow}>
        <div className={styles.statCard}>
          <div className={styles.statLabel}>TOTAL SPEND</div>
          <div className={styles.statValue}>{costSummary ? formatUsd(costSummary.totalSpend) : "..."}</div>
        </div>
        <div className={styles.statCard}>
          <div className={styles.statLabel}>INVOICES</div>
          <div className={styles.statValue}>{costSummary?.invoiceCount ?? "..."}</div>
        </div>
        <div className={styles.statCard}>
          <div className={styles.statLabel}>CATEGORIES</div>
          <div className={styles.statValue}>{costSummary?.categoryBreakdown.length ?? "..."}</div>
        </div>
      </div>

      {/* Category breakdown */}
      {costSummary && costSummary.categoryBreakdown.length > 0 ? (
        <>
          <div className={styles.sectionTitle}>SPEND BY CATEGORY</div>
          <div className={styles.breakdownCard}>
            {costSummary.categoryBreakdown.map((row) => {
              const colors = CATEGORY_COLORS[row.category] ?? { bg: "rgba(0,0,0,0.04)", color: "#666" };
              return (
                <div key={row.category} className={styles.breakdownRow}>
                  <span
                    className={styles.categoryPill}
                    style={{ background: colors.bg, color: colors.color }}
                  >
                    {formatCategoryLabel(row.category)}
                  </span>
                  <span className={styles.breakdownAmount}>{formatUsd(row.amount)}</span>
                </div>
              );
            })}
          </div>
        </>
      ) : null}

      {/* Invoices list */}
      <div className={styles.sectionTitle}>INVOICES</div>
      {approvedBills.length === 0 ? (
        <div className={styles.empty}>No approved invoices yet</div>
      ) : (
        <table className={styles.invoiceTable}>
          <thead>
            <tr>
              <th>INVOICE</th>
              <th>DATE</th>
              <th>CATEGORIES</th>
              <th style={{ textAlign: "right" }}>TOTAL</th>
            </tr>
          </thead>
          <tbody>
            {approvedBills.map((bill) => {
              const extracted = (bill.extractedData ?? {}) as Record<string, unknown>;
              const invoiceDate = typeof extracted.invoice_date === "string" ? extracted.invoice_date : null;
              const invoiceTotal = typeof extracted.invoice_total_usd === "number" ? extracted.invoice_total_usd : 0;
              const lineItemCats = (bill.lineItemCategories ?? []) as string[];

              return (
                <tr key={bill._id}>
                  <td>
                    <Link href={`/invoices/preview/${bill._id}`} className={styles.invoiceLink}>
                      {formatInvoiceName({
                        // Always render with the contact's current name — the
                        // bill's stored fileName/invoiceName may still reflect
                        // the contact the parser originally matched.
                        contactName: contact.name,
                        date: invoiceDate,
                      })}
                    </Link>
                  </td>
                  <td>{invoiceDate ?? "—"}</td>
                  <td>
                    {lineItemCats.length > 0
                      ? lineItemCats.map((cat) => {
                          const colors = CATEGORY_COLORS[cat] ?? { bg: "rgba(0,0,0,0.04)", color: "#666" };
                          return (
                            <span
                              key={cat}
                              className={styles.categoryPill}
                              style={{ background: colors.bg, color: colors.color, marginRight: 4 }}
                            >
                              {formatCategoryLabel(cat)}
                            </span>
                          );
                        })
                      : "—"}
                  </td>
                  <td className={styles.amountCell}>{formatUsd(invoiceTotal)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </main>

    <Modal
      open={showDeleteModal}
      title="delete contact"
      onClose={() => setShowDeleteModal(false)}
    >
      <p className={styles.deleteText}>
        Are you sure you want to delete <strong>{contact.name}</strong>? This cannot be undone. Any
        invoices already linked to this contact will keep their record but the contact will no longer
        appear anywhere.
      </p>
      <div className={styles.deleteActions}>
        <button type="button" className={styles.cancelBtn} onClick={() => setShowDeleteModal(false)}>
          cancel
        </button>
        <button type="button" className={styles.deleteBtn} onClick={() => void handleDelete()} disabled={deleting}>
          {deleting ? "deleting..." : "delete"}
        </button>
      </div>
    </Modal>
    </div>
  );
}
