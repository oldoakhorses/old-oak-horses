"use client";

import { useEffect, useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";

export default function InvoiceNotesCard({
  billId,
  initialNotes,
}: {
  billId: Id<"bills">;
  initialNotes?: string;
}) {
  const updateNotes = useMutation(api.bills.updateBillNotes);
  const [editingNotes, setEditingNotes] = useState(false);
  const [notesValue, setNotesValue] = useState(initialNotes || "");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (editingNotes) return;
    setNotesValue(initialNotes || "");
  }, [initialNotes, editingNotes]);

  async function handleSaveNotes() {
    setSaving(true);
    try {
      await updateNotes({ billId, notes: notesValue });
      setEditingNotes(false);
    } finally {
      setSaving(false);
    }
  }

  if (editingNotes) {
    return (
      <div
        style={{
          background: "#fff",
          border: "1px solid #E8EAF0",
          borderRadius: 12,
          padding: "20px 22px",
          marginBottom: 20,
        }}
      >
        <div style={{ fontFamily: "inherit", fontSize: 12, fontWeight: 700, marginBottom: 12 }}>notes</div>
        <textarea
          value={notesValue}
          onChange={(e) => setNotesValue(e.target.value)}
          placeholder="add notes about this invoice..."
          style={{
            fontFamily: "inherit",
            fontSize: 12,
            padding: "12px 14px",
            background: "#F2F3F7",
            border: "1px solid #E8EAF0",
            borderRadius: 6,
            color: "#1A1A2E",
            width: "100%",
            boxSizing: "border-box",
            outline: "none",
            resize: "vertical",
            minHeight: 80,
            lineHeight: 1.6,
          }}
        />
        <div
          style={{
            display: "flex",
            gap: 8,
            justifyContent: "flex-end",
            marginTop: 12,
          }}
        >
          <button
            type="button"
            onClick={() => {
              setEditingNotes(false);
              setNotesValue(initialNotes || "");
            }}
            style={{
              fontFamily: "inherit",
              fontSize: 10,
              padding: "7px 14px",
              borderRadius: 6,
              border: "1px solid #E8EAF0",
              background: "transparent",
              color: "#6B7084",
              cursor: "pointer",
            }}
          >
            cancel
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={() => void handleSaveNotes()}
            style={{
              fontFamily: "inherit",
              fontSize: 10,
              fontWeight: 700,
              padding: "7px 14px",
              borderRadius: 6,
              border: "none",
              background: "#1A1A2E",
              color: "#FFFFFF",
              cursor: saving ? "default" : "pointer",
              opacity: saving ? 0.7 : 1,
            }}
          >
            {saving ? "saving..." : "save notes"}
          </button>
        </div>
      </div>
    );
  }

  if ((notesValue || "").trim()) {
    return (
      <div
        style={{
          background: "#fff",
          border: "1px solid #E8EAF0",
          borderRadius: 12,
          padding: "20px 22px",
          marginBottom: 20,
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 12,
          }}
        >
          <div style={{ fontFamily: "inherit", fontSize: 12, fontWeight: 700 }}>notes</div>
          <button
            type="button"
            onClick={() => setEditingNotes(true)}
            style={{
              fontFamily: "inherit",
              fontSize: 10,
              padding: "5px 10px",
              borderRadius: 6,
              border: "1px solid #E8EAF0",
              background: "transparent",
              color: "#6B7084",
              cursor: "pointer",
            }}
          >
            edit
          </button>
        </div>
        <div
          style={{
            fontFamily: "inherit",
            fontSize: 12,
            color: "#1A1A2E",
            lineHeight: 1.6,
            whiteSpace: "pre-wrap",
          }}
        >
          {notesValue}
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        background: "#fff",
        border: "1px solid #E8EAF0",
        borderRadius: 12,
        padding: "16px 22px",
        marginBottom: 20,
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
      }}
    >
      <span style={{ fontFamily: "inherit", fontSize: 11, color: "#9EA2B0" }}>no notes</span>
      <button
        type="button"
        onClick={() => setEditingNotes(true)}
        style={{
          fontFamily: "inherit",
          fontSize: 10,
          padding: "5px 10px",
          borderRadius: 6,
          border: "1px solid #E8EAF0",
          background: "transparent",
          color: "#4A5BDB",
          cursor: "pointer",
        }}
      >
        + add notes
      </button>
    </div>
  );
}
