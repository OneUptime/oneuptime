import AggregationInterval from "../../../Types/BaseDatabase/AggregationInterval";
import AggregationIntervalUtil from "../../../Types/BaseDatabase/AggregationIntervalUtil";

describe("AggregationIntervalUtil", () => {
  const SECOND: number = 1000;
  const HOUR: number = SECOND * 60 * 60;
  const DAY: number = HOUR * 24;

  const windowOf: (durationMs: number) => { startDate: Date; endDate: Date } = (
    durationMs: number,
  ): { startDate: Date; endDate: Date } => {
    const startDate: Date = new Date(Date.UTC(2020, 0, 1, 0, 0, 0));
    const endDate: Date = new Date(startDate.getTime() + durationMs);
    return { startDate, endDate };
  };

  describe("getAggregationIntervalForWindow", () => {
    const cases: Array<[string, number, AggregationInterval]> = [
      ["2 hours -> Minute", 2 * HOUR, AggregationInterval.Minute],
      [
        "exactly 3 hours -> Minute (inclusive bound)",
        3 * HOUR,
        AggregationInterval.Minute,
      ],
      ["3 hours + 1ms -> Hour", 3 * HOUR + 1, AggregationInterval.Hour],
      ["1 day -> Hour", DAY, AggregationInterval.Hour],
      [
        "exactly 7 days -> Hour (inclusive bound)",
        7 * DAY,
        AggregationInterval.Hour,
      ],
      ["7 days + 1ms -> Day", 7 * DAY + 1, AggregationInterval.Day],
      ["14 days -> Day", 14 * DAY, AggregationInterval.Day],
      [
        "exactly 6 weeks -> Day (inclusive bound)",
        42 * DAY,
        AggregationInterval.Day,
      ],
      ["6 weeks + 1ms -> Week", 42 * DAY + 1, AggregationInterval.Week],
      ["60 days -> Week", 60 * DAY, AggregationInterval.Week],
      ["200 days -> Month", 200 * DAY, AggregationInterval.Month],
      ["8 years -> Year", 8 * 365 * DAY, AggregationInterval.Year],
    ];

    test.each(cases)(
      "%s",
      (_label: string, durationMs: number, expected: AggregationInterval) => {
        expect(
          AggregationIntervalUtil.getAggregationIntervalForWindow(
            windowOf(durationMs),
          ),
        ).toBe(expected);
      },
    );

    test("returns the widest interval as the window grows", () => {
      const order: Array<AggregationInterval> = [
        AggregationInterval.Minute,
        AggregationInterval.Hour,
        AggregationInterval.Day,
        AggregationInterval.Week,
        AggregationInterval.Month,
        AggregationInterval.Year,
      ];
      const durations: Array<number> = [
        HOUR,
        2 * DAY,
        30 * DAY,
        90 * DAY,
        365 * DAY,
        10 * 365 * DAY,
      ];

      const results: Array<AggregationInterval> = durations.map(
        (d: number): AggregationInterval => {
          return AggregationIntervalUtil.getAggregationIntervalForWindow(
            windowOf(d),
          );
        },
      );

      // Each larger window is at least as wide an interval as the previous.
      for (let i: number = 1; i < results.length; i++) {
        expect(order.indexOf(results[i]!)).toBeGreaterThanOrEqual(
          order.indexOf(results[i - 1]!),
        );
      }
    });
  });

  describe("getAggregationIntervalMs", () => {
    test.each([
      [AggregationInterval.Minute, 1000 * 60],
      [AggregationInterval.Hour, 1000 * 60 * 60],
      [AggregationInterval.Day, 1000 * 60 * 60 * 24],
      [AggregationInterval.Week, 1000 * 60 * 60 * 24 * 7],
      [AggregationInterval.Month, 1000 * 60 * 60 * 24 * 30],
      [AggregationInterval.Year, 1000 * 60 * 60 * 24 * 365],
    ])(
      "maps %s to its nominal width",
      (interval: AggregationInterval, expectedMs: number) => {
        expect(AggregationIntervalUtil.getAggregationIntervalMs(interval)).toBe(
          expectedMs,
        );
      },
    );

    test("intervals are strictly increasing in width", () => {
      const ordered: Array<AggregationInterval> = [
        AggregationInterval.Minute,
        AggregationInterval.Hour,
        AggregationInterval.Day,
        AggregationInterval.Week,
        AggregationInterval.Month,
        AggregationInterval.Year,
      ];

      for (let i: number = 1; i < ordered.length; i++) {
        expect(
          AggregationIntervalUtil.getAggregationIntervalMs(ordered[i]!),
        ).toBeGreaterThan(
          AggregationIntervalUtil.getAggregationIntervalMs(ordered[i - 1]!),
        );
      }
    });
  });
});
