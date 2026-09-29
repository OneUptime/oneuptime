import LogAggregationService, {
  AnalyticsRequest,
  FacetRequest,
  HistogramRequest,
} from "../../../Server/Services/LogAggregationService";
import LogDatabaseService from "../../../Server/Services/LogService";
import { Results } from "../../../Server/Services/AnalyticsDatabaseService";
import { Statement } from "../../../Server/Utils/AnalyticsDatabase/Statement";
import AnalyticsTableName from "../../../Types/AnalyticsDatabase/AnalyticsTableName";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import OneUptimeDate from "../../../Types/Date";
import { describe, expect, test, afterEach, jest } from "@jest/globals";

describe("LogAggregationService", () => {
  const defaultRequest: FacetRequest = {
    projectId: ObjectID.generate(),
    startTime: new Date("2026-03-01T00:00:00.000Z"),
    endTime: new Date("2026-03-12T00:00:00.000Z"),
    facetKey: "severityText",
    limit: 15,
  };

  const buildFacetStatement: (
    overrides?: Partial<FacetRequest>,
  ) => Statement = (overrides: Partial<FacetRequest> = {}): Statement => {
    return (LogAggregationService as any).buildFacetStatement({
      ...defaultRequest,
      ...overrides,
    });
  };

  test("builds a parameterized query for top-level facet keys", () => {
    const statement: Statement = buildFacetStatement({
      facetKey: "severityText",
    });

    expect(statement.query).toBe(
      "SELECT toString({p0:Identifier}) AS val, count() AS cnt FROM {p1:Identifier} WHERE projectId = {p2:String} AND time >= {p3:DateTime} AND time <= {p4:DateTime} AND retentionDate >= now() GROUP BY val ORDER BY cnt DESC LIMIT {p5:Int32} SETTINGS max_execution_time = 45, timeout_overflow_mode = 'break', max_memory_usage = 3221225472, max_bytes_before_external_group_by = 1610612736, max_bytes_before_external_sort = 1610612736, max_block_size = 8192, preferred_block_size_bytes = 1048576, max_threads = 4",
    );

    expect(statement.query_params).toStrictEqual({
      p0: "severityText",
      p1: AnalyticsTableName.Log,
      p2: defaultRequest.projectId.toString(),
      p3: OneUptimeDate.toClickhouseDateTime(defaultRequest.startTime),
      p4: OneUptimeDate.toClickhouseDateTime(defaultRequest.endTime),
      p5: 15,
    });
  });

  test("builds a parameterized query for attribute facet keys", () => {
    const facetKey: string = "resource/service:name";
    const statement: Statement = buildFacetStatement({
      facetKey,
    });

    /*
     * attributes is Map(String, String) — facet reads MUST use subscript
     * access + mapContains. The previous JSONExtractRaw/JSONHas shape
     * throws ILLEGAL_TYPE_OF_ARGUMENT (Code 43) against Map columns.
     */
    expect(statement.query).toBe(
      "SELECT attributes[{p0:String}] AS val, count() AS cnt FROM {p1:Identifier} WHERE projectId = {p2:String} AND time >= {p3:DateTime} AND time <= {p4:DateTime} AND mapContains(attributes, {p5:String}) AND retentionDate >= now() GROUP BY val ORDER BY cnt DESC LIMIT {p6:Int32} SETTINGS max_execution_time = 45, timeout_overflow_mode = 'break', max_memory_usage = 3221225472, max_bytes_before_external_group_by = 1610612736, max_bytes_before_external_sort = 1610612736, max_block_size = 8192, preferred_block_size_bytes = 1048576, max_threads = 4",
    );

    expect(statement.query_params).toStrictEqual({
      p0: facetKey,
      p1: AnalyticsTableName.Log,
      p2: defaultRequest.projectId.toString(),
      p3: OneUptimeDate.toClickhouseDateTime(defaultRequest.startTime),
      p4: OneUptimeDate.toClickhouseDateTime(defaultRequest.endTime),
      p5: facetKey,
      p6: 15,
    });
  });

  test("rejects malicious facet keys", () => {
    expect(() => {
      buildFacetStatement({
        facetKey: "x') AS val, version() AS cnt FROM system.functions -- ",
      });
    }).toThrow("Invalid facetKey");
  });

  test("rejects facet keys with unsupported characters", () => {
    expect(() => {
      buildFacetStatement({
        facetKey: "service name",
      });
    }).toThrow("Invalid facetKey");
  });

  test("histogram attribute filter matches attribute keys case-insensitively", () => {
    /*
     * Users typing `requestid` should still match data stored with the key
     * `requestId` (camelCase). The histogram filter shares the same WHERE
     * clause builder (`appendCommonFilters`) with the list/facet queries, so
     * verifying it on histogram covers all three.
     */
    const statement: Statement = (
      LogAggregationService as any
    ).buildHistogramStatement({
      ...defaultRequest,
      facetKey: undefined,
      bucketSizeInMinutes: 60,
      attributes: { requestid: "uuid-123" },
    });

    expect(statement.query).toContain(
      "arrayExists((k, v) -> lowerUTF8(k) = lowerUTF8(",
    );
    expect(statement.query).toContain(
      ", mapKeys(attributes), mapValues(attributes))",
    );
    expect(Object.values(statement.query_params)).toContain("requestid");
    expect(Object.values(statement.query_params)).toContain("uuid-123");
  });

  test("histogram supports multi-value dashboard attribute filters", () => {
    const statement: Statement = (
      LogAggregationService as any
    ).buildHistogramStatement({
      ...defaultRequest,
      facetKey: undefined,
      bucketSizeInMinutes: 60,
      attributes: { region: ["eu-west-1", "us-east-1"] },
    });

    expect(statement.query).toContain(
      "arrayExists((k, v) -> lowerUTF8(k) = lowerUTF8(",
    );
    expect(statement.query).toContain("AND v IN (");
    expect(Object.values(statement.query_params)).toContain("region");
    expect(Object.values(statement.query_params)).toContainEqual([
      "eu-west-1",
      "us-east-1",
    ]);
  });
});

describe("LogAggregationService sessionIds filter", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  const projectId: ObjectID = ObjectID.generate();
  const startTime: Date = new Date("2026-03-01T00:00:00.000Z");
  const endTime: Date = new Date("2026-03-12T00:00:00.000Z");

  const SESSION_IN_PREDICATE: RegExp =
    /AND sessionId IN \(\{p\d+:Array\(String\)\}\)/;

  const buildHistogramStatement: (
    overrides?: Partial<HistogramRequest>,
  ) => Statement = (overrides: Partial<HistogramRequest> = {}): Statement => {
    return (LogAggregationService as any).buildHistogramStatement({
      projectId,
      startTime,
      endTime,
      bucketSizeInMinutes: 60,
      ...overrides,
    });
  };

  const analyticsRequest: (
    overrides: Partial<AnalyticsRequest>,
  ) => AnalyticsRequest = (
    overrides: Partial<AnalyticsRequest>,
  ): AnalyticsRequest => {
    return {
      projectId,
      startTime,
      endTime,
      bucketSizeInMinutes: 60,
      chartType: "timeseries",
      aggregation: "count",
      ...overrides,
    };
  };

  /*
   * Stub the ClickHouse boundary while capturing every Statement handed
   * to executeQuery, so the async read paths (export, context) can be
   * exercised without a database.
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
      .spyOn(LogDatabaseService, "executeQuery")
      .mockImplementation((statement: Statement | string): Promise<Results> => {
        captured.push(statement as Statement);
        return Promise.resolve(fakeResult);
      });

    return captured;
  };

  test("histogram statement threads sessionIds as a parameterized IN predicate", () => {
    const statement: Statement = buildHistogramStatement({
      sessionIds: ["sess-1", "sess-2"],
    });

    expect(statement.query).toMatch(SESSION_IN_PREDICATE);
    expect(Object.values(statement.query_params)).toContainEqual([
      "sess-1",
      "sess-2",
    ]);
  });

  test("histogram statement omits the predicate when sessionIds is absent or empty", () => {
    expect(buildHistogramStatement().query).not.toContain("sessionId");
    expect(buildHistogramStatement({ sessionIds: [] }).query).not.toContain(
      "sessionId",
    );
  });

  test("sessionIds combine with traceIds and spanIds", () => {
    const statement: Statement = buildHistogramStatement({
      traceIds: ["trace-1"],
      spanIds: ["span-1"],
      sessionIds: ["sess-1"],
    });

    expect(statement.query).toMatch(
      /AND traceId IN \(\{p\d+:Array\(String\)\}\)/,
    );
    expect(statement.query).toMatch(
      /AND spanId IN \(\{p\d+:Array\(String\)\}\)/,
    );
    expect(statement.query).toMatch(SESSION_IN_PREDICATE);
  });

  test("injection-shaped session ids stay out of the query text", () => {
    const evilSessionId: string = "') OR 1=1; DROP TABLE Log; --";
    const statement: Statement = buildHistogramStatement({
      sessionIds: [evilSessionId],
    });

    expect(statement.query).not.toContain(evilSessionId);
    expect(Object.values(statement.query_params)).toContainEqual([
      evilSessionId,
    ]);
  });

  test("facet statement threads sessionIds", () => {
    const statement: Statement = (
      LogAggregationService as any
    ).buildFacetStatement({
      projectId,
      startTime,
      endTime,
      facetKey: "severityText",
      limit: 10,
      sessionIds: ["sess-1"],
    } as FacetRequest);

    expect(statement.query).toMatch(SESSION_IN_PREDICATE);
    expect(Object.values(statement.query_params)).toContainEqual(["sess-1"]);
  });

  test("analytics timeseries statement threads sessionIds", () => {
    const statement: Statement = (
      LogAggregationService as any
    ).buildAnalyticsTimeseriesStatement(
      analyticsRequest({ sessionIds: ["sess-1"] }),
    );

    expect(statement.query).toMatch(SESSION_IN_PREDICATE);
    expect(Object.values(statement.query_params)).toContainEqual(["sess-1"]);
  });

  test("analytics toplist statement threads sessionIds", () => {
    const statement: Statement = (
      LogAggregationService as any
    ).buildAnalyticsTopListStatement(
      analyticsRequest({
        chartType: "toplist",
        groupBy: ["severityText"],
        sessionIds: ["sess-1"],
      }),
    );

    expect(statement.query).toMatch(SESSION_IN_PREDICATE);
    expect(Object.values(statement.query_params)).toContainEqual(["sess-1"]);
  });

  test("analytics table statement threads sessionIds", () => {
    const statement: Statement = (
      LogAggregationService as any
    ).buildAnalyticsTableStatement(
      analyticsRequest({
        chartType: "table",
        groupBy: ["severityText"],
        sessionIds: ["sess-1"],
      }),
    );

    expect(statement.query).toMatch(SESSION_IN_PREDICATE);
    expect(Object.values(statement.query_params)).toContainEqual(["sess-1"]);
  });

  test("getExportLogs threads sessionIds into the export read", async () => {
    const captured: Array<Statement> = stubAndCaptureStatements([]);

    await LogAggregationService.getExportLogs({
      projectId,
      startTime,
      endTime,
      limit: 100,
      sessionIds: ["sess-1"],
    });

    expect(captured.length).toBe(1);
    expect(captured[0]!.query).toMatch(SESSION_IN_PREDICATE);
    expect(Object.values(captured[0]!.query_params)).toContainEqual(["sess-1"]);
  });

  test("getLogContext scopes both context reads to the session", async () => {
    const captured: Array<Statement> = stubAndCaptureStatements([]);

    await LogAggregationService.getLogContext({
      projectId,
      primaryEntityId: ObjectID.generate(),
      time: startTime,
      logId: "log-1",
      count: 5,
      sessionIds: ["sess-1"],
    });

    expect(captured.length).toBe(2);
    for (const statement of captured) {
      // The predicate must land in the WHERE clause, before the ORDER BY.
      expect(statement.query).toMatch(
        /AND sessionId IN \(\{p\d+:Array\(String\)\}\)[\s\S]*ORDER BY time/,
      );
      expect(Object.values(statement.query_params)).toContainEqual(["sess-1"]);
    }
  });

  test("getLogContext without sessionIds emits no sessionId predicate", async () => {
    const captured: Array<Statement> = stubAndCaptureStatements([]);

    await LogAggregationService.getLogContext({
      projectId,
      primaryEntityId: ObjectID.generate(),
      time: startTime,
      logId: "log-1",
      count: 5,
    });

    expect(captured.length).toBe(2);
    for (const statement of captured) {
      expect(statement.query).not.toContain("sessionId");
      // The LIMIT restructure must keep the ordering clauses intact.
      expect(statement.query).toMatch(
        /ORDER BY time (DESC|ASC), timeUnixNano (DESC|ASC)[\s\S]*LIMIT \{p\d+:Int32\}/,
      );
    }
  });
});

/*
 * Issue #3914. Zooming into one bar of the Log Volume chart asks for a window
 * like 10:15 - 10:16. The histogram used to keep the minute the END falls in
 * as well, so that window drew two bars (10:15 and 10:16) over a list holding
 * only the first minute's logs: volume on the chart, "no logs" below it. The
 * window edges are filtered on the projection's own minute expression, never
 * on raw `time`, so the fix must keep that shape.
 */
describe("LogAggregationService histogram window edges", () => {
  const projectId: ObjectID = ObjectID.generate();

  const buildHistogramStatement: (
    overrides?: Partial<HistogramRequest>,
  ) => Statement = (overrides: Partial<HistogramRequest> = {}): Statement => {
    return (LogAggregationService as any).buildHistogramStatement({
      projectId,
      startTime: new Date("2026-09-17T10:15:00.000Z"),
      endTime: new Date("2026-09-17T10:16:00.000Z"),
      bucketSizeInMinutes: 1,
      ...overrides,
    });
  };

  const normalizedQuery: (statement: Statement) => string = (
    statement: Statement,
  ): string => {
    return statement.query.replace(/\s+/g, " ");
  };

  const END_PREDICATE: RegExp =
    /toStartOfInterval\(time, INTERVAL 1 MINUTE\) < \{(p\d+):DateTime64\(9\)\}/;

  const START_PREDICATE: RegExp =
    /toStartOfInterval\(time, INTERVAL 1 MINUTE\) >= toStartOfInterval\(\{(p\d+):DateTime\}, INTERVAL 1 MINUTE\)/;

  const boundValue: (statement: Statement, predicate: RegExp) => unknown = (
    statement: Statement,
    predicate: RegExp,
  ): unknown => {
    const match: RegExpMatchArray | null =
      normalizedQuery(statement).match(predicate);

    expect(match).not.toBeNull();

    return (statement.query_params as Record<string, unknown>)[match![1]!];
  };

  test("keeps only the minutes that start before the window ends", () => {
    const query: string = normalizedQuery(buildHistogramStatement());

    expect(query).toMatch(END_PREDICATE);
    expect(query).not.toMatch(
      /toStartOfInterval\(time, INTERVAL 1 MINUTE\) <= toStartOfInterval\(/,
    );
  });

  test("binds the end itself, not the start of its minute", () => {
    expect(boundValue(buildHistogramStatement(), END_PREDICATE)).toBe(
      "2026-09-17 10:16:00.000000000",
    );
  });

  /*
   * A sub-second end ("now" as the picker resolves it) has already started
   * its minute, and the list below the chart holds that minute's first
   * moments - so the chart has to keep it. A DateTime bind would truncate
   * the end to 10:16:00 and drop it.
   */
  test("keeps the minute a sub-second end has already started", () => {
    const statement: Statement = buildHistogramStatement({
      endTime: new Date("2026-09-17T10:16:00.500Z"),
    });

    expect(boundValue(statement, END_PREDICATE)).toBe(
      "2026-09-17 10:16:00.500000000",
    );
  });

  test("still counts the whole minute the window starts in", () => {
    const statement: Statement = buildHistogramStatement({
      startTime: new Date("2026-09-17T10:15:30.000Z"),
    });

    expect(boundValue(statement, START_PREDICATE)).toBe("2026-09-17 10:15:30");
  });

  /*
   * A raw `time` predicate references a column the proj_severity_histogram
   * projection does not store, so ClickHouse would fall back to scanning
   * the base table.
   */
  test("never filters the window on the raw time column", () => {
    const query: string = normalizedQuery(buildHistogramStatement());

    expect(query).not.toMatch(/[^(]\btime\s*(<|>|<=|>=)\s/);
    expect(query).toContain("optimize_use_projections = 1");
  });
});
