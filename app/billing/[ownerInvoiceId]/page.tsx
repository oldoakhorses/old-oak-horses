"use client";

import Link from "next/link";
import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import NavBar from "@/components/NavBar";
import styles from "./detail.module.css";

const CATEGORY_COLORS: Record<string, string> = {
  veterinary: "#22C583",
  farrier: "#F59E0B",
  "feed-bedding": "#4A5BDB",
  feed_bedding: "#4A5BDB",
  stabling: "#A78BFA",
  bodywork: "#14B8A6",
  "horse-transport": "#EF4444",
  horse_transport: "#EF4444",
  travel: "#EC4899",
  housing: "#A78BFA",
  supplies: "#F97316",
  "grooming-supplies": "#F97316",
  grooming: "#0EA5E9",
  supplements: "#34D399",
  insurance: "#0EA5E9",
  admin: "#6B7084",
  "show-expenses": "#4A5BDB",
  show_expenses: "#4A5BDB",
  "dues-registrations": "#4A5BDB",
  dues_registrations: "#4A5BDB",
  "riding-training": "#EC4899",
  marketing: "#A78BFA",
  commissions: "#6B7084",
  "prize-money": "#22C55E",
  income: "#16A34A",
  equity: "#8B5CF6",
  other: "#9EA2B0",
};

const STATUS_LABELS: Record<string, { label: string; color: string; bg: string }> = {
  draft: { label: "DRAFT", color: "#F59E0B", bg: "rgba(245,158,11,0.1)" },
  finalized: { label: "FINALIZED", color: "#4A5BDB", bg: "rgba(74,91,219,0.1)" },
  sent: { label: "SENT", color: "#14B8A6", bg: "rgba(20,184,166,0.1)" },
  paid: { label: "PAID", color: "#22C583", bg: "rgba(34,197,131,0.1)" },
};

function fmtUSD(amount: number) {
  const abs = Math.abs(amount);
  const formatted = `$${abs.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  return amount < 0 ? `(${formatted})` : formatted;
}

function fmtPeriod(period: string) {
  const [y, m] = period.split("-");
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${months[Number(m) - 1]} ${y}`;
}

function prettyCat(slug: string) {
  return slug.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function fmtDate(dateStr: string) {
  if (!dateStr) return "";
  try {
    const d = new Date(dateStr);
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  } catch {
    return dateStr;
  }
}

export default function OwnerInvoiceDetailPage() {
  const params = useParams();
  const router = useRouter();
  const ownerInvoiceId = params.ownerInvoiceId as Id<"ownerInvoices">;

  const invoice = useQuery(api.billing.getOwnerInvoice, { ownerInvoiceId });
  const availableCharges = useQuery(api.billing.getAvailableCharges, { ownerInvoiceId });
  const horses = useQuery(api.horses.getAllHorses) ?? [];
  const approveItem = useMutation(api.billing.approveLineItem);
  const approveAll = useMutation(api.billing.approveAllLineItems);
  const updateStatus = useMutation(api.billing.updateOwnerInvoiceStatus);
  const deleteInvoice = useMutation(api.billing.deleteOwnerInvoice);
  const addManualItem = useMutation(api.billing.addManualLineItem);
  const addBillCharges = useMutation(api.billing.addBillCharges);
  const deleteLineItem = useMutation(api.billing.deleteLineItem);
  const updateNotes = useMutation(api.billing.updateOwnerInvoiceNotes);
  const updateTitle = useMutation(api.billing.updateOwnerInvoiceTitle);
  const updateLineItemDesc = useMutation(api.billing.updateLineItemDescription);

  // Track which bill groups are expanded: key = "horseId:billId"
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [isEditing, setIsEditing] = useState(false);
  const [showAddModal, setShowAddModal] = useState<"charges" | "manual" | null>(null);
  const [manualForm, setManualForm] = useState({ description: "", amount: "", category: "", horseId: "" });
  const [addingCharge, setAddingCharge] = useState(false);
  const [editingNotes, setEditingNotes] = useState(false);
  const [notesValue, setNotesValue] = useState("");
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [editingItemDesc, setEditingItemDesc] = useState("");
  const [openMenuItemId, setOpenMenuItemId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleValue, setTitleValue] = useState("");

  function toggleExpand(key: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  if (invoice === undefined) {
    return (
      <div className="page-shell">
        <NavBar items={[{ label: "billing", href: "/billing" }, { label: "loading..." }]} />
        <main className="page-content">
          <div className={styles.loading}>loading...</div>
        </main>
      </div>
    );
  }

  if (invoice === null) {
    return (
      <div className="page-shell">
        <NavBar items={[{ label: "billing", href: "/billing" }, { label: "not found" }]} />
        <main className="page-content">
          <div className={styles.loading}>owner invoice not found</div>
        </main>
      </div>
    );
  }

  const statusInfo = STATUS_LABELS[invoice.status] ?? STATUS_LABELS.draft;
  const allApproved = invoice.approvedLineItemCount === invoice.lineItemCount;

  return (
    <div className="page-shell">
      <NavBar items={[{ label: "billing", href: "/billing" }, { label: invoice.ownerName }]} />
      <main className="page-content">
        {/* Header card */}
        <div className={styles.headerCard}>
          <div className={styles.headerLeft}>
            <div className={styles.headerLabel}>// OWNER INVOICE</div>
            {editingTitle ? (
              <input
                className={styles.titleInput}
                value={titleValue}
                onChange={(e) => setTitleValue(e.target.value)}
                onBlur={async () => {
                  if (titleValue.trim() !== (invoice.title ?? invoice.ownerName)) {
                    await updateTitle({ ownerInvoiceId, title: titleValue });
                  }
                  setEditingTitle(false);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                  if (e.key === "Escape") setEditingTitle(false);
                }}
                autoFocus
              />
            ) : (
              <h1
                className={`${styles.ownerName} ${invoice.status === "draft" ? styles.ownerNameEditable : ""}`}
                onClick={() => {
                  if (invoice.status === "draft") {
                    setEditingTitle(true);
                    setTitleValue(invoice.title ?? invoice.ownerName);
                  }
                }}
              >
                {invoice.title || invoice.ownerName}
              </h1>
            )}
            <div className={styles.headerMeta}>
              <span>{fmtPeriod(invoice.billingPeriod)}</span>
              <span>&middot;</span>
              <span>{invoice.lineItemCount} line item{invoice.lineItemCount !== 1 ? "s" : ""}</span>
              <span>&middot;</span>
              <span className={styles.statusBadge} style={{ color: statusInfo.color, background: statusInfo.bg }}>
                {statusInfo.label}
              </span>
            </div>
          </div>
          <div className={styles.headerRight}>
            <div className={styles.totalLabel}>TOTAL</div>
            <div className={styles.totalAmount}>{fmtUSD(invoice.totalAmount)}</div>
            <div className={styles.approvedLabel}>
              approved: {fmtUSD(invoice.approvedAmount)}
            </div>
          </div>
        </div>

        {/* Action buttons */}
        <div className={styles.actionsRow}>
          {!allApproved && invoice.status === "draft" ? (
            <button
              type="button"
              className={styles.btnApproveAll}
              onClick={() => approveAll({ ownerInvoiceId })}
            >
              approve all line items
            </button>
          ) : null}
          {invoice.status === "draft" && allApproved ? (
            <button
              type="button"
              className={styles.btnFinalize}
              onClick={() => updateStatus({ ownerInvoiceId, status: "finalized" })}
            >
              finalize invoice
            </button>
          ) : null}
          {invoice.status === "finalized" ? (
            <button
              type="button"
              className={styles.btnSent}
              onClick={() => updateStatus({ ownerInvoiceId, status: "sent" })}
            >
              mark as sent
            </button>
          ) : null}
          {invoice.status === "sent" ? (
            <button
              type="button"
              className={styles.btnPaid}
              onClick={() => updateStatus({ ownerInvoiceId, status: "paid" })}
            >
              mark as paid
            </button>
          ) : null}
          {invoice.status === "draft" ? (
            <button
              type="button"
              className={isEditing ? styles.btnEditActive : styles.btnEdit}
              onClick={() => setIsEditing(!isEditing)}
            >
              {isEditing ? "done editing" : "edit invoice"}
            </button>
          ) : null}
          <button
            type="button"
            className={styles.btnExport}
            onClick={() => {
              // Expand all bill groups before printing
              const allKeys = new Set<string>();
              for (const hg of invoice.byHorse) {
                for (const bg of hg.bills) {
                  allKeys.add(`${hg.horseId ?? "gen"}:${bg.billId}`);
                }
              }
              setExpanded(allKeys);
              setTimeout(() => window.print(), 100);
            }}
          >
            export PDF
          </button>
          <div style={{ flex: 1 }} />
          <button
            type="button"
            className={styles.btnDelete}
            onClick={async () => {
              if (window.confirm("Delete this owner invoice? This cannot be undone.")) {
                await deleteInvoice({ ownerInvoiceId });
                router.push("/billing");
              }
            }}
          >
            delete
          </button>
        </div>

        {/* Add charge buttons (only when editing) */}
        {isEditing ? (
          <div className={styles.addChargeRow}>
            <button type="button" className={styles.btnAddCharge} onClick={() => setShowAddModal("charges")}>
              + add from horse profile
            </button>
            <button type="button" className={styles.btnAddCharge} onClick={() => setShowAddModal("manual")}>
              + new line item
            </button>
          </div>
        ) : null}

        {/* Add from horse profile modal */}
        {showAddModal === "charges" ? (
          <div className={styles.modalOverlay} onClick={() => setShowAddModal(null)}>
            <div className={styles.modalContent} onClick={(e) => e.stopPropagation()}>
              <h3 className={styles.modalTitle}>Add charges from horse profile</h3>
              {!availableCharges?.length ? (
                <div className={styles.emptyState}>No available charges found</div>
              ) : (
                <div className={styles.chargesList}>
                  {availableCharges.map((charge) => (
                    <div key={`${charge.billId}-${charge.horseId}`} className={styles.chargeRow}>
                      <div className={styles.chargeInfo}>
                        <div className={styles.chargeName}>
                          {charge.contactName || charge.fileName}
                        </div>
                        <div className={styles.chargeMeta}>
                          🐴 {charge.horseName}
                          {charge.invoiceDate ? ` · ${fmtDate(charge.invoiceDate)}` : ""}
                          {charge.category ? (
                            <span className={styles.chargeCatPill} style={{ background: CATEGORY_COLORS[charge.category] ?? "#9EA2B0" }}>
                              {prettyCat(charge.category)}
                            </span>
                          ) : null}
                        </div>
                      </div>
                      <div className={styles.chargeAmount}>{fmtUSD(charge.amount)}</div>
                      <button
                        type="button"
                        className={styles.btnAddSmall}
                        disabled={addingCharge}
                        onClick={async () => {
                          setAddingCharge(true);
                          await addBillCharges({
                            ownerInvoiceId,
                            billId: charge.billId as Id<"bills">,
                            horseId: charge.horseId as Id<"horses">,
                            horseName: charge.horseName,
                            amount: charge.amount,
                            category: charge.category || undefined,
                          });
                          setAddingCharge(false);
                        }}
                      >
                        add
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <div className={styles.modalActions}>
                <button type="button" className={styles.btnCancel} onClick={() => setShowAddModal(null)}>done</button>
              </div>
            </div>
          </div>
        ) : null}

        {/* New manual line item modal */}
        {showAddModal === "manual" ? (
          <div className={styles.modalOverlay} onClick={() => setShowAddModal(null)}>
            <div className={styles.modalContent} onClick={(e) => e.stopPropagation()}>
              <h3 className={styles.modalTitle}>New line item</h3>
              <div className={styles.formField}>
                <label>Description</label>
                <input
                  type="text"
                  value={manualForm.description}
                  onChange={(e) => setManualForm({ ...manualForm, description: e.target.value })}
                  placeholder="e.g., Extra stall cleaning"
                />
              </div>
              <div className={styles.formField}>
                <label>Amount ($)</label>
                <input
                  type="number"
                  step="0.01"
                  value={manualForm.amount}
                  onChange={(e) => setManualForm({ ...manualForm, amount: e.target.value })}
                  placeholder="0.00"
                />
              </div>
              <div className={styles.formField}>
                <label>Horse (optional)</label>
                <select
                  value={manualForm.horseId}
                  onChange={(e) => setManualForm({ ...manualForm, horseId: e.target.value })}
                >
                  <option value="">— general / no horse —</option>
                  {horses.filter((h) => h.status === "active").map((h) => (
                    <option key={h._id} value={h._id}>{h.name}</option>
                  ))}
                </select>
              </div>
              <div className={styles.formField}>
                <label>Category (optional)</label>
                <select
                  value={manualForm.category}
                  onChange={(e) => setManualForm({ ...manualForm, category: e.target.value })}
                >
                  <option value="">— select category —</option>
                  {Object.keys(CATEGORY_COLORS).filter((k) => !k.includes("_")).map((k) => (
                    <option key={k} value={k}>{prettyCat(k)}</option>
                  ))}
                </select>
              </div>
              <div className={styles.modalActions}>
                <button type="button" className={styles.btnCancel} onClick={() => setShowAddModal(null)}>cancel</button>
                <button
                  type="button"
                  className={styles.btnSave}
                  disabled={!manualForm.description || !manualForm.amount}
                  onClick={async () => {
                    const horse = manualForm.horseId ? horses.find((h) => String(h._id) === manualForm.horseId) : null;
                    await addManualItem({
                      ownerInvoiceId,
                      description: manualForm.description,
                      amount: Number(manualForm.amount),
                      horseId: horse ? (horse._id as Id<"horses">) : undefined,
                      horseName: horse?.name,
                      category: manualForm.category || undefined,
                    });
                    setManualForm({ description: "", amount: "", category: "", horseId: "" });
                    setShowAddModal(null);
                  }}
                >
                  add line item
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {/* Line items grouped by horse, then by source invoice */}
        {invoice.byHorse.map((horseGroup) => (
          <div key={horseGroup.horseId ?? "__general__"} className={styles.horseCard}>
            <div className={styles.horseHeader}>
              <div className={styles.horseHeaderLeft}>
                <span className={styles.horseEmoji}>🐴</span>
                <div>
                  <div className={styles.horseName}>
                    {horseGroup.horseId ? (
                      <Link href={`/horses/${horseGroup.horseId}`} className={styles.horseLink}>{horseGroup.horseName}</Link>
                    ) : horseGroup.horseName}
                  </div>
                  <div className={styles.horseSub}>
                    {horseGroup.bills.length} invoice{horseGroup.bills.length !== 1 ? "s" : ""}
                  </div>
                </div>
              </div>
              <div className={styles.horseTotal}>
                {fmtUSD(horseGroup.total)}
              </div>
            </div>

            {/* Source invoices within this horse */}
            {horseGroup.bills.map((billGroup) => {
              const expandKey = `${horseGroup.horseId ?? "gen"}:${billGroup.billId}`;
              const isExpanded = expanded.has(expandKey);
              const allBillApproved = billGroup.approvedCount === billGroup.items.length;
              const displayName = (billGroup.invoiceName && billGroup.invoiceName.trim().length > 0)
                ? billGroup.invoiceName
                : billGroup.contactName
                  ? `${billGroup.contactName}${billGroup.invoiceDate ? ` \u2014 ${fmtDate(billGroup.invoiceDate)}` : ""}`
                  : billGroup.fileName;

              return (
                <div key={billGroup.billId} className={styles.billGroup}>
                  <div className={styles.billRow} onClick={() => toggleExpand(expandKey)}>
                    <span className={styles.expandArrow}>{isExpanded ? "▾" : "▸"}</span>
                    <div className={styles.billInfo}>
                      <div className={styles.billNameRow}>
                        <span className={styles.billName}>{displayName}</span>
                        {billGroup.category ? (
                          <span
                            className={styles.billCatPill}
                            style={{ background: CATEGORY_COLORS[billGroup.category] ?? "#9EA2B0" }}
                          >
                            {prettyCat(billGroup.subcategory || billGroup.category)}
                          </span>
                        ) : null}
                      </div>
                      <div className={styles.billMeta}>
                        {billGroup.items.length} item{billGroup.items.length !== 1 ? "s" : ""}
                        {allBillApproved ? (
                          <span className={styles.allApprovedBadge}>✓ all approved</span>
                        ) : (
                          <span className={styles.pendingBadge}>
                            {billGroup.approvedCount}/{billGroup.items.length} approved
                          </span>
                        )}
                        {billGroup.notes ? (
                          <span className={styles.billNotes}>{billGroup.notes}</span>
                        ) : null}
                      </div>
                    </div>
                    <Link
                      href={`/invoices/preview/${billGroup.billId}`}
                      className={styles.invoiceLink}
                      onClick={(e) => e.stopPropagation()}
                    >
                      view invoice
                    </Link>
                    <div className={styles.billTotal}>{fmtUSD(billGroup.total)}</div>
                  </div>

                  {isExpanded ? (
                    <div className={styles.lineItemsContainer}>
                      {billGroup.items.map((item) => {
                        const itemIdStr = String(item._id);
                        const canRename = invoice.status === "draft";
                        const isRenaming = editingItemId === itemIdStr;
                        const isMenuOpen = openMenuItemId === itemIdStr;
                        return (
                          <div key={item._id} className={`${styles.lineItemRow} ${item.isApproved ? styles.lineItemApproved : ""}`}>
                            <button
                              type="button"
                              className={`${styles.checkbox} ${item.isApproved ? styles.checkboxChecked : ""}`}
                              onClick={() => approveItem({ lineItemId: item._id, approved: !item.isApproved })}
                              disabled={invoice.status !== "draft"}
                            >
                              {item.isApproved ? "✓" : ""}
                            </button>
                            <div className={styles.lineItemInfo}>
                              {isRenaming ? (
                                <input
                                  className={styles.lineItemDescInput}
                                  value={editingItemDesc}
                                  onChange={(e) => setEditingItemDesc(e.target.value)}
                                  onBlur={async () => {
                                    if (editingItemDesc.trim() && editingItemDesc !== item.description) {
                                      await updateLineItemDesc({ lineItemId: item._id, description: editingItemDesc });
                                    }
                                    setEditingItemId(null);
                                  }}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                                    if (e.key === "Escape") setEditingItemId(null);
                                  }}
                                  autoFocus
                                />
                              ) : (
                                <div className={styles.lineItemDesc}>{item.description}</div>
                              )}
                              {item.category ? (
                                <span
                                  className={styles.catPill}
                                  style={{
                                    background: CATEGORY_COLORS[item.category] ?? "#9EA2B0",
                                  }}
                                >
                                  {prettyCat(item.subcategory ?? item.category)}
                                </span>
                              ) : null}
                            </div>
                            <div className={styles.lineItemAmount}>{fmtUSD(item.amount)}</div>
                            <div className={styles.lineItemMenuWrap}>
                              <button
                                type="button"
                                className={styles.btnMenuDots}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setOpenMenuItemId(isMenuOpen ? null : itemIdStr);
                                }}
                                title="More actions"
                                aria-label="More actions"
                              >
                                ⋯
                              </button>
                              {isMenuOpen ? (
                                <>
                                  <div
                                    className={styles.menuBackdrop}
                                    onClick={() => setOpenMenuItemId(null)}
                                  />
                                  <div className={styles.menuDropdown} onClick={(e) => e.stopPropagation()}>
                                    {canRename ? (
                                      <button
                                        type="button"
                                        className={styles.menuItem}
                                        onClick={() => {
                                          setEditingItemId(itemIdStr);
                                          setEditingItemDesc(item.description);
                                          setOpenMenuItemId(null);
                                        }}
                                      >
                                        edit name
                                      </button>
                                    ) : null}
                                    <button
                                      type="button"
                                      className={`${styles.menuItem} ${styles.menuItemDanger}`}
                                      onClick={async () => {
                                        setOpenMenuItemId(null);
                                        await deleteLineItem({ lineItemId: item._id });
                                      }}
                                    >
                                      remove from invoice
                                    </button>
                                  </div>
                                </>
                              ) : null}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        ))}

        {/* Notes section */}
        <div className={`${styles.notesCard} ${!invoice.notes ? styles.notesCardEmpty : ""}`}>
          <div className={styles.notesHeader}>
            <span className={styles.notesLabel}>Notes</span>
            {!editingNotes ? (
              <button
                type="button"
                className={styles.btnNotesEdit}
                onClick={() => { setEditingNotes(true); setNotesValue(invoice.notes ?? ""); }}
              >
                {invoice.notes ? "edit" : "+ add notes"}
              </button>
            ) : null}
          </div>
          {editingNotes ? (
            <div className={styles.notesEditArea}>
              <textarea
                className={styles.notesTextarea}
                value={notesValue}
                onChange={(e) => setNotesValue(e.target.value)}
                rows={4}
                placeholder="Add notes to this invoice..."
                autoFocus
              />
              <div className={styles.notesEditActions}>
                <button type="button" className={styles.btnCancel} onClick={() => setEditingNotes(false)}>cancel</button>
                <button
                  type="button"
                  className={styles.btnSave}
                  onClick={async () => {
                    await updateNotes({ ownerInvoiceId, notes: notesValue });
                    setEditingNotes(false);
                  }}
                >
                  save
                </button>
              </div>
            </div>
          ) : invoice.notes ? (
            <div className={styles.notesText}>{invoice.notes}</div>
          ) : (
            <div className={styles.notesEmpty}>no notes</div>
          )}
        </div>

        {/* Summary footer */}
        <div className={styles.summaryCard}>
          <div className={styles.summaryRow}>
            <span>Total line items</span>
            <span>{invoice.lineItemCount}</span>
          </div>
          <div className={styles.summaryRow}>
            <span>Approved</span>
            <span>{invoice.approvedLineItemCount} / {invoice.lineItemCount}</span>
          </div>
          <div className={styles.summaryRow}>
            <span>Approved amount</span>
            <span className={styles.summaryBold}>{fmtUSD(invoice.approvedAmount)}</span>
          </div>
          <div className={`${styles.summaryRow} ${styles.summaryTotal}`}>
            <span>Total</span>
            <span className={styles.summaryBold}>{fmtUSD(invoice.totalAmount)}</span>
          </div>
        </div>
      </main>
    </div>
  );
}
