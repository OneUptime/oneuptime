/** @timezone UTC */

import { afterEach, describe, expect, test } from "@jest/globals";
import OneUptimeDate from "../../../../Types/Date";
import {
  forgetRememberedDateTexts,
  getEnglishOf,
  setDateDisplayLanguage,
} from "../../../../Types/DateLanguage";
import Timezone from "../../../../Types/Timezone";
import ChartDataPoint, {
  CHART_DATA_POINT_X_AXIS_KEY,
} from "../../../../UI/Components/Charts/ChartLibrary/Types/ChartDataPoint";
import SeriesPoints from "../../../../UI/Components/Charts/Types/SeriesPoints";
import {
  XAxis,
  XAxisAggregateType,
} from "../../../../UI/Components/Charts/Types/XAxis/XAxis";
import XAxisPrecision from "../../../../UI/Components/Charts/Types/XAxis/XAxisPrecision";
import XAxisType from "../../../../UI/Components/Charts/Types/XAxis/XAxisType";
import YAxis, {
  YAxisPrecision,
} from "../../../../UI/Components/Charts/Types/YAxis/YAxis";
import YAxisType from "../../../../UI/Components/Charts/Types/YAxis/YAxisType";
import DataPointUtil from "../../../../UI/Components/Charts/Utils/DataPoint";
import XAxisUtil from "../../../../UI/Components/Charts/Utils/XAxis";

/*
 * A CHART OF ONE POINT A DAY NAMES ITS TICKS AS DAYS (issue #6564).
 *
 * Product Analytics charts a point a day, from the first day's start to the
 * last day's. Left to the window's length, the axis guessed its step: a
 * window of a few days got a half-hour grid labelled with clock times
 * ("07 Nov, 00:00"), a long one averaged days into weeks or months. Pinned
 * to EVERY_DAY, every slot is a day and its tick names the day.
 *
 * Pinned to days, a window can now hold a year ("Past 1 Year"), and a
 * day-and-month label then names two days: on 12 Nov 2026 the window runs
 * from 12 Nov 2025. A label is a bucket's identity (DataPointUtil puts a
 * point on the first row whose label matches), so today's point joined last
 * year's row. A day label in a window of a year or more carries its year.
 *
 * The process runs in UTC and the reader's zone is UTC unless a test says.
 */

const DAY_MS: number = 24 * 60 * 60 * 1000;
const CLOCK: RegExp = /\d:\d\d/;
const A_YEAR: RegExp = /20\d\d/;
const LATIN_DIGIT: RegExp = /[0-9]/;
// A space, a no-break space or a narrow one: the same to a reader.
const ANY_SPACE: RegExp = /\s/g;

function spaced(text: string): string {
  return text.replace(ANY_SPACE, " ");
}

function day(iso: string): Date {
  return new Date(`${iso}T00:00:00.000Z`);
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS);
}

// One point a day from `first` to `last`, each worth its day's number from 1.
function dailySeries(first: Date, last: Date): Array<SeriesPoints> {
  const data: Array<{ x: Date; y: number }> = [];

  for (
    let instant: number = first.getTime(), count: number = 1;
    instant <= last.getTime();
    instant += DAY_MS, count++
  ) {
    data.push({ x: new Date(instant), y: count });
  }

  return [{ seriesName: "Daily active users", data: data }];
}

// The ticks a chart draws over a window, as DataPointUtil lays its rows.
function ticks(data: {
  start: Date;
  end: Date;
  precision?: XAxisPrecision | undefined;
  series?: Array<SeriesPoints> | undefined;
}): Array<string> {
  const formatter: (value: Date) => string = XAxisUtil.getFormatter({
    xAxisMin: data.start,
    xAxisMax: data.end,
    precision: data.precision,
  });

  return XAxisUtil.getRenderableIntervals({
    xAxisMin: data.start,
    xAxisMax: data.end,
    precision: data.precision,
    seriesPoints: data.series ?? dailySeries(data.start, data.end),
  }).map((interval: Date): string => {
    return spaced(formatter(interval));
  });
}

function dayTicks(start: Date, end: Date): Array<string> {
  return ticks({ start, end, precision: XAxisPrecision.EVERY_DAY });
}

function expectEveryTickOnce(labels: Array<string>): void {
  expect(new Set(labels).size).toBe(labels.length);
}

const Y_AXIS: YAxis = {
  legend: "",
  options: {
    type: YAxisType.Number,
    min: 0,
    max: "auto",
    precision: YAxisPrecision.NoDecimals,
    formatter: (value: number): string => {
      return String(value);
    },
  },
};

function dayRows(start: Date, end: Date): Array<ChartDataPoint> {
  const xAxis: XAxis = {
    legend: "Time",
    options: {
      type: XAxisType.Time,
      min: start,
      max: end,
      // As ChartCard asks.
      aggregateType: XAxisAggregateType.Average,
      precision: XAxisPrecision.EVERY_DAY,
    },
  };

  return DataPointUtil.getChartDataPoints({
    seriesPoints: dailySeries(start, end),
    xAxis: xAxis,
    yAxis: Y_AXIS,
  });
}

afterEach(() => {
  setDateDisplayLanguage(null);
  OneUptimeDate.setUserTimezone(null);
  forgetRememberedDateTexts();
});

describe("a short window of days", () => {
  test("an application counted for two days: 07 Nov, 08 Nov, 09 Nov", () => {
    expect(dayTicks(day("2026-11-07"), day("2026-11-09"))).toEqual([
      "07 Nov",
      "08 Nov",
      "09 Nov",
    ]);
  });

  test("left to the window's length, the same days read as clock times", () => {
    // Why the charts pin the step: a two-day window gets a half-hour grid.
    const guessed: Array<string> = ticks({
      start: day("2026-11-07"),
      end: day("2026-11-09"),
    });

    expect(guessed[0]).toBe("07 Nov, 00:00");
    expect(guessed.length).toBeGreaterThan(90);
    expect(
      guessed.every((label: string): boolean => {
        return CLOCK.test(label);
      }),
    ).toBe(true);
  });

  test("Past 1 Day: yesterday and today", () => {
    expect(dayTicks(day("2026-11-11"), day("2026-11-12"))).toEqual([
      "11 Nov",
      "12 Nov",
    ]);
  });

  test("a single day counted so far: one tick", () => {
    // The pages give a single day a window that spans it.
    const start: Date = day("2026-11-12");

    expect(
      ticks({
        start: start,
        end: addDays(start, 1),
        precision: XAxisPrecision.EVERY_DAY,
        series: dailySeries(start, start),
      }),
    ).toEqual(["12 Nov"]);
  });

  test("no tick of a day window ever names a clock time", () => {
    for (const days of [1, 2, 3, 6, 13]) {
      const end: Date = day("2026-11-12");
      const labels: Array<string> = dayTicks(addDays(end, -days), end);

      expect(labels).toHaveLength(days + 1);
      for (const label of labels) {
        expect(label).not.toMatch(CLOCK);
      }
    }
  });
});

describe("a month of days", () => {
  test("Past 1 Month: one tick a day, no years", () => {
    const labels: Array<string> = dayTicks(
      day("2026-10-12"),
      day("2026-11-12"),
    );

    expect(labels).toHaveLength(32);
    expect(labels[0]).toBe("12 Oct");
    expect(labels[31]).toBe("12 Nov");
    expectEveryTickOnce(labels);
    for (const label of labels) {
      expect(label).not.toMatch(A_YEAR);
    }
  });

  test("across New Year the days still read without years", () => {
    const labels: Array<string> = dayTicks(
      day("2026-12-20"),
      day("2027-01-20"),
    );

    expect(labels[0]).toBe("20 Dec");
    expect(labels[labels.length - 1]).toBe("20 Jan");
    expectEveryTickOnce(labels);
  });
});

describe("a year of days", () => {
  test("Past 1 Year: each day once, named with its year", () => {
    const labels: Array<string> = dayTicks(
      day("2025-11-12"),
      day("2026-11-12"),
    );

    expect(labels).toHaveLength(366);
    expect(labels[0]).toBe("12 Nov 2025");
    expect(labels[1]).toBe("13 Nov 2025");
    expect(labels[365]).toBe("12 Nov 2026");
    expectEveryTickOnce(labels);
  });

  test("a day short of a year never names a day twice, and needs no years", () => {
    const labels: Array<string> = dayTicks(
      day("2025-11-13"),
      day("2026-11-12"),
    );

    expect(labels).toHaveLength(365);
    expect(labels[0]).toBe("13 Nov");
    expect(labels[364]).toBe("12 Nov");
    expectEveryTickOnce(labels);
  });

  test("a window that reaches its first day a year on by a minute names years", () => {
    // 12 Nov 2025 23:59 to 12 Nov 2026 00:00: both are a 12 Nov.
    const start: Date = new Date("2025-11-12T23:59:00.000Z");
    const end: Date = day("2026-11-12");
    const formatter: (value: Date) => string = XAxisUtil.getFormatter({
      xAxisMin: start,
      xAxisMax: end,
      precision: XAxisPrecision.EVERY_DAY,
    });

    expect(spaced(formatter(start))).toBe("12 Nov 2025");
    expect(spaced(formatter(end))).toBe("12 Nov 2026");
  });

  test("a year across a leap day: every day once", () => {
    const labels: Array<string> = dayTicks(
      day("2027-03-01"),
      day("2028-03-01"),
    );

    expect(labels).toHaveLength(367);
    expect(labels).toContain("29 Feb 2028");
    expectEveryTickOnce(labels);
  });

  test("the longest range a page can ask for (400 days): every day once", () => {
    const end: Date = day("2026-11-12");
    const labels: Array<string> = dayTicks(addDays(end, -400), end);

    expect(labels).toHaveLength(401);
    expectEveryTickOnce(labels);
  });

  test("today's point stays on today's row, not on last year's", () => {
    const rows: Array<ChartDataPoint> = dayRows(
      day("2025-11-12"),
      day("2026-11-12"),
    );

    expect(rows).toHaveLength(366);
    // Day 1 alone on the first row, day 366 alone on the last.
    expect(rows[0]![CHART_DATA_POINT_X_AXIS_KEY]).toBe("12 Nov 2025");
    expect(rows[0]!["Daily active users"]).toBe(1);
    expect(rows[365]![CHART_DATA_POINT_X_AXIS_KEY]).toBe("12 Nov 2026");
    expect(rows[365]!["Daily active users"]).toBe(366);

    rows.forEach((row: ChartDataPoint, place: number): void => {
      expect(row["Daily active users"]).toBe(place + 1);
    });
  });
});

describe("the week tiers, which name a day the same way", () => {
  test("a pinned week over two years names each week once, with its year", () => {
    const labels: Array<string> = ticks({
      start: day("2024-11-12"),
      end: day("2026-11-12"),
      precision: XAxisPrecision.EVERY_WEEK,
    });

    expect(labels[0]).toBe("12 Nov 2024");
    expectEveryTickOnce(labels);
    for (const label of labels) {
      expect(label).toMatch(A_YEAR);
    }
  });

  test("the weeks a window of three months gets read as before", () => {
    const labels: Array<string> = ticks({
      start: day("2026-08-12"),
      end: day("2026-11-12"),
    });

    expect(labels[0]).toBe("12 Aug");
    for (const label of labels) {
      expect(label).not.toMatch(A_YEAR);
    }
  });

  test("two-day and two-week steps over a year carry years too", () => {
    for (const precision of [
      XAxisPrecision.EVERY_TWO_DAYS,
      XAxisPrecision.EVERY_TWO_WEEKS,
    ]) {
      const formatter: (value: Date) => string = XAxisUtil.getFormatter({
        xAxisMin: day("2025-11-12"),
        xAxisMax: day("2026-11-12"),
        precision: precision,
      });

      expect(formatter(day("2026-06-10"))).toMatch(A_YEAR);
    }
  });

  test("a year of months reads as it did: month and year", () => {
    const labels: Array<string> = ticks({
      start: day("2025-11-12"),
      end: day("2026-11-12"),
    });

    expect(labels[0]).toBe("Nov 2025");
    expect(labels[labels.length - 1]).toBe("Nov 2026");
  });
});

describe("the year is read in the reader's zone", () => {
  test("New York: from midnight to midnight a year on names years", () => {
    OneUptimeDate.setUserTimezone(Timezone.AmericaNew_York);

    // 12 Nov 2025 00:00 and 12 Nov 2026 00:00 in New York.
    const labels: Array<string> = dayTicks(
      new Date("2025-11-12T05:00:00.000Z"),
      new Date("2026-11-12T05:00:00.000Z"),
    );

    expect(labels[0]).toBe("12 Nov 2025");
    expect(labels[labels.length - 1]).toBe("12 Nov 2026");
    expectEveryTickOnce(labels);
  });

  test("New York: a window ending a minute before midnight needs no years", () => {
    OneUptimeDate.setUserTimezone(Timezone.AmericaNew_York);

    /*
     * 04:59 UTC is already 12 Nov in UTC, but still 11 Nov in New York, so
     * no 12 Nov is in the window twice there.
     */
    const formatter: (value: Date) => string = XAxisUtil.getFormatter({
      xAxisMin: new Date("2025-11-12T05:00:00.000Z"),
      xAxisMax: new Date("2026-11-12T04:59:00.000Z"),
      precision: XAxisPrecision.EVERY_DAY,
    });

    expect(spaced(formatter(new Date("2025-11-12T05:00:00.000Z")))).toBe(
      "12 Nov",
    );
  });
});

describe("a day with its year in the reader's language", () => {
  const INSTANT: Date = new Date("2025-11-02T10:00:00.000Z");

  test("English: the day's two digits, its month and its year", () => {
    expect(OneUptimeDate.getDateAsLocalDayMonthYearString(INSTANT)).toBe(
      "02 Nov 2025",
    );
  });

  test.each([
    ["de", "2. Nov. 2025"],
    ["fr", "2 nov. 2025"],
    ["ja", "2025年11月2日"],
    ["zh-CN", "2025年11月2日"],
    ["ko", "2025년 11월 2일"],
  ])("%s: %s", (language: string, expected: string) => {
    setDateDisplayLanguage(language);

    expect(
      spaced(OneUptimeDate.getDateAsLocalDayMonthYearString(INSTANT)),
    ).toBe(expected);
  });

  test("Persian: Persian digits, and no Latin digit left", () => {
    setDateDisplayLanguage("fa");

    const label: string =
      OneUptimeDate.getDateAsLocalDayMonthYearString(INSTANT);

    expect(label).not.toMatch(LATIN_DIGIT);
    expect(label).toContain("۲۰۲۵");
  });

  test("Arabic: the day, its month and its year, in the Latin digits Arabic pages write", () => {
    setDateDisplayLanguage("ar");

    expect(
      spaced(OneUptimeDate.getDateAsLocalDayMonthYearString(INSTANT)),
    ).toBe("2 نوفمبر 2025");
  });

  test("remembered with its English, for a sentence still in English", () => {
    setDateDisplayLanguage("de");

    const label: string =
      OneUptimeDate.getDateAsLocalDayMonthYearString(INSTANT);

    expect(getEnglishOf(label)).toBe("02 Nov 2025");
  });

  test("a German axis over a year names its days with their years", () => {
    setDateDisplayLanguage("de");

    const labels: Array<string> = dayTicks(
      day("2025-11-12"),
      day("2026-11-12"),
    );

    expect(labels[0]).toBe("12. Nov. 2025");
    expect(labels[365]).toBe("12. Nov. 2026");
    expectEveryTickOnce(labels);
  });

  test("a German axis over three days names days alone", () => {
    setDateDisplayLanguage("de");

    expect(dayTicks(day("2026-11-07"), day("2026-11-09"))).toEqual([
      "7. Nov.",
      "8. Nov.",
      "9. Nov.",
    ]);
  });
});

/*
 * A chart grouped by year (a dashboard's yearly aggregation, or a window of
 * more than six years) names each tick by its year. It wrote the year with
 * Latin digits in every language, so on a Persian page "2025" stood beside
 * day and month ticks in Persian digits ("۱۲ اکتبر"). It is written as the
 * reader's language writes a year alone now, as the month ticks are.
 */
describe("a year axis in the reader's language", () => {
  function yearTicks(): Array<string> {
    return ticks({
      start: day("2023-01-01"),
      end: day("2026-01-01"),
      precision: XAxisPrecision.EVERY_YEAR,
    });
  }

  test("English: the years as they were", () => {
    expect(yearTicks()).toEqual(["2023", "2024", "2025", "2026"]);
  });

  test("Persian: Persian digits, and no Latin digit left", () => {
    setDateDisplayLanguage("fa");

    const labels: Array<string> = yearTicks();

    expect(labels).toEqual(["۲۰۲۳", "۲۰۲۴", "۲۰۲۵", "۲۰۲۶"]);
    for (const label of labels) {
      expect(label).not.toMatch(LATIN_DIGIT);
    }
  });

  test.each([
    ["ja", ["2023年", "2024年", "2025年", "2026年"]],
    ["ko", ["2023년", "2024년", "2025년", "2026년"]],
    ["ar", ["2023", "2024", "2025", "2026"]],
    ["de", ["2023", "2024", "2025", "2026"]],
  ])(
    "%s: as the language writes a year alone",
    (language: string, expected: Array<string>) => {
      setDateDisplayLanguage(language);

      expect(yearTicks()).toEqual(expected);
    },
  );

  test("the year is the reader's: New Year's Eve evening in New York is still the old year", () => {
    OneUptimeDate.setUserTimezone(Timezone.AmericaNew_York);

    const formatter: (value: Date) => string = XAxisUtil.getFormatter({
      xAxisMin: day("2023-01-01"),
      xAxisMax: day("2026-01-01"),
      precision: XAxisPrecision.EVERY_YEAR,
    });
    // 03:00 UTC on 1 Jan 2026 is 22:00 on 31 Dec 2025 in New York.
    const newYearInUtc: Date = new Date("2026-01-01T03:00:00.000Z");

    expect(formatter(newYearInUtc)).toBe("2025");

    setDateDisplayLanguage("fa");
    forgetRememberedDateTexts();

    expect(formatter(newYearInUtc)).toBe("۲۰۲۵");
  });

  test("remembered with its English, for a sentence still in English", () => {
    setDateDisplayLanguage("ja");

    expect(
      getEnglishOf(OneUptimeDate.getDateAsLocalYearString(day("2026-06-15"))),
    ).toBe("2026");
  });
});
