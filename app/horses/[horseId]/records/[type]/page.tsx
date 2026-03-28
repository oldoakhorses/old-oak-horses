"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import NavBar from "@/components/NavBar";
import styles from "../records.module.css";

const TYPE_META: Record<string, { icon: string; label: string }> = {
  veterinary: { icon: "📋", label: "Veterinary Records" },
  farrier: { icon: "🔧", label: "Farrier Records" },
  health: { icon: "💉", label: "Health & Vaccinations" },
  registration: { icon: "📄", label: "Registration Documents" },
};

function formatDateTime(dateStr: string | null, uploadedAt: number) {
  if (dateStr) {
    const d = new Date(dateStr);
    if (!isNaN(d.getTime())) {
      const uploaded = new Date(uploadedAt);
      d.setHours(uploaded.getHours(), uploaded.getMinutes());
      return d.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      }) + " · " + uploaded.toLocaleTimeString("en-US", {
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
      });
    }
  }
  const d = new Date(uploadedAt);
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }) + " · " + d.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

function formatUsd(n: number) {
  return "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function HorseRecordTypePage() {
  const params = useParams<{ horseId: string; type: string }>();
  const horseId = params?.horseId as Id<"horses">;
  const type = params?.type ?? "veterinary";
  const horse = useQuery(api.horses.getHorseById, horseId ? { horseId } : "skip");
  const records = useQuery(api.horses.getRecordsByType, horseId ? { horseId, type } : "skip") ?? [];

  const meta = TYPE_META[type] ?? { icon: "📄", label: type.replace(/[-_]+/g, " ") };

  if (!horse) {
    return (
      <div className="page-shell">
        <main className="page-main">
          <section className="ui-card">loading records...</section>
        </main>
      </div>
    );
  }

  return (
    <div className="page-shell">
      <NavBar
        items={[
          { label: "old-oak-horses", href: "/dashboard", brand: true },
          { label: "horses", href: "/horses" },
          { label: horse.name, href: `/horses/${horse._id}` },
          { label: "records", href: `/horses/${horse._id}/records` },
          { label: meta.label.toLowerCase(), current: true },
        ]}
        actions={[
          { label: "upload invoices", href: "/upload", variant: "outlined" },
          { label: "biz overview", href: "/biz-overview", variant: "filled" },
        ]}
      />
      <main className="page-main">
        <Link href={`/horses/${horse._id}/records`} className="ui-back-link">
          ← cd /records
        </Link>

        <section className={styles.header}>
          <div className="ui-label">// RECORDS</div>
          <h1 className={styles.title}>
            {meta.icon} {horse.name} {meta.label.toLowerCase()}
          </h1>
        </section>

        <section className={styles.card}>
          {records.length === 0 ? (
            <div className={styles.emptyRow}>no {meta.label.toLowerCase()} found</div>
          ) : (
            records.map((row) => (
              <Link key={row._id} href={row.href} className={styles.recordRow}>
                <div className={styles.recordLeft}>
                  <span className={styles.recordProvider}>{row.providerName}</span>
                  <div className={styles.recordMeta}>
                    <span className={styles.recordDateTime}>{formatDateTime(row.date, row.uploadedAt)}</span>
                    {row.invoiceNumber ? <span>#{row.invoiceNumber}</span> : null}
                    <span>{row.categoryName}</span>
                  </div>
                </div>
                <div className={styles.recordRight}>
                  <span className={styles.recordAmount}>{formatUsd(row.amount)}</span>
                  <span className={`${styles.statusDot} ${row.status === "approved" ? styles.statusApproved : styles.statusPending}`} />
                  <span className={styles.arrow}>→</span>
                </div>
              </Link>
            ))
          )}
        </section>

        <div className="ui-footer">OLD_OAK_HORSES // {horse.name.toUpperCase()} // {meta.label.toUpperCase()}</div>
      </main>
    </div>
  );
}
