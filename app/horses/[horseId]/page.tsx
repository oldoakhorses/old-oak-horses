"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { useSearchParams, useParams } from "next/navigation";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import NavBar from "@/components/NavBar";
import { formatInvoiceTitle, toIsoDateString } from "@/lib/invoiceTitle";
import styles from "./profile.module.css";

type FormState = {
  name: string;
  yearOfBirth: string;
  usefNumber: string;
  feiNumber: string;
  owner: string;
  status: "active" | "inactive";
};

export default function HorseProfilePage() {
  const params = useParams<{ horseId: string }>();
  const searchParams = useSearchParams();
  const horseId = params?.horseId as Id<"horses">;
  const startsInEditMode = searchParams.get("edit") === "1";

  const horse = useQuery(api.horses.getHorseById, horseId ? { horseId } : "skip");
  const summary = useQuery(api.horses.getHorseSpendSummary, horseId ? { horseId } : "skip");
  const updateHorseProfile = useMutation(api.horses.updateHorseProfile);
  const setHorseStatus = useMutation(api.horses.setHorseStatus);

  const [isEditing, setIsEditing] = useState(startsInEditMode);
  const [isSaving, setIsSaving] = useState(false);
  const [form, setForm] = useState<FormState>({
    name: "",
    yearOfBirth: "",
    usefNumber: "",
    feiNumber: "",
    owner: "",
    status: "active",
  });

  useEffect(() => {
    if (!horse) return;
    setForm({
      name: horse.name ?? "",
      yearOfBirth: horse.yearOfBirth ? String(horse.yearOfBirth) : "",
      usefNumber: horse.usefNumber ?? "",
      feiNumber: horse.feiNumber ?? "",
      owner: horse.owner ?? "",
      status: horse.status === "active" ? "active" : "inactive",
    });
  }, [horse]);

  if (horse === undefined || summary === undefined) {
    return (
      <div className="page-shell">
        <main className="page-main">
          <section className="ui-card">loading horse profile...</section>
        </main>
      </div>
    );
  }

  if (!horse || !summary) {
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
        usefNumber: form.usefNumber || undefined,
        feiNumber: form.feiNumber || undefined,
        owner: form.owner || undefined,
      });
      if (form.status !== horse.status) {
        await setHorseStatus({ horseId: horse._id, status: form.status, isSold: horse.isSold });
      }
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
        <Link href="/dashboard" className="ui-back-link">
          ← cd /dashboard
        </Link>

        <div className={styles.header}>
          <div className="ui-label">// horse profile</div>
          <div className={styles.titleRow}>
            <h1 className={styles.title}>{horse.name}</h1>
            {horse.isSold ? <span className={styles.soldBadge}>sold</span> : horse.status === "active" ? <span className={styles.activeBadge}>active</span> : <span className={styles.inactiveBadge}>inactive</span>}
          </div>
          <div className={styles.owner}>{horse.owner || "—"}</div>
        </div>

        <section className={styles.card}>
          <div className={styles.cardHead}>
            <div className={styles.cardTitle}>profile</div>
            {!isEditing ? (
              <button type="button" className="ui-button-outlined" onClick={() => setIsEditing(true)}>
                edit profile
              </button>
            ) : null}
          </div>

          <div className={styles.grid}>
            <Field label="NAME" editing={isEditing} value={horse.name}>
              <input value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} />
            </Field>
            <Field label="YEAR OF BIRTH" editing={isEditing} value={horse.yearOfBirth ? String(horse.yearOfBirth) : "—"}>
              <input value={form.yearOfBirth} onChange={(e) => setForm((p) => ({ ...p, yearOfBirth: e.target.value }))} />
            </Field>
            <Field label="USEF #" editing={isEditing} value={horse.usefNumber || "—"}>
              <input value={form.usefNumber} onChange={(e) => setForm((p) => ({ ...p, usefNumber: e.target.value }))} />
            </Field>
            <Field label="FEI #" editing={isEditing} value={horse.feiNumber || "—"}>
              <input value={form.feiNumber} onChange={(e) => setForm((p) => ({ ...p, feiNumber: e.target.value }))} />
            </Field>
            <Field label="OWNER" editing={isEditing} value={horse.owner || "—"}>
              <input value={form.owner} onChange={(e) => setForm((p) => ({ ...p, owner: e.target.value }))} />
            </Field>
            <Field label="STATUS" editing={isEditing} value={horse.isSold ? "sold" : horse.status}>
              <select value={form.status} onChange={(e) => setForm((p) => ({ ...p, status: e.target.value as "active" | "inactive" }))}>
                <option value="active">active</option>
                <option value="inactive">inactive</option>
              </select>
            </Field>
          </div>

          {isEditing ? (
            <div className={styles.actions}>
              <button type="button" className="ui-button-outlined" onClick={() => setIsEditing(false)}>
                cancel
              </button>
              <button type="button" className="ui-button-filled" onClick={onSave} disabled={isSaving}>
                {isSaving ? "saving..." : "save changes"}
              </button>
            </div>
          ) : null}
        </section>

        <section className={styles.card}>
          <div className={styles.cardTitle}>spend_summary</div>
          <div className={styles.totalSpend}>{formatUsd(summary.totalSpend)}</div>
          <div className={styles.breakdown}>
            {summary.byCategory.map((row) => (
              <div key={row.slug} className={styles.breakdownRow}>
                <span>{row.name}</span>
                <strong>{formatUsd(row.spend)}</strong>
              </div>
            ))}
          </div>
        </section>

        <section className={styles.card}>
          <div className={styles.cardTitle}>recent_invoices</div>
          <div className={styles.invoices}>
            {summary.recentInvoices.map((row) => (
              <Link key={row.billId} href={`/${row.categorySlug}/${row.providerSlug}/${row.billId}`} className={styles.invoiceRow}>
                <span>
                  {formatInvoiceTitle({
                    category: row.categorySlug,
                    providerName: row.providerName || row.providerSlug,
                    date: row.invoiceDate || "",
                  })}
                </span>
                <span>#{row.invoiceNumber} · {toIsoDateString(row.invoiceDate || "")}</span>
                <strong>{formatUsd(row.total)}</strong>
              </Link>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}

function Field({
  label,
  editing,
  value,
  children,
}: {
  label: string;
  editing: boolean;
  value: string;
  children: ReactNode;
}) {
  return (
    <div className={styles.field}>
      <div className={styles.fieldLabel}>{label}</div>
      {editing ? <div className={styles.fieldInput}>{children}</div> : <div className={styles.fieldValue}>{value}</div>}
    </div>
  );
}

function formatUsd(value: number) {
  return `$${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
