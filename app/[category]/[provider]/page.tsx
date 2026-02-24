"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import styles from "./provider.module.css";

const ITEMS_PER_PAGE = 5;

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

  const [searchQuery, setSearchQuery] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
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
    accountNumber: ""
  });

  if (provider === undefined || invoices === undefined || stats === undefined) {
    return (
      <div className={styles.page}>
        <nav className={styles.nav} />
        <main className={styles.main}>
          <div className={styles.skeletonCard} />
          <div className={styles.skeletonStats}>
            <div className={styles.skeletonCard} />
            <div className={styles.skeletonCard} />
          </div>
          <div className={styles.skeletonCardTall} />
        </main>
      </div>
    );
  }

  if (provider === null) {
    return (
      <main className={styles.page}>
        <div className={styles.main}>
          <section className={styles.card}>Provider not found.</section>
        </div>
      </main>
    );
  }

  const allInvoices = invoices as ProviderInvoiceRow[];

  const filteredInvoices = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return allInvoices;

    return allInvoices.filter((invoice) => {
      const inInvoiceNumber = invoice.invoice_number.toLowerCase().includes(query);
      const inDate = (invoice.invoice_date ?? "").toLowerCase().includes(query);
      const inFileName = invoice.fileName.toLowerCase().includes(query);
      const inHorses = invoice.horses.some((horse) => horse.toLowerCase().includes(query));
      return inInvoiceNumber || inDate || inFileName || inHorses;
    });
  }, [allInvoices, searchQuery]);

  const totalPages = Math.max(1, Math.ceil(filteredInvoices.length / ITEMS_PER_PAGE));
  const safePage = Math.min(currentPage, totalPages);
  const start = (safePage - 1) * ITEMS_PER_PAGE;
  const end = start + ITEMS_PER_PAGE;
  const paginatedInvoices = filteredInvoices.slice(start, end);

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
        accountNumber: emptyToUndefined(contactForm.accountNumber)
      });
      setShowEditModal(false);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Failed to update provider contact.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className={styles.page}>
      <nav className={styles.nav}>
        <div className={styles.crumbs}>
          <Link href="/dashboard" className={styles.brand}>
            Old Oak Horses
          </Link>
          <span className={styles.divider}>/</span>
          <Link href={`/${categorySlug}`} className={styles.muted}>
            {provider.category?.name ?? categorySlug}
          </Link>
          <span className={styles.divider}>/</span>
          <span className={styles.current}>{provider.name}</span>
        </div>
        <div className={styles.actions}>
          <Link href="/upload" className={styles.uploadBtn}>
            Upload Invoice
          </Link>
          <Link href="/reports" className={styles.bizBtn}>
            Biz Overview
          </Link>
        </div>
      </nav>

      <main className={styles.main}>
        <Link href={`/${categorySlug}`} className={styles.backLink}>
          ← Back to {provider.category?.name ?? categorySlug}
        </Link>

        <section className={styles.card}>
          <button
            type="button"
            className={styles.editBtn}
            onClick={() => {
              setContactForm({
                fullName: provider.fullName ?? provider.name,
                primaryContactName: provider.primaryContactName ?? "",
                primaryContactPhone: provider.primaryContactPhone ?? "",
                address: provider.address ?? "",
                phone: provider.phone ?? "",
                email: provider.email ?? "",
                accountNumber: provider.accountNumber ?? ""
              });
              setShowEditModal(true);
            }}
          >
            Edit
          </button>
          <div className={styles.label}>{(provider.category?.name ?? categorySlug).toUpperCase()} PROVIDER</div>
          <h1 className={styles.providerName}>{provider.fullName || provider.name}</h1>
          <div className={styles.contactGrid}>
            <Info
              label="Primary Contact"
              value={
                <div>
                  <div>{provider.primaryContactName || "—"}</div>
                  {provider.primaryContactPhone ? <a href={`tel:${provider.primaryContactPhone}`}>{provider.primaryContactPhone}</a> : null}
                </div>
              }
            />
            <Info label="Address" value={provider.address || "—"} />
            <Info label="Phone" value={provider.phone ? <a href={`tel:${provider.phone}`}>{provider.phone}</a> : "—"} />
            <Info label="Email" value={provider.email ? <a href={`mailto:${provider.email}`}>{provider.email}</a> : "—"} />
            <Info label="Account #" value={provider.accountNumber || "—"} />
          </div>
        </section>

        <section className={styles.statsGrid}>
          <div className={styles.darkCard}>
            <div className={styles.darkLabel}>YTD SPEND ({stats.currentYear})</div>
            <div className={styles.darkAmount}>{fmtUSD(stats.ytdSpend)}</div>
            <div className={styles.darkSub}>{stats.ytdInvoices} invoices this year</div>
          </div>
          <div className={styles.card}>
            <div className={styles.label}>TOTAL SPEND</div>
            <div className={styles.totalAmount}>{fmtUSD(stats.totalSpend)}</div>
            <div className={styles.sub}>{stats.totalInvoices} invoices total</div>
          </div>
        </section>

        <section className={styles.card}>
          <div className={styles.invoiceHeader}>
            <h2 className={styles.invoiceTitle}>Invoices</h2>
            <div className={styles.searchWrap}>
              <span className={styles.searchIcon}>⌕</span>
              <input
                value={searchQuery}
                onChange={(event) => {
                  setSearchQuery(event.target.value);
                  setCurrentPage(1);
                }}
                placeholder="Search by invoice #, date, or horse..."
                className={styles.searchInput}
              />
            </div>
            <div className={styles.resultCount}>{filteredInvoices.length} RESULTS</div>
          </div>

          {filteredInvoices.length === 0 ? (
            <div className={styles.empty}>No invoices found matching "{searchQuery}"</div>
          ) : (
            <>
              {paginatedInvoices.map((invoice) => (
                <Link key={invoice._id} href={`/${categorySlug}/${providerSlug}/${invoice._id}`} className={styles.invoiceRow}>
                  <div className={styles.leftCol}>
                    <div className={styles.invoiceMeta}>
                      {invoice.invoice_number}
                      <span>{invoice.invoice_date ?? "No date"}</span>
                    </div>
                    <div className={styles.horsePills}>
                      {invoice.horses.map((horse) => (
                        <span key={horse} className={styles.pill}>
                          {horse}
                        </span>
                      ))}
                      <span className={styles.itemCount}>{invoice.line_item_count} items</span>
                    </div>
                  </div>
                  <div className={styles.rightCol}>
                    <div className={styles.invoiceAmount}>{fmtUSD(invoice.total_usd)}</div>
                    <span className={styles.chevron}>›</span>
                  </div>
                </Link>
              ))}

              {totalPages > 1 ? (
                <div className={styles.paginationRow}>
                  <span className={styles.pageMeta}>
                    Showing {start + 1}-{Math.min(end, filteredInvoices.length)} of {filteredInvoices.length}
                  </span>
                  <div className={styles.pageControls}>
                    <button
                      type="button"
                      onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                      className={styles.pageBtn}
                      disabled={safePage === 1}
                    >
                      ‹
                    </button>
                    {Array.from({ length: totalPages }, (_, idx) => idx + 1).map((page) => (
                      <button
                        key={page}
                        type="button"
                        className={page === safePage ? styles.pageBtnActive : styles.pageBtn}
                        onClick={() => setCurrentPage(page)}
                      >
                        {page}
                      </button>
                    ))}
                    <button
                      type="button"
                      onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                      className={styles.pageBtn}
                      disabled={safePage === totalPages}
                    >
                      ›
                    </button>
                  </div>
                </div>
              ) : null}
            </>
          )}
        </section>

        <footer className={styles.footer}>
          OLD OAK HORSES · {(provider.category?.name ?? categorySlug).toUpperCase()} · {provider.name.toUpperCase()}
        </footer>
      </main>

      {showEditModal ? (
        <div className={styles.modalBackdrop} onMouseDown={(event) => event.target === event.currentTarget && setShowEditModal(false)}>
          <div className={styles.modal}>
            <h3 className={styles.modalTitle}>Edit Contact Details</h3>
            <div className={styles.formGrid}>
              <Field label="Full Name">
                <input value={contactForm.fullName} onChange={(e) => setContactForm((p) => ({ ...p, fullName: e.target.value }))} />
              </Field>
              <Field label="Primary Contact Name">
                <input
                  value={contactForm.primaryContactName}
                  onChange={(e) => setContactForm((p) => ({ ...p, primaryContactName: e.target.value }))}
                />
              </Field>
              <Field label="Primary Contact Phone">
                <input
                  type="tel"
                  value={contactForm.primaryContactPhone}
                  onChange={(e) => setContactForm((p) => ({ ...p, primaryContactPhone: e.target.value }))}
                />
              </Field>
              <Field label="Address">
                <input value={contactForm.address} onChange={(e) => setContactForm((p) => ({ ...p, address: e.target.value }))} />
              </Field>
              <Field label="Phone">
                <input type="tel" value={contactForm.phone} onChange={(e) => setContactForm((p) => ({ ...p, phone: e.target.value }))} />
              </Field>
              <Field label="Email">
                <input type="email" value={contactForm.email} onChange={(e) => setContactForm((p) => ({ ...p, email: e.target.value }))} />
              </Field>
              <Field label="Account #">
                <input
                  value={contactForm.accountNumber}
                  onChange={(e) => setContactForm((p) => ({ ...p, accountNumber: e.target.value }))}
                />
              </Field>
            </div>
            {saveError ? <p className={styles.error}>{saveError}</p> : null}
            <div className={styles.modalActions}>
              <button type="button" className={styles.cancelBtn} onClick={() => setShowEditModal(false)}>
                Cancel
              </button>
              <button type="button" className={styles.saveBtn} disabled={isSaving} onClick={saveContactEdits}>
                {isSaving ? "Saving..." : "Save Changes"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Info({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className={styles.info}>
      <div className={styles.infoLabel}>{label}</div>
      <div className={styles.infoValue}>{value}</div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className={styles.field}>
      <span>{label}</span>
      {children}
    </label>
  );
}

function fmtUSD(v: number) {
  return `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function emptyToUndefined(value: string) {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}
