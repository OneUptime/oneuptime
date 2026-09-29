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
      [
        "3 hours + 1ms -> FiveMinutes",
        3 * HOUR + 1,
        AggregationInterval.FiveMinutes,
      ],
      ["4 hours -> FiveMinutes", 4 * HOUR, AggregationInterval.FiveMinutes],
      [
        "exactly 12 hours -> FiveMinutes (inclusive bound)",
        12 * HOUR,
        AggregationInterval.FiveMinutes,
      ],
      [
        "12 hours + 1ms -> FifteenMinutes",
        12 * HOUR + 1,
        AggregationInterval.FifteenMinutes,
      ],
      [
        "18 hours -> FifteenMinutes",
        18 * HOUR,
        AggregationInterval.FifteenMinutes,
      ],
      [
        "exactly 24 hours -> FifteenMinutes (inclusive bound)",
        24 * HOUR,
        AggregationInterval.FifteenMinutes,
      ],
      [
        "24 hours + 1ms -> ThirtyMinutes",
        24 * HOUR + 1,
        AggregationInterval.ThirtyMinutes,
      ],
      ["2 days -> ThirtyMinutes", 2 * DAY, AggregationInterval.ThirtyMinutes],
      [
        "exactly 3 days -> ThirtyMinutes (inclusive bound)",
        3 * DAY,
        AggregationInterval.ThirtyMinutes,
      ],
      ["3 days + 1ms -> Hour", 3 * DAY + 1, AggregationInterval.Hour],
      ["5 days -> Hour", 5 * DAY, AggregationInterval.Hour],
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

    test("an explicit override wins over the window-derived interval", () => {
      // A 2-hour window derives Minute, but the override pins Day.
      expect(
        AggregationIntervalUtil.getAggregationIntervalForWindow({
          ...windowOf(2 * HOUR),
          aggregationInterval: AggregationInterval.Day,
        }),
      ).toBe(AggregationInterval.Day);
    });

    test("the Total override is returned verbatim (whole-window bucketing)", () => {
      expect(
        AggregationIntervalUtil.getAggregationIntervalForWindow({
          ...windowOf(14 * DAY),
          aggregationInterval: AggregationInterval.Total,
        }),
      ).toBe(AggregationInterval.Total);
    });

    test("an invalid override falls through to the window-derived interval", () => {
      expect(
        AggregationIntervalUtil.getAggregationIntervalForWindow({
          ...windowOf(2 * HOUR),
          aggregationInterval: "NotAnInterval" as AggregationInterval,
        }),
      ).toBe(AggregationInterval.Minute);
    });

    test("returns the widest interval as the window grows", () => {
      const order: Array<AggregationInterval> = [
        AggregationInterval.Minute,
        AggregationInterval.FiveMinutes,
        AggregationInterval.FifteenMinutes,
        AggregationInterval.ThirtyMinutes,
        AggregationInterval.Hour,
        AggregationInterval.Day,
        AggregationInterval.Week,
        AggregationInterval.Month,
        AggregationInterval.Year,
      ];
      const durations: Array<number> = [
        HOUR,
        6 * HOUR,
        18 * HOUR,
        2 * DAY,
        5 * DAY,
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
      [AggregationInterval.FiveMinutes, 1000 * 60 * 5],
      [AggregationInterval.FifteenMinutes, 1000 * 60 * 15],
      [AggregationInterval.ThirtyMinutes, 1000 * 60 * 30],
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

    test("Total has no fixed width, so it maps to a very large sentinel > Year", () => {
      expect(
        AggregationIntervalUtil.getAggregationIntervalMs(
          AggregationInterval.Total,
        ),
      ).toBeGreaterThan(
        AggregationIntervalUtil.getAggregationIntervalMs(
          AggregationInterval.Year,
        ),
      );
    });

    test("intervals are strictly increasing in width", () => {
      const ordered: Array<AggregationInterval> = [
        AggregationInterval.Minute,
        AggregationInterval.FiveMinutes,
        AggregationInterval.FifteenMinutes,
        AggregationInterval.ThirtyMinutes,
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

  describe("floorDateToIntervalGrid", () => {
    // 2020-01-01T00:00:00Z is on every sub-day epoch grid.
    const gridOrigin: number = Date.UTC(2020, 0, 1, 0, 0, 0);

    test.each([
      // [interval, offset into the bucket, expected floored offset]
      [AggregationInterval.Minute, 37 * 1000, 0],
      [AggregationInterval.FiveMinutes, 4 * 60 * 1000 + 12 * 1000, 0],
      [
        AggregationInterval.FiveMinutes,
        7 * 60 * 1000, // 00:07 floors to 00:05
        5 * 60 * 1000,
      ],
      [
        AggregationInterval.FifteenMinutes,
        22 * 60 * 1000, // 00:22 floors to 00:15
        15 * 60 * 1000,
      ],
      [
        AggregationInterval.ThirtyMinutes,
        44 * 60 * 1000, // 00:44 floors to 00:30
        30 * 60 * 1000,
      ],
      [AggregationInterval.Hour, 59 * 60 * 1000, 0],
    ])(
      "floors %s timestamps down to the bucket boundary",
      (
        interval: AggregationInterval,
        offsetMs: number,
        expectedOffsetMs: number,
      ) => {
        const floored: Date = AggregationIntervalUtil.floorDateToIntervalGrid(
          new Date(gridOrigin + offsetMs),
          interval,
        );
        expect(floored.getTime()).toBe(gridOrigin + expectedOffsetMs);
      },
    );

    test("a timestamp already on the 15-minute grid is unchanged", () => {
      const onGrid: Date = new Date(gridOrigin + 45 * 60 * 1000);
      expect(
        AggregationIntervalUtil.floorDateToIntervalGrid(
          onGrid,
          AggregationInterval.FifteenMinutes,
        ).getTime(),
      ).toBe(onGrid.getTime());
    });

    test("calendar intervals (Week) are returned unchanged", () => {
      const midWeek: Date = new Date(gridOrigin + 3 * 24 * 60 * 60 * 1000);
      expect(
        AggregationIntervalUtil.floorDateToIntervalGrid(
          midWeek,
          AggregationInterval.Week,
        ).getTime(),
      ).toBe(midWeek.getTime());
    });
  });
});
