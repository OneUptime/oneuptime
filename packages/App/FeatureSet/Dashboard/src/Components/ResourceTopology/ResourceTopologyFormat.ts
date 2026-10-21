/*
 * Numbers on a topology's cards and in its sentences, written the same way
 * for every product: whole percents on a card ("45%"), one decimal where a
 * threshold is being explained ("92.1% used"), sizes in binary units.
 */

/* A finite number, or null: inventory columns arrive as numbers or strings. */
export function toFiniteNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const number: number = typeof value === "number" ? value : Number(value);

  return Number.isFinite(number) ? number : null;
}

export function formatTopologyPercent(
  value: number | null | undefined,
  decimals: number = 0,
): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "—";
  }

  return `${value.toFixed(decimals)}%`;
}

const BYTE_UNITS: Array<string> = ["KiB", "MiB", "GiB", "TiB", "PiB"];

export function formatTopologyBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined || !Number.isFinite(bytes)) {
    return "—";
  }

  if (Math.abs(bytes) < 1024) {
    return `${Math.round(bytes)} B`;
  }

  let value: number = bytes / 1024;
  let unit: number = 0;

  while (Math.abs(value) >= 1024 && unit < BYTE_UNITS.length - 1) {
    value /= 1024;
    unit++;
  }

  return `${value.toFixed(Math.abs(value) >= 100 ? 0 : 1)} ${BYTE_UNITS[unit]}`;
}

/* A date-like value, or null. */
export function toTopologyDate(value: unknown): Date | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const date: Date = value instanceof Date ? value : new Date(value as string);

  return Number.isFinite(date.getTime()) ? date : null;
}

/* Whether `value` is no older than `maxAgeMs` at `now`. */
export function isRecent(
  value: unknown,
  now: Date,
  maxAgeMs: number,
): boolean {
  const date: Date | null = toTopologyDate(value);

  if (!date) {
    return false;
  }

  return now.getTime() - date.getTime() <= maxAgeMs;
}
