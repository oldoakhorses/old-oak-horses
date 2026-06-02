"use client";

import { useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useAuth } from "@/contexts/AuthContext";
import Modal from "@/components/Modal";
import NavBar from "@/components/NavBar";
import styles from "./accounts.module.css";

export default function AccountPage() {
  const { user } = useAuth();
  const userId = user?.id as Id<"users"> | undefined;

  const profile = useQuery(api.users.getProfile, userId ? { userId } : "skip");
  const updateProfile = useMutation(api.users.updateProfile);
  const resetPasscode = useMutation(api.users.resetPasscode);
  const generateUploadUrl = useMutation(api.users.generateUploadUrl);
  const setProfilePhoto = useMutation(api.users.setProfilePhoto);
  const removeProfilePhoto = useMutation(api.users.removeProfilePhoto);

  const [editingName, setEditingName] = useState(false);
  const [nameValue, setNameValue] = useState("");
  const [isSavingName, setIsSavingName] = useState(false);

  const [showResetModal, setShowResetModal] = useState(false);
  const [currentPasscode, setCurrentPasscode] = useState("");
  const [newPasscode, setNewPasscode] = useState("");
  const [confirmPasscode, setConfirmPasscode] = useState("");
  const [resetError, setResetError] = useState("");
  const [resetSuccess, setResetSuccess] = useState(false);
  const [isResetting, setIsResetting] = useState(false);

  const [isUploadingPhoto, setIsUploadingPhoto] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function startEditingName() {
    setNameValue(profile?.name ?? "");
    setEditingName(true);
  }

  async function saveName() {
    if (!userId || !nameValue.trim()) return;
    setIsSavingName(true);
    try {
      await updateProfile({ userId, name: nameValue.trim() });
      setEditingName(false);
    } finally {
      setIsSavingName(false);
    }
  }

  async function onResetPasscode(e: React.FormEvent) {
    e.preventDefault();
    if (!userId) return;
    if (!newPasscode.trim()) {
      setResetError("new passcode is required");
      return;
    }
    if (newPasscode !== confirmPasscode) {
      setResetError("passcodes do not match");
      return;
    }
    setResetError("");
    setIsResetting(true);
    try {
      await resetPasscode({ userId, newPasscode });
      setResetSuccess(true);
      setCurrentPasscode("");
      setNewPasscode("");
      setConfirmPasscode("");
    } catch (err) {
      setResetError(err instanceof Error ? err.message : "failed to reset passcode");
    } finally {
      setIsResetting(false);
    }
  }

  async function onUploadPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !userId) return;
    setIsUploadingPhoto(true);
    try {
      const uploadUrl = await generateUploadUrl();
      const res = await fetch(uploadUrl, {
        method: "POST",
        headers: { "Content-Type": file.type },
        body: file,
      });
      const { storageId } = await res.json();
      await setProfilePhoto({ userId, storageId });
    } finally {
      setIsUploadingPhoto(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function onRemovePhoto() {
    if (!userId) return;
    await removeProfilePhoto({ userId });
  }

  if (!user || !profile) {
    return (
      <div className="page-shell">
        <NavBar items={[{ label: "team-ldk", href: "/dashboard", brand: true }, { label: "account", current: true }]} actions={[]} />
        <main className="page-main">
          <div className={styles.empty}>loading...</div>
        </main>
      </div>
    );
  }

  return (
    <div className="page-shell">
      <NavBar
        items={[
          { label: "team-ldk", href: "/dashboard", brand: true },
          { label: "account", current: true },
        ]}
        actions={[]}
      />
      <main className="page-main">
        <section className={styles.headerRow}>
          <div>
            <div className="ui-label">// ACCOUNT</div>
            <h1 className={styles.title}>profile</h1>
          </div>
        </section>

        <section className={styles.profileCard}>
          {/* Photo */}
          <div className={styles.photoSection}>
            <div className={styles.avatar}>
              {profile.profilePhotoUrl ? (
                <img src={profile.profilePhotoUrl} alt="Profile" className={styles.avatarImg} />
              ) : (
                <span className={styles.avatarPlaceholder}>
                  {(profile.name ?? "?").charAt(0).toUpperCase()}
                </span>
              )}
            </div>
            <div className={styles.photoActions}>
              <button
                type="button"
                className={styles.photoBtn}
                onClick={() => fileInputRef.current?.click()}
                disabled={isUploadingPhoto}
              >
                {isUploadingPhoto ? "uploading..." : "upload photo"}
              </button>
              {profile.profilePhotoUrl ? (
                <button type="button" className={styles.photoBtnRemove} onClick={onRemovePhoto}>
                  remove
                </button>
              ) : null}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                style={{ display: "none" }}
                onChange={onUploadPhoto}
              />
            </div>
          </div>

          {/* Fields */}
          <div className={styles.fields}>
            <div className={styles.fieldRow}>
              <div className={styles.fieldLabel}>NAME</div>
              {editingName ? (
                <div className={styles.fieldEditRow}>
                  <input
                    className={styles.fieldInput}
                    value={nameValue}
                    onChange={(e) => setNameValue(e.target.value)}
                    autoFocus
                  />
                  <button type="button" className={styles.fieldSaveBtn} onClick={saveName} disabled={isSavingName}>
                    {isSavingName ? "..." : "save"}
                  </button>
                  <button type="button" className={styles.fieldCancelBtn} onClick={() => setEditingName(false)}>
                    cancel
                  </button>
                </div>
              ) : (
                <div className={styles.fieldValueRow}>
                  <span className={styles.fieldValue}>{profile.name ?? "—"}</span>
                  <button type="button" className={styles.fieldEditBtn} onClick={startEditingName}>
                    edit
                  </button>
                </div>
              )}
            </div>

            <div className={styles.fieldRow}>
              <div className={styles.fieldLabel}>EMAIL</div>
              <div className={styles.fieldValueRow}>
                <span className={styles.fieldValue}>{profile.email ?? "—"}</span>
              </div>
            </div>

            <div className={styles.fieldRow}>
              <div className={styles.fieldLabel}>PASSCODE</div>
              <div className={styles.fieldValueRow}>
                <span className={styles.fieldValue}>••••••••</span>
                <button type="button" className={styles.fieldEditBtn} onClick={() => { setShowResetModal(true); setResetSuccess(false); }}>
                  reset
                </button>
              </div>
            </div>

            <div className={styles.fieldRow}>
              <div className={styles.fieldLabel}>ROLE</div>
              <div className={styles.fieldValueRow}>
                <span className={styles.fieldValue}>{profile.role ?? "—"}</span>
              </div>
            </div>
          </div>
        </section>

        <div className="ui-footer">TEAM_LDK // ACCOUNT</div>
      </main>

      <Modal
        open={showResetModal}
        title="reset passcode"
        onClose={() => {
          setShowResetModal(false);
          setCurrentPasscode("");
          setNewPasscode("");
          setConfirmPasscode("");
          setResetError("");
          setResetSuccess(false);
        }}
      >
        {resetSuccess ? (
          <div className={styles.successMessage}>
            <p>Passcode updated successfully. You will need to sign in again.</p>
            <div className={styles.modalActions}>
              <button type="button" className="ui-button-filled" onClick={() => setShowResetModal(false)}>
                done
              </button>
            </div>
          </div>
        ) : (
          <form className={styles.form} onSubmit={onResetPasscode}>
            <label className={styles.field}>
              <span className={styles.formFieldLabel}>NEW PASSCODE *</span>
              <input
                className={styles.input}
                type="password"
                value={newPasscode}
                onChange={(e) => setNewPasscode(e.target.value)}
              />
            </label>
            <label className={styles.field}>
              <span className={styles.formFieldLabel}>CONFIRM PASSCODE *</span>
              <input
                className={styles.input}
                type="password"
                value={confirmPasscode}
                onChange={(e) => setConfirmPasscode(e.target.value)}
              />
            </label>
            {resetError ? <p className={styles.error}>{resetError}</p> : null}
            <div className={styles.modalActions}>
              <button type="button" className="ui-button-outlined" onClick={() => setShowResetModal(false)}>
                cancel
              </button>
              <button type="submit" className="ui-button-filled" disabled={isResetting}>
                {isResetting ? "resetting..." : "reset passcode"}
              </button>
            </div>
          </form>
        )}
      </Modal>
    </div>
  );
}
