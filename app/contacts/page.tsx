"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import NavBar from "@/components/NavBar";
import styles from "./contacts.module.css";

type LocationValue = "all" | "wellington" | "thermal" | "ocala" | "la" | "eu" | "can" | "ca" | "us" | "ky";
type SortColumn = "name" | "location" | "category" | null;
type SortDirection = "asc" | "desc";

type ContactFormState = {
  name: string;
  companyName: string;
  location: LocationValue;
  category: string;
  email: string;
  phone: string;
  address: string;
  website: string;
  accountNumber: string;
  notes: string;
};

const CATEGORY_OPTIONS = [
  { key: "veterinary", label: "Veterinary" },
  { key: "farrier", label: "Farrier" },
  { key: "stabling", label: "Stabling" },
  { key: "travel", label: "Travel" },
  { key: "bodywork", label: "Bodywork" },
  { key: "supplies", label: "Supplies" },
  { key: "admin", label: "Admin" },
  { key: "housing", label: "Housing" },
  { key: "feed_bedding", label: "Feed & Bedding" },
  { key: "horse_transport", label: "Horse Transport" },
  { key: "dues_registrations", label: "Dues & Registrations" },
  { key: "show_expenses", label: "Show Expenses" },
  { key: "marketing", label: "Marketing" },
];

const LOCATION_LABELS: Record<Exclude<LocationValue, "all">, string> = {
  wellington: "Wellington",
  thermal: "Thermal",
  ocala: "Ocala",
  la: "LA",
  eu: "EU",
  can: "CAN",
  ca: "CA",
  us: "US",
  ky: "KY",
};

const CATEGORY_COLORS: Record<string, { bg: string; color: string; label: string }> = {
  veterinary: { bg: "rgba(74,91,219,0.08)", color: "#4A5BDB", label: "Veterinary" },
  farrier: { bg: "rgba(20,184,166,0.08)", color: "#14B8A6", label: "Farrier" },
  stabling: { bg: "rgba(245,158,11,0.08)", color: "#F59E0B", label: "Stabling" },
  travel: { bg: "rgba(236,72,153,0.08)", color: "#EC4899", label: "Travel" },
  housing: { bg: "rgba(167,139,250,0.08)", color: "#A78BFA", label: "Housing" },
  horse_transport: { bg: "rgba(74,91,219,0.08)", color: "#4A5BDB", label: "Horse Transport" },
  marketing: { bg: "rgba(167,139,250,0.08)", color: "#A78BFA", label: "Marketing" },
  bodywork: { bg: "rgba(167,139,250,0.08)", color: "#A78BFA", label: "Bodywork" },
  feed_bedding: { bg: "rgba(34,197,131,0.08)", color: "#22C583", label: "Feed & Bedding" },
  admin: { bg: "rgba(107,112,132,0.08)", color: "#6B7084", label: "Admin" },
  dues_registrations: { bg: "rgba(74,91,219,0.08)", color: "#4A5BDB", label: "Dues & Registrations" },
  supplies: { bg: "rgba(107,112,132,0.08)", color: "#6B7084", label: "Supplies" },
};

const LOCATION_COLORS: Record<Exclude<LocationValue, "all">, { bg: string; color: string }> = {
  wellington: { bg: "rgba(74,91,219,0.08)", color: "#4A5BDB" },
  thermal: { bg: "rgba(245,158,11,0.08)", color: "#F59E0B" },
  ocala: { bg: "rgba(34,197,131,0.08)", color: "#22C583" },
  la: { bg: "rgba(236,72,153,0.08)", color: "#EC4899" },
  eu: { bg: "rgba(167,139,250,0.08)", color: "#A78BFA" },
  can: { bg: "rgba(20,184,166,0.08)", color: "#14B8A6" },
  ca: { bg: "rgba(99,102,241,0.08)", color: "#6366F1" },
  us: { bg: "rgba(59,130,246,0.08)", color: "#3B82F6" },
  ky: { bg: "rgba(132,204,22,0.08)", color: "#84CC16" },
};

const EMPTY_FORM: ContactFormState = {
  name: "",
  companyName: "",
  location: "all",
  category: "veterinary",
  email: "",
  phone: "",
  address: "",
  website: "",
  accountNumber: "",
  notes: "",
};

export default function ContactsPage() {
  const [tab, setTab] = useState<"active" | "invoice_only">("active");
  const [locationFilter, setLocationFilter] = useState<LocationValue>("all");
  const [search, setSearch] = useState("");
  const [sortColumn, setSortColumn] = useState<SortColumn>(null);
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  const [isAdding, setIsAdding] = useState(false);
  const router = useRouter();
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [form, setForm] = useState<ContactFormState>(EMPTY_FORM);
  const [error, setError] = useState<string>("");
  const [saving, setSaving] = useState(false);

  const contacts =
    useQuery(api.contacts.listContacts, {
      location: locationFilter,
    }) ?? [];

  const createContact = useMutation(api.contacts.createContact);
  const deleteContact = useMutation(api.contacts.deleteContact);
  const updateContact = useMutation(api.contacts.updateContact);

  const tabContacts = useMemo(() => {
    return contacts.filter((c) => {
      const status = (c as any).contactStatus ?? "active";
      return status === tab;
    });
  }, [contacts, tab]);

  const activeCount = useMemo(() => contacts.filter((c) => ((c as any).contactStatus ?? "active") === "active").length, [contacts]);
  const invoiceOnlyCount = useMemo(() => contacts.filter((c) => ((c as any).contactStatus) === "invoice_only").length, [contacts]);

  const filteredContacts = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return tabContacts;
    return tabContacts.filter((contact) => {
      const location = (contact.location as Exclude<LocationValue, "all"> | undefined) ?? "";
      const locationLabel = location ? LOCATION_LABELS[location] : "";
      const category = categoryLabel(contact.category ?? "");
      const haystack = [contact.name, locationLabel, category].join(" ").toLowerCase();
      return haystack.includes(query);
    });
  }, [tabContacts, search]);

  const sortedContacts = useMemo(() => {
    const rows = [...filteredContacts];
    if (!sortColumn) {
      return rows.sort((a, b) => a.name.localeCompare(b.name));
    }
    rows.sort((a, b) => {
      const aVal = getSortValue(a, sortColumn).toLowerCase();
      const bVal = getSortValue(b, sortColumn).toLowerCase();
      const cmp = aVal.localeCompare(bVal);
      return sortDirection === "asc" ? cmp : -cmp;
    });
    return rows;
  }, [filteredContacts, sortColumn, sortDirection]);

  function handleSort(column: Exclude<SortColumn, null>) {
    if (sortColumn === column) {
      if (sortDirection === "asc") {
        setSortDirection("desc");
      } else {
        setSortColumn(null);
        setSortDirection("asc");
      }
    } else {
      setSortColumn(column);
      setSortDirection("asc");
    }
  }

  function resetForm() {
    setForm(EMPTY_FORM);
    setError("");
  }

  function startAdd() {
    resetForm();
    setIsAdding(true);
  }

  function closeAdd() {
    setIsAdding(false);
    resetForm();
  }

  async function handleSaveContact(event: React.FormEvent) {
    event.preventDefault();
    if (!form.name.trim()) {
      setError("name is required");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const payload = {
        name: form.name,
        companyName: form.companyName || undefined,
        category: form.category,
        location: form.location === "all" ? undefined : (form.location as "wellington" | "thermal" | "ocala" | "la" | "eu" | "can" | "ca" | "us" | "ky"),
        phone: form.phone || undefined,
        email: form.email || undefined,
        address: form.address || undefined,
        website: form.website || undefined,
        accountNumber: form.accountNumber || undefined,
        notes: form.notes || undefined,
      };
      await createContact(payload);
      closeAdd();
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed to save contact");
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteContact(contactId: string) {
    setOpenMenuId(null);
    await deleteContact({ contactId: contactId as Id<"contacts"> });
  }

  function handleRowClick(contact: (typeof contacts)[number]) {
    const slug = contact.slug || String(contact._id);
    router.push(`/contacts/${slug}`);
  }

  return (
    <div className="page-shell">
      <NavBar
        items={[
          { label: "team-ldk", href: "/dashboard", brand: true },
          { label: "contacts", current: true },
        ]}
        actions={[
          { label: "upload invoices", href: "/dashboard?panel=invoice", variant: "outlined" },
        ]}
      />

      <main className="page-main">
        <Link href="/dashboard" className="ui-back-link">
          ← cd /dashboard
        </Link>

        <section className={styles.topRow}>
          <div>
            <div className="ui-label">// contacts</div>
            <h1 className={styles.title}>contacts</h1>
          </div>
          <button type="button" className={styles.addButton} onClick={startAdd}>
            + add contact
          </button>
        </section>

        <div className={styles.tabs} role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={tab === "active"}
            className={`${styles.tab} ${tab === "active" ? styles.tabActive : ""}`}
            onClick={() => setTab("active")}
          >
            Active <span className={styles.tabCount}>{activeCount}</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "invoice_only"}
            className={`${styles.tab} ${tab === "invoice_only" ? styles.tabActive : ""}`}
            onClick={() => setTab("invoice_only")}
          >
            Invoice Only <span className={styles.tabCount}>{invoiceOnlyCount}</span>
          </button>
        </div>

        <section className={styles.filters}>
          <label>
            <span>Location</span>
            <select
              value={locationFilter}
              onChange={(event) => setLocationFilter(event.target.value as LocationValue)}
            >
              <option value="all">All</option>
              <option value="wellington">Wellington</option>
              <option value="thermal">Thermal</option>
              <option value="ocala">Ocala</option>
              <option value="la">LA</option>
              <option value="eu">EU</option>
              <option value="can">CAN</option>
              <option value="ca">CA</option>
              <option value="us">US</option>
              <option value="ky">KY</option>
            </select>
          </label>
          <label>
            <span>Search</span>
            <input
              type="text"
              placeholder="search contacts..."
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
        </section>

        <section className={styles.contactsCard}>
          {isAdding ? (
            <form className={styles.newContactCard} onSubmit={handleSaveContact}>
              <div className={styles.newContactTitle}>+ new contact</div>
              <div className={styles.formGrid}>
                <Field label="NAME">
                  <input className={styles.fieldInput} value={form.name} onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))} required />
                </Field>
                <Field label="COMPANY NAME">
                  <input className={styles.fieldInput} value={form.companyName} onChange={(event) => setForm((prev) => ({ ...prev, companyName: event.target.value }))} />
                </Field>
                <Field label="PHONE">
                  <input className={styles.fieldInput} value={form.phone} onChange={(event) => setForm((prev) => ({ ...prev, phone: event.target.value }))} />
                </Field>
                <Field label="EMAIL">
                  <input className={styles.fieldInput} value={form.email} onChange={(event) => setForm((prev) => ({ ...prev, email: event.target.value }))} type="email" />
                </Field>
                <Field label="ADDRESS">
                  <input className={styles.fieldInput} value={form.address} onChange={(event) => setForm((prev) => ({ ...prev, address: event.target.value }))} />
                </Field>
                <Field label="WEBSITE">
                  <input className={styles.fieldInput} value={form.website} onChange={(event) => setForm((prev) => ({ ...prev, website: event.target.value }))} />
                </Field>
                <Field label="ACCOUNT #">
                  <input className={styles.fieldInput} value={form.accountNumber} onChange={(event) => setForm((prev) => ({ ...prev, accountNumber: event.target.value }))} />
                </Field>
                <Field label="CATEGORY">
                  <select className={styles.fieldInput} value={form.category} onChange={(event) => setForm((prev) => ({ ...prev, category: event.target.value }))}>
                    {CATEGORY_OPTIONS.map((row) => (
                      <option key={row.key} value={row.key}>
                        {row.label}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="LOCATION">
                  <select className={styles.fieldInput} value={form.location} onChange={(event) => setForm((prev) => ({ ...prev, location: event.target.value as LocationValue }))}>
                    <option value="all">select</option>
                    <option value="wellington">Wellington</option>
                    <option value="thermal">Thermal</option>
                    <option value="ocala">Ocala</option>
                    <option value="la">LA</option>
                    <option value="eu">EU</option>
                    <option value="can">CAN</option>
                    <option value="ca">CA</option>
                    <option value="us">US</option>
                    <option value="ky">KY</option>
                  </select>
                </Field>
              </div>
              <Field label="NOTES">
                <textarea
                  className={styles.fieldInput}
                  style={{ minHeight: 80, resize: "vertical" }}
                  value={form.notes}
                  onChange={(event) => setForm((prev) => ({ ...prev, notes: event.target.value }))}
                />
              </Field>
              {error ? <div className={styles.formError}>{error}</div> : null}
              <div className={styles.formActions}>
                <button type="button" className={styles.cancelButton} onClick={closeAdd}>
                  cancel
                </button>
                <button type="submit" className={styles.saveButton} disabled={saving}>
                  {saving ? "saving..." : "save contact"}
                </button>
              </div>
            </form>
          ) : null}

          <div className={styles.contactsHeader}>
            <button type="button" className={headerClass(sortColumn === "name", styles)} onClick={() => handleSort("name")}>
              NAME {sortArrow(sortColumn === "name", sortDirection, styles)}
            </button>
            <button type="button" className={headerClass(sortColumn === "location", styles)} onClick={() => handleSort("location")}>
              LOCATION {sortArrow(sortColumn === "location", sortDirection, styles)}
            </button>
            <button type="button" className={headerClass(sortColumn === "category", styles)} onClick={() => handleSort("category")}>
              CATEGORY {sortArrow(sortColumn === "category", sortDirection, styles)}
            </button>
            <div />
          </div>

          {sortedContacts.length === 0 ? (
            <div className={styles.emptyState}>
              <div className={styles.emptyTitle}>no contacts found</div>
              <div className={styles.emptySubtitle}>try adjusting your filters</div>
            </div>
          ) : (
            sortedContacts.map((contact) => {
              const contactId = String(contact._id);
              const location = contact.location as Exclude<LocationValue, "all"> | undefined;
              const categoryKey = contact.category?.toLowerCase() ?? "other";
              const categoryColor = CATEGORY_COLORS[categoryKey] ?? { bg: "rgba(107,112,132,0.08)", color: "#6B7084", label: titleCase(categoryKey) };
              return (
                <div key={contactId}>
                  <div
                    className={styles.contactRow}
                    onClick={() => handleRowClick(contact)}
                    style={{ cursor: "pointer" }}
                  >
                    <div>
                      <div className={styles.contactName}>{contact.name}</div>
                      {contact.email ? <div className={styles.contactEmail}>{contact.email}</div> : null}
                    </div>
                    <div>
                      {location ? (
                        <span className={styles.locationBadge} style={{ background: LOCATION_COLORS[location].bg, color: LOCATION_COLORS[location].color }}>
                          {LOCATION_LABELS[location]}
                        </span>
                      ) : (
                        <span className={styles.locationMissing}>—</span>
                      )}
                    </div>
                    <div>
                      <span className={styles.categoryBadge} style={{ background: categoryColor.bg, color: categoryColor.color }}>
                        {categoryColor.label}
                      </span>
                    </div>
                    <div className={styles.menuWrap} onClick={(event) => event.stopPropagation()}>
                      <button type="button" className={styles.rowMenuButton} onClick={() => setOpenMenuId((prev) => (prev === contactId ? null : contactId))}>
                        ⋮
                      </button>
                      {openMenuId === contactId ? (
                        <div className={styles.menuDropdown} onClick={(event) => event.stopPropagation()}>
                          <button
                            type="button"
                            className={styles.menuItem}
                            onClick={() => {
                              setOpenMenuId(null);
                              handleRowClick(contact);
                            }}
                          >
                            View Contact
                          </button>
                          <button
                            type="button"
                            className={styles.menuItem}
                            onClick={() => {
                              setOpenMenuId(null);
                              const slug = contact.slug || String(contact._id);
                              router.push(`/contacts/${slug}?edit=true`);
                            }}
                          >
                            Edit Contact
                          </button>
                          <button
                            type="button"
                            className={styles.menuItem}
                            onClick={async () => {
                              setOpenMenuId(null);
                              const currentStatus = (contact as any).contactStatus ?? "active";
                              const newStatus = currentStatus === "active" ? "invoice_only" : "active";
                              await updateContact({ contactId: contact._id, contactStatus: newStatus });
                            }}
                          >
                            {((contact as any).contactStatus ?? "active") === "active" ? "Move to Invoice Only" : "Move to Active"}
                          </button>
                          <div className={styles.menuDivider} />
                          <button type="button" className={`${styles.menuItem} ${styles.menuItemDanger}`} onClick={() => handleDeleteContact(contactId)}>
                            Delete
                          </button>
                        </div>
                      ) : null}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </section>
        <div className="ui-footer">TEAM_LDK // CONTACTS</div>
      </main>
    </div>
  );
}

function headerClass(active: boolean, css: Record<string, string>) {
  return active ? `${css.columnHeader} ${css.columnHeaderActive}` : css.columnHeader;
}

function sortArrow(active: boolean, direction: SortDirection, css: Record<string, string>) {
  if (!active) return null;
  return <span className={css.sortArrow}>{direction === "asc" ? "↑" : "↓"}</span>;
}

function getSortValue(contact: any, column: Exclude<SortColumn, null>) {
  if (column === "name") return contact.name ?? "";
  if (column === "location") {
    const location = contact.location as Exclude<LocationValue, "all"> | undefined;
    return location ? LOCATION_LABELS[location] : "";
  }
  return categoryLabel(contact.category ?? "");
}

function categoryLabel(value: string) {
  const key = (value ?? "").toLowerCase();
  return CATEGORY_COLORS[key]?.label ?? titleCase(key);
}

function titleCase(value: string) {
  return value
    .split(/[_-\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function Field({ label, children, fullWidth = false }: { label: string; children: React.ReactNode; fullWidth?: boolean }) {
  return (
    <label className={`${styles.fieldGroup} ${fullWidth ? styles.fieldGroupFull : ""}`}>
      <span className={styles.fieldLabel}>{label}</span>
      {children}
    </label>
  );
}

