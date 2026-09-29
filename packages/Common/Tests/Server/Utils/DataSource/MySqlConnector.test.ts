import { afterEach, describe, expect, test } from "@jest/globals";
import { ConnectionOptions } from "mysql2/promise";
import MySqlConnector, {
  MySqlConnectionFactory,
  MySqlConnectionLike,
} from "../../../../Server/Utils/DataSource/Connectors/MySqlConnector";
import DataSourceEgressGuard from "../../../../Server/Utils/DataSource/EgressGuard";
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

/*
 * Fake mysql2 connection harness. Records every SQL string in order,
 * counts end()/destroy() calls, and lets individual statements be scripted
 * to fail so teardown paths can be exercised.
 */
interface FakeConnectionScript {
  /* Result tuple element [0] returned for every query (default []). */
  result?: unknown;
  /* Return an Error for a given SQL string to make that statement reject. */
  failOn?: (sql: string) => Error | null;
  endError?: Error;
  destroyError?: Error;
}

interface FakeConnectionHarness {
  connection: MySqlConnectionLike;
  executedQueries: Array<string>;
  state: { endCalls: number; destroyCalls: number };
}

type CreateFakeConnectionFunction = (
  script?: FakeConnectionScript,
) => FakeConnectionHarness;

const createFakeConnection: CreateFakeConnectionFunction = (
  script?: FakeConnectionScript,
): FakeConnectionHarness => {
  const executedQueries: Array<string> = [];
  const state: { endCalls: number; destroyCalls: number } = {
    endCalls: 0,
    destroyCalls: 0,
  };

  const connection: MySqlConnectionLike = {
    query: (sql: string): Promise<[unknown, unknown]> => {
      executedQueries.push(sql);
      const error: Error | null = script?.failOn ? script.failOn(sql) : null;
      if (error) {
        return Promise.reject(error);
      }
      return Promise.resolve([script?.result ?? [], []] as [unknown, unknown]);
    },
    end: (): Promise<void> => {
      state.endCalls += 1;
      if (script?.endError) {
        return Promise.reject(script.endError);
      }
      return Promise.resolve();
    },
    destroy: (): void => {
      state.destroyCalls += 1;
      if (script?.destroyError) {
        throw script.destroyError;
      }
    },
  };

  return {
    connection: connection,
    executedQueries: executedQueries,
    state: state,
  };
};

interface FakeFactoryHarness {
  factory: MySqlConnectionFactory;
  calls: Array<ConnectionOptions>;
}

type CreateFactoryFunction = (
  harness: FakeConnectionHarness,
  events?: Array<string>,
) => FakeFactoryHarness;

const createFactory: CreateFactoryFunction = (
  harness: FakeConnectionHarness,
  events?: Array<string>,
): FakeFactoryHarness => {
  const calls: Array<ConnectionOptions> = [];
  const factory: MySqlConnectionFactory = (
    options: ConnectionOptions,
  ): Promise<MySqlConnectionLike> => {
    calls.push(options);
    if (events) {
      events.push("connect");
    }
    return Promise.resolve(harness.connection);
  };
  return { factory: factory, calls: calls };
};

const PASSWORD: string = "sup3r-s3cret-pw";

type BuildSettingsFunction = (
  overrides?: Partial<DataSourceConnectionSettings>,
) => DataSourceConnectionSettings;

const buildSettings: BuildSettingsFunction = (
  overrides?: Partial<DataSourceConnectionSettings>,
): DataSourceConnectionSettings => {
  return {
    dataSourceType: DataSourceType.MySQL,
    databaseHost: "db.example.com",
    databasePort: 3307,
    databaseName: "metrics",
    username: "reader",
    password: PASSWORD,
    ...overrides,
  };
};

const WINDOW: DataSourceQueryWindow = {
  startDate: new Date("2025-01-01T00:00:00.000Z"),
  endDate: new Date("2025-01-02T00:00:00.000Z"),
};

type MockEgressAllowedFunction = (events?: Array<string>) => jest.SpyInstance;

const mockEgressAllowed: MockEgressAllowedFunction = (
  events?: Array<string>,
): jest.SpyInstance => {
  const spy: jest.SpyInstance = jest.spyOn(
    DataSourceEgressGuard,
    "assertHostnameAllowed",
  );
  spy.mockImplementation(() => {
    if (events) {
      events.push("egress");
    }
    return Promise.resolve([{ address: "203.0.113.10", family: 4 }]);
  });
  return spy;
};

afterEach(() => {
  jest.restoreAllMocks();
});

describe("MySqlConnector", () => {
  describe("testConnection", () => {
    test("connects, runs SELECT 1 and closes the connection", async () => {
      const egressSpy: jest.SpyInstance = mockEgressAllowed();
      const harness: FakeConnectionHarness = createFakeConnection();
      const factoryHarness: FakeFactoryHarness = createFactory(harness);
      const connector: MySqlConnector = new MySqlConnector(
        factoryHarness.factory,
      );

      await connector.testConnection(buildSettings());

      expect(egressSpy).toHaveBeenCalledWith("db.example.com");
      expect(harness.executedQueries).toEqual(["SELECT 1", "ROLLBACK"]);
      expect(harness.state.endCalls).toBe(1);
      expect(harness.state.destroyCalls).toBe(0);
    });

    test("validates egress before opening a connection", async () => {
      const events: Array<string> = [];
      mockEgressAllowed(events);
      const harness: FakeConnectionHarness = createFakeConnection();
      const factoryHarness: FakeFactoryHarness = createFactory(harness, events);
      const connector: MySqlConnector = new MySqlConnector(
        factoryHarness.factory,
      );

      await connector.testConnection(buildSettings());

      expect(events).toEqual(["egress", "connect"]);
    });

    test("throws without connecting when databaseHost is missing", async () => {
      const egressSpy: jest.SpyInstance = mockEgressAllowed();
      const harness: FakeConnectionHarness = createFakeConnection();
      const factoryHarness: FakeFactoryHarness = createFactory(harness);
      const connector: MySqlConnector = new MySqlConnector(
        factoryHarness.factory,
      );

      await expect(
        connector.testConnection(buildSettings({ databaseHost: undefined })),
      ).rejects.toThrow(BadDataException);

      expect(egressSpy).not.toHaveBeenCalled();
      expect(factoryHarness.calls).toHaveLength(0);
    });

    test("propagates an egress guard rejection without connecting", async () => {
      const egressSpy: jest.SpyInstance = jest.spyOn(
        DataSourceEgressGuard,
        "assertHostnameAllowed",
      );
      egressSpy.mockRejectedValue(
        new BadDataException(
          "Data source host 169.254.169.254 is not allowed: link-local address (cloud metadata range).",
        ),
      );
      const harness: FakeConnectionHarness = createFakeConnection();
      const factoryHarness: FakeFactoryHarness = createFactory(harness);
      const connector: MySqlConnector = new MySqlConnector(
        factoryHarness.factory,
      );

      await expect(connector.testConnection(buildSettings())).rejects.toThrow(
        "not allowed",
      );

      expect(factoryHarness.calls).toHaveLength(0);
      expect(harness.executedQueries).toHaveLength(0);
    });

    test("sanitizes connection failures so secrets never leak", async () => {
      mockEgressAllowed();
      const factory: MySqlConnectionFactory =
        (): Promise<MySqlConnectionLike> => {
          return Promise.reject(
            new Error(
              `Access denied for user 'reader'@'10.0.0.5' (using password: ${PASSWORD})`,
            ),
          );
        };
      const connector: MySqlConnector = new MySqlConnector(factory);

      let thrown: Error | null = null;
      try {
        await connector.testConnection(buildSettings());
      } catch (error) {
        thrown = error as Error;
      }

      expect(thrown).toBeInstanceOf(BadDataException);
      expect(thrown!.message).not.toContain(PASSWORD);
      expect(thrown!.message).toContain("***");
    });

    test("sanitizes SELECT 1 failures and still closes the connection", async () => {
      mockEgressAllowed();
      const harness: FakeConnectionHarness = createFakeConnection({
        failOn: (sql: string): Error | null => {
          if (sql === "SELECT 1") {
            return new Error(`server exploded for reader:${PASSWORD}`);
          }
          return null;
        },
      });
      const factoryHarness: FakeFactoryHarness = createFactory(harness);
      const connector: MySqlConnector = new MySqlConnector(
        factoryHarness.factory,
      );

      let thrown: Error | null = null;
      try {
        await connector.testConnection(buildSettings());
      } catch (error) {
        thrown = error as Error;
      }

      expect(thrown).toBeInstanceOf(BadDataException);
      expect(thrown!.message).not.toContain(PASSWORD);
      expect(harness.state.endCalls).toBe(1);
    });
  });

  describe("connection options", () => {
    test("passes host, port, credentials, timeout and multipleStatements:false to the driver", async () => {
      mockEgressAllowed();
      const harness: FakeConnectionHarness = createFakeConnection();
      const factoryHarness: FakeFactoryHarness = createFactory(harness);
      const connector: MySqlConnector = new MySqlConnector(
        factoryHarness.factory,
      );

      await connector.testConnection(buildSettings());

      expect(factoryHarness.calls).toHaveLength(1);
      const options: ConnectionOptions = factoryHarness.calls[0]!;
      expect(options.host).toBe("db.example.com");
      expect(options.port).toBe(3307);
      expect(options.database).toBe("metrics");
      expect(options.user).toBe("reader");
      expect(options.password).toBe(PASSWORD);
      expect(options.connectTimeout).toBe(DATA_SOURCE_CONNECT_TIMEOUT_IN_MS);
      expect(options.multipleStatements).toBe(false);
      expect(options.ssl).toBeUndefined();
    });

    test("defaults the port to 3306 when none is configured", async () => {
      mockEgressAllowed();
      const harness: FakeConnectionHarness = createFakeConnection();
      const factoryHarness: FakeFactoryHarness = createFactory(harness);
      const connector: MySqlConnector = new MySqlConnector(
        factoryHarness.factory,
      );

      await connector.testConnection(
        buildSettings({ databasePort: undefined }),
      );

      expect(factoryHarness.calls[0]!.port).toBe(3306);
    });

    test("enables TLS with certificate verification on by default", async () => {
      mockEgressAllowed();
      const harness: FakeConnectionHarness = createFakeConnection();
      const factoryHarness: FakeFactoryHarness = createFactory(harness);
      const connector: MySqlConnector = new MySqlConnector(
        factoryHarness.factory,
      );

      await connector.testConnection(
        buildSettings({ additionalOptions: { sslEnabled: true } }),
      );

      expect(factoryHarness.calls[0]!.ssl).toEqual({
        rejectUnauthorized: true,
      });
    });

    test("disables certificate verification only on explicit opt-out", async () => {
      mockEgressAllowed();
      const harness: FakeConnectionHarness = createFakeConnection();
      const factoryHarness: FakeFactoryHarness = createFactory(harness);
      const connector: MySqlConnector = new MySqlConnector(
        factoryHarness.factory,
      );

      await connector.testConnection(
        buildSettings({
          additionalOptions: {
            sslEnabled: true,
            sslRejectUnauthorized: false,
          },
        }),
      );

      expect(factoryHarness.calls[0]!.ssl).toEqual({
        rejectUnauthorized: false,
      });
    });
  });

  describe("queryTimeSeries", () => {
    test("runs the session setup, read-only transaction and query in order", async () => {
      mockEgressAllowed();
      const harness: FakeConnectionHarness = createFakeConnection({
        result: [{ time: new Date("2025-01-01T10:00:00.000Z"), value: 5 }],
      });
      const factoryHarness: FakeFactoryHarness = createFactory(harness);
      const connector: MySqlConnector = new MySqlConnector(
        factoryHarness.factory,
      );

      await connector.queryTimeSeries(
        buildSettings(),
        "SELECT created_at AS time, COUNT(*) AS value FROM orders GROUP BY 1",
        WINDOW,
      );

      expect(harness.executedQueries).toEqual([
        `SET SESSION MAX_EXECUTION_TIME = ${DATA_SOURCE_QUERY_TIMEOUT_IN_MS}`,
        `SET SESSION SQL_SELECT_LIMIT = ${DATA_SOURCE_MAX_TIME_SERIES_ROWS + 1}`,
        "START TRANSACTION READ ONLY",
        "SELECT created_at AS time, COUNT(*) AS value FROM orders GROUP BY 1",
        "ROLLBACK",
      ]);
      expect(harness.state.endCalls).toBe(1);
      expect(harness.state.destroyCalls).toBe(0);
    });

    test("validates egress before connecting for queries", async () => {
      const events: Array<string> = [];
      mockEgressAllowed(events);
      const harness: FakeConnectionHarness = createFakeConnection({
        result: [{ time: new Date("2025-01-01T10:00:00.000Z"), value: 1 }],
      });
      const factoryHarness: FakeFactoryHarness = createFactory(harness, events);
      const connector: MySqlConnector = new MySqlConnector(
        factoryHarness.factory,
      );

      await connector.queryTimeSeries(
        buildSettings(),
        "SELECT 1 AS time, 2 AS value",
        WINDOW,
      );

      expect(events).toEqual(["egress", "connect"]);
    });

    test("applies time macros and strips a trailing semicolon before executing", async () => {
      mockEgressAllowed();
      const harness: FakeConnectionHarness = createFakeConnection({
        result: [],
      });
      const factoryHarness: FakeFactoryHarness = createFactory(harness);
      const connector: MySqlConnector = new MySqlConnector(
        factoryHarness.factory,
      );

      await connector.queryTimeSeries(
        buildSettings(),
        "SELECT t AS time, v AS value FROM m WHERE t BETWEEN $__startTime AND $__endTime AND r = $__rangeSeconds ;",
        WINDOW,
      );

      const executedUserQuery: string = harness.executedQueries[3]!;
      expect(executedUserQuery).toBe(
        "SELECT t AS time, v AS value FROM m WHERE t BETWEEN '2025-01-01 00:00:00' AND '2025-01-02 00:00:00' AND r = 86400 ",
      );
    });

    test("rejects write queries before any connection is opened", async () => {
      const egressSpy: jest.SpyInstance = mockEgressAllowed();
      const harness: FakeConnectionHarness = createFakeConnection();
      const factoryHarness: FakeFactoryHarness = createFactory(harness);
      const connector: MySqlConnector = new MySqlConnector(
        factoryHarness.factory,
      );

      await expect(
        connector.queryTimeSeries(
          buildSettings(),
          "DELETE FROM orders",
          WINDOW,
        ),
      ).rejects.toThrow(BadDataException);

      expect(egressSpy).not.toHaveBeenCalled();
      expect(factoryHarness.calls).toHaveLength(0);
      expect(harness.executedQueries).toHaveLength(0);
    });

    test("rejects stacked statements before any connection is opened", async () => {
      mockEgressAllowed();
      const harness: FakeConnectionHarness = createFakeConnection();
      const factoryHarness: FakeFactoryHarness = createFactory(harness);
      const connector: MySqlConnector = new MySqlConnector(
        factoryHarness.factory,
      );

      await expect(
        connector.queryTimeSeries(
          buildSettings(),
          "SELECT 1; SELECT 2",
          WINDOW,
        ),
      ).rejects.toThrow("single SQL statement");

      expect(factoryHarness.calls).toHaveLength(0);
    });

    test("shapes rows into AggregatedResult with labels under attributes", async () => {
      mockEgressAllowed();
      const harness: FakeConnectionHarness = createFakeConnection({
        result: [
          {
            time: new Date("2025-01-01T10:00:00.000Z"),
            value: 5,
            host: "web-1",
          },
          {
            time: new Date("2025-01-01T10:01:00.000Z"),
            value: 7,
            host: "web-2",
          },
        ],
      });
      const factoryHarness: FakeFactoryHarness = createFactory(harness);
      const connector: MySqlConnector = new MySqlConnector(
        factoryHarness.factory,
      );

      const result: AggregatedResult = await connector.queryTimeSeries(
        buildSettings(),
        "SELECT t AS time, v AS value, host FROM m",
        WINDOW,
      );

      expect(result.data).toHaveLength(2);
      expect(result.truncated).toBe(false);
      expect(result.data[0]!.timestamp).toEqual(
        new Date("2025-01-01T10:00:00.000Z"),
      );
      expect(result.data[0]!.value).toBe(5);
      expect(result.data[0]!["attributes"]).toEqual({ host: "web-1" });
      expect(result.data[1]!["attributes"]).toEqual({ host: "web-2" });
    });

    test("omits attributes when the query returns only time and value", async () => {
      mockEgressAllowed();
      const harness: FakeConnectionHarness = createFakeConnection({
        result: [{ time: new Date("2025-01-01T10:00:00.000Z"), value: 5 }],
      });
      const factoryHarness: FakeFactoryHarness = createFactory(harness);
      const connector: MySqlConnector = new MySqlConnector(
        factoryHarness.factory,
      );

      const result: AggregatedResult = await connector.queryTimeSeries(
        buildSettings(),
        "SELECT t AS time, v AS value FROM m",
        WINDOW,
      );

      expect(result.data).toHaveLength(1);
      expect(result.data[0]!["attributes"]).toBeUndefined();
    });

    test("returns an empty result for zero rows", async () => {
      mockEgressAllowed();
      const harness: FakeConnectionHarness = createFakeConnection({
        result: [],
      });
      const factoryHarness: FakeFactoryHarness = createFactory(harness);
      const connector: MySqlConnector = new MySqlConnector(
        factoryHarness.factory,
      );

      const result: AggregatedResult = await connector.queryTimeSeries(
        buildSettings(),
        "SELECT t AS time, v AS value FROM m",
        WINDOW,
      );

      expect(result).toEqual({ data: [], truncated: false });
    });

    test("treats a non-array driver result as zero rows", async () => {
      mockEgressAllowed();
      const harness: FakeConnectionHarness = createFakeConnection({
        result: { affectedRows: 0 },
      });
      const factoryHarness: FakeFactoryHarness = createFactory(harness);
      const connector: MySqlConnector = new MySqlConnector(
        factoryHarness.factory,
      );

      const result: AggregatedResult = await connector.queryTimeSeries(
        buildSettings(),
        "SELECT t AS time, v AS value FROM m",
        WINDOW,
      );

      expect(result).toEqual({ data: [], truncated: false });
    });

    test("throws an actionable error when no time column is present", async () => {
      mockEgressAllowed();
      const harness: FakeConnectionHarness = createFakeConnection({
        result: [{ foo: 1, value: 2 }],
      });
      const factoryHarness: FakeFactoryHarness = createFactory(harness);
      const connector: MySqlConnector = new MySqlConnector(
        factoryHarness.factory,
      );

      await expect(
        connector.queryTimeSeries(
          buildSettings(),
          "SELECT foo, v AS value FROM m",
          WINDOW,
        ),
      ).rejects.toThrow("time column");
    });

    test("skips rows with unparseable timestamps instead of failing", async () => {
      mockEgressAllowed();
      const harness: FakeConnectionHarness = createFakeConnection({
        result: [
          { time: "not-a-date", value: 1 },
          { time: new Date("2025-01-01T10:00:00.000Z"), value: 2 },
        ],
      });
      const factoryHarness: FakeFactoryHarness = createFactory(harness);
      const connector: MySqlConnector = new MySqlConnector(
        factoryHarness.factory,
      );

      const result: AggregatedResult = await connector.queryTimeSeries(
        buildSettings(),
        "SELECT t AS time, v AS value FROM m",
        WINDOW,
      );

      expect(result.data).toHaveLength(1);
      expect(result.data[0]!.value).toBe(2);
    });

    test("clamps at the time-series cap and flags truncation", async () => {
      mockEgressAllowed();
      const rows: Array<Record<string, unknown>> = [];
      for (
        let index: number = 0;
        index < DATA_SOURCE_MAX_TIME_SERIES_ROWS + 1;
        index++
      ) {
        rows.push({
          time: new Date(WINDOW.startDate.getTime() + index * 1000),
          value: index,
        });
      }
      const harness: FakeConnectionHarness = createFakeConnection({
        result: rows,
      });
      const factoryHarness: FakeFactoryHarness = createFactory(harness);
      const connector: MySqlConnector = new MySqlConnector(
        factoryHarness.factory,
      );

      const result: AggregatedResult = await connector.queryTimeSeries(
        buildSettings(),
        "SELECT t AS time, v AS value FROM m",
        WINDOW,
      );

      expect(result.data).toHaveLength(DATA_SOURCE_MAX_TIME_SERIES_ROWS);
      expect(result.truncated).toBe(true);
    });

    test("continues when SET SESSION MAX_EXECUTION_TIME is unsupported (MariaDB)", async () => {
      mockEgressAllowed();
      const harness: FakeConnectionHarness = createFakeConnection({
        result: [{ time: new Date("2025-01-01T10:00:00.000Z"), value: 1 }],
        failOn: (sql: string): Error | null => {
          if (sql.startsWith("SET SESSION MAX_EXECUTION_TIME")) {
            return new Error("Unknown system variable 'MAX_EXECUTION_TIME'");
          }
          return null;
        },
      });
      const factoryHarness: FakeFactoryHarness = createFactory(harness);
      const connector: MySqlConnector = new MySqlConnector(
        factoryHarness.factory,
      );

      const result: AggregatedResult = await connector.queryTimeSeries(
        buildSettings(),
        "SELECT t AS time, v AS value FROM m",
        WINDOW,
      );

      expect(result.data).toHaveLength(1);
      expect(harness.executedQueries).toContain(
        `SET SESSION SQL_SELECT_LIMIT = ${DATA_SOURCE_MAX_TIME_SERIES_ROWS + 1}`,
      );
      expect(harness.executedQueries).toContain("START TRANSACTION READ ONLY");
    });

    test("wraps a failing START TRANSACTION READ ONLY and still tears down", async () => {
      mockEgressAllowed();
      const harness: FakeConnectionHarness = createFakeConnection({
        failOn: (sql: string): Error | null => {
          if (sql === "START TRANSACTION READ ONLY") {
            return new Error(`txn refused for ${PASSWORD}`);
          }
          return null;
        },
      });
      const factoryHarness: FakeFactoryHarness = createFactory(harness);
      const connector: MySqlConnector = new MySqlConnector(
        factoryHarness.factory,
      );

      let thrown: Error | null = null;
      try {
        await connector.queryTimeSeries(
          buildSettings(),
          "SELECT t AS time, v AS value FROM m",
          WINDOW,
        );
      } catch (error) {
        thrown = error as Error;
      }

      expect(thrown).toBeInstanceOf(BadDataException);
      expect(thrown!.message).not.toContain(PASSWORD);
      expect(harness.executedQueries).toContain("ROLLBACK");
      expect(harness.state.endCalls).toBe(1);
    });

    test("sanitizes user-query driver errors and rolls back", async () => {
      mockEgressAllowed();
      const harness: FakeConnectionHarness = createFakeConnection({
        failOn: (sql: string): Error | null => {
          if (sql.startsWith("SELECT t AS time")) {
            return new Error(
              `You have an error near 'reader'@'db.example.com', password ${PASSWORD}`,
            );
          }
          return null;
        },
      });
      const factoryHarness: FakeFactoryHarness = createFactory(harness);
      const connector: MySqlConnector = new MySqlConnector(
        factoryHarness.factory,
      );

      let thrown: Error | null = null;
      try {
        await connector.queryTimeSeries(
          buildSettings(),
          "SELECT t AS time, v AS value FROM m",
          WINDOW,
        );
      } catch (error) {
        thrown = error as Error;
      }

      expect(thrown).toBeInstanceOf(BadDataException);
      expect(thrown!.message).not.toContain(PASSWORD);
      expect(thrown!.message).not.toContain("db.example.com");
      expect(thrown!.message).not.toContain("reader");
      expect(harness.executedQueries).toContain("ROLLBACK");
      expect(harness.state.endCalls).toBe(1);
    });

    test("falls back to destroy() when end() fails", async () => {
      mockEgressAllowed();
      const harness: FakeConnectionHarness = createFakeConnection({
        result: [{ time: new Date("2025-01-01T10:00:00.000Z"), value: 1 }],
        endError: new Error("socket already half-closed"),
      });
      const factoryHarness: FakeFactoryHarness = createFactory(harness);
      const connector: MySqlConnector = new MySqlConnector(
        factoryHarness.factory,
      );

      const result: AggregatedResult = await connector.queryTimeSeries(
        buildSettings(),
        "SELECT t AS time, v AS value FROM m",
        WINDOW,
      );

      expect(result.data).toHaveLength(1);
      expect(harness.state.endCalls).toBe(1);
      expect(harness.state.destroyCalls).toBe(1);
    });

    test("swallows a destroy() failure after a failed end()", async () => {
      mockEgressAllowed();
      const harness: FakeConnectionHarness = createFakeConnection({
        result: [{ time: new Date("2025-01-01T10:00:00.000Z"), value: 1 }],
        endError: new Error("end failed"),
        destroyError: new Error("destroy failed"),
      });
      const factoryHarness: FakeFactoryHarness = createFactory(harness);
      const connector: MySqlConnector = new MySqlConnector(
        factoryHarness.factory,
      );

      const result: AggregatedResult = await connector.queryTimeSeries(
        buildSettings(),
        "SELECT t AS time, v AS value FROM m",
        WINDOW,
      );

      expect(result.data).toHaveLength(1);
      expect(harness.state.destroyCalls).toBe(1);
    });

    test("swallows a ROLLBACK failure and still closes the connection", async () => {
      mockEgressAllowed();
      const harness: FakeConnectionHarness = createFakeConnection({
        result: [{ time: new Date("2025-01-01T10:00:00.000Z"), value: 1 }],
        failOn: (sql: string): Error | null => {
          if (sql === "ROLLBACK") {
            return new Error("rollback failed");
          }
          return null;
        },
      });
      const factoryHarness: FakeFactoryHarness = createFactory(harness);
      const connector: MySqlConnector = new MySqlConnector(
        factoryHarness.factory,
      );

      const result: AggregatedResult = await connector.queryTimeSeries(
        buildSettings(),
        "SELECT t AS time, v AS value FROM m",
        WINDOW,
      );

      expect(result.data).toHaveLength(1);
      expect(harness.state.endCalls).toBe(1);
    });
  });

  describe("queryTable", () => {
    test("uses the table row cap (+1) in SQL_SELECT_LIMIT", async () => {
      mockEgressAllowed();
      const harness: FakeConnectionHarness = createFakeConnection({
        result: [{ id: 1, name: "a" }],
      });
      const factoryHarness: FakeFactoryHarness = createFactory(harness);
      const connector: MySqlConnector = new MySqlConnector(
        factoryHarness.factory,
      );

      await connector.queryTable(
        buildSettings(),
        "SELECT id, name FROM users",
        WINDOW,
      );

      expect(harness.executedQueries).toContain(
        `SET SESSION SQL_SELECT_LIMIT = ${DATA_SOURCE_MAX_TABLE_ROWS + 1}`,
      );
    });

    test("shapes rows into columns and JSON-safe cells", async () => {
      mockEgressAllowed();
      const harness: FakeConnectionHarness = createFakeConnection({
        result: [
          {
            id: 1,
            name: "alpha",
            created_at: new Date("2025-01-01T10:00:00.000Z"),
            active: true,
            blob: Buffer.from([1, 2, 3]),
          },
        ],
      });
      const factoryHarness: FakeFactoryHarness = createFactory(harness);
      const connector: MySqlConnector = new MySqlConnector(
        factoryHarness.factory,
      );

      const result: DataSourceTableResult = await connector.queryTable(
        buildSettings(),
        "SELECT id, name, created_at, active, blob FROM users",
        WINDOW,
      );

      expect(
        result.columns.map((column: { key: string }) => {
          return column.key;
        }),
      ).toEqual(["id", "name", "created_at", "active", "blob"]);
      expect(result.rows).toEqual([
        {
          id: 1,
          name: "alpha",
          created_at: "2025-01-01T10:00:00.000Z",
          active: true,
          blob: "[binary]",
        },
      ]);
      expect(result.truncated).toBe(false);
    });

    test("returns an empty table for zero rows", async () => {
      mockEgressAllowed();
      const harness: FakeConnectionHarness = createFakeConnection({
        result: [],
      });
      const factoryHarness: FakeFactoryHarness = createFactory(harness);
      const connector: MySqlConnector = new MySqlConnector(
        factoryHarness.factory,
      );

      const result: DataSourceTableResult = await connector.queryTable(
        buildSettings(),
        "SELECT id FROM users",
        WINDOW,
      );

      expect(result).toEqual({ columns: [], rows: [], truncated: false });
    });

    test("clamps at the table cap and flags truncation", async () => {
      mockEgressAllowed();
      const rows: Array<Record<string, unknown>> = [];
      for (
        let index: number = 0;
        index < DATA_SOURCE_MAX_TABLE_ROWS + 1;
        index++
      ) {
        rows.push({ id: index });
      }
      const harness: FakeConnectionHarness = createFakeConnection({
        result: rows,
      });
      const factoryHarness: FakeFactoryHarness = createFactory(harness);
      const connector: MySqlConnector = new MySqlConnector(
        factoryHarness.factory,
      );

      const result: DataSourceTableResult = await connector.queryTable(
        buildSettings(),
        "SELECT id FROM users",
        WINDOW,
      );

      expect(result.rows).toHaveLength(DATA_SOURCE_MAX_TABLE_ROWS);
      expect(result.truncated).toBe(true);
    });

    test("rejects write queries without connecting", async () => {
      mockEgressAllowed();
      const harness: FakeConnectionHarness = createFakeConnection();
      const factoryHarness: FakeFactoryHarness = createFactory(harness);
      const connector: MySqlConnector = new MySqlConnector(
        factoryHarness.factory,
      );

      await expect(
        connector.queryTable(buildSettings(), "DROP TABLE users", WINDOW),
      ).rejects.toThrow(BadDataException);

      expect(factoryHarness.calls).toHaveLength(0);
      expect(harness.executedQueries).toHaveLength(0);
    });
  });
});
