"use client";

import Link from "next/link";
import { useMemo, useState, type FormEvent, type ReactNode } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import FilterTabs from "@/components/FilterTabs";
import Modal from "@/components/Modal";
import NavBar from "@/components/NavBar";
import styles from "./dashboard.module.css";

type Tab = "schedule" | "contacts";
type HorseView = "active" | "past";
type EventProviderMode = "none" | "contact" | "custom";

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

const eventTypeOptions = ["Vet", "Farrier", "Trainer", "Transport", "Stabling", "Other"];
const contactCategoryOptions = ["Veterinary", "Farrier", "Trainer", "Feed & Bedding", "Transport", "Stabling", "Other"];

const initialHorseForm: HorseFormState = {
  name: "",
  yearOfBirth: "",
  usefNumber: "",
  feiNumber: "",
};

const initialContactForm: ContactFormState = {
  name: "",
  category: "Veterinary",
  company: "",
  phone: "",
  email: "",
};

const initialEventForm: EventFormState = {
  type: "Vet",
  horseId: "",
  date: new Date().toISOString().slice(0, 10),
  providerMode: "none",
  providerId: "",
  providerName: "",
  note: "",
};

export default function DashboardPage() {
  const [tab, setTab] = useState<Tab>("schedule");
  const [horseView, setHorseView] = useState<HorseView>("active");
  const [showHorseModal, setShowHorseModal] = useState(false);
  const [showContactModal, setShowContactModal] = useState(false);
  const [showEventModal, setShowEventModal] = useState(false);
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

  const contactsSorted = useMemo(() => [...contacts].sort((a, b) => a.name.localeCompare(b.name)), [contacts]);
  const upcomingEventsSorted = useMemo(() => [...upcomingEvents].sort((a, b) => a.date.localeCompare(b.date)), [upcomingEvents]);

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
        name: horseForm.name.trim(),
        yearOfBirth: horseForm.yearOfBirth ? Number(horseForm.yearOfBirth) : undefined,
        usefNumber: horseForm.usefNumber || undefined,
        feiNumber: horseForm.feiNumber || undefined,
      });
      setHorseForm(initialHorseForm);
      setShowHorseModal(false);
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
        name: contactForm.name.trim(),
        category: contactForm.category,
        company: contactForm.company || undefined,
        phone: contactForm.phone || undefined,
        email: contactForm.email || undefined,
      });
      setContactForm(initialContactForm);
      setShowContactModal(false);
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

    setFormError("");
    setIsSubmitting(true);
    try {
      await createEvent({
        type: eventForm.type,
        horseId: eventForm.horseId,
        date: eventForm.date,
        providerId: eventForm.providerMode === "contact" ? eventForm.providerId || undefined : undefined,
        providerName: eventForm.providerMode === "custom" ? eventForm.providerName.trim() || undefined : undefined,
        note: eventForm.note.trim() || undefined,
      });
      setEventForm(initialEventForm);
      setShowEventModal(false);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Failed to add event");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="page-shell">
      <NavBar
        items={[
          { label: "old-oak-horses", href: "/dashboard", brand: true },
          { label: "dashboard", current: true },
        ]}
        actions={[
          { label: "upload invoices", href: "/upload", variant: "outlined" },
          { label: "biz overview", href: "/reports", variant: "filled" },
        ]}
      />

      <main className="page-main">
        <section className={styles.card}>
          <div className={styles.tabRow}>
            <button type="button" className={tab === "schedule" ? styles.tabActive : styles.tab} onClick={() => setTab("schedule")}>
              Schedule
            </button>
            <button type="button" className={tab === "contacts" ? styles.tabActive : styles.tab} onClick={() => setTab("contacts")}>
              Contacts
            </button>
          </div>

          {tab === "schedule" ? (
            <div>
              <div className={styles.sectionHeader}>
                <h2 className={styles.sectionTitle}>schedule</h2>
                <button type="button" className="ui-button-outlined" onClick={() => setShowEventModal(true)}>
                  + add event
                </button>
              </div>

              {upcomingEventsSorted.length === 0 ? <div className={styles.empty}>no upcoming events</div> : null}

              {upcomingEventsSorted.map((item) => (
                <div key={item._id} className={styles.row}>
                  <div className={styles.icon}>{eventEmoji(item.type)}</div>
                  <div>
                    <div className={styles.rowTitle}>
                      {item.type} · {item.horseName}
                    </div>
                    <div className={styles.rowSub}>{item.providerName || "provider not set"}</div>
                  </div>
                  <div className={styles.datePill}>{item.date}</div>
                </div>
              ))}
            </div>
          ) : (
            <div>
              <div className={styles.sectionHeader}>
                <h2 className={styles.sectionTitle}>contacts</h2>
                <button type="button" className="ui-button-outlined" onClick={() => setShowContactModal(true)}>
                  + add contact
                </button>
              </div>

              {contactsSorted.length === 0 ? <div className={styles.empty}>no contacts yet</div> : null}

              {contactsSorted.map((contact) => (
                <div key={contact._id} className={styles.row}>
                  <div className={styles.avatar}>{initials(contact.name)}</div>
                  <div>
                    <div className={styles.rowTitle}>
                      {contact.name}
                      <span className={styles.tag}>{contact.category}</span>
                    </div>
                    <div className={styles.rowSub}>{contact.company || "no company"}</div>
                  </div>
                  <div className={styles.rowActions}>
                    {contact.phone ? (
                      <a href={`tel:${contact.phone}`} className={styles.iconBtn}>
                        ☎
                      </a>
                    ) : null}
                    {contact.email ? (
                      <a href={`mailto:${contact.email}`} className={styles.iconBtn}>
                        ✉
                      </a>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className={styles.horsesSection}>
          <div className={styles.horsesHead}>
            <div className={styles.horsesLeft}>
              <h2 className={styles.horsesTitle}>horses</h2>
              <FilterTabs
                value={horseView}
                onChange={setHorseView}
                options={[
                  { key: "active", label: "active" },
                  { key: "past", label: "past" },
                ]}
              />
            </div>
            <div className={styles.count}>{shownHorses.length} {horseView}</div>
          </div>

          <div className={styles.grid}>
            {shownHorses.map((horse) => (
              <Link href={`/horses/${horse._id}`} key={horse._id} className={styles.horseCard}>
                <div className={styles.horseAvatar}>🐴</div>
                <h3 className={styles.horseName}>{horse.name}</h3>
                <div className={styles.metaGrid}>
                  <Meta label="YEAR" value={horse.yearOfBirth ? String(horse.yearOfBirth) : "—"} />
                  <Meta label="USEF #" value={horse.usefNumber || "—"} />
                  <Meta label="FEI #" value={horse.feiNumber || "—"} />
                  {horse.status === "past" ? <Meta label="LEFT STABLE" value={horse.leftStableDate || "—"} /> : null}
                </div>
              </Link>
            ))}

            {horseView === "active" ? (
              <button type="button" className={styles.addCard} onClick={() => setShowHorseModal(true)}>
                <div className={styles.plus}>+</div>
                <div>add horse</div>
              </button>
            ) : null}
          </div>
        </section>

        <div className="ui-footer">OLD_OAK_HORSES // DASHBOARD</div>
      </main>

      <Modal open={showHorseModal} title="add horse" onClose={() => setShowHorseModal(false)}>
        <form className={styles.form} onSubmit={onSubmitHorse}>
          <Field label="name *">
            <input className={styles.input} value={horseForm.name} onChange={(e) => setHorseForm((p) => ({ ...p, name: e.target.value }))} />
          </Field>
          <Field label="year of birth">
            <input
              className={styles.input}
              type="number"
              value={horseForm.yearOfBirth}
              onChange={(e) => setHorseForm((p) => ({ ...p, yearOfBirth: e.target.value }))}
            />
          </Field>
          <div className={styles.twoCol}>
            <Field label="usef #">
              <input className={styles.input} value={horseForm.usefNumber} onChange={(e) => setHorseForm((p) => ({ ...p, usefNumber: e.target.value }))} />
            </Field>
            <Field label="fei #">
              <input className={styles.input} value={horseForm.feiNumber} onChange={(e) => setHorseForm((p) => ({ ...p, feiNumber: e.target.value }))} />
            </Field>
          </div>
          <ModalActions loading={isSubmitting} submitLabel="add horse" onCancel={() => setShowHorseModal(false)} error={formError} />
        </form>
      </Modal>

      <Modal open={showContactModal} title="add contact" onClose={() => setShowContactModal(false)}>
        <form className={styles.form} onSubmit={onSubmitContact}>
          <Field label="name *">
            <input className={styles.input} value={contactForm.name} onChange={(e) => setContactForm((p) => ({ ...p, name: e.target.value }))} />
          </Field>
          <Field label="category *">
            <select className={styles.input} value={contactForm.category} onChange={(e) => setContactForm((p) => ({ ...p, category: e.target.value }))}>
              {contactCategoryOptions.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </Field>
          <Field label="company">
            <input className={styles.input} value={contactForm.company} onChange={(e) => setContactForm((p) => ({ ...p, company: e.target.value }))} />
          </Field>
          <div className={styles.twoCol}>
            <Field label="phone">
              <input className={styles.input} value={contactForm.phone} onChange={(e) => setContactForm((p) => ({ ...p, phone: e.target.value }))} />
            </Field>
            <Field label="email">
              <input className={styles.input} value={contactForm.email} onChange={(e) => setContactForm((p) => ({ ...p, email: e.target.value }))} />
            </Field>
          </div>
          <ModalActions loading={isSubmitting} submitLabel="add contact" onCancel={() => setShowContactModal(false)} error={formError} />
        </form>
      </Modal>

      <Modal open={showEventModal} title="add event" onClose={() => setShowEventModal(false)}>
        <form className={styles.form} onSubmit={onSubmitEvent}>
          <div className={styles.twoCol}>
            <Field label="type *">
              <select className={styles.input} value={eventForm.type} onChange={(e) => setEventForm((p) => ({ ...p, type: e.target.value }))}>
                {eventTypeOptions.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="date *">
              <input className={styles.input} type="date" value={eventForm.date} onChange={(e) => setEventForm((p) => ({ ...p, date: e.target.value }))} />
            </Field>
          </div>

          <Field label="horse *">
            <select
              className={styles.input}
              value={eventForm.horseId}
              onChange={(e) => setEventForm((p) => ({ ...p, horseId: e.target.value as Id<"horses"> | "" }))}
            >
              <option value="">select horse</option>
              {activeHorses.map((horse) => (
                <option key={horse._id} value={horse._id}>
                  {horse.name}
                </option>
              ))}
            </select>
          </Field>

          <Field label="provider">
            <div className={styles.providerModeRow}>
              <button
                type="button"
                className={eventForm.providerMode === "none" ? styles.providerModeActive : styles.providerMode}
                onClick={() => setEventForm((p) => ({ ...p, providerMode: "none", providerId: "", providerName: "" }))}
              >
                none
              </button>
              <button
                type="button"
                className={eventForm.providerMode === "contact" ? styles.providerModeActive : styles.providerMode}
                onClick={() => setEventForm((p) => ({ ...p, providerMode: "contact", providerName: "" }))}
              >
                contact
              </button>
              <button
                type="button"
                className={eventForm.providerMode === "custom" ? styles.providerModeActive : styles.providerMode}
                onClick={() => setEventForm((p) => ({ ...p, providerMode: "custom", providerId: "" }))}
              >
                custom
              </button>
            </div>
          </Field>

          {eventForm.providerMode === "contact" ? (
            <Field label="provider contact">
              <select
                className={styles.input}
                value={eventForm.providerId}
                onChange={(e) => setEventForm((p) => ({ ...p, providerId: e.target.value as Id<"contacts"> | "" }))}
              >
                <option value="">select contact</option>
                {contactsSorted.map((contact) => (
                  <option key={contact._id} value={contact._id}>
                    {contact.name}
                  </option>
                ))}
              </select>
            </Field>
          ) : null}

          {eventForm.providerMode === "custom" ? (
            <Field label="provider name">
              <input className={styles.input} value={eventForm.providerName} onChange={(e) => setEventForm((p) => ({ ...p, providerName: e.target.value }))} />
            </Field>
          ) : null}

          <Field label="note">
            <input className={styles.input} value={eventForm.note} onChange={(e) => setEventForm((p) => ({ ...p, note: e.target.value }))} />
          </Field>

          <ModalActions loading={isSubmitting} submitLabel="add event" onCancel={() => setShowEventModal(false)} error={formError} />
        </form>
      </Modal>
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

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className={styles.metaLabel}>{label}</div>
      <div className={styles.metaValue}>{value}</div>
    </div>
  );
}

function ModalActions({
  loading,
  submitLabel,
  onCancel,
  error,
}: {
  loading: boolean;
  submitLabel: string;
  onCancel: () => void;
  error: string;
}) {
  return (
    <>
      {error ? <p className={styles.error}>{error}</p> : null}
      <div className={styles.modalActions}>
        <button type="button" className="ui-button-outlined" onClick={onCancel}>
          cancel
        </button>
        <button type="submit" className="ui-button-filled" disabled={loading}>
          {loading ? "saving..." : submitLabel}
        </button>
      </div>
    </>
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

function eventEmoji(type: string) {
  if (type.toLowerCase().includes("vet")) return "🩺";
  if (type.toLowerCase().includes("farrier")) return "🔧";
  return "📌";
}
