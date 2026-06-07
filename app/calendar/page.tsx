"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import NavBar from "@/components/NavBar";
import { useAuth } from "@/contexts/AuthContext";
import { useOrgArgs } from "@/lib/useOrgArgs";
import styles from "./calendar.module.css";

const DAY_LABELS = ["S", "M", "T", "W", "T", "F", "S"] as const;
const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const DAY_NAMES = [
  "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday",
];

const RECORD_CATEGORY_COLORS: Record<string, string> = {
  veterinary: "#4a5bdb",
  farrier: "#e5930a",
  bodywork: "#22c583",
  medication: "#c44adb",
  other: "#6b7084",
};

const SWIPE_THRESHOLD = 60;

function getWeekStart(date: Date): Date {
  const d = new Date(date);
  d.setDate(d.getDate() - d.getDay());
  d.setHours(0, 0, 0, 0);
  return d;
}

function toDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function tsToDateStr(ts: number): string {
  return toDateStr(new Date(ts));
}

function prettyType(type: string): string {
  return type.replace(/_/g, " ");
}

type ParsedInput = {
  title: string;
  time?: string;
  allDay?: boolean;
  repeatDays?: number;
  isRecord?: boolean;
  recordLabel?: string;
  horseName?: string;
};

function parseInput(raw: string): ParsedInput | null {
  let text = raw.trim();
  if (!text) return null;

  let time: string | undefined;
  let allDay: boolean | undefined;

  const allDayMatch = text.match(/^@allday\s+/i);
  if (allDayMatch) {
    allDay = true;
    text = text.slice(allDayMatch[0].length).trim();
  } else {
    const timeMatch = text.match(/^@(\d{1,2}(?:[.:]\d{2})?\s*(?:am|pm)?)\s+/i);
    if (timeMatch) {
      time = parseTime(timeMatch[1].replace(".", ":")) || undefined;
      text = text.slice(timeMatch[0].length).trim();
    }
  }

  text = text.replace(/^[—–\-]+\s*/, "");

  let repeatDays: number | undefined;
  const repeatMatch = text.match(/\(repeat(?:\s+for)?\s+(\d+)\s*days?\)/i);
  if (repeatMatch) {
    repeatDays = parseInt(repeatMatch[1], 10);
    text = text.replace(repeatMatch[0], "").trim();
  }

  if (!text) return null;

  const recMatch = text.match(/^rec:\s*/i);
  if (recMatch) {
    text = text.slice(recMatch[0].length).trim();
    if (!text) return null;

    let horseName: string | undefined;
    let recordLabel = text;
    const forMatch = text.match(/\bfor\s+(.+)$/i);
    if (forMatch) {
      horseName = forMatch[1].trim();
      recordLabel = text.slice(0, forMatch.index).trim();
    }

    return { title: text, time, allDay, repeatDays, isRecord: true, recordLabel, horseName };
  }

  return { title: text, time, allDay, repeatDays };
}

function parseTime(raw: string): string | null {
  const s = raw.trim().toLowerCase();
  const m = s.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/);
  if (!m) return null;
  let h = parseInt(m[1], 10);
  const min = m[2] ? parseInt(m[2], 10) : 0;
  const meridiem = m[3];

  if (meridiem === "pm" && h < 12) h += 12;
  if (meridiem === "am" && h === 12) h = 0;
  if (!meridiem && h >= 1 && h <= 7) h += 12;

  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

function formatTime(t: string): string {
  const [hStr, mStr] = t.split(":");
  let h = parseInt(hStr, 10);
  const min = mStr;
  const suffix = h >= 12 ? "pm" : "am";
  if (h === 0) h = 12;
  else if (h > 12) h -= 12;
  return min === "00" ? `${h}${suffix}` : `${h}:${min}${suffix}`;
}

function serializeForEdit(item: AgendaItem): string {
  if (item.allDay) return `@allday ${item.title}`;
  if (item.time) return `@${formatTime(item.time)} ${item.title}`;
  return item.title;
}

type AgendaItem = {
  id: string;
  kind: "calendar" | "record" | "record-next" | "schedule";
  title: string;
  subtitle?: string;
  time?: string;
  allDay?: boolean;
  color: string;
  deletable: boolean;
  calendarEventId?: Id<"calendarEvents">;
};

function SwipeableCard({
  item,
  onEdit,
  onDelete,
  children,
}: {
  item: AgendaItem;
  onEdit?: () => void;
  onDelete?: () => void;
  children: React.ReactNode;
}) {
  const innerRef = useRef<HTMLDivElement>(null);
  const startX = useRef(0);
  const startY = useRef(0);
  const currentX = useRef(0);
  const dragging = useRef(false);
  const locked = useRef(false);
  const [offset, setOffset] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [revealed, setRevealed] = useState(false);

  const canSwipe = item.kind === "calendar";
  const actionWidth = 128;

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (!canSwipe) return;
    startX.current = e.touches[0].clientX;
    startY.current = e.touches[0].clientY;
    dragging.current = true;
    locked.current = false;
    setIsDragging(true);
  }, [canSwipe]);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (!dragging.current) return;
    const dx = e.touches[0].clientX - startX.current;
    const dy = e.touches[0].clientY - startY.current;

    if (!locked.current) {
      if (Math.abs(dy) > Math.abs(dx) && Math.abs(dy) > 5) {
        dragging.current = false;
        setIsDragging(false);
        return;
      }
      if (Math.abs(dx) > 5) locked.current = true;
    }

    const base = revealed ? -actionWidth : 0;
    let next = base + dx;
    if (next > 0) next = 0;
    if (next < -actionWidth) next = -actionWidth;
    currentX.current = dx;
    setOffset(next);
  }, [revealed, actionWidth]);

  const handleTouchEnd = useCallback(() => {
    if (!dragging.current && !locked.current) return;
    dragging.current = false;
    setIsDragging(false);
    const dx = currentX.current;
    if (revealed) {
      if (dx > SWIPE_THRESHOLD) {
        setOffset(0);
        setRevealed(false);
      } else {
        setOffset(-actionWidth);
      }
    } else {
      if (dx < -SWIPE_THRESHOLD) {
        setOffset(-actionWidth);
        setRevealed(true);
      } else {
        setOffset(0);
      }
    }
    currentX.current = 0;
  }, [revealed, actionWidth]);

  const close = useCallback(() => {
    setOffset(0);
    setRevealed(false);
  }, []);

  return (
    <div className={styles.swipeOuter}>
      <div className={styles.swipeActions} style={{ width: actionWidth }}>
        <button
          type="button"
          className={styles.swipeEditBtn}
          onClick={() => { close(); onEdit?.(); }}
        >
          edit
        </button>
        <button
          type="button"
          className={styles.swipeDeleteBtn}
          onClick={() => { close(); onDelete?.(); }}
        >
          delete
        </button>
      </div>
      <div
        ref={innerRef}
        className={`${styles.swipeInner} ${isDragging ? styles.swipeInnerDragging : ""}`}
        style={{ transform: `translateX(${offset}px)` }}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        {children}
      </div>
    </div>
  );
}

export default function CalendarPage() {
  const { user } = useAuth();
  const today = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }, []);
  const todayStr = useMemo(() => toDateStr(today), [today]);

  const [selectedDate, setSelectedDate] = useState(today);
  const [weekOffset, setWeekOffset] = useState(0);
  const [inputValue, setInputValue] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");

  const weekStart = useMemo(() => {
    const ws = getWeekStart(today);
    ws.setDate(ws.getDate() + weekOffset * 7);
    return ws;
  }, [today, weekOffset]);

  const weekDays = useMemo(() => {
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(weekStart);
      d.setDate(d.getDate() + i);
      return d;
    });
  }, [weekStart]);

  const weekStartStr = useMemo(() => toDateStr(weekDays[0]), [weekDays]);
  const weekEndStr = useMemo(() => toDateStr(weekDays[6]), [weekDays]);
  const selectedStr = useMemo(() => toDateStr(selectedDate), [selectedDate]);

  const weekStartTs = useMemo(() => weekDays[0].getTime(), [weekDays]);
  const weekEndTs = useMemo(() => {
    const end = new Date(weekDays[6]);
    end.setHours(23, 59, 59, 999);
    return end.getTime();
  }, [weekDays]);

  const calendarEvents = useQuery(api.calendarEvents.getByDateRange, {
    startDate: weekStartStr,
    endDate: weekEndStr,
  });

  const records = useQuery(api.horseRecords.getByDateRange, {
    startTs: weekStartTs,
    endTs: weekEndTs,
  });

  const scheduleEvents = useQuery(api.scheduleEvents.getByDateRange, {
    startDate: weekStartStr,
    endDate: weekEndStr,
  });

  const orgArgs = useOrgArgs();
  const activeHorses = useQuery(api.horses.getActiveHorses, orgArgs);

  const createEvent = useMutation(api.calendarEvents.create);
  const updateEvent = useMutation(api.calendarEvents.update);
  const removeEvent = useMutation(api.calendarEvents.remove);
  const createRecord = useMutation(api.horseRecords.createHorseRecord);

  const allItemsByDate = useMemo(() => {
    const map = new Map<string, AgendaItem[]>();

    if (calendarEvents) {
      for (const e of calendarEvents) {
        const items = map.get(e.date) || [];
        items.push({
          id: `cal-${e._id}`,
          kind: "calendar",
          title: e.title,
          time: e.time,
          allDay: e.allDay,
          color: "#4a5bdb",
          deletable: true,
          calendarEventId: e._id,
        });
        map.set(e.date, items);
      }
    }

    if (records) {
      for (const r of records) {
        const dateStr = tsToDateStr(r.date);
        if (weekStartStr <= dateStr && dateStr <= weekEndStr) {
          const items = map.get(dateStr) || [];
          const label = r.title || prettyType(r.type);
          items.push({
            id: `rec-${r._id}`,
            kind: "record",
            title: `${r.horseName} — ${label}`,
            subtitle: r.contactName || undefined,
            color: RECORD_CATEGORY_COLORS[r.type] || "#6b7084",
            deletable: false,
          });
          map.set(dateStr, items);
        }

        if (r.nextVisitDate) {
          const nextStr = tsToDateStr(r.nextVisitDate);
          if (weekStartStr <= nextStr && nextStr <= weekEndStr) {
            const items = map.get(nextStr) || [];
            const label = r.title || prettyType(r.type);
            items.push({
              id: `rec-next-${r._id}`,
              kind: "record-next",
              title: `${r.horseName} — ${label}`,
              subtitle: r.contactName ? `next visit · ${r.contactName}` : "next visit",
              color: RECORD_CATEGORY_COLORS[r.type] || "#6b7084",
              deletable: false,
            });
            map.set(nextStr, items);
          }
        }
      }
    }

    if (scheduleEvents) {
      for (const se of scheduleEvents) {
        const items = map.get(se.date) || [];
        items.push({
          id: `sched-${se._id}`,
          kind: "schedule",
          title: `${se.horseName} — ${prettyType(se.type)}`,
          subtitle: se.contactName || undefined,
          color: "#e5930a",
          deletable: false,
        });
        map.set(se.date, items);
      }
    }

    return map;
  }, [calendarEvents, records, scheduleEvents, weekStartStr, weekEndStr]);

  const itemsForDay = useMemo(() => {
    const items = allItemsByDate.get(selectedStr) || [];
    return items.sort((a, b) => {
      if (a.allDay && !b.allDay) return -1;
      if (!a.allDay && b.allDay) return 1;
      if (a.time && b.time) return a.time.localeCompare(b.time);
      if (a.time) return -1;
      if (b.time) return 1;
      const kindOrder = { "record-next": 0, schedule: 1, record: 2, calendar: 3 };
      return (kindOrder[a.kind] ?? 3) - (kindOrder[b.kind] ?? 3);
    });
  }, [allItemsByDate, selectedStr]);

  const eventCountByDate = useMemo(() => {
    const map = new Map<string, number>();
    for (const [date, items] of allItemsByDate) {
      map.set(date, items.length);
    }
    return map;
  }, [allItemsByDate]);

  const allDayItems = itemsForDay.filter((e) => e.allDay);
  const timedItems = itemsForDay.filter((e) => !e.allDay);

  const weekMonth = useMemo(() => {
    const m1 = weekDays[0].getMonth();
    const m2 = weekDays[6].getMonth();
    const y = weekDays[6].getFullYear();
    if (m1 === m2) return `${MONTH_NAMES[m1]} ${y}`;
    return `${MONTH_NAMES[m1]} – ${MONTH_NAMES[m2]} ${y}`;
  }, [weekDays]);

  const findHorse = useCallback((name: string) => {
    if (!activeHorses || !name) return null;
    const lower = name.toLowerCase();
    return activeHorses.find((h) =>
      h.name.toLowerCase() === lower ||
      h.barnName?.toLowerCase() === lower
    ) || activeHorses.find((h) =>
      h.name.toLowerCase().includes(lower) ||
      h.barnName?.toLowerCase().includes(lower)
    ) || null;
  }, [activeHorses]);

  const MEDICATION_KEYWORDS = ["aspirin", "bute", "banamine", "equioxx", "previcox", "adequan", "legend", "osphos", "gastrogard", "ulcergard", "omeprazole", "dexamethasone", "robaxin", "dormosedan", "ace", "regumate", "depo", "excel", "succeed", "cosequin", "platinum", "smartpak", "meds", "medication", "supplement", "show meds"];

  const submitLine = async (parsed: ParsedInput) => {
    const totalDays = (parsed.repeatDays ?? 0) + 1;
    const baseDate = new Date(selectedDate);

    if (parsed.isRecord) {
      const matchedHorse = parsed.horseName ? findHorse(parsed.horseName) : null;
      const label = parsed.recordLabel || parsed.title;
      const isMed = MEDICATION_KEYWORDS.some((k) => label.toLowerCase().includes(k));
      const recordType = isMed ? "medication" as const : "other" as const;

      if (matchedHorse) {
        const promises: Promise<unknown>[] = [];
        for (let i = 0; i < totalDays; i++) {
          const d = new Date(baseDate);
          d.setDate(d.getDate() + i);
          promises.push(createRecord({
            horseId: matchedHorse._id,
            title: label,
            type: recordType,
            date: d.getTime(),
            medications: isMed ? [label] : undefined,
            createdBy: user?.id,
          }));
        }
        await Promise.all(promises);
      } else {
        const promises: Promise<unknown>[] = [];
        for (let i = 0; i < totalDays; i++) {
          const d = new Date(baseDate);
          d.setDate(d.getDate() + i);
          promises.push(createEvent({
            title: `rec: ${parsed.title}`,
            date: toDateStr(d),
            time: parsed.time,
            allDay: parsed.allDay,
            createdBy: user?.id,
          }));
        }
        await Promise.all(promises);
      }
    } else {
      const promises: Promise<unknown>[] = [];
      for (let i = 0; i < totalDays; i++) {
        const d = new Date(baseDate);
        d.setDate(d.getDate() + i);
        promises.push(createEvent({
          title: parsed.title,
          date: toDateStr(d),
          time: parsed.time,
          allDay: parsed.allDay,
          createdBy: user?.id,
        }));
      }
      await Promise.all(promises);
    }
  };

  const handleSubmit = async () => {
    const lines = inputValue.split("\n").map((l) => l.trim()).filter(Boolean);
    const parsed = lines.map(parseInput).filter((p): p is ParsedInput => p !== null);
    if (parsed.length === 0) return;
    await Promise.all(parsed.map(submitLine));
    setInputValue("");
  };

  const handleDelete = async (id: Id<"calendarEvents">) => {
    await removeEvent({ id });
  };

  const handleStartEdit = (item: AgendaItem) => {
    setEditingId(item.id);
    setEditValue(serializeForEdit(item));
  };

  const handleSaveEdit = async (item: AgendaItem) => {
    if (!item.calendarEventId) return;
    const parsed = parseInput(editValue);
    if (!parsed) return;
    await updateEvent({
      id: item.calendarEventId,
      title: parsed.title,
      time: parsed.time,
      allDay: parsed.allDay ?? false,
    });
    setEditingId(null);
  };

  const dayHeaderLabel = useMemo(() => {
    const dow = DAY_NAMES[selectedDate.getDay()];
    const month = MONTH_NAMES[selectedDate.getMonth()];
    const day = selectedDate.getDate();
    return `${dow}, ${month} ${day}`;
  }, [selectedDate]);

  const renderCard = (item: AgendaItem, showTime: boolean) => {
    if (editingId === item.id) {
      return (
        <div key={item.id} className={styles.editRow}>
          <input
            className={styles.editInput}
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") handleSaveEdit(item); if (e.key === "Escape") setEditingId(null); }}
            autoFocus
          />
          <button type="button" className={styles.editSaveBtn} onClick={() => handleSaveEdit(item)}>save</button>
          <button type="button" className={styles.editCancelBtn} onClick={() => setEditingId(null)}>✕</button>
        </div>
      );
    }

    const card = (
      <div className={styles.eventCard}>
        {showTime && (
          <span className={styles.eventTime}>
            {item.time ? formatTime(item.time) : "—"}
          </span>
        )}
        <span className={styles.eventBar} style={{ background: item.color }} />
        <div className={styles.eventContent}>
          <span className={styles.eventTitle}>{item.title}</span>
          {item.subtitle && <span className={styles.eventSubtitle}>{item.subtitle}</span>}
        </div>
        {item.kind !== "calendar" && (
          <span className={styles.eventKindPill}>
            {item.kind === "record" || item.kind === "record-next" ? "record" : "scheduled"}
          </span>
        )}
      </div>
    );

    return (
      <SwipeableCard
        key={item.id}
        item={item}
        onEdit={() => handleStartEdit(item)}
        onDelete={() => item.calendarEventId && handleDelete(item.calendarEventId)}
      >
        {card}
      </SwipeableCard>
    );
  };

  return (
    <div className="page-shell">
      <NavBar
        items={[
          { label: "team-ldk", href: "/dashboard", brand: true },
          { label: "calendar", current: true },
        ]}
      />
      <main className="page-main">
        <div className={styles.container}>
          {/* Week strip */}
          <div className={styles.weekStrip}>
            <div className={styles.weekHeader}>
              <span className={styles.weekTitle}>{weekMonth}</span>
              <div className={styles.weekNav}>
                <button
                  type="button"
                  className={styles.weekNavBtn}
                  onClick={() => setWeekOffset((o) => o - 1)}
                  aria-label="Previous week"
                >
                  ‹
                </button>
                <button
                  type="button"
                  className={styles.weekNavBtn}
                  onClick={() => {
                    setWeekOffset(0);
                    setSelectedDate(today);
                  }}
                  aria-label="Today"
                  style={{ fontSize: 10, fontWeight: 700 }}
                >
                  ●
                </button>
                <button
                  type="button"
                  className={styles.weekNavBtn}
                  onClick={() => setWeekOffset((o) => o + 1)}
                  aria-label="Next week"
                >
                  ›
                </button>
              </div>
            </div>
            <div className={styles.weekDays}>
              {weekDays.map((d, i) => {
                const ds = toDateStr(d);
                const isToday = ds === todayStr;
                const isSelected = ds === selectedStr;
                const hasEvents = (eventCountByDate.get(ds) || 0) > 0;
                return (
                  <div
                    key={ds}
                    className={`${styles.dayCol} ${isSelected ? styles.daySelected : ""} ${isToday ? styles.dayToday : ""}`}
                    onClick={() => setSelectedDate(new Date(d))}
                  >
                    <span className={styles.dayLabel}>{DAY_LABELS[i]}</span>
                    <span className={styles.dayNumber}>{d.getDate()}</span>
                    {hasEvents ? <span className={styles.dayDot} /> : <span className={styles.dayDotEmpty} />}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Day header */}
          <div className={styles.dayHeader}>
            <h2 className={styles.dayHeaderTitle}>{dayHeaderLabel}</h2>
            {selectedStr === todayStr && (
              <div className={styles.dayHeaderSub}>// today</div>
            )}
          </div>

          {/* All-day items */}
          {allDayItems.length > 0 && (
            <div className={styles.allDaySection}>
              <div className={styles.allDayLabel}>all day</div>
              <div className={styles.eventList}>
                {allDayItems.map((item) => renderCard(item, false))}
              </div>
            </div>
          )}

          {/* Timed & untimed items */}
          {timedItems.length > 0 ? (
            <div className={styles.eventList}>
              {timedItems.map((item) => renderCard(item, true))}
            </div>
          ) : allDayItems.length === 0 ? (
            <div className={styles.empty}>
              <div className={styles.emptyIcon}>📅</div>
              <div>no events scheduled</div>
            </div>
          ) : null}

          {/* Input bar */}
          <div className={styles.inputBar}>
            <div className={styles.inputRow}>
              <textarea
                className={styles.input}
                value={inputValue}
                rows={inputValue.split("\n").length}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleSubmit();
                  }
                }}
                placeholder={"@1:30 — Dottie 6th\n@1:45 — Val 15th"}
              />
              <button
                type="button"
                className={styles.inputSendBtn}
                disabled={!inputValue.split("\n").some((l) => parseInput(l))}
                onClick={handleSubmit}
              >
                +
              </button>
            </div>
            <div className={styles.inputHint}>multiple lines = multiple items · rec: for records · shift+enter for new line</div>
          </div>
        </div>
      </main>
    </div>
  );
}
