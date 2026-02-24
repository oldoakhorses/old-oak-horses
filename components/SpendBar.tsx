import styles from "./SpendBar.module.css";

export default function SpendBar({
  label,
  amount,
  percentage,
  color,
  rightText,
}: {
  label: string;
  amount: string;
  percentage: number;
  color?: string;
  rightText?: string;
}) {
  return (
    <div className={styles.row}>
      <div className={styles.top}>
        <span className={styles.label}>{label}</span>
        <span className={styles.amount}>{amount}</span>
        <span className={styles.meta}>{rightText ?? `${percentage.toFixed(1)}%`}</span>
      </div>
      <div className={styles.track}>
        <div className={styles.fill} style={{ width: `${Math.min(100, Math.max(0, percentage))}%`, background: color }} />
      </div>
    </div>
  );
}
