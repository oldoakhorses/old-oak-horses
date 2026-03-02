"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
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

const NAV_ITEMS = [
  { label: "dashboard", href: "/dashboard", icon: "📊" },
  { label: "horses", href: "/horses", icon: "🐴" },
  { label: "invoices", href: "/invoices", icon: "📄" },
  { label: "contacts", href: "/contacts", icon: "👤" },
] as const;

export default function NavBar({
  items,
  actions = [],
  showSignOut = true,
}: {
  items: BreadcrumbItem[];
  actions?: NavAction[];
  showSignOut?: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const { logout } = useAuth();
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

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
      logout();
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
          <div className={styles.navSectionLabel}>// NAVIGATION</div>
          {NAV_ITEMS.map((item) => {
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

        <div className={styles.sidebarFooter}>
          <button type="button" className={styles.sidebarSignOut} onClick={onSignOut}>
            sign out
          </button>
          <div className={styles.sidebarCopyright}>OLD_OAK_HORSES // 2026</div>
        </div>
      </aside>

      <nav className={styles.nav}>
        <div className={styles.left}>
          <button className={styles.hamburgerBtn} onClick={() => setMenuOpen(true)} aria-label="Open menu" type="button">
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <div style={{ width: 16, height: 1.5, background: "#1A1A2E", borderRadius: 1 }} />
              <div style={{ width: 16, height: 1.5, background: "#1A1A2E", borderRadius: 1 }} />
              <div style={{ width: 16, height: 1.5, background: "#1A1A2E", borderRadius: 1 }} />
            </div>
          </button>

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
          {actions.map((action) => (
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
          {showSignOut ? (
            <button type="button" className={styles.actionSignOut} onClick={onSignOut} disabled={isSigningOut}>
              {isSigningOut ? "signing out..." : "sign out"}
            </button>
          ) : null}
        </div>
      </nav>
    </>
  );
}
