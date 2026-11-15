import PromQLMetricSeriesSource, {
  buildPromQLMetricRowsStatement,
  buildPromQLMutableMetricRowsStatement,
  resolvePromQLSelection,
} from "../../../../Server/Utils/PromQL/PromQLMetricSeriesSource";
import { Statement } from "../../../../Server/Utils/AnalyticsDatabase/Statement";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import {
  PromQLLabelMatcher,
  PromQLVectorSelector,
} from "../../../../Utils/PromQL/PromQLAst";
import PromQLEngine from "../../../../Utils/PromQL/PromQLEngine";
import {
  PromQLQueryResult,
  PromQLResultType,
  PromQLSeries,
  PromQLVectorResultSample,
} from "../../../../Utils/PromQL/PromQLEngineTypes";
import PromQLError from "../../../../Utils/PromQL/PromQLError";
import { formatPromQLLabels } from "../../../../Utils/PromQL/PromQLLabels";
import {
  PromQLMetricRequest,
  PromQLSeriesKind,
} from "../../../../Utils/PromQL/PromQLMetricNames";
import { parsePromQL } from "../../../../Utils/PromQL/PromQLParser";
import * as PatternCache from "../../../../Utils/LinearRegExp/PatternCache";
import { describe, expect, jest, test } from "@jest/globals";
import type { SpyInstance } from "jest-mock";

/*
 * The ClickHouse reader behind PromQL (issue #6796): which rows a selector
 * reads, scoped to the caller's project and services, and the series those
 * rows become, all the way through the engine.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "5a6d3b1c-7f8e-4a2b-9c0d-1e2f3a4b5c6d",
);
const SERVICE_ID: ObjectID = new ObjectID(
  "0f1e2d3c-4b5a-4968-8776-655443322110",
);

const matchersOf: (query: string) => Array<PromQLLabelMatcher> = (
  query: string,
): Array<PromQLLabelMatcher> => {
  return (parsePromQL(query) as PromQLVectorSelector).matchers;
};

const paramValues: (statement: Statement) => Array<unknown> = (
  statement: Statement,
): Array<unknown> => {
  return Object.values(statement.query_params);
};

describe("which stored metrics a selector reads", () => {
  const stored: Array<string> = [
    "http.server.request.duration",
    "http_requests",
    "system.cpu.utilization",
  ];

  test("a regular expression on the name is matched against PromQL names", () => {
    const requests: Array<PromQLMetricRequest> = resolvePromQLSelection(
      matchersOf('{__name__=~"http_.*_count"}'),
      stored,
    );

    /*
     * The point type is only known from the rows, so http_requests (a sum)
     * is asked for its _count too; its rows hold none, and none is read.
     */
    expect(requests).toEqual([
      {
        storedName: "http.server.request.duration",
        kind: PromQLSeriesKind.Count,
        seriesName: "http_server_request_duration_count",
      },
      {
        storedName: "http_requests",
        kind: PromQLSeriesKind.Count,
        seriesName: "http_requests_count",
      },
    ]);
  });

  test("a selector with no name reads every metric's series", () => {
    const requests: Array<PromQLMetricRequest> = resolvePromQLSelection(
      matchersOf('{job="api"}'),
      ["temperature"],
    );

    expect(
      requests.map((item: PromQLMetricRequest): string => {
        return item.seriesName;
      }),
    ).toEqual([
      "temperature",
      "temperature_bucket",
      "temperature_count",
      "temperature_sum",
    ]);
  });

  test("a name matcher's pattern is compiled once for every stored name", () => {
    // Read first: the parser compiles the pattern to check it.
    const matchers: Array<PromQLLabelMatcher> = matchersOf(
      '{__name__=~"http_.*"}',
    );
    const compiles: SpyInstance<typeof PatternCache.getLinearRegExp> =
      jest.spyOn(PatternCache, "getLinearRegExp");

    try {
      expect(resolvePromQLSelection(matchers, stored)).toHaveLength(8);
      expect(compiles).toHaveBeenCalledTimes(1);
    } finally {
      compiles.mockRestore();
    }
  });

  test("a name matcher that excludes keeps the rest", () => {
    expect(
      resolvePromQLSelection(
        matchersOf(
          '{__name__=~".+", __name__!~".*_(bucket|count|sum)", __name__!="http_requests"}',
        ),
        stored,
      ).map((item: PromQLMetricRequest): string => {
        return item.seriesName;
      }),
    ).toEqual(["http_server_request_duration", "system_cpu_utilization"]);
  });
});

describe("the SQL a selector's read runs", () => {
  const statement: Statement = buildPromQLMetricRowsStatement({
    projectId: PROJECT_ID,
    storedNames: ["http.server.request.duration"],
    startTimeMs: 1700000000500,
    endTimeMs: 1700003600999,
    serviceFilter: { serviceIds: [SERVICE_ID] },
    matchers: matchersOf(
      'x{"http.route"="/checkout", code!="500", job="api", le="0.5"}',
    ),
    limit: 1000001,
  });

  test("reads the project's own rows first", () => {
    expect(statement.query).toContain(
      "FROM {p0:Identifier} WHERE projectId = {p1:String}",
    );
    expect(paramValues(statement)).toContain(PROJECT_ID.toString());
    expect(paramValues(statement)).toContain("MetricItemV3");
  });

  test("reads only the metrics the selector names", () => {
    expect(statement.query).toContain("AND name IN ({p2:Array(String)})");
    expect(paramValues(statement)).toContainEqual([
      "http.server.request.duration",
    ]);
  });

  test("widens the window to the whole seconds the time column holds", () => {
    expect(paramValues(statement)).toContain("2023-11-14 22:13:20.000000000");
    expect(paramValues(statement)).toContain("2023-11-14 23:13:20.000000000");
  });

  test("reads only the services the caller may read, within retention", () => {
    expect(statement.query).toContain("retentionDate >= now()");
    expect(statement.query).toContain("AND primaryEntityId IN (");
    expect(paramValues(statement)).toContainEqual([SERVICE_ID.toString()]);
  });

  test("lets ClickHouse check equality matchers on attributes, and only those", () => {
    expect(statement.query.match(/arrayExists/g)).toHaveLength(1);
    expect(statement.query).toContain(
      "replaceRegexpAll(k, '[^a-zA-Z0-9_]', '_')",
    );
    expect(paramValues(statement)).toContain("/checkout");
    expect(paramValues(statement)).toContain("http.route");
    // job, le and != are checked on the series, not in SQL.
    expect(paramValues(statement)).not.toContain("api");
    expect(paramValues(statement)).not.toContain("500");
  });

  test("stops at the row limit, with a time limit", () => {
    expect(statement.query).toContain("LIMIT {p");
    expect(paramValues(statement)).toContain(1000001);
    expect(statement.query).toContain("max_execution_time = 30");
    expect(statement.query).toContain("timeout_overflow_mode = 'throw'");
  });

  test("a versioned metric is read at each point's latest version, deletes left out", () => {
    const mutable: Statement = buildPromQLMutableMetricRowsStatement({
      projectId: PROJECT_ID,
      storedNames: ["oneuptime.incident.count"],
      startTimeMs: 0,
      endTimeMs: 60000,
      serviceFilter: {},
      matchers: [],
      limit: 10,
    });

    expect(mutable.query).toContain("argMax(value, version) AS latestValue");
    expect(mutable.query).toContain("WHERE latestDeleted = false");
    // An alias named like a column would shadow it in the inner WHERE.
    expect(mutable.query).not.toMatch(/argMax\(time, version\) AS time\b/);
    expect(paramValues(mutable)).toContain("MutableMetricItem");
    expect(paramValues(mutable)).toContain(PROJECT_ID.toString());
  });
});

// A source that answers from rows held here and records what it ran.
const sourceWith: (data: {
  rows: Array<JSONObject>;
  storedNames: Array<string>;
  maxRows?: number;
}) => {
  source: PromQLMetricSeriesSource;
  statements: Array<Statement>;
} = (data: {
  rows: Array<JSONObject>;
  storedNames: Array<string>;
  maxRows?: number;
}): { source: PromQLMetricSeriesSource; statements: Array<Statement> } => {
  const statements: Array<Statement> = [];
  const source: PromQLMetricSeriesSource = new PromQLMetricSeriesSource({
    projectId: PROJECT_ID,
    serviceFilter: {},
    maxRows: data.maxRows,
    listStoredNames: async (): Promise<Array<string>> => {
      return data.storedNames;
    },
    readRows: async (statement: Statement): Promise<Array<JSONObject>> => {
      statements.push(statement);
      const names: Array<string> = (
        Object.values(statement.query_params).find(
          (value: unknown): boolean => {
            return Array.isArray(value);
          },
        ) as Array<string>
      ).map((name: string): string => {
        return name;
      });

      return data.rows.filter((row: JSONObject): boolean => {
        return names.includes(row["name"] as string);
      });
    },
  });

  return { source, statements };
};

const histogramRow: (
  timestampMs: number,
  bucketCounts: Array<number>,
  route: string,
) => JSONObject = (
  timestampMs: number,
  bucketCounts: Array<number>,
  route: string,
): JSONObject => {
  return {
    name: "http.server.request.duration",
    metricPointType: "Histogram",
    aggregationTemporality: "Cumulative",
    attributes: {
      "http.route": route,
      "resource.service.name": "checkout",
    },
    timestampMs: String(timestampMs),
    value: 1,
    count: bucketCounts.reduce((a: number, b: number): number => {
      return a + b;
    }, 0),
    sum: 1,
    bucketCounts,
    explicitBounds: [0.1, 0.5, 1],
    summaryQuantiles: [],
    summaryValues: [],
  };
};

describe("reading through the engine", () => {
  test("histogram_quantile over rate() of an OpenTelemetry histogram", async () => {
    // Every minute, 10 more requests: 5 under 0.1s, 4 under 0.5s, 1 under 1s.
    const rows: Array<JSONObject> = [];

    for (let minute: number = 1; minute <= 10; minute++) {
      rows.push(
        histogramRow(
          minute * 60000,
          [5 * minute, 4 * minute, minute, 0],
          "/checkout",
        ),
      );
    }

    const { source } = sourceWith({
      rows,
      storedNames: ["http.server.request.duration"],
    });
    const result: PromQLQueryResult = await new PromQLEngine(
      source,
    ).instantQuery(
      'histogram_quantile(0.5, sum by (le, job) (rate(http_server_request_duration_bucket{http_route="/checkout"}[5m])))',
      600000,
    );

    expect(result.resultType).toBe(PromQLResultType.Vector);
    const samples: Array<PromQLVectorResultSample> =
      result.resultType === PromQLResultType.Vector ? result.samples : [];

    expect(samples).toHaveLength(1);
    expect(formatPromQLLabels(samples[0]!.labels)).toBe('{job="checkout"}');
    // Half of the requests are under 0.1s: the median is the first bound.
    expect(samples[0]!.value).toBeCloseTo(0.1, 10);
  });

  test("an _count series reads the histogram's count", async () => {
    const { source } = sourceWith({
      rows: [histogramRow(60000, [1, 1, 1, 1], "/a")],
      storedNames: ["http.server.request.duration"],
    });
    const series: Array<PromQLSeries> = await source.select({
      metricName: "http_server_request_duration_count",
      matchers: matchersOf("http_server_request_duration_count"),
      startTimeMs: 0,
      endTimeMs: 120000,
    });

    expect(series).toHaveLength(1);
    expect(Array.from(series[0]!.values)).toEqual([4]);
    expect(series[0]!.labels["__name__"]).toBe(
      "http_server_request_duration_count",
    );
  });

  test("a name the catalog does not list yet is still read as itself", async () => {
    const { source, statements } = sourceWith({ rows: [], storedNames: [] });

    await source.select({
      metricName: "nope",
      matchers: matchersOf("nope"),
      startTimeMs: 0,
      endTimeMs: 1,
    });

    expect(statements).toHaveLength(1);
  });

  test("incident, alert and maintenance metrics are read from their own table", async () => {
    const { source, statements } = sourceWith({
      rows: [],
      storedNames: ["oneuptime.incident.count", "http_requests"],
    });

    await source.select({
      metricName: undefined,
      matchers: matchersOf(
        '{__name__=~"oneuptime_incident_count|http_requests"}',
      ),
      startTimeMs: 0,
      endTimeMs: 1,
    });

    const tables: Array<unknown> = statements.map(
      (statement: Statement): unknown => {
        return Object.values(statement.query_params)[0];
      },
    );

    expect(tables.sort()).toEqual(["MetricItemV3", "MutableMetricItem"]);
  });

  test("a read over the row limit is refused, not cut short", async () => {
    const { source } = sourceWith({
      rows: [1, 2, 3].map((minute: number): JSONObject => {
        return histogramRow(minute * 60000, [1, 0, 0, 0], "/a");
      }),
      storedNames: ["http.server.request.duration"],
      maxRows: 2,
    });

    await expect(
      source.select({
        metricName: "http_server_request_duration_count",
        matchers: matchersOf("http_server_request_duration_count"),
        startTimeMs: 0,
        endTimeMs: 600000,
      }),
    ).rejects.toThrow(PromQLError);
  });
});
