"use client";

import Link from "next/link";
import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useAuth } from "@/contexts/AuthContext";
import NavBar from "@/components/NavBar";
import styles from "../accounts.module.css";

/** Admin-only page: list every user, click in to manage which horses
 *  each one (team-role only) has been granted access to. This is the
 *  reciprocal of the SHARED WITH card on each horse profile — same
 *  horseAccess table, just sliced by user instead of by horse. */
export default function UsersAdminPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";

  const users = useQuery(api.users.list, isAdmin ? {} : "skip") ?? [];
  const allHorses = useQuery(api.horses.getAllHorses, isAdmin ? {} : "skip") ?? [];

  const [openUserId, setOpenUserId] = useState<string>("");

  if (!isAdmin) {
    return (
      <div className="page-shell">
        <NavBar
          items={[
            { label: "team-ldk", href: "/dashboard", brand: true },
            { label: "account", href: "/accounts" },
            { label: "users", current: true },
          ]}
          actions={[]}
        />
        <main className="page-main">
          <section className={styles.profileCard}>
            <div className={styles.fields}>
              <div className={styles.fieldRow}>
                <div className={styles.fieldValueRow}>
                  <span className={styles.fieldValue}>admin access required</span>
                </div>
              </div>
            </div>
          </section>
        </main>
      </div>
    );
  }

  return (
    <div className="page-shell">
      <NavBar
        items={[
          { label: "team-ldk", href: "/dashboard", brand: true },
          { label: "account", href: "/accounts" },
          { label: "users", current: true },
        ]}
        actions={[]}
      />
      <main className="page-main">
        <section className={styles.headerRow}>
          <div>
            <div className="ui-label">// USERS</div>
            <h1 className={styles.title}>team user access</h1>
          </div>
        </section>

        <section className={styles.profileCard}>
          <div className={styles.fields}>
            {users.length === 0 ? (
              <div className={styles.fieldRow}>
                <div className={styles.fieldValueRow}>
                  <span className={styles.fieldValue} style={{ color: "#9ea2b0" }}>no users</span>
                </div>
              </div>
            ) : (
              users.map((u) => {
                const expanded = openUserId === String(u._id);
                const isTeam = u.role === "team";
                return (
                  <UserRow
                    key={String(u._id)}
                    user={u as { _id: Id<"users">; name?: string; email?: string; role?: string }}
                    allHorses={allHorses as Array<{ _id: Id<"horses">; name: string }>}
                    expanded={expanded}
                    onToggle={() => setOpenUserId(expanded ? "" : String(u._id))}
                    isTeam={isTeam}
                    actorId={user?.id ? (user.id as Id<"users">) : undefined}
                  />
                );
              })
            )}
          </div>
        </section>

        <div className="ui-footer">TEAM_LDK // ACCOUNT // USERS</div>
      </main>
    </div>
  );
}

function UserRow({
  user,
  allHorses,
  expanded,
  onToggle,
  isTeam,
  actorId,
}: {
  user: { _id: Id<"users">; name?: string; email?: string; role?: string };
  allHorses: Array<{ _id: Id<"horses">; name: string }>;
  expanded: boolean;
  onToggle: () => void;
  isTeam: boolean;
  actorId?: Id<"users">;
}) {
  const sharedHorses = useQuery(
    api.horseAccess.listSharedForUser,
    expanded && isTeam ? { userId: user._id } : "skip",
  ) ?? [];
  const grant = useMutation(api.horseAccess.grant);
  const revoke = useMutation(api.horseAccess.revoke);
  const [pickHorseId, setPickHorseId] = useState<string>("");

  return (
    <div className={styles.fieldRow} style={{ flexDirection: "column", alignItems: "stretch", gap: 6 }}>
      <button
        type="button"
        onClick={onToggle}
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          gap: 10,
          width: "100%",
          padding: "4px 0",
          border: "none",
          background: "transparent",
          cursor: "pointer",
          textAlign: "left",
        }}
      >
        <span className={styles.fieldLabel} style={{ minWidth: 0 }}>{user.name ?? "Unknown"}</span>
        <span style={{ fontSize: 11, color: "#6b7084" }}>
          {user.email ?? ""} {user.role ? `· ${user.role}` : ""}
        </span>
        <span style={{ fontSize: 12, color: "#9ea2b0" }}>{expanded ? "▾" : "▸"}</span>
      </button>

      {expanded ? (
        <div style={{ paddingLeft: 12, borderLeft: "2px solid #f0f1f5" }}>
          {!isTeam ? (
            <div style={{ fontSize: 11, color: "#9ea2b0", padding: "8px 0" }}>
              This user has the {user.role} role and sees every horse by default — no per-horse
              grants apply.
            </div>
          ) : (
            <>
              {sharedHorses.length === 0 ? (
                <div style={{ fontSize: 11, color: "#9ea2b0", padding: "8px 0" }}>
                  No horses shared with this user yet.
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 6, padding: "8px 0" }}>
                  {sharedHorses.map((h) => (
                    <div
                      key={String(h._id)}
                      style={{
                        display: "flex",
                        gap: 10,
                        alignItems: "center",
                        padding: "6px 10px",
                        background: "#fafafc",
                        border: "1px solid #f0f1f5",
                        borderRadius: 6,
                      }}
                    >
                      <Link
                        href={`/horses/${h._id}`}
                        style={{ flex: 1, fontSize: 12, fontWeight: 600, color: "#1a1a2e", textDecoration: "none" }}
                      >
                        🐴 {h.name}
                      </Link>
                      <button
                        type="button"
                        onClick={() => void revoke({ horseId: h._id, userId: user._id })}
                        style={{
                          fontSize: 10,
                          fontWeight: 700,
                          padding: "4px 10px",
                          borderRadius: 4,
                          border: "1px solid rgba(229,72,77,0.3)",
                          background: "rgba(229,72,77,0.05)",
                          color: "#e5484d",
                          cursor: "pointer",
                        }}
                      >
                        revoke
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <div style={{ display: "flex", gap: 8, paddingTop: 8, borderTop: "1px solid #f0f1f5" }}>
                <select
                  value={pickHorseId}
                  onChange={(e) => setPickHorseId(e.target.value)}
                  style={{
                    flex: 1,
                    fontSize: 12,
                    padding: "8px 10px",
                    border: "1px solid #e8eaf0",
                    borderRadius: 6,
                    background: "#fff",
                    color: "#1a1a2e",
                  }}
                >
                  <option value="">— pick a horse to share —</option>
                  {allHorses
                    .filter((h) => !sharedHorses.some((s) => String(s._id) === String(h._id)))
                    .map((h) => (
                      <option key={String(h._id)} value={String(h._id)}>{h.name}</option>
                    ))}
                </select>
                <button
                  type="button"
                  disabled={!pickHorseId}
                  onClick={async () => {
                    await grant({
                      horseId: pickHorseId as Id<"horses">,
                      userId: user._id,
                      grantedBy: actorId,
                    });
                    setPickHorseId("");
                  }}
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    padding: "8px 14px",
                    borderRadius: 6,
                    border: "none",
                    background: pickHorseId ? "#1a1a2e" : "#e8eaf0",
                    color: pickHorseId ? "#fff" : "#9ea2b0",
                    cursor: pickHorseId ? "pointer" : "not-allowed",
                    whiteSpace: "nowrap",
                  }}
                >
                  + grant
                </button>
              </div>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
