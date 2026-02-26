"use client";

import { useMemo, useState } from "react";
import styles from "./LineItemReclassBadge.module.css";

export const CATEGORY_COLORS: Record<string, { color: string; label: string }> = {
  feed_bedding: { color: "#22C583", label: "Feed & Bedding" },
  stabling: { color: "#F59E0B", label: "Stabling" },
  farrier: { color: "#14B8A6", label: "Farrier" },
  veterinary: { color: "#4A5BDB", label: "Veterinary" },
  supplies: { color: "#6B7084", label: "Supplies" },
  show_expenses: { color: "#EC4899", label: "Show Expenses" }
};

const TARGET_OPTIONS = Object.keys(CATEGORY_COLORS);

export default function LineItemReclassBadge({
  currentCategory,
  suggestedCategory,
  confirmedCategory,
  onChange
}: {
  currentCategory: string;
  suggestedCategory: string | null;
  confirmedCategory: string | null;
  onChange: (category: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const currentKey = normalizeKey(currentCategory);
  const suggested = normalizeKey(suggestedCategory);
  const confirmed = normalizeKey(confirmedCategory);
  const selected = confirmed ?? suggested;
  const effective = selected && selected !== currentKey ? selected : null;

  const view = useMemo(() => {
    if (!effective) {
      return {
        label: `${formatLabel(currentKey)} ✓`,
        color: "#9EA2B0",
        dashed: false,
        muted: true
      };
    }
    const meta = CATEGORY_COLORS[effective] ?? { color: "#6B7084", label: formatLabel(effective) };
    return {
      label: `${meta.label} ▼`,
      color: meta.color,
      dashed: confirmed == null,
      muted: false
    };
  }, [confirmed, currentKey, effective]);

  return (
    <div className={styles.wrapper}>
      <button
        type="button"
        className={styles.button}
        onClick={() => setOpen((value) => !value)}
        style={{
          color: view.color,
          background: view.muted ? "#f2f3f7" : `${hexToRgba(view.color, 0.08)}`,
          border: view.muted ? "1px solid #e8eaf0" : `${view.dashed ? "1px dashed" : "1px solid"} ${hexToRgba(view.color, 0.45)}`
        }}
      >
        {view.label}
      </button>

      {open ? (
        <div className={styles.menu}>
          {TARGET_OPTIONS.map((category) => {
            const isCurrent = category === effective;
            return (
              <button
                key={category}
                type="button"
                className={styles.menuButton}
                onClick={() => {
                  onChange(category);
                  setOpen(false);
                }}
              >
                {isCurrent ? "✓ " : ""}
                {CATEGORY_COLORS[category]?.label ?? formatLabel(category)}
              </button>
            );
          })}
          <div className={styles.separator} />
          <button
            type="button"
            className={styles.menuButton}
            onClick={() => {
              onChange(null);
              setOpen(false);
            }}
          >
            Keep in {formatLabel(currentKey)}
          </button>
        </div>
      ) : null}
    </div>
  );
}

function normalizeKey(value: string | null | undefined) {
  if (!value) return "";
  return value.trim().toLowerCase().replace(/-/g, "_");
}

function formatLabel(value: string) {
  if (!value) return "Current";
  return value
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function hexToRgba(hex: string, alpha: number) {
  const clean = hex.replace("#", "");
  const bigint = Number.parseInt(clean, 16);
  const r = (bigint >> 16) & 255;
  const g = (bigint >> 8) & 255;
  const b = bigint & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
