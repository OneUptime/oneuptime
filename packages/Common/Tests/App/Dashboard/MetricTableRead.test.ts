import { describe, expect, test } from "@jest/globals";
import {
  getMetricTableRead,
  isMetricTableSetUp,
  MetricTableRead,
  namesAMetric,
  placeMetricTableResults,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/MetricWidgetQuery";
import AggregatedResult from "../../../Types/BaseDatabase/AggregatedResult";
import MetricQueryConfigData from "../../../Types/Metrics/MetricQueryConfigData";
import MetricsAggregationType from "../../../Types/Metrics/MetricsAggregationType";

/*
 * WHAT THE METRIC TABLE READS (issue #7329), kept free of React.
 *
 * Each metric column of a Table is a query. A new Table's one column names
 * no metric yet, and a column just added to a working table names none
 * either: such a column is left out of the read, and its cells stay empty.
 * A column that names a metric and no aggregation - an older table's, or
 * one whose picker still shows its Avg - is read as its average, as the
 * Chart and the Value widget read theirs, and the stored widget is never
 * changed. The results come back beside their own columns.
 */

function query(
  variable: string,
  filterData: Record<string, unknown> | undefined,
): MetricQueryConfigData {
  return {
    metricAliasData: { metricVariable: variable },
    metricQueryData: filterData === undefined ? {} : { filterData },
  } as unknown as MetricQueryConfigData;
}

function result(label: string): AggregatedResult {
  return {
    data: [
      {
        timestamp: new Date("2026-11-13T09:00:00.000Z"),
        value: label.length,
        attributes: { label },
      },
    ],
  } as unknown as AggregatedResult;
}

describe("a column names a metric", () => {
  test.each([
    ["no query at all", undefined, false],
    ["a query with no filter", query("a", undefined), false],
    ["an empty filter", query("a", {}), false],
    /*
     * The new Table's column: an aggregation and no metric. A filter that
     * held anything was "set", so the Table read it with no metric name.
     */
    [
      "an aggregation and no metric",
      query("a", {
        metricName: undefined,
        aggegationType: MetricsAggregationType.Avg,
      }),
      false,
    ],
    ["an empty name", query("a", { metricName: "" }), false],
    ["a name of spaces", query("a", { metricName: "   " }), false],
    ["a null name", query("a", { metricName: null }), false],
    ["a metric's name", query("a", { metricName: "http.requests" }), true],
    [
      "a metric's name and an aggregation",
      query("a", {
        metricName: "http.requests",
        aggegationType: MetricsAggregationType.Sum,
      }),
      true,
    ],
  ])(
    "%s",
    (
      _what: string,
      queryConfig: MetricQueryConfigData | undefined,
      names: boolean,
    ) => {
      expect(namesAMetric(queryConfig)).toBe(names);
    },
  );
});

describe("a Table is set up once one of its columns names a metric", () => {
  test("no column, or none that names a metric: not set up", () => {
    expect(isMetricTableSetUp([])).toBe(false);
    expect(
      isMetricTableSetUp([
        query("a", { aggegationType: MetricsAggregationType.Avg }),
        query("b", { metricName: " " }),
      ]),
    ).toBe(false);
  });

  test("any column that names one, first or not: set up", () => {
    expect(
      isMetricTableSetUp([
        query("a", { aggegationType: MetricsAggregationType.Avg }),
        query("b", { metricName: "http.requests" }),
      ]),
    ).toBe(true);
    expect(
      isMetricTableSetUp([query("a", { metricName: "http.requests" })]),
    ).toBe(true);
  });
});

describe("the read of a Table's columns", () => {
  test("each column that names a metric, in order; one that names none is left out", () => {
    const named: MetricQueryConfigData = query("a", {
      metricName: "http.requests",
      aggegationType: MetricsAggregationType.Sum,
    });
    const unnamed: MetricQueryConfigData = query("b", {
      aggegationType: MetricsAggregationType.Avg,
    });
    const third: MetricQueryConfigData = query("c", {
      metricName: "http.errors",
      aggegationType: MetricsAggregationType.Max,
    });

    const read: MetricTableRead = getMetricTableRead([named, unnamed, third]);

    expect(read.queryConfigs).toEqual([named, third]);
    // A picked aggregation is read as picked: the same query.
    expect(read.queryConfigs[0]).toBe(named);
    expect(read.queryConfigs[1]).toBe(third);
    expect(read.readIndexes).toEqual([0, null, 1]);
  });

  test("a column with no aggregation is read as its average; the stored column is left as it was", () => {
    const stored: MetricQueryConfigData = query("a", {
      metricName: "http.requests",
      attributes: { "service.name": "api" },
    });
    const storedCopy: string = JSON.stringify(stored);

    const read: MetricTableRead = getMetricTableRead([stored]);

    expect(read.queryConfigs).toHaveLength(1);
    expect(read.queryConfigs[0]!.metricQueryData.filterData).toEqual({
      metricName: "http.requests",
      attributes: { "service.name": "api" },
      aggegationType: MetricsAggregationType.Avg,
    });
    expect(read.queryConfigs[0]!.metricAliasData).toEqual(
      stored.metricAliasData,
    );
    expect(read.queryConfigs[0]).not.toBe(stored);
    expect(JSON.stringify(stored)).toBe(storedCopy);
    expect(read.readIndexes).toEqual([0]);
  });

  test("a Table with no column that names a metric reads nothing", () => {
    const read: MetricTableRead = getMetricTableRead([
      query("a", { aggegationType: MetricsAggregationType.Avg }),
      query("b", {}),
    ]);

    expect(read).toEqual({ queryConfigs: [], readIndexes: [null, null] });
  });
});

describe("the results, back beside their own columns", () => {
  test("a column left out of the read gets no rows; the ones read and the formulas keep theirs", () => {
    const read: MetricTableRead = getMetricTableRead([
      query("a", { metricName: "http.requests" }),
      query("b", {}),
      query("c", { metricName: "http.errors" }),
    ]);
    const a: AggregatedResult = result("a");
    const c: AggregatedResult = result("c");
    const formula: AggregatedResult = result("formula");

    // The metrics read answers the queries it was asked, then the formulas.
    expect(placeMetricTableResults({ read, results: [a, c, formula] })).toEqual(
      [a, { data: [] }, c, formula],
    );

    const placed: Array<AggregatedResult> = placeMetricTableResults({
      read,
      results: [a, c, formula],
    });

    expect(placed[0]).toBe(a);
    expect(placed[2]).toBe(c);
    expect(placed[3]).toBe(formula);
  });

  test("every column read: the results as they came", () => {
    const read: MetricTableRead = getMetricTableRead([
      query("a", { metricName: "http.requests" }),
      query("b", { metricName: "http.errors" }),
    ]);
    const results: Array<AggregatedResult> = [
      result("a"),
      result("b"),
      result("formula"),
    ];

    expect(placeMetricTableResults({ read, results })).toEqual(results);
  });

  test("an answer short of a column leaves that column empty, never another's rows", () => {
    const read: MetricTableRead = getMetricTableRead([
      query("a", { metricName: "http.requests" }),
      query("b", { metricName: "http.errors" }),
    ]);
    const a: AggregatedResult = result("a");

    expect(placeMetricTableResults({ read, results: [a] })).toEqual([
      a,
      { data: [] },
    ]);
  });

  test("a leading column that names nothing does not shift the others", () => {
    const read: MetricTableRead = getMetricTableRead([
      query("a", {}),
      query("b", { metricName: "http.errors" }),
    ]);
    const b: AggregatedResult = result("b");
    const formula: AggregatedResult = result("formula");

    expect(placeMetricTableResults({ read, results: [b, formula] })).toEqual([
      { data: [] },
      b,
      formula,
    ]);
  });
});
