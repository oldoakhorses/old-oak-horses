"use client";

import Link from "next/link";
import { useMemo, useState, type ReactNode } from "react";
import { useParams } from "next/navigation";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import InvoiceList, { type InvoiceListItem } from "@/components/InvoiceList";
import Modal from "@/components/Modal";
import NavBar from "@/components/NavBar";
import styles from "./provider.module.css";

type ContactFormState = {
  fullName: string;
  primaryContactName: string;
  primaryContactPhone: string;
  address: string;
  phone: string;
  email: string;
  accountNumber: string;
};

type ProviderInvoiceRow = {
  _id: Id<"bills">;
  fileName: string;
  horses: string[];
  total_usd: number;
  invoice_number: string;
  invoice_date: string | null;
  line_item_count: number;
};

export default function ProviderOverviewPage() {
  const params = useParams<{ category: string; provider: string }>();
  const categorySlug = params?.category ?? "";
  const providerSlug = params?.provider ?? "";

  const provider = useQuery(api.providers.getProviderBySlug, categorySlug && providerSlug ? { categorySlug, providerSlug } : "skip");
  const invoices = useQuery(api.bills.getBillsByProvider, provider ? { providerId: provider._id } : "skip");
  const stats = useQuery(api.bills.getProviderStats, provider ? { providerId: provider._id } : "skip");
  const updateProviderContact = useMutation(api.providers.updateProviderContact);

  const [showEditModal, setShowEditModal] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [contactForm, setContactForm] = useState<ContactFormState>({
    fullName: "",
    primaryContactName: "",
    primaryContactPhone: "",
    address: "",
    phone: "",
    email: "",
    accountNumber: "",
  });

  const listItems: InvoiceListItem[] = useMemo(() => {
    const rows = (invoices ?? []) as ProviderInvoiceRow[];
    return rows.map((invoice) => ({
      id: invoice._id,
      href: `/${categorySlug}/${providerSlug}/${invoice._id}`,
      invoiceNumber: invoice.invoice_number,
      invoiceDate: invoice.invoice_date,
      horses: invoice.horses,
      lineItemCount: invoice.line_item_count,
      fileName: invoice.fileName,
      amountUsd: invoice.total_usd,
    }));
  }, [categorySlug, invoices, providerSlug]);

  if (provider === undefined || invoices === undefined || stats === undefined) {
    return (
      <div className="page-shell">
        <main className="page-main">
          <section className="ui-card">loading provider...</section>
        </main>
      </div>
    );
  }

  if (provider === null) {
    return (
      <div className="page-shell">
        <main className="page-main">
          <section className="ui-card">provider not found</section>
        </main>
      </div>
    );
  }

  async function saveContactEdits() {
    if (!provider) return;
    setIsSaving(true);
    setSaveError("");
    try {
      await updateProviderContact({
        providerId: provider._id,
        fullName: emptyToUndefined(contactForm.fullName),
        primaryContactName: emptyToUndefined(contactForm.primaryContactName),
        primaryContactPhone: emptyToUndefined(contactForm.primaryContactPhone),
        address: emptyToUndefined(contactForm.address),
        phone: emptyToUndefined(contactForm.phone),
        email: emptyToUndefined(contactForm.email),
        accountNumber: emptyToUndefined(contactForm.accountNumber),
      });
      setShowEditModal(false);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Failed to update provider contact.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="page-shell">
      <NavBar
        items={[
          { label: "old-oak-horses", href: "/dashboard", brand: true },
          { label: categorySlug, href: `/${categorySlug}` },
          { label: providerSlug, current: true },
        ]}
        actions={[
          { label: "upload invoice", href: "/upload", variant: "outlined" },
          { label: "biz overview", href: "/biz-overview", variant: "filled" },
        ]}
      />

      <main className="page-main">
        <Link href={`/${categorySlug}`} className="ui-back-link">
          ← cd /{categorySlug}
        </Link>

        <section className={styles.headerCard}>
          <button
            type="button"
            className={styles.editButton}
            onClick={() => {
              setContactForm({
                fullName: provider.fullName ?? provider.name,
                primaryContactName: provider.primaryContactName ?? "",
                primaryContactPhone: provider.primaryContactPhone ?? "",
                address: provider.address ?? "",
                phone: provider.phone ?? "",
                email: provider.email ?? "",
                accountNumber: provider.accountNumber ?? "",
              });
              setShowEditModal(true);
            }}
          >
            edit
          </button>
          <div className="ui-label">// {categorySlug} provider</div>
          <h1 className={styles.providerName}>{provider.fullName || provider.name}</h1>
          <div className={styles.contactGrid}>
            <Info
              label="PRIMARY CONTACT"
              value={
                <span>
                  {provider.primaryContactName || "—"}
                  {provider.primaryContactPhone ? <a href={`tel:${provider.primaryContactPhone}`}> {provider.primaryContactPhone}</a> : null}
                </span>
              }
            />
            <Info label="ADDRESS" value={provider.address || "—"} />
            <Info label="PHONE" value={provider.phone ? <a href={`tel:${provider.phone}`}>{provider.phone}</a> : "—"} />
            <Info label="EMAIL" value={provider.email ? <a href={`mailto:${provider.email}`}>{provider.email}</a> : "—"} />
            <Info label="ACCOUNT #" value={provider.accountNumber || "—"} />
          </div>
        </section>

        <section className={styles.statsGrid}>
          <article className={styles.statCard}>
            <div className={styles.statLabel}>YTD SPEND ({stats.currentYear})</div>
            <div className={styles.statAmount}>{fmtUSD(stats.ytdSpend)}</div>
            <div className={styles.statSub}>{stats.ytdInvoices} invoices this year</div>
          </article>
          <article className={styles.statCard}>
            <div className={styles.statLabel}>TOTAL SPEND</div>
            <div className={styles.statAmount}>{fmtUSD(stats.totalSpend)}</div>
            <div className={styles.statSub}>{stats.totalInvoices} invoices total</div>
          </article>
        </section>

        <InvoiceList title="all_invoices" items={listItems} showProviderTag={false} searchPlaceholder="search by invoice #, date, or horse..." />

        <div className="ui-footer">OLD_OAK_HORSES // {categorySlug.toUpperCase()} // {providerSlug.toUpperCase()}</div>
      </main>

      <Modal open={showEditModal} title="edit contact details" onClose={() => setShowEditModal(false)}>
        <div className={styles.formGrid}>
          <Field label="FULL NAME">
            <input value={contactForm.fullName} onChange={(e) => setContactForm((p) => ({ ...p, fullName: e.target.value }))} className={styles.input} />
          </Field>
          <Field label="PRIMARY CONTACT NAME">
            <input
              value={contactForm.primaryContactName}
              onChange={(e) => setContactForm((p) => ({ ...p, primaryContactName: e.target.value }))}
              className={styles.input}
            />
          </Field>
          <Field label="PRIMARY CONTACT PHONE">
            <input
              value={contactForm.primaryContactPhone}
              onChange={(e) => setContactForm((p) => ({ ...p, primaryContactPhone: e.target.value }))}
              className={styles.input}
            />
          </Field>
          <Field label="ADDRESS">
            <input value={contactForm.address} onChange={(e) => setContactForm((p) => ({ ...p, address: e.target.value }))} className={styles.input} />
          </Field>
          <Field label="PHONE">
            <input value={contactForm.phone} onChange={(e) => setContactForm((p) => ({ ...p, phone: e.target.value }))} className={styles.input} />
          </Field>
          <Field label="EMAIL">
            <input value={contactForm.email} onChange={(e) => setContactForm((p) => ({ ...p, email: e.target.value }))} className={styles.input} />
          </Field>
          <Field label="ACCOUNT #">
            <input value={contactForm.accountNumber} onChange={(e) => setContactForm((p) => ({ ...p, accountNumber: e.target.value }))} className={styles.input} />
          </Field>
        </div>

        {saveError ? <p className={styles.error}>{saveError}</p> : null}

        <div className={styles.modalActions}>
          <button type="button" className="ui-button-outlined" onClick={() => setShowEditModal(false)}>
            cancel
          </button>
          <button type="button" className="ui-button-filled" onClick={saveContactEdits} disabled={isSaving}>
            {isSaving ? "saving..." : "save changes"}
          </button>
        </div>
      </Modal>
    </div>
  );
}

function Info({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className={styles.info}>
      <div className={styles.infoLabel}>{label}</div>
      <div className={styles.infoValue}>{value}</div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className={styles.field}>
      <span className={styles.fieldLabel}>{label}</span>
      {children}
    </label>
  );
}

function fmtUSD(v: number) {
  return `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function emptyToUndefined(value: string) {
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}
