"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useAuth } from "@/contexts/AuthContext";
import { useOrgArgs } from "@/lib/useOrgArgs";
import Modal from "@/components/Modal";
import NavBar from "@/components/NavBar";
import styles from "./horses.module.css";

type StatusFilter = "active" | "inactive" | "all";

type HorseFormState = {
  name: string;
  barnName: string;
  yearOfBirth: string;
  sex: "" | "gelding" | "mare" | "stallion";
  usefNumber: string;
  feiNumber: string;
  ownerSelection: string; // owner ID, "__other", or ""
  newOwnerName: string;
};

const EMPTY_FORM: HorseFormState = {
  name: "",
  barnName: "",
  yearOfBirth: "",
  sex: "",
  usefNumber: "",
  feiNumber: "",
  ownerSelection: "",
  newOwnerName: "",
};

export default function HorsesPage() {
  const { user } = useAuth();
  const isOwnerRole = user?.role === "owner";
  const isTeamRole = user?.role === "team";
  const ownerIdForFilter = isOwnerRole && user?.ownerId ? (user.ownerId as Id<"owners">) : undefined;

  // Three sources depending on viewer role:
  //  - admin / no role           → all horses
  //  - owner role with ownerId   → horses owned by them
  //  - team role                 → only horses explicitly shared with them
  const orgArgs = useOrgArgs();
  const allHorses = useQuery(api.horses.getAllHorses, isOwnerRole || isTeamRole ? "skip" : orgArgs) ?? [];
  const ownerHorses = useQuery(api.horses.getHorsesByOwner, ownerIdForFilter ? { ownerId: ownerIdForFilter } : "skip") ?? [];
  const sharedHorses = useQuery(
    api.horseAccess.listSharedForUser,
    isTeamRole && user?.id ? { userId: user.id as Id<"users"> } : "skip",
  ) ?? [];
  const horses = isOwnerRole ? ownerHorses : isTeamRole ? sharedHorses : allHorses;

  const owners = useQuery(api.owners.list) ?? [];
  const createHorse = useMutation(api.horses.createHorse);
  const setHorseStatus = useMutation(api.horses.setHorseStatus);

  // Horse groups — named multi-horse shortcuts used when assigning
  // invoices. Owner-scoped; admins see all.
  const horseGroups = useQuery(api.horseGroups.list, ownerIdForFilter ? { ownerId: ownerIdForFilter as unknown as string } : {}) ?? [];
  const createGroup = useMutation(api.horseGroups.create);
  const updateGroup = useMutation(api.horseGroups.update);
  const removeGroup = useMutation(api.horseGroups.remove);

  const [statusFilter, setStatusFilter] = useState<StatusFilter>("active");
  const [search, setSearch] = useState("");
  const [openMenuHorseId, setOpenMenuHorseId] = useState<string>("");
  const [confirmSoldHorseId, setConfirmSoldHorseId] = useState<string>("");
  const [showAddModal, setShowAddModal] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState("");
  const [form, setForm] = useState<HorseFormState>(EMPTY_FORM);

  // Group modal state. `groupModalOpen` doubles as create/edit mode:
  //   null   → closed
  //   "new"  → create
  //   <id>   → edit that group
  const [groupModalOpen, setGroupModalOpen] = useState<null | "new" | string>(null);
  const [groupForm, setGroupForm] = useState<{ name: string; horseIds: string[] }>({ name: "", horseIds: [] });
  const [groupError, setGroupError] = useState("");

  function openCreateGroup() {
    setGroupForm({ name: "", horseIds: [] });
    setGroupError("");
    setGroupModalOpen("new");
  }
  function openEditGroup(group: any) {
    setGroupForm({ name: group.name, horseIds: group.horseIds.map((id: any) => String(id)) });
    setGroupError("");
    setGroupModalOpen(String(group._id));
  }
  async function submitGroup() {
    const name = groupForm.name.trim();
    if (!name) { setGroupError("Name is required"); return; }
    if (groupForm.horseIds.length === 0) { setGroupError("Pick at least one horse"); return; }
    try {
      if (groupModalOpen === "new") {
        await createGroup({
          name,
          horseIds: groupForm.horseIds as Id<"horses">[],
          ownerId: ownerIdForFilter,
        });
      } else if (groupModalOpen) {
        await updateGroup({
          groupId: groupModalOpen as Id<"horseGroups">,
          name,
          horseIds: groupForm.horseIds as Id<"horses">[],
        });
      }
      setGroupModalOpen(null);
    } catch (err) {
      setGroupError(err instanceof Error ? err.message : "Failed to save group");
    }
  }
  async function deleteGroup(group: any) {
    if (!confirm(`Delete group "${group.name}"? Past invoices that used it keep their horse assignments.`)) return;
    await removeGroup({ groupId: group._id });
  }

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return horses
      .filter((horse) => {
        if (statusFilter === "all") { /* pass */ }
        else if (statusFilter === "active") { if (horse.status !== "active") return false; }
        else { if (horse.status === "active") return false; }
        if (term) {
          const hay = [horse.name, horse.barnName].filter(Boolean).join(" ").toLowerCase();
          if (!hay.includes(term)) return false;
        }
        return true;
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [horses, statusFilter, search]);

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
    // Every new horse must have an owner (or create one inline). Enforces
    // the "horses are owned by an entity" rule before the row even lands.
    if (!form.ownerSelection || (form.ownerSelection === "__other" && !form.newOwnerName.trim())) {
      setFormError("owner is required — pick an existing owner or create a new one");
      return;
    }

    setFormError("");
    setIsSubmitting(true);
    try {
      const isOther = form.ownerSelection === "__other";
      const selectedOwnerId = !isOther && form.ownerSelection ? form.ownerSelection as Id<"owners"> : undefined;
      const selectedOwner = selectedOwnerId ? owners.find((o) => String(o._id) === form.ownerSelection) : undefined;

      await createHorse({
        name: form.name.trim(),
        barnName: form.barnName.trim() || undefined,
        yearOfBirth: form.yearOfBirth ? Number(form.yearOfBirth) : undefined,
        sex: form.sex || undefined,
        usefNumber: form.usefNumber || undefined,
        feiNumber: form.feiNumber || undefined,
        owner: selectedOwner ? selectedOwner.name : undefined,
        ownerId: selectedOwnerId,
        newOwnerName: isOther ? form.newOwnerName.trim() || undefined : undefined,
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
          { label: "team-ldk", href: "/dashboard", brand: true },
          { label: "horses", current: true },
        ]}
        actions={[
          { label: "upload invoices", href: "/dashboard?panel=invoice", variant: "outlined" },
        ]}
      />
      <main className="page-main">
        <section className={styles.headerRow}>
          <h2 className={styles.title}>horses</h2>
          <button type="button" className={styles.addButton} onClick={() => setShowAddModal(true)}>
            + add
          </button>
        </section>

        <section className={styles.filterRow}>
          <div className={styles.tabs}>
            <button type="button" className={statusFilter === "active" ? styles.tabActive : styles.tab} onClick={() => setStatusFilter("active")}>
              Active
              <span className={styles.tabCount}>{horses.filter((h) => h.status === "active").length}</span>
            </button>
            <button type="button" className={statusFilter === "inactive" ? styles.tabActive : styles.tab} onClick={() => setStatusFilter("inactive")}>
              Inactive
              <span className={styles.tabCount}>{horses.filter((h) => h.status !== "active").length}</span>
            </button>
            <button type="button" className={statusFilter === "all" ? styles.tabActive : styles.tab} onClick={() => setStatusFilter("all")}>
              All
              <span className={styles.tabCount}>{horses.length}</span>
            </button>
          </div>
        </section>

        <input
          className={styles.searchBar}
          type="text"
          placeholder="search horses..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />

        {/* Horse Groups — named multi-horse shortcuts. Pick a group on
            an invoice (or line item) to split evenly across every horse
            in it; saves you from re-multi-selecting the same set each
            time. Managed here; consumed in the invoice approval flow. */}
        <section className={styles.groupsCard}>
          <div className={styles.groupsHeader}>
            <div>
              <div className={styles.groupsTitle}>horse groups</div>
              <div className={styles.groupsSubtitle}>
                {horseGroups.length === 0
                  ? "create reusable horse sets for invoice tagging"
                  : `${horseGroups.length} group${horseGroups.length === 1 ? "" : "s"} · pick on invoices to split evenly`}
              </div>
            </div>
            <button type="button" className={styles.addButton} onClick={openCreateGroup}>
              + create group
            </button>
          </div>
          {horseGroups.length > 0 ? (
            <div className={styles.groupsGrid}>
              {horseGroups.map((group: any) => {
                const horsesInGroup = group.horseIds
                  .map((id: any) => horses.find((h) => String(h._id) === String(id)))
                  .filter(Boolean) as Array<{ name: string }>;
                return (
                  <div key={String(group._id)} className={styles.groupChip}>
                    <div className={styles.groupChipBody}>
                      <div className={styles.groupChipName}>{group.name}</div>
                      <div className={styles.groupChipMembers}>
                        {horsesInGroup.length === 0
                          ? "empty"
                          : horsesInGroup.length <= 3
                            ? horsesInGroup.map((h) => h.name).join(", ")
                            : `${horsesInGroup.slice(0, 3).map((h) => h.name).join(", ")} +${horsesInGroup.length - 3}`}
                      </div>
                    </div>
                    <div className={styles.groupChipActions}>
                      <button type="button" className={styles.groupChipBtn} onClick={() => openEditGroup(group)} title="Edit group">edit</button>
                      <button type="button" className={styles.groupChipBtnDelete} onClick={() => void deleteGroup(group)} title="Delete group">×</button>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : null}
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
                      <Link href={`/horses/${horse._id}?edit=1`} className={styles.menuItem}>
                        Edit
                      </Link>
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

        <div className="ui-footer">TEAM_LDK // HORSES</div>
      </main>

      <Modal
        open={groupModalOpen !== null}
        title={groupModalOpen === "new" ? "create horse group" : "edit horse group"}
        onClose={() => setGroupModalOpen(null)}
      >
        <div className={styles.form}>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>GROUP NAME *</span>
            <input
              className={styles.input}
              value={groupForm.name}
              onChange={(e) => setGroupForm((p) => ({ ...p, name: e.target.value }))}
              placeholder="e.g. barn ponies, show team..."
            />
          </label>
          <div className={styles.field}>
            <span className={styles.fieldLabel}>HORSES * ({groupForm.horseIds.length} selected)</span>
            <div className={styles.groupHorseList}>
              {horses.filter((h) => h.status === "active").map((horse) => {
                const id = String(horse._id);
                const checked = groupForm.horseIds.includes(id);
                return (
                  <label key={id} className={styles.groupHorseOption}>
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => setGroupForm((prev) => ({
                        ...prev,
                        horseIds: checked
                          ? prev.horseIds.filter((x) => x !== id)
                          : [...prev.horseIds, id],
                      }))}
                    />
                    <span>🐴 {horse.name}{horse.barnName ? ` (${horse.barnName})` : ""}</span>
                  </label>
                );
              })}
              {horses.filter((h) => h.status === "active").length === 0 ? (
                <div className={styles.groupHorseEmpty}>no active horses to add</div>
              ) : null}
            </div>
          </div>
          {groupError ? <p className={styles.error}>{groupError}</p> : null}
          <div className={styles.modalActions}>
            <button type="button" className="ui-button-outlined" onClick={() => setGroupModalOpen(null)}>
              cancel
            </button>
            <button type="button" className="ui-button-filled" onClick={() => void submitGroup()}>
              {groupModalOpen === "new" ? "create group" : "save changes"}
            </button>
          </div>
        </div>
      </Modal>

      <Modal open={showAddModal} title="add horse" onClose={() => setShowAddModal(false)}>
        <form className={styles.form} onSubmit={onSubmitHorse}>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>NAME *</span>
            <input className={styles.input} value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} />
          </label>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>BARN NAME</span>
            <input className={styles.input} value={form.barnName} onChange={(e) => setForm((p) => ({ ...p, barnName: e.target.value }))} placeholder="nickname / call name" />
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
            <span className={styles.fieldLabel}>OWNER *</span>
            <select
              className={styles.input}
              value={form.ownerSelection}
              onChange={(e) => setForm((p) => ({ ...p, ownerSelection: e.target.value, newOwnerName: "" }))}
              required
            >
              <option value="">-- select owner (required) --</option>
              {owners.filter((o) => o.isActive).map((o) => (
                <option key={String(o._id)} value={String(o._id)}>{o.name}</option>
              ))}
              <option value="__other">+ add new owner</option>
            </select>
          </label>
          {form.ownerSelection === "__other" && (
            <label className={styles.field}>
              <span className={styles.fieldLabel}>NEW OWNER NAME *</span>
              <input
                className={styles.input}
                value={form.newOwnerName}
                onChange={(e) => setForm((p) => ({ ...p, newOwnerName: e.target.value }))}
                placeholder="enter owner name..."
              />
            </label>
          )}
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
