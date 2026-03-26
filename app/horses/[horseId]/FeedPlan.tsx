"use client";

import { useState, useMemo } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import styles from "./feedplan.module.css";

type FeedItem = { product: string; amount: number; unit: string };
type TimeSlot = "am" | "lunch" | "pm";
type SectionId = "hay" | "grain" | "supplements" | "meds";

type SectionData = {
  am: FeedItem[];
  lunch: FeedItem[];
  pm: FeedItem[];
  notes?: string;
};

type Sections = Record<SectionId, SectionData>;

const FEED_UNITS = [
  "scoops", "cups", "flakes", "lbs", "oz", "ml", "cc",
  "tabs", "pumps", "tbsp", "tsp", "grams", "tubes",
];

const FEED_SECTIONS: { id: SectionId; label: string; icon: string; color: string }[] = [
  { id: "hay", label: "Hay", icon: "🌾", color: "#22C583" },
  { id: "grain", label: "Grain", icon: "🌽", color: "#F59E0B" },
  { id: "supplements", label: "Supplements", icon: "💊", color: "#4A5BDB" },
  { id: "meds", label: "Meds", icon: "💉", color: "#EC4899" },
];

const TIME_TABS: { id: TimeSlot; emoji: string; label: string }[] = [
  { id: "am", emoji: "🌅", label: "AM" },
  { id: "lunch", emoji: "☀️", label: "LUNCH" },
  { id: "pm", emoji: "🌙", label: "PM" },
];

const ADD_LABELS: Record<SectionId, string> = {
  hay: "+ add hay",
  grain: "+ add grain",
  supplements: "+ add supplement",
  meds: "+ add medication",
};

function emptySections(): Sections {
  const empty = (): SectionData => ({ am: [], lunch: [], pm: [] });
  return { hay: empty(), grain: empty(), supplements: empty(), meds: empty() };
}

function generateChangeDescription(oldSections: Sections | null, newSections: Sections): string {
  if (!oldSections) return "Initial feed plan created";
  const changes: string[] = [];
  const sections: SectionId[] = ["hay", "grain", "supplements", "meds"];
  const times: TimeSlot[] = ["am", "lunch", "pm"];

  for (const section of sections) {
    for (const time of times) {
      const oldItems = oldSections[section]?.[time] || [];
      const newItems = newSections[section][time] || [];

      for (const item of newItems) {
        const existed = oldItems.find((o) => o.product === item.product);
        if (!existed) {
          changes.push(`Added ${item.product} ${item.amount} ${item.unit} ${time.toUpperCase()}`);
        } else if (existed.amount !== item.amount || existed.unit !== item.unit) {
          changes.push(`Changed ${item.product} from ${existed.amount} ${existed.unit} to ${item.amount} ${item.unit} ${time.toUpperCase()}`);
        }
      }

      for (const item of oldItems) {
        const stillExists = newItems.find((n) => n.product === item.product);
        if (!stillExists) {
          changes.push(`Removed ${item.product} ${time.toUpperCase()}`);
        }
      }
    }

    if ((oldSections[section]?.notes || "") !== (newSections[section].notes || "")) {
      changes.push(`Updated ${section} notes`);
    }
  }

  return changes.length > 0 ? changes.join("; ") : "Feed plan updated";
}

export default function FeedPlan({ horseId, horseName }: { horseId: Id<"horses">; horseName: string }) {
  const feedPlan = useQuery(api.feedPlans.getByHorse, { horseId });
  const history = useQuery(api.feedPlans.getHistory, { horseId });
  const saveFeedPlan = useMutation(api.feedPlans.save);

  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [activeTime, setActiveTime] = useState<TimeSlot>("am");
  const [editSections, setEditSections] = useState<Sections>(emptySections());
  const [showHistory, setShowHistory] = useState(false);
  const [expandedNotes, setExpandedNotes] = useState<Set<SectionId>>(new Set());
  const [editNotes, setEditNotes] = useState<Set<SectionId>>(new Set());

  const sections: Sections = feedPlan?.sections as Sections ?? emptySections();

  const itemCountForTime = (s: Sections, time: TimeSlot) => {
    let count = 0;
    for (const sec of FEED_SECTIONS) {
      count += (s[sec.id][time] || []).length;
    }
    return count;
  };

  const dailySummary = useMemo(() => {
    if (!feedPlan) return [];
    const grouped: Record<SectionId, Record<string, { total: number; unit: string }>> = {
      hay: {}, grain: {}, supplements: {}, meds: {},
    };
    const times: TimeSlot[] = ["am", "lunch", "pm"];
    for (const secId of ["hay", "grain", "supplements", "meds"] as SectionId[]) {
      for (const time of times) {
        for (const item of sections[secId][time] || []) {
          if (!item.product) continue;
          if (!grouped[secId][item.product]) {
            grouped[secId][item.product] = { total: 0, unit: item.unit };
          }
          grouped[secId][item.product].total += item.amount;
        }
      }
    }
    return FEED_SECTIONS.map((sec) => ({
      ...sec,
      items: Object.entries(grouped[sec.id]).map(([product, { total, unit }]) => ({
        product, total, unit,
      })),
    })).filter((s) => s.items.length > 0);
  }, [feedPlan, sections]);

  function startEditing() {
    setEditSections(feedPlan ? JSON.parse(JSON.stringify(sections)) : emptySections());
    setEditNotes(new Set());
    setIsEditing(true);
  }

  function cancelEditing() {
    setIsEditing(false);
  }

  async function onSave() {
    setIsSaving(true);
    try {
      const desc = generateChangeDescription(feedPlan ? sections : null, editSections);
      await saveFeedPlan({ horseId, sections: editSections, changeDescription: desc });
      setIsEditing(false);
    } finally {
      setIsSaving(false);
    }
  }

  function updateItem(secId: SectionId, time: TimeSlot, idx: number, field: keyof FeedItem, value: string | number) {
    setEditSections((prev) => {
      const next = JSON.parse(JSON.stringify(prev)) as Sections;
      (next[secId][time][idx] as any)[field] = value;
      return next;
    });
  }

  function removeItem(secId: SectionId, time: TimeSlot, idx: number) {
    setEditSections((prev) => {
      const next = JSON.parse(JSON.stringify(prev)) as Sections;
      next[secId][time].splice(idx, 1);
      return next;
    });
  }

  function addItem(secId: SectionId, time: TimeSlot) {
    setEditSections((prev) => {
      const next = JSON.parse(JSON.stringify(prev)) as Sections;
      next[secId][time].push({ product: "", amount: 0, unit: FEED_UNITS[0] });
      return next;
    });
  }

  function updateNotes(secId: SectionId, value: string) {
    setEditSections((prev) => {
      const next = JSON.parse(JSON.stringify(prev)) as Sections;
      next[secId].notes = value;
      return next;
    });
  }

  function toggleNotes(secId: SectionId) {
    setExpandedNotes((prev) => {
      const next = new Set(prev);
      if (next.has(secId)) next.delete(secId);
      else next.add(secId);
      return next;
    });
  }

  function toggleEditNotes(secId: SectionId) {
    setEditNotes((prev) => {
      const next = new Set(prev);
      if (next.has(secId)) next.delete(secId);
      else next.add(secId);
      return next;
    });
  }

  const currentSections = isEditing ? editSections : sections;
  const hasPlan = !!feedPlan;
  const updatedDate = feedPlan?.updatedAt
    ? new Date(feedPlan.updatedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
    : null;

  return (
    <div className={styles.wrapper}>
      {/* Header */}
      <div className={styles.header}>
        <div>
          <div className={styles.title}>feed plan</div>
          <div className={styles.subtitle}>
            {horseName} {updatedDate ? `· updated ${updatedDate}` : ""}
          </div>
        </div>
        <div className={styles.headerActions}>
          {isEditing ? (
            <>
              <button type="button" className={styles.btnCancel} onClick={cancelEditing}>
                cancel
              </button>
              <button type="button" className={styles.btnSave} onClick={onSave} disabled={isSaving}>
                {isSaving ? "saving..." : "save"}
              </button>
            </>
          ) : (
            <button type="button" className={styles.btnEdit} onClick={startEditing}>
              edit
            </button>
          )}
        </div>
      </div>

      {/* Empty state */}
      {!hasPlan && !isEditing ? (
        <div className={styles.emptyState}>
          <div className={styles.emptyTitle}>no feed plan yet</div>
          <div className={styles.emptyText}>tap edit to set up this horse&apos;s feeding schedule</div>
        </div>
      ) : (
        <>
          {/* Time tabs */}
          <div className={styles.timeTabs}>
            {TIME_TABS.map((tab) => {
              const count = itemCountForTime(currentSections, tab.id);
              return (
                <button
                  key={tab.id}
                  type="button"
                  className={activeTime === tab.id ? styles.timeTabActive : styles.timeTab}
                  onClick={() => setActiveTime(tab.id)}
                >
                  <span className={styles.timeTabEmoji}>{tab.emoji}</span>
                  <span className={styles.timeTabLabel}>{tab.label}</span>
                  <span className={styles.timeTabCount}>{count} item{count !== 1 ? "s" : ""}</span>
                </button>
              );
            })}
          </div>

          {/* Section cards */}
          {FEED_SECTIONS.map((sec) => {
            const items = currentSections[sec.id][activeTime] || [];
            const notes = currentSections[sec.id].notes;
            const hasNotes = !!notes;
            const showingNotes = expandedNotes.has(sec.id);
            const showEditNotes = editNotes.has(sec.id) || hasNotes;

            return (
              <div key={sec.id} className={styles.sectionCard}>
                {/* Section header */}
                <div className={styles.sectionHeader}>
                  <div className={styles.sectionHeaderLeft}>
                    <div className={styles.sectionIcon} style={{ background: `${sec.color}10` }}>
                      <span>{sec.icon}</span>
                    </div>
                    <div>
                      <span className={styles.sectionName}>{sec.label}</span>
                      <span className={styles.sectionCount}>
                        {items.length} item{items.length !== 1 ? "s" : ""}
                      </span>
                    </div>
                  </div>
                  {!isEditing && hasNotes && (
                    <button type="button" className={styles.notesBadge} onClick={() => toggleNotes(sec.id)}>
                      📝 notes
                    </button>
                  )}
                </div>

                {/* Items */}
                <div className={styles.sectionBody}>
                  {!isEditing ? (
                    <>
                      {items.length === 0 ? (
                        <div className={styles.emptySection}>—</div>
                      ) : (
                        items.map((item, idx) => (
                          <div key={idx} className={styles.itemRow}>
                            <span className={styles.itemName}>{item.product}</span>
                            <span className={styles.itemRight}>
                              <span className={styles.itemAmount} style={{ color: sec.color }}>
                                {item.amount}
                              </span>
                              <span className={styles.itemUnit}>{item.unit}</span>
                            </span>
                          </div>
                        ))
                      )}
                      {showingNotes && notes && (
                        <div className={styles.notesRead}>{notes}</div>
                      )}
                    </>
                  ) : (
                    <>
                      {items.map((item, idx) => (
                        <div key={idx} className={styles.itemEditCard}>
                          <button
                            type="button"
                            className={styles.btnRemoveItem}
                            onClick={() => removeItem(sec.id, activeTime, idx)}
                          >
                            ✕
                          </button>
                          <input
                            className={styles.inputProduct}
                            placeholder="product name..."
                            value={item.product}
                            onChange={(e) => updateItem(sec.id, activeTime, idx, "product", e.target.value)}
                          />
                          <div className={styles.amountRow}>
                            <input
                              className={styles.inputAmount}
                              type="number"
                              step="any"
                              value={item.amount || ""}
                              onChange={(e) => updateItem(sec.id, activeTime, idx, "amount", parseFloat(e.target.value) || 0)}
                            />
                            <select
                              className={styles.inputUnit}
                              value={item.unit}
                              onChange={(e) => updateItem(sec.id, activeTime, idx, "unit", e.target.value)}
                            >
                              {FEED_UNITS.map((u) => (
                                <option key={u} value={u}>{u}</option>
                              ))}
                            </select>
                          </div>
                        </div>
                      ))}
                      <button
                        type="button"
                        className={styles.btnAddItem}
                        style={{
                          color: sec.color,
                          background: `${sec.color}08`,
                          borderColor: `${sec.color}40`,
                        }}
                        onClick={() => addItem(sec.id, activeTime)}
                      >
                        {ADD_LABELS[sec.id]}
                      </button>
                      {showEditNotes ? (
                        <textarea
                          className={styles.notesEdit}
                          placeholder="notes..."
                          value={editSections[sec.id].notes || ""}
                          onChange={(e) => updateNotes(sec.id, e.target.value)}
                        />
                      ) : (
                        <button
                          type="button"
                          className={styles.btnAddNotes}
                          onClick={() => toggleEditNotes(sec.id)}
                        >
                          + add notes
                        </button>
                      )}
                    </>
                  )}
                </div>
              </div>
            );
          })}

          {/* Daily summary (read mode only) */}
          {!isEditing && dailySummary.length > 0 && (
            <div className={styles.dailySummary}>
              <div className={styles.dailySummaryTitle}>daily summary</div>
              {dailySummary.map((sec) => (
                <div key={sec.id} className={styles.summarySection}>
                  <div className={styles.summarySectionLabel} style={{ color: sec.color }}>
                    {sec.icon} {sec.label.toUpperCase()}
                  </div>
                  {sec.items.map((item) => (
                    <div key={item.product} className={styles.summaryRow}>
                      <span className={styles.summaryProduct}>{item.product}</span>
                      <span className={styles.summaryAmount}>{item.total} {item.unit}/day</span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}

          {/* History */}
          {!isEditing && (
            <>
              <button
                type="button"
                className={styles.btnHistory}
                onClick={() => setShowHistory((p) => !p)}
              >
                📋 {showHistory ? "hide feed plan history" : "view feed plan history"}
              </button>
              {showHistory && history && history.length > 0 && (
                <div className={styles.historyCard}>
                  {history.map((entry, idx) => (
                    <div key={entry._id} className={styles.historyEntry}>
                      <div
                        className={styles.historyDot}
                        style={{ background: idx === 0 ? "#4A5BDB" : "#E8EAF0" }}
                      />
                      <div>
                        <div className={styles.historyText}>{entry.changeDescription}</div>
                        <div className={styles.historyDate}>
                          {new Date(entry.changedAt).toLocaleDateString("en-US", {
                            month: "short", day: "numeric", year: "numeric",
                            hour: "numeric", minute: "2-digit",
                          })}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
