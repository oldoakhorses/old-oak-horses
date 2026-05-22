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
  const { logout, user } = useAuth();
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  const navSections = useMemo(() => getNavSections(user?.role), [user?.role]);
  const profile = useQuery(api.users.getProfile, user?.id ? { userId: user.id as Id<"users"> } : "skip");

  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    window.addEventListener("keydown", handleEsc);
    return () => window.removeEventListener("keydown", handleEsc);
  }, []);

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
            <span className={styles.sidebarBrandName}>old_oak_horses</span>
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
          <div className={styles.sidebarCopyright}>OLD_OAK_HORSES // 2026</div>
        </div>
      </aside>

      <nav className={styles.nav}>
        <div className={styles.left}>
          <Link href="/accounts" className={styles.profileBtn} aria-label="Account">
            {profile?.profilePhotoUrl ? (
              <img src={profile.profilePhotoUrl} alt="" className={styles.profileImg} />
            ) : (
              <span className={styles.profileInitial}>{user?.email?.[0]?.toUpperCase() || "U"}</span>
            )}
          </Link>

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
