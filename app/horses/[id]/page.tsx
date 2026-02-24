type HorseDetailPageProps = {
  params: {
    id: string;
  };
};

export default function HorseDetailPage({ params }: HorseDetailPageProps) {
  return (
    <main style={{ maxWidth: 840, margin: "0 auto", padding: "36px 24px" }}>
      <div className="card">
        <div className="section-label">Horse</div>
        <h1 style={{ marginTop: 0, fontFamily: "Playfair Display" }}>Horse Detail</h1>
        <p style={{ marginBottom: 0 }}>Horse ID: {params.id}</p>
        <p style={{ color: "#888", marginBottom: 0 }}>Detailed profile view is coming next.</p>
      </div>
    </main>
  );
}
