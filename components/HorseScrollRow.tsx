"use client";

import { useMemo, useRef } from "react";
import styles from "./HorseScrollRow.module.css";

export type HorseScrollItem = {
  key: string;
  name: string;
  amount: number;
  percentage: number;
};

export default function HorseScrollRow({
  items,
  formatter,
}: {
  items: HorseScrollItem[];
  formatter: (value: number) => string;
}) {
  const ref = useRef<HTMLDivElement>(null);

  const safeItems = useMemo(() => items, [items]);

  const scrollBy = (delta: number) => {
    ref.current?.scrollBy({ left: delta, behavior: "smooth" });
  };

  return (
    <section>
      <div className={styles.headerRow}>
        <div className={styles.label}>spend_by_horse · {safeItems.length}</div>
        <div className={styles.divider} />
        <div className={styles.controls}>
          <button type="button" className={styles.arrow} onClick={() => scrollBy(-260)}>
            ←
          </button>
          <button type="button" className={styles.arrow} onClick={() => scrollBy(260)}>
            →
          </button>
        </div>
      </div>

      <div className={styles.scroll} ref={ref}>
        {safeItems.map((item) => (
          <article className={styles.card} key={item.key}>
            <div className={styles.avatar}>🐴</div>
            <div className={styles.name} title={item.name}>
              {item.name}
            </div>
            <div className={styles.pct}>{item.percentage.toFixed(1)}%</div>
            <div className={styles.amount}>{formatter(item.amount)}</div>
            <div className={styles.track}>
              <div className={styles.fill} style={{ width: `${Math.min(100, item.percentage)}%` }} />
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
