"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import Modal from "@/components/Modal";
import NavBar from "@/components/NavBar";
import UnmatchedHorseBanner from "@/components/UnmatchedHorseBanner";
import styles from "./invoice.module.css";

type LineItem = {
  description?: string;
  horse_name?: string | null;
  total_usd?: number;
  auto_detected?: boolean;
};

export default function BodyworkInvoicePage() {
  const router = useRouter();
  const params = useParams<{ provider: string; billId: string }>();
  const providerSlugParam = params?.provider ?? "";
  const billId = params?.billId ?? "";

  const bill = useQuery(api.bills.getBillById, billId ? { billId: billId as any } : "skip");
  const provider = useQuery(
    api.providers.getProviderBySlug,
    providerSlugParam ? { categorySlug: "bodywork", providerSlug: providerSlugParam } : "skip"
  );
  const approveBill = useMutation(api.bills.approveBill);
  const deleteBill = useMutation(api.bills.deleteBill);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const extracted = (bill?.extractedData ?? {}) as Record<string, unknown>;
  const invoiceNumber = String(extracted.invoice_number ?? "invoice");
  const invoiceDate = formatDate(extracted.invoice_date);
  const dueDate = formatDate(extracted.due_date);
  const lineItems: LineItem[] = Array.isArray(extracted.line_items) ? (extracted.line_items as LineItem[]) : [];
  const providerSlug = provider?.slug ?? providerSlugParam;
  const providerName = provider?.name ?? provider?.fullName ?? providerSlugParam;

  const total =
    typeof extracted.invoice_total_usd === "number"
      ? extracted.invoice_total_usd
      : lineItems.reduce((sum, row) => sum + safeAmount(row.total_usd), 0);

  const grouped = useMemo(() => {
    const map = new Map<string, LineItem[]>();
    for (const row of lineItems) {
      const key = row.horse_name?.trim() || "Unassigned / General";
      map.set(key, [...(map.get(key) ?? []), row]);
    }
    return [...map.entries()].map(([horseName, items]) => ({
      horseName,
      items,
      subtotal: items.reduce((sum, item) => sum + safeAmount(item.total_usd), 0),
      autoDetected: items.some((item) => item.auto_detected === true)
    }));
  }, [lineItems]);

  async function onApprove() {
    if (!bill) return;
    await approveBill({ billId: bill._id });
  }

  async function onDelete() {
    if (!bill) return;
    await deleteBill({ billId: bill._id });
    router.push(`/bodywork/${providerSlug}`);
  }

  return (
    <div className="page-shell">
      <NavBar
        items={[
          { label: "old-oak-horses", href: "/dashboard", brand: true },
          { label: "bodywork", href: "/bodywork" },
          { label: providerSlug, href: `/bodywork/${providerSlug}` },
          { label: invoiceNumber, current: true }
        ]}
        actions={bill?.originalPdfUrl ? [{ label: "view original PDF", href: bill.originalPdfUrl, variant: "link", newTab: true }] : []}
      />

      <main className="page-main">
        <Link className="ui-back-link" href={`/bodywork/${providerSlug}`}>
          ← cd /{providerSlug}
        </Link>

        <section className={styles.headerCard}>
          <div>
            <div className={styles.invoiceLabel}>BODYWORK INVOICE</div>
            <h1 className={styles.providerName}>{providerName}</h1>
            <div className={styles.detailsRow}>
              <Detail label="INVOICE #" value={invoiceNumber} />
              <Detail label="DATE" value={invoiceDate} />
              <Detail label="DUE DATE" value={dueDate} />
            </div>
          </div>

          <div className={styles.totalRight}>
            <div className={styles.totalLabel}>INVOICE TOTAL</div>
            <div className={styles.totalAmount}>{fmtUSD(total)}</div>
            {bill?.originalCurrency && bill.originalCurrency !== "USD" && typeof bill.originalTotal === "number" ? (
              <div className={styles.totalMeta}>
                Originally {bill.originalCurrency} {bill.originalTotal.toFixed(2)}
                {typeof bill.exchangeRate === "number" ? ` (rate: ${bill.exchangeRate})` : ""}
              </div>
            ) : null}
          </div>
        </section>

        {bill?.hasUnmatchedHorses ? <UnmatchedHorseBanner billId={billId as any} unmatchedNames={bill.unmatchedHorseNames ?? []} /> : null}

        {grouped.map((group) => (
          <section key={group.horseName} className={styles.horseCard}>
            <div className={styles.horseCardHeader}>
              <div className={styles.horseLeft}>
                <span className={styles.horseEmoji}>🐴</span>
                <span className={styles.horseName}>{group.horseName}</span>
                {group.autoDetected ? <span className={styles.autoBadge}>auto</span> : null}
              </div>
              <div className={styles.horseRight}>
                <span className={styles.horseTotal}>{fmtUSD(group.subtotal)}</span>
                <button type="button" className={styles.horseEditBtn}>
                  edit
                </button>
              </div>
            </div>
            {group.items.map((item, index) => (
              <div key={`${group.horseName}-${index}`} className={styles.horseLine}>
                <span>{item.description || "—"}</span>
                <span className={styles.horseLineAmount}>{fmtUSD(safeAmount(item.total_usd))}</span>
              </div>
            ))}
          </section>
        ))}

        <div className={styles.approveDeleteRow}>
          {bill?.status === "done" ? (
            <div className={styles.approvedBar}>✓ invoice approved</div>
          ) : (
            <div style={{ flex: 1 }}>
              <button
                type="button"
                className={bill?.hasUnmatchedHorses ? styles.deleteBtn : styles.approveBtn}
                onClick={onApprove}
                disabled={Boolean(bill?.hasUnmatchedHorses)}
                style={bill?.hasUnmatchedHorses ? { background: "#E8EAF0", color: "#9EA2B0", borderColor: "#E8EAF0", cursor: "default" } : undefined}
              >
                {bill?.hasUnmatchedHorses ? "assign all horses before approving" : "approve invoice"}
              </button>
              {bill?.hasUnmatchedHorses ? (
                <div style={{ marginTop: 6, fontSize: 10, color: "#E5484D" }}>resolve all unmatched horses before approving</div>
              ) : null}
            </div>
          )}
          <button type="button" className={styles.deleteBtn} onClick={() => setShowDeleteConfirm(true)}>
            delete
          </button>
        </div>

        <section className={styles.footerBar}>
          <div className={styles.footerStats}>
            <Summary label="ITEMS" value={String(lineItems.length)} />
            <Summary
              label="HORSES"
              value={String(grouped.filter((group) => group.horseName !== "Unassigned / General").length)}
            />
            <Summary label="STATUS" value={bill?.status === "done" ? "APPROVED" : "PENDING"} />
          </div>
          <div className={styles.totalBlock}>
            <div className={styles.totalDueLabel}>TOTAL DUE</div>
            <div className={styles.totalDueValue}>{fmtUSD(total)}</div>
          </div>
        </section>

        <div className="ui-footer">OLD_OAK_HORSES // BODYWORK // {providerSlug.toUpperCase()}</div>

        <Modal open={showDeleteConfirm} title="delete invoice?" onClose={() => setShowDeleteConfirm(false)}>
          <p className={styles.modalText}>
            this will permanently delete invoice <strong>{invoiceNumber}</strong> from {providerName}. this action cannot be undone.
          </p>
          <div className={styles.modalActions}>
            <button type="button" className="ui-button-outlined" onClick={() => setShowDeleteConfirm(false)}>
              cancel
            </button>
            <button
              type="button"
              className="ui-button-danger"
              onClick={async () => {
                setShowDeleteConfirm(false);
                await onDelete();
              }}
            >
              yes, delete invoice
            </button>
          </div>
        </Modal>
      </main>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className={styles.detailLabel}>{label}</div>
      <div className={styles.detailValue}>{value}</div>
    </div>
  );
}

function Summary({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className={styles.footerStatLabel}>{label}</div>
      <div className={styles.footerStatValue}>{value}</div>
    </div>
  );
}

function fmtUSD(v: number) {
  return `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function safeAmount(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function formatDate(value: unknown) {
  if (typeof value !== "string" || !value) return "—";
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}
