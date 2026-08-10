import https from "https";
import { afterEach, describe, expect, test } from "@jest/globals";
import ClickHouseConnector, {
  ClickHouseClientConfig,
  ClickHouseClientFactory,
  ClickHouseClientLike,
} from "../../../../Server/Utils/DataSource/Connectors/ClickHouseConnector";
import DataSourceEgressGuard, {
  ResolvedAddress,
} from "../../../../Server/Utils/DataSource/EgressGuard";
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
import DataSourceTableResult from "../../../../Types/DataSource/DataSourceTableResult";
import DataSourceType from "../../../../Types/DataSource/DataSourceType";
import BadDataException from "../../../../Types/Exception/BadDataException";

type FakeQueryParams = {
  query: string;
  format: "JSON";
  clickhouse_settings?: Record<string, unknown>;
};

interface FakeClientBehavior {
  rows?: Array<Record<string, unknown>>;
  /*
   * When set, the fake's json() resolves with exactly this value instead of
   * wrapping rows in { data } — used to simulate malformed payloads.
   */
  rawJsonValue?: unknown;
  useRawJsonValue?: boolean;
  queryError?: Error;
  pingResult?: { success: boolean };
  pingError?: Error;
  closeError?: Error;
}

interface FakeHarness {
  factory: ClickHouseClientFactory;
  configs: Array<ClickHouseClientConfig>;
  queryCalls: Array<FakeQueryParams>;
  events: Array<string>;
  counters: { ping: number; close: number };
}

type MakeHarnessFunction = (behavior?: FakeClientBehavior) => FakeHarness;

const makeHarness: MakeHarnessFunction = (
  behavior?: FakeClientBehavior,
): FakeHarness => {
  const configs: Array<ClickHouseClientConfig> = [];
  const queryCalls: Array<FakeQueryParams> = [];
  const events: Array<string> = [];
  const counters: { ping: number; close: number } = { ping: 0, close: 0 };

  const factory: ClickHouseClientFactory = (
    config: ClickHouseClientConfig,
  ): ClickHouseClientLike => {
    configs.push(config);
    events.push("factory");

    return {
      query: (params: FakeQueryParams): Promise<{ json<T>(): Promise<T> }> => {
        queryCalls.push(params);
        events.push("query");
        if (behavior?.queryError) {
          return Promise.reject(behavior.queryError);
        }
        const jsonValue: unknown = behavior?.useRawJsonValue
          ? behavior.rawJsonValue
          : { data: behavior?.rows ?? [] };
        return Promise.resolve({
          json: <T>(): Promise<T> => {
            return Promise.resolve(jsonValue as T);
          },
        });
      },
      ping: (): Promise<{ success: boolean }> => {
        counters.ping += 1;
        events.push("ping");
        if (behavior?.pingError) {
          return Promise.reject(behavior.pingError);
        }
        return Promise.resolve(behavior?.pingResult ?? { success: true });
      },
      close: (): Promise<void> => {
        counters.close += 1;
        events.push("close");
        if (behavior?.closeError) {
          return Promise.reject(behavior.closeError);
        }
        return Promise.resolve();
      },
    };
  };

  return {
    factory: factory,
    configs: configs,
    queryCalls: queryCalls,
    events: events,
    counters: counters,
  };
};

type MockEgressFunction = (events?: Array<string>) => jest.SpyInstance;

const mockEgressAllowed: MockEgressFunction = (
  events?: Array<string>,
): jest.SpyInstance => {
  return jest
    .spyOn(DataSourceEgressGuard, "assertHostnameAllowed")
    .mockImplementation(
      (_hostname: string): Promise<Array<ResolvedAddress>> => {
        if (events) {
          events.push("egress");
        }
        return Promise.resolve([{ address: "203.0.113.10", family: 4 }]);
      },
    );
};

type MakeSettingsFunction = (
  overrides?: Partial<DataSourceConnectionSettings>,
) => DataSourceConnectionSettings;

const makeSettings: MakeSettingsFunction = (
  overrides?: Partial<DataSourceConnectionSettings>,
): DataSourceConnectionSettings => {
  return {
    dataSourceType: DataSourceType.ClickHouse,
    databaseHost: "clickhouse.example.com",
    databasePort: 8123,
    databaseName: "analytics",
    username: "reader",
    password: "super-secret-password",
    ...overrides,
  };
};

const testWindow: DataSourceQueryWindow = {
  startDate: new Date(Date.UTC(2026, 0, 1, 0, 0, 0)),
  endDate: new Date(Date.UTC(2026, 0, 2, 0, 0, 0)),
};

const timeSeriesRows: Array<Record<string, unknown>> = [
  { time: "2026-01-01 00:05:00", value: 3 },
  { time: "2026-01-01 00:06:00", value: 5 },
];

describe("ClickHouseConnector", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("declares the ClickHouse data source type", () => {
    const connector: ClickHouseConnector = new ClickHouseConnector();
    expect(connector.dataSourceType).toBe(DataSourceType.ClickHouse);
  });

  describe("testConnection", () => {
    test("validates egress before creating the client, pings, and closes", async () => {
      const harness: FakeHarness = makeHarness();
      const egressSpy: jest.SpyInstance = mockEgressAllowed(harness.events);
      const connector: ClickHouseConnector = new ClickHouseConnector(
        harness.factory,
      );

      await connector.testConnection(makeSettings());

      expect(egressSpy).toHaveBeenCalledTimes(1);
      expect(egressSpy).toHaveBeenCalledWith("clickhouse.example.com");
      expect(harness.events).toEqual(["egress", "factory", "ping", "close"]);
      expect(harness.counters.ping).toBe(1);
      expect(harness.counters.close).toBe(1);
    });

    test("builds an http URL with the connect timeout, single connection and compression disabled", async () => {
      const harness: FakeHarness = makeHarness();
      mockEgressAllowed();
      const connector: ClickHouseConnector = new ClickHouseConnector(
        harness.factory,
      );

      await connector.testConnection(makeSettings());

      const config: ClickHouseClientConfig = harness.configs[0]!;
      expect(config.url).toBe("http://clickhouse.example.com:8123");
      expect(config.username).toBe("reader");
      expect(config.password).toBe("super-secret-password");
      expect(config.database).toBe("analytics");
      expect(config.application).toBe("oneuptime-datasource");
      expect(config.request_timeout).toBe(DATA_SOURCE_CONNECT_TIMEOUT_IN_MS);
      expect(config.max_open_connections).toBe(1);
      expect(config.compression).toEqual({ request: false, response: false });
      expect(config.http_agent).toBeUndefined();
    });

    test("defaults username to 'default', password to empty, and omits database when unset", async () => {
      const harness: FakeHarness = makeHarness();
      mockEgressAllowed();
      const connector: ClickHouseConnector = new ClickHouseConnector(
        harness.factory,
      );

      await connector.testConnection(
        makeSettings({
          username: undefined,
          password: undefined,
          databaseName: undefined,
          databasePort: undefined,
        }),
      );

      const config: ClickHouseClientConfig = harness.configs[0]!;
      expect(config.url).toBe("http://clickhouse.example.com:8123");
      expect(config.username).toBe("default");
      expect(config.password).toBe("");
      expect(config.database).toBeUndefined();
    });

    test("throws BadDataException and skips egress/client when databaseHost is missing", async () => {
      const harness: FakeHarness = makeHarness();
      const egressSpy: jest.SpyInstance = mockEgressAllowed();
      const connector: ClickHouseConnector = new ClickHouseConnector(
        harness.factory,
      );

      await expect(
        connector.testConnection(makeSettings({ databaseHost: undefined })),
      ).rejects.toThrow(BadDataException);
      expect(egressSpy).not.toHaveBeenCalled();
      expect(harness.configs).toHaveLength(0);
    });

    test("propagates an egress guard rejection without creating a client", async () => {
      const harness: FakeHarness = makeHarness();
      jest
        .spyOn(DataSourceEgressGuard, "assertHostnameAllowed")
        .mockRejectedValue(
          new BadDataException(
            "Data source host clickhouse.example.com is not allowed: private network address.",
          ),
        );
      const connector: ClickHouseConnector = new ClickHouseConnector(
        harness.factory,
      );

      await expect(connector.testConnection(makeSettings())).rejects.toThrow(
        "not allowed",
      );
      expect(harness.configs).toHaveLength(0);
    });

    test("throws BadDataException when ping reports failure, and still closes", async () => {
      const harness: FakeHarness = makeHarness({
        pingResult: { success: false },
      });
      mockEgressAllowed();
      const connector: ClickHouseConnector = new ClickHouseConnector(
        harness.factory,
      );

      await expect(connector.testConnection(makeSettings())).rejects.toThrow(
        "Could not connect to ClickHouse",
      );
      expect(harness.counters.close).toBe(1);
    });

    test("sanitizes secrets out of ping errors and still closes", async () => {
      const harness: FakeHarness = makeHarness({
        pingError: new Error(
          "Auth failed for reader with password super-secret-password at clickhouse.example.com",
        ),
      });
      mockEgressAllowed();
      const connector: ClickHouseConnector = new ClickHouseConnector(
        harness.factory,
      );

      let thrown: Error | null = null;
      try {
        await connector.testConnection(makeSettings());
      } catch (error) {
        thrown = error as Error;
      }

      expect(thrown).toBeInstanceOf(BadDataException);
      expect(thrown!.message).not.toContain("super-secret-password");
      expect(thrown!.message).not.toContain("clickhouse.example.com");
      expect(thrown!.message).toContain("***");
      expect(harness.counters.close).toBe(1);
    });

    test("survives a close() failure after a successful ping", async () => {
      const harness: FakeHarness = makeHarness({
        closeError: new Error("socket already destroyed"),
      });
      mockEgressAllowed();
      const connector: ClickHouseConnector = new ClickHouseConnector(
        harness.factory,
      );

      await expect(
        connector.testConnection(makeSettings()),
      ).resolves.toBeUndefined();
      expect(harness.counters.close).toBe(1);
    });
  });

  describe("client configuration for queries", () => {
    test("uses https scheme, custom port and query timeout padding when sslEnabled", async () => {
      const harness: FakeHarness = makeHarness({ rows: timeSeriesRows });
      mockEgressAllowed();
      const connector: ClickHouseConnector = new ClickHouseConnector(
        harness.factory,
      );

      await connector.queryTimeSeries(
        makeSettings({
          databasePort: 8443,
          additionalOptions: { sslEnabled: true },
        }),
        "SELECT time, value FROM metrics",
        testWindow,
      );

      const config: ClickHouseClientConfig = harness.configs[0]!;
      expect(config.url).toBe("https://clickhouse.example.com:8443");
      expect(config.request_timeout).toBe(
        DATA_SOURCE_QUERY_TIMEOUT_IN_MS + 5000,
      );
      expect(config.http_agent).toBeUndefined();
      expect(config.compression).toEqual({ request: false, response: false });
    });

    test("disables certificate verification only when sslRejectUnauthorized is false", async () => {
      const harness: FakeHarness = makeHarness({ rows: timeSeriesRows });
      mockEgressAllowed();
      const connector: ClickHouseConnector = new ClickHouseConnector(
        harness.factory,
      );

      await connector.queryTimeSeries(
        makeSettings({
          additionalOptions: { sslEnabled: true, sslRejectUnauthorized: false },
        }),
        "SELECT time, value FROM metrics",
        testWindow,
      );

      const config: ClickHouseClientConfig = harness.configs[0]!;
      expect(config.url).toBe("https://clickhouse.example.com:8123");
      expect(config.http_agent).toBeInstanceOf(https.Agent);
      expect(
        (config.http_agent as https.Agent).options.rejectUnauthorized,
      ).toBe(false);
    });

    test("does not attach an insecure agent when TLS is off, even with sslRejectUnauthorized false", async () => {
      const harness: FakeHarness = makeHarness({ rows: timeSeriesRows });
      mockEgressAllowed();
      const connector: ClickHouseConnector = new ClickHouseConnector(
        harness.factory,
      );

      await connector.queryTimeSeries(
        makeSettings({
          additionalOptions: {
            sslEnabled: false,
            sslRejectUnauthorized: false,
          },
        }),
        "SELECT time, value FROM metrics",
        testWindow,
      );

      const config: ClickHouseClientConfig = harness.configs[0]!;
      expect(config.url).toBe("http://clickhouse.example.com:8123");
      expect(config.http_agent).toBeUndefined();
    });
  });

  describe("queryTimeSeries", () => {
    test("validates egress before the client, runs the query, closes, and shapes rows", async () => {
      const harness: FakeHarness = makeHarness({ rows: timeSeriesRows });
      mockEgressAllowed(harness.events);
      const connector: ClickHouseConnector = new ClickHouseConnector(
        harness.factory,
      );

      const result: AggregatedResult = await connector.queryTimeSeries(
        makeSettings(),
        "SELECT time, value FROM metrics",
        testWindow,
      );

      expect(harness.events).toEqual(["egress", "factory", "query", "close"]);
      expect(result.truncated).toBe(false);
      expect(result.data).toHaveLength(2);
      expect(result.data[0]!.timestamp).toEqual(
        new Date("2026-01-01T00:05:00Z"),
      );
      expect(result.data[0]!.value).toBe(3);
      expect(result.data[0]!["attributes"]).toBeUndefined();
    });

    test("passes readonly, execution-time and cap+1 row settings to the driver", async () => {
      const harness: FakeHarness = makeHarness({ rows: timeSeriesRows });
      mockEgressAllowed();
      const connector: ClickHouseConnector = new ClickHouseConnector(
        harness.factory,
      );

      await connector.queryTimeSeries(
        makeSettings(),
        "SELECT time, value FROM metrics",
        testWindow,
      );

      const params: FakeQueryParams = harness.queryCalls[0]!;
      expect(params.format).toBe("JSON");
      expect(params.clickhouse_settings).toEqual({
        readonly: 1,
        max_execution_time: Math.ceil(DATA_SOURCE_QUERY_TIMEOUT_IN_MS / 1000),
        max_result_rows: DATA_SOURCE_MAX_TIME_SERIES_ROWS + 1,
        result_overflow_mode: "break",
      });
    });

    test("applies time macros and strips a trailing semicolon before executing", async () => {
      const harness: FakeHarness = makeHarness({ rows: timeSeriesRows });
      mockEgressAllowed();
      const connector: ClickHouseConnector = new ClickHouseConnector(
        harness.factory,
      );

      await connector.queryTimeSeries(
        makeSettings(),
        "SELECT time, value FROM metrics WHERE t BETWEEN $__startTime AND $__endTime AND ms > $__startTimeMs;",
        testWindow,
      );

      const executed: string = harness.queryCalls[0]!.query;
      expect(executed).toContain("'2026-01-01 00:00:00'");
      expect(executed).toContain("'2026-01-02 00:00:00'");
      expect(executed).toContain(testWindow.startDate.getTime().toString());
      expect(executed).not.toContain("$__");
      expect(executed.endsWith(";")).toBe(false);
    });

    test("turns series label columns into per-point attributes", async () => {
      const harness: FakeHarness = makeHarness({
        rows: [
          { time: "2026-01-01 00:05:00", value: 1, host: "web-1" },
          { time: "2026-01-01 00:05:00", value: 2, host: "web-2" },
        ],
      });
      mockEgressAllowed();
      const connector: ClickHouseConnector = new ClickHouseConnector(
        harness.factory,
      );

      const result: AggregatedResult = await connector.queryTimeSeries(
        makeSettings(),
        "SELECT time, value, host FROM metrics",
        testWindow,
      );

      expect(result.data).toHaveLength(2);
      expect(result.data[0]!["attributes"]).toEqual({ host: "web-1" });
      expect(result.data[1]!["attributes"]).toEqual({ host: "web-2" });
    });

    test("plots UInt64 values that arrive as JSON strings or numbers identically", async () => {
      const harness: FakeHarness = makeHarness({
        rows: [
          /*
           * ClickHouse serializes UInt64 (count(), sum()) as a JSON string
           * or number depending on the server's
           * output_format_json_quote_64bit_integers setting — both must
           * chart the same.
           */
          { time: "2026-01-01 00:05:00", value: "42" },
          { time: "2026-01-01 00:06:00", value: 43 },
        ],
      });
      mockEgressAllowed();
      const connector: ClickHouseConnector = new ClickHouseConnector(
        harness.factory,
      );

      const result: AggregatedResult = await connector.queryTimeSeries(
        makeSettings(),
        "SELECT time, count() AS value FROM events GROUP BY time",
        testWindow,
      );

      expect(result.data).toHaveLength(2);
      expect(result.data[0]!.value).toBe(42);
      expect(result.data[1]!.value).toBe(43);
    });

    test("returns an empty result for zero rows", async () => {
      const harness: FakeHarness = makeHarness({ rows: [] });
      mockEgressAllowed();
      const connector: ClickHouseConnector = new ClickHouseConnector(
        harness.factory,
      );

      const result: AggregatedResult = await connector.queryTimeSeries(
        makeSettings(),
        "SELECT time, value FROM metrics",
        testWindow,
      );

      expect(result.data).toEqual([]);
      expect(result.truncated).toBe(false);
    });

    test("clamps to the time-series cap and flags truncation when cap+1 rows return", async () => {
      const overflowRows: Array<Record<string, unknown>> = [];
      const baseTime: number = Date.UTC(2026, 0, 1, 0, 0, 0);
      for (
        let index: number = 0;
        index < DATA_SOURCE_MAX_TIME_SERIES_ROWS + 1;
        index++
      ) {
        overflowRows.push({
          time: new Date(baseTime + index * 60000).toISOString(),
          value: index,
        });
      }
      const harness: FakeHarness = makeHarness({ rows: overflowRows });
      mockEgressAllowed();
      const connector: ClickHouseConnector = new ClickHouseConnector(
        harness.factory,
      );

      const result: AggregatedResult = await connector.queryTimeSeries(
        makeSettings(),
        "SELECT time, value FROM metrics",
        testWindow,
      );

      expect(result.data).toHaveLength(DATA_SOURCE_MAX_TIME_SERIES_ROWS);
      expect(result.truncated).toBe(true);
    });

    test("rejects write statements without ever creating a client", async () => {
      const harness: FakeHarness = makeHarness();
      mockEgressAllowed();
      const connector: ClickHouseConnector = new ClickHouseConnector(
        harness.factory,
      );

      await expect(
        connector.queryTimeSeries(
          makeSettings(),
          "INSERT INTO metrics (time, value) VALUES (now(), 1)",
          testWindow,
        ),
      ).rejects.toThrow("read-only");
      expect(harness.configs).toHaveLength(0);
      expect(harness.queryCalls).toHaveLength(0);
    });

    test("throws BadDataException for a malformed (null) response body and still closes", async () => {
      const harness: FakeHarness = makeHarness({
        useRawJsonValue: true,
        rawJsonValue: null,
      });
      mockEgressAllowed();
      const connector: ClickHouseConnector = new ClickHouseConnector(
        harness.factory,
      );

      await expect(
        connector.queryTimeSeries(
          makeSettings(),
          "SELECT time, value FROM metrics",
          testWindow,
        ),
      ).rejects.toThrow("unexpected response shape");
      expect(harness.counters.close).toBe(1);
    });

    test("throws BadDataException when the response has no data array", async () => {
      const harness: FakeHarness = makeHarness({
        useRawJsonValue: true,
        rawJsonValue: { meta: [], rows: 0 },
      });
      mockEgressAllowed();
      const connector: ClickHouseConnector = new ClickHouseConnector(
        harness.factory,
      );

      await expect(
        connector.queryTimeSeries(
          makeSettings(),
          "SELECT time, value FROM metrics",
          testWindow,
        ),
      ).rejects.toThrow(BadDataException);
      expect(harness.counters.close).toBe(1);
    });

    test("sanitizes driver errors and closes the client on failure", async () => {
      const harness: FakeHarness = makeHarness({
        queryError: new Error(
          "Authentication failed: password super-secret-password is invalid on clickhouse.example.com",
        ),
      });
      mockEgressAllowed();
      const connector: ClickHouseConnector = new ClickHouseConnector(
        harness.factory,
      );

      let thrown: Error | null = null;
      try {
        await connector.queryTimeSeries(
          makeSettings(),
          "SELECT time, value FROM metrics",
          testWindow,
        );
      } catch (error) {
        thrown = error as Error;
      }

      expect(thrown).toBeInstanceOf(BadDataException);
      expect(thrown!.message).not.toContain("super-secret-password");
      expect(thrown!.message).not.toContain("clickhouse.example.com");
      expect(thrown!.message).toContain("***");
      expect(harness.counters.close).toBe(1);
    });
  });

  describe("queryTable", () => {
    test("returns typed columns and coerced rows with the table cap+1 requested", async () => {
      const harness: FakeHarness = makeHarness({
        rows: [
          { query_id: "abc-123", duration_ms: 15, ok: true },
          { query_id: "def-456", duration_ms: "27", ok: false },
        ],
      });
      mockEgressAllowed();
      const connector: ClickHouseConnector = new ClickHouseConnector(
        harness.factory,
      );

      const result: DataSourceTableResult = await connector.queryTable(
        makeSettings(),
        "SELECT query_id, duration_ms, ok FROM queries",
        testWindow,
      );

      expect(
        harness.queryCalls[0]!.clickhouse_settings!["max_result_rows"],
      ).toBe(DATA_SOURCE_MAX_TABLE_ROWS + 1);
      expect(
        result.columns.map((column: { key: string }) => {
          return column.key;
        }),
      ).toEqual(["query_id", "duration_ms", "ok"]);
      expect(result.rows).toHaveLength(2);
      expect(result.rows[0]!["query_id"]).toBe("abc-123");
      expect(result.rows[0]!["duration_ms"]).toBe(15);
      expect(result.rows[0]!["ok"]).toBe(true);
      expect(result.truncated).toBe(false);
    });

    test("allows introspection of system.query_log (no false positive on the word system)", async () => {
      const harness: FakeHarness = makeHarness({
        rows: [{ query_id: "abc-123" }],
      });
      mockEgressAllowed();
      const connector: ClickHouseConnector = new ClickHouseConnector(
        harness.factory,
      );

      const result: DataSourceTableResult = await connector.queryTable(
        makeSettings(),
        "SELECT * FROM system.query_log",
        testWindow,
      );

      expect(harness.queryCalls).toHaveLength(1);
      expect(harness.queryCalls[0]!.query).toBe(
        "SELECT * FROM system.query_log",
      );
      expect(result.rows).toHaveLength(1);
    });

    test("clamps to the table cap and flags truncation", async () => {
      const overflowRows: Array<Record<string, unknown>> = [];
      for (
        let index: number = 0;
        index < DATA_SOURCE_MAX_TABLE_ROWS + 1;
        index++
      ) {
        overflowRows.push({ id: index });
      }
      const harness: FakeHarness = makeHarness({ rows: overflowRows });
      mockEgressAllowed();
      const connector: ClickHouseConnector = new ClickHouseConnector(
        harness.factory,
      );

      const result: DataSourceTableResult = await connector.queryTable(
        makeSettings(),
        "SELECT id FROM queries",
        testWindow,
      );

      expect(result.rows).toHaveLength(DATA_SOURCE_MAX_TABLE_ROWS);
      expect(result.truncated).toBe(true);
    });

    test("returns an empty table for zero rows and still closes the client", async () => {
      const harness: FakeHarness = makeHarness({ rows: [] });
      mockEgressAllowed();
      const connector: ClickHouseConnector = new ClickHouseConnector(
        harness.factory,
      );

      const result: DataSourceTableResult = await connector.queryTable(
        makeSettings(),
        "SELECT id FROM queries",
        testWindow,
      );

      expect(result.columns).toEqual([]);
      expect(result.rows).toEqual([]);
      expect(result.truncated).toBe(false);
      expect(harness.counters.close).toBe(1);
    });

    test("rejects multi-statement queries before any client is created", async () => {
      const harness: FakeHarness = makeHarness();
      mockEgressAllowed();
      const connector: ClickHouseConnector = new ClickHouseConnector(
        harness.factory,
      );

      await expect(
        connector.queryTable(makeSettings(), "SELECT 1; SELECT 2", testWindow),
      ).rejects.toThrow("single SQL statement");
      expect(harness.configs).toHaveLength(0);
    });
  });
});
