"use client";

import Link from "next/link";
import NavBar from "@/components/NavBar";

export default function UpcomingPage() {
  return (
    <div className="page-shell">
      <NavBar
        items={[
          { label: "old-oak-horses", href: "/dashboard", brand: true },
          { label: "upcoming", current: true },
        ]}
        actions={[{ label: "biz overview", href: "/biz-overview", variant: "filled" }]}
      />

      <main className="page-main">
        <Link href="/dashboard" className="ui-back-link">
          ← cd /dashboard
        </Link>

        <section className="ui-card" style={{ textAlign: "center", padding: "64px 24px" }}>
          <div className="ui-label">// UPCOMING</div>
          <h1 style={{ margin: "8px 0 6px", fontSize: 28, fontWeight: 700, color: "#1A1A2E" }}>upcoming events</h1>
          <p style={{ margin: 0, fontSize: 12, color: "#9EA2B0" }}>coming soon</p>
        </section>
      </main>
    </div>
  );
}
