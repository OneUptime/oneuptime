import { describe, expect, test } from "@jest/globals";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import {
  ERROR_PATTERN_TIMELINE_MAX_ROWS,
  ErrorPatternTimelineRow,
  buildErrorPatternTimelineRows,
  isErrorPatternTimelineIntraday,
} from "../../FeatureSet/Dashboard/src/Components/Logs/ErrorPatternTimeline";
import { ErrorPatternTimelinePoint } from "../../FeatureSet/Dashboard/src/Utils/LogsInsights";

/*
 * Issue #4105: the error drawer's "When it happened" chart is now a time
 * chart a drag can zoom the Insights page with. For a drag to mean a window
 * of time, the bars have to be spaced like the time they cover - quiet
 * buckets included - which the correlation response on its own is not.
 */

const MINUTE: number = 60 * 1000;
const HOUR: number = 60 * MINUTE;
const DAY: number = 24 * HOUR;

function window(startIso: string, endIso: string): InBetween<Date> {
  return new InBetween<Date>(new Date(startIso), new Date(endIso));
}

function point(iso: string | null, count: number): ErrorPatternTimelinePoint {
  return { time: iso ? new Date(iso) : null, count };
}

function times(rows: Array<ErrorPatternTimelineRow>): Array<string> {
  return rows.map((row: ErrorPatternTimelineRow): string => {
    return row.time;
  });
}

describe("buildErrorPatternTimelineRows", () => {
  test("one row per bucket across the whole window, quiet buckets at zero", () => {
    const rows: Array<ErrorPatternTimelineRow> = buildErrorPatternTimelineRows({
      points: [point("2026-09-28T11:10:00.000Z", 3)],
      window: window("2026-09-28T11:00:00.000Z", "2026-09-28T11:05:00.000Z"),
      bucketIntervalMs: MINUTE,
    });

    expect(times(rows)).toEqual([
      "2026-09-28T11:00:00.000Z",
      "2026-09-28T11:01:00.000Z",
      "2026-09-28T11:02:00.000Z",
      "2026-09-28T11:03:00.000Z",
      "2026-09-28T11:04:00.000Z",
      // Outside the window, but an occurrence the reader must still see.
      "2026-09-28T11:10:00.000Z",
    ]);
    expect(
      rows.map((row: ErrorPatternTimelineRow): number => {
        return row.count;
      }),
    ).toEqual([0, 0, 0, 0, 0, 3]);
  });

  test("occurrences land in the bucket that holds them", () => {
    const rows: Array<ErrorPatternTimelineRow> = buildErrorPatternTimelineRows({
      points: [
        point("2026-09-28T11:01:00.000Z", 3),
        point("2026-09-28T11:03:00.000Z", 5),
      ],
      window: window("2026-09-28T11:00:00.000Z", "2026-09-28T11:05:00.000Z"),
      bucketIntervalMs: MINUTE,
    });

    expect(
      rows.map((row: ErrorPatternTimelineRow): number => {
        return row.count;
      }),
    ).toEqual([0, 3, 0, 5, 0]);
  });

  test("buckets line up with the epoch, like the server's, not with the window's start", () => {
    const rows: Array<ErrorPatternTimelineRow> = buildErrorPatternTimelineRows({
      points: [point("2026-09-28T11:15:00.000Z", 2)],
      window: window("2026-09-28T11:07:30.000Z", "2026-09-28T11:30:00.000Z"),
      bucketIntervalMs: 15 * MINUTE,
    });

    expect(times(rows)).toEqual([
      "2026-09-28T11:00:00.000Z",
      "2026-09-28T11:15:00.000Z",
    ]);
    expect(rows[1]!.count).toBe(2);
  });

  test("points in the same bucket add up", () => {
    const rows: Array<ErrorPatternTimelineRow> = buildErrorPatternTimelineRows({
      points: [
        point("2026-09-28T11:00:10.000Z", 1),
        point("2026-09-28T11:00:50.000Z", 2),
      ],
      window: window("2026-09-28T11:00:00.000Z", "2026-09-28T11:02:00.000Z"),
      bucketIntervalMs: MINUTE,
    });

    expect(rows[0]!.count).toBe(3);
  });

  test("an undated point or a negative count is not drawn", () => {
    const rows: Array<ErrorPatternTimelineRow> = buildErrorPatternTimelineRows({
      points: [point(null, 9), point("2026-09-28T11:00:00.000Z", -4)],
      window: window("2026-09-28T11:00:00.000Z", "2026-09-28T11:02:00.000Z"),
      bucketIntervalMs: MINUTE,
    });

    expect(
      rows.map((row: ErrorPatternTimelineRow): number => {
        return row.count;
      }),
    ).toEqual([0, 0]);
  });

  test("without a bucket width the points are drawn as they are, in time order", () => {
    const rows: Array<ErrorPatternTimelineRow> = buildErrorPatternTimelineRows({
      points: [
        point("2026-09-28T11:30:00.000Z", 2),
        point("2026-09-28T11:10:00.000Z", 1),
        point(null, 4),
      ],
      window: window("2026-09-28T11:00:00.000Z", "2026-09-28T12:00:00.000Z"),
      bucketIntervalMs: undefined,
    });

    expect(rows).toEqual([
      { time: "2026-09-28T11:10:00.000Z", count: 1 },
      { time: "2026-09-28T11:30:00.000Z", count: 2 },
    ]);
  });

  test("a window too long for its bucket width is not blown up into rows", () => {
    const rows: Array<ErrorPatternTimelineRow> = buildErrorPatternTimelineRows({
      points: [point("2026-09-28T11:10:00.000Z", 1)],
      window: window("2026-01-01T00:00:00.000Z", "2026-09-28T12:00:00.000Z"),
      bucketIntervalMs: MINUTE,
    });

    expect(rows.length).toBeLessThanOrEqual(ERROR_PATTERN_TIMELINE_MAX_ROWS);
    expect(rows).toEqual([{ time: "2026-09-28T11:10:00.000Z", count: 1 }]);
  });

  test("a window given as strings (restored from a URL) is still read", () => {
    const rows: Array<ErrorPatternTimelineRow> = buildErrorPatternTimelineRows({
      points: [],
      window: new InBetween<Date>(
        "2026-09-28T11:00:00.000Z" as unknown as Date,
        "2026-09-28T11:03:00.000Z" as unknown as Date,
      ),
      bucketIntervalMs: MINUTE,
    });

    expect(rows).toHaveLength(3);
  });

  test("the rows' labels read back as the bucket start (what a drag selects)", () => {
    const rows: Array<ErrorPatternTimelineRow> = buildErrorPatternTimelineRows({
      points: [],
      window: window("2026-09-28T11:00:00.000Z", "2026-09-28T11:02:00.000Z"),
      bucketIntervalMs: MINUTE,
    });

    expect(new Date(rows[1]!.time).getTime()).toBe(
      new Date("2026-09-28T11:01:00.000Z").getTime(),
    );
  });
});

describe("isErrorPatternTimelineIntraday", () => {
  test.each([
    ["an hour", HOUR, true],
    ["two days", 2 * DAY, true],
    ["a week", 7 * DAY, false],
  ])(
    "%s reads by time of day: %s",
    (_label: string, spanMs: number, expected: boolean) => {
      const start: Date = new Date("2026-09-20T00:00:00.000Z");
      expect(
        isErrorPatternTimelineIntraday(
          new InBetween<Date>(start, new Date(start.getTime() + spanMs)),
        ),
      ).toBe(expected);
    },
  );
});
