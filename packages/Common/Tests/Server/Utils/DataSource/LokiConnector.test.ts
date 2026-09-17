import LokiConnector, {
  LokiQueryRangeData,
  lokiMatrixToTableRows,
  lokiMatrixToTimeSeries,
  lokiNanosecondsToDate,
  lokiStreamsToTableRows,
  parseLokiMatrixPoint,
  parseLokiNanoseconds,
  parseLokiResponseData,
  toLokiNanoseconds,
} from "../../../../Server/Utils/DataSource/Connectors/LokiConnector";
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
  DATA_SOURCE_MAX_SERIES,
  DATA_SOURCE_MAX_TABLE_ROWS,
  DATA_SOURCE_MAX_TIME_SERIES_ROWS,
  DATA_SOURCE_QUERY_TIMEOUT_IN_MS,
  DataSourceLimitsUtil,
} from "../../../../Types/DataSource/DataSourceLimits";
import DataSourceTableResult, {
  DataSourceTableColumn,
  DataSourceTableColumnType,
} from "../../../../Types/DataSource/DataSourceTableResult";
import DataSourceType from "../../../../Types/DataSource/DataSourceType";
import BadDataException from "../../../../Types/Exception/BadDataException";
import { afterEach, describe, expect, test } from "@jest/globals";

type MakeSettingsFunction = (
  overrides?: Partial<DataSourceConnectionSettings>,
) => DataSourceConnectionSettings;

const makeSettings: MakeSettingsFunction = (
  overrides?: Partial<DataSourceConnectionSettings>,
): DataSourceConnectionSettings => {
  return {
    dataSourceType: DataSourceType.Loki,
    url: "http://loki.example.com:3100",
    apiToken: "super-secret-token",
    ...overrides,
  };
};

type MakeResponseFunction = (bodyJson: unknown) => DataSourceHttpResponse;

const makeResponse: MakeResponseFunction = (
  bodyJson: unknown,
): DataSourceHttpResponse => {
  return {
    statusCode: 200,
    bodyText: JSON.stringify(bodyJson),
    bodyJson: bodyJson,
  };
};

type SuccessBodyFunction = (
  resultType: string,
  result: Array<unknown>,
) => unknown;

const successBody: SuccessBodyFunction = (
  resultType: string,
  result: Array<unknown>,
): unknown => {
  return {
    status: "success",
    data: { resultType: resultType, result: result },
  };
};

const queryWindow: DataSourceQueryWindow = {
  startDate: new Date("2024-01-01T00:00:00.000Z"),
  endDate: new Date("2024-01-01T01:00:00.000Z"),
  stepInSeconds: 60,
};

type SpyFetchFunction = (response: DataSourceHttpResponse) => jest.SpyInstance;

const spyFetchResolving: SpyFetchFunction = (
  response: DataSourceHttpResponse,
): jest.SpyInstance => {
  return jest.spyOn(DataSourceHttpFetch, "fetch").mockResolvedValue(response);
};

type GetRequestFunction = (spy: jest.SpyInstance) => DataSourceHttpRequest;

const getRequest: GetRequestFunction = (
  spy: jest.SpyInstance,
): DataSourceHttpRequest => {
  return spy.mock.calls[0]![0] as DataSourceHttpRequest;
};

afterEach(() => {
  jest.restoreAllMocks();
});

describe("toLokiNanoseconds", () => {
  test("converts millisecond epochs to exact nanosecond strings", () => {
    expect(toLokiNanoseconds(new Date(1700000000123))).toBe(
      "1700000000123000000",
    );
  });

  test("keeps every digit where float math would round", () => {
    /*
     * Nanosecond epochs sit above 2^53, where doubles can no longer
     * represent every integer — the conversion must go through
     * BigInt/string math and produce the exact tail of six zeros for any
     * millisecond input, including odd values whose *1e6 product is not
     * exactly representable.
     */
    expect(toLokiNanoseconds(new Date(1699999999999))).toBe(
      "1699999999999000000",
    );
    expect(toLokiNanoseconds(new Date(1699999999997))).toBe(
      "1699999999997000000",
    );
    expect(toLokiNanoseconds(new Date(1123456789123))).toBe(
      "1123456789123000000",
    );
  });

  test("handles the epoch and single milliseconds", () => {
    expect(toLokiNanoseconds(new Date(0))).toBe("0");
    expect(toLokiNanoseconds(new Date(1))).toBe("1000000");
  });
});

describe("parseLokiNanoseconds", () => {
  test("parses 19-digit nanosecond strings exactly", () => {
    expect(parseLokiNanoseconds("1700000000123456789")).toBe(
      BigInt("1700000000123456789"),
    );
  });

  test("accepts surrounding whitespace", () => {
    expect(parseLokiNanoseconds(" 123 ")).toBe(BigInt(123));
  });

  test("rejects non-numeric and fractional strings", () => {
    expect(parseLokiNanoseconds("abc")).toBeNull();
    expect(parseLokiNanoseconds("12.5")).toBeNull();
    expect(parseLokiNanoseconds("1e18")).toBeNull();
    expect(parseLokiNanoseconds("")).toBeNull();
    expect(parseLokiNanoseconds(null)).toBeNull();
    expect(parseLokiNanoseconds(undefined)).toBeNull();
    expect(parseLokiNanoseconds({})).toBeNull();
  });

  test("tolerates numeric input", () => {
    expect(parseLokiNanoseconds(1000000)).toBe(BigInt(1000000));
    expect(parseLokiNanoseconds(Infinity)).toBeNull();
  });
});

describe("lokiNanosecondsToDate", () => {
  test("converts nanoseconds to a millisecond-precision Date", () => {
    const date: Date | null = lokiNanosecondsToDate("1700000000123456789");
    expect(date).not.toBeNull();
    expect(date!.toISOString()).toBe("2023-11-14T22:13:20.123Z");
  });

  test("truncates rather than rounds sub-millisecond digits", () => {
    const date: Date | null = lokiNanosecondsToDate("1700000000123999999");
    expect(date!.toISOString()).toBe("2023-11-14T22:13:20.123Z");
  });

  test("round-trips with toLokiNanoseconds", () => {
    const original: Date = new Date("2024-06-15T12:34:56.789Z");
    const roundTripped: Date | null = lokiNanosecondsToDate(
      toLokiNanoseconds(original),
    );
    expect(roundTripped!.getTime()).toBe(original.getTime());
  });

  test("returns null for malformed input", () => {
    expect(lokiNanosecondsToDate("not-a-number")).toBeNull();
    expect(lokiNanosecondsToDate(undefined)).toBeNull();
  });
});

describe("parseLokiResponseData", () => {
  test("returns resultType and result for a success envelope", () => {
    const parsed: LokiQueryRangeData = parseLokiResponseData(
      successBody("matrix", [{ metric: {}, values: [] }]),
    );
    expect(parsed.resultType).toBe("matrix");
    expect(parsed.result).toHaveLength(1);
  });

  test("throws for non-object bodies", () => {
    expect(() => {
      return parseLokiResponseData(undefined);
    }).toThrow(BadDataException);
    expect(() => {
      return parseLokiResponseData("<html>login</html>");
    }).toThrow("did not return a JSON object");
    expect(() => {
      return parseLokiResponseData([1, 2, 3]);
    }).toThrow(BadDataException);
  });

  test("surfaces the Loki error text on status error", () => {
    expect(() => {
      return parseLokiResponseData({
        status: "error",
        error: "parse error at line 1",
      });
    }).toThrow('Loki query failed with status "error": parse error at line 1');
  });

  test("throws when the data object is missing or malformed", () => {
    expect(() => {
      return parseLokiResponseData({ status: "success" });
    }).toThrow("missing the data object");
    expect(() => {
      return parseLokiResponseData({ status: "success", data: "nope" });
    }).toThrow(BadDataException);
    expect(() => {
      return parseLokiResponseData({ status: "success", data: {} });
    }).toThrow("missing data.resultType or data.result");
    expect(() => {
      return parseLokiResponseData({
        status: "success",
        data: { resultType: "matrix", result: "not-an-array" },
      });
    }).toThrow(BadDataException);
  });
});

describe("parseLokiMatrixPoint", () => {
  test("parses [seconds, stringValue] samples", () => {
    const point: { timestamp: Date; value: number } | null =
      parseLokiMatrixPoint([1700000000, "42.5"]);
    expect(point!.timestamp.getTime()).toBe(1700000000000);
    expect(point!.value).toBe(42.5);
  });

  test("handles fractional-second timestamps", () => {
    const point: { timestamp: Date; value: number } | null =
      parseLokiMatrixPoint([1700000000.5, "1"]);
    expect(point!.timestamp.getTime()).toBe(1700000000500);
  });

  test("rejects NaN and infinite values", () => {
    expect(parseLokiMatrixPoint([1700000000, "NaN"])).toBeNull();
    expect(parseLokiMatrixPoint([1700000000, "+Inf"])).toBeNull();
    expect(parseLokiMatrixPoint([1700000000, "-Inf"])).toBeNull();
  });

  test("rejects malformed samples", () => {
    expect(parseLokiMatrixPoint(null)).toBeNull();
    expect(parseLokiMatrixPoint([1700000000])).toBeNull();
    expect(parseLokiMatrixPoint(["abc", "1"])).toBeNull();
    expect(parseLokiMatrixPoint([0, "1"])).toBeNull();
    expect(parseLokiMatrixPoint({})).toBeNull();
  });
});

describe("lokiMatrixToTimeSeries", () => {
  test("maps series labels into per-point attributes without __name__", () => {
    const result: AggregatedResult = lokiMatrixToTimeSeries([
      {
        metric: { __name__: "rate", app: "api", level: "error" },
        values: [
          [1700000000, "1"],
          [1700000060, "2"],
        ],
      },
      {
        metric: { app: "worker", level: "error" },
        values: [[1700000000, "3"]],
      },
    ]);

    expect(result.truncated).toBe(false);
    expect(result.data).toHaveLength(3);
    expect(result.data[0]!.timestamp.getTime()).toBe(1700000000000);
    expect(result.data[0]!.value).toBe(1);
    expect(result.data[0]!["attributes"]).toEqual({
      app: "api",
      level: "error",
    });
    expect(result.data[2]!["attributes"]).toEqual({
      app: "worker",
      level: "error",
    });
  });

  test("omits attributes entirely for unlabeled series", () => {
    const result: AggregatedResult = lokiMatrixToTimeSeries([
      { metric: {}, values: [[1700000000, "5"]] },
    ]);
    expect(result.data).toHaveLength(1);
    expect("attributes" in result.data[0]!).toBe(false);
  });

  test("returns empty data for an empty result", () => {
    const result: AggregatedResult = lokiMatrixToTimeSeries([]);
    expect(result.data).toEqual([]);
    expect(result.truncated).toBe(false);
  });

  test("skips malformed series and points without failing", () => {
    const result: AggregatedResult = lokiMatrixToTimeSeries([
      null,
      "garbage",
      { metric: { app: "api" } },
      { metric: { app: "api" }, values: "nope" },
      {
        metric: { app: "api" },
        values: [[1700000000, "NaN"], [1700000060, "7"], "junk"],
      },
    ]);
    expect(result.data).toHaveLength(1);
    expect(result.data[0]!.value).toBe(7);
  });

  test("caps the number of series and flags truncation", () => {
    const manySeries: Array<unknown> = [];
    for (
      let seriesIndex: number = 0;
      seriesIndex < DATA_SOURCE_MAX_SERIES + 1;
      seriesIndex++
    ) {
      manySeries.push({
        metric: { instance: `host-${seriesIndex}` },
        values: [[1700000000, "1"]],
      });
    }
    const result: AggregatedResult = lokiMatrixToTimeSeries(manySeries);
    expect(result.data).toHaveLength(DATA_SOURCE_MAX_SERIES);
    expect(result.truncated).toBe(true);
  });

  test("caps total points and flags truncation", () => {
    const values: Array<unknown> = [];
    for (
      let pointIndex: number = 0;
      pointIndex < DATA_SOURCE_MAX_TIME_SERIES_ROWS + 1;
      pointIndex++
    ) {
      values.push([1700000000 + pointIndex, "1"]);
    }
    const result: AggregatedResult = lokiMatrixToTimeSeries([
      { metric: {}, values: values },
    ]);
    expect(result.data).toHaveLength(DATA_SOURCE_MAX_TIME_SERIES_ROWS);
    expect(result.truncated).toBe(true);
  });

  test("does not flag truncation at exactly the caps", () => {
    const exactSeries: Array<unknown> = [];
    for (
      let seriesIndex: number = 0;
      seriesIndex < DATA_SOURCE_MAX_SERIES;
      seriesIndex++
    ) {
      exactSeries.push({
        metric: { instance: `host-${seriesIndex}` },
        values: [[1700000000, "1"]],
      });
    }
    const result: AggregatedResult = lokiMatrixToTimeSeries(exactSeries);
    expect(result.data).toHaveLength(DATA_SOURCE_MAX_SERIES);
    expect(result.truncated).toBe(false);
  });
});

describe("lokiStreamsToTableRows", () => {
  test("flattens stream entries into rows sorted newest-first", () => {
    const rows: Array<Record<string, unknown>> = lokiStreamsToTableRows([
      {
        stream: { app: "api", level: "error" },
        values: [
          ["1700000000000000000", "older line"],
          ["1700000002000000000", "newest line"],
        ],
      },
      {
        stream: { app: "worker" },
        values: [["1700000001000000000", "middle line"]],
      },
    ]);

    expect(rows).toHaveLength(3);
    expect(rows[0]!["line"]).toBe("newest line");
    expect(rows[1]!["line"]).toBe("middle line");
    expect(rows[2]!["line"]).toBe("older line");
    expect(rows[0]!["app"]).toBe("api");
    expect(rows[0]!["level"]).toBe("error");
    expect(rows[1]!["app"]).toBe("worker");
    expect((rows[0]!["timestamp"] as Date).toISOString()).toBe(
      new Date(1700000002000).toISOString(),
    );
  });

  test("stream labels cannot clobber the timestamp and line cells", () => {
    const rows: Array<Record<string, unknown>> = lokiStreamsToTableRows([
      {
        stream: { line: "fake", timestamp: "fake", app: "api" },
        values: [["1700000000000000000", "real line"]],
      },
    ]);
    expect(rows[0]!["line"]).toBe("real line");
    expect(rows[0]!["timestamp"]).toBeInstanceOf(Date);
    expect(rows[0]!["app"]).toBe("api");
  });

  test("skips malformed streams and entries", () => {
    const rows: Array<Record<string, unknown>> = lokiStreamsToTableRows([
      null,
      { stream: {}, values: "nope" },
      {
        stream: { app: "api" },
        values: [
          ["not-nanoseconds", "dropped"],
          ["1700000000000000000"],
          ["1700000000000000000", "kept"],
          "junk",
        ],
      },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]!["line"]).toBe("kept");
  });

  test("orders by full nanosecond precision, not just milliseconds", () => {
    const rows: Array<Record<string, unknown>> = lokiStreamsToTableRows([
      {
        stream: {},
        values: [
          ["1700000000000000001", "first ns"],
          ["1700000000000000002", "second ns"],
        ],
      },
    ]);
    expect(rows[0]!["line"]).toBe("second ns");
    expect(rows[1]!["line"]).toBe("first ns");
  });
});

describe("lokiMatrixToTableRows", () => {
  test("maps matrix samples to rows with labels", () => {
    const rows: Array<Record<string, unknown>> = lokiMatrixToTableRows([
      {
        metric: { __name__: "rate", app: "api" },
        values: [
          [1700000000, "1.5"],
          [1700000060, "2.5"],
        ],
      },
    ]);
    expect(rows).toHaveLength(2);
    expect(rows[0]!["value"]).toBe(1.5);
    expect(rows[0]!["app"]).toBe("api");
    expect(rows[0]!["__name__"]).toBeUndefined();
    expect((rows[0]!["timestamp"] as Date).getTime()).toBe(1700000000000);
  });

  test("labels cannot clobber the timestamp and value cells", () => {
    const rows: Array<Record<string, unknown>> = lokiMatrixToTableRows([
      {
        metric: { value: "fake", timestamp: "fake" },
        values: [[1700000000, "9"]],
      },
    ]);
    expect(rows[0]!["value"]).toBe(9);
    expect(rows[0]!["timestamp"]).toBeInstanceOf(Date);
  });
});

describe("LokiConnector.testConnection", () => {
  test("probes /loki/api/v1/labels over the last hour with auth headers", async () => {
    const spy: jest.SpyInstance = spyFetchResolving(
      makeResponse({ status: "success", data: ["app", "level"] }),
    );

    const connector: LokiConnector = new LokiConnector();
    await connector.testConnection(makeSettings());

    expect(spy).toHaveBeenCalledTimes(1);
    const request: DataSourceHttpRequest = getRequest(spy);
    expect(request.method).toBe("GET");
    expect(
      request.url.startsWith(
        "http://loki.example.com:3100/loki/api/v1/labels?",
      ),
    ).toBe(true);
    expect(request.timeoutInMs).toBe(DATA_SOURCE_CONNECT_TIMEOUT_IN_MS);
    expect(request.headers!["Authorization"]).toBe("Bearer super-secret-token");

    const parsedUrl: URL = new URL(request.url);
    const startParam: string = parsedUrl.searchParams.get("start")!;
    const endParam: string = parsedUrl.searchParams.get("end")!;
    /*
     * The probe window is exactly one hour, expressed in nanoseconds —
     * 3600 * 1e9 apart, with no float drift in either bound.
     */
    expect(BigInt(endParam) - BigInt(startParam)).toBe(
      BigInt(3600) * BigInt(1000000000),
    );
    expect(startParam.endsWith("000000")).toBe(true);
    expect(endParam.endsWith("000000")).toBe(true);
  });

  test("strips trailing slashes from the base URL", async () => {
    const spy: jest.SpyInstance = spyFetchResolving(
      makeResponse({ status: "success", data: [] }),
    );
    const connector: LokiConnector = new LokiConnector();
    await connector.testConnection(
      makeSettings({ url: "http://loki.example.com:3100///" }),
    );
    const request: DataSourceHttpRequest = getRequest(spy);
    expect(
      request.url.startsWith(
        "http://loki.example.com:3100/loki/api/v1/labels?",
      ),
    ).toBe(true);
  });

  test("sends basic auth when username/password are configured", async () => {
    const spy: jest.SpyInstance = spyFetchResolving(
      makeResponse({ status: "success", data: [] }),
    );
    const connector: LokiConnector = new LokiConnector();
    await connector.testConnection(
      makeSettings({
        apiToken: undefined,
        username: "bob",
        password: "hunter2secret",
      }),
    );
    const request: DataSourceHttpRequest = getRequest(spy);
    const expected: string = `Basic ${Buffer.from("bob:hunter2secret").toString("base64")}`;
    expect(request.headers!["Authorization"]).toBe(expected);
  });

  test("rejects responses that are not a Loki success envelope", async () => {
    spyFetchResolving({
      statusCode: 200,
      bodyText: "<html>gateway</html>",
      bodyJson: undefined,
    });
    const connector: LokiConnector = new LokiConnector();
    await expect(connector.testConnection(makeSettings())).rejects.toThrow(
      "did not respond like a Grafana Loki API",
    );
  });

  test("rejects a JSON body whose status is not success", async () => {
    spyFetchResolving(makeResponse({ status: "error", data: [] }));
    const connector: LokiConnector = new LokiConnector();
    await expect(connector.testConnection(makeSettings())).rejects.toThrow(
      BadDataException,
    );
  });

  test("requires a URL and never dials without one", async () => {
    const spy: jest.SpyInstance = jest.spyOn(DataSourceHttpFetch, "fetch");
    const connector: LokiConnector = new LokiConnector();
    await expect(
      connector.testConnection(makeSettings({ url: undefined })),
    ).rejects.toThrow("requires a URL");
    expect(spy).not.toHaveBeenCalled();
  });

  test("egress guard blocks loopback targets before any socket is opened", async () => {
    /*
     * Real DataSourceHttpFetch.fetch path: the egress guard rejects
     * loopback literals during URL validation, so no network is touched.
     */
    const connector: LokiConnector = new LokiConnector();
    await expect(
      connector.testConnection(makeSettings({ url: "http://127.0.0.1:3100" })),
    ).rejects.toThrow("loopback");
  });

  test("egress guard runs on the configured hostname before connecting", async () => {
    const guardSpy: jest.SpyInstance = jest
      .spyOn(DataSourceEgressGuard, "assertHostnameAllowed")
      .mockRejectedValue(
        new BadDataException(
          "Data source host loki.internal is not allowed: private network address.",
        ) as never,
      );
    const connector: LokiConnector = new LokiConnector();
    await expect(
      connector.testConnection(
        makeSettings({ url: "http://loki.internal:3100" }),
      ),
    ).rejects.toThrow("private network address");
    expect(guardSpy).toHaveBeenCalledWith("loki.internal", undefined);
  });
});

describe("LokiConnector.queryTimeSeries", () => {
  test("issues a query_range GET with nanosecond bounds, step and limit", async () => {
    const spy: jest.SpyInstance = spyFetchResolving(
      makeResponse(successBody("matrix", [])),
    );
    const connector: LokiConnector = new LokiConnector();
    await connector.queryTimeSeries(
      makeSettings(),
      'sum(rate({app="api"} [5m]))',
      queryWindow,
    );

    const request: DataSourceHttpRequest = getRequest(spy);
    expect(request.method).toBe("GET");
    expect(
      request.url.startsWith(
        "http://loki.example.com:3100/loki/api/v1/query_range?",
      ),
    ).toBe(true);
    expect(request.timeoutInMs).toBe(DATA_SOURCE_QUERY_TIMEOUT_IN_MS);
    expect(request.headers!["Authorization"]).toBe("Bearer super-secret-token");

    const parsedUrl: URL = new URL(request.url);
    expect(parsedUrl.searchParams.get("query")).toBe(
      'sum(rate({app="api"} [5m]))',
    );
    expect(parsedUrl.searchParams.get("start")).toBe(
      toLokiNanoseconds(queryWindow.startDate),
    );
    expect(parsedUrl.searchParams.get("end")).toBe(
      toLokiNanoseconds(queryWindow.endDate),
    );
    expect(parsedUrl.searchParams.get("step")).toBe("60s");
    expect(parsedUrl.searchParams.get("limit")).toBe(
      (DATA_SOURCE_MAX_TIME_SERIES_ROWS + 1).toString(),
    );
  });

  test("derives the step from the window when none is given", async () => {
    const spy: jest.SpyInstance = spyFetchResolving(
      makeResponse(successBody("matrix", [])),
    );
    const windowWithoutStep: DataSourceQueryWindow = {
      startDate: queryWindow.startDate,
      endDate: queryWindow.endDate,
    };
    const connector: LokiConnector = new LokiConnector();
    await connector.queryTimeSeries(
      makeSettings(),
      'count_over_time({app="api"} [5m])',
      windowWithoutStep,
    );
    const expectedStep: number = DataSourceLimitsUtil.getStepInSeconds(
      windowWithoutStep.startDate,
      windowWithoutStep.endDate,
    );
    const parsedUrl: URL = new URL(getRequest(spy).url);
    expect(parsedUrl.searchParams.get("step")).toBe(`${expectedStep}s`);
  });

  test("normalizes a matrix response into AggregatedResult", async () => {
    spyFetchResolving(
      makeResponse(
        successBody("matrix", [
          {
            metric: { app: "api" },
            values: [
              [1704067200, "1"],
              [1704067260, "2"],
            ],
          },
        ]),
      ),
    );
    const connector: LokiConnector = new LokiConnector();
    const result: AggregatedResult = await connector.queryTimeSeries(
      makeSettings(),
      'sum(rate({app="api"} [5m]))',
      queryWindow,
    );
    expect(result.truncated).toBe(false);
    expect(result.data).toHaveLength(2);
    expect(result.data[0]!.timestamp).toBeInstanceOf(Date);
    expect(result.data[0]!.value).toBe(1);
    expect(result.data[0]!["attributes"]).toEqual({ app: "api" });
  });

  test("returns an empty result for a matrix with no series", async () => {
    spyFetchResolving(makeResponse(successBody("matrix", [])));
    const connector: LokiConnector = new LokiConnector();
    const result: AggregatedResult = await connector.queryTimeSeries(
      makeSettings(),
      'sum(rate({app="api"} [5m]))',
      queryWindow,
    );
    expect(result.data).toEqual([]);
    expect(result.truncated).toBe(false);
  });

  test("tells the user to wrap raw log queries in a metric function", async () => {
    spyFetchResolving(
      makeResponse(
        successBody("streams", [
          { stream: { app: "api" }, values: [["1700000000000000000", "x"]] },
        ]),
      ),
    );
    const connector: LokiConnector = new LokiConnector();
    await expect(
      connector.queryTimeSeries(makeSettings(), '{app="api"}', queryWindow),
    ).rejects.toThrow("rate() or count_over_time()");
  });

  test("rejects unexpected result types", async () => {
    spyFetchResolving(makeResponse(successBody("vector", [])));
    const connector: LokiConnector = new LokiConnector();
    await expect(
      connector.queryTimeSeries(makeSettings(), "vector(1)", queryWindow),
    ).rejects.toThrow('unexpected result type "vector"');
  });

  test("rejects an empty query without dialing", async () => {
    const spy: jest.SpyInstance = jest.spyOn(DataSourceHttpFetch, "fetch");
    const connector: LokiConnector = new LokiConnector();
    await expect(
      connector.queryTimeSeries(makeSettings(), "   ", queryWindow),
    ).rejects.toThrow("Query is required");
    expect(spy).not.toHaveBeenCalled();
  });

  test("surfaces Loki error envelopes with their message", async () => {
    spyFetchResolving(
      makeResponse({ status: "error", error: "parse error at char 5" }),
    );
    const connector: LokiConnector = new LokiConnector();
    await expect(
      connector.queryTimeSeries(makeSettings(), "sum(rate(", queryWindow),
    ).rejects.toThrow("parse error at char 5");
  });

  test("propagates HTTP-level BadDataExceptions from the fetch layer", async () => {
    jest
      .spyOn(DataSourceHttpFetch, "fetch")
      .mockRejectedValue(
        new BadDataException(
          "Data source responded with HTTP 400: parse error",
        ) as never,
      );
    const connector: LokiConnector = new LokiConnector();
    await expect(
      connector.queryTimeSeries(makeSettings(), "sum(rate(", queryWindow),
    ).rejects.toThrow("Data source responded with HTTP 400: parse error");
  });

  test("never leaks the password in error messages", async () => {
    jest
      .spyOn(DataSourceHttpFetch, "fetch")
      .mockRejectedValue(
        new Error(
          "auth failed with password hunter2secret for user bob",
        ) as never,
      );
    const connector: LokiConnector = new LokiConnector();
    const settings: DataSourceConnectionSettings = makeSettings({
      apiToken: undefined,
      username: "bob",
      password: "hunter2secret",
    });

    let thrownMessage: string = "";
    try {
      await connector.queryTimeSeries(
        settings,
        'sum(rate({a="b"}[1m]))',
        queryWindow,
      );
    } catch (error) {
      thrownMessage = (error as Error).message;
    }
    expect(thrownMessage).not.toContain("hunter2secret");
    expect(thrownMessage).toContain("***");
  });

  test("never leaks the API token in error messages", async () => {
    jest
      .spyOn(DataSourceHttpFetch, "fetch")
      .mockRejectedValue(
        new Error("401 unauthorized for token super-secret-token") as never,
      );
    const connector: LokiConnector = new LokiConnector();

    let thrownMessage: string = "";
    try {
      await connector.queryTimeSeries(
        makeSettings(),
        'sum(rate({a="b"}[1m]))',
        queryWindow,
      );
    } catch (error) {
      thrownMessage = (error as Error).message;
    }
    expect(thrownMessage).not.toContain("super-secret-token");
    expect(thrownMessage).toContain("***");
  });

  test("uses the injected fetch function instead of the static fetch", async () => {
    const staticSpy: jest.SpyInstance = jest.spyOn(
      DataSourceHttpFetch,
      "fetch",
    );
    const injectedFetch: jest.Mock = jest
      .fn()
      .mockResolvedValue(makeResponse(successBody("matrix", [])) as never);
    const connector: LokiConnector = new LokiConnector(injectedFetch as never);
    const result: AggregatedResult = await connector.queryTimeSeries(
      makeSettings(),
      'sum(rate({app="api"} [5m]))',
      queryWindow,
    );
    expect(result.data).toEqual([]);
    expect(injectedFetch).toHaveBeenCalledTimes(1);
    expect(staticSpy).not.toHaveBeenCalled();
  });
});

describe("LokiConnector.queryTable", () => {
  test("passes the table row cap + 1 as the limit parameter", async () => {
    const spy: jest.SpyInstance = spyFetchResolving(
      makeResponse(successBody("streams", [])),
    );
    const connector: LokiConnector = new LokiConnector();
    await connector.queryTable(makeSettings(), '{app="api"}', queryWindow);
    const parsedUrl: URL = new URL(getRequest(spy).url);
    expect(parsedUrl.searchParams.get("limit")).toBe(
      (DATA_SOURCE_MAX_TABLE_ROWS + 1).toString(),
    );
  });

  test("maps streams to rows with ISO timestamps, lines and labels", async () => {
    spyFetchResolving(
      makeResponse(
        successBody("streams", [
          {
            stream: { app: "api", level: "error" },
            values: [
              ["1700000000123456789", "first error"],
              ["1700000060123456789", "second error"],
            ],
          },
        ]),
      ),
    );
    const connector: LokiConnector = new LokiConnector();
    const result: DataSourceTableResult = await connector.queryTable(
      makeSettings(),
      '{app="api"}',
      queryWindow,
    );

    expect(result.truncated).toBe(false);
    expect(result.rows).toHaveLength(2);
    /* Newest first. */
    expect(result.rows[0]!["line"]).toBe("second error");
    expect(result.rows[0]!["timestamp"]).toBe("2023-11-14T22:14:20.123Z");
    expect(result.rows[0]!["app"]).toBe("api");
    expect(result.rows[1]!["line"]).toBe("first error");
    expect(result.rows[1]!["timestamp"]).toBe("2023-11-14T22:13:20.123Z");

    const timestampColumn: DataSourceTableColumn | undefined =
      result.columns.find((column: DataSourceTableColumn) => {
        return column.key === "timestamp";
      });
    expect(timestampColumn!.type).toBe(DataSourceTableColumnType.Date);
    const lineColumn: DataSourceTableColumn | undefined = result.columns.find(
      (column: DataSourceTableColumn) => {
        return column.key === "line";
      },
    );
    expect(lineColumn!.type).toBe(DataSourceTableColumnType.Text);
  });

  test("clamps stream rows at the table cap and flags truncation", async () => {
    const values: Array<unknown> = [];
    for (
      let entryIndex: number = 0;
      entryIndex < DATA_SOURCE_MAX_TABLE_ROWS + 1;
      entryIndex++
    ) {
      const nanoseconds: string = (
        BigInt("1700000000000000000") +
        BigInt(entryIndex) * BigInt(1000000)
      ).toString();
      values.push([nanoseconds, `line ${entryIndex}`]);
    }
    spyFetchResolving(
      makeResponse(
        successBody("streams", [{ stream: { app: "api" }, values: values }]),
      ),
    );
    const connector: LokiConnector = new LokiConnector();
    const result: DataSourceTableResult = await connector.queryTable(
      makeSettings(),
      '{app="api"}',
      queryWindow,
    );
    expect(result.rows).toHaveLength(DATA_SOURCE_MAX_TABLE_ROWS);
    expect(result.truncated).toBe(true);
  });

  test("maps matrix results to rows with numeric value column", async () => {
    spyFetchResolving(
      makeResponse(
        successBody("matrix", [
          {
            metric: { app: "api" },
            values: [
              [1704067200, "1.5"],
              [1704067260, "2.5"],
            ],
          },
        ]),
      ),
    );
    const connector: LokiConnector = new LokiConnector();
    const result: DataSourceTableResult = await connector.queryTable(
      makeSettings(),
      'sum(rate({app="api"} [5m]))',
      queryWindow,
    );

    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]!["value"]).toBe(1.5);
    expect(result.rows[0]!["app"]).toBe("api");
    expect(typeof result.rows[0]!["timestamp"]).toBe("string");

    const valueColumn: DataSourceTableColumn | undefined = result.columns.find(
      (column: DataSourceTableColumn) => {
        return column.key === "value";
      },
    );
    expect(valueColumn!.type).toBe(DataSourceTableColumnType.Number);
  });

  test("returns an empty table for empty results", async () => {
    spyFetchResolving(makeResponse(successBody("streams", [])));
    const connector: LokiConnector = new LokiConnector();
    const result: DataSourceTableResult = await connector.queryTable(
      makeSettings(),
      '{app="api"}',
      queryWindow,
    );
    expect(result.columns).toEqual([]);
    expect(result.rows).toEqual([]);
    expect(result.truncated).toBe(false);
  });

  test("rejects unexpected result types for tables", async () => {
    spyFetchResolving(makeResponse(successBody("vector", [])));
    const connector: LokiConnector = new LokiConnector();
    await expect(
      connector.queryTable(makeSettings(), "vector(1)", queryWindow),
    ).rejects.toThrow('unexpected result type "vector"');
  });
});
