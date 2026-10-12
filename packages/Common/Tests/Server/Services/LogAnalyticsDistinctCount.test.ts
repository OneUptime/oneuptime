import LogAggregationService, {
  AnalyticsRequest,
} from "../../../Server/Services/LogAggregationService";
import { Statement } from "../../../Server/Utils/AnalyticsDatabase/Statement";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import { describe, expect, test } from "@jest/globals";

/*
 * THE LOG ANALYTICS DISTINCT COUNT BINDS ITS ATTRIBUTE KEY.
 *
 * The log explorer's analytics (time series, top list, table) count rows,
 * or the distinct values of one field. For an attribute the key used to be
 * quoted into the SQL by hand - uniqExact(attributes['<key>']) with its "'"
 * escaped and its backslashes not - while every other attribute read of the
 * service bound its key as a query parameter. validateFacetKey keeps quotes
 * and backslashes out of a key, so no key could break out of the quote; now
 * the key is bound like every other one, and no character of it is ever read
 * as SQL whatever the validation allows. Counting rows, and the distinct
 * values of a column, build exactly the statements they built before.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
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

function request(overrides: Partial<AnalyticsRequest>): AnalyticsRequest {
  return {
    projectId: PROJECT_ID,
    startTime: new Date("2026-03-01T00:00:00.000Z"),
    endTime: new Date("2026-03-12T00:00:00.000Z"),
    bucketSizeInMinutes: 60,
    chartType: "timeseries",
    aggregation: "count",
    ...overrides,
  };
}

function build(builder: Builder, analytics: AnalyticsRequest): Statement {
  return (LogAggregationService as any)[builder](analytics);
}

// The SQL before its SETTINGS clause, which no change here touches.
function sqlOf(statement: Statement): string {
  return statement.query.split(" SETTINGS ")[0]!;
}

const DISTINCT_COUNT_PARAMETER: RegExp =
  /uniqExact\(attributes\[\{(p\d+):String\}\]\) AS cnt/;

describe("the distinct count of an attribute", () => {
  for (const [builder, chartType] of BUILDERS) {
    for (const key of [
      "user.id",
      "k8s.pod:name/a-b_c",
      "http.response.status_code",
      "A1",
    ]) {
      test(`${chartType}: the key ${key} is a bound parameter, and never SQL`, () => {
        const statement: Statement = build(
          builder,
          request({
            chartType,
            aggregation: "unique",
            aggregationField: key,
            groupBy: ["http.route"],
          }),
        );
        const match: RegExpMatchArray | null = statement.query.match(
          DISTINCT_COUNT_PARAMETER,
        );

        expect(match).not.toBeNull();
        expect(statement.query_params[match![1]!]).toBe(key);
        expect(statement.query).not.toContain(key);
        expect(sqlOf(statement)).not.toContain("'");
      });
    }
  }

  test("a statement of every chart counts the same key the same way", () => {
    for (const [builder, chartType] of BUILDERS) {
      const statement: Statement = build(
        builder,
        request({
          chartType,
          aggregation: "unique",
          aggregationField: "user.id",
          groupBy: ["severityText"],
        }),
      );

      expect(Object.values(statement.query_params)).toContain("user.id");
    }
  });

  for (const [builder, chartType] of BUILDERS) {
    test(`${chartType}: a key the facet key pattern refuses is refused before any SQL is built`, () => {
      for (const key of [
        "user'id",
        "a\\b",
        "a b",
        "x])",
        "x' OR '1'='1",
        "k".repeat(257),
      ]) {
        expect(() => {
          return build(
            builder,
            request({
              chartType,
              aggregation: "unique",
              aggregationField: key,
              groupBy: ["http.route"],
            }),
          );
        }).toThrow(BadDataException);
      }
    });
  }
});

describe("counting rows, and the distinct values of a column, as before", () => {
  test("the time series counting rows builds the statement it built before", () => {
    const statement: Statement = build(
      "buildAnalyticsTimeseriesStatement",
      request({ groupBy: ["http.route", "severityText"] }),
    );

    expect(sqlOf(statement)).toBe(
      "SELECT\n  toStartOfInterval(time, INTERVAL {p0:Int32} SECOND) AS bucket, count() AS cnt, attributes[{p1:String}] AS {p2:Identifier}, toString(severityText) AS severityText\nFROM {p3:Identifier}\nWHERE projectId = {p4:String}\n  AND time >= {p5:DateTime}\n  AND time <= {p6:DateTime} AND retentionDate >= now() GROUP BY bucket, attr_http_route, severityText ORDER BY bucket ASC",
    );
    expect(statement.query_params).toEqual({
      p0: 3600,
      p1: "http.route",
      p2: "attr_http_route",
      p3: "LogItemV3",
      p4: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      p5: "2026-03-01 00:00:00",
      p6: "2026-03-12 00:00:00",
    });
  });

  test("the top list counting rows builds the statement it built before", () => {
    const statement: Statement = build(
      "buildAnalyticsTopListStatement",
      request({ chartType: "toplist", groupBy: ["http.route"] }),
    );

    expect(sqlOf(statement)).toBe(
      "SELECT attributes[{p0:String}] AS val, count() AS cnt FROM LogItemV3 WHERE projectId = {p1:String} AND time >= {p2:DateTime} AND time <= {p3:DateTime} AND mapContains(attributes, {p4:String}) AND retentionDate >= now() GROUP BY val ORDER BY cnt DESC LIMIT {p5:Int32}",
    );
    expect(statement.query_params).toEqual({
      p0: "http.route",
      p1: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      p2: "2026-03-01 00:00:00",
      p3: "2026-03-12 00:00:00",
      p4: "http.route",
      p5: 10,
    });
  });

  test("the table counting a column's distinct values builds the statement it built before", () => {
    const statement: Statement = build(
      "buildAnalyticsTableStatement",
      request({
        chartType: "table",
        aggregation: "unique",
        aggregationField: "traceId",
        groupBy: ["http.route", "severityText"],
      }),
    );

    expect(sqlOf(statement)).toBe(
      "SELECT uniqExact(traceId) AS cnt, attributes[{p0:String}] AS {p1:Identifier}, toString(severityText) AS severityText\nFROM {p2:Identifier}\nWHERE projectId = {p3:String}\n  AND time >= {p4:DateTime}\n  AND time <= {p5:DateTime} AND retentionDate >= now() GROUP BY attr_http_route, severityText ORDER BY cnt DESC LIMIT {p6:Int32}",
    );
  });

  test("the top list counting a column's distinct values names the column", () => {
    for (const column of ["traceId", "spanId", "severityText"]) {
      const statement: Statement = build(
        "buildAnalyticsTopListStatement",
        request({
          chartType: "toplist",
          aggregation: "unique",
          aggregationField: column,
          groupBy: ["http.route"],
        }),
      );

      expect(statement.query).toContain(`uniqExact(${column}) AS cnt`);
    }
  });
});
