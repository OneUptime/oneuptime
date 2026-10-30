import { afterEach, describe, expect, test } from "@jest/globals";
import {
  ENGLISH_DATE_LANGUAGE,
  setDateDisplayLanguage,
} from "Common/Types/DateLanguage";
import {
  MAX_SPREAD_DAY_LABELS,
  formatDayLabel,
  getDayLabelAnchor,
  getLabelledDayIndexes,
} from "../../FeatureSet/Dashboard/src/Components/SecurityOverview/DayLabels";

/*
 * The dates under a day-by-day chart (StackedDayBars: Data Security's and
 * Security Events' Overviews, an entity's risk history).
 *
 * The UI review of Data Security found three things wrong with them: the
 * last date ran past the card's edge, the last two ran into each other on a
 * phone ("Oct 23Oct 27": every fifth day and the last put them four bars
 * apart), and a German page wrote its months in English (the browser's own
 * locale). Held here: which days are labelled, where each label sits on its
 * bar, and the reader's language.
 */

afterEach(() => {
  setDateDisplayLanguage(ENGLISH_DATE_LANGUAGE);
});

describe("which days are labelled", () => {
  test("every day of a week, and nothing for no days", () => {
    expect([...getLabelledDayIndexes(7)]).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect([...getLabelledDayIndexes(8)]).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect([...getLabelledDayIndexes(1)]).toEqual([0]);
    expect(getLabelledDayIndexes(0).size).toBe(0);
  });

  test("a month: five dates spread from the first day to today", () => {
    expect([...getLabelledDayIndexes(30)]).toEqual([0, 7, 15, 22, 29]);
    expect([...getLabelledDayIndexes(31)]).toEqual([0, 8, 15, 23, 30]);
    expect([...getLabelledDayIndexes(14)]).toEqual([0, 3, 7, 10, 13]);
    expect(MAX_SPREAD_DAY_LABELS).toBe(5);
  });

  test("past a week, never more than five dates, always the first and the last, and never two close together", () => {
    for (let dayCount: number = 9; dayCount <= 120; dayCount++) {
      const indexes: Array<number> = [...getLabelledDayIndexes(dayCount)].sort(
        (a: number, b: number): number => {
          return a - b;
        },
      );

      expect(indexes.length).toBe(MAX_SPREAD_DAY_LABELS);
      expect(indexes[0]).toBe(0);
      expect(indexes[indexes.length - 1]).toBe(dayCount - 1);

      // Evenly spread: no gap more than one day shorter than another.
      const gaps: Array<number> = indexes.slice(1).map(
        (index: number, position: number): number => {
          return index - indexes[position]!;
        },
      );

      expect(Math.max(...gaps) - Math.min(...gaps)).toBeLessThanOrEqual(1);
      // A month's last two dates were four bars apart: now about a quarter.
      expect(Math.min(...gaps)).toBeGreaterThanOrEqual(
        Math.floor((dayCount - 1) / (MAX_SPREAD_DAY_LABELS - 1)),
      );
    }
  });
});

describe("where a date sits on its bar", () => {
  test("the first day's starts at the chart's edge, the last day's ends at the other, the rest are centred", () => {
    expect(getDayLabelAnchor(0, 30)).toBe("start");
    expect(getDayLabelAnchor(29, 30)).toBe("end");

    for (const index of [1, 7, 15, 22, 28]) {
      expect(getDayLabelAnchor(index, 30)).toBe("center");
    }
  });

  test("a chart of one day centres it", () => {
    expect(getDayLabelAnchor(0, 1)).toBe("center");
  });
});

describe("a date in the reader's language", () => {
  test("English, as the counts are kept: in UTC", () => {
    expect(formatDayLabel("2026-10-27")).toBe("Oct 27");
    // A day starts at midnight UTC wherever the reader is.
    expect(formatDayLabel("2026-10-01")).toBe("Oct 1");
  });

  test("German writes its own month, never the browser's English", () => {
    setDateDisplayLanguage("de");

    expect(formatDayLabel("2026-10-27")).toBe("27. Okt.");
  });

  test("Persian writes its own month and digits, on the Gregorian calendar", () => {
    setDateDisplayLanguage("fa");

    const label: string = formatDayLabel("2026-10-27");

    expect(label).toContain("۲۷");
    expect(label).toContain("اکتبر");
    expect(label).not.toContain("27");
  });

  test("text that is not a day is left as it is", () => {
    expect(formatDayLabel("yesterday")).toBe("yesterday");
  });
});
