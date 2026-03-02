"use client";

import Link from "next/link";
import { useMemo, useState, type FormEvent, type ReactNode } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import Modal from "@/components/Modal";
import NavBar from "@/components/NavBar";
import styles from "./dashboard.module.css";

type EventProviderMode = "none" | "contact" | "custom";

type HorseFormState = {
  name: string;
  yearOfBirth: string;
  usefNumber: string;
  feiNumber: string;
  owner: string;
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

const initialHorseForm: HorseFormState = {
  name: "",
  yearOfBirth: "",
  usefNumber: "",
  feiNumber: "",
  owner: "",
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
  const [showHorseModal, setShowHorseModal] = useState(false);
  const [showEventModal, setShowEventModal] = useState(false);
  const [horseForm, setHorseForm] = useState<HorseFormState>(initialHorseForm);
  const [eventForm, setEventForm] = useState<EventFormState>(initialEventForm);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState("");

  const activeHorses = useQuery(api.horses.getActiveHorses) ?? [];
  const contacts = useQuery(api.contacts.getAllContacts) ?? [];
  const upcomingEvents = useQuery(api.scheduleEvents.getUpcomingEvents) ?? [];

  const createHorse = useMutation(api.horses.createHorse);
  const createEvent = useMutation(api.scheduleEvents.createEvent);

  const shownHorses = activeHorses;

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
        owner: horseForm.owner || undefined,
      });
      setHorseForm(initialHorseForm);
      setShowHorseModal(false);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Failed to add horse");
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
          { label: "biz overview", href: "/biz-overview", variant: "filled" },
        ]}
      />

      <main className="page-main">
        <section className={styles.card}>
          <div className="ui-label">// UPCOMING</div>
          <div className={styles.sectionHeader}>
            <h2 className={styles.sectionTitle}>upcoming</h2>
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
        </section>

        <section className={styles.horsesSection}>
          <div className={styles.horsesHead}>
            <div className="ui-label">// HORSES</div>
            <Link href="/horses" className={styles.viewAll}>
              view all →
            </Link>
          </div>

          <div className={styles.grid}>
            {shownHorses.map((horse) => (
              <Link href={`/horses/${horse._id}`} key={horse._id} className={styles.horseCard}>
                <div className={styles.horseAvatar}>🐴</div>
                <h3 className={styles.horseName}>{horse.name}</h3>
                <div className={styles.horseMetaLine}>{horseOwnerSexLine(horse.owner, horse.sex)}</div>
                <div className={styles.metaGrid}>
                  <Meta label="YEAR" value={horse.yearOfBirth ? String(horse.yearOfBirth) : "—"} />
                  <Meta label="USEF #" value={horse.usefNumber || "—"} />
                  <Meta label="FEI #" value={horse.feiNumber || "—"} />
                </div>
              </Link>
            ))}

            <button type="button" className={styles.addCard} onClick={() => setShowHorseModal(true)}>
              <div className={styles.plus}>+</div>
              <div>add horse</div>
            </button>
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
          <Field label="owner">
            <input className={styles.input} value={horseForm.owner} onChange={(e) => setHorseForm((p) => ({ ...p, owner: e.target.value }))} />
          </Field>
          <ModalActions loading={isSubmitting} submitLabel="add horse" onCancel={() => setShowHorseModal(false)} error={formError} />
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

function horseOwnerSexLine(owner?: string, sex?: "gelding" | "mare" | "stallion") {
  const parts: string[] = [];
  if (owner) parts.push(owner);
  if (sex) parts.push(capitalize(sex));
  return parts.length > 0 ? parts.join(" · ") : "—";
}

function capitalize(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
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

function eventEmoji(type: string) {
  if (type.toLowerCase().includes("vet")) return "🩺";
  if (type.toLowerCase().includes("farrier")) return "🔧";
  return "📌";
}
