import AggregatedModel from "../../../Types/BaseDatabase/AggregatedModel";
import AggregatedResult from "../../../Types/BaseDatabase/AggregatedResult";
import { DataSourceValueReduce } from "../../../Types/Dashboard/DashboardComponents/DashboardDataSourceValueComponent";
import DataSourceValueReducer from "../../../Utils/DataSource/DataSourceValueReducer";
import { describe, expect, test } from "@jest/globals";

/*
 * The DataSource Value and Gauge widgets show exactly one number, and this
 * class is the only thing that decides which one. Two properties are load
 * bearing and neither is guaranteed by the connectors upstream:
 *
 *  1. Order. A hand-written SQL query with no ORDER BY, or two queries whose
 *     buckets interleave, arrive unsorted — and "Last" on an unsorted series
 *     is an arbitrary point presented to an on-call engineer as "now".
 *  2. The null/zero distinction. AggregatedModel types `value` as number but
 *     carries a JSONValue index signature, so a SQL NULL or a missing column
 *     really does arrive as null. If those leak through, an average silently
 *     becomes NaN; if an empty series reduced to 0, an outage that returns no
 *     rows at all would render as a confident "0" — indistinguishable from a
 *     healthy genuine zero.
 */

function makePoint(timestamp: unknown, value: unknown): AggregatedModel {
  return {
    timestamp: timestamp,
    value: value,
  } as unknown as AggregatedModel;
}

function makeResult(
  points: Array<AggregatedModel>,
  errorMessage?: string | undefined,
): AggregatedResult {
  return {
    data: points,
    errorMessage: errorMessage,
  };
}

function makeDate(isoString: string): Date {
  return new Date(isoString);
}

// Every reduction the widget UI can persist, plus the two "absent" shapes.
const allReduceModes: Array<DataSourceValueReduce> = [
  DataSourceValueReduce.Last,
  DataSourceValueReduce.First,
  DataSourceValueReduce.Avg,
  DataSourceValueReduce.Sum,
  DataSourceValueReduce.Min,
  DataSourceValueReduce.Max,
];

describe("DataSourceValueReducer.getNumericValues", () => {
  test("returns values in time order for a single unsorted result", () => {
    const values: Array<number> = DataSourceValueReducer.getNumericValues([
      makeResult([
        makePoint(makeDate("2024-01-01T00:03:00Z"), 30),
        makePoint(makeDate("2024-01-01T00:01:00Z"), 10),
        makePoint(makeDate("2024-01-01T00:04:00Z"), 40),
        makePoint(makeDate("2024-01-01T00:02:00Z"), 20),
      ]),
    ]);

    expect(values).toEqual([10, 20, 30, 40]);
  });

  test("interleaves points from multiple results by timestamp", () => {
    const values: Array<number> = DataSourceValueReducer.getNumericValues([
      makeResult([
        makePoint(makeDate("2024-01-01T00:01:00Z"), 1),
        makePoint(makeDate("2024-01-01T00:03:00Z"), 3),
      ]),
      makeResult([
        makePoint(makeDate("2024-01-01T00:02:00Z"), 2),
        makePoint(makeDate("2024-01-01T00:04:00Z"), 4),
      ]),
    ]);

    expect(values).toEqual([1, 2, 3, 4]);
  });

  test("drops null, undefined, NaN and infinities", () => {
    const values: Array<number> = DataSourceValueReducer.getNumericValues([
      makeResult([
        makePoint(makeDate("2024-01-01T00:01:00Z"), 1),
        makePoint(makeDate("2024-01-01T00:02:00Z"), null),
        makePoint(makeDate("2024-01-01T00:03:00Z"), undefined),
        makePoint(makeDate("2024-01-01T00:04:00Z"), Number.NaN),
        makePoint(makeDate("2024-01-01T00:05:00Z"), Number.POSITIVE_INFINITY),
        makePoint(makeDate("2024-01-01T00:06:00Z"), Number.NEGATIVE_INFINITY),
        makePoint(makeDate("2024-01-01T00:07:00Z"), 2),
      ]),
    ]);

    expect(values).toEqual([1, 2]);
  });

  test("drops non-number values that survive JSON round trips", () => {
    const values: Array<number> = DataSourceValueReducer.getNumericValues([
      makeResult([
        // A numeric string is the classic Postgres bigint/numeric shape.
        makePoint(makeDate("2024-01-01T00:01:00Z"), "5"),
        makePoint(makeDate("2024-01-01T00:02:00Z"), true),
        makePoint(makeDate("2024-01-01T00:03:00Z"), { value: 7 }),
        makePoint(makeDate("2024-01-01T00:04:00Z"), []),
        makePoint(makeDate("2024-01-01T00:05:00Z"), 9),
      ]),
    ]);

    expect(values).toEqual([9]);
  });

  test("keeps zero and negative values", () => {
    const values: Array<number> = DataSourceValueReducer.getNumericValues([
      makeResult([
        makePoint(makeDate("2024-01-01T00:01:00Z"), 0),
        makePoint(makeDate("2024-01-01T00:02:00Z"), -12.5),
      ]),
    ]);

    // 0 is real data, not "missing" — it must not be filtered as falsy.
    expect(values).toEqual([0, -12.5]);
  });

  test("orders ISO string timestamps the same as Date instances", () => {
    const values: Array<number> = DataSourceValueReducer.getNumericValues([
      makeResult([
        makePoint("2024-01-01T00:03:00Z", 3),
        makePoint("2024-01-01T00:01:00Z", 1),
        makePoint("2024-01-01T00:02:00Z", 2),
      ]),
    ]);

    expect(values).toEqual([1, 2, 3]);
  });

  test("orders a mix of Date instances, ISO strings and epoch numbers", () => {
    const values: Array<number> = DataSourceValueReducer.getNumericValues([
      makeResult([
        makePoint(makeDate("2024-01-01T00:04:00Z"), 4),
        makePoint("2024-01-01T00:02:00Z", 2),
        makePoint(makeDate("2024-01-01T00:01:00Z").getTime(), 1),
        makePoint("2024-01-01T00:03:00Z", 3),
      ]),
    ]);

    expect(values).toEqual([1, 2, 3, 4]);
  });

  test("does not throw on unparseable timestamps and keeps their values", () => {
    let values: Array<number> = [];

    expect(() => {
      values = DataSourceValueReducer.getNumericValues([
        makeResult([
          makePoint(makeDate("2024-01-01T00:02:00Z"), 2),
          makePoint("not-a-timestamp", 99),
          makePoint(undefined, 98),
          makePoint(makeDate("2024-01-01T00:01:00Z"), 1),
        ]),
      ]);
    }).not.toThrow();

    /*
     * Unparseable timestamps are parked at the start rather than dropped —
     * the value is still real data, only its position is unknowable.
     */
    expect(values).toEqual([99, 98, 1, 2]);
  });

  test("returns an empty array for no results and for empty results", () => {
    expect(DataSourceValueReducer.getNumericValues([])).toEqual([]);
    expect(
      DataSourceValueReducer.getNumericValues([makeResult([]), makeResult([])]),
    ).toEqual([]);
  });

  test("returns an empty array when every point is unusable", () => {
    expect(
      DataSourceValueReducer.getNumericValues([
        makeResult([
          makePoint(makeDate("2024-01-01T00:01:00Z"), null),
          makePoint(makeDate("2024-01-01T00:02:00Z"), Number.NaN),
        ]),
      ]),
    ).toEqual([]);
  });
});

describe("DataSourceValueReducer.reduce", () => {
  const series: Array<number> = [10, -4, 6, 8];

  test("Last returns the chronologically final value", () => {
    expect(
      DataSourceValueReducer.reduce(series, DataSourceValueReduce.Last),
    ).toBe(8);
  });

  test("First returns the chronologically first value", () => {
    expect(
      DataSourceValueReducer.reduce(series, DataSourceValueReduce.First),
    ).toBe(10);
  });

  test("Avg averages over the full series including negatives", () => {
    expect(
      DataSourceValueReducer.reduce(series, DataSourceValueReduce.Avg),
    ).toBe(5);
    expect(
      DataSourceValueReducer.reduce([1, 2], DataSourceValueReduce.Avg),
    ).toBe(1.5);
  });

  test("Sum adds every value", () => {
    expect(
      DataSourceValueReducer.reduce(series, DataSourceValueReduce.Sum),
    ).toBe(20);
  });

  test("Min and Max span negatives", () => {
    expect(
      DataSourceValueReducer.reduce(series, DataSourceValueReduce.Min),
    ).toBe(-4);
    expect(
      DataSourceValueReducer.reduce(series, DataSourceValueReduce.Max),
    ).toBe(10);
  });

  test("undefined reduce behaves as Last, the documented default", () => {
    expect(DataSourceValueReducer.reduce(series, undefined)).toBe(
      DataSourceValueReducer.reduce(series, DataSourceValueReduce.Last),
    );
    expect(DataSourceValueReducer.reduce(series, undefined)).toBe(8);
  });

  test("an unrecognised stored reduce falls back to Last", () => {
    /*
     * Widget arguments are persisted as JSON, so a renamed or removed enum
     * member can be read back years later. It must degrade to Last, not to
     * undefined/NaN.
     */
    const stale: DataSourceValueReduce =
      "Median" as unknown as DataSourceValueReduce;

    expect(DataSourceValueReducer.reduce(series, stale)).toBe(8);
  });

  test("a single point reduces to itself under every mode", () => {
    for (const mode of allReduceModes) {
      expect(DataSourceValueReducer.reduce([42], mode)).toBe(42);
    }
    expect(DataSourceValueReducer.reduce([42], undefined)).toBe(42);
  });

  test("an empty series is null, never 0, under every mode", () => {
    /*
     * 0 would be indistinguishable from a genuine zero reading, so the
     * widget could not tell "nothing came back" from "the value is 0" and
     * would render a confident wrong number. Sum and Avg are the dangerous
     * ones: their natural seed is 0 and 0/0 respectively.
     */
    for (const mode of allReduceModes) {
      expect(DataSourceValueReducer.reduce([], mode)).toBeNull();
    }
    expect(DataSourceValueReducer.reduce([], undefined)).toBeNull();
    expect(
      DataSourceValueReducer.reduce(
        [],
        "Median" as unknown as DataSourceValueReduce,
      ),
    ).toBeNull();
  });

  test("a genuine zero reduces to 0, not null", () => {
    expect(
      DataSourceValueReducer.reduce([0, 0], DataSourceValueReduce.Sum),
    ).toBe(0);
    expect(
      DataSourceValueReducer.reduce([0, 0], DataSourceValueReduce.Avg),
    ).toBe(0);
    expect(DataSourceValueReducer.reduce([0], DataSourceValueReduce.Last)).toBe(
      0,
    );
  });

  test("all-negative series reduce correctly", () => {
    const negatives: Array<number> = [-1, -9, -3];

    expect(
      DataSourceValueReducer.reduce(negatives, DataSourceValueReduce.Min),
    ).toBe(-9);
    expect(
      DataSourceValueReducer.reduce(negatives, DataSourceValueReduce.Max),
    ).toBe(-1);
    expect(
      DataSourceValueReducer.reduce(negatives, DataSourceValueReduce.Sum),
    ).toBe(-13);
  });

  test("does not mutate the values it reduces", () => {
    const values: Array<number> = [3, 1, 2];

    for (const mode of allReduceModes) {
      DataSourceValueReducer.reduce(values, mode);
    }

    expect(values).toEqual([3, 1, 2]);
  });
});

describe("DataSourceValueReducer.reduceResults", () => {
  test("returns the ordered values alongside the reduced number", () => {
    const output: { values: Array<number>; value: number | null } =
      DataSourceValueReducer.reduceResults(
        [
          makeResult([
            makePoint(makeDate("2024-01-01T00:03:00Z"), 30),
            makePoint(makeDate("2024-01-01T00:01:00Z"), 10),
          ]),
          makeResult([makePoint(makeDate("2024-01-01T00:02:00Z"), 20)]),
        ],
        DataSourceValueReduce.Avg,
      );

    expect(output.values).toEqual([10, 20, 30]);
    expect(output.value).toBe(20);
  });

  test("Last ignores trailing unusable points", () => {
    /*
     * A gauge whose most recent scrape is NULL must show the last real
     * reading, not blank out.
     */
    const output: { values: Array<number>; value: number | null } =
      DataSourceValueReducer.reduceResults(
        [
          makeResult([
            makePoint(makeDate("2024-01-01T00:01:00Z"), 7),
            makePoint(makeDate("2024-01-01T00:02:00Z"), null),
          ]),
        ],
        DataSourceValueReduce.Last,
      );

    expect(output.values).toEqual([7]);
    expect(output.value).toBe(7);
  });

  test("empty and all-unusable results give no values and a null value", () => {
    const empty: { values: Array<number>; value: number | null } =
      DataSourceValueReducer.reduceResults([], DataSourceValueReduce.Sum);

    expect(empty.values).toEqual([]);
    expect(empty.value).toBeNull();

    const unusable: { values: Array<number>; value: number | null } =
      DataSourceValueReducer.reduceResults(
        [makeResult([makePoint(makeDate("2024-01-01T00:01:00Z"), null)])],
        undefined,
      );

    expect(unusable.values).toEqual([]);
    expect(unusable.value).toBeNull();
  });
});

describe("DataSourceValueReducer.getResultsErrorMessage", () => {
  test("returns the first result carrying an error message", () => {
    expect(
      DataSourceValueReducer.getResultsErrorMessage([
        makeResult([]),
        makeResult([], "connection refused"),
        makeResult([], "query timed out"),
      ]),
    ).toBe("connection refused");
  });

  test("ignores empty string error messages", () => {
    /*
     * Connectors clear the field by writing "" rather than deleting it, and
     * an empty banner reads as a broken widget.
     */
    expect(
      DataSourceValueReducer.getResultsErrorMessage([
        makeResult([], ""),
        makeResult([], "syntax error at or near SELECT"),
      ]),
    ).toBe("syntax error at or near SELECT");

    expect(
      DataSourceValueReducer.getResultsErrorMessage([
        makeResult([], ""),
        makeResult([], ""),
      ]),
    ).toBeUndefined();
  });

  test("returns undefined when no result carries an error", () => {
    expect(
      DataSourceValueReducer.getResultsErrorMessage([
        makeResult([makePoint(makeDate("2024-01-01T00:01:00Z"), 1)]),
        makeResult([]),
      ]),
    ).toBeUndefined();
  });

  test("returns undefined for an empty results array", () => {
    expect(DataSourceValueReducer.getResultsErrorMessage([])).toBeUndefined();
  });

  test("reports the error even when the failing result still has data", () => {
    expect(
      DataSourceValueReducer.getResultsErrorMessage([
        makeResult(
          [makePoint(makeDate("2024-01-01T00:01:00Z"), 1)],
          "partial results: upstream shard down",
        ),
      ]),
    ).toBe("partial results: upstream shard down");
  });
});

describe("DataSourceValueReducer.sortPointsByTime", () => {
  test("flattens and orders points across results", () => {
    const points: Array<AggregatedModel> =
      DataSourceValueReducer.sortPointsByTime([
        makeResult([
          makePoint(makeDate("2024-01-01T00:05:00Z"), 5),
          makePoint(makeDate("2024-01-01T00:01:00Z"), 1),
        ]),
        makeResult([makePoint(makeDate("2024-01-01T00:03:00Z"), 3)]),
      ]);

    expect(
      points.map((point: AggregatedModel): number => {
        return point.value;
      }),
    ).toEqual([1, 3, 5]);
  });

  test("orders a mix of Date and ISO string timestamps", () => {
    const points: Array<AggregatedModel> =
      DataSourceValueReducer.sortPointsByTime([
        makeResult([
          makePoint("2024-01-01T00:04:00Z", 4),
          makePoint(makeDate("2024-01-01T00:02:00Z"), 2),
          makePoint("2024-01-01T00:01:00Z", 1),
          makePoint(makeDate("2024-01-01T00:03:00Z"), 3),
        ]),
      ]);

    expect(
      points.map((point: AggregatedModel): number => {
        return point.value;
      }),
    ).toEqual([1, 2, 3, 4]);
  });

  test("parks unparseable timestamps at the start", () => {
    const points: Array<AggregatedModel> =
      DataSourceValueReducer.sortPointsByTime([
        makeResult([
          makePoint(makeDate("2024-01-01T00:02:00Z"), 2),
          makePoint("garbage", 100),
          makePoint(makeDate("2024-01-01T00:01:00Z"), 1),
          makePoint(Number.NaN, 200),
        ]),
      ]);

    expect(
      points.map((point: AggregatedModel): number => {
        return point.value;
      }),
    ).toEqual([100, 200, 1, 2]);
  });

  test("preserves input order for equal timestamps", () => {
    /*
     * Two connectors bucketed to the same instant must not shuffle between
     * renders, otherwise Last flickers between series.
     */
    const timestamp: Date = makeDate("2024-01-01T00:01:00Z");

    const points: Array<AggregatedModel> =
      DataSourceValueReducer.sortPointsByTime([
        makeResult([makePoint(timestamp, 1), makePoint(timestamp, 2)]),
        makeResult([makePoint(timestamp, 3)]),
      ]);

    expect(
      points.map((point: AggregatedModel): number => {
        return point.value;
      }),
    ).toEqual([1, 2, 3]);
  });

  test("does not mutate the results it was given", () => {
    const first: AggregatedResult = makeResult([
      makePoint(makeDate("2024-01-01T00:05:00Z"), 5),
      makePoint(makeDate("2024-01-01T00:01:00Z"), 1),
    ]);
    const second: AggregatedResult = makeResult([
      makePoint(makeDate("2024-01-01T00:03:00Z"), 3),
    ]);
    const results: Array<AggregatedResult> = [first, second];

    DataSourceValueReducer.sortPointsByTime(results);

    // The caller still owns its arrays: order and length are untouched.
    expect(
      first.data.map((point: AggregatedModel): number => {
        return point.value;
      }),
    ).toEqual([5, 1]);
    expect(second.data).toHaveLength(1);
    expect(results).toEqual([first, second]);
  });

  test("returns an empty array for no results and for empty data", () => {
    expect(DataSourceValueReducer.sortPointsByTime([])).toEqual([]);
    expect(DataSourceValueReducer.sortPointsByTime([makeResult([])])).toEqual(
      [],
    );
  });
});
