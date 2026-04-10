"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import Modal from "@/components/Modal";
import NavBar from "@/components/NavBar";
import styles from "./team.module.css";

type StatusFilter = "active" | "inactive" | "all";
type PersonRole = "rider" | "groom" | "freelance" | "trainer";

type PersonFormState = {
  name: string;
  role: "" | PersonRole;
};

const EMPTY_FORM: PersonFormState = {
  name: "",
  role: "",
};

const ROLE_LABELS: Record<PersonRole, string> = {
  rider: "Rider",
  groom: "Groom",
  trainer: "Trainer",
  freelance: "Freelance",
};

const ROLE_ICONS: Record<PersonRole, string> = {
  rider: "🏇",
  groom: "🧹",
  trainer: "🎯",
  freelance: "🧑‍💼",
};

export default function TeamPage() {
  const people = useQuery(api.people.listAll) ?? [];
  const createPerson = useMutation(api.people.createPerson);
  const setPersonActive = useMutation(api.people.setPersonActive);

  const [statusFilter, setStatusFilter] = useState<StatusFilter>("active");
  const [openMenuPersonId, setOpenMenuPersonId] = useState<string>("");
  const [showAddModal, setShowAddModal] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState("");
  const [form, setForm] = useState<PersonFormState>(EMPTY_FORM);

  const filtered = useMemo(() => {
    return people
      .filter((person) => {
        if (statusFilter === "all") return true;
        if (statusFilter === "active") return person.isActive === true;
        return person.isActive === false;
      })
      .sort((a, b) => {
        if (a.role !== b.role) return a.role.localeCompare(b.role);
        return a.name.localeCompare(b.name);
      });
  }, [people, statusFilter]);

  async function toggleActive(personId: Id<"people">, nextActive: boolean) {
    await setPersonActive({ id: personId, isActive: nextActive });
    setOpenMenuPersonId("");
  }

  async function onSubmitPerson(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!form.name.trim()) {
      setFormError("name is required");
      return;
    }
    if (!form.role) {
      setFormError("role is required");
      return;
    }

    setFormError("");
    setIsSubmitting(true);
    try {
      await createPerson({
        name: form.name.trim(),
        role: form.role as PersonRole,
      });
      setForm(EMPTY_FORM);
      setShowAddModal(false);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "failed to add team member");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="page-shell">
      <NavBar
        items={[
          { label: "old-oak-horses", href: "/dashboard", brand: true },
          { label: "team", current: true },
        ]}
        actions={[
          { label: "upload invoices", href: "/dashboard?panel=invoice", variant: "outlined" },
          { label: "biz overview", href: "/biz-overview", variant: "filled" },
        ]}
      />
      <main className="page-main">
        <Link href="/dashboard" className="ui-back-link">
          ← cd /dashboard
        </Link>

        <section className={styles.headerRow}>
          <div>
            <div className="ui-label">// TEAM</div>
            <h1 className={styles.title}>team</h1>
          </div>
          <button type="button" className={styles.addButton} onClick={() => setShowAddModal(true)}>
            + add team member
          </button>
        </section>

        <section className={styles.filterRow}>
          <div className={styles.tabs}>
            <button
              type="button"
              className={statusFilter === "active" ? styles.tabActive : styles.tab}
              onClick={() => setStatusFilter("active")}
            >
              Active
            </button>
            <button
              type="button"
              className={statusFilter === "inactive" ? styles.tabActive : styles.tab}
              onClick={() => setStatusFilter("inactive")}
            >
              Inactive
            </button>
            <button
              type="button"
              className={statusFilter === "all" ? styles.tabActive : styles.tab}
              onClick={() => setStatusFilter("all")}
            >
              All
            </button>
          </div>
        </section>

        <section className={styles.teamCard}>
          <div className={styles.teamHeader}>
            <div>NAME</div>
            <div>ROLE</div>
            <div>STATUS</div>
            <div />
          </div>
          {filtered.map((person) => {
            const menuOpen = openMenuPersonId === String(person._id);
            const role = person.role as PersonRole;
            return (
              <div key={person._id} className={styles.personRow}>
                <Link href={`/team/${person._id}`} className={styles.personName}>
                  <span className={styles.personEmoji}>{ROLE_ICONS[role] ?? "👤"}</span>
                  {person.name}
                </Link>
                <div className={styles.role}>{ROLE_LABELS[role] ?? role}</div>
                <div>
                  {person.isActive ? (
                    <span className={styles.statusActive}>active</span>
                  ) : (
                    <span className={styles.statusInactive}>inactive</span>
                  )}
                </div>
                <div className={styles.menuWrap}>
                  <button
                    type="button"
                    className={styles.menuButton}
                    onClick={() => setOpenMenuPersonId(menuOpen ? "" : String(person._id))}
                  >
                    ⋮
                  </button>
                  {menuOpen ? (
                    <div className={styles.menuDropdown}>
                      <Link href={`/team/${person._id}`} className={styles.menuItem}>
                        View
                      </Link>
                      {person.isActive ? (
                        <button type="button" className={styles.menuItem} onClick={() => toggleActive(person._id, false)}>
                          Deactivate
                        </button>
                      ) : (
                        <button type="button" className={styles.menuItem} onClick={() => toggleActive(person._id, true)}>
                          Activate
                        </button>
                      )}
                    </div>
                  ) : null}
                </div>
              </div>
            );
          })}
          {filtered.length === 0 ? <div className={styles.empty}>no team members found</div> : null}
        </section>

        <div className="ui-footer">OLD_OAK_HORSES // TEAM</div>
      </main>

      <Modal open={showAddModal} title="add team member" onClose={() => setShowAddModal(false)}>
        <form className={styles.form} onSubmit={onSubmitPerson}>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>NAME *</span>
            <input
              className={styles.input}
              value={form.name}
              onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
              placeholder="e.g., Lucy Davis"
            />
          </label>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>ROLE *</span>
            <select
              className={styles.input}
              value={form.role}
              onChange={(e) => setForm((p) => ({ ...p, role: e.target.value as PersonFormState["role"] }))}
            >
              <option value="">-- select role --</option>
              <option value="rider">Rider</option>
              <option value="groom">Groom</option>
              <option value="trainer">Trainer</option>
              <option value="freelance">Freelance</option>
            </select>
          </label>
          {formError ? <p className={styles.error}>{formError}</p> : null}
          <div className={styles.modalActions}>
            <button type="button" className="ui-button-outlined" onClick={() => setShowAddModal(false)}>
              cancel
            </button>
            <button type="submit" className="ui-button-filled" disabled={isSubmitting}>
              {isSubmitting ? "saving..." : "add team member"}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
