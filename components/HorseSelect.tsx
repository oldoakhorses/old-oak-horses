"use client";

import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useOrgArgs } from "@/lib/useOrgArgs";
import styles from "./HorseSelect.module.css";

interface HorseSelectProps {
  value: string;
  onChange: (id: string) => void;
  compact?: boolean;
  showSplitOption?: boolean;
  splitValue?: string;
}

export default function HorseSelect({
  value,
  onChange,
  compact = false,
  showSplitOption = false,
  splitValue = "__split__"
}: HorseSelectProps) {
  const orgArgs = useOrgArgs();
  const horses = useQuery(api.horses.getActiveHorses, orgArgs) ?? [];
  const className = [
    styles.select,
    compact ? styles.compact : "",
    value ? styles.selected : ""
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <select className={className} value={value} onChange={(event) => onChange(event.target.value)}>
      <option value="">assign horse...</option>
      {horses.map((horse) => (
        <option key={horse._id} value={String(horse._id)}>
          {horse.name}
        </option>
      ))}
      {showSplitOption ? <option value={splitValue}>↔ split across horses...</option> : null}
    </select>
  );
}
