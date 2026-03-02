"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import NavBar from "@/components/NavBar";
import styles from "../records.module.css";

export default function HorseRecordTypePage() {
  const params = useParams<{ horseId: string; type: string }>();
  const horseId = params?.horseId as Id<"horses">;
  const type = params?.type ?? "records";
  const horse = useQuery(api.horses.getHorseById, horseId ? { horseId } : "skip");

  return (
    <div className="page-shell">
      <NavBar
        items={[
          { label: "old-oak-horses", href: "/dashboard", brand: true },
          { label: "horses", href: "/horses" },
          { label: horse?.name ?? "horse", href: horse ? `/horses/${horse._id}` : "/horses" },
          { label: "records", href: horse ? `/horses/${horse._id}/records` : "/horses" },
          { label: type, current: true },
        ]}
        actions={[
          { label: "upload invoices", href: "/upload", variant: "outlined" },
          { label: "biz overview", href: "/biz-overview", variant: "filled" },
        ]}
      />
      <main className="page-main">
        <Link href={horse ? `/horses/${horse._id}/records` : "/horses"} className="ui-back-link">
          ← cd /records
        </Link>

        <section className={styles.header}>
          <div className="ui-label">// RECORDS</div>
          <h1 className={styles.title}>
            {horse?.name ?? "horse"} {type.replace(/[-_]+/g, " ")}
          </h1>
        </section>

        <section className={styles.card}>
          <div className={styles.icon}>🚧</div>
          <div className={styles.line1}>coming soon</div>
          <div className={styles.line2}>records management is under construction</div>
        </section>
      </main>
    </div>
  );
}
