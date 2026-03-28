"use client";

import { useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import Modal from "@/components/Modal";
import styles from "./LogRecordFromInvoice.module.css";

type RecordType = "veterinary" | "medication" | "farrier" | "bodywork" | "other";

type RecordFormState = {
  horseIds: string[];
  date: string;
  recordType: RecordType;
  customType: string;
  visitType: "" | "vaccination" | "treatment";
  vaccineName: string;
  treatmentDescription: string;
  serviceType: string;
  providerName: string;
  notes: string;
};

function categoryToRecordType(slug: string): RecordType {
  if (slug === "veterinary") return "veterinary";
  if (slug === "farrier") return "farrier";
  if (slug === "bodywork") return "bodywork";
  return "other";
}

type AssignedHorse = {
  horseId: string;
  horseName: string;
  amount: number;
};

type LineItemForNotes = {
  description?: string;
  horse_name?: string | null;
  total_usd?: number;
};

/**
 * Self-contained "log record" button + modal for approved invoice pages.
 * Place alongside InvoiceNotesCard on any approved bill view.
 */
export default function LogRecordFromInvoice({
  billId,
  categorySlug,
  providerName,
  invoiceDate,
  assignedHorses,
  lineItems,
}: {
  billId: Id<"bills">;
  categorySlug: string;
  providerName: string;
  invoiceDate: string;
  assignedHorses?: AssignedHorse[];
  lineItems?: LineItemForNotes[];
}) {
  const horses = useQuery(api.horses.getActiveHorses) ?? [];
  const createHorseRecord = useMutation(api.horseRecords.createHorseRecord);
  const generateUploadUrl = useMutation(api.bills.generateUploadUrl);

  const [showModal, setShowModal] = useState(false);
  const [savingRecord, setSavingRecord] = useState(false);
  const [savedCount, setSavedCount] = useState(0);
  const [error, setError] = useState("");
  const [attachment, setAttachment] = useState<File | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const [form, setForm] = useState<RecordFormState>({
    horseIds: [],
    date: "",
    recordType: "other",
    customType: "",
    visitType: "",
    vaccineName: "",
    treatmentDescription: "",
    serviceType: "",
    providerName: "",
    notes: "",
  });

  function buildHorseNotes(horseId: string): string {
    if (!lineItems || lineItems.length === 0) return "";
    const horse = horses.find((h) => String(h._id) === horseId);
    const horseName = horse?.name?.toLowerCase() ?? "";
    if (!horseName) return "";

    const descriptions: string[] = [];
    for (const item of lineItems) {
      const itemHorse = (item.horse_name ?? "").toLowerCase().trim();
      if (itemHorse && itemHorse === horseName) {
        const desc = String(item.description ?? "").trim();
        if (desc) descriptions.push(desc);
      }
    }

    // If no per-horse match and there's only one assigned horse, include all descriptions
    if (descriptions.length === 0 && assignedHorses && assignedHorses.length === 1) {
      for (const item of lineItems) {
        const desc = String(item.description ?? "").trim();
        if (desc) descriptions.push(desc);
      }
    }

    if (descriptions.length === 0) return "";
    if (descriptions.length === 1) return descriptions[0];
    return descriptions.join(", ");
  }

  function openModal() {
    const preselectedIds = (assignedHorses ?? [])
      .map((h) => h.horseId)
      .filter((id) => horses.some((h) => String(h._id) === id));

    setForm({
      horseIds: preselectedIds,
      date: invoiceDate || "",
      recordType: categoryToRecordType(categorySlug),
      customType: "",
      visitType: "",
      vaccineName: "",
      treatmentDescription: "",
      serviceType: "",
      providerName: providerName !== "Unknown" ? providerName : "",
      notes: "",
    });
    setAttachment(null);
    setError("");
    setShowModal(true);
  }

  async function onSave() {
    const validHorseIds = form.horseIds.filter((id) =>
      horses.some((h) => String(h._id) === id)
    );
    if (validHorseIds.length === 0 || !form.date || !form.recordType) return;
    setSavingRecord(true);
    setError("");
    try {
      const dateTs = new Date(`${form.date}T00:00:00`).getTime();
      if (!Number.isFinite(dateTs)) throw new Error("Invalid date");

      let attachmentStorageId: string | undefined;
      let attachmentName: string | undefined;
      if (attachment) {
        const uploadUrl = await generateUploadUrl();
        const resp = await fetch(uploadUrl, {
          method: "POST",
          headers: { "Content-Type": attachment.type || "application/octet-stream" },
          body: attachment,
        });
        if (!resp.ok) throw new Error("Failed to upload attachment");
        const payload = await resp.json();
        attachmentStorageId = typeof payload.storageId === "string" ? payload.storageId : undefined;
        attachmentName = attachment.name;
      }

      let saved = 0;
      for (const hId of validHorseIds) {
        const autoNotes = buildHorseNotes(hId);
        const combinedNotes = [autoNotes, form.notes].filter(Boolean).join("\n") || undefined;
        await createHorseRecord({
          horseId: hId as Id<"horses">,
          type: form.recordType,
          customType: form.recordType === "other" ? form.customType || undefined : undefined,
          date: dateTs,
          providerName: form.providerName || undefined,
          visitType:
            form.recordType === "veterinary" && form.visitType
              ? (form.visitType as "vaccination" | "treatment")
              : undefined,
          vaccineName:
            form.recordType === "veterinary" && form.visitType === "vaccination"
              ? form.vaccineName || undefined
              : undefined,
          treatmentDescription:
            form.recordType === "veterinary" && form.visitType === "treatment"
              ? form.treatmentDescription || undefined
              : undefined,
          serviceType: form.recordType === "farrier" ? form.serviceType || undefined : undefined,
          isUpcoming: false,
          notes: combinedNotes,
          attachmentStorageId,
          attachmentName,
          billId,
        });
        saved++;
      }
      setShowModal(false);
      setSavedCount((prev) => prev + saved);
      setForm((prev) => ({ ...prev, horseIds: [], notes: "" }));
      setAttachment(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save record");
    } finally {
      setSavingRecord(false);
    }
  }

  return (
    <div className={styles.wrapper}>
      <div className={styles.row}>
        <button type="button" className={styles.logBtn} onClick={openModal}>
          + log record
        </button>
        {savedCount > 0 && (
          <span className={styles.savedLabel}>
            {savedCount === 1 ? "record logged" : `${savedCount} records logged`}
          </span>
        )}
      </div>

      <Modal open={showModal} title="log record" onClose={() => setShowModal(false)}>
        <div className={styles.body}>
          <div className={styles.field}>
            <div className={styles.label}>horses *</div>
            <div className={styles.chipGrid}>
              {horses.map((h) => {
                const id = String(h._id);
                const selected = form.horseIds.includes(id);
                return (
                  <button
                    key={id}
                    type="button"
                    className={`${styles.chip} ${selected ? styles.chipSelected : ""}`}
                    onClick={() =>
                      setForm((prev) => ({
                        ...prev,
                        horseIds: selected
                          ? prev.horseIds.filter((x) => x !== id)
                          : [...prev.horseIds, id],
                      }))
                    }
                  >
                    {h.name}
                  </button>
                );
              })}
            </div>
          </div>

          <div className={styles.field}>
            <div className={styles.label}>date *</div>
            <input
              type="date"
              className={styles.input}
              value={form.date}
              onChange={(e) => setForm((prev) => ({ ...prev, date: e.target.value }))}
            />
          </div>

          <div className={styles.field}>
            <div className={styles.label}>record type *</div>
            <select
              className={styles.select}
              value={form.recordType}
              onChange={(e) =>
                setForm((prev) => ({
                  ...prev,
                  recordType: e.target.value as RecordType,
                  visitType: "",
                  vaccineName: "",
                  treatmentDescription: "",
                  serviceType: "",
                  customType: "",
                }))
              }
            >
              <option value="veterinary">veterinary</option>
              <option value="medication">medication</option>
              <option value="farrier">farrier</option>
              <option value="bodywork">bodywork</option>
              <option value="other">other</option>
            </select>
          </div>

          {form.recordType === "veterinary" && (
            <div className={styles.field}>
              <div className={styles.label}>visit type</div>
              <select
                className={styles.select}
                value={form.visitType}
                onChange={(e) =>
                  setForm((prev) => ({
                    ...prev,
                    visitType: e.target.value as "" | "vaccination" | "treatment",
                  }))
                }
              >
                <option value="">select</option>
                <option value="vaccination">vaccination</option>
                <option value="treatment">treatment</option>
              </select>
            </div>
          )}

          {form.recordType === "veterinary" && form.visitType === "vaccination" && (
            <div className={styles.field}>
              <div className={styles.label}>vaccine name</div>
              <input
                className={styles.input}
                value={form.vaccineName}
                onChange={(e) => setForm((prev) => ({ ...prev, vaccineName: e.target.value }))}
                placeholder="e.g. rabies, flu/rhino..."
              />
            </div>
          )}

          {form.recordType === "veterinary" && form.visitType === "treatment" && (
            <div className={styles.field}>
              <div className={styles.label}>treatment description</div>
              <input
                className={styles.input}
                value={form.treatmentDescription}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, treatmentDescription: e.target.value }))
                }
                placeholder="describe treatment..."
              />
            </div>
          )}

          {form.recordType === "farrier" && (
            <div className={styles.field}>
              <div className={styles.label}>service type</div>
              <select
                className={styles.select}
                value={form.serviceType}
                onChange={(e) => setForm((prev) => ({ ...prev, serviceType: e.target.value }))}
              >
                <option value="">select</option>
                <option value="Full Set">full set</option>
                <option value="Reset">reset</option>
                <option value="Trim">trim</option>
                <option value="Front Only">front only</option>
                <option value="Other">other</option>
              </select>
            </div>
          )}

          {form.recordType === "other" && (
            <div className={styles.field}>
              <div className={styles.label}>describe type</div>
              <input
                className={styles.input}
                value={form.customType}
                onChange={(e) => setForm((prev) => ({ ...prev, customType: e.target.value }))}
                placeholder="e.g. dental, chiro..."
              />
            </div>
          )}

          <div className={styles.field}>
            <div className={styles.label}>provider</div>
            <input
              className={styles.input}
              value={form.providerName}
              onChange={(e) => setForm((prev) => ({ ...prev, providerName: e.target.value }))}
            />
          </div>

          {form.horseIds.length > 0 &&
            (() => {
              const previews = form.horseIds
                .map((hId) => {
                  const horse = horses.find((h) => String(h._id) === hId);
                  return { name: horse?.name ?? "unknown", notes: buildHorseNotes(hId) };
                })
                .filter((p) => p.notes);
              if (previews.length === 0) return null;
              return (
                <div className={styles.field}>
                  <div className={styles.label}>services (auto-included)</div>
                  <div className={styles.autoNotesPreview}>
                    {previews.map((p, i) => (
                      <div key={i} className={styles.autoNotesHorse}>
                        {form.horseIds.length > 1 && (
                          <div className={styles.autoNotesName}>{p.name}</div>
                        )}
                        <div className={styles.autoNotesText}>{p.notes}</div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })()}

          <div className={styles.field}>
            <div className={styles.label}>additional notes</div>
            <textarea
              className={styles.textarea}
              value={form.notes}
              onChange={(e) => setForm((prev) => ({ ...prev, notes: e.target.value }))}
              placeholder="add any details..."
              rows={3}
            />
          </div>

          <div className={styles.field}>
            <div className={styles.label}>attachment</div>
            <input
              ref={fileRef}
              type="file"
              style={{ display: "none" }}
              onChange={(e) => {
                const file = e.target.files?.[0] ?? null;
                setAttachment(file);
              }}
            />
            {attachment ? (
              <div className={styles.attachRow}>
                <span className={styles.attachName}>📎 {attachment.name}</span>
                <button
                  type="button"
                  className={styles.attachRemove}
                  onClick={() => {
                    setAttachment(null);
                    if (fileRef.current) fileRef.current.value = "";
                  }}
                >
                  ✕
                </button>
              </div>
            ) : (
              <button
                type="button"
                className={styles.attachBtn}
                onClick={() => fileRef.current?.click()}
              >
                + add attachment
              </button>
            )}
          </div>

          {error && (
            <div style={{ fontSize: 12, color: "#E5484D" }}>{error}</div>
          )}

          <div className={styles.actions}>
            <button type="button" className={styles.cancelBtn} onClick={() => setShowModal(false)}>
              cancel
            </button>
            <button
              type="button"
              className={styles.saveBtn}
              disabled={form.horseIds.length === 0 || !form.date || savingRecord}
              onClick={() => void onSave()}
            >
              {savingRecord
                ? "saving..."
                : form.horseIds.length > 1
                  ? `save ${form.horseIds.length} records`
                  : "save record"}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
