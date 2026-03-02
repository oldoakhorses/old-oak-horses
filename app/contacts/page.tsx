"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import NavBar from "@/components/NavBar";
import styles from "./contacts.module.css";

type LocationValue = "all" | "wellington" | "thermal" | "ocala" | "la" | "eu" | "can";

type ContactFormState = {
  name: string;
  providerName: string;
  providerId: string;
  location: LocationValue;
  category: string;
  email: string;
  phone: string;
  role: string;
};

const CATEGORY_TABS = [
  { key: "all", label: "All" },
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
];

const LOCATION_LABELS: Record<Exclude<LocationValue, "all">, string> = {
  wellington: "Wellington",
  thermal: "Thermal",
  ocala: "Ocala",
  la: "LA",
  eu: "EU",
  can: "CAN",
};

const CATEGORY_COLORS: Record<string, { bg: string; color: string; label: string }> = {
  veterinary: { bg: "rgba(74,91,219,0.08)", color: "#4A5BDB", label: "Veterinary" },
  farrier: { bg: "rgba(20,184,166,0.08)", color: "#14B8A6", label: "Farrier" },
  stabling: { bg: "rgba(245,158,11,0.08)", color: "#F59E0B", label: "Stabling" },
  travel: { bg: "rgba(236,72,153,0.08)", color: "#EC4899", label: "Travel" },
  housing: { bg: "rgba(167,139,250,0.08)", color: "#A78BFA", label: "Housing" },
  show_expenses: { bg: "rgba(236,72,153,0.08)", color: "#EC4899", label: "Show Expenses" },
  horse_transport: { bg: "rgba(74,91,219,0.08)", color: "#4A5BDB", label: "Horse Transport" },
  marketing: { bg: "rgba(167,139,250,0.08)", color: "#A78BFA", label: "Marketing" },
  bodywork: { bg: "rgba(167,139,250,0.08)", color: "#A78BFA", label: "Bodywork" },
  feed_bedding: { bg: "rgba(34,197,131,0.08)", color: "#22C583", label: "Feed & Bedding" },
  admin: { bg: "rgba(107,112,132,0.08)", color: "#6B7084", label: "Admin" },
  dues_registrations: { bg: "rgba(74,91,219,0.08)", color: "#4A5BDB", label: "Dues & Registrations" },
};

const LOCATION_COLORS: Record<Exclude<LocationValue, "all">, { bg: string; color: string }> = {
  wellington: { bg: "rgba(74,91,219,0.08)", color: "#4A5BDB" },
  thermal: { bg: "rgba(245,158,11,0.08)", color: "#F59E0B" },
  ocala: { bg: "rgba(34,197,131,0.08)", color: "#22C583" },
  la: { bg: "rgba(236,72,153,0.08)", color: "#EC4899" },
  eu: { bg: "rgba(167,139,250,0.08)", color: "#A78BFA" },
  can: { bg: "rgba(20,184,166,0.08)", color: "#14B8A6" },
};

const EMPTY_FORM: ContactFormState = {
  name: "",
  providerName: "",
  providerId: "",
  location: "all",
  category: "veterinary",
  email: "",
  phone: "",
  role: "",
};

export default function ContactsPage() {
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [locationFilter, setLocationFilter] = useState<LocationValue>("all");
  const [isAdding, setIsAdding] = useState(false);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [editingContactId, setEditingContactId] = useState<string | null>(null);
  const [form, setForm] = useState<ContactFormState>(EMPTY_FORM);
  const [error, setError] = useState<string>("");
  const [saving, setSaving] = useState(false);

  const contacts =
    useQuery(api.contacts.listContacts, {
      category: categoryFilter === "all" ? undefined : categoryFilter,
      location: locationFilter,
    }) ?? [];
  const providers = useQuery(api.providers.getAllProvidersWithCategory) ?? [];

  const createContact = useMutation(api.contacts.createContact);
  const updateContact = useMutation(api.contacts.updateContact);
  const deleteContact = useMutation(api.contacts.deleteContact);

  const sortedContacts = useMemo(
    () =>
      [...contacts].sort((a, b) => {
        const aName = a.name.toLowerCase();
        const bName = b.name.toLowerCase();
        if (aName !== bName) return aName.localeCompare(bName);
        return b.createdAt - a.createdAt;
      }),
    [contacts]
  );

  const providerLookup = useMemo(() => {
    return new Map(providers.map((provider) => [String(provider._id), provider]));
  }, [providers]);

  function resetForm() {
    setForm(EMPTY_FORM);
    setError("");
    setEditingContactId(null);
  }

  function startAdd() {
    resetForm();
    setIsAdding(true);
  }

  function closeAdd() {
    setIsAdding(false);
    resetForm();
  }

  function startEdit(contact: (typeof contacts)[number]) {
    setEditingContactId(String(contact._id));
    setIsAdding(true);
    setError("");
    setForm({
      name: contact.name,
      providerName: contact.providerName ?? contact.company ?? "",
      providerId: contact.providerId ? String(contact.providerId) : "",
      location: (contact.location as LocationValue | undefined) ?? "all",
      category: contact.category ?? "veterinary",
      email: contact.email ?? "",
      phone: contact.phone ?? "",
      role: contact.role ?? "",
    });
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
      const matchedProvider = providers.find((provider) => provider.name.toLowerCase() === form.providerName.trim().toLowerCase());
      const providerId = (form.providerId || matchedProvider?._id) ? ((form.providerId || matchedProvider?._id) as Id<"providers">) : undefined;
      const payload = {
        name: form.name,
        role: form.role || undefined,
        providerId,
        providerName: form.providerName || matchedProvider?.name || undefined,
        category: form.category,
        location: form.location === "all" ? undefined : (form.location as "wellington" | "thermal" | "ocala" | "la" | "eu" | "can"),
        phone: form.phone || undefined,
        email: form.email || undefined,
      };
      if (editingContactId) {
        await updateContact({
          contactId: editingContactId as Id<"contacts">,
          ...payload,
        });
      } else {
        await createContact(payload);
      }
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

  return (
    <div className="page-shell">
      <NavBar
        items={[
          { label: "old-oak-horses", href: "/dashboard", brand: true },
          { label: "contacts", current: true },
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

        <section className={styles.topRow}>
          <div>
            <div className="ui-label">// contacts</div>
            <h1 className={styles.title}>contacts</h1>
          </div>
          <button type="button" className={styles.addButton} onClick={startAdd}>
            + add contact
          </button>
        </section>

        <section className={styles.filters}>
          <div className={styles.categoryTabs}>
            {CATEGORY_TABS.map((tab) => (
              <button
                key={tab.key}
                type="button"
                className={tab.key === categoryFilter ? styles.categoryTabActive : styles.categoryTab}
                onClick={() => setCategoryFilter(tab.key)}
              >
                {tab.label}
              </button>
            ))}
          </div>
          <select
            className={styles.locationFilter}
            value={locationFilter}
            onChange={(event) => setLocationFilter(event.target.value as LocationValue)}
          >
            <option value="all">All Locations</option>
            <option value="wellington">Wellington</option>
            <option value="thermal">Thermal</option>
            <option value="ocala">Ocala</option>
            <option value="la">LA</option>
            <option value="eu">EU</option>
            <option value="can">CAN</option>
          </select>
        </section>

        <section className={styles.contactsCard}>
          {isAdding ? (
            <form className={styles.newContactCard} onSubmit={handleSaveContact}>
              <div className={styles.newContactTitle}>+ new contact</div>
              <div className={styles.formGrid}>
                <Field label="NAME">
                  <input
                    className={styles.fieldInput}
                    value={form.name}
                    onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
                    required
                  />
                </Field>
                <Field label="PROVIDER">
                  <input
                    className={styles.fieldInput}
                    value={form.providerName}
                    onChange={(event) => setForm((prev) => ({ ...prev, providerName: event.target.value }))}
                    list="providers-list"
                  />
                  <datalist id="providers-list">
                    {providers.map((provider) => (
                      <option key={provider._id} value={provider.name} />
                    ))}
                  </datalist>
                </Field>
                <Field label="LOCATION">
                  <select
                    className={styles.fieldInput}
                    value={form.location}
                    onChange={(event) => setForm((prev) => ({ ...prev, location: event.target.value as LocationValue }))}
                  >
                    <option value="all">select</option>
                    <option value="wellington">Wellington</option>
                    <option value="thermal">Thermal</option>
                    <option value="ocala">Ocala</option>
                    <option value="la">LA</option>
                    <option value="eu">EU</option>
                    <option value="can">CAN</option>
                  </select>
                </Field>
                <Field label="CATEGORY">
                  <select
                    className={styles.fieldInput}
                    value={form.category}
                    onChange={(event) => setForm((prev) => ({ ...prev, category: event.target.value }))}
                  >
                    {CATEGORY_TABS.filter((row) => row.key !== "all").map((row) => (
                      <option key={row.key} value={row.key}>
                        {row.label}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="EMAIL">
                  <input
                    className={styles.fieldInput}
                    value={form.email}
                    onChange={(event) => setForm((prev) => ({ ...prev, email: event.target.value }))}
                    type="email"
                  />
                </Field>
                <Field label="PHONE">
                  <input
                    className={styles.fieldInput}
                    value={form.phone}
                    onChange={(event) => setForm((prev) => ({ ...prev, phone: event.target.value }))}
                  />
                </Field>
                <Field label="ROLE">
                  <input
                    className={styles.fieldInput}
                    value={form.role}
                    onChange={(event) => setForm((prev) => ({ ...prev, role: event.target.value }))}
                  />
                </Field>
              </div>
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
            <div>NAME</div>
            <div>PROVIDER</div>
            <div>LOCATION</div>
            <div>CATEGORY</div>
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
              const provider = contact.providerId ? providerLookup.get(String(contact.providerId)) : null;
              const providerName = contact.providerName ?? contact.company ?? provider?.name ?? "—";
              const location = contact.location as Exclude<LocationValue, "all"> | undefined;
              const categoryKey = contact.category?.toLowerCase() ?? "other";
              const categoryColor = CATEGORY_COLORS[categoryKey] ?? { bg: "rgba(107,112,132,0.08)", color: "#6B7084", label: titleCase(categoryKey) };
              return (
                <div key={contactId} className={styles.contactRow}>
                  <div>
                    <div className={styles.contactName}>{contact.name}</div>
                    {contact.email ? <div className={styles.contactEmail}>{contact.email}</div> : null}
                  </div>
                  <div className={styles.contactProvider}>{providerName}</div>
                  <div>
                    {location ? (
                      <span
                        className={styles.locationBadge}
                        style={{
                          background: LOCATION_COLORS[location].bg,
                          color: LOCATION_COLORS[location].color,
                        }}
                      >
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
                  <div className={styles.menuWrap}>
                    <button type="button" className={styles.rowMenuButton} onClick={() => setOpenMenuId((prev) => (prev === contactId ? null : contactId))}>
                      ⋮
                    </button>
                    {openMenuId === contactId ? (
                      <div className={styles.menuDropdown}>
                        <button type="button" className={styles.menuItem}>
                          View Contact
                        </button>
                        <button
                          type="button"
                          className={styles.menuItem}
                          onClick={() => {
                            setOpenMenuId(null);
                            startEdit(contact);
                          }}
                        >
                          Edit Contact
                        </button>
                        <div className={styles.menuDivider} />
                        <button type="button" className={`${styles.menuItem} ${styles.menuItemDanger}`} onClick={() => handleDeleteContact(contactId)}>
                          Delete
                        </button>
                      </div>
                    ) : null}
                  </div>
                </div>
              );
            })
          )}
        </section>
        <div className="ui-footer">OLD_OAK_HORSES // CONTACTS</div>
      </main>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className={styles.fieldGroup}>
      <span className={styles.fieldLabel}>{label}</span>
      {children}
    </label>
  );
}

function titleCase(value: string) {
  return value
    .split(/[_-\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
