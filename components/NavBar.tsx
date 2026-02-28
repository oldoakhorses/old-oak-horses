"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useAuthActions } from "@convex-dev/auth/react";
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
  showSignOut = true,
}: {
  items: BreadcrumbItem[];
  actions?: NavAction[];
  showSignOut?: boolean;
}) {
  const router = useRouter();
  const { signOut } = useAuthActions();
  const [isSigningOut, setIsSigningOut] = useState(false);

  const onSignOut = async () => {
    if (isSigningOut) return;
    setIsSigningOut(true);
    try {
      await signOut();
      router.replace("/");
    } finally {
      setIsSigningOut(false);
    }
  };

  return (
    <nav className={styles.nav}>
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
  );
}
