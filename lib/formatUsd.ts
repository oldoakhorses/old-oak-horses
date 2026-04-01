/**
 * Format a number as USD with accounting-style parentheses for negatives.
 * e.g. 1234.56 → "$1,234.56", -500 → "($500.00)"
 */
export function formatUsd(value: number): string {
  const abs = Math.abs(value);
  const formatted = `$${abs.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  return value < 0 ? `(${formatted})` : formatted;
}

/** Alias for compatibility with files using fmtUSD */
export const fmtUSD = formatUsd;
