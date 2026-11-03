import { afterEach, describe, expect, test } from "@jest/globals";
import OneUptimeDate from "../../../Types/Date";
import Timezone from "../../../Types/Timezone";
import SeriesPoints from "../../../UI/Components/Charts/Types/SeriesPoints";
import {
  DAILY_SPEND_SERIES,
  getCloudDailySpendChart,
  toReaderDay,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Cloud/CloudDailySpendChart";

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
