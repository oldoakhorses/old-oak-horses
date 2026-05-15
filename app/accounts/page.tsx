"use client";

import Link from "next/link";
import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import Modal from "@/components/Modal";
import NavBar from "@/components/NavBar";
import styles from "./accounts.module.css";

type AddFormState = {
  name: string;
  email: string;
  passcode: string;
  role: "" | "admin" | "investor";
};

const EMPTY_ADD_FORM: AddFormState = {
  name: "",
  email: "",
  passcode: "",
  role: "",
};

export default function AccountsPage() {
  const users = useQuery(api.users.list) ?? [];
  const createUser = useMutation(api.users.createUser);
  const updateUser = useMutation(api.users.updateUser);
  const resetPasscode = useMutation(api.users.resetPasscode);
  const deleteUser = useMutation(api.users.deleteUser);

  const [showAddModal, setShowAddModal] = useState(false);
  const [addForm, setAddForm] = useState<AddFormState>(EMPTY_ADD_FORM);
  const [addError, setAddError] = useState("");
  const [isAdding, setIsAdding] = useState(false);

  const [openMenuId, setOpenMenuId] = useState<string>("");
  const [resetModal, setResetModal] = useState<{ userId: Id<"users">; name: string } | null>(null);
  const [newPasscode, setNewPasscode] = useState("");
  const [resetError, setResetError] = useState("");
  const [isResetting, setIsResetting] = useState(false);

  const [deleteModal, setDeleteModal] = useState<{ userId: Id<"users">; name: string } | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  async function onAddUser(e: React.FormEvent) {
    e.preventDefault();
    if (!addForm.name.trim() || !addForm.email.trim() || !addForm.passcode.trim()) {
      setAddError("name, email, and passcode are required");
      return;
    }
    setAddError("");
    setIsAdding(true);
    try {
      await createUser({
        name: addForm.name.trim(),
        email: addForm.email.trim(),
        passcode: addForm.passcode,
        role: addForm.role || undefined,
      });
      setAddForm(EMPTY_ADD_FORM);
      setShowAddModal(false);
    } catch (err) {
      setAddError(err instanceof Error ? err.message : "failed to create user");
    } finally {
      setIsAdding(false);
    }
  }

  async function onToggleActive(userId: Id<"users">, currentlyActive: boolean) {
    await updateUser({ userId, isActive: !currentlyActive });
    setOpenMenuId("");
  }

  async function onResetPasscode(e: React.FormEvent) {
    e.preventDefault();
    if (!resetModal || !newPasscode.trim()) {
      setResetError("passcode is required");
      return;
    }
    setResetError("");
    setIsResetting(true);
    try {
      await resetPasscode({ userId: resetModal.userId, newPasscode: newPasscode });
      setResetModal(null);
      setNewPasscode("");
    } catch (err) {
      setResetError(err instanceof Error ? err.message : "failed to reset passcode");
    } finally {
      setIsResetting(false);
    }
  }

  async function onDeleteUser() {
    if (!deleteModal) return;
    setIsDeleting(true);
    try {
      await deleteUser({ userId: deleteModal.userId });
      setDeleteModal(null);
    } catch {
      // ignore
    } finally {
      setIsDeleting(false);
    }
  }

  const sorted = [...users].sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""));

  return (
    <div className="page-shell">
      <NavBar
        items={[
          { label: "old-oak-horses", href: "/dashboard", brand: true },
          { label: "accounts", current: true },
        ]}
        actions={[]}
      />
      <main className="page-main">
        <Link href="/dashboard" className="ui-back-link">
          ← cd /dashboard
        </Link>

        <section className={styles.headerRow}>
          <div>
            <div className="ui-label">// ACCOUNTS</div>
            <h1 className={styles.title}>accounts</h1>
          </div>
          <button type="button" className={styles.addButton} onClick={() => setShowAddModal(true)}>
            + add user
          </button>
        </section>

        <section className={styles.card}>
          <div className={styles.cardHeader}>
            <div>USER</div>
            <div>ROLE</div>
            <div>STATUS</div>
            <div />
          </div>
          {sorted.map((user) => {
            const menuOpen = openMenuId === String(user._id);
            return (
              <div key={user._id} className={styles.row}>
                <div className={styles.userName}>
                  {user.name ?? "—"}
                  <span className={styles.userEmail}>{user.email ?? ""}</span>
                </div>
                <div className={styles.role}>{user.role ?? "—"}</div>
                <div>
                  {user.isActive ? (
                    <span className={styles.statusActive}>active</span>
                  ) : (
                    <span className={styles.statusInactive}>inactive</span>
                  )}
                </div>
                <div className={styles.menuWrap}>
                  <button
                    type="button"
                    className={styles.menuButton}
                    onClick={() => setOpenMenuId(menuOpen ? "" : String(user._id))}
                  >
                    ⋮
                  </button>
                  {menuOpen ? (
                    <div className={styles.menuDropdown}>
                      <button
                        type="button"
                        className={styles.menuItem}
                        onClick={() => onToggleActive(user._id, user.isActive)}
                      >
                        {user.isActive ? "Deactivate" : "Activate"}
                      </button>
                      <button
                        type="button"
                        className={styles.menuItem}
                        onClick={() => {
                          setResetModal({ userId: user._id, name: user.name ?? "Unknown" });
                          setOpenMenuId("");
                        }}
                      >
                        Reset Passcode
                      </button>
                      <button
                        type="button"
                        className={`${styles.menuItem} ${styles.menuItemDanger}`}
                        onClick={() => {
                          setDeleteModal({ userId: user._id, name: user.name ?? "Unknown" });
                          setOpenMenuId("");
                        }}
                      >
                        Delete
                      </button>
                    </div>
                  ) : null}
                </div>
              </div>
            );
          })}
          {sorted.length === 0 ? <div className={styles.empty}>no accounts yet</div> : null}
        </section>

        <div className="ui-footer">OLD_OAK_HORSES // ACCOUNTS</div>
      </main>

      {/* Add user modal */}
      <Modal open={showAddModal} title="add user" onClose={() => setShowAddModal(false)}>
        <form className={styles.form} onSubmit={onAddUser}>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>NAME *</span>
            <input
              className={styles.input}
              value={addForm.name}
              onChange={(e) => setAddForm((p) => ({ ...p, name: e.target.value }))}
            />
          </label>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>EMAIL *</span>
            <input
              className={styles.input}
              type="email"
              value={addForm.email}
              onChange={(e) => setAddForm((p) => ({ ...p, email: e.target.value }))}
            />
          </label>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>PASSCODE *</span>
            <input
              className={styles.input}
              type="text"
              value={addForm.passcode}
              onChange={(e) => setAddForm((p) => ({ ...p, passcode: e.target.value }))}
            />
          </label>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>ROLE</span>
            <select
              className={styles.input}
              value={addForm.role}
              onChange={(e) => setAddForm((p) => ({ ...p, role: e.target.value as AddFormState["role"] }))}
            >
              <option value="">-- select --</option>
              <option value="admin">Admin</option>
              <option value="investor">Investor</option>
            </select>
          </label>
          {addError ? <p className={styles.error}>{addError}</p> : null}
          <div className={styles.modalActions}>
            <button type="button" className="ui-button-outlined" onClick={() => setShowAddModal(false)}>
              cancel
            </button>
            <button type="submit" className="ui-button-filled" disabled={isAdding}>
              {isAdding ? "creating..." : "add user"}
            </button>
          </div>
        </form>
      </Modal>

      {/* Reset passcode modal */}
      <Modal
        open={!!resetModal}
        title={`reset passcode — ${resetModal?.name ?? ""}`}
        onClose={() => {
          setResetModal(null);
          setNewPasscode("");
          setResetError("");
        }}
      >
        <form className={styles.form} onSubmit={onResetPasscode}>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>NEW PASSCODE *</span>
            <input
              className={styles.input}
              type="text"
              value={newPasscode}
              onChange={(e) => setNewPasscode(e.target.value)}
            />
          </label>
          {resetError ? <p className={styles.error}>{resetError}</p> : null}
          <div className={styles.modalActions}>
            <button
              type="button"
              className="ui-button-outlined"
              onClick={() => {
                setResetModal(null);
                setNewPasscode("");
                setResetError("");
              }}
            >
              cancel
            </button>
            <button type="submit" className="ui-button-filled" disabled={isResetting}>
              {isResetting ? "resetting..." : "reset passcode"}
            </button>
          </div>
        </form>
      </Modal>

      {/* Delete user modal */}
      <Modal
        open={!!deleteModal}
        title="delete user"
        onClose={() => setDeleteModal(null)}
      >
        <p className={styles.deleteText}>
          Are you sure you want to delete <strong>{deleteModal?.name}</strong>? This will remove their account and all active sessions.
        </p>
        <div className={styles.modalActions}>
          <button type="button" className="ui-button-outlined" onClick={() => setDeleteModal(null)}>
            cancel
          </button>
          <button
            type="button"
            className="ui-button-filled"
            style={{ background: "#e5484d" }}
            disabled={isDeleting}
            onClick={onDeleteUser}
          >
            {isDeleting ? "deleting..." : "delete user"}
          </button>
        </div>
      </Modal>
    </div>
  );
}
