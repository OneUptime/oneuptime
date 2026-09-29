import { afterEach, describe, expect, test } from "@jest/globals";
import PrometheusConnector, {
  assertPrometheusSuccess,
  buildPrometheusApiUrl,
  parseInstantQueryResult,
  parseRangeQueryResult,
} from "../../../../Server/Utils/DataSource/Connectors/PrometheusConnector";
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
  DATA_SOURCE_QUERY_TIMEOUT_IN_MS,
} from "../../../../Types/DataSource/DataSourceLimits";
import DataSourceTableResult, {
  DataSourceTableColumnType,
} from "../../../../Types/DataSource/DataSourceTableResult";
import DataSourceType from "../../../../Types/DataSource/DataSourceType";
import BadDataException from "../../../../Types/Exception/BadDataException";

type MakeSettingsFunction = (
  overrides?: Partial<DataSourceConnectionSettings>,
) => DataSourceConnectionSettings;

const makeSettings: MakeSettingsFunction = (
  overrides?: Partial<DataSourceConnectionSettings>,
): DataSourceConnectionSettings => {
  return {
    dataSourceType: DataSourceType.Prometheus,
    url: "https://prometheus.example.com",
    ...overrides,
  };
};

const queryWindow: DataSourceQueryWindow = {
  startDate: new Date("2026-01-01T00:00:00.000Z"),
  endDate: new Date("2026-01-01T01:00:00.000Z"),
};

type EnvelopeFunction = (resultType: string, result: unknown) => unknown;

const successBody: EnvelopeFunction = (
  resultType: string,
  result: unknown,
): unknown => {
  return {
    status: "success",
    data: { resultType: resultType, result: result },
  };
};

type HttpResponseFunction = (body: unknown) => DataSourceHttpResponse;

const httpResponse: HttpResponseFunction = (
  body: unknown,
): DataSourceHttpResponse => {
  return {
    statusCode: 200,
    bodyText: JSON.stringify(body),
    bodyJson: body,
  };
};

type MockFetchFunction = (response: DataSourceHttpResponse) => jest.SpyInstance;

const mockFetch: MockFetchFunction = (
  response: DataSourceHttpResponse,
): jest.SpyInstance => {
  return jest.spyOn(DataSourceHttpFetch, "fetch").mockResolvedValue(response);
};

type LastRequestFunction = (spy: jest.SpyInstance) => DataSourceHttpRequest;

const lastRequest: LastRequestFunction = (
  spy: jest.SpyInstance,
): DataSourceHttpRequest => {
  const calls: Array<Array<unknown>> = spy.mock.calls as Array<Array<unknown>>;
  return calls[calls.length - 1]![0] as DataSourceHttpRequest;
};

afterEach(() => {
  jest.restoreAllMocks();
});

describe("buildPrometheusApiUrl", () => {
  test("joins a bare host base URL with the API path", () => {
    expect(
      buildPrometheusApiUrl("https://prometheus.example.com", "/api/v1/query", {
        query: "up",
      }),
    ).toBe("https://prometheus.example.com/api/v1/query?query=up");
  });

  test("preserves a path prefix on the base URL", () => {
    expect(
      buildPrometheusApiUrl(
        "https://host.example.com/prometheus",
        "/api/v1/query",
        { query: "up" },
      ),
    ).toBe("https://host.example.com/prometheus/api/v1/query?query=up");
  });

  test("never produces double slashes for trailing-slash base URLs", () => {
    expect(
      buildPrometheusApiUrl(
        "https://host.example.com/prometheus///",
        "/api/v1/query",
        { query: "up" },
      ),
    ).toBe("https://host.example.com/prometheus/api/v1/query?query=up");
  });

  test("adds a leading slash to the path when missing", () => {
    expect(
      buildPrometheusApiUrl("https://host.example.com", "api/v1/query", {
        query: "up",
      }),
    ).toBe("https://host.example.com/api/v1/query?query=up");
  });

  test("URL-encodes PromQL query parameters", () => {
    const url: string = buildPrometheusApiUrl(
      "https://host.example.com",
      "/api/v1/query_range",
      { query: 'rate(http_requests_total{job="api"}[5m])', step: "15" },
    );

    const parsed: URL = new URL(url);
    expect(parsed.searchParams.get("query")).toBe(
      'rate(http_requests_total{job="api"}[5m])',
    );
    expect(parsed.searchParams.get("step")).toBe("15");
  });
});

describe("assertPrometheusSuccess", () => {
  test("returns the data object on a success envelope", () => {
    const data: Record<string, unknown> = assertPrometheusSuccess(
      successBody("vector", []),
    );
    expect(data["resultType"]).toBe("vector");
  });

  test("throws the server's error text on a status:error envelope", () => {
    expect(() => {
      return assertPrometheusSuccess({
        status: "error",
        errorType: "bad_data",
        error: 'parse error at char 5: unexpected "{"',
      });
    }).toThrow(BadDataException);

    expect(() => {
      return assertPrometheusSuccess({
        status: "error",
        error: 'parse error at char 5: unexpected "{"',
      });
    }).toThrow(/parse error at char 5/);
  });

  test("truncates very long error texts to 500 characters", () => {
    const longError: string = "x".repeat(600);
    let thrownMessage: string = "";
    try {
      assertPrometheusSuccess({ status: "error", error: longError });
    } catch (error) {
      thrownMessage = (error as Error).message;
    }
    expect(thrownMessage).toContain("x".repeat(500));
    expect(thrownMessage).not.toContain("x".repeat(501));
  });

  test("throws on a non-object body", () => {
    expect(() => {
      return assertPrometheusSuccess("not json object");
    }).toThrow(BadDataException);
    expect(() => {
      return assertPrometheusSuccess(null);
    }).toThrow(BadDataException);
    expect(() => {
      return assertPrometheusSuccess([1, 2, 3]);
    }).toThrow(BadDataException);
  });

  test("throws on an unexpected status value", () => {
    expect(() => {
      return assertPrometheusSuccess({ status: "partial" });
    }).toThrow(/unexpected status/);
  });

  test("throws when the data field is missing", () => {
    expect(() => {
      return assertPrometheusSuccess({ status: "success" });
    }).toThrow(/data field/);
  });
});

describe("parseRangeQueryResult", () => {
  test("maps a matrix into points with labels excluding __name__", () => {
    const body: unknown = successBody("matrix", [
      {
        metric: { __name__: "up", instance: "a:9090", job: "api" },
        values: [
          [1767225600, "1"],
          [1767225660, "0.5"],
        ],
      },
      {
        metric: { __name__: "up", instance: "b:9090", job: "api" },
        values: [[1767225600, "2"]],
      },
    ]);

    const result: AggregatedResult = parseRangeQueryResult(body);

    expect(result.truncated).toBe(false);
    expect(result.data).toHaveLength(3);
    expect(result.data[0]!.timestamp).toEqual(
      new Date("2026-01-01T00:00:00.000Z"),
    );
    expect(result.data[0]!.value).toBe(1);
    expect(result.data[0]!["attributes"]).toEqual({
      instance: "a:9090",
      job: "api",
    });
    expect(result.data[2]!["attributes"]).toEqual({
      instance: "b:9090",
      job: "api",
    });
  });

  test("falls back to __name__ as the label when it is the only metric key", () => {
    const body: unknown = successBody("matrix", [
      {
        metric: { __name__: "process_cpu_seconds_total" },
        values: [[1767225600, "3"]],
      },
    ]);

    const result: AggregatedResult = parseRangeQueryResult(body);

    expect(result.data[0]!["attributes"]).toEqual({
      __name__: "process_cpu_seconds_total",
    });
  });

  test("omits attributes entirely when the metric object is empty", () => {
    const body: unknown = successBody("matrix", [
      { metric: {}, values: [[1767225600, "4"]] },
    ]);

    const result: AggregatedResult = parseRangeQueryResult(body);

    expect(result.data).toHaveLength(1);
    expect(result.data[0]!["attributes"]).toBeUndefined();
  });

  test("skips NaN and infinite sample values", () => {
    const body: unknown = successBody("matrix", [
      {
        metric: {},
        values: [
          [1767225600, "NaN"],
          [1767225660, "+Inf"],
          [1767225720, "-Inf"],
          [1767225780, "7"],
        ],
      },
    ]);

    const result: AggregatedResult = parseRangeQueryResult(body);

    expect(result.data).toHaveLength(1);
    expect(result.data[0]!.value).toBe(7);
    expect(result.truncated).toBe(false);
  });

  test("maps a vector into one point per series", () => {
    const body: unknown = successBody("vector", [
      { metric: { instance: "a" }, value: [1767225600, "1"] },
      { metric: { instance: "b" }, value: [1767225600, "2"] },
    ]);

    const result: AggregatedResult = parseRangeQueryResult(body);

    expect(result.data).toHaveLength(2);
    expect(result.data[0]!["attributes"]).toEqual({ instance: "a" });
    expect(result.data[1]!.value).toBe(2);
  });

  test("maps a scalar into a single unnamed point", () => {
    const body: unknown = successBody("scalar", [1767225600, "42"]);

    const result: AggregatedResult = parseRangeQueryResult(body);

    expect(result.data).toHaveLength(1);
    expect(result.data[0]!.value).toBe(42);
    expect(result.data[0]!["attributes"]).toBeUndefined();
  });

  test("returns an empty result for an empty matrix", () => {
    const result: AggregatedResult = parseRangeQueryResult(
      successBody("matrix", []),
    );
    expect(result.data).toEqual([]);
    expect(result.truncated).toBe(false);
  });

  test("drops series beyond the series cap and flags truncation", () => {
    const body: unknown = successBody("matrix", [
      { metric: { instance: "a" }, values: [[1767225600, "1"]] },
      { metric: { instance: "b" }, values: [[1767225600, "2"]] },
      { metric: { instance: "c" }, values: [[1767225600, "3"]] },
    ]);

    const result: AggregatedResult = parseRangeQueryResult(body, {
      maxSeries: 2,
    });

    expect(result.data).toHaveLength(2);
    expect(result.truncated).toBe(true);
    expect(result.data[1]!["attributes"]).toEqual({ instance: "b" });
  });

  test("clamps total points at the row cap and flags truncation", () => {
    const body: unknown = successBody("matrix", [
      {
        metric: {},
        values: [
          [1767225600, "1"],
          [1767225660, "2"],
          [1767225720, "3"],
          [1767225780, "4"],
        ],
      },
    ]);

    const result: AggregatedResult = parseRangeQueryResult(body, {
      maxPoints: 3,
    });

    expect(result.data).toHaveLength(3);
    expect(result.truncated).toBe(true);
  });

  test("exactly cap-many points is not flagged as truncated", () => {
    const body: unknown = successBody("matrix", [
      {
        metric: {},
        values: [
          [1767225600, "1"],
          [1767225660, "2"],
          [1767225720, "3"],
        ],
      },
    ]);

    const result: AggregatedResult = parseRangeQueryResult(body, {
      maxPoints: 3,
    });

    expect(result.data).toHaveLength(3);
    expect(result.truncated).toBe(false);
  });

  test("skipped non-finite values do not count toward the point cap", () => {
    const body: unknown = successBody("matrix", [
      {
        metric: {},
        values: [
          [1767225600, "NaN"],
          [1767225660, "1"],
          [1767225720, "2"],
        ],
      },
    ]);

    const result: AggregatedResult = parseRangeQueryResult(body, {
      maxPoints: 2,
    });

    expect(result.data).toHaveLength(2);
    expect(result.truncated).toBe(false);
  });

  test("ignores malformed series entries and sample pairs", () => {
    const body: unknown = successBody("matrix", [
      "not-an-object",
      { metric: {}, values: "not-an-array" },
      {
        metric: {},
        values: [["bad-ts", "1"], [1767225600], [1767225660, "5"]],
      },
    ]);

    const result: AggregatedResult = parseRangeQueryResult(body);

    expect(result.data).toHaveLength(1);
    expect(result.data[0]!.value).toBe(5);
  });

  test("throws on an unsupported resultType", () => {
    expect(() => {
      return parseRangeQueryResult(successBody("streams", []));
    }).toThrow(/unsupported resultType "streams"/);
  });

  test("surfaces a status:error envelope as BadDataException", () => {
    expect(() => {
      return parseRangeQueryResult({
        status: "error",
        error: "query timed out in expression evaluation",
      });
    }).toThrow(/query timed out/);
  });
});

describe("parseInstantQueryResult", () => {
  test("maps a vector into rows with label, value and timestamp columns", () => {
    const body: unknown = successBody("vector", [
      {
        metric: { __name__: "up", instance: "a:9090", job: "api" },
        value: [1767225600, "1"],
      },
      {
        metric: { __name__: "up", instance: "b:9090", job: "api" },
        value: [1767225600.123, "0"],
      },
    ]);

    const result: DataSourceTableResult = parseInstantQueryResult(body);

    expect(result.truncated).toBe(false);
    expect(
      result.columns.map((column: { key: string }) => {
        return column.key;
      }),
    ).toEqual(["__name__", "instance", "job", "value", "timestamp"]);

    const valueColumn: { type: DataSourceTableColumnType } | undefined =
      result.columns.find((column: { key: string }) => {
        return column.key === "value";
      });
    expect(valueColumn?.type).toBe(DataSourceTableColumnType.Number);

    const timestampColumn: { type: DataSourceTableColumnType } | undefined =
      result.columns.find((column: { key: string }) => {
        return column.key === "timestamp";
      });
    expect(timestampColumn?.type).toBe(DataSourceTableColumnType.Date);

    const instanceColumn: { type: DataSourceTableColumnType } | undefined =
      result.columns.find((column: { key: string }) => {
        return column.key === "instance";
      });
    expect(instanceColumn?.type).toBe(DataSourceTableColumnType.Text);

    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]!["__name__"]).toBe("up");
    expect(result.rows[0]!["instance"]).toBe("a:9090");
    expect(result.rows[0]!["value"]).toBe(1);
    expect(result.rows[0]!["timestamp"]).toBe("2026-01-01T00:00:00.000Z");
  });

  test("takes the union of label keys and fills gaps with null", () => {
    const body: unknown = successBody("vector", [
      { metric: { instance: "a" }, value: [1767225600, "1"] },
      { metric: { job: "api" }, value: [1767225600, "2"] },
    ]);

    const result: DataSourceTableResult = parseInstantQueryResult(body);

    expect(
      result.columns.map((column: { key: string }) => {
        return column.key;
      }),
    ).toEqual(["instance", "job", "value", "timestamp"]);
    expect(result.rows[0]!["job"]).toBeNull();
    expect(result.rows[1]!["instance"]).toBeNull();
  });

  test("maps a scalar into a single value/timestamp row", () => {
    const result: DataSourceTableResult = parseInstantQueryResult(
      successBody("scalar", [1767225600, "42"]),
    );

    expect(
      result.columns.map((column: { key: string }) => {
        return column.key;
      }),
    ).toEqual(["value", "timestamp"]);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]!["value"]).toBe(42);
    expect(result.rows[0]!["timestamp"]).toBe("2026-01-01T00:00:00.000Z");
  });

  test("renders non-finite values as null instead of dropping the row", () => {
    const body: unknown = successBody("vector", [
      { metric: { instance: "a" }, value: [1767225600, "NaN"] },
    ]);

    const result: DataSourceTableResult = parseInstantQueryResult(body);

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]!["value"]).toBeNull();
  });

  test("clamps rows at the cap and flags truncation", () => {
    const body: unknown = successBody("vector", [
      { metric: { instance: "a" }, value: [1767225600, "1"] },
      { metric: { instance: "b" }, value: [1767225600, "2"] },
      { metric: { instance: "c" }, value: [1767225600, "3"] },
    ]);

    const result: DataSourceTableResult = parseInstantQueryResult(body, {
      maxRows: 2,
    });

    expect(result.rows).toHaveLength(2);
    expect(result.truncated).toBe(true);
  });

  test("returns an empty table for an empty vector", () => {
    const result: DataSourceTableResult = parseInstantQueryResult(
      successBody("vector", []),
    );

    expect(result.columns).toEqual([]);
    expect(result.rows).toEqual([]);
    expect(result.truncated).toBe(false);
  });

  test("skips malformed vector entries", () => {
    const body: unknown = successBody("vector", [
      "nope",
      { metric: { instance: "a" } },
      { metric: { instance: "b" }, value: ["bad-ts", "1"] },
      { metric: { instance: "c" }, value: [1767225600, "3"] },
    ]);

    const result: DataSourceTableResult = parseInstantQueryResult(body);

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]!["instance"]).toBe("c");
  });

  test("throws an actionable error for a matrix result", () => {
    expect(() => {
      return parseInstantQueryResult(successBody("matrix", []));
    }).toThrow(/instant-vector query/);
  });
});

describe("PrometheusConnector", () => {
  const connector: PrometheusConnector = new PrometheusConnector();

  test("declares the Prometheus data source type", () => {
    expect(connector.dataSourceType).toBe(DataSourceType.Prometheus);
  });

  describe("testConnection", () => {
    test("probes /api/v1/query with vector(1) using the connect timeout", async () => {
      const fetchSpy: jest.SpyInstance = mockFetch(
        httpResponse(successBody("vector", [])),
      );

      await connector.testConnection(makeSettings());

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const request: DataSourceHttpRequest = lastRequest(fetchSpy);
      expect(request.method).toBe("GET");
      expect(request.url).toBe(
        "https://prometheus.example.com/api/v1/query?query=vector%281%29",
      );
      expect(request.timeoutInMs).toBe(DATA_SOURCE_CONNECT_TIMEOUT_IN_MS);
    });

    test("sends bearer auth headers built from the api token", async () => {
      const fetchSpy: jest.SpyInstance = mockFetch(
        httpResponse(successBody("vector", [])),
      );

      await connector.testConnection(
        makeSettings({ apiToken: "token-abcd-1234" }),
      );

      const request: DataSourceHttpRequest = lastRequest(fetchSpy);
      expect(request.headers?.["Authorization"]).toBe("Bearer token-abcd-1234");
    });

    test("sends basic auth headers built from username and password", async () => {
      const fetchSpy: jest.SpyInstance = mockFetch(
        httpResponse(successBody("vector", [])),
      );

      await connector.testConnection(
        makeSettings({ username: "prom", password: "s3cretpass" }),
      );

      const request: DataSourceHttpRequest = lastRequest(fetchSpy);
      const expected: string = `Basic ${Buffer.from("prom:s3cretpass").toString(
        "base64",
      )}`;
      expect(request.headers?.["Authorization"]).toBe(expected);
    });

    test("rejects when the settings have no URL", async () => {
      const fetchSpy: jest.SpyInstance = mockFetch(
        httpResponse(successBody("vector", [])),
      );

      await expect(
        connector.testConnection(makeSettings({ url: undefined })),
      ).rejects.toThrow(/missing a URL/);
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    test("rejects when the backend answers with a status:error envelope", async () => {
      mockFetch(
        httpResponse({
          status: "error",
          error: "unauthorized: bad credentials",
        }),
      );

      await expect(connector.testConnection(makeSettings())).rejects.toThrow(
        /bad credentials/,
      );
    });

    test("rejects when the backend answers with non-JSON", async () => {
      mockFetch({
        statusCode: 200,
        bodyText: "<html>login page</html>",
        bodyJson: undefined,
      });

      await expect(connector.testConnection(makeSettings())).rejects.toThrow(
        /non-JSON response/,
      );
    });

    test("egress-guard failures inside the HTTP layer surface before any connection", async () => {
      const guardSpy: jest.SpyInstance = jest
        .spyOn(DataSourceEgressGuard, "assertUrlAllowed")
        .mockRejectedValue(
          new BadDataException(
            "Data source host 127.0.0.1 is not allowed: loopback address.",
          ),
        );

      await expect(
        connector.testConnection(
          makeSettings({ url: "http://127.0.0.1:9090" }),
        ),
      ).rejects.toThrow(/not allowed: loopback address/);

      expect(guardSpy).toHaveBeenCalledTimes(1);
      expect(String(guardSpy.mock.calls[0]![0])).toContain(
        "http://127.0.0.1:9090/api/v1/query",
      );
    });
  });

  describe("queryTimeSeries", () => {
    test("calls /api/v1/query_range with unix seconds, derived step and query timeout", async () => {
      const fetchSpy: jest.SpyInstance = mockFetch(
        httpResponse(successBody("matrix", [])),
      );

      await connector.queryTimeSeries(makeSettings(), "up", queryWindow);

      const request: DataSourceHttpRequest = lastRequest(fetchSpy);
      const parsed: URL = new URL(request.url);
      expect(parsed.pathname).toBe("/api/v1/query_range");
      expect(parsed.searchParams.get("query")).toBe("up");
      expect(parsed.searchParams.get("start")).toBe(
        String(Math.floor(queryWindow.startDate.getTime() / 1000)),
      );
      expect(parsed.searchParams.get("end")).toBe(
        String(Math.floor(queryWindow.endDate.getTime() / 1000)),
      );
      /*
       * 1h window / 250 target buckets = 14.4s, ceil = 15s (above the 10s
       * minimum step).
       */
      expect(parsed.searchParams.get("step")).toBe("15");
      expect(request.timeoutInMs).toBe(DATA_SOURCE_QUERY_TIMEOUT_IN_MS);
    });

    test("honors an explicit stepInSeconds and floors it to an integer", async () => {
      const fetchSpy: jest.SpyInstance = mockFetch(
        httpResponse(successBody("matrix", [])),
      );

      await connector.queryTimeSeries(makeSettings(), "up", {
        ...queryWindow,
        stepInSeconds: 42.9,
      });

      const request: DataSourceHttpRequest = lastRequest(fetchSpy);
      const parsed: URL = new URL(request.url);
      expect(parsed.searchParams.get("step")).toBe("42");
    });

    test("preserves a base URL path prefix with a trailing slash", async () => {
      const fetchSpy: jest.SpyInstance = mockFetch(
        httpResponse(successBody("matrix", [])),
      );

      await connector.queryTimeSeries(
        makeSettings({ url: "https://metrics.example.com/prometheus/" }),
        "up",
        queryWindow,
      );

      const request: DataSourceHttpRequest = lastRequest(fetchSpy);
      expect(
        request.url.startsWith(
          "https://metrics.example.com/prometheus/api/v1/query_range?",
        ),
      ).toBe(true);
      expect(request.url).not.toContain("//api");
    });

    test("returns the parsed matrix as an AggregatedResult", async () => {
      mockFetch(
        httpResponse(
          successBody("matrix", [
            {
              metric: { __name__: "up", instance: "a" },
              values: [
                [1767225600, "1"],
                [1767225660, "2"],
              ],
            },
          ]),
        ),
      );

      const result: AggregatedResult = await connector.queryTimeSeries(
        makeSettings(),
        "up",
        queryWindow,
      );

      expect(result.data).toHaveLength(2);
      expect(result.data[0]!["attributes"]).toEqual({ instance: "a" });
      expect(result.truncated).toBe(false);
    });

    test("flags truncation when the backend returns more series than the cap", async () => {
      const manySeries: Array<unknown> = [];
      for (let i: number = 0; i < 101; i++) {
        manySeries.push({
          metric: { instance: `host-${i}` },
          values: [[1767225600, "1"]],
        });
      }
      mockFetch(httpResponse(successBody("matrix", manySeries)));

      const result: AggregatedResult = await connector.queryTimeSeries(
        makeSettings(),
        "up",
        queryWindow,
      );

      expect(result.data).toHaveLength(100);
      expect(result.truncated).toBe(true);
    });

    test("propagates HTTP-layer errors (already sanitized by HttpFetch)", async () => {
      jest
        .spyOn(DataSourceHttpFetch, "fetch")
        .mockRejectedValue(
          new BadDataException(
            "Data source responded with HTTP 500: internal error",
          ),
        );

      await expect(
        connector.queryTimeSeries(makeSettings(), "up", queryWindow),
      ).rejects.toThrow(/HTTP 500/);
    });

    test("never leaks credentials through error messages", async () => {
      jest
        .spyOn(DataSourceHttpFetch, "fetch")
        .mockRejectedValue(
          new Error(
            "connect failed: authentication with password hunter2secret rejected for token token-abcd-1234",
          ),
        );

      let thrownMessage: string = "";
      try {
        await connector.queryTimeSeries(
          makeSettings({
            password: "hunter2secret",
            apiToken: "token-abcd-1234",
          }),
          "up",
          queryWindow,
        );
      } catch (error) {
        expect(error).toBeInstanceOf(BadDataException);
        thrownMessage = (error as Error).message;
      }

      expect(thrownMessage).not.toContain("hunter2secret");
      expect(thrownMessage).not.toContain("token-abcd-1234");
      expect(thrownMessage).toContain("***");
    });
  });

  describe("queryTable", () => {
    test("calls /api/v1/query with the window end as the evaluation time", async () => {
      const fetchSpy: jest.SpyInstance = mockFetch(
        httpResponse(successBody("vector", [])),
      );

      await connector.queryTable(makeSettings(), "up", queryWindow);

      const request: DataSourceHttpRequest = lastRequest(fetchSpy);
      const parsed: URL = new URL(request.url);
      expect(parsed.pathname).toBe("/api/v1/query");
      expect(parsed.searchParams.get("query")).toBe("up");
      expect(parsed.searchParams.get("time")).toBe(
        String(Math.floor(queryWindow.endDate.getTime() / 1000)),
      );
      expect(parsed.searchParams.has("start")).toBe(false);
      expect(request.timeoutInMs).toBe(DATA_SOURCE_QUERY_TIMEOUT_IN_MS);
    });

    test("returns the parsed vector as a table result", async () => {
      mockFetch(
        httpResponse(
          successBody("vector", [
            {
              metric: { __name__: "up", instance: "a:9090" },
              value: [1767225600, "1"],
            },
          ]),
        ),
      );

      const result: DataSourceTableResult = await connector.queryTable(
        makeSettings(),
        "up",
        queryWindow,
      );

      expect(result.rows).toHaveLength(1);
      expect(result.rows[0]!["instance"]).toBe("a:9090");
      expect(result.rows[0]!["value"]).toBe(1);
      expect(result.rows[0]!["timestamp"]).toBe("2026-01-01T00:00:00.000Z");
    });

    test("surfaces backend query errors with the server's message", async () => {
      mockFetch(
        httpResponse({
          status: "error",
          errorType: "bad_data",
          error: 'invalid parameter "query": unknown function',
        }),
      );

      await expect(
        connector.queryTable(makeSettings(), "nope(", queryWindow),
      ).rejects.toThrow(/unknown function/);
    });
  });
});
