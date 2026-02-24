import styles from "./FilterTabs.module.css";

export type FilterOption<T extends string> = {
  key: T;
  label: string;
};

export default function FilterTabs<T extends string>({
  options,
  value,
  onChange,
}: {
  options: FilterOption<T>[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div className={styles.wrap}>
      {options.map((option) => (
        <button
          key={option.key}
          type="button"
          className={option.key === value ? styles.active : styles.button}
          onClick={() => onChange(option.key)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
