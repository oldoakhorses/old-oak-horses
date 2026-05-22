"use client";

import NavBar from "@/components/NavBar";

export default function CalendarPage() {
  return (
    <div className="page-shell">
      <NavBar
        items={[
          { label: "old-oak-horses", href: "/dashboard", brand: true },
          { label: "calendar", current: true },
        ]}
      />
      <main className="page-main">
        <section className="ui-card" style={{ textAlign: "center", padding: "60px 28px" }}>
          <div style={{ fontSize: 40, marginBottom: 16 }}>📅</div>
          <div className="ui-label">// calendar</div>
          <h1 style={{ fontSize: 32, margin: "10px 0 8px" }}>coming soon</h1>
          <p style={{ fontSize: 12, color: "#6B7084", margin: 0 }}>calendar view is under construction.</p>
        </section>
      </main>
    </div>
  );
}
