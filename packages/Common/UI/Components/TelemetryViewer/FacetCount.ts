/*
 * How a facet value's count reads in a telemetry sidebar.
 *
 * The sidebar is 224px wide, and a count written out in full ("2,417,585")
 * took the room its value's name needed: the report that started this showed
 * a checked service cut to "one...". So a row shows the count the way the
 * explorer's own chart labels its axis - "999", "1.2K", "38K", "2.4M" - never
 * more than four characters, which also keeps every row's bar in line with
 * the others. The exact count stays a hover (and a screen reader) away.
 *
 * Kept free of React so it is unit-testable on its own.
 */

const SUFFIXES: ReadonlyArray<string> = ["K", "M", "B", "T"];

/*
 * Where the scaled number moves up a unit: 999,500 rounds to 1000K, which
 * is written 1M instead.
 */
const NEXT_UNIT_AT: number = 999.5;

// One decimal below 10 (1.2K, 9.9M); above it the decimal is noise (38K).
const DECIMAL_BELOW: number = 9.95;

const toWholeCount: (count: number) => number = (count: number): number => {
  return Number.isFinite(count) ? Math.max(0, Math.round(count)) : 0;
};

// The count as a row shows it: at most four characters.
export const formatFacetCount: (count: number) => string = (
  count: number,
): string => {
  const whole: number = toWholeCount(count);

  if (whole < 1000) {
    return String(whole);
  }

  let scaled: number = whole / 1000;
  let unit: number = 0;

  while (scaled >= NEXT_UNIT_AT && unit < SUFFIXES.length - 1) {
    scaled = scaled / 1000;
    unit++;
  }

  const shown: number =
    scaled < DECIMAL_BELOW ? Math.round(scaled * 10) / 10 : Math.round(scaled);

  return `${shown}${SUFFIXES[unit]}`;
};

// The count in full, as the reader's browser writes numbers: "2,417,585".
export const formatExactFacetCount: (count: number) => string = (
  count: number,
): string => {
  return toWholeCount(count).toLocaleString();
};

// Whether the row's count is shortened, so the full count has to be told.
export const isFacetCountShortened: (count: number) => boolean = (
  count: number,
): boolean => {
  return toWholeCount(count) >= 1000;
};
