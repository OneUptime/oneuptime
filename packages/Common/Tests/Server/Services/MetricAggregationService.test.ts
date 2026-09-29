import MetricAggregationService, {
  MetricForTraceItem,
  MetricsForTraceRequest,
} from "../../../Server/Services/MetricAggregationService";
import MetricService from "../../../Server/Services/MetricService";
import { Results } from "../../../Server/Services/AnalyticsDatabaseService";
import { Statement } from "../../../Server/Utils/AnalyticsDatabase/Statement";
import AnalyticsTableName from "../../../Types/AnalyticsDatabase/AnalyticsTableName";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import { describe, expect, test, afterEach, jest } from "@jest/globals";

describe("MetricAggregationService.getMetricsForTrace statement building", () => {
  type BuildMetricsForTraceStatement = (
    request: MetricsForTraceRequest,
  ) => Statement;

  /*
   * The builder is private but pure — reaching it through a cast keeps
   * predicate generation testable without a ClickHouse round trip (same
   * pattern as the LogAggregationService facet tests).
   */
  const buildMetricsForTraceStatement: BuildMetricsForTraceStatement = (
    MetricAggregationService as unknown as {
      buildMetricsForTraceStatement: BuildMetricsForTraceStatement;
    }
  ).buildMetricsForTraceStatement.bind(MetricAggregationService);

  const projectId: ObjectID = ObjectID.generate();

  test("selects the exemplar columns from the Metric table, scoped and ordered", () => {
    const statement: Statement = buildMetricsForTraceStatement({
      projectId,
      traceId: "trace-1",
    });

    expect(statement.query).toContain("toFloat64(value) AS value");
    expect(statement.query).toContain("toString(primaryEntityId) AS serviceId");
    expect(statement.query).toContain("attributes");
    expect(statement.query).toMatch(/WHERE projectId = \{p\d+:String\}/);
    expect(statement.query).toMatch(/AND traceId = \{p\d+:String\}/);
    expect(statement.query).toContain("retentionDate >= now()");
    expect(statement.query).toMatch(/ORDER BY time ASC LIMIT \{p\d+:Int32\}/);
    expect(Object.values(statement.query_params)).toContain(
      AnalyticsTableName.Metric,
    );
    expect(Object.values(statement.query_params)).toContain(
      projectId.toString(),
    );
    expect(Object.values(statement.query_params)).toContain("trace-1");
    // Default row cap.
    expect(Object.values(statement.query_params)).toContain(500);
  });

  test("spanIds add a parameterized IN predicate; empty array behaves as absent", () => {
    const withSpans: Statement = buildMetricsForTraceStatement({
      projectId,
      traceId: "trace-1",
      spanIds: ["span-a", "span-b"],
    });

    expect(withSpans.query).toMatch(
      /AND spanId IN \(\{p\d+:Array\(String\)\}\)/,
    );
    expect(Object.values(withSpans.query_params)).toContainEqual([
      "span-a",
      "span-b",
    ]);

    const emptySpans: Statement = buildMetricsForTraceStatement({
      projectId,
      traceId: "trace-1",
      spanIds: [],
    });

    expect(emptySpans.query).not.toContain("spanId IN");

    const absentSpans: Statement = buildMetricsForTraceStatement({
      projectId,
      traceId: "trace-1",
    });

    expect(absentSpans.query).not.toContain("spanId IN");
  });

  test("caller limits are honored below the cap and clamped above it", () => {
    const small: Statement = buildMetricsForTraceStatement({
      projectId,
      traceId: "trace-1",
      limit: 10,
    });
    expect(Object.values(small.query_params)).toContain(10);

    const oversized: Statement = buildMetricsForTraceStatement({
      projectId,
      traceId: "trace-1",
      limit: 999999,
    });
    expect(Object.values(oversized.query_params)).toContain(500);
    expect(Object.values(oversized.query_params)).not.toContain(999999);
  });

  test("injection-shaped values stay out of the query text", () => {
    const evilTraceId: string = "') UNION SELECT * FROM system.tables --";
    const evilSpanId: string = "x'); DROP TABLE Metric; --";

    const statement: Statement = buildMetricsForTraceStatement({
      projectId,
      traceId: evilTraceId,
      spanIds: [evilSpanId],
    });

    expect(statement.query).not.toContain(evilTraceId);
    expect(statement.query).not.toContain(evilSpanId);
    expect(Object.values(statement.query_params)).toContain(evilTraceId);
    expect(Object.values(statement.query_params)).toContainEqual([evilSpanId]);
  });
});

describe("MetricAggregationService.getMetricsForTrace", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  const projectId: ObjectID = ObjectID.generate();

  /*
   * Stub the ClickHouse boundary while capturing the Statement handed to
   * executeQuery, so the read path can be exercised without a database.
   */
  const stubAndCaptureStatements: (
    rows: Array<JSONObject>,
  ) => Array<Statement> = (rows: Array<JSONObject>): Array<Statement> => {
    const captured: Array<Statement> = [];
    const fakeResult: Results = {
      json: () => {
        return Promise.resolve({ data: rows });
      },
    } as unknown as Results;

    jest
      .spyOn(MetricService, "executeQuery")
      .mockImplementation((statement: Statement | string): Promise<Results> => {
        captured.push(statement as Statement);
        return Promise.resolve(fakeResult);
      });

    return captured;
  };

  test("maps rows into typed items, coercing ClickHouse string numerics", async () => {
    const captured: Array<Statement> = stubAndCaptureStatements([
      {
        name: "http.server.duration",
        time: "2026-03-01 00:00:00",
        value: "12.5",
        spanId: "span-1",
        serviceId: "svc-1",
        attributes: { "http.route": "/api" },
      },
      {
        name: "queue.depth",
        time: "2026-03-01 00:00:05",
        value: 3,
        spanId: "span-2",
        serviceId: "svc-2",
        attributes: {},
      },
    ]);

    const items: Array<MetricForTraceItem> =
      await MetricAggregationService.getMetricsForTrace({
        projectId,
        traceId: "trace-1",
        spanIds: ["span-1", "span-2"],
      });

    expect(captured.length).toBe(1);
    expect(items).toStrictEqual([
      {
        name: "http.server.duration",
        time: "2026-03-01 00:00:00",
        value: 12.5,
        spanId: "span-1",
        serviceId: "svc-1",
        attributes: { "http.route": "/api" },
      },
      {
        name: "queue.depth",
        time: "2026-03-01 00:00:05",
        value: 3,
        spanId: "span-2",
        serviceId: "svc-2",
        attributes: {},
      },
    ]);
  });

  test("degrades missing row fields to safe defaults", async () => {
    stubAndCaptureStatements([{ name: "orphan.metric" }]);

    const items: Array<MetricForTraceItem> =
      await MetricAggregationService.getMetricsForTrace({
        projectId,
        traceId: "trace-1",
      });

    expect(items).toStrictEqual([
      {
        name: "orphan.metric",
        time: "",
        value: 0,
        spanId: "",
        serviceId: "",
        attributes: {},
      },
    ]);
  });

  test("returns an empty list when the trace stamped no exemplars", async () => {
    stubAndCaptureStatements([]);

    const items: Array<MetricForTraceItem> =
      await MetricAggregationService.getMetricsForTrace({
        projectId,
        traceId: "trace-without-exemplars",
      });

    expect(items).toStrictEqual([]);
  });
});
