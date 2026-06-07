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
  // Multi-select: any subset of MEDICATION_OPTIONS may be picked. If "other"
  // is included the free-text in medicationOther is appended on save.
  medications: string[];
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
  medications: [],
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
        // If the URL specifies ?horse=<id>, slice the list to just that horse.
        .filter((r: any) => !prefilledHorseId || String(r.horseId) === prefilledHorseId)
        // For team users, only show meds for horses they can access.
        .filter((r: any) => !isTeamRole || horseById.has(String(r.horseId)))
        .sort((a: any, b: any) => (b.date ?? 0) - (a.date ?? 0)),
    [allRecords, isTeamRole, horseById, prefilledHorseId],
  );

  // Friendly subtitle when the list is sliced to a single horse.
  const filteredHorseName = prefilledHorseId ? horseById.get(prefilledHorseId)?.name : null;

  const createHorseRecord = useMutation(api.horseRecords.createHorseRecord);
  const updateHorseRecord = useMutation(api.horseRecords.updateHorseRecord);
  const deleteHorseRecord = useMutation(api.horseRecords.deleteHorseRecord);

  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [isSaving, setIsSaving] = useState(false);
  const [formError, setFormError] = useState("");
  // null = create mode, an Id = editing that existing record. Drives the
  // modal title, the save handler branch, and whether the delete button
  // is shown.
  const [editingRecordId, setEditingRecordId] = useState<Id<"horseRecords"> | null>(null);

  function openAdd(presetHorseId?: string) {
    setEditingRecordId(null);
    setForm({
      ...EMPTY_FORM,
      date: todayIso(),
      horseIds: presetHorseId ? [presetHorseId] : [],
    });
    setFormError("");
    setShowAdd(true);
  }

  /** Open the modal in edit mode for an existing medication record. The
   *  form is pre-filled from the record's stored fields; on save we call
   *  updateHorseRecord with the same id so it patches the existing row. */
  function openEdit(record: any) {
    setEditingRecordId(record._id);
    const storedMeds: string[] = Array.isArray(record.medications) ? record.medications : [];
    const predetermined = (MEDICATION_OPTIONS as readonly string[]).filter((opt) => opt !== "other");
    // Split stored values: anything matching a predetermined tile stays as
    // a selected tile; the rest become "other" + free text.
    const matchedTiles = storedMeds.filter((m) => predetermined.includes(m));
    const customs = storedMeds.filter((m) => !predetermined.includes(m));
    setForm({
      title: record.title ?? "",
      horseIds: [String(record.horseId)],
      medications: customs.length > 0 ? [...matchedTiles, "other"] : matchedTiles,
      medicationOther: customs.join(", "),
      date: record.date ? new Date(record.date).toISOString().slice(0, 10) : todayIso(),
      repeatEnabled: Boolean(record.medicationRepeatValue && record.medicationRepeatUnit),
      repeatValue: record.medicationRepeatValue ? String(record.medicationRepeatValue) : "",
      repeatUnit: (record.medicationRepeatUnit as RepeatUnit | undefined) ?? "",
      notes: record.notes ?? "",
    });
    setFormError("");
    setShowAdd(true);
  }

  function toggleMedication(med: string) {
    setForm((p) => ({
      ...p,
      medications: p.medications.includes(med)
        ? p.medications.filter((m) => m !== med)
        : [...p.medications, med],
    }));
  }

  // Auto-open the modal only when /meds?new=1 is present in the URL.
  // ?horse=<id> alone just filters the list (used by the horse-profile
  // MEDS link tile). To open the modal pre-selected for a horse, combine:
  // /meds?horse=<id>&new=1.
  useEffect(() => {
    if (!autoOpenNew) return;
    if (prefilledHorseId && horseById.has(prefilledHorseId)) {
      openAdd(prefilledHorseId);
    } else {
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
    if (form.medications.length === 0) return setFormError("pick at least one medication");
    if (form.medications.includes("other") && !form.medicationOther.trim())
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
      // Collect the picked medications. Predetermined tiles pass through
      // verbatim; "other" gets replaced by the free-text entries (comma- or
      // newline-separated). Resulting array is what we persist.
      const otherEntries = form.medications.includes("other")
        ? form.medicationOther
            .split(/[,\n]/)
            .map((s) => s.trim())
            .filter(Boolean)
        : [];
      const medsToSave: string[] = [
        ...form.medications.filter((m) => m !== "other"),
        ...otherEntries,
      ];
      const dateMs = new Date(form.date).getTime();
      const repeatValue = form.repeatEnabled ? Number(form.repeatValue) : undefined;
      const repeatUnit =
        form.repeatEnabled && form.repeatUnit !== ""
          ? (form.repeatUnit as "days" | "weeks" | "months")
          : undefined;

      if (editingRecordId) {
        // Edit: patch the existing record. We don't change horseId here —
        // moving a med record to a different horse is a separate action.
        await updateHorseRecord({
          recordId: editingRecordId,
          title: form.title.trim() || undefined,
          date: dateMs,
          medications: medsToSave,
          medicationRepeatValue: repeatValue,
          medicationRepeatUnit: repeatUnit,
          notes: form.notes.trim() || undefined,
        });
      } else {
        // Create: one record per selected horse.
        for (const horseId of form.horseIds) {
          await createHorseRecord({
            horseId: horseId as Id<"horses">,
            title: form.title.trim() || undefined,
            type: "medication",
            date: dateMs,
            medications: medsToSave,
            medicationRepeatValue: repeatValue,
            medicationRepeatUnit: repeatUnit,
            notes: form.notes.trim() || undefined,
            createdBy: user?.name,
          });
        }
      }

      setShowAdd(false);
      setEditingRecordId(null);
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
            <div className="ui-label">// MEDS{filteredHorseName ? ` // ${filteredHorseName.toUpperCase()}` : ""}</div>
            <h1 className={styles.title}>
              {filteredHorseName ? `${filteredHorseName}'s meds` : "meds"}
            </h1>
            {filteredHorseName ? (
              <Link href="/meds" style={{ fontSize: 11, color: "#4a5bdb", textDecoration: "none" }}>
                ← show all meds
              </Link>
            ) : null}
          </div>
          <button
            type="button"
            className={styles.addButton}
            onClick={() => openAdd(prefilledHorseId ?? undefined)}
          >
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
              // Records can now carry multiple medications. Join them with
              // a comma; migrated records (promoted from type=veterinary
              // visitType="medication") may not have a medications array,
              // so fall back to the record title / treatmentDescription.
              const medName =
                Array.isArray(r.medications) && r.medications.length > 0
                  ? r.medications.join(", ")
                  : (r.title?.trim() || (r as any).treatmentDescription?.trim() || "—");
              const repeatLabel =
                r.medicationRepeatValue && r.medicationRepeatUnit
                  ? `every ${r.medicationRepeatValue} ${r.medicationRepeatUnit}`
                  : null;
              return (
                <div
                  key={String(r._id)}
                  className={styles.row}
                  onClick={(e) => {
                    // Don't intercept clicks on the horse link.
                    const target = e.target as HTMLElement;
                    if (target.closest("a")) return;
                    openEdit(r);
                  }}
                  style={{ cursor: "pointer" }}
                >
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

      <Modal
        open={showAdd}
        title={editingRecordId ? "edit medication" : "log a medication"}
        onClose={() => {
          setShowAdd(false);
          setEditingRecordId(null);
        }}
      >
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
                  // In edit mode the horse can't be changed (one record per
                  // horse); only the active chip is rendered, others hidden.
                  if (editingRecordId && !active) return null;
                  return (
                    <button
                      key={String(h._id)}
                      type="button"
                      className={active ? styles.horseChipActive : styles.horseChip}
                      onClick={() => {
                        if (editingRecordId) return;
                        toggleHorse(String(h._id));
                      }}
                      disabled={Boolean(editingRecordId)}
                      style={editingRecordId ? { cursor: "default", opacity: 0.9 } : undefined}
                    >
                      🐴 {h.name}
                    </button>
                  );
                })}
              </div>
            )}
            <span className={styles.fieldHint}>category is automatically set to medication</span>
          </div>

          {/* 4. Medications (multi-select). Tiles toggle on/off; "other"
              reveals a free-text input that accepts comma-separated names. */}
          <div className={styles.field}>
            <span className={styles.fieldLabel}>MEDICATIONS *</span>
            <div className={styles.medGrid}>
              {MEDICATION_OPTIONS.map((med) => {
                const active = form.medications.includes(med);
                return (
                  <button
                    key={med}
                    type="button"
                    className={active ? styles.medOptionActive : styles.medOption}
                    onClick={() => toggleMedication(med)}
                  >
                    {med}
                  </button>
                );
              })}
            </div>
            {form.medications.includes("other") ? (
              <input
                className={styles.input}
                style={{ marginTop: 8 }}
                value={form.medicationOther}
                onChange={(e) => setForm((p) => ({ ...p, medicationOther: e.target.value }))}
                placeholder="medication name(s) — separate multiple with commas"
              />
            ) : null}
            <span className={styles.fieldHint}>tap multiple to log them all in one record</span>
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

          <div className={styles.actions} style={{ justifyContent: "space-between" }}>
            {/* Delete only appears when editing; lives on the left so the
                primary save/cancel buttons keep their familiar position. */}
            {editingRecordId ? (
              <button
                type="button"
                onClick={async () => {
                  if (!editingRecordId) return;
                  if (!confirm("Delete this medication record? This cannot be undone.")) return;
                  setIsSaving(true);
                  try {
                    await deleteHorseRecord({ recordId: editingRecordId });
                    setShowAdd(false);
                    setEditingRecordId(null);
                  } catch (err) {
                    setFormError(err instanceof Error ? err.message : "failed to delete");
                  } finally {
                    setIsSaving(false);
                  }
                }}
                disabled={isSaving}
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  padding: "10px 16px",
                  borderRadius: 6,
                  border: "1px solid rgba(229,72,77,0.3)",
                  background: "rgba(229,72,77,0.05)",
                  color: "#e5484d",
                  cursor: isSaving ? "not-allowed" : "pointer",
                }}
              >
                delete
              </button>
            ) : <span />}
            <div style={{ display: "flex", gap: 8 }}>
              <button
                type="button"
                className="ui-button-outlined"
                onClick={() => {
                  setShowAdd(false);
                  setEditingRecordId(null);
                }}
              >
                cancel
              </button>
              <button type="submit" className="ui-button-filled" disabled={isSaving}>
                {isSaving
                  ? "saving..."
                  : editingRecordId
                    ? "save changes"
                    : "log med"}
              </button>
            </div>
          </div>
        </form>
      </Modal>
    </div>
  );
}
