"use client";

import { useMemo, useState } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import NavBar from "@/components/NavBar";
import { useAuth } from "@/contexts/AuthContext";
import styles from "./calendar.module.css";

const DAY_LABELS = ["S", "M", "T", "W", "T", "F", "S"] as const;
const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const DAY_NAMES = [
  "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday",
];

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

function parseInput(raw: string): { title: string; time?: string; allDay?: boolean } | null {
  const text = raw.trim();
  if (!text) return null;

  const allDayMatch = text.match(/^@allday\s+/i);
  if (allDayMatch) {
    const title = text.slice(allDayMatch[0].length).trim();
    return title ? { title, allDay: true } : null;
  }

  const timeMatch = text.match(/^@(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)\s+/i);
  if (timeMatch) {
    const title = text.slice(timeMatch[0].length).trim();
    const parsed = parseTime(timeMatch[1]);
    return title && parsed ? { title, time: parsed } : null;
  }

  return { title: text };
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

  const events = useQuery(api.calendarEvents.getByDateRange, {
    startDate: weekStartStr,
    endDate: weekEndStr,
  });

  const createEvent = useMutation(api.calendarEvents.create);
  const removeEvent = useMutation(api.calendarEvents.remove);

  const eventsForDay = useMemo(() => {
    if (!events) return [];
    return events
      .filter((e) => e.date === selectedStr)
      .sort((a, b) => {
        if (a.allDay && !b.allDay) return -1;
        if (!a.allDay && b.allDay) return 1;
        if (a.time && b.time) return a.time.localeCompare(b.time);
        if (a.time) return -1;
        if (b.time) return 1;
        return a.createdAt - b.createdAt;
      });
  }, [events, selectedStr]);

  const eventCountByDate = useMemo(() => {
    const map = new Map<string, number>();
    if (!events) return map;
    for (const e of events) {
      map.set(e.date, (map.get(e.date) || 0) + 1);
    }
    return map;
  }, [events]);

  const allDayEvents = eventsForDay.filter((e) => e.allDay);
  const timedEvents = eventsForDay.filter((e) => !e.allDay);

  const weekMonth = useMemo(() => {
    const m1 = weekDays[0].getMonth();
    const m2 = weekDays[6].getMonth();
    const y = weekDays[6].getFullYear();
    if (m1 === m2) return `${MONTH_NAMES[m1]} ${y}`;
    return `${MONTH_NAMES[m1]} – ${MONTH_NAMES[m2]} ${y}`;
  }, [weekDays]);

  const handleSubmit = async () => {
    const parsed = parseInput(inputValue);
    if (!parsed) return;
    await createEvent({
      title: parsed.title,
      date: selectedStr,
      time: parsed.time,
      allDay: parsed.allDay,
      createdBy: user?.id,
    });
    setInputValue("");
  };

  const handleDelete = async (id: Id<"calendarEvents">) => {
    await removeEvent({ id });
  };

  const dayHeaderLabel = useMemo(() => {
    const dow = DAY_NAMES[selectedDate.getDay()];
    const month = MONTH_NAMES[selectedDate.getMonth()];
    const day = selectedDate.getDate();
    return `${dow}, ${month} ${day}`;
  }, [selectedDate]);

  return (
    <div className="page-shell">
      <NavBar
        items={[
          { label: "old-oak-horses", href: "/dashboard", brand: true },
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

          {/* All-day events */}
          {allDayEvents.length > 0 && (
            <div className={styles.allDaySection}>
              <div className={styles.allDayLabel}>all day</div>
              <div className={styles.eventList}>
                {allDayEvents.map((e) => (
                  <div key={e._id} className={styles.eventCard}>
                    <span className={`${styles.eventBar} ${styles.eventBarAllDay}`} />
                    <div className={styles.eventContent}>
                      <span className={styles.eventTitle}>{e.title}</span>
                    </div>
                    <button
                      type="button"
                      className={styles.eventDeleteBtn}
                      onClick={() => handleDelete(e._id)}
                      aria-label="Delete"
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Timed & untimed events */}
          {timedEvents.length > 0 ? (
            <div className={styles.eventList}>
              {timedEvents.map((e) => (
                <div key={e._id} className={styles.eventCard}>
                  <span className={styles.eventTime}>
                    {e.time ? formatTime(e.time) : "—"}
                  </span>
                  <span className={styles.eventBar} />
                  <div className={styles.eventContent}>
                    <span className={styles.eventTitle}>{e.title}</span>
                  </div>
                  <button
                    type="button"
                    className={styles.eventDeleteBtn}
                    onClick={() => handleDelete(e._id)}
                    aria-label="Delete"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          ) : allDayEvents.length === 0 ? (
            <div className={styles.empty}>
              <div className={styles.emptyIcon}>📅</div>
              <div>no events scheduled</div>
            </div>
          ) : null}

          {/* Input bar */}
          <div className={styles.inputBar}>
            <div className={styles.inputWrap}>
              <input
                className={styles.input}
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleSubmit();
                }}
                placeholder="@1pm Lucy rides Carlin"
              />
              <button
                type="button"
                className={styles.inputSendBtn}
                disabled={!parseInput(inputValue)}
                onClick={handleSubmit}
              >
                +
              </button>
            </div>
            <div className={styles.inputHint}>@time or @allday + description</div>
          </div>
        </div>
      </main>
    </div>
  );
}
