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

export const MIDDLE_ELLIPSIS: string = "\u2026";

/* Of what fits of a name cut in its middle, the share kept from its start. */
export const NAME_HEAD_SHARE: number = 0.6;

/*
 * A name cut to fit a width in its middle, not at its end. The parts of one
 * workload share their start and differ at their end - three pods read
 * "payments-api-7d9f8c6b…" when cut at the end - and the parts of one
 * cluster share their end and differ at their start ("ip-10-0-4-24.eu-
 * west-1.compute.internal"), so a cut in the middle keeps what tells them
 * apart either way: "payments-api-7…5-xx63z", "ip-10-0-4-24.…internal".
 *
 * `measure` gives the drawn width of a string. A name that fits, or a width
 * that cannot be read (0 or less), leaves the name as it is.
 */
export function truncateTopologyNameMiddle(
  name: string,
  maxWidth: number,
  measure: (text: string) => number,
): string {
  if (!(maxWidth > 0) || measure(name) <= maxWidth) {
    return name;
  }

  // Code points, so a character outside the basic plane is never split.
  const characters: Array<string> = Array.from(name);
  const cut: (kept: number) => string = (kept: number): string => {
    const head: number = Math.ceil(kept * NAME_HEAD_SHARE);
    const tail: number = kept - head;

    return `${characters.slice(0, head).join("")}${MIDDLE_ELLIPSIS}${
      tail > 0 ? characters.slice(characters.length - tail).join("") : ""
    }`;
  };

  // The most characters kept that still fit: more never draws narrower.
  let low: number = 1;
  let high: number = characters.length - 1;
  let best: string = cut(0);

  while (low <= high) {
    const kept: number = Math.floor((low + high) / 2);
    const candidate: string = cut(kept);

    if (measure(candidate) <= maxWidth) {
      best = candidate;
      low = kept + 1;
    } else {
      high = kept - 1;
    }
  }

  return best;
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
export function isRecent(value: unknown, now: Date, maxAgeMs: number): boolean {
  const date: Date | null = toTopologyDate(value);

  if (!date) {
    return false;
  }

  return now.getTime() - date.getTime() <= maxAgeMs;
}
