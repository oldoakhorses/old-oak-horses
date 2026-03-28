"use client";

import { useState, useMemo } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import NavBar from "@/components/NavBar";
import styles from "./feedplan.module.css";

type FeedItem = { product: string; amount: number; unit: string };
type TimeSlot = "am" | "lunch" | "pm";
type SectionId = "hay" | "grain" | "supplements" | "meds";
type SectionData = { am: FeedItem[]; lunch: FeedItem[]; pm: FeedItem[]; notes?: string };
type Sections = Record<SectionId, SectionData>;

const FEED_UNITS = ["scoops", "cups", "flakes", "lbs", "oz", "ml", "cc", "tabs", "pumps", "tbsp", "tsp", "grams", "tubes"];

const FEED_SECTIONS: { id: SectionId; label: string; icon: string; color: string }[] = [
  { id: "hay", label: "Hay", icon: "\u{1F33E}", color: "#22C583" },
  { id: "grain", label: "Grain", icon: "\u{1F33D}", color: "#F59E0B" },
  { id: "supplements", label: "Supplements", icon: "\u{1F48A}", color: "#4A5BDB" },
  { id: "meds", label: "Meds", icon: "\u{1F489}", color: "#EC4899" },
];

const TIME_TABS: { key: TimeSlot; label: string; icon: string }[] = [
  { key: "am", label: "AM", icon: "\u{1F305}" },
  { key: "lunch", label: "LUNCH", icon: "\u2600\uFE0F" },
  { key: "pm", label: "PM", icon: "\u{1F319}" },
];

const EMPTY_SECTIONS: Sections = {
  hay: { am: [], lunch: [], pm: [] },
  grain: { am: [], lunch: [], pm: [] },
  supplements: { am: [], lunch: [], pm: [] },
  meds: { am: [], lunch: [], pm: [] },
};

function generateChangeDescription(oldSections: Sections | null, newSections: Sections): string {
  if (!oldSections) return "Initial feed plan created";
  const changes: string[] = [];
  const sectionIds: SectionId[] = ["hay", "grain", "supplements", "meds"];
  const times: TimeSlot[] = ["am", "lunch", "pm"];

  for (const section of sectionIds) {
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

export default function FeedPlanPage() {
  const params = useParams();
  const router = useRouter();
  const horseId = params.horseId as Id<"horses">;

  const horse = useQuery(api.horses.getHorseById, { horseId });
  const feedPlan = useQuery(api.feedPlans.getByHorse, { horseId });
  const history = useQuery(api.feedPlans.getHistory, { horseId });
  const saveFeedPlan = useMutation(api.feedPlans.save);

  const [editing, setEditing] = useState(false);
  const [activeTime, setActiveTime] = useState<TimeSlot>("am");
  const [editSections, setEditSections] = useState<Sections>(EMPTY_SECTIONS);
  const [showHistory, setShowHistory] = useState(false);
  const [expandedNotes, setExpandedNotes] = useState<Set<SectionId>>(new Set());
  const [saving, setSaving] = useState(false);

  const sections: Sections = (feedPlan?.sections as Sections) ?? EMPTY_SECTIONS;

  function startEdit() {
    setEditSections(JSON.parse(JSON.stringify(feedPlan?.sections ?? EMPTY_SECTIONS)));
    setEditing(true);
  }

  function cancelEdit() {
    setEditing(false);
    setExpandedNotes(new Set());
  }

  async function onSave() {
    setSaving(true);
    try {
      const desc = generateChangeDescription(feedPlan?.sections as Sections | null, editSections);
      await saveFeedPlan({ horseId, sections: editSections, changeDescription: desc });
      setEditing(false);
      setExpandedNotes(new Set());
    } finally {
      setSaving(false);
    }
  }

  function updateItem(sectionId: SectionId, time: TimeSlot, index: number, field: keyof FeedItem, value: string | number) {
    setEditSections((prev) => {
      const next = JSON.parse(JSON.stringify(prev)) as Sections;
      (next[sectionId][time][index] as Record<string, unknown>)[field] = value;
      return next;
    });
  }

  function addItem(sectionId: SectionId, time: TimeSlot) {
    setEditSections((prev) => {
      const next = JSON.parse(JSON.stringify(prev)) as Sections;
      next[sectionId][time].push({ product: "", amount: 0, unit: "scoops" });
      return next;
    });
  }

  function removeItem(sectionId: SectionId, time: TimeSlot, index: number) {
    setEditSections((prev) => {
      const next = JSON.parse(JSON.stringify(prev)) as Sections;
      next[sectionId][time].splice(index, 1);
      return next;
    });
  }

  function setNotes(sectionId: SectionId, value: string) {
    setEditSections((prev) => {
      const next = JSON.parse(JSON.stringify(prev)) as Sections;
      next[sectionId].notes = value;
      return next;
    });
  }

  function toggleNotes(sectionId: SectionId) {
    setExpandedNotes((prev) => {
      const next = new Set(prev);
      if (next.has(sectionId)) next.delete(sectionId);
      else next.add(sectionId);
      return next;
    });
  }

  const currentSections = editing ? editSections : sections;

  const timeItemCounts = useMemo(() => {
    const counts: Record<TimeSlot, number> = { am: 0, lunch: 0, pm: 0 };
    for (const time of ["am", "lunch", "pm"] as TimeSlot[]) {
      for (const sec of FEED_SECTIONS) {
        counts[time] += currentSections[sec.id][time].length;
      }
    }
    return counts;
  }, [currentSections]);

  const dailySummary = useMemo(() => {
    const result: { sectionId: SectionId; icon: string; label: string; color: string; items: { product: string; total: number; unit: string }[] }[] = [];
    for (const sec of FEED_SECTIONS) {
      const productMap = new Map<string, { total: number; unit: string }>();
      for (const time of ["am", "lunch", "pm"] as TimeSlot[]) {
        for (const item of sections[sec.id][time]) {
          if (!item.product) continue;
          const key = `${item.product}|||${item.unit}`;
          const existing = productMap.get(key);
          if (existing) {
            existing.total += item.amount;
          } else {
            productMap.set(key, { total: item.amount, unit: item.unit });
          }
        }
      }
      if (productMap.size > 0) {
        result.push({
          sectionId: sec.id,
          icon: sec.icon,
          label: sec.label.toUpperCase(),
          color: sec.color,
          items: Array.from(productMap.entries()).map(([key, v]) => ({
            product: key.split("|||")[0],
            total: v.total,
            unit: v.unit,
          })),
        });
      }
    }
    return result;
  }, [sections]);

  const hasPlan = feedPlan !== null && feedPlan !== undefined;
  const hasAnyItems = FEED_SECTIONS.some((sec) => ["am", "lunch", "pm"].some((t) => sections[sec.id][t as TimeSlot].length > 0));

  const horseName = horse?.name ?? "Horse";
  const updatedLabel = feedPlan?.updatedAt
    ? `updated ${new Date(feedPlan.updatedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`
    : "";

  if (horse === undefined) {
    return (
      <div className={styles.page}>
        <NavBar items={[{ label: "horses", href: "/horses" }, { label: horseName, href: `/horses/${horseId}` }, { label: "feed plan" }]} />
        <div className={styles.loading}>loading...</div>
      </div>
    );
  }

  if (horse === null) {
    return (
      <div className={styles.page}>
        <NavBar items={[{ label: "horses", href: "/horses" }, { label: horseName, href: `/horses/${horseId}` }, { label: "feed plan" }]} />
        <div className={styles.loading}>horse not found</div>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <NavBar items={[{ label: "horses", href: "/horses" }, { label: horseName, href: `/horses/${horseId}` }, { label: "feed plan" }]} />
      <div className={styles.container}>
        {/* Back link */}
        <Link href={`/horses/${horseId}`} className={styles.backLink}>
          ← {horseName}
        </Link>

        {/* Page header */}
        <div className={styles.pageHeader}>
          <div>
            <h1 className={styles.pageTitle}>feed plan</h1>
            <div className={styles.pageSubtitle}>{horseName}{updatedLabel ? ` \u00B7 ${updatedLabel}` : ""}</div>
          </div>
          <div className={styles.headerActions}>
            {editing ? (
              <>
                <button type="button" className={styles.btnCancel} onClick={cancelEdit}>cancel</button>
                <button type="button" className={styles.btnSave} onClick={onSave} disabled={saving}>{saving ? "saving..." : "save"}</button>
              </>
            ) : (
              <button type="button" className={styles.btnEdit} onClick={startEdit}>edit</button>
            )}
          </div>
        </div>

        {/* Empty state */}
        {!hasPlan && !editing ? (
          <div className={styles.emptyState}>
            <div className={styles.emptyIcon}>🌾</div>
            <div className={styles.emptyTitle}>no feed plan yet</div>
            <div className={styles.emptySub}>tap edit to set up {horseName}&apos;s feeding schedule</div>
          </div>
        ) : (
          <>
            {/* Time tabs */}
            <div className={styles.timeTabs}>
              {TIME_TABS.map((tab) => (
                <button
                  key={tab.key}
                  type="button"
                  className={`${styles.timeTab} ${activeTime === tab.key ? styles.timeTabActive : styles.timeTabInactive}`}
                  onClick={() => setActiveTime(tab.key)}
                >
                  <span className={styles.timeTabIcon}>{tab.icon}</span>
                  <span className={styles.timeTabLabel}>{tab.label}</span>
                  <span className={styles.timeTabCount}>{timeItemCounts[tab.key]} item{timeItemCounts[tab.key] !== 1 ? "s" : ""}</span>
                </button>
              ))}
            </div>

            {/* Section cards */}
            {FEED_SECTIONS.map((sec) => {
              const items = currentSections[sec.id][activeTime];
              const notes = currentSections[sec.id].notes;
              const hasNotes = !!notes;
              const notesExpanded = expandedNotes.has(sec.id);
              const addLabel = sec.id === "supplements" ? "+ add supplement" : sec.id === "meds" ? "+ add medication" : `+ add ${sec.id}`;

              return (
                <div key={sec.id} className={styles.sectionCard}>
                  {/* Section header */}
                  <div className={styles.sectionHeader}>
                    <div className={styles.sectionHeaderLeft}>
                      <div className={styles.sectionIconBox} style={{ background: `${sec.color}10` }}>
                        <span>{sec.icon}</span>
                      </div>
                      <div>
                        <span className={styles.sectionName}>{sec.label}</span>
                        <span className={styles.sectionCount}>{items.length} item{items.length !== 1 ? "s" : ""}</span>
                      </div>
                    </div>
                    {hasNotes && !editing ? (
                      <button type="button" className={styles.notesBadge} onClick={() => toggleNotes(sec.id)}>
                        {"\u{1F4DD}"} notes
                      </button>
                    ) : null}
                  </div>

                  {/* Items */}
                  {!editing ? (
                    <>
                      {items.length === 0 ? (
                        <div className={styles.emptySection}>&mdash;</div>
                      ) : (
                        items.map((item, i) => (
                          <div key={i} className={styles.itemRow}>
                            <span className={styles.itemName}>{item.product}</span>
                            <div className={styles.itemRight}>
                              <span className={styles.itemAmount} style={{ color: sec.color }}>{item.amount}</span>
                              <span className={styles.itemUnit}>{item.unit}</span>
                            </div>
                          </div>
                        ))
                      )}
                      {/* Read-mode notes */}
                      {hasNotes && notesExpanded ? (
                        <div className={styles.notesRead}>{notes}</div>
                      ) : null}
                    </>
                  ) : (
                    <>
                      {items.map((item, i) => (
                        <div key={i} className={styles.itemEditCard}>
                          <button type="button" className={styles.removeBtn} onClick={() => removeItem(sec.id, activeTime, i)}>&times;</button>
                          <input
                            className={styles.editInput}
                            value={item.product}
                            onChange={(e) => updateItem(sec.id, activeTime, i, "product", e.target.value)}
                            placeholder="product name..."
                          />
                          <div className={styles.editAmountRow}>
                            <input
                              type="number"
                              className={`${styles.editInput} ${styles.editAmount}`}
                              value={item.amount || ""}
                              onChange={(e) => updateItem(sec.id, activeTime, i, "amount", Number(e.target.value) || 0)}
                              placeholder="0"
                            />
                            <select
                              className={`${styles.editInput} ${styles.editUnit}`}
                              value={item.unit}
                              onChange={(e) => updateItem(sec.id, activeTime, i, "unit", e.target.value)}
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
                        className={styles.addBtn}
                        style={{ color: sec.color, background: `${sec.color}08`, borderColor: `${sec.color}40` }}
                        onClick={() => addItem(sec.id, activeTime)}
                      >
                        {addLabel}
                      </button>
                      {/* Edit-mode notes */}
                      {hasNotes || notesExpanded ? (
                        <div className={styles.notesEditWrap}>
                          <textarea
                            className={styles.notesTextarea}
                            value={editSections[sec.id].notes || ""}
                            onChange={(e) => setNotes(sec.id, e.target.value)}
                            placeholder="notes..."
                          />
                        </div>
                      ) : (
                        <button type="button" className={styles.addNotesLink} onClick={() => toggleNotes(sec.id)}>
                          + add notes
                        </button>
                      )}
                    </>
                  )}
                </div>
              );
            })}

            {/* Daily summary (read mode only) */}
            {!editing && hasAnyItems ? (
              <div className={styles.dailySummary}>
                <div className={styles.dailySummaryTitle}>daily summary</div>
                {dailySummary.map((group) => (
                  <div key={group.sectionId} className={styles.summaryGroup}>
                    <div className={styles.summaryGroupLabel} style={{ color: group.color }}>
                      {group.icon} {group.label}
                    </div>
                    {group.items.map((item, i) => (
                      <div key={i} className={styles.summaryRow}>
                        <span className={styles.summaryProduct}>{item.product}</span>
                        <span className={styles.summaryAmount}>{item.total} {item.unit}/day</span>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            ) : null}

            {/* History */}
            {!editing ? (
              <>
                <button type="button" className={styles.btnHistory} onClick={() => setShowHistory((p) => !p)}>
                  {"\u{1F4CB}"} {showHistory ? "hide feed plan history" : "view feed plan history"}
                </button>
                {showHistory && history && history.length > 0 ? (
                  <div className={styles.historyCard}>
                    {history.map((entry, i) => (
                      <div key={entry._id} className={styles.historyEntry}>
                        <div className={styles.historyDot} style={{ background: i === 0 ? "#4A5BDB" : "#E8EAF0" }} />
                        <div>
                          <div className={styles.historyText}>{entry.changeDescription}</div>
                          <div className={styles.historyDate}>
                            {new Date(entry.changedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                            {" \u00B7 "}
                            {new Date(entry.changedAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : null}
                {showHistory && (!history || history.length === 0) ? (
                  <div className={styles.historyCard}>
                    <div className={styles.historyEmpty}>no history yet</div>
                  </div>
                ) : null}
              </>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
