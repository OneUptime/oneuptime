import { describe, expect, test } from "@jest/globals";
import {
  getSloBurnDownZoomRange,
  getSloIdealBurnPointsInWindow,
} from "../../FeatureSet/Dashboard/src/Components/Slo/SloBurnDownZoom";
import RangeStartAndEndDateTime from "Common/Types/Time/RangeStartAndEndDateTime";
import TimeRange from "Common/Types/Time/TimeRange";
import {
  getSloIdealBurnPoints,
  SloIdealBurnPoint,
} from "Common/Utils/Slo/SloProjection";

/*
 * The pure half of drag-to-zoom on the SLO overview's budget burn-down card
 * (issue #4105): which window a drag zooms the card to, and the calendar
 * month's even-burn line over just the part of the month a zoom shows. The
 * card itself is rendered in Common/Tests/App/Dashboard/
 * SloBudgetBurnDownZoom.test.tsx.
 */

const MINUTE_MS: number = 60 * 1000;
const HOUR_MS: number = 60 * MINUTE_MS;
const DAY_MS: number = 24 * HOUR_MS;

const NOW: Date = new Date("2026-09-15T12:00:00.000Z");
const WINDOW_START: Date = new Date(NOW.getTime() - 30 * DAY_MS);

function windowOf(range: RangeStartAndEndDateTime | null): [string, string] {
  expect(range).not.toBeNull();
  expect(range!.range).toBe(TimeRange.CUSTOM);
  return [
    range!.startAndEndDate!.startValue.toISOString(),
    range!.startAndEndDate!.endValue.toISOString(),
  ];
}

function zoom(start: string, end: string): RangeStartAndEndDateTime | null {
  return getSloBurnDownZoomRange({
    startTime: new Date(start),
    endTime: new Date(end),
    complianceWindowStart: WINDOW_START,
    now: NOW,
  });
}

describe("getSloBurnDownZoomRange", () => {
  test("a drag inside the window zooms to exactly that window, as a custom range", () => {
    expect(
      windowOf(zoom("2026-09-14T00:00:00.000Z", "2026-09-14T06:00:00.000Z")),
    ).toEqual(["2026-09-14T00:00:00.000Z", "2026-09-14T06:00:00.000Z"]);
  });

  test("a right-to-left drag is the same window", () => {
    expect(
      windowOf(zoom("2026-09-14T06:00:00.000Z", "2026-09-14T00:00:00.000Z")),
    ).toEqual(["2026-09-14T00:00:00.000Z", "2026-09-14T06:00:00.000Z"]);
  });

  test("a drag running past now stops at now (a calendar month draws the rest of the month)", () => {
    expect(
      windowOf(zoom("2026-09-15T06:00:00.000Z", "2026-09-20T00:00:00.000Z")),
    ).toEqual(["2026-09-15T06:00:00.000Z", NOW.toISOString()]);
  });

  test("a drag starting before the compliance window starts where the window does", () => {
    expect(
      windowOf(
        zoom(
          new Date(WINDOW_START.getTime() - 3 * HOUR_MS).toISOString(),
          new Date(WINDOW_START.getTime() + HOUR_MS).toISOString(),
        ),
      ),
    ).toEqual([
      WINDOW_START.toISOString(),
      new Date(WINDOW_START.getTime() + HOUR_MS).toISOString(),
    ]);
  });

  test("a drag over both edges is cut at both", () => {
    expect(
      windowOf(
        zoom(
          new Date(WINDOW_START.getTime() - DAY_MS).toISOString(),
          new Date(NOW.getTime() + DAY_MS).toISOString(),
        ),
      ),
    ).toEqual([WINDOW_START.toISOString(), NOW.toISOString()]);
  });

  test.each([
    [
      "entirely in the future",
      "2026-09-20T00:00:00.000Z",
      "2026-09-25T00:00:00.000Z",
    ],
    [
      "entirely before the compliance window",
      new Date(WINDOW_START.getTime() - 2 * DAY_MS).toISOString(),
      new Date(WINDOW_START.getTime() - DAY_MS).toISOString(),
    ],
    ["zero wide", "2026-09-14T00:00:00.000Z", "2026-09-14T00:00:00.000Z"],
    [
      "ending exactly at the window start",
      "2026-08-01T00:00:00.000Z",
      WINDOW_START.toISOString(),
    ],
    ["starting exactly at now", NOW.toISOString(), "2026-09-16T00:00:00.000Z"],
  ])(
    "a drag %s covers no time that can hold history: no zoom",
    (_label: string, start: string, end: string) => {
      expect(zoom(start, end)).toBeNull();
    },
  );

  test("an edge that is not a date is no zoom", () => {
    expect(
      getSloBurnDownZoomRange({
        startTime: new Date("not a date"),
        endTime: new Date("2026-09-14T00:00:00.000Z"),
        complianceWindowStart: WINDOW_START,
        now: NOW,
      }),
    ).toBeNull();
    expect(
      getSloBurnDownZoomRange({
        startTime: new Date("2026-09-14T00:00:00.000Z"),
        endTime: new Date("2026-09-14T06:00:00.000Z"),
        complianceWindowStart: new Date("not a date"),
        now: NOW,
      }),
    ).toBeNull();
  });

  test("dates that arrive as ISO strings despite the type are still read", () => {
    expect(
      windowOf(
        getSloBurnDownZoomRange({
          startTime: "2026-09-14T00:00:00.000Z" as unknown as Date,
          endTime: "2026-09-14T06:00:00.000Z" as unknown as Date,
          complianceWindowStart: WINDOW_START.toISOString() as unknown as Date,
          now: NOW.toISOString() as unknown as Date,
        }),
      ),
    ).toEqual(["2026-09-14T00:00:00.000Z", "2026-09-14T06:00:00.000Z"]);
  });
});

describe("getSloIdealBurnPointsInWindow", () => {
  const MONTH_START: Date = new Date("2026-09-01T00:00:00.000Z");
  const MONTH_RESET: Date = new Date("2026-10-01T00:00:00.000Z");
  const MONTH_MS: number = MONTH_RESET.getTime() - MONTH_START.getTime();

  const monthLineAt: (date: Date) => number = (date: Date): number => {
    return 100 * (1 - (date.getTime() - MONTH_START.getTime()) / MONTH_MS);
  };

  function lineOver(
    windowStart: string,
    windowEnd: string,
    stepSeconds: number,
  ): Array<SloIdealBurnPoint> {
    return getSloIdealBurnPointsInWindow({
      budgetStartDate: MONTH_START,
      budgetResetDate: MONTH_RESET,
      windowStartDate: new Date(windowStart),
      windowEndDate: new Date(windowEnd),
      stepSeconds: stepSeconds,
    });
  }

  test("over the whole month it is exactly the month's line", () => {
    expect(
      lineOver(MONTH_START.toISOString(), MONTH_RESET.toISOString(), 3600),
    ).toEqual(
      getSloIdealBurnPoints({
        startDate: MONTH_START,
        endDate: MONTH_RESET,
        stepSeconds: 3600,
      }),
    );
  });

  test("inside a zoom each point keeps the month's value, not a fresh 100%", () => {
    const points: Array<SloIdealBurnPoint> = lineOver(
      "2026-09-10T00:00:00.000Z",
      "2026-09-11T00:00:00.000Z",
      30 * 60,
    );

    // Nine days into thirty: 70% of the budget should be left.
    expect(points[0]!.x.toISOString()).toBe("2026-09-10T00:00:00.000Z");
    expect(points[0]!.y).toBeCloseTo(70, 10);
    expect(points[points.length - 1]!.x.toISOString()).toBe(
      "2026-09-11T00:00:00.000Z",
    );
    expect(points[points.length - 1]!.y).toBeCloseTo(
      monthLineAt(new Date("2026-09-11T00:00:00.000Z")),
      10,
    );
    for (const point of points) {
      expect(point.y).toBeCloseTo(monthLineAt(point.x), 10);
    }
  });

  test("points are laid out at the zoomed chart's own step, one per bucket plus the end", () => {
    const points: Array<SloIdealBurnPoint> = lineOver(
      "2026-09-10T00:00:00.000Z",
      "2026-09-10T12:00:00.000Z",
      5 * 60,
    );

    /*
     * Twelve hours of five-minute buckets. Over the whole month the same
     * step would be thinned out to one point every twenty-odd minutes.
     */
    expect(points).toHaveLength(12 * 12 + 1);
    for (let index: number = 1; index < points.length; index++) {
      expect(points[index]!.x.getTime() - points[index - 1]!.x.getTime()).toBe(
        5 * MINUTE_MS,
      );
    }
  });

  test("a window reaching outside the month is cut to the month", () => {
    const points: Array<SloIdealBurnPoint> = lineOver(
      "2026-08-31T00:00:00.000Z",
      "2026-09-01T12:00:00.000Z",
      3600,
    );

    expect(points[0]!.x.toISOString()).toBe(MONTH_START.toISOString());
    expect(points[0]!.y).toBe(100);
    for (const point of points) {
      expect(point.y).toBeLessThanOrEqual(100);
      expect(point.x.getTime()).toBeGreaterThanOrEqual(MONTH_START.getTime());
    }

    const tail: Array<SloIdealBurnPoint> = lineOver(
      "2026-09-30T12:00:00.000Z",
      "2026-10-02T00:00:00.000Z",
      3600,
    );
    expect(tail[tail.length - 1]!.x.toISOString()).toBe(
      MONTH_RESET.toISOString(),
    );
    expect(tail[tail.length - 1]!.y).toBeCloseTo(0, 10);
    for (const point of tail) {
      expect(point.y).toBeGreaterThanOrEqual(-1e-9);
    }
  });

  test.each([
    [
      "before the month",
      "2026-08-01T00:00:00.000Z",
      "2026-08-02T00:00:00.000Z",
    ],
    ["after the reset", "2026-10-02T00:00:00.000Z", "2026-10-03T00:00:00.000Z"],
    ["empty", "2026-09-10T00:00:00.000Z", "2026-09-10T00:00:00.000Z"],
  ])(
    "a window %s has no line",
    (_label: string, windowStart: string, windowEnd: string) => {
      expect(lineOver(windowStart, windowEnd, 3600)).toEqual([]);
    },
  );

  test("a month with no length has no line", () => {
    expect(
      getSloIdealBurnPointsInWindow({
        budgetStartDate: MONTH_RESET,
        budgetResetDate: MONTH_START,
        windowStartDate: MONTH_START,
        windowEndDate: MONTH_RESET,
        stepSeconds: 3600,
      }),
    ).toEqual([]);
  });
});
