"use client";

export default function StatementError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div style={{ padding: 40, fontFamily: "monospace" }}>
      <h2 style={{ color: "#e5484d" }}>statement page error</h2>
      <pre style={{ background: "#f5f5f5", padding: 16, borderRadius: 8, whiteSpace: "pre-wrap", fontSize: 13 }}>
        {error.message}
        {"\n\n"}
        {error.stack}
      </pre>
      <button
        onClick={reset}
        style={{
          marginTop: 16,
          padding: "8px 16px",
          background: "#1a1a2e",
          color: "#fff",
          border: "none",
          borderRadius: 6,
          cursor: "pointer",
        }}
      >
        try again
      </button>
    </div>
  );
}
