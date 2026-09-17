import RestApiConnector, {
  RestApiFetchFunction,
  RestApiRequestDescriptor,
  applyRestTimeMacros,
  extractRowsByPath,
  parseRequestDescriptor,
} from "../../../../Server/Utils/DataSource/Connectors/RestApiConnector";
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
  DATA_SOURCE_MAX_TIME_SERIES_ROWS,
  DATA_SOURCE_QUERY_TIMEOUT_IN_MS,
} from "../../../../Types/DataSource/DataSourceLimits";
import DataSourceTableResult, {
  DataSourceTableColumn,
  DataSourceTableColumnType,
} from "../../../../Types/DataSource/DataSourceTableResult";
import DataSourceType from "../../../../Types/DataSource/DataSourceType";
import BadDataException from "../../../../Types/Exception/BadDataException";
import { afterEach, describe, expect, test } from "@jest/globals";

const START_DATE: Date = new Date("2024-01-01T00:00:00.000Z");
const END_DATE: Date = new Date("2024-01-02T00:00:00.000Z");

function makeWindow(): DataSourceQueryWindow {
  return { startDate: START_DATE, endDate: END_DATE };
}

function makeSettings(
  overrides?: Partial<DataSourceConnectionSettings>,
): DataSourceConnectionSettings {
  return {
    dataSourceType: DataSourceType.RestApi,
    url: "https://api.example.com",
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

afterEach(() => {
  jest.restoreAllMocks();
});

describe("parseRequestDescriptor", () => {
  test("applies defaults for an empty object descriptor", () => {
    const descriptor: RestApiRequestDescriptor = parseRequestDescriptor("{}");
    expect(descriptor.path).toBe("/");
    expect(descriptor.method).toBe("GET");
    expect(descriptor.body).toBeUndefined();
    expect(descriptor.rowsPath).toBeUndefined();
    expect(descriptor.timestampField).toBeUndefined();
    expect(descriptor.valueField).toBeUndefined();
    expect(descriptor.seriesField).toBeUndefined();
    expect(descriptor.labelFields).toBeUndefined();
  });

  test("parses a full descriptor and JSON-encodes an object body", () => {
    const queryText: string = JSON.stringify({
      path: "/api/stats",
      method: "POST",
      body: { filter: "errors" },
      rowsPath: "data.items",
      timestampField: "time",
      valueField: "count",
      seriesField: "service",
      labelFields: ["region", "env"],
    });
    const descriptor: RestApiRequestDescriptor =
      parseRequestDescriptor(queryText);
    expect(descriptor.path).toBe("/api/stats");
    expect(descriptor.method).toBe("POST");
    expect(descriptor.body).toBe('{"filter":"errors"}');
    expect(descriptor.rowsPath).toBe("data.items");
    expect(descriptor.timestampField).toBe("time");
    expect(descriptor.valueField).toBe("count");
    expect(descriptor.seriesField).toBe("service");
    expect(descriptor.labelFields).toEqual(["region", "env"]);
  });

  test("keeps a string body as-is", () => {
    const descriptor: RestApiRequestDescriptor = parseRequestDescriptor(
      '{ "method": "POST", "body": "raw-payload" }',
    );
    expect(descriptor.body).toBe("raw-payload");
  });

  test("normalizes a lowercase method", () => {
    const descriptor: RestApiRequestDescriptor = parseRequestDescriptor(
      '{ "method": "post" }',
    );
    expect(descriptor.method).toBe("POST");
  });

  test("rejects an empty query", () => {
    expect(() => {
      return parseRequestDescriptor("");
    }).toThrow(BadDataException);
    expect(() => {
      return parseRequestDescriptor("   ");
    }).toThrow(/Query is required/);
  });

  test("rejects invalid JSON", () => {
    expect(() => {
      return parseRequestDescriptor("{ not json");
    }).toThrow(BadDataException);
    expect(() => {
      return parseRequestDescriptor("{ not json");
    }).toThrow(/must be valid JSON/);
  });

  test("rejects JSON that is not an object", () => {
    expect(() => {
      return parseRequestDescriptor("[]");
    }).toThrow(/must be a JSON object/);
    expect(() => {
      return parseRequestDescriptor('"hello"');
    }).toThrow(/must be a JSON object/);
    expect(() => {
      return parseRequestDescriptor("42");
    }).toThrow(/must be a JSON object/);
  });

  test("rejects unknown HTTP methods", () => {
    expect(() => {
      return parseRequestDescriptor('{ "method": "DELETE" }');
    }).toThrow(/"method" must be "GET" or "POST"/);
    expect(() => {
      return parseRequestDescriptor('{ "method": "PUT" }');
    }).toThrow(BadDataException);
  });

  test("rejects a non-string method", () => {
    expect(() => {
      return parseRequestDescriptor('{ "method": 5 }');
    }).toThrow(/"method"/);
  });

  test("rejects an absolute URL smuggled into path", () => {
    expect(() => {
      return parseRequestDescriptor('{ "path": "https://evil.example.com/x" }');
    }).toThrow(/absolute http\(s\):\/\/ URLs are not allowed/);
    expect(() => {
      return parseRequestDescriptor('{ "path": "HTTP://evil.example.com/x" }');
    }).toThrow(/absolute/);
  });

  test("rejects a path that does not start with a slash", () => {
    expect(() => {
      return parseRequestDescriptor('{ "path": "api/stats" }');
    }).toThrow(/must start with "\/"/);
  });

  test("rejects a protocol-relative path", () => {
    expect(() => {
      return parseRequestDescriptor('{ "path": "//evil.example.com/x" }');
    }).toThrow(/protocol-relative/);
  });

  test("rejects path traversal, including percent-encoded dots", () => {
    expect(() => {
      return parseRequestDescriptor('{ "path": "/api/../admin" }');
    }).toThrow(/".." segments/);
    expect(() => {
      return parseRequestDescriptor('{ "path": "/api/%2e%2e/admin" }');
    }).toThrow(/".." segments/);
    expect(() => {
      return parseRequestDescriptor('{ "path": "/api/.%2E/admin" }');
    }).toThrow(/".." segments/);
  });

  test("rejects backslash-separated traversal, raw and percent-encoded", () => {
    /*
     * WHATWG URL parsing treats "\" as "/" in http(s) URLs, so a ".."
     * between backslashes climbs the path just like one between slashes.
     */
    expect(() => {
      return parseRequestDescriptor(JSON.stringify({ path: "/a\\..\\secret" }));
    }).toThrow(BadDataException);
    expect(() => {
      return parseRequestDescriptor(JSON.stringify({ path: "/a\\..\\secret" }));
    }).toThrow(/".." segments/);
    expect(() => {
      return parseRequestDescriptor('{ "path": "/%5c..%5csecret" }');
    }).toThrow(/".." segments/);
  });

  test("accepts a normal multi-segment path", () => {
    const descriptor: RestApiRequestDescriptor = parseRequestDescriptor(
      '{ "path": "/api/v1/data" }',
    );
    expect(descriptor.path).toBe("/api/v1/data");
  });

  test("rejects a non-string path", () => {
    expect(() => {
      return parseRequestDescriptor('{ "path": 12 }');
    }).toThrow(/"path" must be a string/);
  });

  test("rejects a body that is neither object nor string", () => {
    expect(() => {
      return parseRequestDescriptor('{ "body": 42 }');
    }).toThrow(/"body" must be a JSON object or a string/);
    expect(() => {
      return parseRequestDescriptor('{ "body": true }');
    }).toThrow(BadDataException);
  });

  test("rejects wrong types for string fields", () => {
    expect(() => {
      return parseRequestDescriptor('{ "rowsPath": 5 }');
    }).toThrow(/"rowsPath"/);
    expect(() => {
      return parseRequestDescriptor('{ "timestampField": [] }');
    }).toThrow(/"timestampField"/);
    expect(() => {
      return parseRequestDescriptor('{ "valueField": {} }');
    }).toThrow(/"valueField"/);
    expect(() => {
      return parseRequestDescriptor('{ "seriesField": "" }');
    }).toThrow(/"seriesField"/);
  });

  test("rejects invalid labelFields", () => {
    expect(() => {
      return parseRequestDescriptor('{ "labelFields": "region" }');
    }).toThrow(/"labelFields" must be an array/);
    expect(() => {
      return parseRequestDescriptor('{ "labelFields": ["region", 5] }');
    }).toThrow(/only non-empty strings/);
  });
});

describe("applyRestTimeMacros", () => {
  test("replaces millisecond and unquoted ISO macros", () => {
    const text: string =
      "/api?from=$__startTimeMs&to=$__endTimeMs&f=$__startTime&t=$__endTime";
    const replaced: string = applyRestTimeMacros(text, START_DATE, END_DATE);
    expect(replaced).toBe(
      `/api?from=${START_DATE.getTime()}&to=${END_DATE.getTime()}&f=2024-01-01T00:00:00.000Z&t=2024-01-02T00:00:00.000Z`,
    );
    expect(replaced).not.toContain("'");
    expect(replaced).not.toContain("$__");
  });

  test("does not corrupt $__startTimeMs with the $__startTime replacement", () => {
    const replaced: string = applyRestTimeMacros(
      "$__startTimeMs",
      START_DATE,
      END_DATE,
    );
    expect(replaced).toBe(START_DATE.getTime().toString());
  });

  test("replaces every occurrence of a macro", () => {
    const replaced: string = applyRestTimeMacros(
      "$__endTimeMs and again $__endTimeMs",
      START_DATE,
      END_DATE,
    );
    expect(replaced).toBe(
      `${END_DATE.getTime()} and again ${END_DATE.getTime()}`,
    );
  });

  test("leaves text without macros untouched", () => {
    expect(applyRestTimeMacros("/api/stats", START_DATE, END_DATE)).toBe(
      "/api/stats",
    );
  });
});

describe("extractRowsByPath", () => {
  test("returns the payload itself when rowsPath is absent and it is an array", () => {
    const rows: Array<Record<string, unknown>> = extractRowsByPath(
      [{ a: 1 }, { a: 2 }],
      undefined,
    );
    expect(rows).toEqual([{ a: 1 }, { a: 2 }]);
  });

  test("navigates a nested dot path", () => {
    const payload: unknown = { data: { items: [{ a: 1 }] } };
    expect(extractRowsByPath(payload, "data.items")).toEqual([{ a: 1 }]);
  });

  test("supports numeric segments to index into arrays", () => {
    const payload: unknown = { results: [{ rows: [{ a: 1 }] }] };
    expect(extractRowsByPath(payload, "results.0.rows")).toEqual([{ a: 1 }]);
  });

  test("returns an empty array untouched", () => {
    expect(extractRowsByPath({ data: [] }, "data")).toEqual([]);
  });

  test("names what was found when the root is not an array", () => {
    expect(() => {
      return extractRowsByPath({ hello: "world" }, undefined);
    }).toThrow(/array of rows, but found an object/);
    expect(() => {
      return extractRowsByPath("just text", undefined);
    }).toThrow(/array of rows, but found a string/);
  });

  test("names what was found when the path resolves to a non-array", () => {
    expect(() => {
      return extractRowsByPath({ data: { items: "nope" } }, "data.items");
    }).toThrow(/found a string/);
    expect(() => {
      return extractRowsByPath({ data: { items: 42 } }, "data.items");
    }).toThrow(/found a number/);
  });

  test("names the missing field when the path does not exist", () => {
    expect(() => {
      return extractRowsByPath({}, "data.items");
    }).toThrow(/undefined/);
  });

  test("fails when navigating through a non-object segment", () => {
    expect(() => {
      return extractRowsByPath({ data: 5 }, "data.items");
    }).toThrow(/Could not read "items"/);
  });

  test("rejects rows that are not objects, naming the index and type", () => {
    expect(() => {
      return extractRowsByPath({ data: [{ a: 1 }, 7] }, "data");
    }).toThrow(/index 1 is a number/);
    expect(() => {
      return extractRowsByPath([[1, 2]], undefined);
    }).toThrow(/index 0 is an array/);
    expect(() => {
      return extractRowsByPath([null], undefined);
    }).toThrow(/index 0 is null/);
  });

  test("rejects a rowsPath with empty segments", () => {
    expect(() => {
      return extractRowsByPath({ data: [] }, "data..items");
    }).toThrow(/empty segment/);
  });
});

describe("RestApiConnector", () => {
  test("declares the REST API data source type", () => {
    const connector: RestApiConnector = new RestApiConnector();
    expect(connector.dataSourceType).toBe(DataSourceType.RestApi);
  });

  test("uses an injected fetch function instead of the shared client", async () => {
    mockGuard();
    const sharedFetchSpy: jest.SpyInstance = jest.spyOn(
      DataSourceHttpFetch,
      "fetch",
    );
    const injected: jest.Mock = jest.fn();
    injected.mockResolvedValue(jsonResponse([{ a: 1 }]));

    const connector: RestApiConnector = new RestApiConnector(
      injected as unknown as RestApiFetchFunction,
    );
    const result: DataSourceTableResult = await connector.queryTable(
      makeSettings(),
      "{}",
      makeWindow(),
    );

    expect(injected).toHaveBeenCalledTimes(1);
    expect(sharedFetchSpy).not.toHaveBeenCalled();
    expect(result.rows).toEqual([{ a: 1 }]);
  });
});

describe("RestApiConnector.testConnection", () => {
  test("passes on a 2xx response and sends auth + connect timeout", async () => {
    mockGuard();
    const fetchSpy: jest.SpyInstance = mockFetch({
      statusCode: 204,
      bodyText: "",
      bodyJson: undefined,
    });

    const connector: RestApiConnector = new RestApiConnector();
    await connector.testConnection(makeSettings({ apiToken: "token-abc-123" }));

    const request: DataSourceHttpRequest = getRequest(fetchSpy);
    expect(request.method).toBe("GET");
    expect(request.url).toBe("https://api.example.com");
    expect(request.timeoutInMs).toBe(DATA_SOURCE_CONNECT_TIMEOUT_IN_MS);
    expect(request.headers?.["Authorization"]).toBe("Bearer token-abc-123");
  });

  test("builds basic auth headers from username and password", async () => {
    mockGuard();
    const fetchSpy: jest.SpyInstance = mockFetch(jsonResponse({}));

    const connector: RestApiConnector = new RestApiConnector();
    await connector.testConnection(
      makeSettings({ username: "user1", password: "pass1234" }),
    );

    const expected: string = `Basic ${Buffer.from("user1:pass1234").toString(
      "base64",
    )}`;
    expect(getRequest(fetchSpy).headers?.["Authorization"]).toBe(expected);
  });

  test("invokes the egress guard before fetching", async () => {
    const guardSpy: jest.SpyInstance = mockGuard();
    const fetchSpy: jest.SpyInstance = mockFetch(jsonResponse({}));

    const connector: RestApiConnector = new RestApiConnector();
    await connector.testConnection(makeSettings());

    expect(guardSpy).toHaveBeenCalledWith("api.example.com", undefined);
    expect(guardSpy.mock.invocationCallOrder[0]!).toBeLessThan(
      fetchSpy.mock.invocationCallOrder[0]!,
    );
  });

  test("does not fetch when the egress guard rejects the host", async () => {
    jest
      .spyOn(DataSourceEgressGuard, "assertHostnameAllowed")
      .mockRejectedValue(
        new BadDataException(
          "Data source host api.example.com resolves to 127.0.0.1, which is not allowed: loopback address.",
        ),
      );
    const fetchSpy: jest.SpyInstance = mockFetch(jsonResponse({}));

    const connector: RestApiConnector = new RestApiConnector();
    await expect(connector.testConnection(makeSettings())).rejects.toThrow(
      /not allowed/,
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test("rejects a non-http(s) base URL", async () => {
    const fetchSpy: jest.SpyInstance = mockFetch(jsonResponse({}));

    const connector: RestApiConnector = new RestApiConnector();
    await expect(
      connector.testConnection(
        makeSettings({ url: "ftp://files.example.com" }),
      ),
    ).rejects.toThrow(/http or https/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test("fails on a non-2xx status", async () => {
    mockGuard();
    mockFetch({ statusCode: 500, bodyText: "boom", bodyJson: undefined });

    const connector: RestApiConnector = new RestApiConnector();
    await expect(connector.testConnection(makeSettings())).rejects.toThrow(
      /HTTP 500/,
    );
  });

  test("fails without a configured URL and never dials", async () => {
    const guardSpy: jest.SpyInstance = mockGuard();
    const fetchSpy: jest.SpyInstance = mockFetch(jsonResponse({}));

    const connector: RestApiConnector = new RestApiConnector();
    await expect(
      connector.testConnection(makeSettings({ url: undefined })),
    ).rejects.toThrow(/no URL configured/);
    expect(guardSpy).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test("redacts the password from connection errors", async () => {
    mockGuard();
    jest
      .spyOn(DataSourceHttpFetch, "fetch")
      .mockRejectedValue(
        new Error("basic auth failed for user1 with password hunter2secret"),
      );

    const connector: RestApiConnector = new RestApiConnector();
    try {
      await connector.testConnection(
        makeSettings({ username: "user1", password: "hunter2secret" }),
      );
      throw new Error("expected testConnection to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(BadDataException);
      expect((error as Error).message).not.toContain("hunter2secret");
      expect((error as Error).message).toContain("***");
    }
  });

  test("redacts custom header values from connection errors", async () => {
    mockGuard();
    jest
      .spyOn(DataSourceHttpFetch, "fetch")
      .mockRejectedValue(
        new Error("proxy rejected header X-Auth: supersecrethdrvalue"),
      );

    const connector: RestApiConnector = new RestApiConnector();
    try {
      await connector.testConnection(
        makeSettings({ customHeaders: { "X-Auth": "supersecrethdrvalue" } }),
      );
      throw new Error("expected testConnection to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(BadDataException);
      expect((error as Error).message).not.toContain("supersecrethdrvalue");
      expect((error as Error).message).toContain("***");
    }
  });
});

describe("RestApiConnector.queryTimeSeries", () => {
  const timeSeriesQuery: string = JSON.stringify({
    path: "/api/stats",
    rowsPath: "data.items",
    timestampField: "time",
    valueField: "count",
  });

  test("maps rows to timestamped points without attributes", async () => {
    mockGuard();
    const fetchSpy: jest.SpyInstance = mockFetch(
      jsonResponse({
        data: {
          items: [
            { time: "2024-01-01T01:00:00.000Z", count: 5 },
            { time: "2024-01-01T02:00:00.000Z", count: 7 },
          ],
        },
      }),
    );

    const connector: RestApiConnector = new RestApiConnector();
    const result: AggregatedResult = await connector.queryTimeSeries(
      makeSettings(),
      timeSeriesQuery,
      makeWindow(),
    );

    expect(result.truncated).toBe(false);
    expect(result.data).toHaveLength(2);
    expect(result.data[0]!.timestamp).toBeInstanceOf(Date);
    expect(result.data[0]!.timestamp.toISOString()).toBe(
      "2024-01-01T01:00:00.000Z",
    );
    expect(result.data[0]!.value).toBe(5);
    expect(result.data[1]!.value).toBe(7);
    expect("attributes" in result.data[0]!).toBe(false);
    expect(getRequest(fetchSpy).url).toBe("https://api.example.com/api/stats");
  });

  test("parses epoch seconds and epoch milliseconds timestamps", async () => {
    mockGuard();
    mockFetch(
      jsonResponse([
        { time: 1704070800, count: 1 },
        { time: 1704074400000, count: 2 },
      ]),
    );

    const query: string = JSON.stringify({
      timestampField: "time",
      valueField: "count",
    });
    const connector: RestApiConnector = new RestApiConnector();
    const result: AggregatedResult = await connector.queryTimeSeries(
      makeSettings(),
      query,
      makeWindow(),
    );

    expect(result.data).toHaveLength(2);
    expect(result.data[0]!.timestamp.toISOString()).toBe(
      "2024-01-01T01:00:00.000Z",
    );
    expect(result.data[1]!.timestamp.toISOString()).toBe(
      "2024-01-01T02:00:00.000Z",
    );
  });

  test("builds attributes from seriesField and labelFields", async () => {
    mockGuard();
    mockFetch(
      jsonResponse([
        {
          time: "2024-01-01T01:00:00.000Z",
          count: 5,
          service: "api",
          region: "us",
        },
      ]),
    );

    const query: string = JSON.stringify({
      timestampField: "time",
      valueField: "count",
      seriesField: "service",
      labelFields: ["region"],
    });
    const connector: RestApiConnector = new RestApiConnector();
    const result: AggregatedResult = await connector.queryTimeSeries(
      makeSettings(),
      query,
      makeWindow(),
    );

    expect(result.data[0]!["attributes"]).toEqual({
      series: "api",
      region: "us",
    });
  });

  test("stringifies label values and marks missing ones as (unset)", async () => {
    mockGuard();
    mockFetch(
      jsonResponse([
        { time: "2024-01-01T01:00:00.000Z", count: 5, shard: 3, region: null },
      ]),
    );

    const query: string = JSON.stringify({
      timestampField: "time",
      valueField: "count",
      labelFields: ["shard", "region"],
    });
    const connector: RestApiConnector = new RestApiConnector();
    const result: AggregatedResult = await connector.queryTimeSeries(
      makeSettings(),
      query,
      makeWindow(),
    );

    expect(result.data[0]!["attributes"]).toEqual({
      shard: "3",
      region: "(unset)",
    });
  });

  test("skips rows with unparseable timestamps or non-finite values", async () => {
    mockGuard();
    mockFetch(
      jsonResponse([
        { time: "not-a-date", count: 1 },
        { time: "2024-01-01T01:00:00.000Z", count: "not-a-number" },
        { time: "2024-01-01T02:00:00.000Z", count: null },
        { time: "2024-01-01T03:00:00.000Z" },
        { time: "2024-01-01T04:00:00.000Z", count: "42.5" },
      ]),
    );

    const query: string = JSON.stringify({
      timestampField: "time",
      valueField: "count",
    });
    const connector: RestApiConnector = new RestApiConnector();
    const result: AggregatedResult = await connector.queryTimeSeries(
      makeSettings(),
      query,
      makeWindow(),
    );

    expect(result.data).toHaveLength(1);
    expect(result.data[0]!.value).toBe(42.5);
  });

  test("requires timestampField and valueField before any request", async () => {
    const guardSpy: jest.SpyInstance = mockGuard();
    const fetchSpy: jest.SpyInstance = mockFetch(jsonResponse([]));

    const connector: RestApiConnector = new RestApiConnector();
    await expect(
      connector.queryTimeSeries(makeSettings(), "{}", makeWindow()),
    ).rejects.toThrow(/"timestampField" and "valueField"/);
    expect(guardSpy).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test("replaces time macros in the path and the body before the request", async () => {
    mockGuard();
    const fetchSpy: jest.SpyInstance = mockFetch(jsonResponse([]));

    const query: string = JSON.stringify({
      path: "/metrics?from=$__startTimeMs&to=$__endTimeMs",
      method: "POST",
      body: { range: { from: "$__startTime", to: "$__endTime" } },
      timestampField: "time",
      valueField: "value",
    });
    const connector: RestApiConnector = new RestApiConnector();
    await connector.queryTimeSeries(makeSettings(), query, makeWindow());

    const request: DataSourceHttpRequest = getRequest(fetchSpy);
    expect(request.url).toBe(
      `https://api.example.com/metrics?from=${START_DATE.getTime()}&to=${END_DATE.getTime()}`,
    );
    expect(request.method).toBe("POST");
    expect(request.body).toContain("2024-01-01T00:00:00.000Z");
    expect(request.body).toContain("2024-01-02T00:00:00.000Z");
    expect(request.body).not.toContain("$__");
  });

  test("joins a base URL with a trailing slash without doubling it", async () => {
    mockGuard();
    const fetchSpy: jest.SpyInstance = mockFetch(jsonResponse([]));

    const connector: RestApiConnector = new RestApiConnector();
    await connector.queryTimeSeries(
      makeSettings({ url: "https://api.example.com/v1/" }),
      JSON.stringify({
        path: "/stats",
        timestampField: "time",
        valueField: "value",
      }),
      makeWindow(),
    );

    expect(getRequest(fetchSpy).url).toBe("https://api.example.com/v1/stats");
  });

  test("passes the query timeout and bearer auth to the HTTP client", async () => {
    mockGuard();
    const fetchSpy: jest.SpyInstance = mockFetch(jsonResponse([]));

    const connector: RestApiConnector = new RestApiConnector();
    await connector.queryTimeSeries(
      makeSettings({ apiToken: "sekret-token-99" }),
      JSON.stringify({ timestampField: "time", valueField: "value" }),
      makeWindow(),
    );

    const request: DataSourceHttpRequest = getRequest(fetchSpy);
    expect(request.timeoutInMs).toBe(DATA_SOURCE_QUERY_TIMEOUT_IN_MS);
    expect(request.headers?.["Authorization"]).toBe("Bearer sekret-token-99");
  });

  test("invokes the egress guard before fetching for queries", async () => {
    const guardSpy: jest.SpyInstance = mockGuard();
    const fetchSpy: jest.SpyInstance = mockFetch(jsonResponse([]));

    const connector: RestApiConnector = new RestApiConnector();
    await connector.queryTimeSeries(
      makeSettings(),
      JSON.stringify({ timestampField: "time", valueField: "value" }),
      makeWindow(),
    );

    expect(guardSpy).toHaveBeenCalledWith("api.example.com", undefined);
    expect(guardSpy.mock.invocationCallOrder[0]!).toBeLessThan(
      fetchSpy.mock.invocationCallOrder[0]!,
    );
  });

  test("clamps to the time-series row cap and reports truncation", async () => {
    mockGuard();
    const rows: Array<Record<string, unknown>> = [];
    for (
      let index: number = 0;
      index < DATA_SOURCE_MAX_TIME_SERIES_ROWS + 5;
      index++
    ) {
      rows.push({ t: START_DATE.getTime() + index * 1000, v: index });
    }
    mockFetch(jsonResponse(rows));

    const query: string = JSON.stringify({
      timestampField: "t",
      valueField: "v",
    });
    const connector: RestApiConnector = new RestApiConnector();
    const result: AggregatedResult = await connector.queryTimeSeries(
      makeSettings(),
      query,
      makeWindow(),
    );

    expect(result.data).toHaveLength(DATA_SOURCE_MAX_TIME_SERIES_ROWS);
    expect(result.truncated).toBe(true);
  });

  test("returns an empty result for an empty rows array", async () => {
    mockGuard();
    mockFetch(jsonResponse({ data: { items: [] } }));

    const connector: RestApiConnector = new RestApiConnector();
    const result: AggregatedResult = await connector.queryTimeSeries(
      makeSettings(),
      timeSeriesQuery,
      makeWindow(),
    );

    expect(result.data).toEqual([]);
    expect(result.truncated).toBe(false);
  });

  test("fails with a useful message when the response is not JSON", async () => {
    mockGuard();
    mockFetch({
      statusCode: 200,
      bodyText: "<html>login page</html>",
      bodyJson: undefined,
    });

    const connector: RestApiConnector = new RestApiConnector();
    await expect(
      connector.queryTimeSeries(makeSettings(), timeSeriesQuery, makeWindow()),
    ).rejects.toThrow(/did not return JSON/);
  });

  test("surfaces rowsPath resolution failures", async () => {
    mockGuard();
    mockFetch(jsonResponse({ data: { items: "nope" } }));

    const connector: RestApiConnector = new RestApiConnector();
    await expect(
      connector.queryTimeSeries(makeSettings(), timeSeriesQuery, makeWindow()),
    ).rejects.toThrow(/found a string/);
  });

  test("redacts the api token from transport errors", async () => {
    mockGuard();
    jest
      .spyOn(DataSourceHttpFetch, "fetch")
      .mockRejectedValue(
        new BadDataException(
          "Data source responded with HTTP 500: Authorization Bearer very-secret-token was rejected",
        ),
      );

    const connector: RestApiConnector = new RestApiConnector();
    try {
      await connector.queryTimeSeries(
        makeSettings({ apiToken: "very-secret-token" }),
        timeSeriesQuery,
        makeWindow(),
      );
      throw new Error("expected queryTimeSeries to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(BadDataException);
      expect((error as Error).message).not.toContain("very-secret-token");
      expect((error as Error).message).toContain("***");
    }
  });
});

describe("RestApiConnector.queryTable", () => {
  test("shapes rows into columns, keeping nested objects as Json cells", async () => {
    mockGuard();
    const fetchSpy: jest.SpyInstance = mockFetch(
      jsonResponse({
        data: [
          { name: "a", count: 1, meta: { x: 1 } },
          { name: "b", count: 2, meta: null },
        ],
      }),
    );

    const connector: RestApiConnector = new RestApiConnector();
    const result: DataSourceTableResult = await connector.queryTable(
      makeSettings(),
      '{ "rowsPath": "data" }',
      makeWindow(),
    );

    expect(result.truncated).toBe(false);
    expect(
      result.columns.map((column: DataSourceTableColumn) => {
        return column.key;
      }),
    ).toEqual(["name", "count", "meta"]);

    const countColumn: DataSourceTableColumn | undefined = result.columns.find(
      (column: DataSourceTableColumn) => {
        return column.key === "count";
      },
    );
    expect(countColumn?.type).toBe(DataSourceTableColumnType.Number);

    const metaColumn: DataSourceTableColumn | undefined = result.columns.find(
      (column: DataSourceTableColumn) => {
        return column.key === "meta";
      },
    );
    expect(metaColumn?.type).toBe(DataSourceTableColumnType.Json);

    expect(result.rows[0]!["meta"]).toBe('{"x":1}');
    expect(result.rows[1]!["meta"]).toBeNull();

    /* Default request shape: GET on the base URL root with no body. */
    const request: DataSourceHttpRequest = getRequest(fetchSpy);
    expect(request.method).toBe("GET");
    expect(request.url).toBe("https://api.example.com/");
    expect(request.body).toBeUndefined();
    expect(request.timeoutInMs).toBe(DATA_SOURCE_QUERY_TIMEOUT_IN_MS);
  });

  test("reads rows from the response root when rowsPath is omitted", async () => {
    mockGuard();
    mockFetch(jsonResponse([{ a: 1 }]));

    const connector: RestApiConnector = new RestApiConnector();
    const result: DataSourceTableResult = await connector.queryTable(
      makeSettings(),
      "{}",
      makeWindow(),
    );

    expect(result.rows).toEqual([{ a: 1 }]);
  });

  test("passes a string body through with macros applied", async () => {
    mockGuard();
    const fetchSpy: jest.SpyInstance = mockFetch(jsonResponse([]));

    const query: string = JSON.stringify({
      method: "POST",
      body: "raw-payload $__startTimeMs",
    });
    const connector: RestApiConnector = new RestApiConnector();
    await connector.queryTable(makeSettings(), query, makeWindow());

    expect(getRequest(fetchSpy).body).toBe(
      `raw-payload ${START_DATE.getTime()}`,
    );
  });

  test("clamps to the table row cap and reports truncation", async () => {
    mockGuard();
    const rows: Array<Record<string, unknown>> = [];
    for (
      let index: number = 0;
      index < DATA_SOURCE_MAX_TABLE_ROWS + 3;
      index++
    ) {
      rows.push({ index: index });
    }
    mockFetch(jsonResponse(rows));

    const connector: RestApiConnector = new RestApiConnector();
    const result: DataSourceTableResult = await connector.queryTable(
      makeSettings(),
      "{}",
      makeWindow(),
    );

    expect(result.rows).toHaveLength(DATA_SOURCE_MAX_TABLE_ROWS);
    expect(result.truncated).toBe(true);
  });

  test("returns empty columns and rows for an empty array", async () => {
    mockGuard();
    mockFetch(jsonResponse([]));

    const connector: RestApiConnector = new RestApiConnector();
    const result: DataSourceTableResult = await connector.queryTable(
      makeSettings(),
      "{}",
      makeWindow(),
    );

    expect(result.columns).toEqual([]);
    expect(result.rows).toEqual([]);
    expect(result.truncated).toBe(false);
  });

  test("rejects rows that are not objects", async () => {
    mockGuard();
    mockFetch(jsonResponse({ data: [1, 2, 3] }));

    const connector: RestApiConnector = new RestApiConnector();
    await expect(
      connector.queryTable(
        makeSettings(),
        '{ "rowsPath": "data" }',
        makeWindow(),
      ),
    ).rejects.toThrow(/index 0 is a number/);
  });
});
