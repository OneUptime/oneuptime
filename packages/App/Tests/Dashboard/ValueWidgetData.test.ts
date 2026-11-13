import { afterEach, describe, expect, test } from "@jest/globals";
import AggregatedModel from "Common/Types/BaseDatabase/AggregatedModel";
import AggregatedResult from "Common/Types/BaseDatabase/AggregatedResult";
import AggregationType from "Common/Types/BaseDatabase/AggregationType";
import OneUptimeDate from "Common/Types/Date";
import Timezone from "Common/Types/Timezone";
import {
  aggregateValues,
  collectDataPoints,
  getMetricValueWidgetBucketWidthMs,
  getMetricValueWidgetReduce,
  getMetricValueWidgetSeries,
  getMetricValueWidgetSparkline,
  getNumericValues,
  getResultsErrorMessage,
  isAdditiveAggregation,
} from "../../FeatureSet/Dashboard/src/Components/Dashboard/Components/ValueWidgetData";
import {
  getValueWidgetTrend,
  ValueWidgetPoint,
  ValueWidgetTrend,
  ValueWidgetTrendDirection,
} from "Common/Utils/Dashboard/ValueWidgetSeries";

/*
 * Covers the reduction behind a Value tile's single big number. The case that
 * matters most is the empty one: a metric with no points must report "nothing
 * to reduce" rather than a 0 the tile would render as a real measurement — an
 * LCP or TTFB of 0ms is physically impossible and a CLS of 0 is the best
 * possible score, so a template dashboard with no telemetry read as perfect.
 */

const TIMESTAMP: Date = new Date("2026-06-01T00:00:00.000Z");

type MakePoint = (value: unknown) => AggregatedModel;

const point: MakePoint = (value: unknown): AggregatedModel => {
  return { timestamp: TIMESTAMP, value: value as number };
};

type MakeResult = (values: Array<unknown>) => AggregatedResult;

const result: MakeResult = (values: Array<unknown>): AggregatedResult => {
  return { data: values.map(point) };
};

describe("ValueWidgetData.aggregateValues", () => {
  test("returns null when there is nothing to reduce", () => {
    for (const type of Object.values(AggregationType)) {
      expect(aggregateValues([], type)).toBeNull();
    }
  });

  test("null is distinct from a genuine measurement of zero", () => {
    expect(aggregateValues([], AggregationType.Avg)).toBeNull();
    expect(aggregateValues([0], AggregationType.Avg)).toBe(0);
    expect(aggregateValues([0, 0], AggregationType.Avg)).toBe(0);
  });

  test("Avg is the mean of the per-bucket values", () => {
    expect(aggregateValues([2, 4, 9], AggregationType.Avg)).toBe(5);
  });

  test("percentiles are averaged across buckets, not left at zero", () => {
    // Each bucket's P95 is computed server-side; the tile shows their mean.
    expect(aggregateValues([100, 200, 300], AggregationType.P50)).toBe(200);
    expect(aggregateValues([100, 200, 300], AggregationType.P90)).toBe(200);
    expect(aggregateValues([100, 200, 300], AggregationType.P95)).toBe(200);
    expect(aggregateValues([100, 200, 300], AggregationType.P99)).toBe(200);
  });

  test("Sum and Count add the per-bucket values", () => {
    expect(aggregateValues([1, 2, 3], AggregationType.Sum)).toBe(6);
    // Count sums the counts the server returned, it does not count buckets.
    expect(aggregateValues([5, 5, 5], AggregationType.Count)).toBe(15);
  });

  test("Min and Max fold over the real values, not a zero seed", () => {
    expect(aggregateValues([7, 3, 11], AggregationType.Min)).toBe(3);
    expect(aggregateValues([7, 3, 11], AggregationType.Max)).toBe(11);
  });

  test("Min of an all-positive metric is not forced to zero", () => {
    expect(aggregateValues([120, 340], AggregationType.Min)).toBe(120);
  });

  test("negative values are reduced without a zero floor or ceiling", () => {
    expect(aggregateValues([-5, -1], AggregationType.Max)).toBe(-1);
    expect(aggregateValues([-5, -1], AggregationType.Min)).toBe(-5);
    expect(aggregateValues([-4, -2], AggregationType.Avg)).toBe(-3);
  });
});

describe("ValueWidgetData.getNumericValues", () => {
  test("drops nulls arriving from a ClickHouse NULL / missing column", () => {
    expect(getNumericValues([point(1), point(null), point(3)])).toEqual([1, 3]);
  });

  test("drops NaN and infinities so they cannot poison the reduction", () => {
    expect(
      getNumericValues([
        point(Number.NaN),
        point(Number.POSITIVE_INFINITY),
        point(Number.NEGATIVE_INFINITY),
        point(2),
      ]),
    ).toEqual([2]);
  });

  test("drops non-numeric values", () => {
    expect(getNumericValues([point("12"), point(undefined), point(4)])).toEqual(
      [4],
    );
  });

  test("keeps zero — it is a real measurement", () => {
    expect(getNumericValues([point(0)])).toEqual([0]);
  });

  test("a bucket set that is entirely non-finite reduces to no data", () => {
    const values: Array<number> = getNumericValues([
      point(null),
      point(Number.NaN),
    ]);
    expect(values).toEqual([]);
    expect(aggregateValues(values, AggregationType.Avg)).toBeNull();
  });
});

describe("ValueWidgetData.collectDataPoints", () => {
  test("flattens every result's buckets in order", () => {
    expect(
      collectDataPoints([result([1, 2]), result([3])]).map(
        (item: AggregatedModel) => {
          return item.value;
        },
      ),
    ).toEqual([1, 2, 3]);
  });

  test("results present but empty yield no points", () => {
    expect(collectDataPoints([result([])])).toEqual([]);
    expect(collectDataPoints([])).toEqual([]);
  });
});

/*
 * The metric widget's series and the reduction its trend compares the two
 * halves of the time range with. The metrics API answers newest first
 * (AnalyticsDatabaseService sorts an aggregate by time, descending), and the
 * widget used to draw - and halve - the points in that order.
 */
const HOUR_MS: number = 60 * 60 * 1000;
const WEEK_START_MS: number = Date.UTC(2026, 9, 15, 10, 0, 0);

type MakeTimedPoint = (hour: number, value: unknown) => AggregatedModel;

const timedPoint: MakeTimedPoint = (
  hour: number,
  value: unknown,
): AggregatedModel => {
  return {
    timestamp: new Date(WEEK_START_MS + hour * HOUR_MS),
    value: value as number,
  };
};

// A week of hourly counts, newest first: 100 an hour, then 250 an hour.
const RISING_WEEK_NEWEST_FIRST: AggregatedResult = {
  data: Array.from({ length: 168 }, (_unused: unknown, index: number) => {
    return 167 - index;
  }).map((hour: number): AggregatedModel => {
    return timedPoint(hour, hour < 84 ? 100 : 250);
  }),
};

describe("ValueWidgetData.getMetricValueWidgetReduce", () => {
  test("reduces each half the way the big number is reduced", () => {
    const values: Array<number> = [4, 1, 7];

    for (const type of Object.values(AggregationType)) {
      expect(getMetricValueWidgetReduce(type)(values)).toBe(
        aggregateValues(values, type),
      );
      expect(getMetricValueWidgetReduce(type)([])).toBeNull();
    }
  });

  test("a sum or a count adds up; a min, a max and the rest do not", () => {
    expect(getMetricValueWidgetReduce(AggregationType.Sum)([1, 2])).toBe(3);
    expect(getMetricValueWidgetReduce(AggregationType.Count)([1, 2])).toBe(3);
    expect(getMetricValueWidgetReduce(AggregationType.Max)([1, 2])).toBe(2);
    expect(getMetricValueWidgetReduce(AggregationType.Min)([1, 2])).toBe(1);
    expect(getMetricValueWidgetReduce(AggregationType.Avg)([1, 2])).toBe(1.5);
    expect(getMetricValueWidgetReduce(AggregationType.P95)([1, 2])).toBe(1.5);
  });
});

describe("ValueWidgetData.isAdditiveAggregation", () => {
  test("only a sum and a count are compared as totals", () => {
    for (const type of Object.values(AggregationType)) {
      expect([type, isAdditiveAggregation(type)]).toEqual([
        type,
        type === AggregationType.Sum || type === AggregationType.Count,
      ]);
    }
  });
});

describe("ValueWidgetData.getMetricValueWidgetSeries", () => {
  test("draws the metrics API's newest-first buckets oldest first", () => {
    const series: Array<ValueWidgetPoint> = getMetricValueWidgetSeries(
      [RISING_WEEK_NEWEST_FIRST],
      AggregationType.Sum,
    );

    expect(series).toHaveLength(168);
    expect(series[0]!.timestamp.getTime()).toBe(WEEK_START_MS);
    expect(series[167]!.timestamp.getTime()).toBe(
      WEEK_START_MS + 167 * HOUR_MS,
    );
    expect(series[0]!.value).toBe(100);
    expect(series[167]!.value).toBe(250);
  });

  test("one point per bucket for a grouped query, combined as the number is", () => {
    const grouped: AggregatedResult = {
      data: [
        timedPoint(1, 10),
        timedPoint(0, 1),
        timedPoint(1, 20),
        timedPoint(0, 3),
      ],
    };

    expect(
      getMetricValueWidgetSeries([grouped], AggregationType.Sum).map(
        (entry: ValueWidgetPoint): number => {
          return entry.value;
        },
      ),
    ).toEqual([4, 30]);
    expect(
      getMetricValueWidgetSeries([grouped], AggregationType.Avg).map(
        (entry: ValueWidgetPoint): number => {
          return entry.value;
        },
      ),
    ).toEqual([2, 15]);
    expect(
      getMetricValueWidgetSeries([grouped], AggregationType.Max).map(
        (entry: ValueWidgetPoint): number => {
          return entry.value;
        },
      ),
    ).toEqual([3, 20]);
  });

  test("leaves out a bucket with no number, and reads ISO timestamps", () => {
    const series: Array<ValueWidgetPoint> = getMetricValueWidgetSeries(
      [
        {
          data: [
            {
              timestamp: "2026-10-15T12:00:00.000Z" as unknown as Date,
              value: 3,
            },
            timedPoint(1, null),
            timedPoint(0, 1),
          ],
        },
      ],
      AggregationType.Avg,
    );

    expect(
      series.map((entry: ValueWidgetPoint): [number, number] => {
        return [entry.timestamp.getTime(), entry.value];
      }),
    ).toEqual([
      [WEEK_START_MS, 1],
      [WEEK_START_MS + 2 * HOUR_MS, 3],
    ]);
  });

  test("the reported week's trend points up, by the percentage of the older half it rose", () => {
    const trend: ValueWidgetTrend | null = getValueWidgetTrend({
      points: getMetricValueWidgetSeries(
        [RISING_WEEK_NEWEST_FIRST],
        AggregationType.Sum,
      ),
      reduce: getMetricValueWidgetReduce(AggregationType.Sum),
      isAdditive: isAdditiveAggregation(AggregationType.Sum),
      windowStart: new Date(WEEK_START_MS),
      windowEnd: new Date(WEEK_START_MS + 168 * HOUR_MS),
      bucketWidthMs: HOUR_MS,
    });

    expect(trend?.direction).toBe(ValueWidgetTrendDirection.Up);
    expect(trend?.percent).toBe(150);
    expect(trend?.firstHalfValue).toBe(8400);
    expect(trend?.secondHalfValue).toBe(21000);
  });
});

describe("ValueWidgetData.getResultsErrorMessage", () => {
  test("surfaces the first reason a result carries", () => {
    const results: Array<AggregatedResult> = [
      result([]),
      { data: [], errorMessage: "Unknown variable in formula" },
      { data: [], errorMessage: "Second reason" },
    ];
    expect(getResultsErrorMessage(results)).toBe("Unknown variable in formula");
  });

  test("undefined when no result explains itself", () => {
    expect(getResultsErrorMessage([result([1])])).toBeUndefined();
    expect(getResultsErrorMessage([])).toBeUndefined();
  });
});

/*
 * What the metric Value widget's sparkline draws: for a sum or a count, the
 * empty buckets between its readings at 0, on the grid the metrics API
 * buckets the range at. A sparse count drawn through only the buckets it had
 * read flat while its arrow said it rose.
 */
describe("ValueWidgetData.getMetricValueWidgetSparkline", () => {
  const HOUR_MS: number = 60 * 60 * 1000;
  const WEEK_START: Date = new Date("2026-10-15T10:00:00.000Z");
  const WEEK: { startDate: Date; endDate: Date } = {
    startDate: WEEK_START,
    endDate: new Date(WEEK_START.getTime() + 168 * HOUR_MS),
  };

  const atHour: (hour: number, value: number) => AggregatedModel = (
    hour: number,
    value: number,
  ): AggregatedModel => {
    return {
      timestamp: new Date(WEEK_START.getTime() + hour * HOUR_MS),
      value: value,
    };
  };

  // Deploys, now and then, answered newest first as the metrics API does.
  const SPARSE: Array<AggregatedResult> = [
    { data: [atHour(160, 12), atHour(100, 12), atHour(40, 4), atHour(10, 4)] },
  ];

  test("a week is bucketed by the hour, as the server buckets it", () => {
    expect(getMetricValueWidgetBucketWidthMs(WEEK)).toBe(HOUR_MS);
  });

  test("a sum and a count draw their empty hours between readings at 0", () => {
    for (const type of [AggregationType.Sum, AggregationType.Count]) {
      const line: Array<ValueWidgetPoint> = getMetricValueWidgetSparkline({
        results: SPARSE,
        aggregationType: type,
        window: WEEK,
      });

      expect(line).toHaveLength(151);
      expect(line[0]!.value).toBe(4);
      expect(line[1]!.value).toBe(0);
      expect(line[150]!.value).toBe(12);
      expect(
        line.filter((point: ValueWidgetPoint): boolean => {
          return point.value !== 0;
        }),
      ).toHaveLength(4);
    }
  });

  test("an average, a percentile, a min or a max keeps its gaps", () => {
    for (const type of [
      AggregationType.Avg,
      AggregationType.Min,
      AggregationType.Max,
    ]) {
      expect(
        getMetricValueWidgetSparkline({
          results: SPARSE,
          aggregationType: type,
          window: WEEK,
        }),
      ).toEqual(getMetricValueWidgetSeries(SPARSE, type));
    }
  });

  test("before the results know their window, the series is drawn as it came", () => {
    expect(
      getMetricValueWidgetSparkline({
        results: SPARSE,
        aggregationType: AggregationType.Sum,
        window: null,
      }),
    ).toEqual(getMetricValueWidgetSeries(SPARSE, AggregationType.Sum));
  });

  test("no data stays no data: never a line of zeros", () => {
    expect(
      getMetricValueWidgetSparkline({
        results: [{ data: [] }],
        aggregationType: AggregationType.Count,
        window: WEEK,
      }),
    ).toEqual([]);
  });

  test("the arrow still compares the readings: the zeros change neither half", () => {
    const reduce: (values: Array<number>) => number | null =
      getMetricValueWidgetReduce(AggregationType.Sum);
    const trend: ValueWidgetTrend | null = getValueWidgetTrend({
      points: getMetricValueWidgetSparkline({
        results: SPARSE,
        aggregationType: AggregationType.Sum,
        window: WEEK,
      }),
      reduce: reduce,
      isAdditive: true,
      windowStart: WEEK.startDate,
      windowEnd: WEEK.endDate,
      bucketWidthMs: HOUR_MS,
    });

    // The halves' totals, 8 then 24, as with the readings alone.
    expect(trend?.direction).toBe(ValueWidgetTrendDirection.Up);
    expect(trend?.percent).toBe(200);
  });
});

/*
 * Day and week buckets start at the reader's midnight, in the zone the
 * request carries (issue #7277), and a day the clocks change on is 23 or 25
 * hours long there. The empty buckets a sum or a count is drawn through are
 * the reader's days and weeks, not steps of 24 hours from the first
 * reading: those left the grid at the first change of the clocks, and the
 * line went back to its readings alone.
 */
describe("ValueWidgetData.getMetricValueWidgetSparkline over days and weeks in the reader's zone", () => {
  const DAY_MS: number = 24 * 60 * 60 * 1000;

  afterEach(() => {
    OneUptimeDate.setUserTimezone(null);
  });

  // The calendar days from `first` to `last`, as "2026-03-08".
  const daysFrom: (first: string, last: string) => Array<string> = (
    first: string,
    last: string,
  ): Array<string> => {
    const days: Array<string> = [];

    for (
      let day: number = Date.parse(`${first}T00:00:00.000Z`);
      day <= Date.parse(`${last}T00:00:00.000Z`);
      day += DAY_MS
    ) {
      days.push(new Date(day).toISOString().slice(0, 10));
    }

    return days;
  };

  // New York's midnight: 05:00 UTC in winter, 04:00 UTC from 8 March 2026.
  const newYorkMidnight: (day: string) => string = (day: string): string => {
    return day <= "2026-03-08"
      ? `${day}T05:00:00.000Z`
      : `${day}T04:00:00.000Z`;
  };

  const timesOf: (line: Array<ValueWidgetPoint>) => Array<string> = (
    line: Array<ValueWidgetPoint>,
  ): Array<string> => {
    return line.map((point: ValueWidgetPoint): string => {
      return point.timestamp.toISOString();
    });
  };

  const valuesOf: (line: Array<ValueWidgetPoint>) => Array<number> = (
    line: Array<ValueWidgetPoint>,
  ): Array<number> => {
    return line.map((point: ValueWidgetPoint): number => {
      return point.value;
    });
  };

  // 20 February to 22 March 2026 there: a month, bucketed by the day.
  const MONTH: { startDate: Date; endDate: Date } = {
    startDate: new Date("2026-02-20T05:00:00.000Z"),
    endDate: new Date("2026-03-22T04:00:00.000Z"),
  };

  test("a month is bucketed by the day, and a quarter by the week", () => {
    expect(getMetricValueWidgetBucketWidthMs(MONTH)).toBe(DAY_MS);
    expect(
      getMetricValueWidgetBucketWidthMs({
        startDate: new Date("2026-01-01T05:00:00.000Z"),
        endDate: new Date("2026-04-01T04:00:00.000Z"),
      }),
    ).toBe(7 * DAY_MS);
  });

  test("read in New York, a count's empty days between two readings are each drawn at 0, from each midnight there, across the 23-hour 8 March", () => {
    OneUptimeDate.setUserTimezone(Timezone.AmericaNew_York);

    for (const type of [AggregationType.Count, AggregationType.Sum]) {
      const line: Array<ValueWidgetPoint> = getMetricValueWidgetSparkline({
        // Newest first, as the metrics API answers.
        results: [
          {
            data: [
              { timestamp: new Date(newYorkMidnight("2026-03-12")), value: 9 },
              { timestamp: new Date(newYorkMidnight("2026-02-24")), value: 4 },
            ],
          },
        ],
        aggregationType: type,
        window: MONTH,
      });
      const days: Array<string> = daysFrom("2026-02-24", "2026-03-12");

      expect(days).toHaveLength(17);
      expect(timesOf(line)).toEqual(days.map(newYorkMidnight));
      expect(valuesOf(line)).toEqual([
        4,
        ...days.slice(2).map((): number => {
          return 0;
        }),
        9,
      ]);
    }
  });

  test("read in New York, a count's empty weeks between two readings are each drawn at 0, from each Monday's midnight there", () => {
    OneUptimeDate.setUserTimezone(Timezone.AmericaNew_York);

    const line: Array<ValueWidgetPoint> = getMetricValueWidgetSparkline({
      results: [
        {
          data: [
            { timestamp: new Date(newYorkMidnight("2026-03-16")), value: 5 },
            { timestamp: new Date(newYorkMidnight("2026-02-02")), value: 3 },
          ],
        },
      ],
      aggregationType: AggregationType.Count,
      window: {
        startDate: new Date("2026-01-01T05:00:00.000Z"),
        endDate: new Date("2026-04-01T04:00:00.000Z"),
      },
    });

    expect(timesOf(line)).toEqual(
      [
        "2026-02-02",
        "2026-02-09",
        "2026-02-16",
        "2026-02-23",
        "2026-03-02",
        "2026-03-09",
        "2026-03-16",
      ].map(newYorkMidnight),
    );
    expect(valuesOf(line)).toEqual([3, 0, 0, 0, 0, 0, 5]);
  });

  test("read in UTC, the same month's readings at midnight UTC fill UTC's days", () => {
    OneUptimeDate.setUserTimezone(Timezone.UTC);

    const line: Array<ValueWidgetPoint> = getMetricValueWidgetSparkline({
      results: [
        {
          data: [
            { timestamp: new Date("2026-03-12T00:00:00.000Z"), value: 9 },
            { timestamp: new Date("2026-02-24T00:00:00.000Z"), value: 4 },
          ],
        },
      ],
      aggregationType: AggregationType.Count,
      window: {
        startDate: new Date("2026-02-20T00:00:00.000Z"),
        endDate: new Date("2026-03-22T00:00:00.000Z"),
      },
    });

    expect(timesOf(line)).toEqual(
      daysFrom("2026-02-24", "2026-03-12").map((day: string): string => {
        return `${day}T00:00:00.000Z`;
      }),
    );
    expect(line[0]!.value).toBe(4);
    expect(line[16]!.value).toBe(9);
  });

  test("read in New York, an average over the same days keeps its gaps", () => {
    OneUptimeDate.setUserTimezone(Timezone.AmericaNew_York);

    const results: Array<AggregatedResult> = [
      {
        data: [
          { timestamp: new Date(newYorkMidnight("2026-03-12")), value: 9 },
          { timestamp: new Date(newYorkMidnight("2026-02-24")), value: 4 },
        ],
      },
    ];

    expect(
      getMetricValueWidgetSparkline({
        results: results,
        aggregationType: AggregationType.Avg,
        window: MONTH,
      }),
    ).toEqual(getMetricValueWidgetSeries(results, AggregationType.Avg));
  });
});
