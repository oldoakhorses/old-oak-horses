"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import NavBar from "@/components/NavBar";
import styles from "./horses.module.css";

type StatusFilter = "active" | "inactive" | "all";

export default function HorsesPage() {
  const horses = useQuery(api.horses.getAllHorses) ?? [];
  const setHorseStatus = useMutation(api.horses.setHorseStatus);

  const [statusFilter, setStatusFilter] = useState<StatusFilter>("active");
  const [yearFilter, setYearFilter] = useState<string>("all");
  const [openMenuHorseId, setOpenMenuHorseId] = useState<string>("");
  const [confirmSoldHorseId, setConfirmSoldHorseId] = useState<string>("");

  const years = useMemo(() => {
    const values = [...new Set(horses.map((horse) => horse.yearOfBirth).filter((year): year is number => typeof year === "number"))];
    return values.sort((a, b) => b - a);
  }, [horses]);

  const filtered = useMemo(() => {
    return horses
      .filter((horse) => (statusFilter === "all" ? true : horse.status === statusFilter))
      .filter((horse) => (yearFilter === "all" ? true : String(horse.yearOfBirth ?? "") === yearFilter))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [horses, statusFilter, yearFilter]);

  async function updateStatus(horseId: Id<"horses">, status: "active" | "inactive", isSold?: boolean) {
    await setHorseStatus({ horseId, status, isSold });
    setOpenMenuHorseId("");
    setConfirmSoldHorseId("");
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

        <div className={styles.header}>
          <div>
            <div className="ui-label">// horses</div>
            <h1 className={styles.title}>horses</h1>
          </div>
        </div>

        <div className={styles.filters}>
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
          <label className={styles.yearFilter}>
            <span>YEAR</span>
            <select value={yearFilter} onChange={(e) => setYearFilter(e.target.value)}>
              <option value="all">All</option>
              {years.map((year) => (
                <option key={year} value={String(year)}>
                  {year}
                </option>
              ))}
            </select>
          </label>
        </div>

        <section className={styles.tableCard}>
          {filtered.map((horse) => {
            const menuOpen = openMenuHorseId === String(horse._id);
            const confirmOpen = confirmSoldHorseId === String(horse._id);
            return (
              <div key={horse._id} className={styles.row}>
                <div className={styles.nameCell}>
                  <span>🐴</span>
                  <Link href={`/horses/${horse._id}`} className={styles.horseLink}>
                    {horse.name}
                  </Link>
                </div>
                <div className={styles.owner}>{horse.owner || "—"}</div>
                <div className={styles.year}>{horse.yearOfBirth ? String(horse.yearOfBirth) : "—"}</div>
                <div>
                  {horse.isSold ? <span className={styles.soldBadge}>sold</span> : horse.status === "active" ? <span className={styles.activeBadge}>active</span> : <span className={styles.inactiveBadge}>inactive</span>}
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
        </section>
      </main>
    </div>
  );
}
