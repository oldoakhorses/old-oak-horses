"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import styles from "./UnmatchedHorseBanner.module.css";

type Props = {
  billId: Id<"bills"> | string;
  unmatchedNames: string[];
  onResolved?: () => void;
};

export default function UnmatchedHorseBanner({ billId, unmatchedNames, onResolved }: Props) {
  const horses = useQuery(api.horses.getActiveHorses) ?? [];
  const resolveUnmatchedHorse = useMutation(api.bills.resolveUnmatchedHorse);
  const addHorseAndResolveUnmatched = useMutation(api.bills.addHorseAndResolveUnmatched);

  const [resolvingName, setResolvingName] = useState<string | null>(null);
  const [addForms, setAddForms] = useState<Record<string, { name: string; owner: string }>>({});
  const [saving, setSaving] = useState(false);

  if (!unmatchedNames.length) return null;

  return (
    <section className={styles.banner}>
      <div className={styles.title}>⚠ unmatched horse names</div>
      <p className={styles.text}>The following names could not be matched to an active horse:</p>

      <div className={styles.rows}>
        {unmatchedNames.map((rawName) => {
          const form = addForms[rawName] ?? { name: rawName, owner: "" };
          return (
            <div className={styles.row} key={rawName}>
              <span className={styles.name}>"{rawName}"</span>
              <select
                className={styles.select}
                value={resolvingName === rawName ? "__loading__" : ""}
                disabled={saving}
                onChange={async (event) => {
                  const horseId = event.target.value;
                  if (!horseId) return;
                  const horse = horses.find((row) => String(row._id) === horseId);
                  if (!horse) return;
                  setSaving(true);
                  setResolvingName(rawName);
                  try {
                    await resolveUnmatchedHorse({
                      billId: billId as Id<"bills">,
                      originalName: rawName,
                      horseId: horse._id
                    });
                    onResolved?.();
                  } finally {
                    setSaving(false);
                    setResolvingName(null);
                  }
                }}
              >
                <option value="">select horse...</option>
                {horses.map((horse) => (
                  <option key={horse._id} value={String(horse._id)}>
                    {horse.name}
                  </option>
                ))}
              </select>
              <span className={styles.or}>or</span>
              <button
                type="button"
                className={styles.addBtn}
                onClick={() => setAddForms((prev) => ({ ...prev, [rawName]: form }))}
                disabled={saving}
              >
                + add new horse
              </button>

              {addForms[rawName] ? (
                <div className={styles.inlineForm}>
                  <input
                    className={styles.input}
                    placeholder="Name"
                    value={form.name}
                    onChange={(event) =>
                      setAddForms((prev) => ({
                        ...prev,
                        [rawName]: { ...form, name: event.target.value }
                      }))
                    }
                  />
                  <input
                    className={styles.input}
                    placeholder="Owner (optional)"
                    value={form.owner}
                    onChange={(event) =>
                      setAddForms((prev) => ({
                        ...prev,
                        [rawName]: { ...form, owner: event.target.value }
                      }))
                    }
                  />
                  <div className={styles.formActions}>
                    <button
                      type="button"
                      className={styles.cancelBtn}
                      onClick={() =>
                        setAddForms((prev) => {
                          const next = { ...prev };
                          delete next[rawName];
                          return next;
                        })
                      }
                      disabled={saving}
                    >
                      cancel
                    </button>
                    <button
                      type="button"
                      className={styles.assignBtn}
                      onClick={async () => {
                        const name = form.name.trim();
                        if (name.length < 2) return;
                        setSaving(true);
                        try {
                          await addHorseAndResolveUnmatched({
                            billId: billId as Id<"bills">,
                            originalName: rawName,
                            horseName: name,
                            owner: form.owner.trim() || undefined
                          });
                          onResolved?.();
                          setAddForms((prev) => {
                            const next = { ...prev };
                            delete next[rawName];
                            return next;
                          });
                        } finally {
                          setSaving(false);
                        }
                      }}
                      disabled={saving}
                    >
                      add horse & assign
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>

      <p className={styles.text}>All horses must be matched before this invoice can be approved.</p>
    </section>
  );
}

