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
  stabling: "#A78BFA",
  bodywork: "#14B8A6",
  "horse-transport": "#EF4444",
  supplies: "#F97316",
  "grooming-supplies": "#F97316",
  supplements: "#34D399",
  insurance: "#0EA5E9",
  other: "#9EA2B0",
};

const STATUS_LABELS: Record<string, { label: string; color: string; bg: string }> = {
  draft: { label: "DRAFT", color: "#F59E0B", bg: "rgba(245,158,11,0.1)" },
  finalized: { label: "FINALIZED", color: "#4A5BDB", bg: "rgba(74,91,219,0.1)" },
  sent: { label: "SENT", color: "#14B8A6", bg: "rgba(20,184,166,0.1)" },
  paid: { label: "PAID", color: "#22C583", bg: "rgba(34,197,131,0.1)" },
};

function fmtUSD(amount: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(amount);
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
  const approveItem = useMutation(api.billing.approveLineItem);
  const approveAll = useMutation(api.billing.approveAllLineItems);
  const updateStatus = useMutation(api.billing.updateOwnerInvoiceStatus);
  const deleteInvoice = useMutation(api.billing.deleteOwnerInvoice);

  // Track which bill groups are expanded: key = "horseId:billId"
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

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
            <h1 className={styles.ownerName}>{invoice.ownerName}</h1>
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
              const displayName = billGroup.providerName
                ? `${billGroup.providerName}${billGroup.invoiceDate ? ` \u2014 ${fmtDate(billGroup.invoiceDate)}` : ""}`
                : billGroup.fileName;

              return (
                <div key={billGroup.billId} className={styles.billGroup}>
                  <div className={styles.billRow} onClick={() => toggleExpand(expandKey)}>
                    <span className={styles.expandArrow}>{isExpanded ? "▾" : "▸"}</span>
                    <div className={styles.billInfo}>
                      <div className={styles.billName}>{displayName}</div>
                      <div className={styles.billMeta}>
                        {billGroup.items.length} item{billGroup.items.length !== 1 ? "s" : ""}
                        {allBillApproved ? (
                          <span className={styles.allApprovedBadge}>✓ all approved</span>
                        ) : (
                          <span className={styles.pendingBadge}>
                            {billGroup.approvedCount}/{billGroup.items.length} approved
                          </span>
                        )}
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
                      {billGroup.items.map((item) => (
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
                            <div className={styles.lineItemDesc}>{item.description}</div>
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
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        ))}

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
