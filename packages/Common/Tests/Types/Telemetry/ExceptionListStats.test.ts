import {
  EXCEPTION_TREND_BUCKET_COUNT,
  ExceptionListStats,
  MAX_EXCEPTION_LIST_STATS_IDS,
  MIN_EXCEPTION_TREND_BUCKET_SECONDS,
  clampExceptionTrendBucket,
  emptyExceptionTrend,
  getExceptionTrendBucketSizeInSeconds,
  readExceptionListStats,
  sumExceptionTrend,
} from "../../../Types/Telemetry/ExceptionListStats";
import { SeededRandom, seededRandom } from "../../Helpers/SeededRandom";
import { describe, expect, test } from "@jest/globals";

/*
 * The numbers beside each row of the exceptions list: affected users and a
 * trend of EXCEPTION_TREND_BUCKET_COUNT bars over the list's range, as the
 * server writes them and the Dashboard reads them back.
 */

const HOUR_MS: number = 60 * 60 * 1000;
const START: Date = new Date("2026-10-30T00:00:00.000Z");

describe("the bars of a range", () => {
  test("a day is 24 bars of an hour", () => {
    expect(EXCEPTION_TREND_BUCKET_COUNT).toBe(24);
    expect(
      getExceptionTrendBucketSizeInSeconds(
        START,
        new Date(START.getTime() + 24 * HOUR_MS),
      ),
    ).toBe(3600);
  });

  test("a week is 24 bars of 7 hours", () => {
    expect(
      getExceptionTrendBucketSizeInSeconds(
        START,
        new Date(START.getTime() + 7 * 24 * HOUR_MS),
      ),
    ).toBe(7 * 3600);
  });

  test("a bar is never narrower than a minute", () => {
    expect(
      getExceptionTrendBucketSizeInSeconds(
        START,
        new Date(START.getTime() + 5 * 60 * 1000),
      ),
    ).toBe(MIN_EXCEPTION_TREND_BUCKET_SECONDS);
    expect(getExceptionTrendBucketSizeInSeconds(START, START)).toBe(
      MIN_EXCEPTION_TREND_BUCKET_SECONDS,
    );
  });

  test("an uneven range rounds the bar up, so 24 bars always cover it", () => {
    const random: SeededRandom = seededRandom(1187);

    for (let round: number = 0; round < 2000; round++) {
      const rangeMs: number =
        1000 + random(90 * 24) * HOUR_MS + random(HOUR_MS);
      const end: Date = new Date(START.getTime() + rangeMs);
      const bucket: number = getExceptionTrendBucketSizeInSeconds(START, end);

      expect(
        bucket * EXCEPTION_TREND_BUCKET_COUNT * 1000,
      ).toBeGreaterThanOrEqual(rangeMs);
      expect(bucket).toBeGreaterThanOrEqual(MIN_EXCEPTION_TREND_BUCKET_SECONDS);
    }
  });

  test("the range's last instant counts in the last bar, and nothing before the range counts", () => {
    expect(clampExceptionTrendBucket(0)).toBe(0);
    expect(clampExceptionTrendBucket(23)).toBe(23);
    expect(clampExceptionTrendBucket(24)).toBe(23);
    expect(clampExceptionTrendBucket(-1)).toBeNull();
    expect(clampExceptionTrendBucket(Number.NaN)).toBeNull();
  });

  test("an empty trend is 24 zeros, and a trend sums to its occurrences", () => {
    expect(emptyExceptionTrend()).toEqual(new Array(24).fill(0));
    expect(sumExceptionTrend([1, 0, 5, 2])).toBe(8);
    expect(sumExceptionTrend([])).toBe(0);
  });
});

describe("reading an answer back", () => {
  test("the answer as the server writes it", () => {
    const trend: Array<number> = emptyExceptionTrend();
    trend[0] = 3;
    trend[23] = 9;

    const stats: ExceptionListStats | null = readExceptionListStats({
      stats: [{ telemetryExceptionId: "e1", affectedUsers: 4, trend }],
      bucketSizeInSeconds: 3600,
      startTime: "2026-10-29T00:00:00.000Z",
      endTime: "2026-10-30T00:00:00.000Z",
    });

    expect(stats).toEqual({
      items: [{ telemetryExceptionId: "e1", affectedUsers: 4, trend }],
      bucketSizeInSeconds: 3600,
      startTime: "2026-10-29T00:00:00.000Z",
      endTime: "2026-10-30T00:00:00.000Z",
    });
  });

  test("counts as strings (64-bit integers in ClickHouse JSON) read as numbers", () => {
    const stats: ExceptionListStats | null = readExceptionListStats({
      stats: [
        {
          telemetryExceptionId: "e1",
          affectedUsers: "12",
          trend: ["1", "2", 3],
        },
      ],
    });

    expect(stats!.items[0]!.affectedUsers).toBe(12);
    expect(stats!.items[0]!.trend.slice(0, 3)).toEqual([1, 2, 3]);
  });

  test("users that could not be counted stay unknown, not 0", () => {
    const stats: ExceptionListStats | null = readExceptionListStats({
      stats: [{ telemetryExceptionId: "e1", affectedUsers: null, trend: [] }],
    });

    expect(stats!.items[0]!.affectedUsers).toBeNull();
  });

  test("every trend is exactly 24 whole, non-negative counts", () => {
    const stats: ExceptionListStats | null = readExceptionListStats({
      stats: [
        {
          telemetryExceptionId: "short",
          trend: [1, 2],
        },
        {
          telemetryExceptionId: "long",
          trend: new Array(100).fill(1),
        },
        {
          telemetryExceptionId: "odd",
          trend: [-4, 2.7, "x", null, Number.POSITIVE_INFINITY, {}],
        },
        { telemetryExceptionId: "none" },
      ],
    });

    for (const item of stats!.items) {
      expect(item.trend).toHaveLength(24);
      for (const count of item.trend) {
        expect(Number.isInteger(count) && count >= 0).toBe(true);
      }
    }

    expect(stats!.items[2]!.trend.slice(0, 6)).toEqual([0, 2, 0, 0, 0, 0]);
  });

  test("one item per exception, and malformed items are dropped", () => {
    const stats: ExceptionListStats | null = readExceptionListStats({
      stats: [
        { telemetryExceptionId: "e1", affectedUsers: 1 },
        { telemetryExceptionId: "E1", affectedUsers: 2 },
        { telemetryExceptionId: "" },
        { telemetryExceptionId: 7 },
        { telemetryExceptionId: "x".repeat(65) },
        "e2",
        null,
        [],
      ],
    });

    expect(
      stats!.items.map((item: { telemetryExceptionId: string }): string => {
        return item.telemetryExceptionId;
      }),
    ).toEqual(["e1"]);
  });

  test("at most as many items as one request asks about", () => {
    const stats: ExceptionListStats | null = readExceptionListStats({
      stats: new Array(MAX_EXCEPTION_LIST_STATS_IDS + 50)
        .fill(0)
        .map((_value: number, index: number) => {
          return { telemetryExceptionId: `e${index}` };
        }),
    });

    expect(stats!.items).toHaveLength(MAX_EXCEPTION_LIST_STATS_IDS);
  });

  test("anything that is not an answer is null", () => {
    for (const value of [null, undefined, "stats", [], {}, { stats: "x" }]) {
      expect(readExceptionListStats(value)).toBeNull();
    }
  });

  test("a missing bar width reads as the narrowest", () => {
    expect(readExceptionListStats({ stats: [] })!.bucketSizeInSeconds).toBe(
      MIN_EXCEPTION_TREND_BUCKET_SECONDS,
    );
  });
});
