"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import NavBar from "@/components/NavBar";
import styles from "./records.module.css";

const RECORD_TYPES = [
  { key: "veterinary", icon: "📋", label: "Veterinary Records" },
  { key: "farrier", icon: "🔧", label: "Farrier Records" },
  { key: "health", icon: "💉", label: "Health & Vaccinations" },
  { key: "registration", icon: "📄", label: "Registration Documents" },
];

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

export default function HorseRecordsPage() {
  const params = useParams<{ horseId: string }>();
  const horseId = params?.horseId as Id<"horses">;
  const horse = useQuery(api.horses.getHorseById, horseId ? { horseId } : "skip");

  const vetRecords = useQuery(api.horses.getRecordsByType, horseId ? { horseId, type: "veterinary" } : "skip") ?? [];
  const farrierRecords = useQuery(api.horses.getRecordsByType, horseId ? { horseId, type: "farrier" } : "skip") ?? [];
  const healthRecords = useQuery(api.horses.getRecordsByType, horseId ? { horseId, type: "health" } : "skip") ?? [];
  const regRecords = useQuery(api.horses.getRecordsByType, horseId ? { horseId, type: "registration" } : "skip") ?? [];

  const recordsByType: Record<string, typeof vetRecords> = {
    veterinary: vetRecords,
    farrier: farrierRecords,
    health: healthRecords,
    registration: regRecords,
  };

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
          { label: "records", current: true },
        ]}
        actions={[
          { label: "upload invoices", href: "/upload", variant: "outlined" },
          { label: "biz overview", href: "/biz-overview", variant: "filled" },
        ]}
      />
      <main className="page-main">
        <Link href={`/horses/${horse._id}`} className="ui-back-link">
          ← cd /{horse.name}
        </Link>

        <section className={styles.header}>
          <div className="ui-label">// RECORDS</div>
          <h1 className={styles.title}>{horse.name} records</h1>
        </section>

        {RECORD_TYPES.map(({ key, icon, label }) => {
          const records = recordsByType[key] ?? [];
          const preview = records.slice(0, 3);
          return (
            <section key={key} className={styles.typeCard}>
              <div className={styles.typeHeader}>
                <div className={styles.typeTitle}>
                  <span>{icon}</span> {label}
                  <span className={styles.typeCount}>{records.length} record{records.length === 1 ? "" : "s"}</span>
                </div>
                {records.length > 0 ? (
                  <Link href={`/horses/${horse._id}/records/${key}`} className={styles.viewAllLink}>
                    view all →
                  </Link>
                ) : null}
              </div>
              {preview.length === 0 ? (
                <div className={styles.emptyRow}>no records</div>
              ) : (
                preview.map((row) => (
                  <Link key={row._id} href={row.href} className={styles.recordRow}>
                    <div className={styles.recordLeft}>
                      <span className={styles.recordProvider}>{row.providerName}</span>
                      <div className={styles.recordMeta}>
                        <span className={styles.recordDateTime}>{formatDateTime(row.date, row.uploadedAt)}</span>
                        {row.invoiceNumber ? <span>#{row.invoiceNumber}</span> : null}
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
          );
        })}

        <div className="ui-footer">OLD_OAK_HORSES // {horse.name.toUpperCase()} // RECORDS</div>
      </main>
    </div>
  );
}
