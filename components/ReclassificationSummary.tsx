"use client";

import { CATEGORY_COLORS } from "@/components/LineItemReclassBadge";

type Group = {
  category: string;
  itemCount: number;
  total: number;
  items: Array<{ description: string; amount: number }>;
};

export default function ReclassificationSummary({
  currentCategoryLabel,
  groups,
  remainingItems,
  remainingTotal
}: {
  currentCategoryLabel: string;
  groups: Group[];
  remainingItems: number;
  remainingTotal: number;
}) {
  if (groups.length === 0) return null;

  return (
    <section className="ui-card" style={{ marginTop: 16 }}>
      <div className="ui-label">line item reclassification</div>
      <p style={{ margin: "8px 0 12px", color: "var(--ui-text-secondary)" }}>
        The following items will be moved on approval:
      </p>

      <div style={{ display: "grid", gap: 12 }}>
        {groups.map((group) => {
          const meta = CATEGORY_COLORS[group.category] ?? { color: "#6B7084", label: formatLabel(group.category) };
          return (
            <div key={group.category}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8, color: meta.color, fontWeight: 700 }}>
                <span>
                  → {meta.label} ({group.itemCount} items)
                </span>
                <span>{fmtUSD(group.total)}</span>
              </div>
              <div style={{ marginTop: 4, display: "grid", gap: 4 }}>
                {group.items.slice(0, 5).map((item, idx) => (
                  <div key={`${group.category}-${idx}`} style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 12 }}>
                    <span>{item.description}</span>
                    <span>{fmtUSD(item.amount)}</span>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      <div style={{ marginTop: 14, paddingTop: 10, borderTop: "1px solid #e8eaf0", display: "flex", justifyContent: "space-between", gap: 8, fontWeight: 700 }}>
        <span>
          Remaining in {currentCategoryLabel} ({remainingItems} items)
        </span>
        <span>{fmtUSD(remainingTotal)}</span>
      </div>

      <p style={{ marginTop: 10, color: "var(--ui-text-muted)", fontSize: 11 }}>
        Moved items will create separate invoices in their categories and need their own approval.
      </p>
    </section>
  );
}

function fmtUSD(v: number) {
  return `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatLabel(value: string) {
  return value
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
