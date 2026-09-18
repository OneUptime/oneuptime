import InBetween from "../../../Types/BaseDatabase/InBetween";
import RollingTime from "../../../Types/RollingTime/RollingTime";
import RollingTimeUtil from "../../../Types/RollingTime/RollingTimeUtil";

const MINUTE_MS: number = 60 * 1000;
const HOUR_MS: number = 60 * MINUTE_MS;
const DAY_MS: number = 24 * HOUR_MS;

/*
 * Expected window length (endDate - startDate) for each RollingTime value.
 *
 * Minute/hour windows use OneUptimeDate.addRemove{Minutes,Hours}, which shift
 * by an exact number of milliseconds, so a tight ±2s tolerance (for the two
 * separate getCurrentDate() calls) is enough.
 *
 * Day windows use addRemoveDays, which is calendar-aware: a window that spans
 * a daylight-saving transition is one wall-clock hour longer or shorter than
 * N*24h. Those entries therefore allow an extra ±1h of tolerance.
 *
 * Note: RollingTime.Past1Hours is intentionally "Past 1 Day" (its display
 * string), so it maps to a one-day window, not a one-hour window.
 */
const EXACT_TOLERANCE_MS: number = 2000;
const DST_TOLERANCE_MS: number = HOUR_MS + 2000;

const EXPECTED_SPAN_MS: Array<{
  rollingTime: RollingTime;
  spanMs: number;
  toleranceMs: number;
}> = [
  {
    rollingTime: RollingTime.Past1Minute,
    spanMs: MINUTE_MS,
    toleranceMs: EXACT_TOLERANCE_MS,
  },
  {
    rollingTime: RollingTime.Past5Minutes,
    spanMs: 5 * MINUTE_MS,
    toleranceMs: EXACT_TOLERANCE_MS,
  },
  {
    rollingTime: RollingTime.Past10Minutes,
    spanMs: 10 * MINUTE_MS,
    toleranceMs: EXACT_TOLERANCE_MS,
  },
  {
    rollingTime: RollingTime.Past15Minutes,
    spanMs: 15 * MINUTE_MS,
    toleranceMs: EXACT_TOLERANCE_MS,
  },
  {
    rollingTime: RollingTime.Past30Minutes,
    spanMs: 30 * MINUTE_MS,
    toleranceMs: EXACT_TOLERANCE_MS,
  },
  {
    rollingTime: RollingTime.Past1Hour,
    spanMs: HOUR_MS,
    toleranceMs: EXACT_TOLERANCE_MS,
  },
  {
    rollingTime: RollingTime.Past2Hours,
    spanMs: 2 * HOUR_MS,
    toleranceMs: EXACT_TOLERANCE_MS,
  },
  {
    rollingTime: RollingTime.Past3Hours,
    spanMs: 3 * HOUR_MS,
    toleranceMs: EXACT_TOLERANCE_MS,
  },
  {
    rollingTime: RollingTime.Past6Hours,
    spanMs: 6 * HOUR_MS,
    toleranceMs: EXACT_TOLERANCE_MS,
  },
  {
    rollingTime: RollingTime.Past12Hours,
    spanMs: 12 * HOUR_MS,
    toleranceMs: EXACT_TOLERANCE_MS,
  },
  {
    rollingTime: RollingTime.Past1Hours,
    spanMs: DAY_MS,
    toleranceMs: DST_TOLERANCE_MS,
  },
  {
    rollingTime: RollingTime.Past2Days,
    spanMs: 2 * DAY_MS,
    toleranceMs: DST_TOLERANCE_MS,
  },
  {
    rollingTime: RollingTime.Past3Days,
    spanMs: 3 * DAY_MS,
    toleranceMs: DST_TOLERANCE_MS,
  },
  {
    rollingTime: RollingTime.Past7Days,
    spanMs: 7 * DAY_MS,
    toleranceMs: DST_TOLERANCE_MS,
  },
  {
    rollingTime: RollingTime.Past14Days,
    spanMs: 14 * DAY_MS,
    toleranceMs: DST_TOLERANCE_MS,
  },
  {
    rollingTime: RollingTime.Past30Days,
    spanMs: 30 * DAY_MS,
    toleranceMs: DST_TOLERANCE_MS,
  },
  {
    rollingTime: RollingTime.Past60Days,
    spanMs: 60 * DAY_MS,
    toleranceMs: DST_TOLERANCE_MS,
  },
  {
    rollingTime: RollingTime.Past90Days,
    spanMs: 90 * DAY_MS,
    toleranceMs: DST_TOLERANCE_MS,
  },
  {
    rollingTime: RollingTime.Past180Days,
    spanMs: 180 * DAY_MS,
    toleranceMs: DST_TOLERANCE_MS,
  },
  {
    rollingTime: RollingTime.Past365Days,
    spanMs: 365 * DAY_MS,
    toleranceMs: DST_TOLERANCE_MS,
  },
];

describe("RollingTimeUtil", () => {
  describe("getDefault", () => {
    test("defaults to the past 1 minute", () => {
      expect(RollingTimeUtil.getDefault()).toBe(RollingTime.Past1Minute);
    });
  });

  describe("convertToStartAndEndDate", () => {
    test("returns an InBetween whose end is at (or after) its start", () => {
      const window: InBetween<Date> = RollingTimeUtil.convertToStartAndEndDate(
        RollingTime.Past1Hour,
      );

      expect(window).toBeInstanceOf(InBetween);
      expect(window.endValue.getTime()).toBeGreaterThanOrEqual(
        window.startValue.getTime(),
      );
    });

    test.each(EXPECTED_SPAN_MS)(
      "produces the expected window length for $rollingTime",
      ({
        rollingTime,
        spanMs,
        toleranceMs,
      }: {
        rollingTime: RollingTime;
        spanMs: number;
        toleranceMs: number;
      }) => {
        const window: InBetween<Date> =
          RollingTimeUtil.convertToStartAndEndDate(rollingTime);

        const actualSpanMs: number =
          window.endValue.getTime() - window.startValue.getTime();

        expect(actualSpanMs).toBeGreaterThanOrEqual(spanMs - toleranceMs);
        expect(actualSpanMs).toBeLessThanOrEqual(spanMs + toleranceMs);
      },
    );

    test("Past1Hours maps to a full day, not an hour (its display string is 'Past 1 Day')", () => {
      const window: InBetween<Date> = RollingTimeUtil.convertToStartAndEndDate(
        RollingTime.Past1Hours,
      );

      const actualSpanMs: number =
        window.endValue.getTime() - window.startValue.getTime();

      expect(actualSpanMs).toBeGreaterThan(HOUR_MS);
      expect(actualSpanMs).toBeGreaterThanOrEqual(DAY_MS - 2000);
    });
  });
});
