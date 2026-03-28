"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams, useParams } from "next/navigation";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { formatInvoiceTitle, toIsoDateString } from "@/lib/invoiceTitle";
import NavBar from "@/components/NavBar";
import FeedPlan from "./FeedPlan";
import styles from "./profile.module.css";

type InvoiceFilter = "all" | "pending" | "approved";

type FormState = {
  name: string;
  yearOfBirth: string;
  sex: "" | "gelding" | "mare" | "stallion";
  usefNumber: string;
  feiNumber: string;
  owner: string;
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
  const updateHorseProfile = useMutation(api.horses.updateHorseProfile);
  const addIncomeEntry = useMutation(api.incomeEntries.addEntry);
  const deleteIncomeEntry = useMutation(api.incomeEntries.deleteEntry);

  const [isEditing, setIsEditing] = useState(startsInEditMode);
  const [isSaving, setIsSaving] = useState(false);
  const [invoiceFilter, setInvoiceFilter] = useState<InvoiceFilter>("all");
  const [showAllInvoices, setShowAllInvoices] = useState(false);
  const [form, setForm] = useState<FormState>({
    name: "",
    yearOfBirth: "",
    sex: "",
    usefNumber: "",
    feiNumber: "",
    owner: "",
  });
  const [showPrizeForm, setShowPrizeForm] = useState(false);
  const [prizeForm, setPrizeForm] = useState<PrizeForm>({
    amount: "", description: "", showName: "", className: "", placing: "", date: "",
  });

  useEffect(() => {
    if (!horse) return;
    setForm({
      name: horse.name ?? "",
      yearOfBirth: horse.yearOfBirth ? String(horse.yearOfBirth) : "",
      sex: horse.sex ?? "",
      usefNumber: horse.usefNumber ?? "",
      feiNumber: horse.feiNumber ?? "",
      owner: horse.owner ?? "",
    });
  }, [horse]);

  const filteredInvoices = useMemo(() => {
    if (invoiceFilter === "all") return invoices;
    return invoices.filter((row) => row.status === invoiceFilter);
  }, [invoiceFilter, invoices]);

  const visibleInvoices = showAllInvoices ? filteredInvoices : filteredInvoices.slice(0, 10);

  if (horse === undefined || spendMeta === undefined || recordCounts === undefined) {
    return (
      <div className="page-shell">
        <main className="page-main">
          <section className="ui-card">loading horse profile...</section>
        </main>
      </div>
    );
  }

  if (!horse || !spendMeta || !recordCounts) {
    return (
      <div className="page-shell">
        <main className="page-main">
          <section className="ui-card">horse not found</section>
        </main>
      </div>
    );
  }

  async function onSave() {
    if (!horse) return;
    setIsSaving(true);
    try {
      await updateHorseProfile({
        horseId: horse._id,
        name: form.name || undefined,
        yearOfBirth: form.yearOfBirth ? Number(form.yearOfBirth) : undefined,
        sex: form.sex || undefined,
        usefNumber: form.usefNumber || undefined,
        feiNumber: form.feiNumber || undefined,
        owner: form.owner || undefined,
        prizeMoney: undefined,
      });
      setIsEditing(false);
    } finally {
      setIsSaving(false);
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
          { label: "upload invoices", href: "/upload", variant: "outlined" },
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
              {[horse.sex ? capitalize(horse.sex) : "", horse.owner ?? ""].filter(Boolean).join(" · ") || "—"}
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
            <Field label="OWNER" value={horse.owner || "—"} editing={isEditing}>
              <input value={form.owner} onChange={(event) => setForm((prev) => ({ ...prev, owner: event.target.value }))} />
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
            <div className={styles.invoiceTabs}>
              <button type="button" className={invoiceFilter === "all" ? styles.invoiceTabActive : styles.invoiceTab} onClick={() => setInvoiceFilter("all")}>
                All
              </button>
              <button type="button" className={invoiceFilter === "pending" ? styles.invoiceTabActive : styles.invoiceTab} onClick={() => setInvoiceFilter("pending")}>
                Pending
              </button>
              <button type="button" className={invoiceFilter === "approved" ? styles.invoiceTabActive : styles.invoiceTab} onClick={() => setInvoiceFilter("approved")}>
                Approved
              </button>
            </div>
          </div>
          {visibleInvoices.length === 0 ? (
            <div className={styles.emptyInvoices}>no invoices for this horse</div>
          ) : (
            visibleInvoices.map((row) => (
              <Link key={row._id} href={row.href} className={styles.invoiceRow}>
                <div className={styles.invoiceLeft}>
                  <span className={row.status === "approved" ? styles.dotApproved : styles.dotPending} />
                  <span className={styles.invoiceLabel}>
                    {formatInvoiceTitle({
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
          {filteredInvoices.length > 10 ? (
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
          <div className={styles.recordsTitle}>records</div>
          <RecordRow horseId={horse._id} type="veterinary" icon="📋" label="Veterinary Records" count={recordCounts.veterinary} />
          <RecordRow horseId={horse._id} type="farrier" icon="🔧" label="Farrier Records" count={recordCounts.farrier} />
          <RecordRow horseId={horse._id} type="health" icon="💉" label="Health & Vaccinations" count={recordCounts.health} />
          <RecordRow horseId={horse._id} type="registration" icon="📄" label="Registration Documents" count={recordCounts.registration} />
        </section>

        <FeedPlan horseId={horse._id} horseName={horse.name} />

        <div className="ui-footer">OLD_OAK_HORSES // HORSES // {horse.name.toUpperCase()}</div>
      </main>
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

function RecordRow({
  horseId,
  type,
  icon,
  label,
  count,
}: {
  horseId: Id<"horses">;
  type: string;
  icon: string;
  label: string;
  count: number;
}) {
  return (
    <div className={styles.recordRow}>
      <div className={styles.recordLeft}>
        <span className={styles.recordIcon}>{icon}</span>
        <span className={styles.recordLabel}>{label}</span>
      </div>
      <span className={styles.recordCount}>{count} record{count === 1 ? "" : "s"}</span>
      <Link href={`/horses/${horseId}/records/${type}`} className={styles.recordView}>
        view →
      </Link>
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
