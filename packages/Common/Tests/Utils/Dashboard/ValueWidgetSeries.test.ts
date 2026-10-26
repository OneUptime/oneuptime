import { describe, expect, test } from "@jest/globals";
import {
  fillValueWidgetSeriesGaps,
  getMeanOfValues,
  getValueWidgetBucketWidthMs,
  getValueWidgetPointTime,
  getValueWidgetSeries,
  getValueWidgetTrend,
  ValueWidgetPoint,
  ValueWidgetPointInput,
  ValueWidgetReduce,
  ValueWidgetTrend,
  ValueWidgetTrendDirection,
  VALUE_WIDGET_FLAT_TREND_PERCENT,
  VALUE_WIDGET_MAX_FILLED_POINTS,
} from "../../../Utils/Dashboard/ValueWidgetSeries";
import {
  SeededRandom,
  seededRandom,
  shuffled,
} from "../../Helpers/SeededRandom";

/*
 * The Value widget's sparkline and trend arrow, worked out from points in
 * whatever order they arrive.
 *
 * The bug this guards against: OneUptime's metrics API answers an aggregate
 * NEWEST bucket first, and the widget drew the points in that order and
 * split them into halves by position. Its sparkline ran from the newest point
 * on the left to the oldest on the right, and its arrow compared the older
 * half with the newer one: up became down, and the percentage was of the
 * wrong half. Every test below that hands the points over newest first,
 * oldest first and shuffled expects the same answer from all three.
 */

const MINUTE_MS: number = 60 * 1000;
const HOUR_MS: number = 60 * MINUTE_MS;
const DAY_MS: number = 24 * HOUR_MS;

// Thursday 15 October 2026, 10:00 UTC: a week's window that starts on the hour.
const WEEK_START_MS: number = Date.UTC(2026, 9, 15, 10, 0, 0);
const WEEK_END_MS: number = WEEK_START_MS + 7 * DAY_MS;

const sum: ValueWidgetReduce = (values: Array<number>): number | null => {
  if (values.length === 0) {
    return null;
  }

  return values.reduce((total: number, value: number): number => {
    return total + value;
  }, 0);
};

const min: ValueWidgetReduce = (values: Array<number>): number | null => {
  return values.length === 0 ? null : Math.min(...values);
};

const max: ValueWidgetReduce = (values: Array<number>): number | null => {
  return values.length === 0 ? null : Math.max(...values);
};

const first: ValueWidgetReduce = (values: Array<number>): number | null => {
  return values.length === 0 ? null : values[0]!;
};

const last: ValueWidgetReduce = (values: Array<number>): number | null => {
  return values.length === 0 ? null : values[values.length - 1]!;
};

const point: (timeMs: number, value: unknown) => ValueWidgetPointInput = (
  timeMs: number,
  value: unknown,
): ValueWidgetPointInput => {
  return { timestamp: new Date(timeMs), value: value };
};

/*
 * One point per hour of the window, oldest first, valued by `valueAt` (the
 * bucket's index from the start of the window).
 */
const hourly: (data: {
  startMs: number;
  hours: number;
  valueAt: (index: number) => number;
}) => Array<ValueWidgetPointInput> = (data: {
  startMs: number;
  hours: number;
  valueAt: (index: number) => number;
}): Array<ValueWidgetPointInput> => {
  const points: Array<ValueWidgetPointInput> = [];

  for (let index: number = 0; index < data.hours; index++) {
    points.push(point(data.startMs + index * HOUR_MS, data.valueAt(index)));
  }

  return points;
};

const newestFirst: (
  points: Array<ValueWidgetPointInput>,
) => Array<ValueWidgetPointInput> = (
  points: Array<ValueWidgetPointInput>,
): Array<ValueWidgetPointInput> => {
  return points.slice().reverse();
};

const timesOf: (series: Array<ValueWidgetPoint>) => Array<number> = (
  series: Array<ValueWidgetPoint>,
): Array<number> => {
  return series.map((entry: ValueWidgetPoint): number => {
    return entry.timestamp.getTime();
  });
};

const valuesOf: (series: Array<ValueWidgetPoint>) => Array<number> = (
  series: Array<ValueWidgetPoint>,
): Array<number> => {
  return series.map((entry: ValueWidgetPoint): number => {
    return entry.value;
  });
};

/*
 * The week of hourly counts the report described: a log recording rule's
 * count, 100 an hour for the first half of the week and 250 an hour for the
 * second. A line chart of it climbs; the old widget drew it falling and
 * printed "↓ 60%".
 */
const RISING_WEEK: Array<ValueWidgetPointInput> = hourly({
  startMs: WEEK_START_MS,
  hours: 168,
  valueAt: (index: number): number => {
    return index < 84 ? 100 : 250;
  },
});

const weekTrend: (
  points: Array<ValueWidgetPointInput>,
  reduce: ValueWidgetReduce,
  isAdditive: boolean,
) => ValueWidgetTrend | null = (
  points: Array<ValueWidgetPointInput>,
  reduce: ValueWidgetReduce,
  isAdditive: boolean,
): ValueWidgetTrend | null => {
  return getValueWidgetTrend({
    points: points,
    reduce: reduce,
    isAdditive: isAdditive,
    windowStart: new Date(WEEK_START_MS),
    windowEnd: new Date(WEEK_END_MS),
    bucketWidthMs: HOUR_MS,
  });
};

describe("getMeanOfValues", () => {
  test("is null for no values, never a 0 that reads as a measurement", () => {
    expect(getMeanOfValues([])).toBeNull();
  });

  test("is the mean of the values", () => {
    expect(getMeanOfValues([2, 4, 9])).toBe(5);
    expect(getMeanOfValues([-4, -2])).toBe(-3);
    expect(getMeanOfValues([0])).toBe(0);
  });
});

describe("getValueWidgetPointTime", () => {
  test("reads a Date, an ISO string and epoch milliseconds alike", () => {
    const timeMs: number = Date.UTC(2026, 9, 18, 22, 0, 0);

    expect(getValueWidgetPointTime(new Date(timeMs))).toBe(timeMs);
    expect(getValueWidgetPointTime(new Date(timeMs).toISOString())).toBe(
      timeMs,
    );
    expect(getValueWidgetPointTime(timeMs)).toBe(timeMs);
  });

  test("reads a date that was never deserialized: { _type, value }", () => {
    const timeMs: number = Date.UTC(2026, 9, 18, 22, 0, 0);

    expect(
      getValueWidgetPointTime({
        _type: "DateTime",
        value: new Date(timeMs).toISOString(),
      }),
    ).toBe(timeMs);
  });

  test("is NaN for anything that is not a time", () => {
    for (const timestamp of [
      undefined,
      null,
      "",
      "not a date",
      new Date("not a date"),
      {},
      { value: 12 },
      true,
      [],
    ]) {
      expect(Number.isNaN(getValueWidgetPointTime(timestamp))).toBe(true);
    }
  });
});

describe("getValueWidgetSeries: oldest first, whatever order it came in", () => {
  test("newest-first buckets, as the metrics API answers, come out oldest first", () => {
    const series: Array<ValueWidgetPoint> = getValueWidgetSeries(
      newestFirst(RISING_WEEK),
    );

    expect(series).toHaveLength(168);
    expect(series[0]!.timestamp.getTime()).toBe(WEEK_START_MS);
    expect(series[167]!.timestamp.getTime()).toBe(
      WEEK_START_MS + 167 * HOUR_MS,
    );
    expect(series[0]!.value).toBe(100);
    expect(series[167]!.value).toBe(250);

    const times: Array<number> = timesOf(series);
    for (let index: number = 1; index < times.length; index++) {
      expect(times[index]!).toBeGreaterThan(times[index - 1]!);
    }
  });

  test("oldest-first buckets are left as they are", () => {
    expect(timesOf(getValueWidgetSeries(RISING_WEEK))).toEqual(
      RISING_WEEK.map((entry: ValueWidgetPointInput): number => {
        return (entry.timestamp as Date).getTime();
      }),
    );
  });

  test("any shuffle of the buckets draws the same line", () => {
    const expected: Array<ValueWidgetPoint> = getValueWidgetSeries(RISING_WEEK);
    const random: SeededRandom = seededRandom(5170);

    for (let round: number = 0; round < 25; round++) {
      expect(getValueWidgetSeries(shuffled(RISING_WEEK, random))).toEqual(
        expected,
      );
    }
  });

  test("reads ISO strings and { _type, value } dates off an API answer", () => {
    const series: Array<ValueWidgetPoint> = getValueWidgetSeries([
      { timestamp: "2026-10-15T12:00:00.000Z", value: 3 },
      {
        timestamp: { _type: "DateTime", value: "2026-10-15T10:00:00.000Z" },
        value: 1,
      },
      { timestamp: Date.UTC(2026, 9, 15, 11, 0, 0), value: 2 },
    ]);

    expect(valuesOf(series)).toEqual([1, 2, 3]);
    expect(series[0]!.timestamp).toBeInstanceOf(Date);
  });

  test("leaves out a bucket with no number in it, rather than drawing NaN", () => {
    const series: Array<ValueWidgetPoint> = getValueWidgetSeries([
      point(WEEK_START_MS, 1),
      point(WEEK_START_MS + HOUR_MS, null),
      point(WEEK_START_MS + 2 * HOUR_MS, Number.NaN),
      point(WEEK_START_MS + 3 * HOUR_MS, Number.POSITIVE_INFINITY),
      point(WEEK_START_MS + 4 * HOUR_MS, "7"),
      point(WEEK_START_MS + 5 * HOUR_MS, undefined),
      { timestamp: "not a date", value: 9 },
      { value: 9 },
      point(WEEK_START_MS + 6 * HOUR_MS, 0),
      point(WEEK_START_MS + 7 * HOUR_MS, -2.5),
    ]);

    expect(valuesOf(series)).toEqual([1, 0, -2.5]);
  });

  test("a query grouped by an attribute draws one point per bucket, combined by the widget's reduction", () => {
    const grouped: Array<ValueWidgetPointInput> = [
      point(WEEK_START_MS + HOUR_MS, 20),
      point(WEEK_START_MS, 1),
      point(WEEK_START_MS + HOUR_MS, 10),
      point(WEEK_START_MS, 2),
      point(WEEK_START_MS, 3),
      point(WEEK_START_MS + HOUR_MS, 30),
    ];

    expect(valuesOf(getValueWidgetSeries(grouped, sum))).toEqual([6, 60]);
    expect(valuesOf(getValueWidgetSeries(grouped, max))).toEqual([3, 30]);
    expect(valuesOf(getValueWidgetSeries(grouped, min))).toEqual([1, 10]);
    // No reduction given: the mean.
    expect(valuesOf(getValueWidgetSeries(grouped))).toEqual([2, 20]);
    expect(timesOf(getValueWidgetSeries(grouped))).toEqual([
      WEEK_START_MS,
      WEEK_START_MS + HOUR_MS,
    ]);
  });

  test("points tied on time keep the order they came in, so First and Last stay what they were", () => {
    const tied: Array<ValueWidgetPointInput> = [
      point(WEEK_START_MS, 5),
      point(WEEK_START_MS, 7),
      point(WEEK_START_MS, 9),
    ];

    expect(valuesOf(getValueWidgetSeries(tied, first))).toEqual([5]);
    expect(valuesOf(getValueWidgetSeries(tied, last))).toEqual([9]);
  });

  test("a combination that comes to nothing is left out", () => {
    const nothing: ValueWidgetReduce = (): number | null => {
      return null;
    };

    expect(
      getValueWidgetSeries(
        [point(WEEK_START_MS, 1), point(WEEK_START_MS, 2)],
        nothing,
      ),
    ).toEqual([]);
  });

  test("no points, or none usable, is an empty line", () => {
    expect(getValueWidgetSeries([])).toEqual([]);
    expect(getValueWidgetSeries([point(WEEK_START_MS, null)])).toEqual([]);
  });

  test("never reorders the array it was handed", () => {
    const handed: Array<ValueWidgetPointInput> = newestFirst(RISING_WEEK);
    const before: Array<ValueWidgetPointInput> = handed.slice();

    getValueWidgetSeries(handed);

    expect(handed).toEqual(before);
  });
});

describe("getValueWidgetBucketWidthMs", () => {
  test("is the smallest gap between neighbouring points: the bucket interval", () => {
    expect(getValueWidgetBucketWidthMs(getValueWidgetSeries(RISING_WEEK))).toBe(
      HOUR_MS,
    );
  });

  test("a missing bucket only widens one gap, never the answer", () => {
    expect(
      getValueWidgetBucketWidthMs(
        getValueWidgetSeries([
          point(WEEK_START_MS, 1),
          point(WEEK_START_MS + 5 * MINUTE_MS, 1),
          point(WEEK_START_MS + 25 * MINUTE_MS, 1),
        ]),
      ),
    ).toBe(5 * MINUTE_MS);
  });

  test("is 0 for fewer than two points", () => {
    expect(getValueWidgetBucketWidthMs([])).toBe(0);
    expect(
      getValueWidgetBucketWidthMs(
        getValueWidgetSeries([point(WEEK_START_MS, 1)]),
      ),
    ).toBe(0);
  });
});

describe("getValueWidgetTrend: the second half of the range against the first", () => {
  test("a week of counts that rose reads up, by the right percentage, whatever order it came in", () => {
    const expected: ValueWidgetTrend = {
      direction: ValueWidgetTrendDirection.Up,
      percent: 150,
      firstHalfValue: 84 * 100,
      secondHalfValue: 84 * 250,
      firstHalfStart: new Date(WEEK_START_MS),
      midpoint: new Date(WEEK_START_MS + 3.5 * DAY_MS),
      secondHalfEnd: new Date(WEEK_END_MS),
    };

    // As the metrics API answers: newest first. The old widget read "↓ 60%".
    expect(weekTrend(newestFirst(RISING_WEEK), sum, true)).toEqual(expected);
    expect(weekTrend(RISING_WEEK, sum, true)).toEqual(expected);

    const random: SeededRandom = seededRandom(5123);
    for (let round: number = 0; round < 10; round++) {
      expect(weekTrend(shuffled(RISING_WEEK, random), sum, true)).toEqual(
        expected,
      );
    }
  });

  test("a level that fell reads down, by the share of the first half it lost", () => {
    const falling: Array<ValueWidgetPointInput> = hourly({
      startMs: WEEK_START_MS,
      hours: 168,
      valueAt: (index: number): number => {
        return index < 84 ? 400 : 300;
      },
    });

    for (const order of [falling, newestFirst(falling)]) {
      const trend: ValueWidgetTrend | null = weekTrend(
        order,
        getMeanOfValues,
        false,
      );

      expect(trend?.direction).toBe(ValueWidgetTrendDirection.Down);
      expect(trend?.percent).toBe(-25);
      expect(trend?.firstHalfValue).toBe(400);
      expect(trend?.secondHalfValue).toBe(300);
    }
  });

  test("a series that never moves is flat, at 0%", () => {
    const steady: Array<ValueWidgetPointInput> = hourly({
      startMs: WEEK_START_MS,
      hours: 168,
      valueAt: (): number => {
        return 42;
      },
    });

    const trend: ValueWidgetTrend | null = weekTrend(
      newestFirst(steady),
      getMeanOfValues,
      false,
    );

    expect(trend?.direction).toBe(ValueWidgetTrendDirection.Flat);
    expect(trend?.percent).toBe(0);
    expect(Object.is(trend?.percent, -0)).toBe(false);
  });

  test("one bucket is nothing to compare: no trend", () => {
    expect(weekTrend([point(WEEK_END_MS - HOUR_MS, 7)], sum, true)).toBeNull();
    expect(weekTrend([], sum, true)).toBeNull();
  });

  test("two buckets, one in each half, are compared", () => {
    const trend: ValueWidgetTrend | null = weekTrend(
      [point(WEEK_END_MS - HOUR_MS, 30), point(WEEK_START_MS, 20)],
      sum,
      true,
    );

    expect(trend?.direction).toBe(ValueWidgetTrendDirection.Up);
    expect(trend?.percent).toBe(50);
  });

  test("a metric that only began reporting in the second half has no first half to compare with", () => {
    const recent: Array<ValueWidgetPointInput> = hourly({
      startMs: WEEK_START_MS + 5 * DAY_MS,
      hours: 48,
      valueAt: (index: number): number => {
        return 10 + index;
      },
    });

    expect(weekTrend(newestFirst(recent), sum, true)).toBeNull();
    expect(weekTrend(recent, getMeanOfValues, false)).toBeNull();
  });

  test("a metric that went quiet half way is measured against its silence only when the halves both have points", () => {
    const stopped: Array<ValueWidgetPointInput> = hourly({
      startMs: WEEK_START_MS,
      hours: 60,
      valueAt: (): number => {
        return 5;
      },
    });

    // Every point in the first half: nothing to say about the second.
    expect(weekTrend(stopped, sum, true)).toBeNull();
  });

  test("a sparse count is compared by how many it counted, not by the size of the buckets that had any", () => {
    /*
     * A deploy a day in the first half of the week, four a day in the
     * second: every bucket that has one says 1, so a mean of the buckets
     * would read the week as flat.
     */
    const deploys: Array<ValueWidgetPointInput> = [];

    for (let index: number = 0; index < 168; index++) {
      if (index % (index < 84 ? 24 : 6) === 3) {
        deploys.push(point(WEEK_START_MS + index * HOUR_MS, 1));
      }
    }

    const trend: ValueWidgetTrend | null = weekTrend(
      newestFirst(deploys),
      sum,
      true,
    );

    expect(trend?.firstHalfValue).toBe(4);
    expect(trend?.secondHalfValue).toBe(14);
    expect(trend?.direction).toBe(ValueWidgetTrendDirection.Up);
    expect(trend?.percent).toBe(250);

    // What a mean of the buckets that had a deploy would have said.
    expect(weekTrend(deploys, getMeanOfValues, false)?.direction).toBe(
      ValueWidgetTrendDirection.Flat,
    );
  });

  test("a steady count reads flat however the range falls on the bucket grid", () => {
    /*
     * One event a minute, bucketed by the hour, over a week that starts at
     * an odd minute: the first bucket and the last only partly inside the
     * range, and the midpoint inside a bucket. The straddling bucket is
     * shared by the time it spends in each half, so both halves count the
     * same 5,040 minutes.
     */
    const startMs: number = Date.UTC(2026, 9, 15, 10, 17, 0);
    const endMs: number = startMs + 7 * DAY_MS;
    const firstBucketMs: number = Math.floor(startMs / HOUR_MS) * HOUR_MS;
    const points: Array<ValueWidgetPointInput> = [];

    for (
      let bucketMs: number = firstBucketMs;
      bucketMs <= endMs;
      bucketMs = bucketMs + HOUR_MS
    ) {
      const coveredMs: number =
        Math.min(bucketMs + HOUR_MS, endMs) - Math.max(bucketMs, startMs);
      points.push(point(bucketMs, coveredMs / MINUTE_MS));
    }

    const shared: ValueWidgetTrend | null = getValueWidgetTrend({
      points: newestFirst(points),
      reduce: sum,
      isAdditive: true,
      windowStart: new Date(startMs),
      windowEnd: new Date(endMs),
      bucketWidthMs: HOUR_MS,
    });

    expect(shared?.direction).toBe(ValueWidgetTrendDirection.Flat);
    expect(shared?.percent).toBe(0);
    expect(shared?.firstHalfValue).toBeCloseTo(5040, 6);
    expect(shared?.secondHalfValue).toBeCloseTo(5040, 6);

    // Taken whole, the straddling bucket would tip a steady count into a rise.
    const whole: ValueWidgetTrend | null = getValueWidgetTrend({
      points: points,
      reduce: sum,
      isAdditive: false,
      windowStart: new Date(startMs),
      windowEnd: new Date(endMs),
      bucketWidthMs: HOUR_MS,
    });

    expect(whole?.direction).toBe(ValueWidgetTrendDirection.Up);
  });

  test("a steady count reads flat over the past hour from any second of the minute", () => {
    for (let offsetSeconds: number = 0; offsetSeconds < 60; offsetSeconds++) {
      const startMs: number =
        Date.UTC(2026, 9, 22, 9, 0, 0) + offsetSeconds * 1000;
      const endMs: number = startMs + HOUR_MS;
      const points: Array<ValueWidgetPointInput> = [];

      for (
        let bucketMs: number = Math.floor(startMs / MINUTE_MS) * MINUTE_MS;
        bucketMs <= endMs;
        bucketMs = bucketMs + MINUTE_MS
      ) {
        // Ten events a second, cut to the part of the minute in range.
        const coveredMs: number =
          Math.min(bucketMs + MINUTE_MS, endMs) - Math.max(bucketMs, startMs);
        if (coveredMs > 0) {
          points.push(point(bucketMs, (coveredMs / 1000) * 10));
        }
      }

      const trend: ValueWidgetTrend | null = getValueWidgetTrend({
        points: newestFirst(points),
        reduce: sum,
        isAdditive: true,
        windowStart: new Date(startMs),
        windowEnd: new Date(endMs),
        bucketWidthMs: MINUTE_MS,
      });

      expect([offsetSeconds, trend?.direction, trend?.percent]).toEqual([
        offsetSeconds,
        ValueWidgetTrendDirection.Flat,
        0,
      ]);
    }
  });

  test("shared, a straddling bucket keeps the total: the halves add up to the widget's sum", () => {
    const random: SeededRandom = seededRandom(5124);
    const startMs: number = Date.UTC(2026, 9, 15, 10, 41, 0);
    const endMs: number = startMs + 7 * DAY_MS;
    const points: Array<ValueWidgetPointInput> = [];
    let total: number = 0;

    for (
      let bucketMs: number = Math.floor(startMs / HOUR_MS) * HOUR_MS;
      bucketMs <= endMs;
      bucketMs = bucketMs + HOUR_MS
    ) {
      const value: number = random(1000);
      total = total + value;
      points.push(point(bucketMs, value));
    }

    const trend: ValueWidgetTrend | null = getValueWidgetTrend({
      points: shuffled(points, random),
      reduce: sum,
      isAdditive: true,
      windowStart: new Date(startMs),
      windowEnd: new Date(endMs),
      bucketWidthMs: HOUR_MS,
    });

    expect(trend!.firstHalfValue + trend!.secondHalfValue).toBeCloseTo(
      total,
      6,
    );
  });

  test("a level's straddling bucket goes whole to the half that holds most of it", () => {
    const startMs: number = Date.UTC(2026, 9, 22, 9, 0, 0);
    const endMs: number = startMs + 4 * HOUR_MS - 20 * MINUTE_MS;
    // Midpoint 10:50: the 10:00 bucket is mostly in the first half...
    const trend: ValueWidgetTrend | null = getValueWidgetTrend({
      points: [
        point(startMs, 10),
        point(startMs + HOUR_MS, 10),
        point(startMs + 2 * HOUR_MS, 40),
        point(startMs + 3 * HOUR_MS, 40),
      ],
      reduce: getMeanOfValues,
      windowStart: new Date(startMs),
      windowEnd: new Date(endMs),
      bucketWidthMs: HOUR_MS,
    });

    expect(trend?.midpoint.getTime()).toBe(startMs + 110 * MINUTE_MS);
    expect(trend?.firstHalfValue).toBe(10);
    expect(trend?.secondHalfValue).toBe(40);

    // ...and with the midpoint at 10:20, the same bucket is mostly in the second.
    const earlier: ValueWidgetTrend | null = getValueWidgetTrend({
      points: [
        point(startMs, 10),
        point(startMs + HOUR_MS, 40),
        point(startMs + 2 * HOUR_MS, 40),
      ],
      reduce: getMeanOfValues,
      windowStart: new Date(startMs),
      windowEnd: new Date(startMs + 160 * MINUTE_MS),
      bucketWidthMs: HOUR_MS,
    });

    expect(earlier?.firstHalfValue).toBe(10);
    expect(earlier?.secondHalfValue).toBe(40);
  });

  test("each half is reduced the way the widget's number is", () => {
    const points: Array<ValueWidgetPointInput> = hourly({
      startMs: WEEK_START_MS,
      hours: 168,
      valueAt: (index: number): number => {
        // First half 1..84, second half 101..184.
        return index < 84 ? index + 1 : index + 17;
      },
    });

    const halves: (
      reduce: ValueWidgetReduce,
    ) => [number | undefined, number | undefined] = (
      reduce: ValueWidgetReduce,
    ): [number | undefined, number | undefined] => {
      const trend: ValueWidgetTrend | null = weekTrend(
        newestFirst(points),
        reduce,
        false,
      );
      return [trend?.firstHalfValue, trend?.secondHalfValue];
    };

    expect(halves(min)).toEqual([1, 101]);
    expect(halves(max)).toEqual([84, 184]);
    expect(halves(first)).toEqual([1, 101]);
    expect(halves(last)).toEqual([84, 184]);
    expect(halves(getMeanOfValues)).toEqual([42.5, 142.5]);
  });

  test("a grouped query's groups are combined per bucket before the halves are", () => {
    const grouped: Array<ValueWidgetPointInput> = [];

    for (let index: number = 0; index < 168; index++) {
      for (const share of [1, 2, 3]) {
        grouped.push(
          point(
            WEEK_START_MS + index * HOUR_MS,
            (index < 84 ? 10 : 20) * share,
          ),
        );
      }
    }

    const trend: ValueWidgetTrend | null = weekTrend(
      newestFirst(grouped),
      sum,
      true,
    );

    expect(trend?.firstHalfValue).toBe(84 * 60);
    expect(trend?.secondHalfValue).toBe(84 * 120);
    expect(trend?.percent).toBe(100);
  });

  test("a rise from nothing is up with no percentage; a fall below nothing is down", () => {
    const fromZero: (secondHalf: number) => ValueWidgetTrend | null = (
      secondHalf: number,
    ): ValueWidgetTrend | null => {
      return weekTrend(
        hourly({
          startMs: WEEK_START_MS,
          hours: 168,
          valueAt: (index: number): number => {
            return index < 84 ? 0 : secondHalf;
          },
        }),
        sum,
        true,
      );
    };

    expect(fromZero(5)?.direction).toBe(ValueWidgetTrendDirection.Up);
    expect(fromZero(5)?.percent).toBeNull();
    expect(fromZero(-5)?.direction).toBe(ValueWidgetTrendDirection.Down);
    expect(fromZero(-5)?.percent).toBeNull();
    expect(fromZero(0)?.direction).toBe(ValueWidgetTrendDirection.Flat);
    expect(fromZero(0)?.percent).toBe(0);
  });

  test("a negative level is measured against the size of the first half", () => {
    const trend: ValueWidgetTrend | null = weekTrend(
      hourly({
        startMs: WEEK_START_MS,
        hours: 168,
        valueAt: (index: number): number => {
          return index < 84 ? -10 : -5;
        },
      }),
      getMeanOfValues,
      false,
    );

    // From -10 to -5 is a rise of half of 10.
    expect(trend?.direction).toBe(ValueWidgetTrendDirection.Up);
    expect(trend?.percent).toBe(50);
  });

  test(`a move of ${VALUE_WIDGET_FLAT_TREND_PERCENT}% or less reads as about the same`, () => {
    const percentFor: (secondHalf: number) => ValueWidgetTrend | null = (
      secondHalf: number,
    ): ValueWidgetTrend | null => {
      return weekTrend(
        hourly({
          startMs: WEEK_START_MS,
          hours: 168,
          valueAt: (index: number): number => {
            return index < 84 ? 1000 : secondHalf;
          },
        }),
        getMeanOfValues,
        false,
      );
    };

    expect(percentFor(1005)?.direction).toBe(ValueWidgetTrendDirection.Flat);
    expect(percentFor(1005)?.percent).toBe(0.5);
    expect(percentFor(1006)?.direction).toBe(ValueWidgetTrendDirection.Up);
    expect(percentFor(995)?.direction).toBe(ValueWidgetTrendDirection.Flat);
    expect(percentFor(994)?.direction).toBe(ValueWidgetTrendDirection.Down);
    // One decimal.
    expect(percentFor(1123.456)?.percent).toBe(12.3);
  });

  test("without a time range, the points' own span is split in half", () => {
    // Ten one-minute buckets: the span runs to the end of the last one.
    const points: Array<ValueWidgetPointInput> = [];
    const startMs: number = Date.UTC(2026, 9, 22, 9, 0, 0);

    for (let index: number = 0; index < 10; index++) {
      points.push(point(startMs + index * MINUTE_MS, index < 5 ? 1 : 3));
    }

    const trend: ValueWidgetTrend | null = getValueWidgetTrend({
      points: newestFirst(points),
      reduce: sum,
      isAdditive: true,
    });

    expect(trend?.firstHalfStart.getTime()).toBe(startMs);
    expect(trend?.midpoint.getTime()).toBe(startMs + 5 * MINUTE_MS);
    expect(trend?.secondHalfEnd.getTime()).toBe(startMs + 10 * MINUTE_MS);
    expect(trend?.firstHalfValue).toBe(5);
    expect(trend?.secondHalfValue).toBe(15);
    expect(trend?.percent).toBe(200);
  });

  test("a time range that ends before it starts is ignored for the points' own span", () => {
    const trend: ValueWidgetTrend | null = getValueWidgetTrend({
      points: newestFirst(RISING_WEEK),
      reduce: sum,
      isAdditive: true,
      windowStart: new Date(WEEK_END_MS),
      windowEnd: new Date(WEEK_START_MS),
    });

    expect(trend?.firstHalfStart.getTime()).toBe(WEEK_START_MS);
    expect(trend?.secondHalfEnd.getTime()).toBe(WEEK_END_MS);
    expect(trend?.percent).toBe(150);
  });

  test("a time range that is not a date is ignored the same way", () => {
    const trend: ValueWidgetTrend | null = getValueWidgetTrend({
      points: RISING_WEEK,
      reduce: sum,
      isAdditive: true,
      windowStart: new Date("not a date"),
      windowEnd: new Date("not a date either"),
    });

    expect(trend?.percent).toBe(150);
  });

  test("the bucket interval a host knows outranks the one read off sparse points", () => {
    /*
     * Hourly buckets, but only every fifth one has data: read off the
     * points, a bucket would look five hours wide, and the one stamped 80
     * hours in would seem to run past the midpoint (84 hours in).
     */
    const sparse: Array<ValueWidgetPointInput> = [];

    for (let index: number = 0; index < 168; index = index + 5) {
      sparse.push(point(WEEK_START_MS + index * HOUR_MS, index < 84 ? 1 : 2));
    }

    expect(getValueWidgetBucketWidthMs(getValueWidgetSeries(sparse))).toBe(
      5 * HOUR_MS,
    );

    // Told the real interval: seventeen 1s against seventeen 2s.
    const known: ValueWidgetTrend | null = weekTrend(sparse, sum, true);

    expect(known?.firstHalfValue).toBe(17);
    expect(known?.secondHalfValue).toBe(34);
    expect(known?.percent).toBe(100);

    // Left to guess, a fifth of the 80-hour bucket lands in the second half.
    const guessed: ValueWidgetTrend | null = getValueWidgetTrend({
      points: sparse,
      reduce: sum,
      isAdditive: true,
      windowStart: new Date(WEEK_START_MS),
      windowEnd: new Date(WEEK_END_MS),
    });

    expect(guessed?.firstHalfValue).toBeCloseTo(16.8, 9);
    expect(guessed?.secondHalfValue).toBeCloseTo(34.2, 9);
  });

  test("a bucket outside the range still counts, by its own time", () => {
    const trend: ValueWidgetTrend | null = getValueWidgetTrend({
      points: [
        point(WEEK_START_MS - 3 * HOUR_MS, 4),
        point(WEEK_START_MS + 5 * DAY_MS, 8),
        point(WEEK_END_MS + 2 * HOUR_MS, 8),
      ],
      reduce: sum,
      isAdditive: true,
      windowStart: new Date(WEEK_START_MS),
      windowEnd: new Date(WEEK_END_MS),
      bucketWidthMs: HOUR_MS,
    });

    expect(trend?.firstHalfValue).toBe(4);
    expect(trend?.secondHalfValue).toBe(16);
  });

  test("buckets with no number in them change nothing", () => {
    const withHoles: Array<ValueWidgetPointInput> = RISING_WEEK.map(
      (entry: ValueWidgetPointInput, index: number): ValueWidgetPointInput => {
        return index % 7 === 0 ? { ...entry, value: null } : entry;
      },
    );
    const withoutHoles: Array<ValueWidgetPointInput> = RISING_WEEK.filter(
      (_entry: ValueWidgetPointInput, index: number): boolean => {
        return index % 7 !== 0;
      },
    );

    expect(weekTrend(newestFirst(withHoles), sum, true)).toEqual(
      weekTrend(withoutHoles, sum, true),
    );
  });

  test("a reduction that comes to nothing for a half gives no trend", () => {
    const nothingForSmallHalves: ValueWidgetReduce = (
      values: Array<number>,
    ): number | null => {
      return values.length < 100 ? null : 1;
    };

    expect(weekTrend(RISING_WEEK, nothingForSmallHalves, false)).toBeNull();
  });

  test("the answer never depends on the order of the points (seeded sweep)", () => {
    const random: SeededRandom = seededRandom(5125);

    for (let round: number = 0; round < 40; round++) {
      const hours: number = 2 + random(200);
      const points: Array<ValueWidgetPointInput> = [];

      for (let index: number = 0; index < hours; index++) {
        // Some buckets missing, some empty, values of either sign.
        if (random(5) === 0) {
          continue;
        }
        points.push(
          point(
            WEEK_START_MS + index * HOUR_MS,
            random(10) === 0 ? null : random(2000) - 500,
          ),
        );
      }

      for (const isAdditive of [true, false]) {
        const reduce: ValueWidgetReduce = isAdditive ? sum : getMeanOfValues;
        const settings: {
          windowStart: Date;
          windowEnd: Date;
        } = {
          windowStart: new Date(WEEK_START_MS - random(60) * MINUTE_MS),
          windowEnd: new Date(WEEK_START_MS + hours * HOUR_MS),
        };
        const expected: ValueWidgetTrend | null = getValueWidgetTrend({
          points: points,
          reduce: reduce,
          isAdditive: isAdditive,
          ...settings,
        });

        expect(
          getValueWidgetTrend({
            points: newestFirst(points),
            reduce: reduce,
            isAdditive: isAdditive,
            ...settings,
          }),
        ).toEqual(expected);
        expect(
          getValueWidgetTrend({
            points: shuffled(points, random),
            reduce: reduce,
            isAdditive: isAdditive,
            ...settings,
          }),
        ).toEqual(expected);
      }
    }
  });
});

/*
 * A sum's or a count's sparkline draws the empty buckets between its
 * readings at 0 (the metrics API answers only the buckets that had one), so
 * a sparse count's spikes read as spikes instead of a flat line. Never
 * before the first reading or after the last, never off the bucket grid,
 * and never past VALUE_WIDGET_MAX_FILLED_POINTS.
 */
describe("fillValueWidgetSeriesGaps: a sparse count's empty buckets at 0", () => {
  const at: (hour: number, value: number) => ValueWidgetPoint = (
    hour: number,
    value: number,
  ): ValueWidgetPoint => {
    return {
      timestamp: new Date(WEEK_START_MS + hour * HOUR_MS),
      value: value,
    };
  };

  const hoursOf: (points: Array<ValueWidgetPoint>) => Array<number> = (
    points: Array<ValueWidgetPoint>,
  ): Array<number> => {
    return points.map((point: ValueWidgetPoint): number => {
      return (point.timestamp.getTime() - WEEK_START_MS) / HOUR_MS;
    });
  };

  test("every empty hour between the first reading and the last is drawn at 0", () => {
    const filled: Array<ValueWidgetPoint> = fillValueWidgetSeriesGaps({
      series: [at(2, 4), at(5, 9), at(6, 1)],
      bucketWidthMs: HOUR_MS,
    });

    expect(hoursOf(filled)).toEqual([2, 3, 4, 5, 6]);
    expect(
      filled.map((point: ValueWidgetPoint): number => {
        return point.value;
      }),
    ).toEqual([4, 0, 0, 9, 1]);
  });

  test("the readings keep their values and their times", () => {
    const series: Array<ValueWidgetPoint> = [at(0, 7), at(10, 3)];
    const filled: Array<ValueWidgetPoint> = fillValueWidgetSeriesGaps({
      series: series,
      bucketWidthMs: HOUR_MS,
    });

    expect(filled[0]).toEqual(series[0]);
    expect(filled[10]).toEqual(series[1]);
    expect(filled).toHaveLength(11);
  });

  test("nothing before the first reading or after the last: a bucket still filling is not an outage", () => {
    const filled: Array<ValueWidgetPoint> = fillValueWidgetSeriesGaps({
      series: [at(40, 1), at(42, 1)],
      bucketWidthMs: HOUR_MS,
    });

    expect(hoursOf(filled)).toEqual([40, 41, 42]);
  });

  test("a series with no gap, one point or none is handed back as it is", () => {
    const steady: Array<ValueWidgetPoint> = [at(1, 1), at(2, 2), at(3, 3)];

    expect(
      fillValueWidgetSeriesGaps({ series: steady, bucketWidthMs: HOUR_MS }),
    ).toBe(steady);
    expect(
      fillValueWidgetSeriesGaps({ series: [at(5, 5)], bucketWidthMs: HOUR_MS }),
    ).toEqual([at(5, 5)]);
    expect(
      fillValueWidgetSeriesGaps({ series: [], bucketWidthMs: HOUR_MS }),
    ).toEqual([]);
  });

  test("points off the bucket grid are left as they came: no zeros between real readings", () => {
    // Readings 90 minutes apart cannot be hourly buckets.
    const offGrid: Array<ValueWidgetPoint> = [
      { timestamp: new Date(WEEK_START_MS), value: 1 },
      { timestamp: new Date(WEEK_START_MS + 90 * MINUTE_MS), value: 2 },
      { timestamp: new Date(WEEK_START_MS + 180 * MINUTE_MS), value: 3 },
    ];

    expect(
      fillValueWidgetSeriesGaps({ series: offGrid, bucketWidthMs: HOUR_MS }),
    ).toBe(offGrid);
  });

  test("a width that is no width fills nothing", () => {
    const series: Array<ValueWidgetPoint> = [at(0, 1), at(5, 1)];

    for (const width of [0, -HOUR_MS, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(
        fillValueWidgetSeriesGaps({ series: series, bucketWidthMs: width }),
      ).toBe(series);
    }
  });

  test("readings spread over more buckets than a sparkline draws are left as they came", () => {
    const wide: Array<ValueWidgetPoint> = [
      { timestamp: new Date(WEEK_START_MS), value: 1 },
      {
        timestamp: new Date(
          WEEK_START_MS + VALUE_WIDGET_MAX_FILLED_POINTS * MINUTE_MS,
        ),
        value: 1,
      },
    ];

    expect(
      fillValueWidgetSeriesGaps({ series: wide, bucketWidthMs: MINUTE_MS }),
    ).toBe(wide);

    const justFits: Array<ValueWidgetPoint> = [
      wide[0]!,
      {
        timestamp: new Date(
          WEEK_START_MS + (VALUE_WIDGET_MAX_FILLED_POINTS - 1) * MINUTE_MS,
        ),
        value: 1,
      },
    ];

    expect(
      fillValueWidgetSeriesGaps({ series: justFits, bucketWidthMs: MINUTE_MS }),
    ).toHaveLength(VALUE_WIDGET_MAX_FILLED_POINTS);
  });

  test("the series behind the fill is the sorted one: newest-first buckets fill the same way", () => {
    const newestFirst: Array<ValueWidgetPointInput> = [
      point(WEEK_START_MS + 6 * HOUR_MS, 1),
      point(WEEK_START_MS + 2 * HOUR_MS, 4),
    ];

    const filled: Array<ValueWidgetPoint> = fillValueWidgetSeriesGaps({
      series: getValueWidgetSeries(newestFirst, sum),
      bucketWidthMs: HOUR_MS,
    });

    expect(hoursOf(filled)).toEqual([2, 3, 4, 5, 6]);
    expect(filled[0]!.value).toBe(4);
    expect(filled[4]!.value).toBe(1);
  });

  test("filling never moves the trend: a sum's zeros add nothing to either half", () => {
    const sparse: Array<ValueWidgetPoint> = [
      at(10, 4),
      at(40, 4),
      at(100, 12),
      at(130, 12),
      at(160, 12),
    ];

    const fromReadings: ValueWidgetTrend | null = getValueWidgetTrend({
      points: sparse,
      reduce: sum,
      isAdditive: true,
      windowStart: new Date(WEEK_START_MS),
      windowEnd: new Date(WEEK_END_MS),
      bucketWidthMs: HOUR_MS,
    });
    const fromFilled: ValueWidgetTrend | null = getValueWidgetTrend({
      points: fillValueWidgetSeriesGaps({
        series: sparse,
        bucketWidthMs: HOUR_MS,
      }),
      reduce: sum,
      isAdditive: true,
      windowStart: new Date(WEEK_START_MS),
      windowEnd: new Date(WEEK_END_MS),
      bucketWidthMs: HOUR_MS,
    });

    expect(fromReadings?.percent).toBe(350);
    expect(fromFilled?.percent).toBe(fromReadings?.percent);
    expect(fromFilled?.direction).toBe(ValueWidgetTrendDirection.Up);
  });
});
