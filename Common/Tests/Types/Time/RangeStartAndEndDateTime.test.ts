import InBetween from "../../../Types/BaseDatabase/InBetween";
import OneUptimeDate from "../../../Types/Date";
import { RangeStartAndEndDateTimeUtil } from "../../../Types/Time/RangeStartAndEndDateTime";
import TimeRange from "../../../Types/Time/TimeRange";
import { describe, expect, test } from "@jest/globals";

/*
 * RangeStartAndEndDateTimeUtil turns a relative TimeRange (last 5 mins, last
 * hour, ...) into a concrete [start, end] window ending "now". Because both
 * bounds are captured from the same `now`, the window's *width* is
 * deterministic even though its absolute position moves — so these tests assert
 * the exact width for the fixed-duration ranges without freezing the clock, and
 * a sane ordering/magnitude for the calendar-variable month ranges.
 */

function widthMs(range: TimeRange): number {
  const between: InBetween<Date> =
    RangeStartAndEndDateTimeUtil.getStartAndEndDate({ range });
  return between.endValue.getTime() - between.startValue.getTime();
}

const MIN: number = 60 * 1000;
const HOUR: number = 60 * MIN;
const DAY: number = 24 * HOUR;

describe("RangeStartAndEndDateTimeUtil.getStartAndEndDate - fixed durations", () => {
  const cases: Array<[TimeRange, number]> = [
    [TimeRange.PAST_FIVE_MINS, 5 * MIN],
    [TimeRange.PAST_FIFTEEN_MINS, 15 * MIN],
    [TimeRange.PAST_THIRTY_MINS, 30 * MIN],
    [TimeRange.PAST_ONE_HOUR, HOUR],
    [TimeRange.PAST_TWO_HOURS, 2 * HOUR],
    [TimeRange.PAST_THREE_HOURS, 3 * HOUR],
    [TimeRange.PAST_ONE_DAY, DAY],
    [TimeRange.PAST_TWO_DAYS, 2 * DAY],
    [TimeRange.PAST_ONE_WEEK, 7 * DAY],
    [TimeRange.PAST_TWO_WEEKS, 14 * DAY],
  ];

  for (const [range, expectedWidth] of cases) {
    test(`${range} spans exactly ${expectedWidth / MIN} minutes`, () => {
      // Allow a tiny tolerance for the two now() reads inside the util.
      expect(Math.abs(widthMs(range) - expectedWidth)).toBeLessThan(2000);
    });
  }

  test("end bound is at (or a hair before) now, start is earlier", () => {
    const between: InBetween<Date> =
      RangeStartAndEndDateTimeUtil.getStartAndEndDate({
        range: TimeRange.PAST_ONE_HOUR,
      });
    expect(between.startValue.getTime()).toBeLessThan(
      between.endValue.getTime(),
    );
    expect(between.endValue.getTime()).toBeLessThanOrEqual(Date.now() + 2000);
  });
});

describe("RangeStartAndEndDateTimeUtil.getStartAndEndDate - calendar ranges", () => {
  test("one month is between 27 and 32 days wide", () => {
    const width: number = widthMs(TimeRange.PAST_ONE_MONTH);
    expect(width).toBeGreaterThan(27 * DAY);
    expect(width).toBeLessThan(32 * DAY);
  });

  test("three months is wider than one month", () => {
    expect(widthMs(TimeRange.PAST_THREE_MONTHS)).toBeGreaterThan(
      widthMs(TimeRange.PAST_ONE_MONTH),
    );
  });
});

describe("RangeStartAndEndDateTimeUtil.getStartAndEndDate - custom", () => {
  test("returns the caller-supplied window for CUSTOM", () => {
    const start: Date = OneUptimeDate.fromString("2026-01-01T00:00:00.000Z");
    const end: Date = OneUptimeDate.fromString("2026-01-02T00:00:00.000Z");
    const custom: InBetween<Date> = new InBetween<Date>(start, end);

    const result: InBetween<Date> =
      RangeStartAndEndDateTimeUtil.getStartAndEndDate({
        range: TimeRange.CUSTOM,
        startAndEndDate: custom,
      });

    expect(result).toBe(custom);
  });

  test("falls back to a zero-width now window when CUSTOM has no dates", () => {
    const result: InBetween<Date> =
      RangeStartAndEndDateTimeUtil.getStartAndEndDate({
        range: TimeRange.CUSTOM,
      });
    // start === end within tolerance -> effectively zero width.
    expect(
      Math.abs(result.endValue.getTime() - result.startValue.getTime()),
    ).toBeLessThan(2000);
  });
});
