"use client";

import Link from "next/link";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import NavBar from "@/components/NavBar";
import styles from "./contacts.module.css";

export default function ContactsPage() {
  const providers = useQuery(api.providers.getAllProvidersWithCategory) ?? [];

  return (
    <div className="page-shell">
      <NavBar
        items={[
          { label: "old-oak-horses", href: "/dashboard", brand: true },
          { label: "contacts", current: true },
        ]}
        actions={[
          { label: "upload invoices", href: "/upload", variant: "outlined" },
          { label: "biz overview", href: "/biz-overview", variant: "filled" },
        ]}
      />

      <main className="page-main">
        <Link href="/dashboard" className="ui-back-link">← cd /dashboard</Link>
        <div className={styles.header}>
          <div className="ui-label">// contacts</div>
          <h1 className={styles.title}>contacts</h1>
        </div>

        <section className={styles.listCard}>
          {providers.map((provider) => (
            <Link key={String(provider._id)} href={`/${provider.categorySlug}/${provider.slug ?? slugify(provider.name)}`} className={styles.row}>
              <div className={styles.name}>{provider.name}</div>
              <div><span className={styles.badge}>{provider.categoryName}</span></div>
              <div className={styles.phone}>{provider.phone || "—"}</div>
              <div className={styles.email}>{provider.email || "—"}</div>
            </Link>
          ))}
          {providers.length === 0 ? <div className={styles.empty}>No contacts found.</div> : null}
        </section>
      </main>
    </div>
  );
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-");
}
