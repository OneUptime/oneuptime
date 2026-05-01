import RangeStartAndEndDateTime, {
  RangeStartAndEndDateTimeUtil,
} from "../../../Types/Time/RangeStartAndEndDateTime";
import TimeRange from "../../../Types/Time/TimeRange";
import InBetween from "../../../Types/BaseDatabase/InBetween";

describe("RangeStartAndEndDateTimeUtil.getComparisonStartAndEndDate", () => {
  test("returns the immediately preceding window for a custom range", () => {
    const start: Date = new Date("2026-05-01T10:00:00Z");
    const end: Date = new Date("2026-05-01T11:00:00Z");
    const range: RangeStartAndEndDateTime = {
      range: TimeRange.CUSTOM,
      startAndEndDate: new InBetween<Date>(start, end),
    };

    const comparison: InBetween<Date> =
      RangeStartAndEndDateTimeUtil.getComparisonStartAndEndDate(range);

    expect(comparison.startValue?.toISOString()).toEqual(
      "2026-05-01T09:00:00.000Z",
    );
    expect(comparison.endValue?.toISOString()).toEqual(
      "2026-05-01T10:00:00.000Z",
    );
  });

  test("comparison window has the same duration as the original", () => {
    const start: Date = new Date("2026-05-01T00:00:00Z");
    const end: Date = new Date("2026-05-08T00:00:00Z"); // 7 days
    const range: RangeStartAndEndDateTime = {
      range: TimeRange.CUSTOM,
      startAndEndDate: new InBetween<Date>(start, end),
    };

    const comparison: InBetween<Date> =
      RangeStartAndEndDateTimeUtil.getComparisonStartAndEndDate(range);

    const originalDuration: number = end.getTime() - start.getTime();
    const comparisonDuration: number =
      (comparison.endValue?.getTime() ?? 0) -
      (comparison.startValue?.getTime() ?? 0);

    expect(comparisonDuration).toEqual(originalDuration);
  });

  test("comparison ends exactly when the current window starts", () => {
    const start: Date = new Date("2026-05-01T10:00:00Z");
    const end: Date = new Date("2026-05-01T11:00:00Z");
    const range: RangeStartAndEndDateTime = {
      range: TimeRange.CUSTOM,
      startAndEndDate: new InBetween<Date>(start, end),
    };

    const comparison: InBetween<Date> =
      RangeStartAndEndDateTimeUtil.getComparisonStartAndEndDate(range);

    expect(comparison.endValue?.getTime()).toEqual(start.getTime());
  });

  test("works for relative ranges (PAST_ONE_HOUR)", () => {
    const range: RangeStartAndEndDateTime = {
      range: TimeRange.PAST_ONE_HOUR,
    };
    const current: InBetween<Date> =
      RangeStartAndEndDateTimeUtil.getStartAndEndDate(range);
    const comparison: InBetween<Date> =
      RangeStartAndEndDateTimeUtil.getComparisonStartAndEndDate(range);

    /*
     * Comparison window must end at the current window's start (within
     * a small tolerance — the two calls are not perfectly atomic since
     * each calls getCurrentDate() independently).
     */
    const drift: number = Math.abs(
      (comparison.endValue?.getTime() ?? 0) -
        (current.startValue?.getTime() ?? 0),
    );
    expect(drift).toBeLessThan(1000); // within 1 second

    // Both should span an hour.
    const currentDur: number =
      (current.endValue?.getTime() ?? 0) - (current.startValue?.getTime() ?? 0);
    const compDur: number =
      (comparison.endValue?.getTime() ?? 0) -
      (comparison.startValue?.getTime() ?? 0);
    expect(Math.abs(currentDur - compDur)).toBeLessThan(1000);
  });
});
