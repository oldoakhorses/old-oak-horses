"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import NavBar from "@/components/NavBar";
import Modal from "@/components/Modal";
import styles from "./owner.module.css";

const CATEGORY_COLORS: Record<string, string> = {
  veterinary: "#22C583",
  farrier: "#F59E0B",
  "feed-bedding": "#4A5BDB",
  stabling: "#A78BFA",
  "show-expenses": "#EC4899",
  bodywork: "#14B8A6",
  "horse-transport": "#EF4444",
  travel: "#818CF8",
  housing: "#FBBF24",
  admin: "#6B7084",
  supplements: "#34D399",
  supplies: "#F97316",
  insurance: "#0EA5E9",
  other: "#9EA2B0",
};

function fmtUSD(amount: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(amount);
}

function prettyCat(slug: string) {
  return slug.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export default function OwnerDetailPage() {
  const params = useParams();
  const ownerId = params.ownerId as Id<"owners">;

  const owner = useQuery(api.owners.getById, { ownerId });
  const ownerHorses = useQuery(api.owners.getOwnerHorses, { ownerId });
  const spend = useQuery(api.owners.getOwnerSpendSummary, { ownerId });
  const allHorses = useQuery(api.horses.getAllHorses) ?? [];
  const assignHorse = useMutation(api.owners.assignHorseToOwner);
  const updateOwner = useMutation(api.owners.update);

  const [showAssign, setShowAssign] = useState(false);
  const [editInfo, setEditInfo] = useState(false);
  const [editName, setEditName] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [editPhone, setEditPhone] = useState("");
  const [editAddress, setEditAddress] = useState("");
  const [editNotes, setEditNotes] = useState("");

  const unassignedHorses = useMemo(() => {
    if (!ownerHorses) return allHorses;
    const assignedIds = new Set(ownerHorses.map((h) => String(h._id)));
    return allHorses.filter((h) => !assignedIds.has(String(h._id)));
  }, [allHorses, ownerHorses]);

  function startEditInfo() {
    setEditName(owner?.name ?? "");
    setEditEmail(owner?.email ?? "");
    setEditPhone(owner?.phone ?? "");
    setEditAddress(owner?.address ?? "");
    setEditNotes(owner?.notes ?? "");
    setEditInfo(true);
  }

  async function saveInfo() {
    await updateOwner({
      ownerId,
      name: editName.trim() || undefined,
      email: editEmail.trim() || undefined,
      phone: editPhone.trim() || undefined,
      address: editAddress.trim() || undefined,
      notes: editNotes.trim() || undefined,
    });
    setEditInfo(false);
  }

  if (owner === undefined) {
    return (
      <div className="page-shell">
        <NavBar items={[{ label: "owners", href: "/owners" }, { label: "loading..." }]} />
        <main className="page-content">
          <div className={styles.loading}>loading...</div>
        </main>
      </div>
    );
  }

  if (owner === null) {
    return (
      <div className="page-shell">
        <NavBar items={[{ label: "owners", href: "/owners" }, { label: "not found" }]} />
        <main className="page-content">
          <div className={styles.loading}>owner not found</div>
        </main>
      </div>
    );
  }

  const horses = ownerHorses ?? [];
  const maxCatAmount = spend?.byCategory?.[0]?.amount ?? 1;

  return (
    <div className="page-shell">
      <NavBar items={[{ label: "owners", href: "/owners" }, { label: owner.name }]} />
      <main className="page-content">
        {/* Owner info card */}
        <div className={styles.infoCard}>
          <div className={styles.infoHeader}>
            <div>
              <h1 className={styles.ownerName}>{owner.name}</h1>
              <div className={styles.ownerMeta}>
                {[owner.email, owner.phone].filter(Boolean).join(" \u00B7 ") || "no contact info"}
              </div>
            </div>
            <button type="button" className={styles.btnEdit} onClick={startEditInfo}>edit</button>
          </div>
          {owner.address ? <div className={styles.ownerAddress}>{owner.address}</div> : null}
          {owner.notes ? <div className={styles.ownerNotes}>{owner.notes}</div> : null}
        </div>

        {/* Stats row */}
        <div className={styles.statsRow}>
          <div className={styles.statCard}>
            <div className={styles.statLabel}>TOTAL SPEND</div>
            <div className={styles.statValue}>{fmtUSD(spend?.totalSpend ?? 0)}</div>
          </div>
          <div className={styles.statCard}>
            <div className={styles.statLabel}>THIS MONTH</div>
            <div className={styles.statValue}>{fmtUSD(spend?.thisMonth ?? 0)}</div>
          </div>
          <div className={styles.statCard}>
            <div className={styles.statLabel}>LAST MONTH</div>
            <div className={styles.statValue}>{fmtUSD(spend?.lastMonth ?? 0)}</div>
          </div>
          <div className={styles.statCard}>
            <div className={styles.statLabel}>HORSES</div>
            <div className={styles.statValue}>{horses.length}</div>
          </div>
        </div>

        {/* Spend by category */}
        {spend && spend.byCategory.length > 0 ? (
          <div className={styles.sectionCard}>
            <div className={styles.sectionTitle}>spend by category</div>
            {spend.byCategory.map((row) => (
              <div key={row.category} className={styles.catRow}>
                <div className={styles.catInfo}>
                  <span className={styles.catPill} style={{ background: CATEGORY_COLORS[row.category] ?? "#9EA2B0" }}>
                    {prettyCat(row.category)}
                  </span>
                </div>
                <div className={styles.catBarWrap}>
                  <div
                    className={styles.catBar}
                    style={{
                      width: `${Math.max((row.amount / maxCatAmount) * 100, 2)}%`,
                      background: CATEGORY_COLORS[row.category] ?? "#9EA2B0",
                    }}
                  />
                </div>
                <div className={styles.catAmount}>{fmtUSD(row.amount)}</div>
              </div>
            ))}
          </div>
        ) : null}

        {/* Spend by horse */}
        {spend && spend.byHorse.length > 0 ? (
          <div className={styles.sectionCard}>
            <div className={styles.sectionTitle}>spend by horse</div>
            {spend.byHorse.map((row) => (
              <Link key={row.horseId} href={`/horses/${row.horseId}`} className={styles.horseSpendRow}>
                <div className={styles.horseSpendLeft}>
                  <span className={styles.horseIcon}>🐴</span>
                  <div>
                    <div className={styles.horseSpendName}>{row.name}</div>
                    <div className={styles.horseSpendMeta}>{row.invoiceCount} invoice{row.invoiceCount !== 1 ? "s" : ""}</div>
                  </div>
                </div>
                <div className={styles.horseSpendAmount}>{fmtUSD(row.amount)}</div>
              </Link>
            ))}
          </div>
        ) : null}

        {/* Horses list */}
        <div className={styles.sectionCard}>
          <div className={styles.sectionHeader}>
            <div className={styles.sectionTitle}>horses</div>
            <button type="button" className={styles.btnAdd} onClick={() => setShowAssign(true)}>+ assign horse</button>
          </div>
          {horses.length === 0 ? (
            <div className={styles.emptyHorses}>no horses assigned to this owner</div>
          ) : (
            horses.map((horse) => (
              <Link key={horse._id} href={`/horses/${horse._id}`} className={styles.horseRow}>
                <div className={styles.horseRowLeft}>
                  <span className={styles.horseIcon}>🐴</span>
                  <div>
                    <div className={styles.horseName}>{horse.name}</div>
                    <div className={styles.horseSub}>
                      {[horse.sex, horse.status].filter(Boolean).join(" \u00B7 ")}
                    </div>
                  </div>
                </div>
                <div className={styles.horseStatus} data-status={horse.status}>{horse.status}</div>
              </Link>
            ))
          )}
        </div>

        {/* Assign horse modal */}
        <Modal open={showAssign} title="assign horse to owner" onClose={() => setShowAssign(false)}>
          {unassignedHorses.length === 0 ? (
            <div className={styles.emptyHorses}>all horses are already assigned</div>
          ) : (
            <div className={styles.assignList}>
              {unassignedHorses.map((horse) => (
                <button
                  key={horse._id}
                  type="button"
                  className={styles.assignOption}
                  onClick={async () => {
                    await assignHorse({ horseId: horse._id, ownerId });
                    setShowAssign(false);
                  }}
                >
                  <span>🐴 {horse.name}</span>
                  <span className={styles.assignPlus}>+</span>
                </button>
              ))}
            </div>
          )}
        </Modal>

        {/* Edit info modal */}
        <Modal open={editInfo} title="edit owner info" onClose={() => setEditInfo(false)}>
          <div className={styles.formGroup}>
            <label className={styles.formLabel}>name</label>
            <input className={styles.formInput} value={editName} onChange={(e) => setEditName(e.target.value)} />
          </div>
          <div className={styles.formGroup}>
            <label className={styles.formLabel}>email</label>
            <input className={styles.formInput} value={editEmail} onChange={(e) => setEditEmail(e.target.value)} />
          </div>
          <div className={styles.formGroup}>
            <label className={styles.formLabel}>phone</label>
            <input className={styles.formInput} value={editPhone} onChange={(e) => setEditPhone(e.target.value)} />
          </div>
          <div className={styles.formGroup}>
            <label className={styles.formLabel}>address</label>
            <input className={styles.formInput} value={editAddress} onChange={(e) => setEditAddress(e.target.value)} />
          </div>
          <div className={styles.formGroup}>
            <label className={styles.formLabel}>notes</label>
            <textarea className={styles.formTextarea} value={editNotes} onChange={(e) => setEditNotes(e.target.value)} />
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
            <button type="button" className="ui-button-outlined" onClick={() => setEditInfo(false)}>cancel</button>
            <button type="button" className={styles.btnSave} onClick={saveInfo}>save</button>
          </div>
        </Modal>
      </main>
    </div>
  );
}
