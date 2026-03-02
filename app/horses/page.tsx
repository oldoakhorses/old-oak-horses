"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import Modal from "@/components/Modal";
import NavBar from "@/components/NavBar";
import styles from "./horses.module.css";

type StatusFilter = "active" | "inactive" | "all";

type HorseFormState = {
  name: string;
  yearOfBirth: string;
  sex: "" | "gelding" | "mare" | "stallion";
  usefNumber: string;
  feiNumber: string;
  owner: string;
};

const EMPTY_FORM: HorseFormState = {
  name: "",
  yearOfBirth: "",
  sex: "",
  usefNumber: "",
  feiNumber: "",
  owner: "",
};

export default function HorsesPage() {
  const horses = useQuery(api.horses.getAllHorses) ?? [];
  const createHorse = useMutation(api.horses.createHorse);
  const setHorseStatus = useMutation(api.horses.setHorseStatus);

  const [statusFilter, setStatusFilter] = useState<StatusFilter>("active");
  const [openMenuHorseId, setOpenMenuHorseId] = useState<string>("");
  const [confirmSoldHorseId, setConfirmSoldHorseId] = useState<string>("");
  const [showAddModal, setShowAddModal] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState("");
  const [form, setForm] = useState<HorseFormState>(EMPTY_FORM);

  const filtered = useMemo(() => {
    return horses
      .filter((horse) => {
        if (statusFilter === "all") return true;
        if (statusFilter === "active") return horse.status === "active";
        return horse.status !== "active";
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [horses, statusFilter]);

  async function updateStatus(horseId: Id<"horses">, status: "active" | "inactive", isSold?: boolean) {
    await setHorseStatus({ horseId, status, isSold });
    setOpenMenuHorseId("");
    setConfirmSoldHorseId("");
  }

  async function onSubmitHorse(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!form.name.trim()) {
      setFormError("name is required");
      return;
    }

    setFormError("");
    setIsSubmitting(true);
    try {
      await createHorse({
        name: form.name.trim(),
        yearOfBirth: form.yearOfBirth ? Number(form.yearOfBirth) : undefined,
        sex: form.sex || undefined,
        usefNumber: form.usefNumber || undefined,
        feiNumber: form.feiNumber || undefined,
        owner: form.owner || undefined,
      });
      setForm(EMPTY_FORM);
      setShowAddModal(false);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "failed to add horse");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="page-shell">
      <NavBar
        items={[
          { label: "old-oak-horses", href: "/dashboard", brand: true },
          { label: "horses", current: true },
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

        <section className={styles.headerRow}>
          <div>
            <div className="ui-label">// HORSES</div>
            <h1 className={styles.title}>horses</h1>
          </div>
          <button type="button" className={styles.addButton} onClick={() => setShowAddModal(true)}>
            + add horse
          </button>
        </section>

        <section className={styles.filterRow}>
          <div className={styles.tabs}>
            <button type="button" className={statusFilter === "active" ? styles.tabActive : styles.tab} onClick={() => setStatusFilter("active")}>
              Active
            </button>
            <button type="button" className={statusFilter === "inactive" ? styles.tabActive : styles.tab} onClick={() => setStatusFilter("inactive")}>
              Inactive
            </button>
            <button type="button" className={statusFilter === "all" ? styles.tabActive : styles.tab} onClick={() => setStatusFilter("all")}>
              All
            </button>
          </div>
        </section>

        <section className={styles.horsesCard}>
          <div className={styles.horsesHeader}>
            <div>HORSE</div>
            <div>OWNER</div>
            <div>SEX</div>
            <div>YOB</div>
            <div>STATUS</div>
            <div />
          </div>
          {filtered.map((horse) => {
            const menuOpen = openMenuHorseId === String(horse._id);
            const confirmOpen = confirmSoldHorseId === String(horse._id);
            return (
              <div key={horse._id} className={styles.horseRow}>
                <Link href={`/horses/${horse._id}`} className={styles.horseName}>
                  <span className={styles.horseEmoji}>🐴</span>
                  {horse.name}
                </Link>
                <div className={styles.owner}>{horse.owner || "—"}</div>
                <div className={styles.sex}>{horse.sex ? capitalize(horse.sex) : "—"}</div>
                <div className={styles.yob}>{horse.yearOfBirth ? String(horse.yearOfBirth) : "—"}</div>
                <div>
                  {horse.isSold ? (
                    <span className={styles.statusSold}>sold</span>
                  ) : horse.status === "active" ? (
                    <span className={styles.statusActive}>active</span>
                  ) : (
                    <span className={styles.statusInactive}>inactive</span>
                  )}
                </div>
                <div className={styles.menuWrap}>
                  <button type="button" className={styles.menuButton} onClick={() => setOpenMenuHorseId(menuOpen ? "" : String(horse._id))}>
                    ⋮
                  </button>
                  {menuOpen ? (
                    <div className={styles.menuDropdown}>
                      <Link href={`/horses/${horse._id}`} className={styles.menuItem}>
                        View Profile
                      </Link>
                      <Link href={`/horses/${horse._id}?edit=1`} className={styles.menuItem}>
                        Edit Profile
                      </Link>
                      <div className={styles.menuDivider} />
                      {horse.status === "active" ? (
                        <button type="button" className={styles.menuItem} onClick={() => updateStatus(horse._id, "inactive")}>
                          Deactivate
                        </button>
                      ) : (
                        <button type="button" className={styles.menuItem} onClick={() => updateStatus(horse._id, "active", false)}>
                          Activate
                        </button>
                      )}
                      {!horse.isSold ? (
                        <button type="button" className={`${styles.menuItem} ${styles.menuItemDanger}`} onClick={() => setConfirmSoldHorseId(String(horse._id))}>
                          Mark as Sold
                        </button>
                      ) : null}
                      {confirmOpen ? (
                        <div className={styles.confirmSold}>
                          <p>Mark {horse.name} as sold?</p>
                          <div className={styles.confirmActions}>
                            <button type="button" className="ui-button-outlined" onClick={() => setConfirmSoldHorseId("")}>
                              cancel
                            </button>
                            <button type="button" className="ui-button-danger" onClick={() => updateStatus(horse._id, "inactive", true)}>
                              yes, mark as sold
                            </button>
                          </div>
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              </div>
            );
          })}
          {filtered.length === 0 ? <div className={styles.empty}>no horses found</div> : null}
        </section>

        <div className="ui-footer">OLD_OAK_HORSES // HORSES</div>
      </main>

      <Modal open={showAddModal} title="add horse" onClose={() => setShowAddModal(false)}>
        <form className={styles.form} onSubmit={onSubmitHorse}>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>NAME *</span>
            <input className={styles.input} value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} />
          </label>
          <div className={styles.twoCol}>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>YEAR OF BIRTH</span>
              <input className={styles.input} value={form.yearOfBirth} onChange={(e) => setForm((p) => ({ ...p, yearOfBirth: e.target.value }))} />
            </label>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>SEX</span>
              <select className={styles.input} value={form.sex} onChange={(e) => setForm((p) => ({ ...p, sex: e.target.value as HorseFormState["sex"] }))}>
                <option value="">-- select --</option>
                <option value="gelding">Gelding</option>
                <option value="mare">Mare</option>
                <option value="stallion">Stallion</option>
              </select>
            </label>
          </div>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>OWNER</span>
            <input className={styles.input} value={form.owner} onChange={(e) => setForm((p) => ({ ...p, owner: e.target.value }))} />
          </label>
          <div className={styles.twoCol}>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>USEF #</span>
              <input className={styles.input} value={form.usefNumber} onChange={(e) => setForm((p) => ({ ...p, usefNumber: e.target.value }))} />
            </label>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>FEI #</span>
              <input className={styles.input} value={form.feiNumber} onChange={(e) => setForm((p) => ({ ...p, feiNumber: e.target.value }))} />
            </label>
          </div>
          {formError ? <p className={styles.error}>{formError}</p> : null}
          <div className={styles.modalActions}>
            <button type="button" className="ui-button-outlined" onClick={() => setShowAddModal(false)}>
              cancel
            </button>
            <button type="submit" className="ui-button-filled" disabled={isSubmitting}>
              {isSubmitting ? "saving..." : "add horse"}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

function capitalize(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
