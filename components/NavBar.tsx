"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useAuth } from "@/contexts/AuthContext";
import { getNavSections } from "@/lib/permissions";
import styles from "./NavBar.module.css";

export type BreadcrumbItem = {
  label: string;
  href?: string;
  current?: boolean;
  brand?: boolean;
};

type NavAction = {
  label: string;
  href: string;
  variant?: "outlined" | "filled" | "link";
  newTab?: boolean;
};

export default function NavBar({
  items,
  actions = [],
}: {
  items: BreadcrumbItem[];
  actions?: NavAction[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const { logout, user, activeOrgId, setActiveOrgId } = useAuth();
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);

  const navSections = useMemo(() => getNavSections(user?.role), [user?.role]);
  const profile = useQuery(api.users.getProfile, user?.id ? { userId: user.id as Id<"users"> } : "skip");

  // Custom 2-letter abbreviations for orgs that share a prefix and would
  // otherwise collide ("Old Oak Group LLC" and "Old Oak Farm LLC" both
  // produce "OO" from naive initials). Falls through to first-letter-of-
  // each-word for anything not listed here.
  const orgAbbreviation = (name: string): string => {
    const overrides: Record<string, string> = {
      "old oak group": "OG",
      "old oak farm": "OF",
      "old oak horses": "OH",
    };
    const key = name.toLowerCase().replace(/\s+(llc|inc|ltd|corp|co)\.?\s*$/i, "").trim();
    if (overrides[key]) return overrides[key];
    return name
      .split(" ")
      .map((w) => w[0])
      .join("")
      .slice(0, 2)
      .toUpperCase();
  };
  // Only admins switch between businesses. Owner-role users are locked to
  // their tied owner; team and investor users see no business switcher
  // at all (their scope comes from horseAccess + role gating).
  const canSwitchOrg = user?.role === "admin";
  const allOwners = useQuery(api.owners.list) ?? [];
  const orgs = useMemo(
    () => {
      const active = allOwners.filter((o: any) => o.isActive !== false);
      if (user?.role === "owner" && user?.ownerId) {
        return active.filter((o: any) => String(o._id) === user.ownerId);
      }
      return active;
    },
    [allOwners, user?.role, user?.ownerId],
  );
  const activeOrg = activeOrgId ? orgs.find((o: any) => String(o._id) === activeOrgId) : undefined;

  // For owner-role users, force the active org to their tied owner so they
  // can't accidentally land in "All horses" or another business's view.
  useEffect(() => {
    if (user?.role === "owner" && user.ownerId && activeOrgId !== user.ownerId) {
      setActiveOrgId(user.ownerId);
    }
    // For team/investor users, clear any leftover activeOrgId — their scope
    // is enforced server-side (horseAccess) so the filter would be a noop
    // but the UI would lie about context.
    if ((user?.role === "team" || user?.role === "investor") && activeOrgId !== null) {
      setActiveOrgId(null);
    }
  }, [user?.role, user?.ownerId, activeOrgId, setActiveOrgId]);

  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setMenuOpen(false);
        setProfileMenuOpen(false);
      }
    };
    window.addEventListener("keydown", handleEsc);
    return () => window.removeEventListener("keydown", handleEsc);
  }, []);

  // Close the profile menu on outside click.
  useEffect(() => {
    if (!profileMenuOpen) return;
    const onClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target?.closest(`.${styles.profileMenu}`) ||
        target?.closest(`.${styles.orgTrigger}`)
      ) return;
      setProfileMenuOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [profileMenuOpen]);

  const onSignOut = async () => {
    if (isSigningOut) return;
    setIsSigningOut(true);
    try {
      await logout();
      setMenuOpen(false);
      router.replace("/login");
    } finally {
      setIsSigningOut(false);
    }
  };

  const onSidebarNavigate = (href: string) => {
    setMenuOpen(false);
    router.push(href);
  };

  const visibleActions = actions.filter((action) => {
    const normalized = action.label.trim().toLowerCase();
    return normalized !== "upload invoices" && normalized !== "upload invoice";
  });

  return (
    <>
      <div className={`${styles.menuOverlay} ${menuOpen ? styles.menuOverlayOpen : ""}`} onClick={() => setMenuOpen(false)} />

      <aside className={`${styles.sidebar} ${menuOpen ? styles.sidebarOpen : ""}`}>
        <div className={styles.sidebarHeader}>
          <div className={styles.sidebarBrand}>
            <div className={styles.sidebarBrandIcon}><span>O</span></div>
            <span className={styles.sidebarBrandName}>team_ldk</span>
          </div>
          <button type="button" className={styles.closeBtn} onClick={() => setMenuOpen(false)}>
            ✕
          </button>
        </div>

        <div className={styles.sidebarNav}>
          {navSections.map((section) => (
            <div key={section.label} className={styles.navSection}>
              <div className={styles.navSectionLabel}>// {section.label.toUpperCase()}</div>
              {section.items.map((item) => {
                const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
                return (
                  <button
                    key={item.href}
                    type="button"
                    className={`${styles.navItem} ${active ? styles.navItemActive : ""}`}
                    onClick={() => onSidebarNavigate(item.href)}
                  >
                    <span className={styles.navIcon}>{item.icon}</span>
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </div>
          ))}
        </div>

        <div className={styles.sidebarFooter}>
          <button type="button" className={styles.sidebarSignOut} onClick={onSignOut}>
            sign out
          </button>
          <div className={styles.sidebarCopyright}>TEAM_LDK // 2026</div>
        </div>
      </aside>

      <nav className={styles.nav}>
        <div className={styles.left}>
          <div className={styles.profileWrap}>
            <button
              type="button"
              className={styles.orgTrigger}
              aria-label={
                activeOrg
                  ? `Business: ${activeOrg.name}`
                  : canSwitchOrg
                    ? "Switch business"
                    : "Account"
              }
              title={
                activeOrg
                  ? activeOrg.name
                  : canSwitchOrg
                    ? "All horses"
                    : (profile?.name || user?.name || user?.email || "Account")
              }
              onClick={() => setProfileMenuOpen((v) => !v)}
            >
              <span className={styles.orgTriggerBadge}>
                {activeOrg
                  ? orgAbbreviation(activeOrg.name)
                  : canSwitchOrg
                    ? "ALL"
                    : (user?.email?.[0]?.toUpperCase() || "U")}
              </span>
            </button>

            {profileMenuOpen && (
              <div className={styles.profileMenu} role="menu">
                {/* Active card — either current org, or "all" if no org picked.
                    For non-admins, the badge shows their tied owner's
                    initials (or user initials for team/investor users). */}
                <div className={styles.profileMenuActive}>
                  <div className={styles.profileMenuActiveBadge}>
                    {activeOrg
                      ? orgAbbreviation(activeOrg.name)
                      : canSwitchOrg
                        ? "ALL"
                        : (user?.email?.[0]?.toUpperCase() || "U")}
                  </div>
                  <div className={styles.profileMenuActiveName}>
                    {activeOrg
                      ? activeOrg.name
                      : canSwitchOrg
                        ? "All horses"
                        : (profile?.name || user?.name || user?.email || "Account")}
                  </div>
                </div>

                {/* Org switching is admin-only. Hide the "All horses" toggle
                    and other-orgs list entirely for non-admins. */}
                {canSwitchOrg && (
                  <>
                    <div className={styles.profileMenuDivider} />

                    {activeOrg && (
                      <button
                        type="button"
                        className={styles.profileMenuRow}
                        onClick={() => {
                          setActiveOrgId(null);
                          setProfileMenuOpen(false);
                        }}
                      >
                        <div className={styles.profileMenuRowBadge}>ALL</div>
                        <span className={styles.profileMenuRowName}>All horses</span>
                      </button>
                    )}

                    {orgs
                      .filter((o: any) => String(o._id) !== activeOrgId)
                      .map((o: any) => (
                        <button
                          key={o._id}
                          type="button"
                          className={styles.profileMenuRow}
                          onClick={() => {
                            setActiveOrgId(String(o._id));
                            setProfileMenuOpen(false);
                          }}
                        >
                          <div className={styles.profileMenuRowBadge}>
                            {orgAbbreviation(o.name)}
                          </div>
                          <span className={styles.profileMenuRowName}>{o.name}</span>
                        </button>
                      ))}
                  </>
                )}

                <div className={styles.profileMenuDivider} />

                {/* User identity row */}
                <Link
                  href="/accounts"
                  className={styles.profileMenuRow}
                  onClick={() => setProfileMenuOpen(false)}
                >
                  <div className={styles.profileMenuRowIcon}>
                    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="8" cy="6" r="3" />
                      <path d="M2.5 14c0-3 2.5-5 5.5-5s5.5 2 5.5 5" />
                    </svg>
                  </div>
                  <span className={styles.profileMenuRowName}>
                    {profile?.name || user?.name || user?.email || "Account"}
                  </span>
                </Link>

                <button
                  type="button"
                  className={styles.profileMenuRow}
                  onClick={onSignOut}
                  disabled={isSigningOut}
                >
                  <div className={styles.profileMenuRowIcon}>
                    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M10 11l3-3-3-3M13 8H6M9 2H4a1 1 0 00-1 1v10a1 1 0 001 1h5" />
                    </svg>
                  </div>
                  <span className={styles.profileMenuRowName}>
                    {isSigningOut ? "signing out..." : "sign out"}
                  </span>
                </button>
              </div>
            )}
          </div>

          <Link href="/dashboard" className={styles.homeBtn}>
            <svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M2 6.5L8 2l6 4.5V13a1 1 0 01-1 1H3a1 1 0 01-1-1V6.5z" />
              <path d="M6 14V9h4v5" />
            </svg>
          </Link>

          <div className={styles.breadcrumbs}>
            {items.map((item, index) => {
              const className = item.brand
                ? styles.brand
                : item.current
                  ? styles.current
                  : styles.segment;

              return (
                <span key={`${item.label}-${index}`} className={styles.crumbWrap}>
                  {item.href && !item.current ? (
                    <Link href={item.href} className={className}>
                      {item.label}
                    </Link>
                  ) : (
                    <span className={className}>{item.label}</span>
                  )}
                  {index < items.length - 1 ? <span className={styles.sep}>/</span> : null}
                </span>
              );
            })}
          </div>
        </div>

        <div className={styles.actions}>
          {visibleActions.map((action) => (
            <Link
              key={action.label}
              href={action.href}
              target={action.newTab ? "_blank" : undefined}
              rel={action.newTab ? "noreferrer" : undefined}
              className={action.variant === "filled" ? styles.actionFilled : action.variant === "link" ? styles.actionLink : styles.actionOutlined}
            >
              {action.label}
            </Link>
          ))}
          <Link href="/records" className={styles.recordsBtn} aria-label="Records">
            <svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="2" width="10" height="12" rx="1.5" />
              <path d="M6 5h4M6 8h4M6 11h2" />
            </svg>
          </Link>
          <Link href="/calendar" className={styles.calendarBtn} aria-label="Calendar">
            <svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2" y="3" width="12" height="11" rx="1.5" />
              <path d="M5 1.5V4M11 1.5V4M2 7h12" />
              <circle cx="5.5" cy="9.5" r="0.5" fill="currentColor" stroke="none" />
              <circle cx="8" cy="9.5" r="0.5" fill="currentColor" stroke="none" />
              <circle cx="10.5" cy="9.5" r="0.5" fill="currentColor" stroke="none" />
              <circle cx="5.5" cy="11.5" r="0.5" fill="currentColor" stroke="none" />
              <circle cx="8" cy="11.5" r="0.5" fill="currentColor" stroke="none" />
            </svg>
          </Link>
          <button className={styles.hamburgerBtn} onClick={() => setMenuOpen(true)} aria-label="Open menu" type="button">
            <div style={{ display: "flex", flexDirection: "column", gap: 4.5 }}>
              <div style={{ width: 18, height: 1.5, background: "#1A1A2E", borderRadius: 1 }} />
              <div style={{ width: 18, height: 1.5, background: "#1A1A2E", borderRadius: 1 }} />
              <div style={{ width: 18, height: 1.5, background: "#1A1A2E", borderRadius: 1 }} />
            </div>
          </button>
        </div>
      </nav>
    </>
  );
}
