"use client";

import Link from "next/link";
import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import Modal from "@/components/Modal";
import NavBar from "@/components/NavBar";
import styles from "./owners.module.css";

export default function OwnersPage() {
  const owners = useQuery(api.owners.list) ?? [];
  const horses = useQuery(api.horses.getAllHorses) ?? [];
  const createOwner = useMutation(api.owners.create);

  const [showAdd, setShowAdd] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [saving, setSaving] = useState(false);

  async function handleAdd() {
    if (!name.trim()) return;
    setSaving(true);
    try {
      await createOwner({ name: name.trim(), email: email.trim() || undefined, phone: phone.trim() || undefined });
      setShowAdd(false);
      setName("");
      setEmail("");
      setPhone("");
    } finally {
      setSaving(false);
    }
  }

  function horseCount(ownerId: string) {
    return horses.filter((h) => String(h.ownerId) === ownerId).length;
  }

  return (
    <div className="page-shell">
      <NavBar items={[{ label: "owners" }]} />
      <main className="page-content">
        <div className={styles.headerRow}>
          <h1 className={styles.title}>owners</h1>
          <button type="button" className={styles.addButton} onClick={() => setShowAdd(true)}>
            + add owner
          </button>
        </div>

        <div className={styles.ownersList}>
          {owners.length === 0 ? (
            <div className={styles.emptyState}>
              <div className={styles.emptyTitle}>no owners yet</div>
              <div className={styles.emptySub}>add an owner to start tracking horse ownership and costs</div>
            </div>
          ) : (
            <>
              <div className={styles.listHeader}>
                <div>NAME</div>
                <div>HORSES</div>
                <div>EMAIL</div>
                <div>PHONE</div>
              </div>
              {owners.map((owner) => (
                <Link key={owner._id} href={`/owners/${owner._id}`} className={styles.ownerRow}>
                  <div className={styles.ownerName}>{owner.name}</div>
                  <div className={styles.ownerHorses}>
                    {horseCount(String(owner._id))} horse{horseCount(String(owner._id)) !== 1 ? "s" : ""}
                  </div>
                  <div className={styles.ownerEmail}>{owner.email || "\u2014"}</div>
                  <div className={styles.ownerPhone}>{owner.phone || "\u2014"}</div>
                </Link>
              ))}
            </>
          )}
        </div>

        <Modal open={showAdd} title="add owner" onClose={() => setShowAdd(false)}>
          <div className={styles.formGroup}>
            <label className={styles.formLabel}>name *</label>
            <input className={styles.formInput} value={name} onChange={(e) => setName(e.target.value)} placeholder="owner name" />
          </div>
          <div className={styles.formGroup}>
            <label className={styles.formLabel}>email</label>
            <input className={styles.formInput} value={email} onChange={(e) => setEmail(e.target.value)} placeholder="email address" />
          </div>
          <div className={styles.formGroup}>
            <label className={styles.formLabel}>phone</label>
            <input className={styles.formInput} value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="phone number" />
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
            <button type="button" className="ui-button-outlined" onClick={() => setShowAdd(false)}>cancel</button>
            <button type="button" className={styles.addButton} onClick={handleAdd} disabled={saving || !name.trim()}>
              {saving ? "saving..." : "add owner"}
            </button>
          </div>
        </Modal>
      </main>
    </div>
  );
}
