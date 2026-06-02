"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useAuth } from "@/contexts/AuthContext";
import Modal from "@/components/Modal";
import NavBar from "@/components/NavBar";
import styles from "./meds.module.css";

/** Predetermined medication options shown in the picker. "other" reveals a
 *  free-text input so anything not on the list can still be logged. */
const MEDICATION_OPTIONS = [
  "adequan",
  "aspirin",
  "banamine",
  "bute",
  "dexamethasone",
  "gastroguard",
  "gentamicin",
  "ketofen",
  "legend",
  "marquis",
  "metacam",
  "pentosan",
  "traumeel",
  "other",
] as const;

type RepeatUnit = "" | "days" | "weeks" | "months";

type FormState = {
  title: string;
  horseIds: string[];
  medication: string; // one of MEDICATION_OPTIONS or "" if not picked
  medicationOther: string;
  date: string; // YYYY-MM-DD
  repeatEnabled: boolean;
  repeatValue: string;
  repeatUnit: RepeatUnit;
  notes: string;
};

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function formatDate(timestamp: number) {
  if (!timestamp) return "—";
  return new Date(timestamp).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

const EMPTY_FORM: FormState = {
  title: "",
  horseIds: [],
  medication: "",
  medicationOther: "",
  date: todayIso(),
  repeatEnabled: false,
  repeatValue: "",
  repeatUnit: "",
  notes: "",
};

export default function MedsPage() {
  const { user } = useAuth();
  const isTeamRole = user?.role === "team";
  const searchParams = useSearchParams();
  // Honor /meds?horse=<id> from deep links (e.g. the horse profile's
  // "+ log med" button). Auto-opens the modal with the horse pre-selected.
  // Also honor /meds?new=1 (used by the global FAB's "record meds" item)
  // which auto-opens the modal without a horse pre-selection.
  const prefilledHorseId = searchParams?.get("horse") ?? null;
  const autoOpenNew = searchParams?.get("new") === "1";

  // Active horses for the picker. Team users only see horses they've been
  // granted access to (mirrors the rule on the /horses page).
  const allHorses = useQuery(
    api.horses.getActiveHorses,
    !isTeamRole ? {} : "skip",
  ) ?? [];
  const sharedHorses = useQuery(
    api.horseAccess.listSharedForUser,
    isTeamRole && user?.id ? { userId: user.id as Id<"users"> } : "skip",
  ) ?? [];
  const horses = isTeamRole ? sharedHorses : allHorses;
  const horseById = useMemo(() => new Map(horses.map((h) => [String(h._id), h])), [horses]);

  const allRecords = useQuery(api.horseRecords.getAll) ?? [];
  const medRecords = useMemo(
    () =>
      allRecords
        .filter((r: any) => r.type === "medication")
        // For team users, only show meds for horses they can access.
        .filter((r: any) => !isTeamRole || horseById.has(String(r.horseId)))
        .sort((a: any, b: any) => (b.date ?? 0) - (a.date ?? 0)),
    [allRecords, isTeamRole, horseById],
  );

  const createHorseRecord = useMutation(api.horseRecords.createHorseRecord);

  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [isSaving, setIsSaving] = useState(false);
  const [formError, setFormError] = useState("");

  function openAdd(presetHorseId?: string) {
    setForm({
      ...EMPTY_FORM,
      date: todayIso(),
      horseIds: presetHorseId ? [presetHorseId] : [],
    });
    setFormError("");
    setShowAdd(true);
  }

  // Auto-open the modal in two cases:
  //  - /meds?horse=<id> → pre-selects that horse (deep link from horse profile)
  //  - /meds?new=1      → opens with no horse pre-selected (FAB shortcut)
  // Runs once when the horse list is ready.
  useEffect(() => {
    if (prefilledHorseId && horseById.has(prefilledHorseId)) {
      openAdd(prefilledHorseId);
    } else if (autoOpenNew) {
      openAdd();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefilledHorseId, autoOpenNew, horses.length]);

  function toggleHorse(horseId: string) {
    setForm((p) => ({
      ...p,
      horseIds: p.horseIds.includes(horseId)
        ? p.horseIds.filter((id) => id !== horseId)
        : [...p.horseIds, horseId],
    }));
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!form.title.trim()) return setFormError("title is required");
    if (form.horseIds.length === 0) return setFormError("select at least one horse");
    if (!form.medication) return setFormError("pick a medication");
    if (form.medication === "other" && !form.medicationOther.trim())
      return setFormError("describe the medication (other)");
    if (!form.date) return setFormError("date is required");
    if (form.repeatEnabled) {
      const n = Number(form.repeatValue);
      if (!Number.isFinite(n) || n <= 0) return setFormError("enter a repeat interval");
      if (!form.repeatUnit) return setFormError("pick a repeat cadence");
    }

    setFormError("");
    setIsSaving(true);
    try {
      // Title carries the human label; medications array carries the canonical
      // value (free-text for "other"). One record per selected horse.
      const medName = form.medication === "other" ? form.medicationOther.trim() : form.medication;
      const dateMs = new Date(form.date).getTime();
      const repeatValue = form.repeatEnabled ? Number(form.repeatValue) : undefined;
      const repeatUnit =
        form.repeatEnabled && form.repeatUnit !== ""
          ? (form.repeatUnit as "days" | "weeks" | "months")
          : undefined;

      for (const horseId of form.horseIds) {
        await createHorseRecord({
          horseId: horseId as Id<"horses">,
          title: form.title.trim() || undefined,
          type: "medication",
          date: dateMs,
          medications: [medName],
          medicationRepeatValue: repeatValue,
          medicationRepeatUnit: repeatUnit,
          notes: form.notes.trim() || undefined,
          createdBy: user?.name,
        });
      }

      setShowAdd(false);
      setForm(EMPTY_FORM);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "failed to save");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="page-shell">
      <NavBar
        items={[
          { label: "team-ldk", href: "/dashboard", brand: true },
          { label: "meds", current: true },
        ]}
        actions={[]}
      />
      <main className="page-main">
        <Link href="/dashboard" className="ui-back-link">← cd /dashboard</Link>

        <section className={styles.headerRow}>
          <div>
            <div className="ui-label">// MEDS</div>
            <h1 className={styles.title}>meds</h1>
          </div>
          <button type="button" className={styles.addButton} onClick={() => openAdd()}>
            + log med
          </button>
        </section>

        <section className={styles.list}>
          <div className={styles.header}>
            <div>MEDICATION</div>
            <div>HORSE</div>
            <div>DATE</div>
            <div>REPEAT</div>
            <div style={{ textAlign: "right" }}>CREATED BY</div>
          </div>
          {medRecords.length === 0 ? (
            <div className={styles.empty}>no meds logged yet — click "+ log med" to add one</div>
          ) : (
            medRecords.map((r: any) => {
              const horse = horseById.get(String(r.horseId));
              const medName = Array.isArray(r.medications) && r.medications.length > 0
                ? r.medications[0]
                : "—";
              const repeatLabel =
                r.medicationRepeatValue && r.medicationRepeatUnit
                  ? `every ${r.medicationRepeatValue} ${r.medicationRepeatUnit}`
                  : null;
              return (
                <div key={String(r._id)} className={styles.row}>
                  <div>
                    <div className={styles.medName}>{medName}</div>
                    {r.title ? <div className={styles.metaTitle}>{r.title}</div> : null}
                  </div>
                  <div className={styles.horses}>
                    {horse ? (
                      <Link href={`/horses/${horse._id}`} style={{ color: "#1a1a2e", textDecoration: "none" }}>
                        🐴 {horse.name}
                      </Link>
                    ) : "—"}
                  </div>
                  <div className={styles.date}>{formatDate(r.date)}</div>
                  <div>{repeatLabel ? <span className={styles.repeatBadge}>{repeatLabel}</span> : null}</div>
                  <div className={styles.createdBy}>{r.createdBy ?? "—"}</div>
                </div>
              );
            })
          )}
        </section>
      </main>

      <Modal open={showAdd} title="log a medication" onClose={() => setShowAdd(false)}>
        <form className={styles.form} onSubmit={onSubmit}>
          {/* 1. Title */}
          <label className={styles.field}>
            <span className={styles.fieldLabel}>TITLE *</span>
            <input
              className={styles.input}
              value={form.title}
              onChange={(e) => setForm((p) => ({ ...p, title: e.target.value }))}
              placeholder="e.g. Bute for soundness, gastroguard 1mo"
            />
          </label>

          {/* 2. Horses (multi) */}
          <div className={styles.field}>
            <span className={styles.fieldLabel}>HORSES *</span>
            {horses.length === 0 ? (
              <span className={styles.fieldHint}>
                {isTeamRole
                  ? "no horses shared with you yet — ask an admin"
                  : "no active horses found"}
              </span>
            ) : (
              <div className={styles.horseChips}>
                {horses.map((h) => {
                  const active = form.horseIds.includes(String(h._id));
                  return (
                    <button
                      key={String(h._id)}
                      type="button"
                      className={active ? styles.horseChipActive : styles.horseChip}
                      onClick={() => toggleHorse(String(h._id))}
                    >
                      🐴 {h.name}
                    </button>
                  );
                })}
              </div>
            )}
            <span className={styles.fieldHint}>category is automatically set to medication</span>
          </div>

          {/* 4. Medication picker (3 enforces category=meds at the data layer) */}
          <div className={styles.field}>
            <span className={styles.fieldLabel}>MEDICATION *</span>
            <div className={styles.medGrid}>
              {MEDICATION_OPTIONS.map((med) => (
                <button
                  key={med}
                  type="button"
                  className={form.medication === med ? styles.medOptionActive : styles.medOption}
                  onClick={() => setForm((p) => ({ ...p, medication: med }))}
                >
                  {med}
                </button>
              ))}
            </div>
            {form.medication === "other" ? (
              <input
                className={styles.input}
                style={{ marginTop: 8 }}
                value={form.medicationOther}
                onChange={(e) => setForm((p) => ({ ...p, medicationOther: e.target.value }))}
                placeholder="medication name (other)"
              />
            ) : null}
          </div>

          {/* 5. Date */}
          <label className={styles.field}>
            <span className={styles.fieldLabel}>DATE *</span>
            <input
              type="date"
              className={styles.input}
              value={form.date}
              onChange={(e) => setForm((p) => ({ ...p, date: e.target.value }))}
            />
          </label>

          {/* 6. Repeat toggle + cadence */}
          <div className={styles.field}>
            <span className={styles.fieldLabel}>REPEAT</span>
            <label className={styles.repeatCheckbox}>
              <input
                type="checkbox"
                checked={form.repeatEnabled}
                onChange={(e) => setForm((p) => ({ ...p, repeatEnabled: e.target.checked }))}
              />
              repeat this medication regularly
            </label>
            {form.repeatEnabled ? (
              <div className={styles.repeatRow} style={{ marginTop: 8 }}>
                <span className={styles.fieldHint}>every</span>
                <input
                  type="number"
                  min={1}
                  className={styles.input}
                  value={form.repeatValue}
                  onChange={(e) => setForm((p) => ({ ...p, repeatValue: e.target.value }))}
                  placeholder="e.g. 2"
                />
                <select
                  className={styles.input}
                  value={form.repeatUnit}
                  onChange={(e) => setForm((p) => ({ ...p, repeatUnit: e.target.value as RepeatUnit }))}
                >
                  <option value="">cadence...</option>
                  <option value="days">days</option>
                  <option value="weeks">weeks</option>
                  <option value="months">months</option>
                </select>
              </div>
            ) : null}
          </div>

          {/* 7. Notes */}
          <label className={styles.field}>
            <span className={styles.fieldLabel}>NOTES</span>
            <textarea
              className={`${styles.input} ${styles.textarea}`}
              value={form.notes}
              onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))}
              placeholder="dosage, route, any other context..."
            />
          </label>

          {/* 8. Created by (read-only — pulled from auth) */}
          <label className={styles.field}>
            <span className={styles.fieldLabel}>CREATED BY</span>
            <input
              className={styles.input}
              value={user?.name ?? ""}
              readOnly
              style={{ opacity: 0.7 }}
            />
          </label>

          {formError ? <p className={styles.error}>{formError}</p> : null}

          <div className={styles.actions}>
            <button type="button" className="ui-button-outlined" onClick={() => setShowAdd(false)}>
              cancel
            </button>
            <button type="submit" className="ui-button-filled" disabled={isSaving}>
              {isSaving ? "saving..." : "log med"}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
