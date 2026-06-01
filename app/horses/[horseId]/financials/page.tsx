"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { formatInvoiceDate, formatInvoiceName, toIsoDateString } from "@/lib/formatInvoiceName";
import NavBar from "@/components/NavBar";
import { useAuth } from "@/contexts/AuthContext";
import styles from "./financials.module.css";

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

type PrizeForm = {
  amount: string;
  description: string;
  showName: string;
  className: string;
  placing: string;
  date: string;
};

const EMPTY_PRIZE: PrizeForm = { amount: "", description: "", showName: "", className: "", placing: "", date: "" };

export default function FinancialsPage() {
  const { user } = useAuth();
  const params = useParams<{ horseId: string }>();
  const horseId = params?.horseId as Id<"horses">;

  const horse = useQuery(api.horses.getHorseById, horseId ? { horseId } : "skip");
  const spendMeta = useQuery(api.horses.getHorseSpendMeta, horseId ? { horseId } : "skip");
  const spendByCategory = useQuery(api.horses.getHorseSpendByCategory, horseId ? { horseId } : "skip") ?? [];
  const invoices = useQuery(api.horses.getInvoicesByHorse, horseId ? { horseId } : "skip") ?? [];
  const prizeMoneyData = useQuery(api.incomeEntries.getHorsePrizeMoney, horseId ? { horseId } : "skip");

  const addIncomeEntry = useMutation(api.incomeEntries.addEntry);
  const deleteIncomeEntry = useMutation(api.incomeEntries.deleteEntry);

  const [showAllInvoices, setShowAllInvoices] = useState(false);
  const [showPrizeForm, setShowPrizeForm] = useState(false);
  const [prizeForm, setPrizeForm] = useState<PrizeForm>(EMPTY_PRIZE);

  const visibleInvoices = useMemo(
    () => (showAllInvoices ? invoices : invoices.slice(0, 10)),
    [invoices, showAllInvoices],
  );

  if (!horse || !spendMeta) return null;

  const isTeam = user?.role === "team";
  if (isTeam) return null;

  return (
    <div className="page-shell">
      <NavBar
        items={[
          { label: "old-oak-horses", href: "/dashboard", brand: true },
          { label: "horses", href: "/horses" },
          { label: horse.name, href: `/horses/${horse._id}` },
          { label: "financials", current: true },
        ]}
      />
      <main className="page-main">
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
                  <div className={styles.invoiceLabelBlock}>
                    <span className={styles.invoiceLabel}>
                      {formatInvoiceName({
                        invoiceName: row.invoiceName,
                        category: row.category,
                        contactName: row.contactName,
                        date: toIsoDateString(row.date || ""),
                      })}
                    </span>
                    {row.date ? (
                      <span className={styles.invoiceMeta}>{formatInvoiceDate(row.date) ?? ""}</span>
                    ) : null}
                  </div>
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
                setPrizeForm(EMPTY_PRIZE);
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

        <div className="ui-footer">OLD_OAK_HORSES // HORSES // {horse.name.toUpperCase()} // FINANCIALS</div>
      </main>
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
