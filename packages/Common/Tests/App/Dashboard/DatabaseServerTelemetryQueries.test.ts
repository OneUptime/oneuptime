import { afterEach, describe, expect, jest, test } from "@jest/globals";
import {
  DATABASE_METRIC_CATALOG_GAUGE_AGGREGATIONS,
  DATABASE_METRIC_DELTA_COUNTER_AGGREGATIONS,
  DATABASE_METRIC_DISTRIBUTION_AGGREGATIONS,
  DATABASE_METRIC_GAUGE_AGGREGATIONS,
  DatabaseCallingServices,
  DatabaseEngineMetricResult,
  DatabaseMetricChartSpec,
  DatabaseMetricShape,
  DatabaseQueryMetrics,
  DatabaseTimePoint,
  EMPTY_DATABASE_CALLING_SERVICES,
  EMPTY_DATABASE_QUERY_METRICS,
  UNKNOWN_DATABASE_METRIC_SHAPE,
  aggregatedResultToTimePoints,
  buildDatabaseMetricQuery,
  buildDatabaseSpanQuery,
  combineCallingServiceResults,
  combineGaugeSeries,
  counterResultToRatePerSecond,
  fetchDatabaseCallingServices,
  fetchDatabaseCatalogMetricSeries,
  fetchDatabaseCounterRateSeries,
  fetchDatabaseEngineMetrics,
  fetchDatabaseGaugeSeries,
  fetchDatabaseMetricChartSeries,
  fetchDatabaseMetricSeries,
  fetchDatabaseMetricShape,
  fetchDatabaseQueryMetrics,
  getAttributeSeriesKey,
  getDatabaseMetricChartSpec,
  getDatabaseMetricsRangeFromSearch,
  hasEngineMetricData,
  latestOfSeries,
  meanOfSeries,
  toEngineMetricResult,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Database/Utils/DatabaseServerTelemetryQueries";
import AnalyticsModelAPI from "../../../UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI";
import Metric, {
  AggregationTemporality,
  MetricPointType,
} from "../../../Models/AnalyticsModels/Metric";
import Span, {
  SpanKind,
  SpanStatus,
} from "../../../Models/AnalyticsModels/Span";
import AggregatedResult from "../../../Types/BaseDatabase/AggregatedResult";
import AggregationInterval from "../../../Types/BaseDatabase/AggregationInterval";
import AggregationType from "../../../Types/BaseDatabase/AggregationType";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import Includes from "../../../Types/BaseDatabase/Includes";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import {
  DATABASE_SERVER_METRICS,
  DatabaseServerMetricDefinition,
  getDatabaseServerMetricGroupKeys,
  getDatabaseServerMetrics,
} from "../../../Types/DatabaseServer/DatabaseServerMetricCatalog";
import ObjectID from "../../../Types/ObjectID";
import RangeStartAndEndDateTime from "../../../Types/Time/RangeStartAndEndDateTime";
import TimeRange from "../../../Types/Time/TimeRange";

/*
 * The Database Overview's aggregate queries. What these pin:
 *
 *   - every query carries `entityKeys: Includes(keys)`; the only attribute
 *     predicate ever sent is a catalog entry's own pin;
 *   - an EMPTY key set sends NO request at all — an empty Includes would be
 *     dropped server side and the Overview would chart the whole project;
 *   - span queries are CLIENT spans only (the ones carrying an endpoint key);
 *   - engine metrics are read PER SERIES: gauges grouped and combined as the
 *     catalog says, cumulative counters turned into a rate per series and
 *     then summed — never the Avg / Max of a pool of series (the audit's
 *     "279.6k connections", "Connections 17 of 100" and "Row lock waits:
 *     50/s" tiles);
 *   - the Metrics tab charts a histogram by percentile, a cumulative counter
 *     as a rate and keeps the metric's unit.
 */

jest.mock("../../../UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI", () => {
  return {
    __esModule: true,
    default: {
      aggregate: jest.fn(),
      getList: jest.fn(),
    },
  };
});

interface AggregateRequest {
  modelType: unknown;
  aggregateBy: Record<string, unknown>;
}

// Jest 28 typing: Mock<ReturnType, Args>.
type AggregateMock = jest.Mock<Promise<AggregatedResult>, [AggregateRequest]>;
type GetListMock = jest.Mock<
  Promise<{ data: Array<Record<string, unknown>>; count: number }>,
  [Record<string, unknown>]
>;

const aggregateMock: AggregateMock =
  AnalyticsModelAPI.aggregate as unknown as AggregateMock;
const getListMock: GetListMock =
  AnalyticsModelAPI.getList as unknown as GetListMock;

const PROJECT_ID: string = "5f2b7c1e-8d3a-4b6f-9c0d-1e2f3a4b5c6d";
const KEY_A: string = "0123456789abcdef";
const KEY_B: string = "fedcba9876543210";
const START: Date = new Date("2026-09-24T10:00:00.000Z");
const END: Date = new Date("2026-09-24T11:00:00.000Z");

function at(minute: number): Date {
  return new Date(START.getTime() + minute * 60 * 1000);
}

function result(rows: Array<Record<string, unknown>>): AggregatedResult {
  return { data: rows } as unknown as AggregatedResult;
}

function entry(
  metricName: string,
  pins?: Record<string, string>,
): DatabaseServerMetricDefinition {
  const found: DatabaseServerMetricDefinition | undefined =
    DATABASE_SERVER_METRICS.find(
      (candidate: DatabaseServerMetricDefinition): boolean => {
        return (
          candidate.metricName === metricName &&
          JSON.stringify(candidate.attributes || null) ===
            JSON.stringify(pins || candidate.attributes || null)
        );
      },
    );
  expect(found).toBeDefined();
  return found!;
}

function lastAggregateBy(): Record<string, unknown> {
  const calls: Array<[AggregateRequest]> = aggregateMock.mock.calls;
  expect(calls.length).toBeGreaterThan(0);
  return calls[calls.length - 1]![0].aggregateBy;
}

function queryOf(
  aggregateBy: Record<string, unknown>,
): Record<string, unknown> {
  return aggregateBy["query"] as Record<string, unknown>;
}

const WINDOW: {
  projectId: string;
  keys: Array<string>;
  start: Date;
  end: Date;
} = { projectId: PROJECT_ID, keys: [KEY_A], start: START, end: END };

afterEach(() => {
  aggregateMock.mockReset();
  getListMock.mockReset();
});

describe("buildDatabaseSpanQuery", () => {
  test("scopes CLIENT spans by the key set, the window and the project", () => {
    const query: Record<string, unknown> | null = buildDatabaseSpanQuery({
      projectId: PROJECT_ID,
      keys: [KEY_A, KEY_B],
      start: START,
      end: END,
    });

    expect(query).not.toBeNull();
    expect((query!["projectId"] as ObjectID).toString()).toBe(PROJECT_ID);
    expect(query!["kind"]).toBe(SpanKind.Client);
    expect(query!["entityKeys"]).toBeInstanceOf(Includes);
    expect((query!["entityKeys"] as Includes).values).toEqual([KEY_A, KEY_B]);

    const window: InBetween<Date> = query!["startTime"] as InBetween<Date>;
    expect(window).toBeInstanceOf(InBetween);
    expect(window.startValue).toEqual(START);
    expect(window.endValue).toEqual(END);

    // Keys are the ONLY scope: no attribute or entity-id predicate sneaks in.
    expect(query!["attributes"]).toBeUndefined();
    expect(query!["primaryEntityId"]).toBeUndefined();
    expect(query!["statusCode"]).toBeUndefined();
  });

  test("narrows to failed queries when asked", () => {
    const query: Record<string, unknown> | null = buildDatabaseSpanQuery(
      { projectId: PROJECT_ID, keys: [KEY_A], start: START, end: END },
      { errorsOnly: true },
    );

    expect(query!["statusCode"]).toBe(SpanStatus.Error);
  });

  test("is null for an empty key set or a missing project", () => {
    expect(buildDatabaseSpanQuery({ ...WINDOW, keys: [] })).toBeNull();
    expect(buildDatabaseSpanQuery({ ...WINDOW, projectId: null })).toBeNull();
  });

  test("accepts an ObjectID project id", () => {
    const query: Record<string, unknown> | null = buildDatabaseSpanQuery({
      ...WINDOW,
      projectId: new ObjectID(PROJECT_ID),
    });

    expect((query!["projectId"] as ObjectID).toString()).toBe(PROJECT_ID);
  });
});

describe("buildDatabaseMetricQuery", () => {
  test("scopes one metric name by the key set", () => {
    const query: Record<string, unknown> | null = buildDatabaseMetricQuery({
      ...WINDOW,
      metricName: " postgresql.backends ",
    });

    expect(query!["name"]).toBe("postgresql.backends");
    expect((query!["entityKeys"] as Includes).values).toEqual([KEY_A]);
    expect((query!["time"] as InBetween<Date>).startValue).toEqual(START);
    expect(query!["attributes"]).toBeUndefined();
  });

  test("a catalog pin narrows the metric to one breakdown value", () => {
    const query: Record<string, unknown> | null = buildDatabaseMetricQuery({
      ...WINDOW,
      metricName: "mongodb.connection.count",
      pins: { type: "current" },
    });

    expect(query!["attributes"]).toEqual({ type: "current" });
    // The pin narrows the metric; the keys still scope the database.
    expect((query!["entityKeys"] as Includes).values).toEqual([KEY_A]);
  });

  test("empty pins are no pins", () => {
    for (const pins of [{}, { "": "x" }, { kind: "" }, null, undefined]) {
      expect(
        buildDatabaseMetricQuery({
          ...WINDOW,
          metricName: "mysql.threads",
          pins: pins as Record<string, string> | null | undefined,
        })!["attributes"],
      ).toBeUndefined();
    }
  });

  test("is null for an empty key set, no project or no metric name", () => {
    const base: typeof WINDOW & { metricName: string } = {
      ...WINDOW,
      metricName: "postgresql.backends",
    };

    expect(buildDatabaseMetricQuery({ ...base, keys: [] })).toBeNull();
    expect(buildDatabaseMetricQuery({ ...base, projectId: "" })).toBeNull();
    expect(buildDatabaseMetricQuery({ ...base, metricName: "  " })).toBeNull();
    expect(
      buildDatabaseMetricQuery({
        ...base,
        keys: [],
        pins: { type: "current" },
      }),
    ).toBeNull();
  });
});

describe("series helpers", () => {
  test("aggregated rows become sorted time points; bad rows are skipped", () => {
    const points: Array<DatabaseTimePoint> = aggregatedResultToTimePoints(
      result([
        { timestamp: at(2).toISOString(), value: 4 },
        { timestamp: at(1), value: "2" },
        { time: at(3).getTime(), value: 6 },
        { timestamp: "not a date", value: 1 },
        { timestamp: at(4), value: "NaN" },
        { value: 9 },
      ]),
      10,
    );

    expect(points).toEqual([
      { x: at(1), y: 20 },
      { x: at(2), y: 40 },
      { x: at(3), y: 60 },
    ]);
  });

  test("an empty or missing result is an empty series", () => {
    expect(aggregatedResultToTimePoints(null)).toEqual([]);
    expect(aggregatedResultToTimePoints(result([]))).toEqual([]);
  });

  test("mean and latest", () => {
    const series: Array<DatabaseTimePoint> = [
      { x: at(2), y: 30 },
      { x: at(1), y: 10 },
    ];

    expect(meanOfSeries(series)).toBe(20);
    expect(latestOfSeries(series)).toBe(30);
    expect(meanOfSeries([])).toBeNull();
    expect(latestOfSeries([])).toBeNull();
  });

  test("a series key is its attribute map, independent of key order", () => {
    expect(getAttributeSeriesKey({ b: "2", a: "1" })).toBe(
      getAttributeSeriesKey({ a: "1", b: "2" }),
    );
    expect(getAttributeSeriesKey({ a: "1" })).not.toBe(
      getAttributeSeriesKey({ a: "2" }),
    );
    expect(getAttributeSeriesKey({ port: 5432 })).toBe(
      getAttributeSeriesKey({ port: "5432" }),
    );
    expect(getAttributeSeriesKey({ a: null })).toBe(
      getAttributeSeriesKey({ a: "" }),
    );
    expect(getAttributeSeriesKey(undefined)).toBe("{}");
    expect(getAttributeSeriesKey("junk")).toBe("{}");
  });
});

describe("combineGaugeSeries", () => {
  const db: (name: string) => Record<string, string> = (
    name: string,
  ): Record<string, string> => {
    return {
      "db.namespace": name,
      "resource.server.address": "db.prod",
      "resource.server.port": "5432",
    };
  };

  test("PostgreSQL backends add up across databases (the audit's '17 of 100')", () => {
    const rows: Array<Record<string, unknown>> = [
      { timestamp: at(0), value: 2, attributes: db("postgres") },
      { timestamp: at(0), value: 45, attributes: db("app") },
      { timestamp: at(0), value: 3, attributes: db("reporting") },
      { timestamp: at(1), value: 2, attributes: db("postgres") },
      { timestamp: at(1), value: 50, attributes: db("app") },
      { timestamp: at(1), value: 4, attributes: db("reporting") },
    ];

    expect(combineGaugeSeries(result(rows), "sum")).toEqual([
      { x: at(0), y: 50 },
      { x: at(1), y: 56 },
    ]);
    // The pooled Avg the old query took would have shown 16.67.
    expect(
      aggregatedResultToTimePoints(
        result([{ timestamp: at(0), value: (2 + 45 + 3) / 3 }]),
      )[0]!.y,
    ).toBeCloseTo(16.67, 1);
  });

  test("max keeps the worst series, min the lowest, avg averages", () => {
    const rows: Array<Record<string, unknown>> = [
      { timestamp: at(0), value: 10, attributes: { replication_client: "a" } },
      { timestamp: at(0), value: 70, attributes: { replication_client: "b" } },
      { timestamp: at(0), value: 40, attributes: { replication_client: "c" } },
    ];

    expect(combineGaugeSeries(result(rows), "max")).toEqual([
      { x: at(0), y: 70 },
    ]);
    expect(combineGaugeSeries(result(rows), "min")).toEqual([
      { x: at(0), y: 10 },
    ]);
    expect(combineGaugeSeries(result(rows), "avg")).toEqual([
      { x: at(0), y: 40 },
    ]);
  });

  test("two agents of one database are two series, whatever order the rows come in", () => {
    const rows: Array<Record<string, unknown>> = [
      {
        timestamp: at(1).toISOString(),
        value: 7,
        attributes: { "resource.server.address": "member-1" },
      },
      {
        timestamp: at(0),
        value: 5,
        attributes: { "resource.server.address": "member-1" },
      },
      {
        timestamp: at(1),
        value: 3,
        attributes: { "resource.server.address": "member-2" },
      },
    ];

    expect(combineGaugeSeries(result(rows), "sum")).toEqual([
      { x: at(0), y: 5 },
      { x: at(1), y: 10 },
    ]);
  });

  test("an ungrouped result (no attributes) is one series", () => {
    expect(
      combineGaugeSeries(
        result([
          { timestamp: at(0), value: 4 },
          { timestamp: at(1), value: 6 },
        ]),
        "sum",
      ),
    ).toEqual([
      { x: at(0), y: 4 },
      { x: at(1), y: 6 },
    ]);
  });

  test("rows without a bucket or a finite value are skipped", () => {
    expect(
      combineGaugeSeries(
        result([
          { timestamp: "nope", value: 4, attributes: { a: "1" } },
          { timestamp: at(0), value: "NaN", attributes: { a: "2" } },
          { timestamp: at(0), value: 9, attributes: { a: "3" } },
        ]),
        "sum",
      ),
    ).toEqual([{ x: at(0), y: 9 }]);
    expect(combineGaugeSeries(null, "sum")).toEqual([]);
  });
});

describe("counterResultToRatePerSecond", () => {
  test("commits of two databases: each series' rate, added up — not the rate of the Max", () => {
    const app: Record<string, string> = { "db.namespace": "app" };
    const legacy: Record<string, string> = { "db.namespace": "legacy" };
    const rows: Array<Record<string, unknown>> = [
      { timestamp: at(0), value: 1000, attributes: app },
      { timestamp: at(1), value: 7000, attributes: app },
      { timestamp: at(2), value: 13000, attributes: app },
      { timestamp: at(0), value: 9000, attributes: legacy },
      { timestamp: at(1), value: 9010, attributes: legacy },
      { timestamp: at(2), value: 9020, attributes: legacy },
    ];

    const rates: Array<DatabaseTimePoint> = counterResultToRatePerSecond(
      result(rows),
    );
    expect(
      rates.map((point: DatabaseTimePoint) => {
        return point.x;
      }),
    ).toEqual([at(1), at(2)]);
    for (const point of rates) {
      // (6000 + 10) / 60 s — the true total commit rate.
      expect(point.y).toBeCloseTo(100.17, 2);
    }
  });

  test("a reset in one series reads zero for that series and leaves the others alone", () => {
    const rows: Array<Record<string, unknown>> = [
      { timestamp: at(0), value: 5000, attributes: { kind: "a" } },
      { timestamp: at(1), value: 60, attributes: { kind: "a" } },
      { timestamp: at(0), value: 0, attributes: { kind: "b" } },
      { timestamp: at(1), value: 120, attributes: { kind: "b" } },
    ];

    expect(counterResultToRatePerSecond(result(rows))).toEqual([
      { x: at(1), y: 2 },
    ]);
  });

  test("one ungrouped series still becomes a rate", () => {
    expect(
      counterResultToRatePerSecond(
        result([
          { timestamp: at(0), value: 1000 },
          { timestamp: at(1), value: 1600 },
          { timestamp: at(2), value: 1600 },
          { timestamp: at(3), value: 2800 },
        ]),
      ),
    ).toEqual([
      { x: at(1), y: 10 },
      { x: at(2), y: 0 },
      { x: at(3), y: 20 },
    ]);
  });

  test("needs two points of a series; bad rows are ignored", () => {
    expect(counterResultToRatePerSecond(null)).toEqual([]);
    expect(counterResultToRatePerSecond(result([]))).toEqual([]);
    expect(
      counterResultToRatePerSecond(
        result([
          { timestamp: at(0), value: 5, attributes: { a: "1" } },
          { timestamp: at(1), value: 9, attributes: { a: "2" } },
          { timestamp: "nope", value: 50, attributes: { a: "1" } },
          { timestamp: at(2), value: "NaN", attributes: { a: "1" } },
        ]),
      ),
    ).toEqual([]);
  });
});

describe("toEngineMetricResult", () => {
  test("a gauge shows its latest bucket", () => {
    const engine: DatabaseEngineMetricResult = toEngineMetricResult(
      entry("postgresql.backends"),
      [
        { x: at(1), y: 15 },
        { x: at(0), y: 12 },
      ],
    );

    expect(engine.series).toEqual([
      { x: at(0), y: 12 },
      { x: at(1), y: 15 },
    ]);
    expect(engine.value).toBe(15);
  });

  test("a counter's series is already a rate; it shows the mean rate", () => {
    const engine: DatabaseEngineMetricResult = toEngineMetricResult(
      entry("postgresql.commits"),
      [
        { x: at(1), y: 1 },
        { x: at(2), y: 2 },
      ],
    );

    expect(engine.value).toBe(1.5);
  });

  test("hasEngineMetricData is true only when some series has points", () => {
    const gauge: DatabaseServerMetricDefinition = entry("postgresql.backends");
    expect(hasEngineMetricData([])).toBe(false);
    expect(hasEngineMetricData([toEngineMetricResult(gauge, [])])).toBe(false);
    expect(
      hasEngineMetricData([
        toEngineMetricResult(gauge, []),
        toEngineMetricResult(gauge, [{ x: at(0), y: 1 }]),
      ]),
    ).toBe(true);
  });
});

describe("fetchDatabaseCatalogMetricSeries", () => {
  test("a gauge is grouped by its series keys and instance, then combined", async () => {
    const definition: DatabaseServerMetricDefinition = entry(
      "postgresql.backends",
    );
    aggregateMock.mockResolvedValue(
      result([
        { timestamp: at(0), value: 1, attributes: { "db.namespace": "a" } },
        { timestamp: at(0), value: 60, attributes: { "db.namespace": "b" } },
      ]),
    );

    const series: Array<DatabaseTimePoint> =
      await fetchDatabaseCatalogMetricSeries({ ...WINDOW, definition });

    expect(series).toEqual([{ x: at(0), y: 61 }]);
    const aggregateBy: Record<string, unknown> = lastAggregateBy();
    expect(aggregateMock.mock.calls[0]![0].modelType).toBe(Metric);
    expect(aggregateBy["aggregationType"]).toBe(AggregationType.Avg);
    expect(aggregateBy["groupByAttributeKeys"]).toEqual(
      getDatabaseServerMetricGroupKeys(definition),
    );
    expect(aggregateBy["groupBy"]).toBeUndefined();
    expect(queryOf(aggregateBy)["name"]).toBe("postgresql.backends");
    expect(queryOf(aggregateBy)["attributes"]).toBeUndefined();
  });

  test("MongoDB connections send their pin — available connections never enter the tile", async () => {
    const definition: DatabaseServerMetricDefinition = entry(
      "mongodb.connection.count",
    );
    // The server honours the pin; the receiver repeats it per database.
    aggregateMock.mockResolvedValue(
      result([
        {
          timestamp: at(0),
          value: 50,
          attributes: {
            "resource.server.address": "mongo.prod",
            "resource.server.port": "27017",
          },
        },
      ]),
    );

    const series: Array<DatabaseTimePoint> =
      await fetchDatabaseCatalogMetricSeries({ ...WINDOW, definition });

    expect(series).toEqual([{ x: at(0), y: 50 }]);
    const aggregateBy: Record<string, unknown> = lastAggregateBy();
    expect(queryOf(aggregateBy)["attributes"]).toEqual({ type: "current" });
    // Per-database copies are pooled with Avg inside the instance group.
    expect(aggregateBy["groupByAttributeKeys"]).toEqual([
      "resource.server.address",
      "resource.server.port",
    ]);
    expect(aggregateBy["aggregationType"]).toBe(AggregationType.Avg);
  });

  test("MySQL connected and running threads are two pinned queries", async () => {
    aggregateMock.mockResolvedValue(result([]));

    for (const kind of ["connected", "running"]) {
      await fetchDatabaseCatalogMetricSeries({
        ...WINDOW,
        definition: entry("mysql.threads", { kind }),
      });
      expect(queryOf(lastAggregateBy())["attributes"]).toEqual({ kind });
    }
  });

  test("a counter is grouped by its whole attribute set and becomes a rate per series", async () => {
    const definition: DatabaseServerMetricDefinition = entry("mysql.row_locks");
    aggregateMock.mockResolvedValue(
      result([
        { timestamp: at(0), value: 100, attributes: { kind: "waits" } },
        { timestamp: at(1), value: 106, attributes: { kind: "waits" } },
      ]),
    );

    const series: Array<DatabaseTimePoint> =
      await fetchDatabaseCatalogMetricSeries({ ...WINDOW, definition });

    expect(series).toEqual([{ x: at(1), y: 0.1 }]);
    const aggregateBy: Record<string, unknown> = lastAggregateBy();
    expect(aggregateBy["aggregationType"]).toBe(AggregationType.Max);
    expect(aggregateBy["groupBy"]).toEqual({ attributes: true });
    expect(aggregateBy["groupByAttributeKeys"]).toBeUndefined();
    // Waits only: the cumulative lock-time series is never read.
    expect(queryOf(aggregateBy)["attributes"]).toEqual({ kind: "waits" });
  });

  test("the picked aggregation overrides a gauge's per-series aggregation", async () => {
    aggregateMock.mockResolvedValue(result([]));

    await fetchDatabaseCatalogMetricSeries({
      ...WINDOW,
      definition: entry("postgresql.backends"),
      aggregationType: AggregationType.Max,
    });

    expect(lastAggregateBy()["aggregationType"]).toBe(AggregationType.Max);
  });

  test("never queries without keys, and a failure is an empty series", async () => {
    expect(
      await fetchDatabaseCatalogMetricSeries({
        ...WINDOW,
        keys: [],
        definition: entry("postgresql.backends"),
      }),
    ).toEqual([]);
    expect(aggregateMock).not.toHaveBeenCalled();

    aggregateMock.mockRejectedValue(new Error("boom"));
    for (const name of ["postgresql.backends", "postgresql.commits"]) {
      expect(
        await fetchDatabaseCatalogMetricSeries({
          ...WINDOW,
          definition: entry(name),
        }),
      ).toEqual([]);
    }
  });
});

describe("fetchDatabaseGaugeSeries / fetchDatabaseCounterRateSeries", () => {
  test("the gauge fetcher sends its keys and combine", async () => {
    aggregateMock.mockResolvedValue(
      result([
        { timestamp: at(0), value: 3, attributes: { status: "dirty" } },
        { timestamp: at(0), value: 5, attributes: { status: "clean" } },
      ]),
    );

    expect(
      await fetchDatabaseGaugeSeries({
        ...WINDOW,
        metricName: "mysql.buffer_pool.usage",
        aggregationType: AggregationType.Avg,
        groupKeys: ["status"],
        combine: "sum",
      }),
    ).toEqual([{ x: at(0), y: 8 }]);
    expect(lastAggregateBy()["groupByAttributeKeys"]).toEqual(["status"]);
  });

  test("the rate fetcher reads Max per series", async () => {
    aggregateMock.mockResolvedValue(
      result([
        { timestamp: at(0), value: 0, attributes: { a: "1" } },
        { timestamp: at(1), value: 600, attributes: { a: "1" } },
      ]),
    );

    expect(
      await fetchDatabaseCounterRateSeries({
        ...WINDOW,
        metricName: "postgresql.deadlocks",
      }),
    ).toEqual([{ x: at(1), y: 10 }]);
    expect(lastAggregateBy()["aggregationType"]).toBe(AggregationType.Max);
    expect(lastAggregateBy()["groupBy"]).toEqual({ attributes: true });
  });

  test("neither queries without keys", async () => {
    expect(
      await fetchDatabaseGaugeSeries({
        ...WINDOW,
        keys: [],
        metricName: "x",
        aggregationType: AggregationType.Avg,
        groupKeys: [],
        combine: "sum",
      }),
    ).toEqual([]);
    expect(
      await fetchDatabaseCounterRateSeries({
        ...WINDOW,
        keys: [],
        metricName: "x",
      }),
    ).toEqual([]);
    expect(aggregateMock).not.toHaveBeenCalled();
  });
});

describe("combineCallingServiceResults", () => {
  test("joins calls, errors and p95 per service, busiest first", () => {
    const combined: DatabaseCallingServices = combineCallingServiceResults({
      countResult: result([
        { primaryEntityId: "svc-a", value: 100, timestamp: START },
        { primaryEntityId: "svc-b", value: 400, timestamp: START },
        { primaryEntityId: "svc-c", value: 50, timestamp: START },
      ]),
      errorResult: result([
        { primaryEntityId: "svc-a", value: 5, timestamp: START },
      ]),
      p95Result: result([
        { primaryEntityId: "svc-a", value: 2_000_000, timestamp: START },
        { primaryEntityId: "svc-b", value: 500_000, timestamp: START },
      ]),
    });

    expect(combined.total).toBe(3);
    expect(combined.services).toEqual([
      {
        serviceId: "svc-b",
        calls: 400,
        errors: 0,
        errorRatePercent: 0,
        p95DurationMs: 0.5,
      },
      {
        serviceId: "svc-a",
        calls: 100,
        errors: 5,
        errorRatePercent: 5,
        p95DurationMs: 2,
      },
      {
        serviceId: "svc-c",
        calls: 50,
        errors: 0,
        errorRatePercent: 0,
        p95DurationMs: null,
      },
    ]);
  });

  test("sums a service's rows, caps errors at calls and honours the limit", () => {
    const combined: DatabaseCallingServices = combineCallingServiceResults({
      countResult: result([
        { primaryEntityId: "svc-a", value: 3 },
        { primaryEntityId: "svc-a", value: 2 },
        { primaryEntityId: "svc-b", value: 1 },
        { primaryEntityId: "", value: 99 },
        { primaryEntityId: null, value: 99 },
      ]),
      errorResult: result([{ primaryEntityId: "svc-a", value: 50 }]),
      p95Result: null,
      limit: 1,
    });

    expect(combined.services).toEqual([
      {
        serviceId: "svc-a",
        calls: 5,
        errors: 5,
        errorRatePercent: 100,
        p95DurationMs: null,
      },
    ]);
    // Rows without a service id are no service.
    expect(combined.total).toBe(2);
  });

  test("the total counts every calling service, not just the ten in the table (the audit's cap)", () => {
    const rows: Array<Record<string, unknown>> = [];
    for (let i: number = 0; i < 25; i++) {
      rows.push({ primaryEntityId: `svc-${i}`, value: 100 - i });
    }

    const combined: DatabaseCallingServices = combineCallingServiceResults({
      countResult: result(rows),
      errorResult: null,
      p95Result: null,
    });

    expect(combined.services).toHaveLength(10);
    expect(combined.total).toBe(25);
    expect(combined.services[0]!.serviceId).toBe("svc-0");
  });

  test("ties are ordered by id so the table is stable between refreshes", () => {
    const combined: DatabaseCallingServices = combineCallingServiceResults({
      countResult: result([
        { primaryEntityId: "svc-b", value: 7 },
        { primaryEntityId: "svc-a", value: 7 },
      ]),
      errorResult: null,
      p95Result: null,
    });

    expect(
      combined.services.map((row: { serviceId: string }): string => {
        return row.serviceId;
      }),
    ).toEqual(["svc-a", "svc-b"]);
  });
});

describe("fetchers never query without a scope", () => {
  test("fetchDatabaseQueryMetrics resolves empty with no request for no keys", async () => {
    expect(await fetchDatabaseQueryMetrics({ ...WINDOW, keys: [] })).toEqual(
      EMPTY_DATABASE_QUERY_METRICS,
    );
    expect(aggregateMock).not.toHaveBeenCalled();
  });

  test("fetchDatabaseCallingServices resolves empty with no request for no keys", async () => {
    expect(await fetchDatabaseCallingServices({ ...WINDOW, keys: [] })).toEqual(
      EMPTY_DATABASE_CALLING_SERVICES,
    );
    expect(aggregateMock).not.toHaveBeenCalled();
  });

  test("fetchDatabaseMetricSeries resolves empty with no request for no keys", async () => {
    expect(
      await fetchDatabaseMetricSeries({
        ...WINDOW,
        keys: [],
        metricName: "postgresql.backends",
        aggregationType: AggregationType.Avg,
      }),
    ).toEqual([]);
    expect(aggregateMock).not.toHaveBeenCalled();
  });

  test("fetchDatabaseEngineMetrics resolves empty with no request for no keys", async () => {
    expect(
      await fetchDatabaseEngineMetrics({
        ...WINDOW,
        keys: [],
        metrics: getDatabaseServerMetrics("postgresql"),
      }),
    ).toEqual([]);
    expect(aggregateMock).not.toHaveBeenCalled();
  });

  test("fetchDatabaseMetricShape resolves unknown with no request for no keys", async () => {
    expect(
      await fetchDatabaseMetricShape({
        ...WINDOW,
        keys: [],
        metricName: "db.client.operation.duration",
        unit: "s",
      }),
    ).toEqual({ ...UNKNOWN_DATABASE_METRIC_SHAPE, unit: "s" });
    expect(getListMock).not.toHaveBeenCalled();
  });
});

describe("fetchers with a scope", () => {
  test("fetchDatabaseQueryMetrics: counts, errors, per-bucket p95 and ONE p95 over the window", async () => {
    aggregateMock.mockImplementation(
      async (data: AggregateRequest): Promise<AggregatedResult> => {
        const query: Record<string, unknown> = queryOf(data.aggregateBy);
        if (data.aggregateBy["aggregationType"] === AggregationType.P95) {
          if (
            data.aggregateBy["aggregationInterval"] ===
            AggregationInterval.Total
          ) {
            return result([{ value: 9_000_000 }]);
          }
          return result([
            { timestamp: at(0), value: 4_000_000 },
            { timestamp: at(1), value: 6_000_000 },
          ]);
        }
        if (query["statusCode"] === SpanStatus.Error) {
          return result([{ timestamp: at(1), value: 5 }]);
        }
        return result([
          { timestamp: at(0), value: 40 },
          { timestamp: at(1), value: 60 },
        ]);
      },
    );

    const metrics: DatabaseQueryMetrics =
      await fetchDatabaseQueryMetrics(WINDOW);

    expect(aggregateMock).toHaveBeenCalledTimes(4);
    for (const call of aggregateMock.mock.calls) {
      expect(call[0].modelType).toBe(Span);
      const aggregateBy: Record<string, unknown> = call[0].aggregateBy;
      expect((queryOf(aggregateBy)["entityKeys"] as Includes).values).toEqual([
        KEY_A,
      ]);
      expect(queryOf(aggregateBy)["kind"]).toBe(SpanKind.Client);
      expect(aggregateBy["aggregateColumnName"]).toBe("durationUnixNano");
      expect(aggregateBy["aggregationTimestampColumnName"]).toBe("startTime");
      expect(aggregateBy["startTimestamp"]).toEqual(START);
      expect(aggregateBy["endTimestamp"]).toEqual(END);
    }

    expect(metrics.total).toBe(100);
    expect(metrics.errors).toBe(5);
    expect(metrics.errorRatePercent).toBe(5);
    // Not the mean of the bucket p95s (5 ms): the window's own p95.
    expect(metrics.p95DurationMs).toBe(9);
    expect(metrics.countSeries).toHaveLength(2);
    expect(metrics.p95Series).toEqual([
      { x: at(0), y: 4 },
      { x: at(1), y: 6 },
    ]);
  });

  test("no queries in the window means no p95", async () => {
    aggregateMock.mockImplementation(
      async (data: AggregateRequest): Promise<AggregatedResult> => {
        if (
          data.aggregateBy["aggregationInterval"] === AggregationInterval.Total
        ) {
          return result([{ value: 0 }]);
        }
        return result([]);
      },
    );

    const metrics: DatabaseQueryMetrics =
      await fetchDatabaseQueryMetrics(WINDOW);
    expect(metrics.total).toBe(0);
    expect(metrics.p95DurationMs).toBeNull();
    expect(metrics.errorRatePercent).toBeNull();
  });

  test("a failed request resolves to the empty results", async () => {
    aggregateMock.mockImplementation(async (): Promise<AggregatedResult> => {
      throw new Error("boom");
    });

    expect(await fetchDatabaseQueryMetrics(WINDOW)).toEqual(
      EMPTY_DATABASE_QUERY_METRICS,
    );
    expect(await fetchDatabaseCallingServices(WINDOW)).toEqual(
      EMPTY_DATABASE_CALLING_SERVICES,
    );
    expect(
      await fetchDatabaseMetricSeries({
        ...WINDOW,
        metricName: "postgresql.backends",
        aggregationType: AggregationType.Avg,
      }),
    ).toEqual([]);
  });

  test("fetchDatabaseCallingServices groups by the calling service over the whole window", async () => {
    aggregateMock.mockImplementation(
      async (data: AggregateRequest): Promise<AggregatedResult> => {
        const query: Record<string, unknown> = queryOf(data.aggregateBy);
        if (data.aggregateBy["aggregationType"] === AggregationType.P95) {
          return result([{ primaryEntityId: "svc-a", value: 3_000_000 }]);
        }
        if (query["statusCode"] === SpanStatus.Error) {
          return result([{ primaryEntityId: "svc-a", value: 1 }]);
        }
        return result([{ primaryEntityId: "svc-a", value: 10 }]);
      },
    );

    const combined: DatabaseCallingServices =
      await fetchDatabaseCallingServices({ ...WINDOW, keys: [KEY_A, KEY_B] });

    expect(aggregateMock).toHaveBeenCalledTimes(3);
    for (const call of aggregateMock.mock.calls) {
      const aggregateBy: Record<string, unknown> = call[0].aggregateBy;
      expect(aggregateBy["groupBy"]).toEqual({ primaryEntityId: true });
      expect(aggregateBy["aggregationInterval"]).toBe(
        AggregationInterval.Total,
      );
      expect((queryOf(aggregateBy)["entityKeys"] as Includes).values).toEqual([
        KEY_A,
        KEY_B,
      ]);
    }
    expect(combined).toEqual({
      total: 1,
      services: [
        {
          serviceId: "svc-a",
          calls: 10,
          errors: 1,
          errorRatePercent: 10,
          p95DurationMs: 3,
        },
      ],
    });
  });

  test("fetchDatabaseEngineMetrics fetches every catalog entry the way its kind needs", async () => {
    const catalog: Array<DatabaseServerMetricDefinition> =
      getDatabaseServerMetrics("redis");
    aggregateMock.mockImplementation(async (): Promise<AggregatedResult> => {
      return result([
        { timestamp: at(0), value: 100 },
        { timestamp: at(1), value: 160 },
      ]);
    });

    const results: Array<DatabaseEngineMetricResult> =
      await fetchDatabaseEngineMetrics({ ...WINDOW, metrics: catalog });

    expect(catalog.length).toBeGreaterThan(0);
    expect(aggregateMock).toHaveBeenCalledTimes(catalog.length);
    expect(results).toHaveLength(catalog.length);

    catalog.forEach(
      (definition: DatabaseServerMetricDefinition, index: number): void => {
        const call: AggregateRequest = aggregateMock.mock.calls[index]![0];
        expect(call.modelType).toBe(Metric);
        expect(queryOf(call.aggregateBy)["name"]).toBe(definition.metricName);

        const engine: DatabaseEngineMetricResult = results[index]!;
        expect(engine.definition).toBe(definition);
        if (definition.kind === "counter") {
          expect(call.aggregateBy["aggregationType"]).toBe(AggregationType.Max);
          expect(call.aggregateBy["groupBy"]).toEqual({ attributes: true });
          expect(engine.series).toEqual([{ x: at(1), y: 1 }]);
        } else {
          expect(call.aggregateBy["aggregationType"]).toBe(
            definition.aggregation,
          );
          expect(call.aggregateBy["groupByAttributeKeys"]).toEqual(
            getDatabaseServerMetricGroupKeys(definition),
          );
          expect(engine.value).toBe(160);
        }
      },
    );
  });
});

describe("fetchDatabaseMetricShape", () => {
  test("reads the newest point's type, monotonicity and temporality over the keys", async () => {
    getListMock.mockResolvedValue({
      data: [
        {
          metricPointType: MetricPointType.Histogram,
          isMonotonic: false,
          aggregationTemporality: AggregationTemporality.Cumulative,
        },
      ],
      count: 1,
    });

    const shape: DatabaseMetricShape = await fetchDatabaseMetricShape({
      ...WINDOW,
      metricName: "db.client.operation.duration",
      unit: " s ",
    });

    expect(shape).toEqual({
      unit: "s",
      pointType: MetricPointType.Histogram,
      isMonotonic: false,
      aggregationTemporality: AggregationTemporality.Cumulative,
    });
    const request: Record<string, unknown> = getListMock.mock.calls[0]![0];
    expect(request["modelType"]).toBe(Metric);
    expect(request["limit"]).toBe(1);
    expect(request["sort"]).toEqual({ time: SortOrder.Descending });
    expect(request["select"]).toEqual({
      metricPointType: true,
      isMonotonic: true,
      aggregationTemporality: true,
    });
    const query: Record<string, unknown> = request["query"] as Record<
      string,
      unknown
    >;
    expect(query["name"]).toBe("db.client.operation.duration");
    expect((query["entityKeys"] as Includes).values).toEqual([KEY_A]);
  });

  test("unknown values, no data and failures are the unknown shape", async () => {
    getListMock.mockResolvedValueOnce({
      data: [{ metricPointType: "Weird", isMonotonic: "yes" }],
      count: 1,
    });
    expect(
      await fetchDatabaseMetricShape({ ...WINDOW, metricName: "m" }),
    ).toEqual(UNKNOWN_DATABASE_METRIC_SHAPE);

    getListMock.mockResolvedValueOnce({ data: [], count: 0 });
    expect(
      await fetchDatabaseMetricShape({ ...WINDOW, metricName: "m" }),
    ).toEqual(UNKNOWN_DATABASE_METRIC_SHAPE);

    getListMock.mockRejectedValueOnce(new Error("boom"));
    expect(
      await fetchDatabaseMetricShape({
        ...WINDOW,
        metricName: "m",
        unit: "By",
      }),
    ).toEqual({ ...UNKNOWN_DATABASE_METRIC_SHAPE, unit: "By" });
  });
});

/*
 * The Metrics tab charts a clicked metric in place (the metric explorer
 * scopes by attributes only and would chart the whole project): the same
 * key-set scope, and each metric read by what it is.
 */
describe("the Metrics tab's in-place metric chart", () => {
  test("a curated gauge keeps its catalog title, combine and aggregation", () => {
    const spec: DatabaseMetricChartSpec = getDatabaseMetricChartSpec(
      "postgresql.backends",
      "postgres",
    );

    expect(spec.definition?.metricName).toBe("postgresql.backends");
    expect(spec.mode).toBe("catalog");
    expect(spec.title).toBe("Connections");
    expect(spec.defaultAggregation).toBe(AggregationType.Avg);
    expect(spec.aggregations).toEqual(
      DATABASE_METRIC_CATALOG_GAUGE_AGGREGATIONS,
    );
    expect(spec.isRate).toBe(false);
  });

  test("a curated counter is a per-second rate with nothing to pick", () => {
    const spec: DatabaseMetricChartSpec = getDatabaseMetricChartSpec(
      "postgresql.commits",
      "postgresql",
    );

    expect(spec.title).toBe("Commits (per second)");
    expect(spec.mode).toBe("catalog");
    expect(spec.aggregations).toEqual([]);
    expect(spec.isRate).toBe(true);
  });

  test("a metric curated only with pins charts its first entry, named for what it shows", () => {
    const spec: DatabaseMetricChartSpec = getDatabaseMetricChartSpec(
      "mysql.threads",
      "mysql",
    );
    expect(spec.title).toBe("Connected threads");
    expect(spec.definition?.attributes).toEqual({ kind: "connected" });
  });

  test("a histogram is charted by percentile, p95 first (the audit's 'average of sums')", () => {
    for (const pointType of [
      MetricPointType.Histogram,
      MetricPointType.ExponentialHistogram,
    ]) {
      const spec: DatabaseMetricChartSpec = getDatabaseMetricChartSpec(
        "db.client.operation.duration",
        "postgresql",
        { pointType, unit: "s" },
      );
      expect(spec.mode).toBe("aggregate");
      expect(spec.isDistribution).toBe(true);
      expect(spec.defaultAggregation).toBe(AggregationType.P95);
      expect(spec.aggregations).toEqual(
        DATABASE_METRIC_DISTRIBUTION_AGGREGATIONS,
      );
      expect(spec.aggregations).not.toContain(AggregationType.Sum);
      expect(spec.unit).toBe("s");
    }
  });

  test("a cumulative monotonic sum is a per-second rate (the audit's ever-rising deadlocks line)", () => {
    const spec: DatabaseMetricChartSpec = getDatabaseMetricChartSpec(
      "postgresql.deadlocks",
      "postgresql",
      {
        pointType: MetricPointType.Sum,
        isMonotonic: true,
        aggregationTemporality: AggregationTemporality.Cumulative,
        unit: "1",
      },
    );
    expect(spec.mode).toBe("rate");
    expect(spec.isRate).toBe(true);
    expect(spec.title).toBe("postgresql.deadlocks (per second)");
    expect(spec.aggregations).toEqual([]);

    // Temporality unknown but a monotonic Sum: still a counter.
    expect(
      getDatabaseMetricChartSpec("x", null, {
        pointType: MetricPointType.Sum,
        isMonotonic: true,
      }).mode,
    ).toBe("rate");
  });

  test("a delta counter defaults to its Sum per interval", () => {
    const spec: DatabaseMetricChartSpec = getDatabaseMetricChartSpec(
      "requests",
      null,
      {
        pointType: MetricPointType.Sum,
        isMonotonic: true,
        aggregationTemporality: AggregationTemporality.Delta,
      },
    );
    expect(spec.mode).toBe("aggregate");
    expect(spec.defaultAggregation).toBe(AggregationType.Sum);
    expect(spec.aggregations).toEqual(
      DATABASE_METRIC_DELTA_COUNTER_AGGREGATIONS,
    );
  });

  test("anything else is averaged under its own name", () => {
    for (const [metricName, dbSystem, shape] of [
      ["db.client.connection.count", "postgresql", undefined],
      // A curated name of ANOTHER engine is not curated for this one.
      ["postgresql.commits", "mysql", null],
      ["k8s.pod.cpu.utilization", null, { pointType: MetricPointType.Gauge }],
      [
        "postgresql.backends.x",
        "postgresql",
        { pointType: MetricPointType.Sum, isMonotonic: false },
      ],
    ] as Array<[string, string | null, Partial<DatabaseMetricShape> | null]>) {
      const spec: DatabaseMetricChartSpec = getDatabaseMetricChartSpec(
        metricName,
        dbSystem,
        shape,
      );
      expect(spec.definition).toBeNull();
      expect(spec.mode).toBe("aggregate");
      expect(spec.title).toBe(metricName);
      expect(spec.defaultAggregation).toBe(AggregationType.Avg);
      expect(spec.aggregations).toEqual(DATABASE_METRIC_GAUGE_AGGREGATIONS);
      expect(spec.isRate).toBe(false);
    }
  });

  test("never queries without keys", async () => {
    expect(
      await fetchDatabaseMetricChartSeries({
        ...WINDOW,
        keys: [],
        spec: getDatabaseMetricChartSpec("postgresql.backends", "postgresql"),
        aggregationType: AggregationType.Avg,
      }),
    ).toEqual([]);
    expect(aggregateMock).not.toHaveBeenCalled();
  });

  test("a plain metric is charted over the key set with the chosen aggregation", async () => {
    aggregateMock.mockResolvedValue(
      result([
        { timestamp: at(0), value: 4 },
        { timestamp: at(1), value: 6 },
      ]),
    );

    const points: Array<DatabaseTimePoint> =
      await fetchDatabaseMetricChartSeries({
        ...WINDOW,
        keys: [KEY_A, KEY_B],
        spec: getDatabaseMetricChartSpec(
          "db.client.operation.duration",
          "postgresql",
          { pointType: MetricPointType.Histogram },
        ),
        aggregationType: AggregationType.P99,
      });

    expect(points).toEqual([
      { x: at(0), y: 4 },
      { x: at(1), y: 6 },
    ]);
    const aggregateBy: Record<string, unknown> = lastAggregateBy();
    expect(aggregateBy["aggregationType"]).toBe(AggregationType.P99);
    expect(aggregateBy["groupBy"]).toBeUndefined();
    expect(aggregateBy["groupByAttributeKeys"]).toBeUndefined();
    const query: Record<string, unknown> = queryOf(aggregateBy);
    expect(query["name"]).toBe("db.client.operation.duration");
    expect((query["entityKeys"] as Includes).values).toEqual([KEY_A, KEY_B]);
    expect(query["attributes"]).toBeUndefined();
  });

  test("a curated counter is read per series whatever aggregation is asked", async () => {
    aggregateMock.mockResolvedValue(
      result([
        { timestamp: at(0), value: 0, attributes: { "db.namespace": "a" } },
        { timestamp: at(1), value: 600, attributes: { "db.namespace": "a" } },
      ]),
    );

    const points: Array<DatabaseTimePoint> =
      await fetchDatabaseMetricChartSeries({
        ...WINDOW,
        spec: getDatabaseMetricChartSpec("postgresql.commits", "postgresql"),
        aggregationType: AggregationType.Sum,
      });

    expect(points).toEqual([{ x: at(1), y: 10 }]);
    expect(lastAggregateBy()["aggregationType"]).toBe(AggregationType.Max);
    expect(lastAggregateBy()["groupBy"]).toEqual({ attributes: true });
  });

  test("a curated gauge takes a picked per-series aggregation, never a Sum of samples", async () => {
    aggregateMock.mockResolvedValue(result([]));
    const spec: DatabaseMetricChartSpec = getDatabaseMetricChartSpec(
      "postgresql.backends",
      "postgresql",
    );

    await fetchDatabaseMetricChartSeries({
      ...WINDOW,
      spec,
      aggregationType: AggregationType.Max,
    });
    expect(lastAggregateBy()["aggregationType"]).toBe(AggregationType.Max);

    await fetchDatabaseMetricChartSeries({
      ...WINDOW,
      spec,
      aggregationType: AggregationType.Sum,
    });
    expect(lastAggregateBy()["aggregationType"]).toBe(AggregationType.Avg);
    expect(lastAggregateBy()["groupByAttributeKeys"]).toEqual(
      getDatabaseServerMetricGroupKeys(spec.definition!),
    );
  });

  test("a cumulative counter outside the catalog is a rate per series", async () => {
    aggregateMock.mockResolvedValue(
      result([
        { timestamp: at(0), value: 0, attributes: { "db.namespace": "a" } },
        { timestamp: at(1), value: 60, attributes: { "db.namespace": "a" } },
        { timestamp: at(0), value: 100, attributes: { "db.namespace": "b" } },
        { timestamp: at(1), value: 160, attributes: { "db.namespace": "b" } },
      ]),
    );

    const points: Array<DatabaseTimePoint> =
      await fetchDatabaseMetricChartSeries({
        ...WINDOW,
        spec: getDatabaseMetricChartSpec("postgresql.deadlocks", "postgresql", {
          pointType: MetricPointType.Sum,
          isMonotonic: true,
          aggregationTemporality: AggregationTemporality.Cumulative,
        }),
        aggregationType: AggregationType.Avg,
      });

    expect(points).toEqual([{ x: at(1), y: 2 }]);
    expect(lastAggregateBy()["groupBy"]).toEqual({ attributes: true });
  });
});

describe("getDatabaseMetricsRangeFromSearch", () => {
  test("reads a named range from the list's URL", () => {
    expect(
      getDatabaseMetricsRangeFromSearch(`?range=${TimeRange.PAST_ONE_DAY}`),
    ).toEqual({ range: TimeRange.PAST_ONE_DAY });
  });

  test("reads a custom range with its dates", () => {
    const range: RangeStartAndEndDateTime = getDatabaseMetricsRangeFromSearch(
      `?range=${TimeRange.CUSTOM}&start=${encodeURIComponent(
        START.toISOString(),
      )}&end=${encodeURIComponent(END.toISOString())}`,
    );
    expect(range.range).toBe(TimeRange.CUSTOM);
    expect(range.startAndEndDate?.startValue).toEqual(START);
    expect(range.startAndEndDate?.endValue).toEqual(END);
  });

  test("anything unreadable is the past hour", () => {
    for (const search of [
      "",
      null,
      undefined,
      "?range=nope",
      `?range=${TimeRange.CUSTOM}`,
      `?range=${TimeRange.CUSTOM}&start=x&end=y`,
    ]) {
      expect(getDatabaseMetricsRangeFromSearch(search)).toEqual({
        range: TimeRange.PAST_ONE_HOUR,
      });
    }
  });
});
