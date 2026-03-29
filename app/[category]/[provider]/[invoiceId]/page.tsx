"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import LineItemReclassBadge from "@/components/LineItemReclassBadge";
import InvoiceNotesCard from "@/components/InvoiceNotesCard";
import LogRecordFromInvoice from "@/components/LogRecordFromInvoice";
import Modal from "@/components/Modal";
import NavBar from "@/components/NavBar";
import { formatInvoiceName } from "@/lib/formatInvoiceName";
import ReclassificationSummary from "@/components/ReclassificationSummary";
import SpendBar from "@/components/SpendBar";
import UnmatchedHorseBanner from "@/components/UnmatchedHorseBanner";
import styles from "./invoice.module.css";

type LineItem = {
  description?: string;
  horse_name?: string;
  horse_name_raw?: string;
  match_confidence?: string;
  matchConfidence?: string;
  vet_subcategory?: string;
  category?: string;
  subcategory?: string;
  assigneeId?: string;
  assigneeType?: string;
  horses?: string[];
  total_usd?: number;
  amount?: number;
};

type Extracted = {
  invoice_number?: string;
  invoice_date?: string;
  account_number?: string;
  client_name?: string;
  exchange_rate_used?: number;
  total_fees_usd?: number;
  total_vat_usd?: number;
  invoice_total_usd?: number;
  line_items?: LineItem[];
};

const subcategoryColors: Record<string, string> = {
  "Joint Injection": "#22C583",
  "Physical Exam": "#4A5BDB",
  Radiograph: "#A78BFA",
  Vaccine: "#F59E0B",
  "Dental Work": "#EF4444",
  Bloodwork: "#FBBF24",
  Lameness: "#14B8A6",
  Ultrasound: "#EC4899",
  Chiropractic: "#818CF8",
  Surgery: "#F87171",
  Medication: "#34D399",
  Sedation: "#2DD4BF",
};

export default function InvoiceReportPage() {
  const params = useParams<{ category: string; provider: string; invoiceId: string }>();
  const router = useRouter();
  const categorySlug = params?.category ?? "";
  const providerSlug = params?.provider ?? "";
  const invoiceId = params?.invoiceId ?? "";

  const provider = useQuery(api.providers.getProviderBySlug, categorySlug && providerSlug ? { categorySlug, providerSlug } : "skip");
  const bill = useQuery(api.bills.getBillById, invoiceId ? { billId: invoiceId as any } : "skip");
  const approveBill = useMutation(api.bills.approveBill);
  const approveInvoiceWithReclassification = useMutation(api.bills.approveInvoiceWithReclassification);
  const deleteBill = useMutation(api.bills.deleteBill);
  const [lineCategoryDecisions, setLineCategoryDecisions] = useState<Record<number, string | null>>({});
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  // Redirect to invoices page when bill is deleted (becomes null)
  useEffect(() => {
    if (bill === null && invoiceId) {
      router.replace("/invoices");
    }
  }, [bill, invoiceId, router]);

  const extracted = ((bill?.extractedData ?? {}) as Extracted) || {};
  const lineItems = Array.isArray(extracted.line_items) ? extracted.line_items : [];
  const isReclassCategory = categorySlug === "show-expenses";
  const isHorseBasedCategory = ["veterinary", "farrier", "stabling", "feed-bedding", "horse-transport", "bodywork", "show-expenses"].includes(categorySlug);
  const hasUnmatchedHorses = Boolean(isHorseBasedCategory && bill?.hasUnmatchedHorses);

  useEffect(() => {
    setLineCategoryDecisions(
      Object.fromEntries(lineItems.map((item, index) => [index, normalizeCategoryKey((item as any).confirmedCategory ?? (item as any).suggestedCategory)]))
    );
  }, [bill?._id, lineItems]);

  const horses = useQuery(api.horses.getAllHorses) ?? [];
  const people = useQuery(api.people.list) ?? [];

  const horseGroups = useMemo(() => {
    // Map lineItemIndex -> array of horse names (supports multiple horses per line)
    const haMap = new Map<number, string[]>();
    if (bill?.horseAssignments) {
      for (const ha of bill.horseAssignments) {
        const existing = haMap.get(ha.lineItemIndex) ?? [];
        existing.push(ha.horseName ?? "Unknown");
        haMap.set(ha.lineItemIndex, existing);
      }
    }
    const splitMap = new Map<number, string[]>();
    if (bill?.splitLineItems) {
      for (const s of bill.splitLineItems) {
        splitMap.set(s.lineItemIndex, s.splits?.map((sp: any) => sp.horseName ?? "Unknown") ?? []);
      }
    }

    // Build a per-horse split amount lookup: splitAmountMap[lineItemIndex][horseName] = amount
    const splitAmountMap = new Map<number, Map<string, number>>();
    if (bill?.splitLineItems) {
      for (const s of bill.splitLineItems) {
        const perHorse = new Map<string, number>();
        for (const sp of s.splits ?? []) {
          perHorse.set(sp.horseName ?? "Unknown", sp.amount ?? 0);
        }
        splitAmountMap.set(s.lineItemIndex, perHorse);
      }
    }

    const map = new Map<string, LineItem[]>();
    for (let i = 0; i < lineItems.length; i++) {
      const item = lineItems[i];
      if (splitMap.has(i)) {
        const names = splitMap.get(i)!;
        const perHorseAmounts = splitAmountMap.get(i);
        for (const name of names) {
          // Clone the line item but override amount with the per-horse split amount
          const splitAmount = perHorseAmounts?.get(name) ?? safeAmount(item.total_usd ?? item.amount) / names.length;
          const splitItem = { ...item, total_usd: splitAmount, amount: splitAmount, _isSplit: true };
          map.set(name, [...(map.get(name) ?? []), splitItem as LineItem]);
        }
        continue;
      }
      if (haMap.has(i)) {
        const names = haMap.get(i)!;
        if (names.length > 1) {
          // Multiple horses assigned to this line item — split the amount evenly
          const fullAmount = safeAmount(item.total_usd ?? item.amount);
          const perHorse = fullAmount / names.length;
          for (const name of names) {
            const splitItem = { ...item, total_usd: perHorse, amount: perHorse, _isSplit: true };
            map.set(name, [...(map.get(name) ?? []), splitItem as LineItem]);
          }
        } else {
          const name = names[0];
          map.set(name, [...(map.get(name) ?? []), item]);
        }
        continue;
      }
      const assigneeId = (item as any).assigneeId;
      const assigneeType = (item as any).assigneeType;
      if (assigneeType === "business_general") {
        map.set("Business / General", [...(map.get("Business / General") ?? []), item]);
      } else if (assigneeId && assigneeType === "horse") {
        const horse = horses.find((h) => String(h._id) === assigneeId);
        const name = horse?.name ?? item.horse_name?.trim() ?? "Unknown";
        map.set(name, [...(map.get(name) ?? []), item]);
      } else if (assigneeId && assigneeType === "person") {
        const person = people.find((p) => String(p._id) === assigneeId);
        const name = person?.name ?? "Unknown";
        map.set(name, [...(map.get(name) ?? []), item]);
      } else {
        const horse = item.horse_name?.trim() || "Unassigned";
        map.set(horse, [...(map.get(horse) ?? []), item]);
      }
    }
    return [...map.entries()].map(([horseName, items]) => ({
      horseName,
      items,
      subtotal: items.reduce((sum, item) => sum + safeAmount(item.total_usd ?? item.amount), 0),
    }));
  }, [lineItems, bill?.horseAssignments, bill?.splitLineItems, horses, people]);

  const total = useMemo(() => {
    if (typeof extracted.invoice_total_usd === "number") return extracted.invoice_total_usd;
    return lineItems.reduce((sum, item) => sum + safeAmount(item.total_usd ?? item.amount), 0);
  }, [extracted.invoice_total_usd, lineItems]);

  const subcategoryRows = useMemo(() => {
    const map = new Map<string, number>();
    for (const item of lineItems) {
      const key = item.subcategory?.trim() || item.vet_subcategory?.trim() || item.category?.trim() || "Other";
      const label = prettyCategoryLabel(key);
      map.set(label, (map.get(label) ?? 0) + safeAmount(item.total_usd ?? item.amount));
    }
    return [...map.entries()]
      .map(([name, amount]) => ({ name, amount, pct: total > 0 ? (amount / total) * 100 : 0 }))
      .sort((a, b) => b.amount - a.amount);
  }, [lineItems, total]);

  const fees = typeof extracted.total_fees_usd === "number" ? extracted.total_fees_usd : total;
  const vat = typeof extracted.total_vat_usd === "number" ? extracted.total_vat_usd : 0;
  const reclassification = useMemo(() => {
    const current = normalizeCategoryKey(categorySlug) ?? "";
    const grouped = new Map<string, Array<{ description: string; amount: number }>>();
    let remainingItems = 0;
    let remainingTotal = 0;
    for (let idx = 0; idx < lineItems.length; idx += 1) {
      const item = lineItems[idx] as any;
      const suggested = normalizeCategoryKey(item.suggestedCategory);
      const confirmed = normalizeCategoryKey(lineCategoryDecisions[idx]);
      const target = confirmed ?? suggested;
      const amount = safeAmount(item.total_usd);
      if (!target || target === current) {
        remainingItems += 1;
        remainingTotal += amount;
        continue;
      }
      const rows = grouped.get(target) ?? [];
      rows.push({ description: String(item.description ?? "Line item"), amount });
      grouped.set(target, rows);
    }
    const groups = [...grouped.entries()].map(([category, items]) => ({
      category,
      itemCount: items.length,
      total: round2(items.reduce((sum, row) => sum + row.amount, 0)),
      items
    }));
    groups.sort((a, b) => b.total - a.total);
    return {
      groups,
      movedCount: groups.reduce((sum, row) => sum + row.itemCount, 0),
      remainingItems,
      remainingTotal: round2(remainingTotal)
    };
  }, [categorySlug, lineCategoryDecisions, lineItems]);

  async function onApprove() {
    if (!bill) return;
    console.log("Approve clicked, billId:", bill._id);
    if (!isReclassCategory) {
      try {
        await approveBill({ billId: bill._id });
        console.log("Approve mutation succeeded");
      } catch (error) {
        console.error("Approve mutation failed:", error);
      }
      return;
    }
    try {
      await approveInvoiceWithReclassification({
        billId: bill._id,
        lineItemDecisions: lineItems.map((_, index) => ({
          lineItemIndex: index,
          confirmedCategory: lineCategoryDecisions[index] ?? undefined
        }))
      });
      console.log("Approve mutation succeeded");
    } catch (error) {
      console.error("Approve mutation failed:", error);
    }
  }

  async function onDelete() {
    if (!bill) return;
    await deleteBill({ billId: bill._id });
    router.push("/invoices");
  }

  return (
    <div className="page-shell">
      <NavBar
        items={[
          { label: "old-oak-horses", href: "/dashboard", brand: true },
          { label: categorySlug, href: `/${categorySlug}` },
          { label: providerSlug, href: `/${categorySlug}/${providerSlug}` },
          { label: formatInvoiceName({ providerName: String((extracted as any).provider_name ?? bill?.provider?.name ?? bill?.customProviderName ?? "Unassigned Invoice"), date: String((extracted as any).invoice_date ?? (extracted as any).invoiceDate ?? "") }), current: true },
        ]}
        actions={bill?.originalPdfUrl ? [{ label: "view original PDF", href: bill.originalPdfUrl, variant: "link", newTab: true }] : []}
      />

      <main className="page-main">
        <div className={styles.topRow}>
          <Link href={`/${categorySlug}/${providerSlug}`} className="ui-back-link">
            ← cd /{providerSlug}
          </Link>
          {bill?.status === "done" ? (
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <LogRecordFromInvoice
                billId={bill._id}
                categorySlug={categorySlug}
                providerName={provider?.fullName || provider?.name || providerSlug}
                invoiceDate={String(extracted.invoice_date ?? "")}
                assignedHorses={(bill.assignedHorses ?? []) as any}
                lineItems={lineItems}
              />
              <Link
                href={`/invoices/preview/${invoiceId}`}
                style={{
                  fontFamily: "inherit",
                  fontSize: 10,
                  padding: "6px 14px",
                  borderRadius: 6,
                  border: "1px solid #E8EAF0",
                  background: "transparent",
                  color: "#4A5BDB",
                  textDecoration: "none",
                }}
              >
                edit
              </Link>
            </div>
          ) : null}
        </div>

        <section className={styles.headerCard}>
          <div>
            <div className="ui-label">// {categorySlug} invoice</div>
            <h1 className={styles.providerName}>{provider?.fullName || provider?.name || providerSlug}</h1>
            <div className={styles.detailRow}>
              <Detail label="INVOICE #" value={extracted.invoice_number || "—"} />
              <Detail label="DATE" value={formatDate(extracted.invoice_date)} />
              <Detail label="ACCOUNT" value={extracted.account_number || provider?.accountNumber || "—"} />
              <Detail label="CLIENT" value={extracted.client_name || "—"} />
            </div>
            {typeof extracted.exchange_rate_used === "number" ? (
              <div className={styles.rate}>rate: 1 GBP = {extracted.exchange_rate_used.toFixed(2)} USD</div>
            ) : null}
          </div>

          <div className={styles.totalBox}>
            <div className="ui-label">INVOICE TOTAL</div>
            <div className={styles.total}>{fmtUSD(total)}</div>
            {bill?.originalCurrency && bill.originalCurrency !== "USD" && typeof bill.originalTotal === "number" ? (
              <div className={styles.totalMeta}>
                Originally {fmtMoney(bill.originalTotal, bill.originalCurrency)}
                {typeof bill.exchangeRate === "number" ? ` (rate: ${bill.exchangeRate})` : ""}
              </div>
            ) : null}
            <div className={styles.totalMeta}>fees: {fmtUSD(fees)} · vat: {fmtUSD(vat)}</div>
          </div>
        </section>

        <section className={styles.card}>
          <div className="ui-label">// report</div>
          <h2 className={styles.sectionTitle}>spend_by_subcategory</h2>
          <div className={styles.list}>
            {subcategoryRows.map((row) => (
              <SpendBar
                key={row.name}
                label={row.name}
                amount={fmtUSD(row.amount)}
                percentage={row.pct}
                color={subcategoryColors[row.name] ?? "#4A5BDB"}
              />
            ))}
          </div>
        </section>

        {hasUnmatchedHorses ? <UnmatchedHorseBanner billId={invoiceId as any} unmatchedNames={bill?.unmatchedHorseNames ?? []} /> : null}

        {horseGroups.map((group) => (
          <section key={group.horseName} className={styles.card}>
            <div className={styles.horseHead}>
              <div className={styles.horseLeft}>
                <div className={styles.horseAvatar}>🐴</div>
                <div>
                  {(() => {
                    const horse = horses.find((h) => h.name.toLowerCase() === group.horseName.toLowerCase());
                    return horse ? (
                      <Link href={`/horses/${horse._id}`} className={styles.horseName} style={{ textDecoration: "none", color: "inherit" }}>
                        {group.horseName}
                      </Link>
                    ) : (
                      <div className={styles.horseName}>{group.horseName}</div>
                    );
                  })()}
                  <div className={styles.horseMeta}>
                    {group.items.length} line items{horseGroups.length > 1 ? ` · ${((group.subtotal / total) * 100).toFixed(1)}% of invoice` : ""}
                  </div>
                </div>
              </div>
              <div>
                <div className="ui-label">SUBTOTAL</div>
                <div className={styles.subtotal}>{fmtUSD(group.subtotal)}</div>
              </div>
            </div>

            <div className={styles.itemList}>
              {group.items.map((item, idx) => (
                <div key={`${group.horseName}-${idx}`} className={styles.itemRow}>
                  <div>
                    <div className={styles.itemDesc}>{item.description || "—"}</div>
                    {(() => {
                      const cat = item.subcategory?.trim() || item.vet_subcategory?.trim() || item.category?.trim() || "";
                      const label = cat ? prettyCategoryLabel(cat) : "Other";
                      return (
                        <span className={styles.badge} style={{ background: subcategoryColors[label] ?? categoryBadgeColors[cat] ?? "#6B7084" }}>
                          {label}
                        </span>
                      );
                    })()}
                    {(() => {
                      const confidence = String((item as any).matchConfidence ?? (item as any).match_confidence ?? "").toLowerCase();
                      const raw = String((item as any).horse_name_raw ?? "").trim();
                      const parsedName = String((item as any).horse_name ?? "").trim();
                      if (confidence === "exact" || confidence === "alias") return <span className={styles.autoBadge}>auto</span>;
                      if (confidence === "fuzzy") {
                        return (
                          <span className={styles.inlineMeta}>
                            <span className={styles.fuzzyBadge}>fuzzy</span>
                            {raw && parsedName && normalize(raw) !== normalize(parsedName) ? <span className={styles.rawText}>(parsed as "{raw}")</span> : null}
                          </span>
                        );
                      }
                      if (confidence === "none" && raw) return <span className={styles.unmatchedBadge}>unmatched</span>;
                      return null;
                    })()}
                    {isReclassCategory ? (
                      <LineItemReclassBadge
                        currentCategory={normalizeCategoryKey(categorySlug) ?? categorySlug}
                        suggestedCategory={normalizeCategoryKey((item as any).suggestedCategory)}
                        confirmedCategory={lineCategoryDecisions[idx] ?? null}
                        onChange={(category) => setLineCategoryDecisions((prev) => ({ ...prev, [idx]: category }))}
                      />
                    ) : null}
                  </div>
                  <div className={styles.itemAmount}>
                    {fmtUSD(safeAmount(item.total_usd ?? item.amount))}
                    {(item as any)._isSplit ? <span className={styles.sharedBadge}>shared</span> : null}
                  </div>
                </div>
              ))}
            </div>
          </section>
        ))}

        {isReclassCategory ? (
          <ReclassificationSummary
            currentCategoryLabel={categorySlug}
            groups={reclassification.groups}
            remainingItems={reclassification.remainingItems}
            remainingTotal={reclassification.remainingTotal}
          />
        ) : null}

        <div style={{ marginTop: 24 }}>
          {bill ? <InvoiceNotesCard billId={bill._id} initialNotes={String(bill.notes ?? "")} /> : null}
        </div>

        <div style={{ marginTop: 16, marginBottom: 20, display: "flex", gap: 10, alignItems: "flex-start" }}>
          {bill?.status === "done" ? (
            <div className={styles.approvedBox}>
              ✓ invoice approved
            </div>
          ) : (
            <div style={{ flex: 1 }}>
              <button
                type="button"
                className="ui-button-filled"
                onClick={onApprove}
                disabled={hasUnmatchedHorses}
                style={{
                  width: "100%",
                  background: hasUnmatchedHorses ? "#E8EAF0" : "#22C583",
                  borderColor: hasUnmatchedHorses ? "#E8EAF0" : "#22C583",
                  color: hasUnmatchedHorses ? "#9EA2B0" : "#FFFFFF",
                  cursor: hasUnmatchedHorses ? "default" : "pointer"
                }}
              >
                {hasUnmatchedHorses
                  ? "assign all horses before approving"
                  : isReclassCategory && reclassification.movedCount > 0
                    ? `approve & move ${reclassification.movedCount} items`
                    : "approve invoice"}
              </button>
              {hasUnmatchedHorses ? (
                <div style={{ marginTop: 6, fontSize: 10, color: "#E5484D" }}>resolve all unmatched horses before approving</div>
              ) : null}
            </div>
          )}
          <button type="button" className="ui-button-outlined" onClick={() => setShowDeleteConfirm(true)}>
            delete
          </button>
        </div>

        <section className={styles.summaryBar}>
          <div className={styles.summaryLeft}>
            <Summary label="FEES" value={fmtUSD(fees)} />
            <Summary label="VAT" value={fmtUSD(vat)} />
            <Summary label="HORSES" value={String(horseGroups.length)} />
            <Summary label="LINE ITEMS" value={String(lineItems.length)} />
          </div>
          <div>
            <div className={styles.summaryLabel}>TOTAL DUE</div>
            <div className={styles.summaryTotal}>{fmtUSD(total)}</div>
          </div>
        </section>

        <div className="ui-footer">OLD_OAK_HORSES // {categorySlug.toUpperCase()} // {providerSlug.toUpperCase()}</div>

        <Modal open={showDeleteConfirm} title="delete invoice?" onClose={() => setShowDeleteConfirm(false)}>
          <p style={{ marginTop: 0, color: "var(--ui-text-secondary)" }}>
            this will permanently delete invoice <strong>{formatInvoiceName({ providerName: String((extracted as any).provider_name ?? bill?.provider?.name ?? bill?.customProviderName ?? "Unassigned Invoice"), date: String((extracted as any).invoice_date ?? (extracted as any).invoiceDate ?? "") })}</strong> from {provider?.name ?? providerSlug}.
          </p>
          <p style={{ color: "var(--ui-text-muted)" }}>this action cannot be undone.</p>
          {bill?.linkedBills?.length ? (
            <p style={{ color: "var(--ui-text-muted)" }}>This will also delete {bill.linkedBills.length} linked invoices created from reclassified items.</p>
          ) : null}
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
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
      <div className={styles.summaryLabel}>{label}</div>
      <div className={styles.summaryValue}>{value}</div>
    </div>
  );
}

function safeAmount(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function fmtUSD(v: number) {
  return `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtMoney(v: number, currency: string) {
  return `${currency} ${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatDate(value?: string) {
  if (!value) return "—";
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function normalizeCategoryKey(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase().replace(/-/g, "_");
  return normalized.length > 0 ? normalized : null;
}

function round2(value: number) {
  return Math.round(value * 100) / 100;
}

function normalize(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

const categoryBadgeColors: Record<string, string> = {
  veterinary: "rgba(74,91,219,0.15)",
  farrier: "rgba(20,184,166,0.15)",
  stabling: "rgba(245,158,11,0.15)",
  "feed-bedding": "rgba(107,112,132,0.18)",
  "horse-transport": "rgba(239,68,68,0.15)",
  bodywork: "rgba(167,139,250,0.15)",
  supplies: "rgba(56,189,248,0.15)",
  "show-expenses": "rgba(249,115,22,0.15)",
  travel: "rgba(168,85,247,0.15)",
  housing: "rgba(234,179,8,0.15)",
  admin: "rgba(107,114,128,0.15)",
  salaries: "rgba(16,185,129,0.15)",
  marketing: "rgba(236,72,153,0.15)",
  "dues-registrations": "rgba(99,102,241,0.15)",
};

function prettyCategoryLabel(slug: string): string {
  if (!slug) return "Other";
  return slug
    .replace(/[-_]/g, " ")
    .replace(/\b\w/g, (ch) => ch.toUpperCase());
}
