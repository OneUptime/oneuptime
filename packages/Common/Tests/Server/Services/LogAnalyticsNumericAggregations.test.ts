import LogAggregationService, {
  ANALYTICS_AGGREGATIONS,
  AnalyticsRequest,
  AnalyticsTableRow,
  AnalyticsTimeseriesRow,
  AnalyticsTopItem,
} from "../../../Server/Services/LogAggregationService";
import LogService from "../../../Server/Services/LogService";
import { Statement } from "../../../Server/Utils/AnalyticsDatabase/Statement";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import escapeRegExp from "../../../Utils/RegExpEscape";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

/*
 * LOGS → ANALYTICS: THE SUM, AVERAGE, MINIMUM, MAXIMUM AND PERCENTILES OF A
 * NUMERIC ATTRIBUTE (#7716).
 *
 * A chart of the log explorer's Analytics reads one attribute the logs
 * carry - duration_ms, bytes - as a number and charts its aggregate over
 * time, as a top list or as a table. These pin the SQL each aggregation
 * writes, for every chart:
 *
 *   - the aggregate is ClickHouse's own (sum, avg, min, max, quantile) over
 *     toFloat64OrNull(attributes[{key}]), the key a bound parameter;
 *   - only the logs whose attribute is a finite number are read: the WHERE
 *     clause leaves the rest out, so "n/a" is never read as 0;
 *   - a key that could be SQL is refused before any SQL is built, and a key
 *     that passes is never written into the SQL;
 *   - the read keeps every filter, the caller's service scope, the
 *     retention filter and the time and memory caps a count has.
 *
 * What ClickHouse makes of the statements - which values count as numbers,
 * what a percentile comes to - is shown against a real server in
 * App/Tests/Telemetry/LogsAnalyticsNumericAggregationsClickhouse.test.ts.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
);
const READABLE_SERVICE: ObjectID = new ObjectID(
  "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
);
const BLOCKED_SERVICE: ObjectID = new ObjectID(
  "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
);

type Builder =
  | "buildAnalyticsTimeseriesStatement"
  | "buildAnalyticsTopListStatement"
  | "buildAnalyticsTableStatement";

const BUILDERS: Array<[Builder, AnalyticsRequest["chartType"]]> = [
  ["buildAnalyticsTimeseriesStatement", "timeseries"],
  ["buildAnalyticsTopListStatement", "toplist"],
  ["buildAnalyticsTableStatement", "table"],
];

// Each aggregation of a number, and the aggregate it writes.
const NUMERIC: Array<[AnalyticsRequest["aggregation"], string]> = [
  ["sum", "sum("],
  ["avg", "avg("],
  ["p50", "quantile(0.5)("],
  ["p90", "quantile(0.9)("],
  ["p95", "quantile(0.95)("],
  ["p99", "quantile(0.99)("],
  ["min", "min("],
  ["max", "max("],
];

function request(overrides: Partial<AnalyticsRequest>): AnalyticsRequest {
  return {
    projectId: PROJECT_ID,
    startTime: new Date("2026-11-19T09:00:00.000Z"),
    endTime: new Date("2026-11-19T10:00:00.000Z"),
    bucketSizeInMinutes: 5,
    chartType: "timeseries",
    aggregation: "count",
    ...overrides,
  };
}

function build(builder: Builder, analytics: AnalyticsRequest): Statement {
  return (
    LogAggregationService as unknown as Record<
      Builder,
      (request: AnalyticsRequest) => Statement
    >
  )[builder](analytics);
}

// The SQL before its SETTINGS clause, on one line.
function sqlOf(statement: Statement): string {
  return statement.query.split(" SETTINGS ")[0]!.replace(/\s+/g, " ");
}

function settingsOf(statement: Statement): string {
  return statement.query.split(" SETTINGS ")[1] || "";
}

// The parameter a placeholder of the statement binds.
function param(statement: Statement, placeholder: string): unknown {
  return statement.query_params[placeholder];
}

// The aggregate over the attribute's value, with its key's placeholder.
function aggregateOf(
  statement: Statement,
  functionCall: string,
): { placeholder: string } | null {
  const escaped: string = escapeRegExp(functionCall);
  const match: RegExpMatchArray | null = sqlOf(statement).match(
    new RegExp(
      `${escaped}toFloat64OrNull\\(attributes\\[\\{(p\\d+):String\\}\\]\\)\\) AS cnt`,
    ),
  );

  return match ? { placeholder: match[1]! } : null;
}

// The WHERE clause that keeps only the logs whose value is a number.
const IS_NUMBER_FILTER: RegExp =
  /AND \(empty\(attributeKeys\) OR hasAny\(attributeKeys, \{(p\d+):Array\(String\)\}\)\) AND isFinite\(toFloat64OrNull\(attributes\[\{(p\d+):String\}\]\)\)/;

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the aggregations the analytics take", () => {
  test("count and unique, then every aggregation of a number, in the order the view offers them", () => {
    expect(ANALYTICS_AGGREGATIONS).toEqual([
      "count",
      "unique",
      "sum",
      "avg",
      "p50",
      "p90",
      "p95",
      "p99",
      "min",
      "max",
    ]);
  });
});

describe("an aggregation of a numeric attribute", () => {
  for (const [builder, chartType] of BUILDERS) {
    for (const [aggregation, functionCall] of NUMERIC) {
      test(`${chartType} ${aggregation}: ${functionCall}toFloat64OrNull(...)) over the logs whose value is a finite number`, () => {
        const statement: Statement = build(
          builder,
          request({
            chartType,
            aggregation,
            aggregationField: "duration_ms",
            groupBy: ["http.route"],
          }),
        );
        const aggregate: { placeholder: string } | null = aggregateOf(
          statement,
          functionCall,
        );

        expect(aggregate).not.toBeNull();
        expect(param(statement, aggregate!.placeholder)).toBe("duration_ms");

        const filter: RegExpMatchArray | null =
          sqlOf(statement).match(IS_NUMBER_FILTER);

        expect(filter).not.toBeNull();
        expect(param(statement, filter![1]!)).toEqual(["duration_ms"]);
        expect(param(statement, filter![2]!)).toBe("duration_ms");

        // Never read as 0: the old sum's toFloat64OrZero is gone.
        expect(sqlOf(statement)).not.toContain("toFloat64OrZero");
      });
    }
  }

  test("the number filter comes after every other filter and before the grouping", () => {
    for (const [builder, chartType] of BUILDERS) {
      const sql: string = sqlOf(
        build(
          builder,
          request({
            chartType,
            aggregation: "p95",
            aggregationField: "duration_ms",
            groupBy: ["severityText"],
            severityTexts: ["Error"],
            attributes: { "http.route": "/checkout" },
          }),
        ),
      );

      const severity: number = sql.indexOf("severityText IN (");
      const attribute: number = sql.indexOf("arrayExists(");
      const number: number = sql.indexOf("AND isFinite(");
      const groupBy: number = sql.indexOf(" GROUP BY ");

      expect(severity).toBeGreaterThan(-1);
      expect(attribute).toBeGreaterThan(-1);
      expect(number).toBeGreaterThan(Math.max(severity, attribute));
      expect(groupBy).toBeGreaterThan(number);
    }
  });

  test("the whole time series of the p95 of duration_ms by service", () => {
    const statement: Statement = build(
      "buildAnalyticsTimeseriesStatement",
      request({
        aggregation: "p95",
        aggregationField: "duration_ms",
        groupBy: ["primaryEntityId"],
      }),
    );

    expect(sqlOf(statement)).toBe(
      "SELECT toStartOfInterval(time, INTERVAL {p0:Int32} SECOND) AS bucket, quantile(0.95)(toFloat64OrNull(attributes[{p1:String}])) AS cnt, toString(primaryEntityId) AS primaryEntityId FROM {p2:Identifier} WHERE projectId = {p3:String} AND time >= {p4:DateTime} AND time <= {p5:DateTime} AND retentionDate >= now() AND (empty(attributeKeys) OR hasAny(attributeKeys, {p6:Array(String)})) AND isFinite(toFloat64OrNull(attributes[{p7:String}])) GROUP BY bucket, primaryEntityId ORDER BY bucket ASC",
    );
    expect(statement.query_params).toEqual({
      p0: 300,
      p1: "duration_ms",
      p2: "LogItemV3",
      p3: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      p4: "2026-11-19 09:00:00",
      p5: "2026-11-19 10:00:00",
      p6: ["duration_ms"],
      p7: "duration_ms",
    });
  });

  test("the whole top list of the average bytes by route, the largest first", () => {
    const statement: Statement = build(
      "buildAnalyticsTopListStatement",
      request({
        chartType: "toplist",
        aggregation: "avg",
        aggregationField: "bytes",
        groupBy: ["http.route"],
        limit: 25,
      }),
    );

    expect(sqlOf(statement)).toBe(
      "SELECT attributes[{p0:String}] AS val, avg(toFloat64OrNull(attributes[{p1:String}])) AS cnt FROM LogItemV3 WHERE projectId = {p2:String} AND time >= {p3:DateTime} AND time <= {p4:DateTime} AND mapContains(attributes, {p5:String}) AND retentionDate >= now() AND (empty(attributeKeys) OR hasAny(attributeKeys, {p6:Array(String)})) AND isFinite(toFloat64OrNull(attributes[{p7:String}])) GROUP BY val ORDER BY cnt DESC LIMIT {p8:Int32}",
    );
    expect(statement.query_params).toMatchObject({
      p0: "http.route",
      p1: "bytes",
      p5: "http.route",
      p6: ["bytes"],
      p7: "bytes",
      p8: 25,
    });
  });

  test("the table of the sum of bytes by route and severity, the largest first", () => {
    const sql: string = sqlOf(
      build(
        "buildAnalyticsTableStatement",
        request({
          chartType: "table",
          aggregation: "sum",
          aggregationField: "bytes",
          groupBy: ["http.route", "severityText"],
        }),
      ),
    );

    expect(sql).toMatch(
      /^SELECT sum\(toFloat64OrNull\(attributes\[\{p0:String\}\]\)\) AS cnt, attributes\[\{p1:String\}\] AS \{p2:Identifier\}, toString\(severityText\) AS severityText FROM/,
    );
    expect(sql).toContain(
      "GROUP BY attr_http_route, severityText ORDER BY cnt DESC LIMIT",
    );
  });

  test("a read of a number keeps the time cap, the memory caps and the bounded scan a count has", () => {
    for (const [builder, chartType] of BUILDERS) {
      const count: Statement = build(
        builder,
        request({ chartType, groupBy: ["http.route"] }),
      );
      const percentile: Statement = build(
        builder,
        request({
          chartType,
          aggregation: "p99",
          aggregationField: "duration_ms",
          groupBy: ["http.route"],
        }),
      );

      expect(settingsOf(percentile)).toBe(settingsOf(count));
      expect(settingsOf(percentile)).toContain("max_execution_time = 45");
      expect(settingsOf(percentile)).toContain(
        "timeout_overflow_mode = 'throw'",
      );
      expect(settingsOf(percentile)).toContain("max_memory_usage = ");
      expect(settingsOf(percentile)).toContain(
        "max_bytes_before_external_group_by = ",
      );
      expect(settingsOf(percentile)).toContain("max_threads = 4");
    }
  });

  test("keeps the readable services and leaves the blocked ones out", () => {
    for (const [builder, chartType] of BUILDERS) {
      for (const [aggregation] of NUMERIC) {
        const statement: Statement = build(
          builder,
          request({
            chartType,
            aggregation,
            aggregationField: "duration_ms",
            groupBy: ["http.route"],
            serviceIds: [READABLE_SERVICE],
            excludedServiceIds: [BLOCKED_SERVICE],
          }),
        );

        expect(sqlOf(statement)).toMatch(/primaryEntityId IN \(/);
        expect(sqlOf(statement)).toMatch(/primaryEntityId NOT IN \(/);
        expect(Object.values(statement.query_params)).toContainEqual([
          READABLE_SERVICE.toString(),
        ]);
        expect(Object.values(statement.query_params)).toContainEqual([
          BLOCKED_SERVICE.toString(),
        ]);
      }
    }
  });

  test("keeps a page's entity keys: a pod's own tab averages only the pod's logs", () => {
    for (const [builder, chartType] of BUILDERS) {
      const statement: Statement = build(
        builder,
        request({
          chartType,
          aggregation: "avg",
          aggregationField: "duration_ms",
          groupBy: ["http.route"],
          entityKeys: ["k8s.pod:checkout-7f9"],
        }),
      );
      const match: RegExpMatchArray | null = sqlOf(statement).match(
        /AND hasAny\(entityKeys, \{(p\d+):Array\(String\)\}\)/,
      );

      expect(match).not.toBeNull();
      expect(param(statement, match![1]!)).toEqual(["k8s.pod:checkout-7f9"]);
    }
  });

  test("keeps the retention filter: a log past its retention is not averaged in", () => {
    for (const [builder, chartType] of BUILDERS) {
      expect(
        sqlOf(
          build(
            builder,
            request({
              chartType,
              aggregation: "avg",
              aggregationField: "duration_ms",
              groupBy: ["http.route"],
            }),
          ),
        ),
      ).toContain("AND retentionDate >= now()");
    }
  });
});

describe("an attribute key that could be SQL", () => {
  // Each refused by the key pattern before any SQL is built.
  const ATTACKS: Array<string> = [
    "duration_ms') OR 1=1 --",
    "x' OR '1'='1",
    "duration_ms]) AS cnt FROM system.users --",
    "a\\'b",
    "bytes; DROP TABLE LogItemV3",
    "a b",
    "a\nb",
    "a`b",
    'a"b',
    "{p0:String}",
    "duration_ms)) , (SELECT 1",
    "/*",
    "a*b",
    "dür",
    "k".repeat(257),
    "",
  ];

  for (const [builder, chartType] of BUILDERS) {
    for (const [aggregation] of NUMERIC) {
      test(`${chartType} ${aggregation}: is refused before any SQL is built`, () => {
        for (const key of ATTACKS) {
          expect(() => {
            return build(
              builder,
              request({
                chartType,
                aggregation,
                aggregationField: key,
                groupBy: ["http.route"],
              }),
            );
          }).toThrow(BadDataException);
        }
      });
    }
  }

  test("a key the pattern lets through is a bound parameter, never SQL", () => {
    for (const key of [
      "http.server.request.duration_ms",
      "k8s.pod:name/a-b_c",
      "A1",
      "1e3",
      "--",
      "a--b",
      "a/b",
    ]) {
      for (const [builder, chartType] of BUILDERS) {
        const statement: Statement = build(
          builder,
          request({
            chartType,
            aggregation: "max",
            aggregationField: key,
            groupBy: ["severityText"],
          }),
        );

        expect(sqlOf(statement)).not.toContain(key);
        expect(Object.values(statement.query_params)).toContain(key);
        expect(Object.values(statement.query_params)).toContainEqual([key]);
      }
    }
  });

  test("a non-text key is refused", () => {
    for (const key of [42, ["duration_ms"], { k: "v" }, true]) {
      expect(() => {
        return build(
          "buildAnalyticsTimeseriesStatement",
          request({
            aggregation: "avg",
            aggregationField: key as unknown as string,
          }),
        );
      }).toThrow(BadDataException);
    }
  });
});

describe("what an aggregation of a number reads", () => {
  test("needs the attribute: there is no average of nothing", () => {
    for (const [aggregation] of NUMERIC) {
      for (const field of [undefined, ""]) {
        expect(() => {
          return build(
            "buildAnalyticsTimeseriesStatement",
            request({ aggregation, aggregationField: field }),
          );
        }).toThrow(
          "A sum, an average, a minimum, a maximum or a percentile reads a numeric log attribute. Set aggregationField to its key, such as duration_ms.",
        );
      }
    }
  });

  test("is an attribute: a log's severity, service, trace and span hold no number", () => {
    for (const field of [
      "severityText",
      "primaryEntityId",
      "traceId",
      "spanId",
    ]) {
      for (const [builder, chartType] of BUILDERS) {
        expect(() => {
          return build(
            builder,
            request({
              chartType,
              aggregation: "sum",
              aggregationField: field,
              groupBy: ["http.route"],
            }),
          );
        }).toThrow(
          "A sum, an average, a minimum, a maximum or a percentile reads a numeric log attribute, such as duration_ms. A log's severity, service, trace and span hold no number.",
        );
      }
    }
  });
});

describe("a count and a unique count", () => {
  test("a count reads every row, with no number filter", () => {
    for (const [builder, chartType] of BUILDERS) {
      const sql: string = sqlOf(
        build(builder, request({ chartType, groupBy: ["http.route"] })),
      );

      expect(sql).toContain("count() AS cnt");
      expect(sql).not.toContain("isFinite(");
      expect(sql).not.toContain("toFloat64OrNull");
    }
  });

  test("a count ignores an aggregationField it does not read", () => {
    const sql: string = sqlOf(
      build(
        "buildAnalyticsTimeseriesStatement",
        request({ aggregation: "count", aggregationField: "duration_ms" }),
      ),
    );

    expect(sql).toContain("count() AS cnt");
    expect(sql).not.toContain("isFinite(");
  });

  test("a unique count of an attribute counts only the logs that carry it", () => {
    const statement: Statement = build(
      "buildAnalyticsTableStatement",
      request({
        chartType: "table",
        aggregation: "unique",
        aggregationField: "user.id",
        groupBy: ["severityText"],
      }),
    );
    const match: RegExpMatchArray | null = sqlOf(statement).match(
      /uniqExactIf\(attributes\[\{(p\d+):String\}\], mapContains\(attributes, \{(p\d+):String\}\)\) AS cnt/,
    );

    expect(match).not.toBeNull();
    expect(param(statement, match![1]!)).toBe("user.id");
    expect(param(statement, match![2]!)).toBe("user.id");
    expect(sqlOf(statement)).not.toContain("isFinite(");
  });

  test("a unique count of a log's own field counts it as before", () => {
    expect(
      sqlOf(
        build(
          "buildAnalyticsTableStatement",
          request({
            chartType: "table",
            aggregation: "unique",
            aggregationField: "traceId",
            groupBy: ["severityText"],
          }),
        ),
      ),
    ).toContain("SELECT uniqExact(traceId) AS cnt");
  });
});

// ClickHouse's JSON answer of these rows, as executeQuery resolves it.
function rows(data: Array<Record<string, unknown>>): unknown {
  return {
    json: async (): Promise<unknown> => {
      return { data };
    },
  };
}

describe("reading an aggregate of a number back", () => {
  test("a time series point carries the value, fractions and all", async () => {
    jest.spyOn(LogService, "executeQuery").mockResolvedValue(
      rows([
        { bucket: "2026-11-19 09:00:00", cnt: 182.25, primaryEntityId: "a" },
        { bucket: "2026-11-19 09:05:00", cnt: 0.5, primaryEntityId: "a" },
        { bucket: "2026-11-19 09:05:00", cnt: -3, primaryEntityId: "b" },
      ]) as never,
    );

    const points: Array<AnalyticsTimeseriesRow> =
      await LogAggregationService.getAnalyticsTimeseries(
        request({
          aggregation: "p95",
          aggregationField: "duration_ms",
          groupBy: ["primaryEntityId"],
        }),
      );

    expect(points).toEqual([
      {
        time: "2026-11-19 09:00:00",
        count: 182.25,
        groupValues: { primaryEntityId: "a" },
      },
      {
        time: "2026-11-19 09:05:00",
        count: 0.5,
        groupValues: { primaryEntityId: "a" },
      },
      {
        time: "2026-11-19 09:05:00",
        count: -3,
        groupValues: { primaryEntityId: "b" },
      },
    ]);
  });

  test("a top list item and a table row carry it too", async () => {
    jest
      .spyOn(LogService, "executeQuery")
      .mockResolvedValueOnce(
        rows([{ val: "/checkout", cnt: 1250.75 }]) as never,
      )
      .mockResolvedValueOnce(
        rows([{ cnt: 12.5, attr_http_route: "/checkout" }]) as never,
      );

    const top: Array<AnalyticsTopItem> =
      await LogAggregationService.getAnalyticsTopList(
        request({
          chartType: "toplist",
          aggregation: "max",
          aggregationField: "bytes",
          groupBy: ["http.route"],
        }),
      );
    const table: Array<AnalyticsTableRow> =
      await LogAggregationService.getAnalyticsTable(
        request({
          chartType: "table",
          aggregation: "avg",
          aggregationField: "bytes",
          groupBy: ["http.route"],
        }),
      );

    expect(top).toEqual([{ value: "/checkout", count: 1250.75 }]);
    expect(table).toEqual([
      { groupValues: { "http.route": "/checkout" }, count: 12.5 },
    ]);
  });

  test("an aggregate ClickHouse wrote as null (a sum past a Float64) reads as 0, not NaN", async () => {
    jest
      .spyOn(LogService, "executeQuery")
      .mockResolvedValue(
        rows([{ bucket: "2026-11-19 09:00:00", cnt: null }]) as never,
      );

    const points: Array<AnalyticsTimeseriesRow> =
      await LogAggregationService.getAnalyticsTimeseries(
        request({ aggregation: "sum", aggregationField: "bytes" }),
      );

    expect(points[0]!.count).toBe(0);
  });
});
