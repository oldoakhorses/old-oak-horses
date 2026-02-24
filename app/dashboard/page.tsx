"use client";

import Link from "next/link";
import { useMemo, useState, type FormEvent, type ReactNode } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import styles from "./dashboard.module.css";

type Tab = "schedule" | "contacts";
type HorseView = "active" | "past";
type EventProviderMode = "none" | "contact" | "custom";

type ContactCategoryColor = {
  bg: string;
  text: string;
};

type EventTypeMeta = {
  emoji: string;
  bg: string;
};

const contactCategoryColors: Record<string, ContactCategoryColor> = {
  Veterinary: { bg: "#F0FFF4", text: "#2F855A" },
  Farrier: { bg: "#FFF5F5", text: "#C53030" },
  Trainer: { bg: "#F0F4FF", text: "#3B5BDB" },
  "Feed & Bedding": { bg: "#FFFBF0", text: "#B7791F" },
  default: { bg: "#F9FAFB", text: "#6B7280" }
};

const eventTypeMeta: Record<string, EventTypeMeta> = {
  Vet: { emoji: "🩺", bg: "#F0FFF4" },
  Farrier: { emoji: "🔧", bg: "#FFF5F5" },
  Trainer: { emoji: "🏇", bg: "#F0F4FF" },
  default: { emoji: "📌", bg: "#F9FAFB" }
};

const eventTypeOptions = ["Vet", "Farrier", "Trainer", "Transport", "Stabling", "Other"];
const contactCategoryOptions = ["Veterinary", "Farrier", "Trainer", "Feed & Bedding", "Transport", "Stabling", "Other"];

type HorseFormState = {
  name: string;
  yearOfBirth: string;
  usefNumber: string;
  feiNumber: string;
};

type ContactFormState = {
  name: string;
  category: string;
  company: string;
  phone: string;
  email: string;
};

type EventFormState = {
  type: string;
  horseId: Id<"horses"> | "";
  date: string;
  providerMode: EventProviderMode;
  providerId: Id<"contacts"> | "";
  providerName: string;
  note: string;
};

const initialHorseForm: HorseFormState = {
  name: "",
  yearOfBirth: "",
  usefNumber: "",
  feiNumber: ""
};

const initialContactForm: ContactFormState = {
  name: "",
  category: "Veterinary",
  company: "",
  phone: "",
  email: ""
};

const initialEventForm: EventFormState = {
  type: "Vet",
  horseId: "",
  date: new Date().toISOString().slice(0, 10),
  providerMode: "none",
  providerId: "",
  providerName: "",
  note: ""
};

export default function DashboardPage() {
  const [tab, setTab] = useState<Tab>("schedule");
  const [horseView, setHorseView] = useState<HorseView>("active");

  const [horseModalOpen, setHorseModalOpen] = useState(false);
  const [contactModalOpen, setContactModalOpen] = useState(false);
  const [eventModalOpen, setEventModalOpen] = useState(false);

  const [horseForm, setHorseForm] = useState<HorseFormState>(initialHorseForm);
  const [contactForm, setContactForm] = useState<ContactFormState>(initialContactForm);
  const [eventForm, setEventForm] = useState<EventFormState>(initialEventForm);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState("");

  const activeHorses = useQuery(api.horses.getActiveHorses) ?? [];
  const pastHorses = useQuery(api.horses.getPastHorses) ?? [];
  const contacts = useQuery(api.contacts.getAllContacts) ?? [];
  const upcomingEvents = useQuery(api.scheduleEvents.getUpcomingEvents) ?? [];

  const createHorse = useMutation(api.horses.createHorse);
  const createContact = useMutation(api.contacts.createContact);
  const createEvent = useMutation(api.scheduleEvents.createEvent);

  const shownHorses = horseView === "active" ? activeHorses : pastHorses;
  const horseCountLabel = `${shownHorses.length} ${horseView === "active" ? "ACTIVE" : "PAST"}`;

  const contactsSorted = useMemo(() => {
    return [...contacts].sort((a, b) => a.name.localeCompare(b.name));
  }, [contacts]);

  const upcomingEventsSorted = useMemo(() => {
    return [...upcomingEvents].sort((a, b) => a.date.localeCompare(b.date));
  }, [upcomingEvents]);

  async function onSubmitHorse(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!horseForm.name.trim()) {
      setFormError("Name is required.");
      return;
    }

    setFormError("");
    setIsSubmitting(true);
    try {
      await createHorse({
        name: horseForm.name,
        yearOfBirth: horseForm.yearOfBirth ? Number(horseForm.yearOfBirth) : undefined,
        usefNumber: horseForm.usefNumber || undefined,
        feiNumber: horseForm.feiNumber || undefined
      });
      setHorseModalOpen(false);
      setHorseForm(initialHorseForm);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Failed to add horse");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function onSubmitContact(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!contactForm.name.trim()) {
      setFormError("Name is required.");
      return;
    }

    setFormError("");
    setIsSubmitting(true);
    try {
      await createContact({
        name: contactForm.name,
        category: contactForm.category,
        company: contactForm.company || undefined,
        phone: contactForm.phone || undefined,
        email: contactForm.email || undefined
      });
      setContactModalOpen(false);
      setContactForm(initialContactForm);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Failed to add contact");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function onSubmitEvent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!eventForm.horseId) {
      setFormError("Horse is required.");
      return;
    }
    if (!eventForm.date) {
      setFormError("Date is required.");
      return;
    }

    const providerId = eventForm.providerMode === "contact" ? eventForm.providerId || undefined : undefined;
    const providerName = eventForm.providerMode === "custom" ? eventForm.providerName.trim() || undefined : undefined;

    setFormError("");
    setIsSubmitting(true);
    try {
      await createEvent({
        type: eventForm.type,
        horseId: eventForm.horseId as Id<"horses">,
        date: eventForm.date,
        providerId,
        providerName,
        note: eventForm.note.trim() || undefined
      });
      setEventModalOpen(false);
      setEventForm(initialEventForm);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Failed to add event");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className={styles.page}>
      <nav className={styles.nav}>
        <div className={styles.crumbs}>
          <span className={styles.brand}>Old Oak Horses</span>
          <span className={styles.divider}>/</span>
          <span className={styles.current}>Dashboard</span>
        </div>
        <div className={styles.navActions}>
          <Link href="/upload" className={styles.navButtonMuted}>
            Upload Invoices
          </Link>
          <Link href="/reports" className={styles.navButtonLight}>
            Biz Overview
          </Link>
        </div>
      </nav>

      <main className={styles.main}>
        <section className={styles.card}>
          <div className={styles.tabs}>
            <button
              type="button"
              className={tab === "schedule" ? styles.tabActive : styles.tab}
              onClick={() => setTab("schedule")}
            >
              Schedule
            </button>
            <button
              type="button"
              className={tab === "contacts" ? styles.tabActive : styles.tab}
              onClick={() => setTab("contacts")}
            >
              Contacts
            </button>
          </div>

          {tab === "schedule" ? (
            <div className={styles.tabCard}>
              <div className={styles.cardHeader}>
                <h2 className={styles.cardTitle}>Upcoming</h2>
                <button
                  type="button"
                  className={styles.addButton}
                  onClick={() => {
                    setFormError("");
                    setEventModalOpen(true);
                  }}
                >
                  + Add Event
                </button>
              </div>

              {upcomingEventsSorted.length === 0 ? <div className={styles.empty}>No upcoming events.</div> : null}

              {upcomingEventsSorted.map((event) => {
                const meta = eventTypeMeta[event.type] ?? eventTypeMeta.default;
                return (
                  <div key={event._id} className={styles.listRow}>
                    <div className={styles.eventIcon} style={{ background: meta.bg }}>
                      {meta.emoji}
                    </div>
                    <div className={styles.rowCenter}>
                      <div className={styles.rowTitle}>
                        {event.type} · {event.horseName}
                      </div>
                      <div className={styles.rowSubtle}>
                        {event.providerName || "Provider not set"}
                        {event.note ? ` · ${event.note}` : ""}
                      </div>
                    </div>
                    <div className={styles.datePill}>{formatDate(event.date)}</div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className={styles.tabCard}>
              <div className={styles.cardHeader}>
                <h2 className={styles.cardTitle}>Contacts</h2>
                <button
                  type="button"
                  className={styles.addButton}
                  onClick={() => {
                    setFormError("");
                    setContactModalOpen(true);
                  }}
                >
                  + Add Contact
                </button>
              </div>

              {contactsSorted.length === 0 ? <div className={styles.empty}>No contacts yet.</div> : null}

              {contactsSorted.map((contact) => {
                const color = contactCategoryColors[contact.category] ?? contactCategoryColors.default;
                return (
                  <div key={contact._id} className={styles.listRow}>
                    <div className={styles.avatar} style={{ background: color.bg, color: color.text }}>
                      {initials(contact.name)}
                    </div>
                    <div className={styles.rowCenter}>
                      <div className={styles.rowTitle}>
                        {contact.name}
                        <span className={styles.categoryPill} style={{ background: color.bg, color: color.text }}>
                          {contact.category}
                        </span>
                      </div>
                      <div className={styles.rowSubtle}>
                        {contact.company ?? "No company"}
                        {contact.phone ? ` · ${contact.phone}` : ""}
                      </div>
                    </div>
                    <div className={styles.rowActions}>
                      {contact.phone ? (
                        <a className={styles.iconAction} href={`tel:${contact.phone}`} aria-label={`Call ${contact.name}`}>
                          ☎
                        </a>
                      ) : null}
                      {contact.email ? (
                        <a className={styles.iconAction} href={`mailto:${contact.email}`} aria-label={`Email ${contact.name}`}>
                          ✉
                        </a>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        <section className={styles.horsesSection}>
          <div className={styles.horsesHeader}>
            <div className={styles.horsesHeaderLeft}>
              <h2 className={styles.horsesTitle}>Horses</h2>
              <div className={styles.toggleWrap}>
                <button
                  type="button"
                  className={horseView === "active" ? styles.toggleActive : styles.toggleButton}
                  onClick={() => setHorseView("active")}
                >
                  Active
                </button>
                <button
                  type="button"
                  className={horseView === "past" ? styles.toggleActive : styles.toggleButton}
                  onClick={() => setHorseView("past")}
                >
                  Past
                </button>
              </div>
            </div>
            <div className={styles.countLabel}>{horseCountLabel}</div>
          </div>

          <div className={styles.horseGrid}>
            {shownHorses.map((horse) => {
              const isPast = horse.status === "past";
              return (
                <Link
                  key={horse._id}
                  href={`/horses/${horse._id}`}
                  className={isPast ? styles.horseCardPast : styles.horseCard}
                >
                  <div className={isPast ? styles.horseAvatarPast : styles.horseAvatar}>🐴</div>
                  <h3 className={styles.horseName}>{horse.name}</h3>
                  <div className={styles.detailsGrid}>
                    <Detail label="Year of Birth" value={horse.yearOfBirth ? String(horse.yearOfBirth) : "—"} />
                    <Detail label="USEF #" value={horse.usefNumber || "—"} mono />
                    <Detail label="FEI #" value={horse.feiNumber || "—"} mono span={isPast ? 1 : 2} />
                    {isPast ? <Detail label="Left Stable" value={horse.leftStableDate || "—"} mono /> : null}
                  </div>
                </Link>
              );
            })}

            {horseView === "active" ? (
              <button
                type="button"
                className={styles.addHorseCard}
                onClick={() => {
                  setFormError("");
                  setHorseModalOpen(true);
                }}
              >
                <div className={styles.addHorseCircle}>+</div>
                <div className={styles.addHorseText}>Add Horse</div>
              </button>
            ) : null}
          </div>
        </section>

        <footer className={styles.footer}>OLD OAK HORSES · DASHBOARD</footer>
      </main>

      <Modal
        open={horseModalOpen}
        title="Add Horse"
        onClose={() => {
          if (isSubmitting) return;
          setHorseModalOpen(false);
          setFormError("");
        }}
      >
        <form onSubmit={onSubmitHorse} className={styles.form}>
          <Field label="Name *">
            <input
              value={horseForm.name}
              onChange={(e) => setHorseForm((prev) => ({ ...prev, name: e.target.value }))}
              className={styles.input}
              required
            />
          </Field>
          <Field label="Year of Birth">
            <input
              type="number"
              value={horseForm.yearOfBirth}
              onChange={(e) => setHorseForm((prev) => ({ ...prev, yearOfBirth: e.target.value }))}
              className={styles.input}
            />
          </Field>
          <div className={styles.twoCol}>
            <Field label="USEF #">
              <input
                value={horseForm.usefNumber}
                onChange={(e) => setHorseForm((prev) => ({ ...prev, usefNumber: e.target.value }))}
                className={styles.input}
              />
            </Field>
            <Field label="FEI #">
              <input
                value={horseForm.feiNumber}
                onChange={(e) => setHorseForm((prev) => ({ ...prev, feiNumber: e.target.value }))}
                className={styles.input}
              />
            </Field>
          </div>
          <ModalActions onClose={() => setHorseModalOpen(false)} isSubmitting={isSubmitting} submitLabel="Add Horse" />
          {formError ? <p className={styles.formError}>{formError}</p> : null}
        </form>
      </Modal>

      <Modal
        open={contactModalOpen}
        title="Add Contact"
        onClose={() => {
          if (isSubmitting) return;
          setContactModalOpen(false);
          setFormError("");
        }}
      >
        <form onSubmit={onSubmitContact} className={styles.form}>
          <Field label="Name *">
            <input
              value={contactForm.name}
              onChange={(e) => setContactForm((prev) => ({ ...prev, name: e.target.value }))}
              className={styles.input}
              required
            />
          </Field>
          <Field label="Category *">
            <select
              value={contactForm.category}
              onChange={(e) => setContactForm((prev) => ({ ...prev, category: e.target.value }))}
              className={styles.input}
            >
              {contactCategoryOptions.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Company">
            <input
              value={contactForm.company}
              onChange={(e) => setContactForm((prev) => ({ ...prev, company: e.target.value }))}
              className={styles.input}
            />
          </Field>
          <div className={styles.twoCol}>
            <Field label="Phone">
              <input
                value={contactForm.phone}
                onChange={(e) => setContactForm((prev) => ({ ...prev, phone: e.target.value }))}
                className={styles.input}
              />
            </Field>
            <Field label="Email">
              <input
                type="email"
                value={contactForm.email}
                onChange={(e) => setContactForm((prev) => ({ ...prev, email: e.target.value }))}
                className={styles.input}
              />
            </Field>
          </div>
          <ModalActions onClose={() => setContactModalOpen(false)} isSubmitting={isSubmitting} submitLabel="Add Contact" />
          {formError ? <p className={styles.formError}>{formError}</p> : null}
        </form>
      </Modal>

      <Modal
        open={eventModalOpen}
        title="Add Event"
        onClose={() => {
          if (isSubmitting) return;
          setEventModalOpen(false);
          setFormError("");
        }}
      >
        <form onSubmit={onSubmitEvent} className={styles.form}>
          <div className={styles.twoCol}>
            <Field label="Type *">
              <select
                value={eventForm.type}
                onChange={(e) => setEventForm((prev) => ({ ...prev, type: e.target.value }))}
                className={styles.input}
              >
                {eventTypeOptions.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Horse *">
              <select
                value={eventForm.horseId}
                onChange={(e) => setEventForm((prev) => ({ ...prev, horseId: e.target.value as Id<"horses"> | "" }))}
                className={styles.input}
              >
                <option value="">Select horse</option>
                {activeHorses.map((horse) => (
                  <option key={horse._id} value={horse._id}>
                    {horse.name}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <Field label="Date *">
            <input
              type="date"
              value={eventForm.date}
              onChange={(e) => setEventForm((prev) => ({ ...prev, date: e.target.value }))}
              className={styles.input}
              required
            />
          </Field>
          <Field label="Provider">
            <div className={styles.providerMode}>
              <button
                type="button"
                className={eventForm.providerMode === "none" ? styles.modeButtonActive : styles.modeButton}
                onClick={() => setEventForm((prev) => ({ ...prev, providerMode: "none", providerId: "", providerName: "" }))}
              >
                None
              </button>
              <button
                type="button"
                className={eventForm.providerMode === "contact" ? styles.modeButtonActive : styles.modeButton}
                onClick={() => setEventForm((prev) => ({ ...prev, providerMode: "contact", providerName: "" }))}
              >
                Contact
              </button>
              <button
                type="button"
                className={eventForm.providerMode === "custom" ? styles.modeButtonActive : styles.modeButton}
                onClick={() => setEventForm((prev) => ({ ...prev, providerMode: "custom", providerId: "" }))}
              >
                Free Text
              </button>
            </div>
          </Field>
          {eventForm.providerMode === "contact" ? (
            <Field label="Provider Contact">
              <select
                value={eventForm.providerId}
                onChange={(e) => setEventForm((prev) => ({ ...prev, providerId: e.target.value as Id<"contacts"> | "" }))}
                className={styles.input}
              >
                <option value="">Select contact</option>
                {contactsSorted.map((contact) => (
                  <option key={contact._id} value={contact._id}>
                    {contact.name}
                  </option>
                ))}
              </select>
            </Field>
          ) : null}
          {eventForm.providerMode === "custom" ? (
            <Field label="Provider Name">
              <input
                value={eventForm.providerName}
                onChange={(e) => setEventForm((prev) => ({ ...prev, providerName: e.target.value }))}
                className={styles.input}
              />
            </Field>
          ) : null}
          <Field label="Note">
            <input
              value={eventForm.note}
              onChange={(e) => setEventForm((prev) => ({ ...prev, note: e.target.value }))}
              className={styles.input}
            />
          </Field>
          <ModalActions onClose={() => setEventModalOpen(false)} isSubmitting={isSubmitting} submitLabel="Add Event" />
          {formError ? <p className={styles.formError}>{formError}</p> : null}
        </form>
      </Modal>
    </div>
  );
}

function Detail({ label, value, mono = false, span = 1 }: { label: string; value: string; mono?: boolean; span?: 1 | 2 }) {
  return (
    <div style={{ gridColumn: `span ${span}` }}>
      <div className={styles.detailLabel}>{label}</div>
      <div className={mono ? styles.detailMono : styles.detailValue}>{value}</div>
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

function Modal({
  open,
  title,
  onClose,
  children
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  if (!open) return null;
  return (
    <div
      className={styles.modalBackdrop}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div className={styles.modalCard}>
        <h3 className={styles.modalTitle}>{title}</h3>
        {children}
      </div>
    </div>
  );
}

function ModalActions({ onClose, isSubmitting, submitLabel }: { onClose: () => void; isSubmitting: boolean; submitLabel: string }) {
  return (
    <div className={styles.modalActions}>
      <button type="button" className={styles.cancelButton} onClick={onClose} disabled={isSubmitting}>
        Cancel
      </button>
      <button type="submit" className={styles.submitButton} disabled={isSubmitting}>
        {isSubmitting ? "Saving..." : submitLabel}
      </button>
    </div>
  );
}

function initials(name: string) {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

function formatDate(value: string) {
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}
