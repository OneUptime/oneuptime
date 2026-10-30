import {
  getDateDisplayLanguage,
  getDateLocale,
} from "Common/Types/DateLanguage";

/*
 * "Oct 14" for a YYYY-MM-DD day, in UTC like the counts, in the reader's
 * language ("14. Okt." in German, "۱۴ اکتبر" in Persian) - never the
 * browser's own, which put English months under a German page.
 */
export function formatDayLabel(day: string): string {
  const date: Date = new Date(`${day}T00:00:00Z`);

  if (Number.isNaN(date.getTime())) {
    return day;
  }

  return date.toLocaleDateString(getDateLocale(getDateDisplayLanguage()), {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

// The most day labels under a month of bars.
export const MAX_SPREAD_DAY_LABELS: number = 5;

/*
 * Which day labels fit under the bars: every day for a week; for longer,
 * five spread evenly from the first day to the last, so no two crowd each
 * other. Every fifth day and the last as well put the last two labels four
 * bars apart, where a phone ran them together ("Oct 23Oct 27").
 */
export function getLabelledDayIndexes(dayCount: number): Set<number> {
  const indexes: Set<number> = new Set<number>();

  if (dayCount <= 0) {
    return indexes;
  }

  if (dayCount <= 8) {
    for (let index: number = 0; index < dayCount; index++) {
      indexes.add(index);
    }

    return indexes;
  }

  for (let label: number = 0; label < MAX_SPREAD_DAY_LABELS; label++) {
    indexes.add(
      Math.round((label * (dayCount - 1)) / (MAX_SPREAD_DAY_LABELS - 1)),
    );
  }

  return indexes;
}

export type DayLabelAnchor = "start" | "center" | "end";

/*
 * Where a day's label sits on its bar: the first day's starts at the
 * chart's starting edge and the last day's ends at its far edge, so
 * neither runs past the chart - the last date was cut at the card's edge
 * - and every other one is centred on its bar. Start and end follow the
 * reading direction.
 */
export function getDayLabelAnchor(
  index: number,
  dayCount: number,
): DayLabelAnchor {
  if (dayCount > 1 && index === 0) {
    return "start";
  }

  if (dayCount > 1 && index === dayCount - 1) {
    return "end";
  }

  return "center";
}
