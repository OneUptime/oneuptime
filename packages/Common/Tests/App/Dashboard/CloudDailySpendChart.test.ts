import { afterEach, describe, expect, test } from "@jest/globals";
import OneUptimeDate from "../../../Types/Date";
import Timezone from "../../../Types/Timezone";
import SeriesPoints from "../../../UI/Components/Charts/Types/SeriesPoints";
import {
  DAILY_SPEND_COLORS,
  DAILY_SPEND_SERIES,
  STILL_BEING_REPORTED_SERIES,
  getCloudDailySpendChart,
  getCloudPartlyReportedStart,
  toReaderDay,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Cloud/CloudDailySpendChart";
import { CloudCostPoint } from "../../../../App/FeatureSet/Dashboard/src/Components/Cloud/CloudCostReads";

/*
 * Each day's spend as a bar on the day it is labelled with. A cloud bills by
 * the UTC day; the chart groups its bars by the day on the reader's clock -
 * midnight UTC would be the evening before in New York and the morning of
 * the same day in Tokyo - so each day is handed to it as noon of that day
 * on the reader's clock, in any zone the reader has configured.
 */

const NOV_3: Date = new Date("2026-11-03T00:00:00.000Z");

// The calendar day and hour a moment is at on a zone's clock.
function wallClock(date: Date, zone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  }).format(date);
}

afterEach(() => {
  OneUptimeDate.setUserTimezone(null);
});

describe("a UTC day on the reader's clock", () => {
  test.each([
    [Timezone.AmericaNew_York, "America/New_York"],
    [Timezone.AsiaTokyo, "Asia/Tokyo"],
    [Timezone.PacificAuckland, "Pacific/Auckland"],
    [Timezone.AsiaTehran, "Asia/Tehran"],
  ])("%s: the same calendar day, at noon", (zone: Timezone, name: string) => {
    OneUptimeDate.setUserTimezone(zone);
    expect(OneUptimeDate.getCurrentTimezone()).toBe(zone);

    expect(wallClock(toReaderDay(NOV_3), name)).toBe("2026-11-03, 12");
  });

  test("in UTC itself, noon UTC", () => {
    OneUptimeDate.setUserTimezone(Timezone.UTC);

    expect(toReaderDay(NOV_3).toISOString()).toBe("2026-11-03T12:00:00.000Z");
  });
});

describe("the bars", () => {
  test("one series of every day, from the first day's start to the last one's end", () => {
    OneUptimeDate.setUserTimezone(Timezone.AmericaNew_York);

    const chart: { series: Array<SeriesPoints>; min: Date; max: Date } | null =
      getCloudDailySpendChart({
        points: [
          { x: NOV_3, y: 12.5 },
          { x: new Date("2026-11-04T00:00:00.000Z"), y: 0 },
        ],
        seriesName: DAILY_SPEND_SERIES,
      });

    expect(chart).not.toBeNull();
    expect(chart!.series).toHaveLength(1);
    expect(chart!.series[0]!.seriesName).toBe("Spend");
    expect(
      chart!.series[0]!.data.map((point: { x: Date; y: number }) => {
        return [wallClock(point.x, "America/New_York"), point.y];
      }),
    ).toEqual([
      ["2026-11-03, 12", 12.5],
      ["2026-11-04, 12", 0],
    ]);
    expect(wallClock(chart!.min, "America/New_York")).toBe("2026-11-03, 00");
    expect(wallClock(chart!.max, "America/New_York")).toBe("2026-11-04, 23");
  });

  test("no days, no chart", () => {
    expect(
      getCloudDailySpendChart({ points: [], seriesName: "Spend" }),
    ).toBeNull();
  });
});

/*
 * A cloud reports a day late and in part: the newest day it has reported,
 * and any day after it, is not finished, and its short bar is not spend
 * that fell. Those days are a series of their own, drawn lighter and named
 * in the legend, stacked with the rest so each day keeps one bar.
 */
describe("the days still being reported", () => {
  function day(date: string, y: number): CloudCostPoint {
    return { x: new Date(`${date}T00:00:00.000Z`), y };
  }

  const MONTH: Array<CloudCostPoint> = [
    day("2026-11-01", 540),
    day("2026-11-02", 0),
    day("2026-11-03", 560),
    // The newest day reported, in part, and today, not reported yet.
    day("2026-11-04", 120),
    day("2026-11-05", 0),
  ];

  test("start at the newest day with a cost; none while no day has one", () => {
    expect(getCloudPartlyReportedStart(MONTH)).toBe(3);
    expect(getCloudPartlyReportedStart([day("2026-11-01", 3)])).toBe(0);
    expect(
      getCloudPartlyReportedStart([day("2026-11-01", 0), day("2026-11-02", 0)]),
    ).toBeNull();
    expect(getCloudPartlyReportedStart([])).toBeNull();
  });

  test("are a series of their own: every day in one of the two, in order", () => {
    OneUptimeDate.setUserTimezone(Timezone.UTC);

    const chart: { series: Array<SeriesPoints>; min: Date; max: Date } | null =
      getCloudDailySpendChart({
        points: MONTH,
        seriesName: DAILY_SPEND_SERIES,
        partlyReportedSeriesName: STILL_BEING_REPORTED_SERIES,
      });

    expect(
      chart!.series.map((series: SeriesPoints) => series.seriesName),
    ).toEqual(["Spend", "Still being reported"]);

    const values: (series: SeriesPoints) => Array<[string, number]> = (
      series: SeriesPoints,
    ): Array<[string, number]> => {
      return series.data.map((point: { x: Date; y: number }) => {
        return [point.x.toISOString().slice(0, 10), point.y];
      });
    };

    // A finished day with no cost stays a finished day.
    expect(values(chart!.series[0]!)).toEqual([
      ["2026-11-01", 540],
      ["2026-11-02", 0],
      ["2026-11-03", 560],
    ]);
    expect(values(chart!.series[1]!)).toEqual([
      ["2026-11-04", 120],
      ["2026-11-05", 0],
    ]);
    // The window is the same: the first day's start to the last one's end.
    expect(chart!.min.toISOString()).toBe("2026-11-01T00:00:00.000Z");
    expect(chart!.max.toISOString()).toBe("2026-11-05T23:59:59.000Z");
  });

  test("no day with a cost, or no name for them: one series of every day", () => {
    const quiet: { series: Array<SeriesPoints> } | null =
      getCloudDailySpendChart({
        points: [day("2026-11-01", 0), day("2026-11-02", 0)],
        seriesName: DAILY_SPEND_SERIES,
        partlyReportedSeriesName: STILL_BEING_REPORTED_SERIES,
      });
    expect(quiet!.series).toHaveLength(1);
    expect(quiet!.series[0]!.data).toHaveLength(2);

    expect(
      getCloudDailySpendChart({
        points: MONTH,
        seriesName: DAILY_SPEND_SERIES,
      })!.series,
    ).toHaveLength(1);
  });

  test("drawn lighter than a finished day's bar, in the same hue", () => {
    expect(DAILY_SPEND_COLORS).toEqual(["indigo", "#a5b4fc"]);
  });
});
