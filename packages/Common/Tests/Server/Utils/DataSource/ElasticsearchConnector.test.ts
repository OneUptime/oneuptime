import ElasticsearchConnector, {
  applyElasticsearchTimeMacros,
  buildElasticsearchSearchUrl,
  parseHitsToTable,
  parseQueryDsl,
  parseTimeSeriesAggregations,
} from "../../../../Server/Utils/DataSource/Connectors/ElasticsearchConnector";
import DataSourceEgressGuard from "../../../../Server/Utils/DataSource/EgressGuard";
import DataSourceHttpFetch, {
  DataSourceHttpRequest,
  DataSourceHttpResponse,
} from "../../../../Server/Utils/DataSource/HttpFetch";
import {
  DataSourceConnectionSettings,
  DataSourceQueryWindow,
} from "../../../../Server/Utils/DataSource/Types";
import AggregatedResult from "../../../../Types/BaseDatabase/AggregatedResult";
import {
  DATA_SOURCE_CONNECT_TIMEOUT_IN_MS,
  DATA_SOURCE_MAX_TABLE_ROWS,
  DATA_SOURCE_QUERY_TIMEOUT_IN_MS,
} from "../../../../Types/DataSource/DataSourceLimits";
import DataSourceTableResult, {
  DataSourceTableColumn,
  DataSourceTableColumnType,
} from "../../../../Types/DataSource/DataSourceTableResult";
import DataSourceType from "../../../../Types/DataSource/DataSourceType";
import BadDataException from "../../../../Types/Exception/BadDataException";
import { afterEach, describe, expect, test } from "@jest/globals";

const SECRET_PASSWORD: string = "sup3r-secret-pass";
const SECRET_TOKEN: string = "secret-api-token-value";

/*
 * Fixed window every test queries over:
 * 2026-01-01T00:00:00Z ... 2026-01-02T00:00:00Z.
 */
const START_DATE: Date = new Date(Date.UTC(2026, 0, 1, 0, 0, 0));
const END_DATE: Date = new Date(Date.UTC(2026, 0, 2, 0, 0, 0));
const START_EPOCH_MS: number = START_DATE.getTime();
const END_EPOCH_MS: number = END_DATE.getTime();

const HOUR_MS: number = 60 * 60 * 1000;

function makeWindow(): DataSourceQueryWindow {
  return { startDate: START_DATE, endDate: END_DATE };
}

function makeSettings(
  overrides?: Partial<DataSourceConnectionSettings>,
): DataSourceConnectionSettings {
  return {
    dataSourceType: DataSourceType.Elasticsearch,
    url: "https://elastic.example.com:9200",
    username: "readonly_user",
    password: SECRET_PASSWORD,
    ...overrides,
  };
}

function jsonResponse(
  payload: unknown,
  statusCode: number = 200,
): DataSourceHttpResponse {
  return {
    statusCode: statusCode,
    bodyText: JSON.stringify(payload),
    bodyJson: payload,
  };
}

function mockGuard(): jest.SpyInstance {
  return jest
    .spyOn(DataSourceEgressGuard, "assertHostnameAllowed")
    .mockResolvedValue([{ address: "203.0.113.10", family: 4 }]);
}

function mockFetch(response: DataSourceHttpResponse): jest.SpyInstance {
  return jest.spyOn(DataSourceHttpFetch, "fetch").mockResolvedValue(response);
}

function getRequest(
  spy: jest.SpyInstance,
  callIndex: number = 0,
): DataSourceHttpRequest {
  return spy.mock.calls[callIndex]![0] as DataSourceHttpRequest;
}

function getRequestBody(spy: jest.SpyInstance): Record<string, unknown> {
  return JSON.parse(getRequest(spy).body as string) as Record<string, unknown>;
}

const HISTOGRAM_QUERY: string =
  '{ "query": { "match_all": {} }, "aggs": { "over_time": { "date_histogram": { "field": "@timestamp", "fixed_interval": "1h" } } } }';

/*
 * ES 8-shaped date_histogram response: buckets carry both the epoch-ms key
 * and key_as_string, plus a metric sub-aggregation.
 */
function histogramResponse(): unknown {
  return {
    took: 3,
    timed_out: false,
    hits: { total: { value: 12, relation: "eq" }, hits: [] },
    aggregations: {
      over_time: {
        buckets: [
          {
            key_as_string: "2026-01-01T00:00:00.000Z",
            key: START_EPOCH_MS,
            doc_count: 5,
            avg_latency: { value: 12.5 },
          },
          {
            key_as_string: "2026-01-01T01:00:00.000Z",
            key: START_EPOCH_MS + HOUR_MS,
            doc_count: 7,
            avg_latency: { value: 15 },
          },
        ],
      },
    },
  };
}

function termsResponse(): unknown {
  return {
    aggregations: {
      by_service: {
        doc_count_error_upper_bound: 0,
        sum_other_doc_count: 0,
        buckets: [
          {
            key: "api",
            doc_count: 10,
            over_time: {
              buckets: [
                { key: START_EPOCH_MS, doc_count: 4 },
                { key: START_EPOCH_MS + HOUR_MS, doc_count: 6 },
              ],
            },
          },
          {
            key: "worker",
            doc_count: 6,
            over_time: {
              buckets: [{ key: START_EPOCH_MS, doc_count: 6 }],
            },
          },
        ],
      },
    },
  };
}

function makeHit(
  id: string,
  source: Record<string, unknown> | undefined,
): Record<string, unknown> {
  return {
    _index: "logs-2026.01.01",
    _id: id,
    _score: 1,
    _source: source,
  };
}

function hitsResponse(
  hits: Array<Record<string, unknown>>,
  total: unknown,
): unknown {
  return { hits: { total: total, hits: hits } };
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("applyElasticsearchTimeMacros", () => {
  test("replaces ms macros with epoch numbers and plain macros with unquoted ISO strings", () => {
    const substituted: string = applyElasticsearchTimeMacros(
      '{"gte": $__startTimeMs, "lte": $__endTimeMs, "from": "$__startTime", "to": "$__endTime"}',
      START_DATE,
      END_DATE,
    );

    expect(substituted).toBe(
      `{"gte": ${START_EPOCH_MS}, "lte": ${END_EPOCH_MS}, "from": "2026-01-01T00:00:00.000Z", "to": "2026-01-02T00:00:00.000Z"}`,
    );
  });

  test("replaces every occurrence and leaves unrelated text untouched", () => {
    const substituted: string = applyElasticsearchTimeMacros(
      "$__startTime $__startTime keep-this $__endTimeMs",
      START_DATE,
      END_DATE,
    );

    expect(substituted).toBe(
      `2026-01-01T00:00:00.000Z 2026-01-01T00:00:00.000Z keep-this ${END_EPOCH_MS}`,
    );
  });
});

describe("parseQueryDsl", () => {
  test("parses a Query DSL body with macros inside existing string quotes", () => {
    const body: Record<string, unknown> = parseQueryDsl(
      '{ "query": { "range": { "@timestamp": { "gte": "$__startTime", "lte": "$__endTime" } } } }',
      START_DATE,
      END_DATE,
    );

    const query: Record<string, unknown> = body["query"] as Record<
      string,
      unknown
    >;
    const range: Record<string, unknown> = query["range"] as Record<
      string,
      unknown
    >;
    const timestampFilter: Record<string, unknown> = range[
      "@timestamp"
    ] as Record<string, unknown>;

    expect(timestampFilter["gte"]).toBe("2026-01-01T00:00:00.000Z");
    expect(timestampFilter["lte"]).toBe("2026-01-02T00:00:00.000Z");
  });

  test("throws a BadDataException naming the parse problem for invalid JSON", () => {
    expect(() => {
      return parseQueryDsl('{ "query": ', START_DATE, END_DATE);
    }).toThrow(BadDataException);
    expect(() => {
      return parseQueryDsl('{ "query": ', START_DATE, END_DATE);
    }).toThrow(/Query is not valid JSON/);
  });

  test("throws when the query is empty or whitespace", () => {
    expect(() => {
      return parseQueryDsl("", START_DATE, END_DATE);
    }).toThrow(/Query is required/);
    expect(() => {
      return parseQueryDsl("   ", START_DATE, END_DATE);
    }).toThrow(/Query is required/);
  });

  test("throws when the query is a JSON array or primitive", () => {
    expect(() => {
      return parseQueryDsl("[1, 2]", START_DATE, END_DATE);
    }).toThrow(/must be a JSON object/);
    expect(() => {
      return parseQueryDsl("42", START_DATE, END_DATE);
    }).toThrow(/must be a JSON object/);
  });
});

describe("buildElasticsearchSearchUrl", () => {
  test("defaults the index to * and trims trailing slashes from the base URL", () => {
    const url: string = buildElasticsearchSearchUrl(
      makeSettings({ url: "https://elastic.example.com:9200///" }),
    );

    expect(url).toBe("https://elastic.example.com:9200/*/_search");
  });

  test("URL-encodes the configured index into the path", () => {
    const url: string = buildElasticsearchSearchUrl(
      makeSettings({
        additionalOptions: { elasticsearchIndex: "logs/2026 team" },
      }),
    );

    expect(url).toBe(
      "https://elastic.example.com:9200/logs%2F2026%20team/_search",
    );
  });

  test("keeps wildcard index patterns usable after encoding", () => {
    const url: string = buildElasticsearchSearchUrl(
      makeSettings({
        additionalOptions: { elasticsearchIndex: "logs-*" },
      }),
    );

    expect(url).toBe("https://elastic.example.com:9200/logs-*/_search");
  });

  test("throws when the settings have no URL", () => {
    expect(() => {
      return buildElasticsearchSearchUrl(makeSettings({ url: undefined }));
    }).toThrow(/missing a URL/);
  });
});

describe("parseTimeSeriesAggregations", () => {
  test("parses a single date_histogram using the first numeric sub-aggregation value", () => {
    const result: AggregatedResult =
      parseTimeSeriesAggregations(histogramResponse());

    expect(result.truncated).toBe(false);
    expect(result.data).toHaveLength(2);
    expect(result.data[0]!.timestamp).toEqual(new Date(START_EPOCH_MS));
    expect(result.data[0]!.value).toBe(12.5);
    expect(result.data[1]!.timestamp).toEqual(
      new Date(START_EPOCH_MS + HOUR_MS),
    );
    expect(result.data[1]!.value).toBe(15);
    expect(result.data[0]!["attributes"]).toBeUndefined();
  });

  test("falls back to doc_count when no sub-aggregation owns a numeric value", () => {
    const body: unknown = {
      aggregations: {
        per_hour: {
          buckets: [
            { key: START_EPOCH_MS, doc_count: 9 },
            { key: START_EPOCH_MS + HOUR_MS, doc_count: 3 },
          ],
        },
      },
    };

    const result: AggregatedResult = parseTimeSeriesAggregations(body);

    expect(result.data).toHaveLength(2);
    expect(result.data[0]!.value).toBe(9);
    expect(result.data[1]!.value).toBe(3);
  });

  test("coerces string-number sub-aggregation values", () => {
    const body: unknown = {
      aggregations: {
        per_hour: {
          buckets: [
            { key: START_EPOCH_MS, doc_count: 2, p99: { value: "42.5" } },
          ],
        },
      },
    };

    const result: AggregatedResult = parseTimeSeriesAggregations(body);

    expect(result.data).toHaveLength(1);
    expect(result.data[0]!.value).toBe(42.5);
  });

  test("falls back to doc_count when the sub-aggregation value is null", () => {
    const body: unknown = {
      aggregations: {
        per_hour: {
          buckets: [
            { key: START_EPOCH_MS, doc_count: 4, avg_ms: { value: null } },
          ],
        },
      },
    };

    const result: AggregatedResult = parseTimeSeriesAggregations(body);

    expect(result.data).toHaveLength(1);
    expect(result.data[0]!.value).toBe(4);
  });

  test("parses timestamps from key_as_string when the numeric key is absent", () => {
    const body: unknown = {
      aggregations: {
        per_hour: {
          buckets: [
            { key_as_string: "2026-01-01T05:00:00.000Z", doc_count: 8 },
          ],
        },
      },
    };

    const result: AggregatedResult = parseTimeSeriesAggregations(body);

    expect(result.data).toHaveLength(1);
    expect(result.data[0]!.timestamp).toEqual(
      new Date("2026-01-01T05:00:00.000Z"),
    );
    expect(result.data[0]!.value).toBe(8);
  });

  test("skips malformed bucket entries instead of failing the chart", () => {
    const body: unknown = {
      aggregations: {
        per_hour: {
          buckets: [
            null,
            "garbage",
            { key: START_EPOCH_MS, doc_count: 1 },
            { doc_count: 2 },
          ],
        },
      },
    };

    const result: AggregatedResult = parseTimeSeriesAggregations(body);

    expect(result.data).toHaveLength(1);
    expect(result.data[0]!.value).toBe(1);
  });

  test("builds one series per term bucket with attributes keyed by the terms agg name", () => {
    const result: AggregatedResult =
      parseTimeSeriesAggregations(termsResponse());

    expect(result.truncated).toBe(false);
    expect(result.data).toHaveLength(3);
    expect(result.data[0]!["attributes"]).toEqual({ by_service: "api" });
    expect(result.data[0]!.value).toBe(4);
    expect(result.data[1]!["attributes"]).toEqual({ by_service: "api" });
    expect(result.data[2]!["attributes"]).toEqual({ by_service: "worker" });
    expect(result.data[2]!.value).toBe(6);
  });

  test("labels term series from key_as_string when present (boolean terms)", () => {
    const body: unknown = {
      aggregations: {
        by_success: {
          buckets: [
            {
              key: 1,
              key_as_string: "true",
              doc_count: 5,
              over_time: {
                buckets: [{ key: START_EPOCH_MS, doc_count: 5 }],
              },
            },
          ],
        },
      },
    };

    const result: AggregatedResult = parseTimeSeriesAggregations(body);

    expect(result.data).toHaveLength(1);
    expect(result.data[0]!["attributes"]).toEqual({ by_success: "true" });
  });

  test("stringifies numeric term keys for series labels", () => {
    const body: unknown = {
      aggregations: {
        by_status: {
          buckets: [
            {
              key: 500,
              doc_count: 2,
              over_time: {
                buckets: [{ key: START_EPOCH_MS, doc_count: 2 }],
              },
            },
          ],
        },
      },
    };

    const result: AggregatedResult = parseTimeSeriesAggregations(body);

    expect(result.data[0]!["attributes"]).toEqual({ by_status: "500" });
  });

  test("caps the number of series and flags truncation", () => {
    const body: unknown = {
      aggregations: {
        by_service: {
          buckets: [
            {
              key: "a",
              over_time: { buckets: [{ key: START_EPOCH_MS, doc_count: 1 }] },
            },
            {
              key: "b",
              over_time: { buckets: [{ key: START_EPOCH_MS, doc_count: 2 }] },
            },
            {
              key: "c",
              over_time: { buckets: [{ key: START_EPOCH_MS, doc_count: 3 }] },
            },
          ],
        },
      },
    };

    const result: AggregatedResult = parseTimeSeriesAggregations(body, {
      maxSeries: 2,
    });

    expect(result.truncated).toBe(true);
    expect(result.data).toHaveLength(2);
    const labels: Array<string> = result.data.map(
      (point: Record<string, unknown>) => {
        return (point["attributes"] as Record<string, string>)["by_service"]!;
      },
    );
    expect(labels).toEqual(["a", "b"]);
  });

  test("caps total points across term series and flags truncation", () => {
    const result: AggregatedResult = parseTimeSeriesAggregations(
      termsResponse(),
      { maxPoints: 2 },
    );

    expect(result.truncated).toBe(true);
    expect(result.data).toHaveLength(2);
  });

  test("caps points in a single date_histogram and flags truncation", () => {
    const buckets: Array<Record<string, unknown>> = [];
    for (let index: number = 0; index < 5; index++) {
      buckets.push({ key: START_EPOCH_MS + index * HOUR_MS, doc_count: index });
    }

    const result: AggregatedResult = parseTimeSeriesAggregations(
      { aggregations: { per_hour: { buckets: buckets } } },
      { maxPoints: 3 },
    );

    expect(result.truncated).toBe(true);
    expect(result.data).toHaveLength(3);
  });

  test("returns an empty result for an empty bucket list", () => {
    const result: AggregatedResult = parseTimeSeriesAggregations({
      aggregations: { per_hour: { buckets: [] } },
    });

    expect(result.data).toEqual([]);
    expect(result.truncated).toBe(false);
  });

  test("throws when the response has no aggregations", () => {
    expect(() => {
      return parseTimeSeriesAggregations({ hits: { hits: [] } });
    }).toThrow(/date_histogram/);
  });

  test("throws when aggregations contain no bucket aggregation", () => {
    expect(() => {
      return parseTimeSeriesAggregations({
        aggregations: { avg_latency: { value: 42 } },
      });
    }).toThrow(/date_histogram/);
  });

  test("throws when bucket keys are not timestamps (plain terms agg)", () => {
    expect(() => {
      return parseTimeSeriesAggregations({
        aggregations: {
          by_host: {
            buckets: [
              { key: "host-1", doc_count: 4 },
              { key: "host-2", doc_count: 2 },
            ],
          },
        },
      });
    }).toThrow(/does not look like a date_histogram/);
  });

  test("throws for a non-object response body", () => {
    expect(() => {
      return parseTimeSeriesAggregations([1, 2, 3]);
    }).toThrow(/unexpected response shape/);
    expect(() => {
      return parseTimeSeriesAggregations("not-json-object");
    }).toThrow(/unexpected response shape/);
  });
});

describe("parseHitsToTable", () => {
  test("builds _id and _index columns plus the union of _source keys", () => {
    const result: DataSourceTableResult = parseHitsToTable(
      hitsResponse(
        [
          makeHit("doc-1", {
            message: "error occurred",
            level: "error",
            status: 500,
          }),
          makeHit("doc-2", { message: "all good", region: "eu-west-1" }),
        ],
        { value: 2, relation: "eq" },
      ),
    );

    const keys: Array<string> = result.columns.map(
      (column: DataSourceTableColumn) => {
        return column.key;
      },
    );
    expect(keys).toEqual([
      "_id",
      "_index",
      "message",
      "level",
      "status",
      "region",
    ]);

    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]!["_id"]).toBe("doc-1");
    expect(result.rows[0]!["_index"]).toBe("logs-2026.01.01");
    expect(result.rows[0]!["status"]).toBe(500);
    expect(result.rows[0]!["region"]).toBeNull();
    expect(result.rows[1]!["level"]).toBeNull();
    expect(result.rows[1]!["region"]).toBe("eu-west-1");
    expect(result.truncated).toBe(false);
  });

  test("sniffs column types from cell values", () => {
    const result: DataSourceTableResult = parseHitsToTable(
      hitsResponse([makeHit("doc-1", { count: 3, ok: true, note: "text" })], {
        value: 1,
        relation: "eq",
      }),
    );

    const typeByKey: Record<string, DataSourceTableColumnType> = {};
    for (const column of result.columns) {
      typeByKey[column.key] = column.type;
    }
    expect(typeByKey["count"]).toBe(DataSourceTableColumnType.Number);
    expect(typeByKey["ok"]).toBe(DataSourceTableColumnType.Boolean);
    expect(typeByKey["note"]).toBe(DataSourceTableColumnType.Text);
    expect(typeByKey["_id"]).toBe(DataSourceTableColumnType.Text);
  });

  test("serializes nested _source objects to JSON strings", () => {
    const result: DataSourceTableResult = parseHitsToTable(
      hitsResponse(
        [makeHit("doc-1", { context: { user: "u-1", attempts: 2 } })],
        { value: 1, relation: "eq" },
      ),
    );

    expect(result.rows[0]!["context"]).toBe('{"user":"u-1","attempts":2}');
  });

  test("caps the column set at 50 columns", () => {
    const wideSource: Record<string, unknown> = {};
    for (let index: number = 0; index < 60; index++) {
      wideSource[`field_${index}`] = index;
    }

    const result: DataSourceTableResult = parseHitsToTable(
      hitsResponse([makeHit("doc-1", wideSource)], {
        value: 1,
        relation: "eq",
      }),
    );

    expect(result.columns).toHaveLength(50);
    const keys: Array<string> = result.columns.map(
      (column: DataSourceTableColumn) => {
        return column.key;
      },
    );
    expect(keys).toContain("_id");
    expect(keys).toContain("_index");
    expect(keys).toContain("field_47");
    expect(keys).not.toContain("field_48");
  });

  test("handles hits without _source", () => {
    const result: DataSourceTableResult = parseHitsToTable(
      hitsResponse([makeHit("doc-1", undefined)], {
        value: 1,
        relation: "eq",
      }),
    );

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]!["_id"]).toBe("doc-1");
    expect(
      result.columns.map((column: DataSourceTableColumn) => {
        return column.key;
      }),
    ).toEqual(["_id", "_index"]);
  });

  test("returns an empty result for zero hits", () => {
    const result: DataSourceTableResult = parseHitsToTable(
      hitsResponse([], { value: 0, relation: "eq" }),
    );

    expect(result.columns).toEqual([]);
    expect(result.rows).toEqual([]);
    expect(result.truncated).toBe(false);
  });

  test("clamps rows beyond maxRows and flags truncation", () => {
    const result: DataSourceTableResult = parseHitsToTable(
      hitsResponse(
        [
          makeHit("doc-1", { n: 1 }),
          makeHit("doc-2", { n: 2 }),
          makeHit("doc-3", { n: 3 }),
        ],
        { value: 3, relation: "eq" },
      ),
      { maxRows: 2 },
    );

    expect(result.rows).toHaveLength(2);
    expect(result.truncated).toBe(true);
  });

  test("flags truncation when a full page has more matching documents (ES 7/8 total object)", () => {
    const result: DataSourceTableResult = parseHitsToTable(
      hitsResponse(
        [
          makeHit("doc-1", { n: 1 }),
          makeHit("doc-2", { n: 2 }),
          makeHit("doc-3", { n: 3 }),
        ],
        { value: 10, relation: "gte" },
      ),
      { maxRows: 3 },
    );

    expect(result.rows).toHaveLength(3);
    expect(result.truncated).toBe(true);
  });

  test("flags truncation with an ES 6-style numeric total", () => {
    const result: DataSourceTableResult = parseHitsToTable(
      hitsResponse([makeHit("doc-1", { n: 1 })], 10),
      { maxRows: 1 },
    );

    expect(result.truncated).toBe(true);
  });

  test("does not flag truncation when the page is not full", () => {
    const result: DataSourceTableResult = parseHitsToTable(
      hitsResponse([makeHit("doc-1", { n: 1 })], {
        value: 10,
        relation: "eq",
      }),
      { maxRows: 5 },
    );

    expect(result.truncated).toBe(false);
  });

  test("throws when the response is missing hits.hits", () => {
    expect(() => {
      return parseHitsToTable({ took: 1 });
    }).toThrow(/missing hits\.hits/);
    expect(() => {
      return parseHitsToTable({ hits: { total: 1 } });
    }).toThrow(/missing hits\.hits/);
  });

  test("throws for a non-object response body", () => {
    expect(() => {
      return parseHitsToTable("nope");
    }).toThrow(/unexpected response shape/);
  });

  test("skips malformed hit entries", () => {
    const result: DataSourceTableResult = parseHitsToTable(
      hitsResponse(
        [null as unknown as Record<string, unknown>, makeHit("doc-1", {})],
        { value: 2, relation: "eq" },
      ),
    );

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]!["_id"]).toBe("doc-1");
  });
});

describe("ElasticsearchConnector.testConnection", () => {
  test("passes on a 2xx JSON cluster banner and sends auth + connect timeout", async () => {
    const guardSpy: jest.SpyInstance = mockGuard();
    const fetchSpy: jest.SpyInstance = mockFetch(
      jsonResponse({ cluster_name: "prod", version: { number: "8.13.0" } }),
    );

    const connector: ElasticsearchConnector = new ElasticsearchConnector();
    await connector.testConnection(makeSettings());

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const request: DataSourceHttpRequest = getRequest(fetchSpy);
    expect(request.method).toBe("GET");
    expect(request.url).toBe("https://elastic.example.com:9200/");
    expect(request.timeoutInMs).toBe(DATA_SOURCE_CONNECT_TIMEOUT_IN_MS);

    const expectedBasic: string = `Basic ${Buffer.from(
      `readonly_user:${SECRET_PASSWORD}`,
    ).toString("base64")}`;
    expect(request.headers!["Authorization"]).toBe(expectedBasic);

    // The egress guard must have validated the host before the fetch.
    expect(guardSpy).toHaveBeenCalledWith("elastic.example.com", undefined);
    expect(guardSpy.mock.invocationCallOrder[0]!).toBeLessThan(
      fetchSpy.mock.invocationCallOrder[0]!,
    );
  });

  test("sends a Bearer token when an API token is configured", async () => {
    mockGuard();
    const fetchSpy: jest.SpyInstance = mockFetch(jsonResponse({ ok: true }));

    const connector: ElasticsearchConnector = new ElasticsearchConnector();
    await connector.testConnection(
      makeSettings({
        username: undefined,
        password: undefined,
        apiToken: SECRET_TOKEN,
      }),
    );

    expect(getRequest(fetchSpy).headers!["Authorization"]).toBe(
      `Bearer ${SECRET_TOKEN}`,
    );
  });

  test("lets a custom Authorization header win (ApiKey scheme)", async () => {
    mockGuard();
    const fetchSpy: jest.SpyInstance = mockFetch(jsonResponse({ ok: true }));

    const connector: ElasticsearchConnector = new ElasticsearchConnector();
    await connector.testConnection(
      makeSettings({
        customHeaders: { Authorization: "ApiKey encoded-key==" },
      }),
    );

    expect(getRequest(fetchSpy).headers!["Authorization"]).toBe(
      "ApiKey encoded-key==",
    );
  });

  test("surfaces HTTP 401 as a clear credential failure without leaking secrets", async () => {
    mockGuard();
    jest
      .spyOn(DataSourceHttpFetch, "fetch")
      .mockRejectedValue(
        new BadDataException(
          "Data source responded with HTTP 401: security_exception missing authentication credentials",
        ),
      );

    const connector: ElasticsearchConnector = new ElasticsearchConnector();
    const error: Error = await connector
      .testConnection(makeSettings())
      .then(() => {
        return new Error("expected rejection");
      })
      .catch((caught: Error) => {
        return caught;
      });

    expect(error).toBeInstanceOf(BadDataException);
    expect(error.message).toContain("401");
    expect(error.message).toContain("credentials");
    expect(error.message).not.toContain(SECRET_PASSWORD);
  });

  test("surfaces HTTP 403 as a permission failure", async () => {
    mockGuard();
    jest
      .spyOn(DataSourceHttpFetch, "fetch")
      .mockRejectedValue(
        new BadDataException("Data source responded with HTTP 403: forbidden"),
      );

    const connector: ElasticsearchConnector = new ElasticsearchConnector();
    await expect(connector.testConnection(makeSettings())).rejects.toThrow(
      /HTTP 403 Forbidden/,
    );
  });

  test("rejects a 2xx response that is not JSON", async () => {
    mockGuard();
    mockFetch({
      statusCode: 200,
      bodyText: "<html>login page</html>",
      bodyJson: undefined,
    });

    const connector: ElasticsearchConnector = new ElasticsearchConnector();
    await expect(connector.testConnection(makeSettings())).rejects.toThrow(
      /did not return the JSON cluster banner/,
    );
  });

  test("throws before fetching when no URL is configured", async () => {
    mockGuard();
    const fetchSpy: jest.SpyInstance = mockFetch(jsonResponse({ ok: true }));

    const connector: ElasticsearchConnector = new ElasticsearchConnector();
    await expect(
      connector.testConnection(makeSettings({ url: undefined })),
    ).rejects.toThrow(/missing a URL/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test("does not fetch when the egress guard blocks the host", async () => {
    jest
      .spyOn(DataSourceEgressGuard, "assertHostnameAllowed")
      .mockRejectedValue(
        new BadDataException(
          "Data source host elastic.example.com resolves to 127.0.0.1, which is not allowed: loopback address.",
        ),
      );
    const fetchSpy: jest.SpyInstance = jest.spyOn(DataSourceHttpFetch, "fetch");

    const connector: ElasticsearchConnector = new ElasticsearchConnector();
    await expect(connector.testConnection(makeSettings())).rejects.toThrow(
      /not allowed/,
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("ElasticsearchConnector.queryTimeSeries", () => {
  test("POSTs the macro-substituted body to the encoded index with size forced to 0", async () => {
    const guardSpy: jest.SpyInstance = mockGuard();
    const fetchSpy: jest.SpyInstance = mockFetch(
      jsonResponse(histogramResponse()),
    );

    const connector: ElasticsearchConnector = new ElasticsearchConnector();
    const query: string =
      '{ "size": 500, "query": { "range": { "@timestamp": { "gte": "$__startTime", "lte": "$__endTime" } } }, "aggs": { "over_time": { "date_histogram": { "field": "@timestamp", "fixed_interval": "1h" } } } }';

    const result: AggregatedResult = await connector.queryTimeSeries(
      makeSettings({
        additionalOptions: { elasticsearchIndex: "logs-*" },
      }),
      query,
      makeWindow(),
    );

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const request: DataSourceHttpRequest = getRequest(fetchSpy);
    expect(request.method).toBe("POST");
    expect(request.url).toBe("https://elastic.example.com:9200/logs-*/_search");
    expect(request.timeoutInMs).toBe(DATA_SOURCE_QUERY_TIMEOUT_IN_MS);

    const body: Record<string, unknown> = getRequestBody(fetchSpy);
    expect(body["size"]).toBe(0);
    const queryClause: Record<string, unknown> = body["query"] as Record<
      string,
      unknown
    >;
    const range: Record<string, unknown> = queryClause["range"] as Record<
      string,
      unknown
    >;
    const timestampFilter: Record<string, unknown> = range[
      "@timestamp"
    ] as Record<string, unknown>;
    expect(timestampFilter["gte"]).toBe("2026-01-01T00:00:00.000Z");
    expect(timestampFilter["lte"]).toBe("2026-01-02T00:00:00.000Z");

    expect(guardSpy.mock.invocationCallOrder[0]!).toBeLessThan(
      fetchSpy.mock.invocationCallOrder[0]!,
    );

    expect(result.data).toHaveLength(2);
    expect(result.data[0]!.value).toBe(12.5);
  });

  test("substitutes epoch-ms macros as JSON numbers", async () => {
    mockGuard();
    const fetchSpy: jest.SpyInstance = mockFetch(
      jsonResponse(histogramResponse()),
    );

    const connector: ElasticsearchConnector = new ElasticsearchConnector();
    await connector.queryTimeSeries(
      makeSettings(),
      '{ "query": { "range": { "ts": { "gte": $__startTimeMs, "lte": $__endTimeMs } } }, "aggs": { "h": { "date_histogram": { "field": "ts", "fixed_interval": "1h" } } } }',
      makeWindow(),
    );

    const body: Record<string, unknown> = getRequestBody(fetchSpy);
    const queryClause: Record<string, unknown> = body["query"] as Record<
      string,
      unknown
    >;
    const range: Record<string, unknown> = queryClause["range"] as Record<
      string,
      unknown
    >;
    const timestampFilter: Record<string, unknown> = range["ts"] as Record<
      string,
      unknown
    >;
    expect(timestampFilter["gte"]).toBe(START_EPOCH_MS);
    expect(timestampFilter["lte"]).toBe(END_EPOCH_MS);
  });

  test("throws for invalid query JSON without calling the network", async () => {
    mockGuard();
    const fetchSpy: jest.SpyInstance = mockFetch(
      jsonResponse(histogramResponse()),
    );

    const connector: ElasticsearchConnector = new ElasticsearchConnector();
    await expect(
      connector.queryTimeSeries(makeSettings(), "{ nope", makeWindow()),
    ).rejects.toThrow(/not valid JSON/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test("scrubs secrets from transport errors", async () => {
    mockGuard();
    jest
      .spyOn(DataSourceHttpFetch, "fetch")
      .mockRejectedValue(
        new Error(`connect failed: password ${SECRET_PASSWORD} rejected`),
      );

    const connector: ElasticsearchConnector = new ElasticsearchConnector();
    const error: Error = await connector
      .queryTimeSeries(makeSettings(), HISTOGRAM_QUERY, makeWindow())
      .then(() => {
        return new Error("expected rejection");
      })
      .catch((caught: Error) => {
        return caught;
      });

    expect(error).toBeInstanceOf(BadDataException);
    expect(error.message).not.toContain(SECRET_PASSWORD);
    expect(error.message).toContain("***");
  });

  test("surfaces the server's error body for failed queries without secrets", async () => {
    mockGuard();
    jest
      .spyOn(DataSourceHttpFetch, "fetch")
      .mockRejectedValue(
        new BadDataException(
          "Data source responded with HTTP 400: parsing_exception at line 1",
        ),
      );

    const connector: ElasticsearchConnector = new ElasticsearchConnector();
    const error: Error = await connector
      .queryTimeSeries(makeSettings(), HISTOGRAM_QUERY, makeWindow())
      .then(() => {
        return new Error("expected rejection");
      })
      .catch((caught: Error) => {
        return caught;
      });

    expect(error).toBeInstanceOf(BadDataException);
    expect(error.message).toContain("parsing_exception");
    expect(error.message).not.toContain(SECRET_PASSWORD);
  });

  test("rejects a non-JSON search response", async () => {
    mockGuard();
    mockFetch({
      statusCode: 200,
      bodyText: "<html>proxy error</html>",
      bodyJson: undefined,
    });

    const connector: ElasticsearchConnector = new ElasticsearchConnector();
    await expect(
      connector.queryTimeSeries(makeSettings(), HISTOGRAM_QUERY, makeWindow()),
    ).rejects.toThrow(/non-JSON response/);
  });

  test("uses the default * index when none is configured", async () => {
    mockGuard();
    const fetchSpy: jest.SpyInstance = mockFetch(
      jsonResponse(histogramResponse()),
    );

    const connector: ElasticsearchConnector = new ElasticsearchConnector();
    await connector.queryTimeSeries(
      makeSettings(),
      HISTOGRAM_QUERY,
      makeWindow(),
    );

    expect(getRequest(fetchSpy).url).toBe(
      "https://elastic.example.com:9200/*/_search",
    );
  });
});

describe("ElasticsearchConnector.queryTable", () => {
  const MATCH_ALL_QUERY: string = '{ "query": { "match_all": {} } }';

  test("defaults size to the table row cap and parses hit rows", async () => {
    const guardSpy: jest.SpyInstance = mockGuard();
    const fetchSpy: jest.SpyInstance = mockFetch(
      jsonResponse(
        hitsResponse([makeHit("doc-1", { message: "hello", status: 200 })], {
          value: 1,
          relation: "eq",
        }),
      ),
    );

    const connector: ElasticsearchConnector = new ElasticsearchConnector();
    const result: DataSourceTableResult = await connector.queryTable(
      makeSettings(),
      MATCH_ALL_QUERY,
      makeWindow(),
    );

    const body: Record<string, unknown> = getRequestBody(fetchSpy);
    expect(body["size"]).toBe(DATA_SOURCE_MAX_TABLE_ROWS);
    expect(getRequest(fetchSpy).timeoutInMs).toBe(
      DATA_SOURCE_QUERY_TIMEOUT_IN_MS,
    );

    expect(guardSpy.mock.invocationCallOrder[0]!).toBeLessThan(
      fetchSpy.mock.invocationCallOrder[0]!,
    );

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]!["message"]).toBe("hello");
    expect(result.rows[0]!["status"]).toBe(200);
  });

  test("keeps a smaller user-provided size", async () => {
    mockGuard();
    const fetchSpy: jest.SpyInstance = mockFetch(
      jsonResponse(hitsResponse([], { value: 0, relation: "eq" })),
    );

    const connector: ElasticsearchConnector = new ElasticsearchConnector();
    await connector.queryTable(
      makeSettings(),
      '{ "size": 5, "query": { "match_all": {} } }',
      makeWindow(),
    );

    expect(getRequestBody(fetchSpy)["size"]).toBe(5);
  });

  test("clamps an oversized user-provided size to the cap", async () => {
    mockGuard();
    const fetchSpy: jest.SpyInstance = mockFetch(
      jsonResponse(hitsResponse([], { value: 0, relation: "eq" })),
    );

    const connector: ElasticsearchConnector = new ElasticsearchConnector();
    await connector.queryTable(
      makeSettings(),
      '{ "size": 999999, "query": { "match_all": {} } }',
      makeWindow(),
    );

    expect(getRequestBody(fetchSpy)["size"]).toBe(DATA_SOURCE_MAX_TABLE_ROWS);
  });

  test("replaces an invalid size value with the cap", async () => {
    mockGuard();
    const fetchSpy: jest.SpyInstance = mockFetch(
      jsonResponse(hitsResponse([], { value: 0, relation: "eq" })),
    );

    const connector: ElasticsearchConnector = new ElasticsearchConnector();
    await connector.queryTable(
      makeSettings(),
      '{ "size": -3, "query": { "match_all": {} } }',
      makeWindow(),
    );

    expect(getRequestBody(fetchSpy)["size"]).toBe(DATA_SOURCE_MAX_TABLE_ROWS);
  });

  test("propagates a missing hits envelope as a BadDataException", async () => {
    mockGuard();
    mockFetch(jsonResponse({ took: 2 }));

    const connector: ElasticsearchConnector = new ElasticsearchConnector();
    await expect(
      connector.queryTable(makeSettings(), MATCH_ALL_QUERY, makeWindow()),
    ).rejects.toThrow(/missing hits\.hits/);
  });

  test("rejects a non-JSON response", async () => {
    mockGuard();
    mockFetch({
      statusCode: 200,
      bodyText: "plain text",
      bodyJson: undefined,
    });

    const connector: ElasticsearchConnector = new ElasticsearchConnector();
    await expect(
      connector.queryTable(makeSettings(), MATCH_ALL_QUERY, makeWindow()),
    ).rejects.toThrow(/non-JSON response/);
  });

  test("exposes the connector type for the registry", () => {
    const connector: ElasticsearchConnector = new ElasticsearchConnector();
    expect(connector.dataSourceType).toBe(DataSourceType.Elasticsearch);
  });
});
