import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import TimeRangeZoomUtil from "../../../../../UI/Components/Charts/TimeRangeZoom/TimeRangeZoomUtil";
import InBetween from "../../../../../Types/BaseDatabase/InBetween";
import RangeStartAndEndDateTime from "../../../../../Types/Time/RangeStartAndEndDateTime";
import TimeRange from "../../../../../Types/Time/TimeRange";

/*
 * Issue #4105: a drag across any chart zooms the whole page to the window
 * dragged out, and a double-click puts the page back. These are the pure
 * rules behind the first half - what window a drag becomes - and behind
 * knowing whether the page is still zoomed at all.
 */

const NOW: Date = new Date("2026-09-28T12:00:00.000Z");

function custom(startIso: string, endIso: string): RangeStartAndEndDateTime {
  return {
    range: TimeRange.CUSTOM,
    startAndEndDate: new InBetween<Date>(new Date(startIso), new Date(endIso)),
  };
}

function edges(range: RangeStartAndEndDateTime | null): [string, string] {
  if (!range || !range.startAndEndDate) {
    throw new Error("expected a custom range with dates");
  }

  return [
    range.startAndEndDate.startValue.toISOString(),
    range.startAndEndDate.endValue.toISOString(),
  ];
}

describe("TimeRangeZoomUtil.getZoomedRange", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(NOW);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test("a drag becomes a custom range over exactly the window dragged out", () => {
    const zoomed: RangeStartAndEndDateTime | null =
      TimeRangeZoomUtil.getZoomedRange({
        startTime: new Date("2026-09-28T11:10:00.000Z"),
        endTime: new Date("2026-09-28T11:25:00.000Z"),
      });

    expect(zoomed?.range).toBe(TimeRange.CUSTOM);
    expect(edges(zoomed)).toEqual([
      "2026-09-28T11:10:00.000Z",
      "2026-09-28T11:25:00.000Z",
    ]);
  });

  test("a right-to-left drag is the same window as a left-to-right one", () => {
    const zoomed: RangeStartAndEndDateTime | null =
      TimeRangeZoomUtil.getZoomedRange({
        startTime: new Date("2026-09-28T11:25:00.000Z"),
        endTime: new Date("2026-09-28T11:10:00.000Z"),
      });

    expect(edges(zoomed)).toEqual([
      "2026-09-28T11:10:00.000Z",
      "2026-09-28T11:25:00.000Z",
    ]);
  });

  test("a zero-width selection is not a window", () => {
    const at: Date = new Date("2026-09-28T11:10:00.000Z");

    expect(
      TimeRangeZoomUtil.getZoomedRange({ startTime: at, endTime: at }),
    ).toBeNull();
  });

  test("an invalid date on either edge is not a window", () => {
    expect(
      TimeRangeZoomUtil.getZoomedRange({
        startTime: new Date("not a date"),
        endTime: new Date("2026-09-28T11:10:00.000Z"),
      }),
    ).toBeNull();

    expect(
      TimeRangeZoomUtil.getZoomedRange({
        startTime: new Date("2026-09-28T11:10:00.000Z"),
        endTime: new Date(Number.NaN),
      }),
    ).toBeNull();
  });

  test("dates that arrive as ISO strings (a restored range) still zoom", () => {
    const zoomed: RangeStartAndEndDateTime | null =
      TimeRangeZoomUtil.getZoomedRange({
        startTime: "2026-09-28T11:10:00.000Z" as unknown as Date,
        endTime: "2026-09-28T11:40:00.000Z" as unknown as Date,
      });

    expect(edges(zoomed)).toEqual([
      "2026-09-28T11:10:00.000Z",
      "2026-09-28T11:40:00.000Z",
    ]);
  });

  test("a zoom out of a rolling range never ends in the future", () => {
    /*
     * The newest bucket is still filling up: a minute bucket that started
     * at 11:59:30 reaches 12:00:30, past "now". Taken whole it would open
     * a window ending in the future.
     */
    const zoomed: RangeStartAndEndDateTime | null =
      TimeRangeZoomUtil.getZoomedRange({
        startTime: new Date("2026-09-28T11:50:00.000Z"),
        endTime: new Date("2026-09-28T12:00:30.000Z"),
        currentRange: { range: TimeRange.PAST_ONE_HOUR },
      });

    expect(edges(zoomed)).toEqual([
      "2026-09-28T11:50:00.000Z",
      NOW.toISOString(),
    ]);
  });

  test("a zoom out of a custom range never runs past that range's end", () => {
    const zoomed: RangeStartAndEndDateTime | null =
      TimeRangeZoomUtil.getZoomedRange({
        startTime: new Date("2026-09-20T10:00:00.000Z"),
        endTime: new Date("2026-09-20T11:05:00.000Z"),
        currentRange: custom(
          "2026-09-20T09:00:00.000Z",
          "2026-09-20T11:00:00.000Z",
        ),
      });

    expect(edges(zoomed)).toEqual([
      "2026-09-20T10:00:00.000Z",
      "2026-09-20T11:00:00.000Z",
    ]);
  });

  test("a selection wholly inside the current range is left as it is", () => {
    const zoomed: RangeStartAndEndDateTime | null =
      TimeRangeZoomUtil.getZoomedRange({
        startTime: new Date("2026-09-28T11:20:00.000Z"),
        endTime: new Date("2026-09-28T11:30:00.000Z"),
        currentRange: { range: TimeRange.PAST_ONE_HOUR },
      });

    expect(edges(zoomed)).toEqual([
      "2026-09-28T11:20:00.000Z",
      "2026-09-28T11:30:00.000Z",
    ]);
  });

  test("a selection that starts after the current range ends is not clamped away", () => {
    /*
     * The chart can still be showing the buckets of a window the page has
     * since left. Clamping would leave nothing to zoom into.
     */
    const zoomed: RangeStartAndEndDateTime | null =
      TimeRangeZoomUtil.getZoomedRange({
        startTime: new Date("2026-09-20T12:00:00.000Z"),
        endTime: new Date("2026-09-20T12:30:00.000Z"),
        currentRange: custom(
          "2026-09-20T09:00:00.000Z",
          "2026-09-20T11:00:00.000Z",
        ),
      });

    expect(edges(zoomed)).toEqual([
      "2026-09-20T12:00:00.000Z",
      "2026-09-20T12:30:00.000Z",
    ]);
  });

  test("each call builds a fresh range object", () => {
    const first: RangeStartAndEndDateTime | null =
      TimeRangeZoomUtil.getZoomedRange({
        startTime: new Date("2026-09-28T11:10:00.000Z"),
        endTime: new Date("2026-09-28T11:25:00.000Z"),
      });
    const second: RangeStartAndEndDateTime | null =
      TimeRangeZoomUtil.getZoomedRange({
        startTime: new Date("2026-09-28T11:10:00.000Z"),
        endTime: new Date("2026-09-28T11:25:00.000Z"),
      });

    expect(first).not.toBe(second);
    expect(TimeRangeZoomUtil.isSameRange(first, second)).toBe(true);
  });
});

describe("TimeRangeZoomUtil.isSameRange", () => {
  test("relative ranges compare by preset, whatever dates they carry", () => {
    expect(
      TimeRangeZoomUtil.isSameRange(
        { range: TimeRange.PAST_ONE_HOUR },
        {
          range: TimeRange.PAST_ONE_HOUR,
          startAndEndDate: new InBetween<Date>(
            new Date("2020-01-01T00:00:00.000Z"),
            new Date("2020-01-01T01:00:00.000Z"),
          ),
        },
      ),
    ).toBe(true);

    expect(
      TimeRangeZoomUtil.isSameRange(
        { range: TimeRange.PAST_ONE_HOUR },
        { range: TimeRange.PAST_ONE_DAY },
      ),
    ).toBe(false);
  });

  test("custom ranges compare by instant, not by object identity", () => {
    expect(
      TimeRangeZoomUtil.isSameRange(
        custom("2026-09-28T11:10:00.000Z", "2026-09-28T11:25:00.000Z"),
        custom("2026-09-28T11:10:00.000Z", "2026-09-28T11:25:00.000Z"),
      ),
    ).toBe(true);
  });

  test("a custom range restored with string dates still matches", () => {
    const restored: RangeStartAndEndDateTime = {
      range: TimeRange.CUSTOM,
      startAndEndDate: {
        startValue: "2026-09-28T11:10:00.000Z",
        endValue: "2026-09-28T11:25:00.000Z",
      } as unknown as InBetween<Date>,
    };

    expect(
      TimeRangeZoomUtil.isSameRange(
        custom("2026-09-28T11:10:00.000Z", "2026-09-28T11:25:00.000Z"),
        restored,
      ),
    ).toBe(true);
  });

  test("custom ranges with a different edge differ", () => {
    expect(
      TimeRangeZoomUtil.isSameRange(
        custom("2026-09-28T11:10:00.000Z", "2026-09-28T11:25:00.000Z"),
        custom("2026-09-28T11:10:00.000Z", "2026-09-28T11:26:00.000Z"),
      ),
    ).toBe(false);

    expect(
      TimeRangeZoomUtil.isSameRange(
        custom("2026-09-28T11:09:00.000Z", "2026-09-28T11:25:00.000Z"),
        custom("2026-09-28T11:10:00.000Z", "2026-09-28T11:25:00.000Z"),
      ),
    ).toBe(false);
  });

  test("a custom range is never the same as a relative one", () => {
    expect(
      TimeRangeZoomUtil.isSameRange(
        custom("2026-09-28T11:00:00.000Z", "2026-09-28T12:00:00.000Z"),
        { range: TimeRange.PAST_ONE_HOUR },
      ),
    ).toBe(false);
  });

  test("custom ranges without dates are not windows, so never match", () => {
    expect(
      TimeRangeZoomUtil.isSameRange(
        { range: TimeRange.CUSTOM },
        { range: TimeRange.CUSTOM },
      ),
    ).toBe(false);
  });

  test("missing ranges only match each other", () => {
    expect(TimeRangeZoomUtil.isSameRange(null, null)).toBe(true);
    expect(TimeRangeZoomUtil.isSameRange(undefined, null)).toBe(true);
    expect(
      TimeRangeZoomUtil.isSameRange(null, { range: TimeRange.PAST_ONE_HOUR }),
    ).toBe(false);
    expect(
      TimeRangeZoomUtil.isSameRange({ range: TimeRange.PAST_ONE_HOUR }, null),
    ).toBe(false);
  });
});
