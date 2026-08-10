import { afterEach, describe, expect, test } from "@jest/globals";
import { ClientConfig } from "pg";
import PostgresConnector, {
  PgClientFactory,
  PgClientLike,
} from "../../../../Server/Utils/DataSource/Connectors/PostgresConnector";
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
import DataSourceTableResult, {
  DataSourceTableColumn,
  DataSourceTableColumnType,
} from "../../../../Types/DataSource/DataSourceTableResult";
import DataSourceType from "../../../../Types/DataSource/DataSourceType";

const SECRET_PASSWORD: string = "sup3r-secret-pass";
const CURSOR_NAME: string = "oneuptime_data_source_cursor";

/*
 * 2026-01-01T00:00:00Z ... 2026-01-02T00:00:00Z — the fixed window every
 * test queries over. Epoch: 1767225600 seconds.
 */
const WINDOW_START_EPOCH_SECONDS: number = 1767225600;

const queryWindow: DataSourceQueryWindow = {
  startDate: new Date(Date.UTC(2026, 0, 1, 0, 0, 0)),
  endDate: new Date(Date.UTC(2026, 0, 2, 0, 0, 0)),
};

interface FakeClientBehavior {
  fetchRows?: Array<Record<string, unknown>> | undefined;
  connectError?: Error | undefined;
  // Any executed statement starting with this prefix throws queryError.
  queryErrorPrefix?: string | undefined;
  queryError?: Error | undefined;
}

interface FakeClientRecorder {
  configs: Array<ClientConfig>;
  queries: Array<string>;
  connectCalls: number;
  endCalls: number;
  events: Array<string>;
}

interface FakeFactoryHarness {
  factory: PgClientFactory;
  recorder: FakeClientRecorder;
}

function createFakeFactory(behavior: FakeClientBehavior): FakeFactoryHarness {
  const recorder: FakeClientRecorder = {
    configs: [],
    queries: [],
    connectCalls: 0,
    endCalls: 0,
    events: [],
  };

  const factory: PgClientFactory = (config: ClientConfig): PgClientLike => {
    recorder.configs.push(config);
    recorder.events.push("factory");

    return {
      connect: async (): Promise<void> => {
        recorder.connectCalls++;
        recorder.events.push("connect");
        if (behavior.connectError) {
          throw behavior.connectError;
        }
      },
      query: async (
        text: string,
      ): Promise<{ rows: Array<Record<string, unknown>> }> => {
        recorder.queries.push(text);
        if (
          behavior.queryError &&
          behavior.queryErrorPrefix !== undefined &&
          text.startsWith(behavior.queryErrorPrefix)
        ) {
          throw behavior.queryError;
        }
        if (text.startsWith("FETCH FORWARD")) {
          return { rows: behavior.fetchRows || [] };
        }
        return { rows: [] };
      },
      end: async (): Promise<void> => {
        recorder.endCalls++;
        recorder.events.push("end");
      },
    };
  };

  return { factory: factory, recorder: recorder };
}

function buildSettings(
  overrides?: Partial<DataSourceConnectionSettings>,
): DataSourceConnectionSettings {
  return {
    dataSourceType: DataSourceType.PostgreSQL,
    databaseHost: "db.example.com",
    databasePort: 5433,
    databaseName: "metrics",
    username: "readonly_user",
    password: SECRET_PASSWORD,
    ...overrides,
  };
}

function mockEgressAllowed(): jest.SpyInstance {
  return jest
    .spyOn(DataSourceEgressGuard, "assertHostnameAllowed")
    .mockResolvedValue([{ address: "203.0.113.10", family: 4 }]);
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("PostgresConnector", () => {
  test("declares the PostgreSQL data source type", () => {
    const connector: PostgresConnector = new PostgresConnector();
    expect(connector.dataSourceType).toBe(DataSourceType.PostgreSQL);
  });

  describe("testConnection", () => {
    test("validates egress, connects, runs SELECT 1 and closes", async () => {
      const harness: FakeFactoryHarness = createFakeFactory({});
      const egressSpy: jest.SpyInstance = jest
        .spyOn(DataSourceEgressGuard, "assertHostnameAllowed")
        .mockImplementation(
          (hostname: string): Promise<Array<ResolvedAddress>> => {
            harness.recorder.events.push(`egress:${hostname}`);
            return Promise.resolve([{ address: "203.0.113.10", family: 4 }]);
          },
        );

      const connector: PostgresConnector = new PostgresConnector(
        harness.factory,
      );

      await connector.testConnection(buildSettings());

      expect(egressSpy).toHaveBeenCalledWith("db.example.com");
      expect(harness.recorder.events).toEqual([
        "egress:db.example.com",
        "factory",
        "connect",
        "end",
      ]);
      expect(harness.recorder.queries).toEqual(["SELECT 1"]);
      expect(harness.recorder.connectCalls).toBe(1);
      expect(harness.recorder.endCalls).toBe(1);
    });

    test("rejects when the database host is missing without connecting", async () => {
      const harness: FakeFactoryHarness = createFakeFactory({});
      const egressSpy: jest.SpyInstance = mockEgressAllowed();
      const connector: PostgresConnector = new PostgresConnector(
        harness.factory,
      );

      await expect(
        connector.testConnection(buildSettings({ databaseHost: undefined })),
      ).rejects.toThrow("Database host is required");

      expect(egressSpy).not.toHaveBeenCalled();
      expect(harness.recorder.configs.length).toBe(0);
    });

    test("propagates an egress guard rejection without connecting", async () => {
      const harness: FakeFactoryHarness = createFakeFactory({});
      jest
        .spyOn(DataSourceEgressGuard, "assertHostnameAllowed")
        .mockRejectedValue(
          new Error(
            "Data source host db.example.com is not allowed: private network address.",
          ),
        );
      const connector: PostgresConnector = new PostgresConnector(
        harness.factory,
      );

      await expect(connector.testConnection(buildSettings())).rejects.toThrow(
        "not allowed: private network address",
      );

      expect(harness.recorder.configs.length).toBe(0);
    });

    test("sanitizes credentials out of connect errors and still closes", async () => {
      const harness: FakeFactoryHarness = createFakeFactory({
        connectError: new Error(
          `password authentication failed: gave ${SECRET_PASSWORD} to db.example.com for readonly_user`,
        ),
      });
      mockEgressAllowed();
      const connector: PostgresConnector = new PostgresConnector(
        harness.factory,
      );

      let thrownMessage: string = "";
      try {
        await connector.testConnection(buildSettings());
      } catch (error) {
        thrownMessage = (error as Error).message;
      }

      expect(thrownMessage).not.toBe("");
      expect(thrownMessage).not.toContain(SECRET_PASSWORD);
      expect(thrownMessage).not.toContain("db.example.com");
      expect(thrownMessage).not.toContain("readonly_user");
      expect(thrownMessage).toContain("***");
      expect(harness.recorder.endCalls).toBe(1);
    });
  });

  describe("driver configuration", () => {
    test("plumbs settings and limits into the pg client config", async () => {
      const harness: FakeFactoryHarness = createFakeFactory({});
      mockEgressAllowed();
      const connector: PostgresConnector = new PostgresConnector(
        harness.factory,
      );

      await connector.testConnection(buildSettings());

      const config: ClientConfig = harness.recorder.configs[0]!;
      expect(config.host).toBe("db.example.com");
      expect(config.port).toBe(5433);
      expect(config.database).toBe("metrics");
      expect(config.user).toBe("readonly_user");
      expect(config.password).toBe(SECRET_PASSWORD);
      expect(config.connectionTimeoutMillis).toBe(
        DATA_SOURCE_CONNECT_TIMEOUT_IN_MS,
      );
      expect(config.statement_timeout).toBe(DATA_SOURCE_QUERY_TIMEOUT_IN_MS);
      expect(config.query_timeout).toBe(DATA_SOURCE_QUERY_TIMEOUT_IN_MS + 2000);
      expect(config.application_name).toBe("OneUptime-DataSource");
      expect(config.ssl).toBe(false);
    });

    test("defaults port to 5432 and database to postgres", async () => {
      const harness: FakeFactoryHarness = createFakeFactory({});
      mockEgressAllowed();
      const connector: PostgresConnector = new PostgresConnector(
        harness.factory,
      );

      await connector.testConnection(
        buildSettings({ databasePort: undefined, databaseName: undefined }),
      );

      const config: ClientConfig = harness.recorder.configs[0]!;
      expect(config.port).toBe(5432);
      expect(config.database).toBe("postgres");
    });

    test("enables TLS with certificate verification by default", async () => {
      const harness: FakeFactoryHarness = createFakeFactory({});
      mockEgressAllowed();
      const connector: PostgresConnector = new PostgresConnector(
        harness.factory,
      );

      await connector.testConnection(
        buildSettings({ additionalOptions: { sslEnabled: true } }),
      );

      const config: ClientConfig = harness.recorder.configs[0]!;
      expect(config.ssl).toEqual({ rejectUnauthorized: true });
    });

    test("allows disabling certificate verification explicitly", async () => {
      const harness: FakeFactoryHarness = createFakeFactory({});
      mockEgressAllowed();
      const connector: PostgresConnector = new PostgresConnector(
        harness.factory,
      );

      await connector.testConnection(
        buildSettings({
          additionalOptions: {
            sslEnabled: true,
            sslRejectUnauthorized: false,
          },
        }),
      );

      const config: ClientConfig = harness.recorder.configs[0]!;
      expect(config.ssl).toEqual({ rejectUnauthorized: false });
    });
  });

  describe("queryTimeSeries", () => {
    test("runs the read-only cursor protocol in order and releases", async () => {
      const harness: FakeFactoryHarness = createFakeFactory({
        fetchRows: [],
      });
      jest
        .spyOn(DataSourceEgressGuard, "assertHostnameAllowed")
        .mockImplementation(
          (hostname: string): Promise<Array<ResolvedAddress>> => {
            harness.recorder.events.push(`egress:${hostname}`);
            return Promise.resolve([{ address: "203.0.113.10", family: 4 }]);
          },
        );
      const connector: PostgresConnector = new PostgresConnector(
        harness.factory,
      );

      await connector.queryTimeSeries(
        buildSettings(),
        "SELECT time, value FROM metrics_view",
        queryWindow,
      );

      expect(harness.recorder.queries).toEqual([
        "START TRANSACTION READ ONLY",
        `SET LOCAL statement_timeout = ${DATA_SOURCE_QUERY_TIMEOUT_IN_MS}`,
        `DECLARE ${CURSOR_NAME} NO SCROLL CURSOR FOR SELECT time, value FROM metrics_view`,
        `FETCH FORWARD ${
          DATA_SOURCE_MAX_TIME_SERIES_ROWS + 1
        } FROM ${CURSOR_NAME}`,
        "ROLLBACK",
      ]);
      expect(harness.recorder.events[0]).toBe("egress:db.example.com");
      expect(harness.recorder.events[1]).toBe("factory");
      expect(harness.recorder.endCalls).toBe(1);
    });

    test("substitutes time macros and strips the trailing semicolon", async () => {
      const harness: FakeFactoryHarness = createFakeFactory({
        fetchRows: [],
      });
      mockEgressAllowed();
      const connector: PostgresConnector = new PostgresConnector(
        harness.factory,
      );

      await connector.queryTimeSeries(
        buildSettings(),
        "SELECT created_at AS time, count(*) AS value FROM orders WHERE created_at BETWEEN $__startTime AND $__endTime GROUP BY 1;",
        queryWindow,
      );

      const declareStatement: string = harness.recorder.queries.find(
        (statement: string) => {
          return statement.startsWith("DECLARE");
        },
      )!;
      expect(declareStatement).toContain("'2026-01-01 00:00:00'");
      expect(declareStatement).toContain("'2026-01-02 00:00:00'");
      expect(declareStatement).not.toContain("$__startTime");
      expect(declareStatement).not.toContain("$__endTime");
      expect(declareStatement.endsWith(";")).toBe(false);
    });

    test("substitutes millisecond and range-seconds macros", async () => {
      const harness: FakeFactoryHarness = createFakeFactory({
        fetchRows: [],
      });
      mockEgressAllowed();
      const connector: PostgresConnector = new PostgresConnector(
        harness.factory,
      );

      await connector.queryTimeSeries(
        buildSettings(),
        "SELECT ts AS time, value FROM m WHERE ts_ms >= $__startTimeMs AND ts_ms <= $__endTimeMs AND $__rangeSeconds > 0",
        queryWindow,
      );

      const declareStatement: string = harness.recorder.queries.find(
        (statement: string) => {
          return statement.startsWith("DECLARE");
        },
      )!;
      expect(declareStatement).toContain(
        `${WINDOW_START_EPOCH_SECONDS * 1000}`,
      );
      expect(declareStatement).toContain(
        `${(WINDOW_START_EPOCH_SECONDS + 86400) * 1000}`,
      );
      expect(declareStatement).toContain("86400 > 0");
    });

    test("shapes an unlabeled result into a single series without attributes", async () => {
      const harness: FakeFactoryHarness = createFakeFactory({
        fetchRows: [
          { time: new Date("2026-01-01T00:00:00.000Z"), value: 10 },
          { time: new Date("2026-01-01T00:01:00.000Z"), value: 12.5 },
        ],
      });
      mockEgressAllowed();
      const connector: PostgresConnector = new PostgresConnector(
        harness.factory,
      );

      const result: AggregatedResult = await connector.queryTimeSeries(
        buildSettings(),
        "SELECT time, value FROM metrics_view",
        queryWindow,
      );

      expect(result.data.length).toBe(2);
      expect(result.truncated).toBe(false);
      expect(result.data[0]!.timestamp).toEqual(
        new Date("2026-01-01T00:00:00.000Z"),
      );
      expect(result.data[0]!.value).toBe(10);
      expect(result.data[1]!.value).toBe(12.5);
      expect(result.data[0]!["attributes"]).toBeUndefined();
    });

    test("puts extra columns under attributes so charts can group series", async () => {
      const harness: FakeFactoryHarness = createFakeFactory({
        fetchRows: [
          {
            time: WINDOW_START_EPOCH_SECONDS,
            value: 1,
            region: "us-east",
          },
          {
            time: WINDOW_START_EPOCH_SECONDS,
            value: 2,
            region: "eu-west",
          },
          { time: WINDOW_START_EPOCH_SECONDS + 60, value: 3, region: null },
        ],
      });
      mockEgressAllowed();
      const connector: PostgresConnector = new PostgresConnector(
        harness.factory,
      );

      const result: AggregatedResult = await connector.queryTimeSeries(
        buildSettings(),
        "SELECT time, value, region FROM metrics_view",
        queryWindow,
      );

      expect(result.data.length).toBe(3);
      expect(result.data[0]!["attributes"]).toEqual({ region: "us-east" });
      expect(result.data[1]!["attributes"]).toEqual({ region: "eu-west" });
      expect(result.data[2]!["attributes"]).toEqual({ region: "(unset)" });
    });

    test("coerces epoch seconds, epoch millis and naive UTC strings", async () => {
      const harness: FakeFactoryHarness = createFakeFactory({
        fetchRows: [
          { time: WINDOW_START_EPOCH_SECONDS, value: 1 },
          { time: WINDOW_START_EPOCH_SECONDS * 1000 + 60000, value: 2 },
          { time: "2026-01-01 06:30:00", value: 3 },
          { time: "2026-01-01T07:45:00.000Z", value: 4 },
        ],
      });
      mockEgressAllowed();
      const connector: PostgresConnector = new PostgresConnector(
        harness.factory,
      );

      const result: AggregatedResult = await connector.queryTimeSeries(
        buildSettings(),
        "SELECT time, value FROM metrics_view",
        queryWindow,
      );

      expect(result.data.length).toBe(4);
      expect(result.data[0]!.timestamp).toEqual(
        new Date(WINDOW_START_EPOCH_SECONDS * 1000),
      );
      expect(result.data[1]!.timestamp).toEqual(
        new Date(WINDOW_START_EPOCH_SECONDS * 1000 + 60000),
      );
      expect(result.data[2]!.timestamp).toEqual(
        new Date(Date.UTC(2026, 0, 1, 6, 30, 0)),
      );
      expect(result.data[3]!.timestamp).toEqual(
        new Date("2026-01-01T07:45:00.000Z"),
      );
    });

    test("returns an empty result for zero rows", async () => {
      const harness: FakeFactoryHarness = createFakeFactory({
        fetchRows: [],
      });
      mockEgressAllowed();
      const connector: PostgresConnector = new PostgresConnector(
        harness.factory,
      );

      const result: AggregatedResult = await connector.queryTimeSeries(
        buildSettings(),
        "SELECT time, value FROM metrics_view",
        queryWindow,
      );

      expect(result).toEqual({ data: [], truncated: false });
    });

    test("rejects rows without a recognizable time column", async () => {
      const harness: FakeFactoryHarness = createFakeFactory({
        fetchRows: [{ when_it_happened: "yesterday", value: 1 }],
      });
      mockEgressAllowed();
      const connector: PostgresConnector = new PostgresConnector(
        harness.factory,
      );

      await expect(
        connector.queryTimeSeries(
          buildSettings(),
          "SELECT when_it_happened, value FROM metrics_view",
          queryWindow,
        ),
      ).rejects.toThrow("time column");

      // The connection was still released before shaping failed.
      expect(harness.recorder.queries).toContain("ROLLBACK");
      expect(harness.recorder.endCalls).toBe(1);
    });

    test("rejects rows without a numeric value column", async () => {
      const harness: FakeFactoryHarness = createFakeFactory({
        fetchRows: [{ time: WINDOW_START_EPOCH_SECONDS, label: "a" }],
      });
      mockEgressAllowed();
      const connector: PostgresConnector = new PostgresConnector(
        harness.factory,
      );

      await expect(
        connector.queryTimeSeries(
          buildSettings(),
          "SELECT time, label FROM metrics_view",
          queryWindow,
        ),
      ).rejects.toThrow("numeric column");
    });

    test("clamps to the time-series row cap and flags truncation", async () => {
      const rows: Array<Record<string, unknown>> = [];
      for (
        let rowIndex: number = 0;
        rowIndex < DATA_SOURCE_MAX_TIME_SERIES_ROWS + 1;
        rowIndex++
      ) {
        rows.push({
          time: WINDOW_START_EPOCH_SECONDS * 1000 + rowIndex * 1000,
          value: rowIndex,
        });
      }
      const harness: FakeFactoryHarness = createFakeFactory({
        fetchRows: rows,
      });
      mockEgressAllowed();
      const connector: PostgresConnector = new PostgresConnector(
        harness.factory,
      );

      const result: AggregatedResult = await connector.queryTimeSeries(
        buildSettings(),
        "SELECT time, value FROM metrics_view",
        queryWindow,
      );

      expect(result.data.length).toBe(DATA_SOURCE_MAX_TIME_SERIES_ROWS);
      expect(result.truncated).toBe(true);
    });

    test("rejects write queries before any connection is attempted", async () => {
      const harness: FakeFactoryHarness = createFakeFactory({});
      mockEgressAllowed();
      const connector: PostgresConnector = new PostgresConnector(
        harness.factory,
      );

      await expect(
        connector.queryTimeSeries(
          buildSettings(),
          "DELETE FROM users",
          queryWindow,
        ),
      ).rejects.toThrow("Only read-only queries are allowed");

      expect(harness.recorder.configs.length).toBe(0);
      expect(harness.recorder.queries).toEqual([]);
    });

    test("rejects multi-statement queries before connecting", async () => {
      const harness: FakeFactoryHarness = createFakeFactory({});
      mockEgressAllowed();
      const connector: PostgresConnector = new PostgresConnector(
        harness.factory,
      );

      await expect(
        connector.queryTimeSeries(
          buildSettings(),
          "SELECT 1; SELECT 2",
          queryWindow,
        ),
      ).rejects.toThrow("single SQL statement");

      expect(harness.recorder.configs.length).toBe(0);
    });

    test("rejects smuggled DML hidden behind a SELECT head", async () => {
      const harness: FakeFactoryHarness = createFakeFactory({});
      mockEgressAllowed();
      const connector: PostgresConnector = new PostgresConnector(
        harness.factory,
      );

      await expect(
        connector.queryTimeSeries(
          buildSettings(),
          "SELECT * INTO new_table FROM users",
          queryWindow,
        ),
      ).rejects.toThrow("INTO");

      expect(harness.recorder.configs.length).toBe(0);
    });

    test("sanitizes driver errors and still rolls back and closes", async () => {
      const harness: FakeFactoryHarness = createFakeFactory({
        queryErrorPrefix: "DECLARE",
        queryError: new Error(
          `relation does not exist on db.example.com (password ${SECRET_PASSWORD})`,
        ),
      });
      mockEgressAllowed();
      const connector: PostgresConnector = new PostgresConnector(
        harness.factory,
      );

      let thrownMessage: string = "";
      try {
        await connector.queryTimeSeries(
          buildSettings(),
          "SELECT time, value FROM missing_view",
          queryWindow,
        );
      } catch (error) {
        thrownMessage = (error as Error).message;
      }

      expect(thrownMessage).toContain("relation does not exist");
      expect(thrownMessage).not.toContain(SECRET_PASSWORD);
      expect(thrownMessage).not.toContain("db.example.com");
      expect(thrownMessage).toContain("***");
      expect(harness.recorder.queries).toContain("ROLLBACK");
      expect(harness.recorder.endCalls).toBe(1);
    });

    test("closes the client even when connect itself fails", async () => {
      const harness: FakeFactoryHarness = createFakeFactory({
        connectError: new Error("connect ETIMEDOUT"),
      });
      mockEgressAllowed();
      const connector: PostgresConnector = new PostgresConnector(
        harness.factory,
      );

      await expect(
        connector.queryTimeSeries(
          buildSettings(),
          "SELECT time, value FROM metrics_view",
          queryWindow,
        ),
      ).rejects.toThrow("ETIMEDOUT");

      expect(harness.recorder.endCalls).toBe(1);
    });
  });

  describe("queryTable", () => {
    test("fetches with the table row cap plus one", async () => {
      const harness: FakeFactoryHarness = createFakeFactory({
        fetchRows: [],
      });
      mockEgressAllowed();
      const connector: PostgresConnector = new PostgresConnector(
        harness.factory,
      );

      await connector.queryTable(
        buildSettings(),
        "SELECT id, name FROM services",
        queryWindow,
      );

      expect(harness.recorder.queries).toContain(
        `FETCH FORWARD ${DATA_SOURCE_MAX_TABLE_ROWS + 1} FROM ${CURSOR_NAME}`,
      );
    });

    test("shapes rows into typed columns with coerced cells", async () => {
      const harness: FakeFactoryHarness = createFakeFactory({
        fetchRows: [
          {
            name: "checkout",
            count: 42,
            healthy: true,
            seen_at: new Date("2026-01-01T00:00:00.000Z"),
            note: null,
          },
          {
            name: "search",
            count: 7,
            healthy: false,
            seen_at: new Date("2026-01-02T00:00:00.000Z"),
            extra: "only-here",
          },
        ],
      });
      mockEgressAllowed();
      const connector: PostgresConnector = new PostgresConnector(
        harness.factory,
      );

      const result: DataSourceTableResult = await connector.queryTable(
        buildSettings(),
        "SELECT name, count, healthy, seen_at, note FROM services",
        queryWindow,
      );

      const columnByKey: (key: string) => DataSourceTableColumn = (
        key: string,
      ): DataSourceTableColumn => {
        return result.columns.find((column: DataSourceTableColumn) => {
          return column.key === key;
        })!;
      };

      expect(columnByKey("name").type).toBe(DataSourceTableColumnType.Text);
      expect(columnByKey("count").type).toBe(DataSourceTableColumnType.Number);
      expect(columnByKey("healthy").type).toBe(
        DataSourceTableColumnType.Boolean,
      );
      expect(columnByKey("seen_at").type).toBe(DataSourceTableColumnType.Date);
      // Column union across rows: `extra` only exists on the second row.
      expect(columnByKey("extra").type).toBe(DataSourceTableColumnType.Text);

      expect(result.rows.length).toBe(2);
      expect(result.rows[0]!["seen_at"]).toBe("2026-01-01T00:00:00.000Z");
      expect(result.rows[0]!["extra"]).toBeNull();
      expect(result.rows[1]!["extra"]).toBe("only-here");
      expect(result.truncated).toBe(false);
    });

    test("clamps to the table row cap and flags truncation", async () => {
      const rows: Array<Record<string, unknown>> = [];
      for (
        let rowIndex: number = 0;
        rowIndex < DATA_SOURCE_MAX_TABLE_ROWS + 1;
        rowIndex++
      ) {
        rows.push({ id: rowIndex, name: `row-${rowIndex}` });
      }
      const harness: FakeFactoryHarness = createFakeFactory({
        fetchRows: rows,
      });
      mockEgressAllowed();
      const connector: PostgresConnector = new PostgresConnector(
        harness.factory,
      );

      const result: DataSourceTableResult = await connector.queryTable(
        buildSettings(),
        "SELECT id, name FROM services",
        queryWindow,
      );

      expect(result.rows.length).toBe(DATA_SOURCE_MAX_TABLE_ROWS);
      expect(result.truncated).toBe(true);
    });

    test("returns an empty table for zero rows", async () => {
      const harness: FakeFactoryHarness = createFakeFactory({
        fetchRows: [],
      });
      mockEgressAllowed();
      const connector: PostgresConnector = new PostgresConnector(
        harness.factory,
      );

      const result: DataSourceTableResult = await connector.queryTable(
        buildSettings(),
        "SELECT id, name FROM services",
        queryWindow,
      );

      expect(result).toEqual({ columns: [], rows: [], truncated: false });
    });

    test("rejects write queries before any connection is attempted", async () => {
      const harness: FakeFactoryHarness = createFakeFactory({});
      mockEgressAllowed();
      const connector: PostgresConnector = new PostgresConnector(
        harness.factory,
      );

      await expect(
        connector.queryTable(
          buildSettings(),
          "INSERT INTO services (name) VALUES ('x')",
          queryWindow,
        ),
      ).rejects.toThrow("Only read-only queries are allowed");

      expect(harness.recorder.configs.length).toBe(0);
    });

    test("validates egress before connecting for table queries", async () => {
      const harness: FakeFactoryHarness = createFakeFactory({});
      jest
        .spyOn(DataSourceEgressGuard, "assertHostnameAllowed")
        .mockRejectedValue(
          new Error(
            "Data source host db.example.com resolves to 169.254.169.254, which is not allowed: link-local address (cloud metadata range).",
          ),
        );
      const connector: PostgresConnector = new PostgresConnector(
        harness.factory,
      );

      await expect(
        connector.queryTable(
          buildSettings(),
          "SELECT id FROM services",
          queryWindow,
        ),
      ).rejects.toThrow("link-local address");

      expect(harness.recorder.configs.length).toBe(0);
    });
  });
});
