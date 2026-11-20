import {
  ReaderDateTimeFormat,
  getDateDisplayLanguage,
  getDateLocale,
  getDateTimeFormat,
} from "Common/Types/DateLanguage";

/*
 * "Oct 14" for a YYYY-MM-DD day: the date it names, in the reader's language
 * ("14. Okt." in German, "۱۴ اکتبر" in Persian) - never the browser's own,
 * which put English months under a German page. Whoever counted the bar
 * wrote down the date of the day it counted - the Security and Data
 * Security overviews the reader's own day (issue #7925) - so the date is
 * read as it is written, as a UTC midnight formatted in UTC, and no zone
 * moves it to the day before or after.
 */
export function formatDayLabel(day: string): string {
  const date: Date = new Date(`${day}T00:00:00Z`);

  if (Number.isNaN(date.getTime())) {
    return day;
  }

  const format: ReaderDateTimeFormat | null = getDateTimeFormat({
    locale: getDateLocale(getDateDisplayLanguage()),
    timezones: ["UTC"],
    options: { day: "numeric", month: "short" },
  });

  return format ? format.format(date) : day;
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

// The dates a narrow chart keeps: the first, the middle and the last.
export const NARROW_CHART_DAY_LABELS: number = 3;

/*
 * Which of the labelled days a narrow chart keeps (StackedDayBars, under
 * 20rem - a phone's card): the first, the middle and the last, each one of
 * getLabelledDayIndexes's. Five dates in 250 pixels ran into each other
 * where months are long ("28. Sept.5. Okt.", "۵ اکتبر۲۸ سپتامبر").
 */
export function getNarrowChartDayLabelIndexes(dayCount: number): Set<number> {
  const indexes: Set<number> = new Set<number>();

  if (dayCount <= NARROW_CHART_DAY_LABELS) {
    for (let index: number = 0; index < dayCount; index++) {
      indexes.add(index);
    }

    return indexes;
  }

  for (let label: number = 0; label < NARROW_CHART_DAY_LABELS; label++) {
    indexes.add(
      Math.round((label * (dayCount - 1)) / (NARROW_CHART_DAY_LABELS - 1)),
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
