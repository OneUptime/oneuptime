import { afterEach, describe, expect, jest, test } from "@jest/globals";
import {
  DatabaseCallingService,
  DatabaseEngineMetricResult,
  DatabaseQueryMetrics,
  DatabaseTimePoint,
  EMPTY_DATABASE_QUERY_METRICS,
  aggregatedResultToTimePoints,
  buildDatabaseMetricQuery,
  buildDatabaseSpanQuery,
  combineCallingServiceResults,
  counterSeriesToRatePerSecond,
  fetchDatabaseCallingServices,
  fetchDatabaseEngineMetrics,
  fetchDatabaseMetricSeries,
  fetchDatabaseQueryMetrics,
  hasEngineMetricData,
  latestOfSeries,
  meanOfSeries,
  toEngineMetricResult,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Database/Utils/DatabaseServerTelemetryQueries";
import AnalyticsModelAPI from "../../../UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI";
import Metric from "../../../Models/AnalyticsModels/Metric";
import Span, {
  SpanKind,
  SpanStatus,
} from "../../../Models/AnalyticsModels/Span";
import AggregatedResult from "../../../Types/BaseDatabase/AggregatedResult";
import AggregationInterval from "../../../Types/BaseDatabase/AggregationInterval";
import AggregationType from "../../../Types/BaseDatabase/AggregationType";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import Includes from "../../../Types/BaseDatabase/Includes";
import {
  DatabaseServerMetricDefinition,
  getDatabaseServerMetrics,
} from "../../../Types/DatabaseServer/DatabaseServerMetricCatalog";
import ObjectID from "../../../Types/ObjectID";

/*
 * The Database Overview's aggregate queries. What these pin:
 *
 *   - every query carries `entityKeys: Includes(keys)` and nothing else
 *     scopes it (no attribute, no primaryEntityId);
 *   - an EMPTY key set sends NO request at all — an empty Includes would be
 *     dropped server side and the Overview would chart the whole project;
 *   - span queries are CLIENT spans only (the ones carrying an endpoint key);
 *   - counter metrics are converted to per-second rates client-side, and a
 *     counter reset is skipped rather than charted as a negative rate.
 */

jest.mock("../../../UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI", () => {
  return {
    __esModule: true,
    default: {
      aggregate: jest.fn(),
    },
  };
});

interface AggregateRequest {
  modelType: unknown;
  aggregateBy: Record<string, unknown>;
}

// Jest 28 typing: Mock<ReturnType, Args>.
type AggregateMock = jest.Mock<Promise<AggregatedResult>, [AggregateRequest]>;

const aggregateMock: AggregateMock =
  AnalyticsModelAPI.aggregate as unknown as AggregateMock;

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

afterEach(() => {
  aggregateMock.mockReset();
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
    expect(
      buildDatabaseSpanQuery({
        projectId: PROJECT_ID,
        keys: [],
        start: START,
        end: END,
      }),
    ).toBeNull();
    expect(
      buildDatabaseSpanQuery({
        projectId: null,
        keys: [KEY_A],
        start: START,
        end: END,
      }),
    ).toBeNull();
  });

  test("accepts an ObjectID project id", () => {
    const query: Record<string, unknown> | null = buildDatabaseSpanQuery({
      projectId: new ObjectID(PROJECT_ID),
      keys: [KEY_A],
      start: START,
      end: END,
    });

    expect((query!["projectId"] as ObjectID).toString()).toBe(PROJECT_ID);
  });
});

describe("buildDatabaseMetricQuery", () => {
  test("scopes one metric name by the key set", () => {
    const query: Record<string, unknown> | null = buildDatabaseMetricQuery({
      projectId: PROJECT_ID,
      keys: [KEY_A],
      start: START,
      end: END,
      metricName: " postgresql.backends ",
    });

    expect(query!["name"]).toBe("postgresql.backends");
    expect((query!["entityKeys"] as Includes).values).toEqual([KEY_A]);
    expect((query!["time"] as InBetween<Date>).startValue).toEqual(START);
  });

  test("is null for an empty key set, no project or no metric name", () => {
    const base: {
      projectId: string;
      keys: Array<string>;
      start: Date;
      end: Date;
      metricName: string;
    } = {
      projectId: PROJECT_ID,
      keys: [KEY_A],
      start: START,
      end: END,
      metricName: "postgresql.backends",
    };

    expect(buildDatabaseMetricQuery({ ...base, keys: [] })).toBeNull();
    expect(buildDatabaseMetricQuery({ ...base, projectId: "" })).toBeNull();
    expect(buildDatabaseMetricQuery({ ...base, metricName: "  " })).toBeNull();
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
});

describe("counterSeriesToRatePerSecond", () => {
  test("turns a cumulative counter into a per-second rate at the later bucket", () => {
    expect(
      counterSeriesToRatePerSecond([
        { x: at(0), y: 1000 },
        { x: at(1), y: 1600 },
        { x: at(2), y: 1600 },
        { x: at(3), y: 2800 },
      ]),
    ).toEqual([
      { x: at(1), y: 10 },
      { x: at(2), y: 0 },
      { x: at(3), y: 20 },
    ]);
  });

  test("skips a reset instead of charting a negative rate", () => {
    expect(
      counterSeriesToRatePerSecond([
        { x: at(0), y: 5000 },
        { x: at(1), y: 60 },
        { x: at(2), y: 120 },
      ]),
    ).toEqual([{ x: at(2), y: 1 }]);
  });

  test("sorts its input and ignores duplicate or invalid points", () => {
    expect(
      counterSeriesToRatePerSecond([
        { x: at(2), y: 240 },
        { x: at(0), y: 0 },
        { x: at(0), y: 0 },
        { x: new Date(Number.NaN), y: 5 },
        { x: at(1), y: Number.NaN },
      ]),
    ).toEqual([{ x: at(2), y: 2 }]);
  });

  test("needs at least two points", () => {
    expect(counterSeriesToRatePerSecond([])).toEqual([]);
    expect(counterSeriesToRatePerSecond([{ x: at(0), y: 5 }])).toEqual([]);
  });
});

describe("toEngineMetricResult", () => {
  const catalog: Array<DatabaseServerMetricDefinition> =
    getDatabaseServerMetrics("postgresql");
  const gauge: DatabaseServerMetricDefinition = catalog.find(
    (metric: DatabaseServerMetricDefinition): boolean => {
      return metric.kind === "gauge";
    },
  )!;
  const counter: DatabaseServerMetricDefinition = catalog.find(
    (metric: DatabaseServerMetricDefinition): boolean => {
      return metric.kind === "counter";
    },
  )!;

  test("a gauge charts as-is and shows its latest value", () => {
    const engine: DatabaseEngineMetricResult = toEngineMetricResult(gauge, [
      { x: at(0), y: 12 },
      { x: at(1), y: 15 },
    ]);

    expect(engine.series).toHaveLength(2);
    expect(engine.value).toBe(15);
  });

  test("a counter charts as a rate and shows the mean rate", () => {
    const engine: DatabaseEngineMetricResult = toEngineMetricResult(counter, [
      { x: at(0), y: 0 },
      { x: at(1), y: 60 },
      { x: at(2), y: 180 },
    ]);

    expect(engine.series).toEqual([
      { x: at(1), y: 1 },
      { x: at(2), y: 2 },
    ]);
    expect(engine.value).toBe(1.5);
  });

  test("hasEngineMetricData is true only when some series has points", () => {
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

describe("combineCallingServiceResults", () => {
  test("joins calls, errors and p95 per service, busiest first", () => {
    const rows: Array<DatabaseCallingService> = combineCallingServiceResults({
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

    expect(rows).toEqual([
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
    const rows: Array<DatabaseCallingService> = combineCallingServiceResults({
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

    expect(rows).toEqual([
      {
        serviceId: "svc-a",
        calls: 5,
        errors: 5,
        errorRatePercent: 100,
        p95DurationMs: null,
      },
    ]);
  });

  test("ties are ordered by id so the table is stable between refreshes", () => {
    const rows: Array<DatabaseCallingService> = combineCallingServiceResults({
      countResult: result([
        { primaryEntityId: "svc-b", value: 7 },
        { primaryEntityId: "svc-a", value: 7 },
      ]),
      errorResult: null,
      p95Result: null,
    });

    expect(
      rows.map((row: DatabaseCallingService): string => {
        return row.serviceId;
      }),
    ).toEqual(["svc-a", "svc-b"]);
  });
});

describe("fetchers never query without a scope", () => {
  test("fetchDatabaseQueryMetrics resolves empty with no request for no keys", async () => {
    const metrics: DatabaseQueryMetrics = await fetchDatabaseQueryMetrics({
      projectId: PROJECT_ID,
      keys: [],
      start: START,
      end: END,
    });

    expect(metrics).toEqual(EMPTY_DATABASE_QUERY_METRICS);
    expect(aggregateMock).not.toHaveBeenCalled();
  });

  test("fetchDatabaseCallingServices resolves empty with no request for no keys", async () => {
    expect(
      await fetchDatabaseCallingServices({
        projectId: PROJECT_ID,
        keys: [],
        start: START,
        end: END,
      }),
    ).toEqual([]);
    expect(aggregateMock).not.toHaveBeenCalled();
  });

  test("fetchDatabaseMetricSeries resolves empty with no request for no keys", async () => {
    expect(
      await fetchDatabaseMetricSeries({
        projectId: PROJECT_ID,
        keys: [],
        start: START,
        end: END,
        metricName: "postgresql.backends",
        aggregationType: AggregationType.Avg,
      }),
    ).toEqual([]);
    expect(aggregateMock).not.toHaveBeenCalled();
  });

  test("fetchDatabaseEngineMetrics resolves empty with no request for no keys", async () => {
    expect(
      await fetchDatabaseEngineMetrics({
        projectId: PROJECT_ID,
        keys: [],
        start: START,
        end: END,
        metrics: getDatabaseServerMetrics("postgresql"),
      }),
    ).toEqual([]);
    expect(aggregateMock).not.toHaveBeenCalled();
  });
});

describe("fetchers with a scope", () => {
  test("fetchDatabaseQueryMetrics sends count, error-count and p95 aggregates over client spans", async () => {
    aggregateMock.mockImplementation(
      async (data: {
        modelType: unknown;
        aggregateBy: Record<string, unknown>;
      }): Promise<AggregatedResult> => {
        const query: Record<string, unknown> = data.aggregateBy[
          "query"
        ] as Record<string, unknown>;
        if (data.aggregateBy["aggregationType"] === AggregationType.P95) {
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

    const metrics: DatabaseQueryMetrics = await fetchDatabaseQueryMetrics({
      projectId: PROJECT_ID,
      keys: [KEY_A],
      start: START,
      end: END,
    });

    expect(aggregateMock).toHaveBeenCalledTimes(3);
    for (const call of aggregateMock.mock.calls) {
      expect(call[0].modelType).toBe(Span);
      const aggregateBy: Record<string, unknown> = call[0].aggregateBy;
      const query: Record<string, unknown> = aggregateBy["query"] as Record<
        string,
        unknown
      >;
      expect((query["entityKeys"] as Includes).values).toEqual([KEY_A]);
      expect(query["kind"]).toBe(SpanKind.Client);
      expect(aggregateBy["aggregateColumnName"]).toBe("durationUnixNano");
      expect(aggregateBy["aggregationTimestampColumnName"]).toBe("startTime");
      expect(aggregateBy["startTimestamp"]).toEqual(START);
      expect(aggregateBy["endTimestamp"]).toEqual(END);
    }

    expect(metrics.total).toBe(100);
    expect(metrics.errors).toBe(5);
    expect(metrics.errorRatePercent).toBe(5);
    expect(metrics.p95DurationMs).toBe(5);
    expect(metrics.countSeries).toHaveLength(2);
    expect(metrics.p95Series).toEqual([
      { x: at(0), y: 4 },
      { x: at(1), y: 6 },
    ]);
  });

  test("a failed request resolves to the empty metrics", async () => {
    aggregateMock.mockImplementation(async (): Promise<AggregatedResult> => {
      throw new Error("boom");
    });

    expect(
      await fetchDatabaseQueryMetrics({
        projectId: PROJECT_ID,
        keys: [KEY_A],
        start: START,
        end: END,
      }),
    ).toEqual(EMPTY_DATABASE_QUERY_METRICS);
    expect(
      await fetchDatabaseCallingServices({
        projectId: PROJECT_ID,
        keys: [KEY_A],
        start: START,
        end: END,
      }),
    ).toEqual([]);
    expect(
      await fetchDatabaseMetricSeries({
        projectId: PROJECT_ID,
        keys: [KEY_A],
        start: START,
        end: END,
        metricName: "postgresql.backends",
        aggregationType: AggregationType.Avg,
      }),
    ).toEqual([]);
  });

  test("fetchDatabaseCallingServices groups by the calling service over the whole window", async () => {
    aggregateMock.mockImplementation(
      async (data: {
        modelType: unknown;
        aggregateBy: Record<string, unknown>;
      }): Promise<AggregatedResult> => {
        const query: Record<string, unknown> = data.aggregateBy[
          "query"
        ] as Record<string, unknown>;
        if (data.aggregateBy["aggregationType"] === AggregationType.P95) {
          return result([{ primaryEntityId: "svc-a", value: 3_000_000 }]);
        }
        if (query["statusCode"] === SpanStatus.Error) {
          return result([{ primaryEntityId: "svc-a", value: 1 }]);
        }
        return result([{ primaryEntityId: "svc-a", value: 10 }]);
      },
    );

    const rows: Array<DatabaseCallingService> =
      await fetchDatabaseCallingServices({
        projectId: PROJECT_ID,
        keys: [KEY_A, KEY_B],
        start: START,
        end: END,
      });

    expect(aggregateMock).toHaveBeenCalledTimes(3);
    for (const call of aggregateMock.mock.calls) {
      const aggregateBy: Record<string, unknown> = call[0].aggregateBy;
      expect(aggregateBy["groupBy"]).toEqual({ primaryEntityId: true });
      expect(aggregateBy["aggregationInterval"]).toBe(
        AggregationInterval.Total,
      );
      expect(
        (
          (aggregateBy["query"] as Record<string, unknown>)[
            "entityKeys"
          ] as Includes
        ).values,
      ).toEqual([KEY_A, KEY_B]);
    }
    expect(rows).toEqual([
      {
        serviceId: "svc-a",
        calls: 10,
        errors: 1,
        errorRatePercent: 10,
        p95DurationMs: 3,
      },
    ]);
  });

  test("fetchDatabaseEngineMetrics fetches every catalog metric with its own aggregation", async () => {
    const catalog: Array<DatabaseServerMetricDefinition> =
      getDatabaseServerMetrics("redis");
    aggregateMock.mockImplementation(async (): Promise<AggregatedResult> => {
      return result([
        { timestamp: at(0), value: 100 },
        { timestamp: at(1), value: 160 },
      ]);
    });

    const results: Array<DatabaseEngineMetricResult> =
      await fetchDatabaseEngineMetrics({
        projectId: PROJECT_ID,
        keys: [KEY_A],
        start: START,
        end: END,
        metrics: catalog,
      });

    expect(catalog.length).toBeGreaterThan(0);
    expect(aggregateMock).toHaveBeenCalledTimes(catalog.length);
    expect(results).toHaveLength(catalog.length);

    catalog.forEach(
      (definition: DatabaseServerMetricDefinition, index: number): void => {
        const call: {
          modelType: unknown;
          aggregateBy: Record<string, unknown>;
        } = aggregateMock.mock.calls[index]![0];
        expect(call.modelType).toBe(Metric);
        expect(call.aggregateBy["aggregationType"]).toBe(
          definition.aggregation,
        );
        expect(
          (call.aggregateBy["query"] as Record<string, unknown>)["name"],
        ).toBe(definition.metricName);

        const engine: DatabaseEngineMetricResult = results[index]!;
        expect(engine.definition).toBe(definition);
        if (definition.kind === "counter") {
          expect(engine.series).toEqual([{ x: at(1), y: 1 }]);
        } else {
          expect(engine.value).toBe(160);
        }
      },
    );
  });
});
