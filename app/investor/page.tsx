import Link from "next/link";

export default function InvestorPage() {
  return (
    <div className="page-shell">
      <main className="page-main">
        <Link href="/" className="ui-back-link">
          ← cd /
        </Link>
        <section className="ui-card" style={{ textAlign: "center", padding: "32px 28px" }}>
          <div className="ui-label">// investor</div>
          <h1 style={{ fontSize: 32, margin: "10px 0 8px" }}>coming soon</h1>
          <p style={{ fontSize: 12, color: "#6B7084", margin: 0 }}>investor dashboard is under construction.</p>
        </section>
      </main>
    </div>
  );
}
