import { type ReactNode } from "react";
import styles from "./Modal.module.css";

export default function Modal({
  open,
  title,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  if (!open) return null;

  return (
    <div className={styles.backdrop} onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className={styles.card}>
        <h3 className={styles.title}>{title}</h3>
        {children}
      </div>
    </div>
  );
}
