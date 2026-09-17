import { afterEach, describe, expect, test } from "@jest/globals";
import * as mssql from "mssql";
import SqlServerConnector, {
  SqlServerPoolFactory,
  SqlServerPoolLike,
  SqlServerRequestLike,
  SqlServerTransactionLike,
} from "../../../../Server/Utils/DataSource/Connectors/SqlServerConnector";
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
import DataSourceTableResult, {
  DataSourceTableColumnType,
} from "../../../../Types/DataSource/DataSourceTableResult";
import DataSourceType from "../../../../Types/DataSource/DataSourceType";
import BadDataException from "../../../../Types/Exception/BadDataException";

/*
 * Fake mssql pool harness. Records every lifecycle step and SQL string in
 * order ("connect", "begin", "batch:<sql>", "query:<sql>", "rollback",
 * "close") plus every pool config the factory received, and lets individual
 * steps be scripted to fail so teardown paths can be exercised. No real
 * network or database is ever touched.
 */
interface HarnessScript {
  /* Rows returned by the recordset of every query (default []). */
  rows?: Array<Record<string, unknown>>;
  /* Return {} (no recordset key at all) from query. */
  omitRecordset?: boolean;
  connectError?: Error;
  beginError?: Error;
  batchError?: Error;
  queryError?: Error;
  rollbackError?: Error;
  closeError?: Error;
}

interface Harness {
  factory: SqlServerPoolFactory;
  calls: Array<string>;
  configs: Array<mssql.config>;
}

type CreateHarnessFunction = (script?: HarnessScript) => Harness;

const createHarness: CreateHarnessFunction = (
  script?: HarnessScript,
): Harness => {
  const calls: Array<string> = [];
  const configs: Array<mssql.config> = [];

  const factory: SqlServerPoolFactory = (
    config: mssql.config,
  ): SqlServerPoolLike => {
    configs.push(config);

    const transaction: SqlServerTransactionLike = {
      begin: async (): Promise<void> => {
        calls.push("begin");
        if (script?.beginError) {
          throw script.beginError;
        }
      },
      rollback: async (): Promise<void> => {
        calls.push("rollback");
        if (script?.rollbackError) {
          throw script.rollbackError;
        }
      },
      request: (): SqlServerRequestLike => {
        return {
          batch: async (sql: string): Promise<unknown> => {
            calls.push(`batch:${sql}`);
            if (script?.batchError) {
              throw script.batchError;
            }
            return undefined;
          },
          query: async (
            sql: string,
          ): Promise<{
            recordset?: Array<Record<string, unknown>> | undefined;
          }> => {
            calls.push(`query:${sql}`);
            if (script?.queryError) {
              throw script.queryError;
            }
            if (script?.omitRecordset) {
              return {};
            }
            return { recordset: script?.rows || [] };
          },
        };
      },
    };

    return {
      connect: async (): Promise<void> => {
        calls.push("connect");
        if (script?.connectError) {
          throw script.connectError;
        }
      },
      close: async (): Promise<void> => {
        calls.push("close");
        if (script?.closeError) {
          throw script.closeError;
        }
      },
      transaction: (): SqlServerTransactionLike => {
        return transaction;
      },
    };
  };

  return { factory: factory, calls: calls, configs: configs };
};

const PASSWORD: string = "sup3r-s3cret-pw";
const HOST: string = "mssql.internal.example.com";

type BuildSettingsFunction = (
  overrides?: Partial<DataSourceConnectionSettings>,
) => DataSourceConnectionSettings;

const buildSettings: BuildSettingsFunction = (
  overrides?: Partial<DataSourceConnectionSettings>,
): DataSourceConnectionSettings => {
  return {
    dataSourceType: DataSourceType.MicrosoftSqlServer,
    databaseHost: HOST,
    databasePort: 1433,
    databaseName: "metrics",
    username: "readonly_login",
    password: PASSWORD,
    ...overrides,
  };
};

const WINDOW: DataSourceQueryWindow = {
  startDate: new Date("2026-01-01T00:00:00.000Z"),
  endDate: new Date("2026-01-01T01:00:00.000Z"),
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

type FindExecutedQueryFunction = (harness: Harness) => string | undefined;

const findExecutedQuery: FindExecutedQueryFunction = (
  harness: Harness,
): string | undefined => {
  const call: string | undefined = harness.calls.find((entry: string) => {
    return entry.startsWith("query:");
  });
  return call ? call.substring("query:".length) : undefined;
};

afterEach(() => {
  jest.restoreAllMocks();
});

describe("SqlServerConnector", () => {
  test("exposes the Microsoft SQL Server data source type", () => {
    const connector: SqlServerConnector = new SqlServerConnector();
    expect(connector.dataSourceType).toBe(DataSourceType.MicrosoftSqlServer);
  });

  describe("queryTimeSeries", () => {
    test("shapes time/value rows into AggregatedResult without attributes", async () => {
      mockEgressAllowed();
      const harness: Harness = createHarness({
        rows: [
          { time: "2026-01-01 00:00:00", value: 5 },
          { time: new Date("2026-01-01T00:10:00.000Z"), value: "7.5" },
        ],
      });
      const connector: SqlServerConnector = new SqlServerConnector(
        harness.factory,
      );

      const result: AggregatedResult = await connector.queryTimeSeries(
        buildSettings(),
        "SELECT time, value FROM metrics_table",
        WINDOW,
      );

      expect(result.truncated).toBe(false);
      expect(result.data).toHaveLength(2);
      expect(result.data[0]!.timestamp).toEqual(
        new Date("2026-01-01T00:00:00.000Z"),
      );
      expect(result.data[0]!.value).toBe(5);
      expect(result.data[0]!["attributes"]).toBeUndefined();
      expect(result.data[1]!.timestamp).toEqual(
        new Date("2026-01-01T00:10:00.000Z"),
      );
      expect(result.data[1]!.value).toBe(7.5);
    });

    test("places series label columns under attributes on each point", async () => {
      mockEgressAllowed();
      const harness: Harness = createHarness({
        rows: [
          { time: "2026-01-01 00:00:00", value: 1, host: "api-1" },
          { time: "2026-01-01 00:00:00", value: 2, host: "api-2" },
        ],
      });
      const connector: SqlServerConnector = new SqlServerConnector(
        harness.factory,
      );

      const result: AggregatedResult = await connector.queryTimeSeries(
        buildSettings(),
        "SELECT time, value, host FROM metrics_table",
        WINDOW,
      );

      expect(result.data).toHaveLength(2);
      expect(result.data[0]!["attributes"]).toEqual({ host: "api-1" });
      expect(result.data[1]!["attributes"]).toEqual({ host: "api-2" });
    });

    test("returns an empty result for an empty recordset", async () => {
      mockEgressAllowed();
      const harness: Harness = createHarness({ rows: [] });
      const connector: SqlServerConnector = new SqlServerConnector(
        harness.factory,
      );

      const result: AggregatedResult = await connector.queryTimeSeries(
        buildSettings(),
        "SELECT time, value FROM empty_table",
        WINDOW,
      );

      expect(result).toEqual({ data: [], truncated: false });
    });

    test("treats a missing recordset (non-row batch response) as empty", async () => {
      mockEgressAllowed();
      const harness: Harness = createHarness({ omitRecordset: true });
      const connector: SqlServerConnector = new SqlServerConnector(
        harness.factory,
      );

      const result: AggregatedResult = await connector.queryTimeSeries(
        buildSettings(),
        "SELECT time, value FROM metrics_table",
        WINDOW,
      );

      expect(result.data).toEqual([]);
    });

    test("clamps to the time-series row cap and flags truncation", async () => {
      mockEgressAllowed();
      const rows: Array<Record<string, unknown>> = [];
      for (let i: number = 0; i < DATA_SOURCE_MAX_TIME_SERIES_ROWS + 1; i++) {
        rows.push({ time: 1700000000 + i, value: i });
      }
      const harness: Harness = createHarness({ rows: rows });
      const connector: SqlServerConnector = new SqlServerConnector(
        harness.factory,
      );

      const result: AggregatedResult = await connector.queryTimeSeries(
        buildSettings(),
        "SELECT time, value FROM big_table",
        WINDOW,
      );

      expect(result.truncated).toBe(true);
      expect(result.data).toHaveLength(DATA_SOURCE_MAX_TIME_SERIES_ROWS);
    });

    test("runs SET ROWCOUNT cap+1 before the query and always rolls back and closes", async () => {
      mockEgressAllowed();
      const harness: Harness = createHarness({
        rows: [{ time: 1700000000, value: 1 }],
      });
      const connector: SqlServerConnector = new SqlServerConnector(
        harness.factory,
      );
      const sql: string = "SELECT time, value FROM metrics_table";

      await connector.queryTimeSeries(buildSettings(), sql, WINDOW);

      expect(harness.calls).toEqual([
        "connect",
        "begin",
        `batch:SET ROWCOUNT ${DATA_SOURCE_MAX_TIME_SERIES_ROWS + 1}`,
        `query:${sql}`,
        "rollback",
        "close",
      ]);
    });

    test("applies time macros and executes exactly the interpolated SQL", async () => {
      mockEgressAllowed();
      const harness: Harness = createHarness({ rows: [] });
      const connector: SqlServerConnector = new SqlServerConnector(
        harness.factory,
      );

      await connector.queryTimeSeries(
        buildSettings(),
        "SELECT time, value FROM m WHERE t BETWEEN $__startTime AND $__endTime AND ms >= $__startTimeMs AND ms < $__endTimeMs AND r = $__rangeSeconds",
        WINDOW,
      );

      const expected: string = `SELECT time, value FROM m WHERE t BETWEEN '2026-01-01 00:00:00' AND '2026-01-01 01:00:00' AND ms >= ${WINDOW.startDate.getTime()} AND ms < ${WINDOW.endDate.getTime()} AND r = 3600`;
      expect(findExecutedQuery(harness)).toBe(expected);
    });

    test("executes exactly the final SQL including a trailing semicolon", async () => {
      mockEgressAllowed();
      const harness: Harness = createHarness({ rows: [] });
      const connector: SqlServerConnector = new SqlServerConnector(
        harness.factory,
      );
      const sql: string = "SELECT time, value FROM metrics_table;";

      await connector.queryTimeSeries(buildSettings(), sql, WINDOW);

      expect(findExecutedQuery(harness)).toBe(sql);
    });

    test("surfaces the shaper error when no time column is returned", async () => {
      mockEgressAllowed();
      const harness: Harness = createHarness({
        rows: [{ foo: "bar", value: 2 }],
      });
      const connector: SqlServerConnector = new SqlServerConnector(
        harness.factory,
      );

      await expect(
        connector.queryTimeSeries(
          buildSettings(),
          "SELECT foo, value FROM metrics_table",
          WINDOW,
        ),
      ).rejects.toThrow(/time column/);
    });
  });

  describe("queryTable", () => {
    test("shapes rows into columns with sniffed types and coerced cells", async () => {
      mockEgressAllowed();
      const harness: Harness = createHarness({
        rows: [
          {
            name: "api",
            count: 3,
            at: new Date("2026-01-01T00:00:00.000Z"),
            ok: true,
          },
        ],
      });
      const connector: SqlServerConnector = new SqlServerConnector(
        harness.factory,
      );

      const result: DataSourceTableResult = await connector.queryTable(
        buildSettings(),
        "SELECT name, count, at, ok FROM services",
        WINDOW,
      );

      expect(result.truncated).toBe(false);
      expect(result.columns).toEqual([
        { key: "name", title: "name", type: DataSourceTableColumnType.Text },
        {
          key: "count",
          title: "count",
          type: DataSourceTableColumnType.Number,
        },
        { key: "at", title: "at", type: DataSourceTableColumnType.Date },
        { key: "ok", title: "ok", type: DataSourceTableColumnType.Boolean },
      ]);
      expect(result.rows).toEqual([
        {
          name: "api",
          count: 3,
          at: "2026-01-01T00:00:00.000Z",
          ok: true,
        },
      ]);
    });

    test("uses the table row cap for SET ROWCOUNT and flags truncation", async () => {
      mockEgressAllowed();
      const rows: Array<Record<string, unknown>> = [];
      for (let i: number = 0; i < DATA_SOURCE_MAX_TABLE_ROWS + 1; i++) {
        rows.push({ id: i });
      }
      const harness: Harness = createHarness({ rows: rows });
      const connector: SqlServerConnector = new SqlServerConnector(
        harness.factory,
      );

      const result: DataSourceTableResult = await connector.queryTable(
        buildSettings(),
        "SELECT id FROM big_table",
        WINDOW,
      );

      expect(result.truncated).toBe(true);
      expect(result.rows).toHaveLength(DATA_SOURCE_MAX_TABLE_ROWS);
      expect(harness.calls).toContain(
        `batch:SET ROWCOUNT ${DATA_SOURCE_MAX_TABLE_ROWS + 1}`,
      );
    });

    test("returns an empty table for an empty recordset", async () => {
      mockEgressAllowed();
      const harness: Harness = createHarness({ rows: [] });
      const connector: SqlServerConnector = new SqlServerConnector(
        harness.factory,
      );

      const result: DataSourceTableResult = await connector.queryTable(
        buildSettings(),
        "SELECT id FROM empty_table",
        WINDOW,
      );

      expect(result).toEqual({ columns: [], rows: [], truncated: false });
    });
  });

  describe("read-only guard", () => {
    const forbiddenQueries: Array<{ title: string; sql: string }> = [
      { title: "xp_cmdshell execution", sql: "EXEC xp_cmdshell 'dir'" },
      {
        title: "WAITFOR smuggled after a SELECT",
        sql: "SELECT 1 WAITFOR DELAY '00:00:10'",
      },
      {
        title: "sp_configure system procedure",
        sql: "SELECT 1 sp_configure 'show advanced options'",
      },
      {
        title: "SELECT INTO table creation",
        sql: "SELECT * INTO stolen_data FROM users",
      },
      {
        title: "semicolon-less batch smuggling",
        sql: "SELECT 1 DROP TABLE x",
      },
      {
        title: "stacked statement with a semicolon",
        sql: "SELECT 1; DELETE FROM users",
      },
      {
        title: "UPDATE statement",
        sql: "UPDATE users SET name = 'x'",
      },
    ];

    for (const forbidden of forbiddenQueries) {
      test(`rejects ${forbidden.title} without creating a pool`, async () => {
        const egressSpy: jest.SpyInstance = mockEgressAllowed();
        const harness: Harness = createHarness();
        const connector: SqlServerConnector = new SqlServerConnector(
          harness.factory,
        );

        await expect(
          connector.queryTimeSeries(buildSettings(), forbidden.sql, WINDOW),
        ).rejects.toThrow(BadDataException);

        expect(harness.configs).toHaveLength(0);
        expect(harness.calls).toHaveLength(0);
        expect(egressSpy).not.toHaveBeenCalled();
      });
    }

    test("rejects an empty query", async () => {
      mockEgressAllowed();
      const harness: Harness = createHarness();
      const connector: SqlServerConnector = new SqlServerConnector(
        harness.factory,
      );

      await expect(
        connector.queryTimeSeries(buildSettings(), "   ", WINDOW),
      ).rejects.toThrow(BadDataException);

      expect(harness.configs).toHaveLength(0);
    });

    test("rejects backslash-escaped quotes", async () => {
      mockEgressAllowed();
      const harness: Harness = createHarness();
      const connector: SqlServerConnector = new SqlServerConnector(
        harness.factory,
      );

      await expect(
        connector.queryTimeSeries(
          buildSettings(),
          "SELECT 'it\\'s' AS value, 1700000000 AS time",
          WINDOW,
        ),
      ).rejects.toThrow(/Backslash-escaped/);

      expect(harness.configs).toHaveLength(0);
    });

    test("allows forbidden words inside string literals", async () => {
      mockEgressAllowed();
      const harness: Harness = createHarness({ rows: [] });
      const connector: SqlServerConnector = new SqlServerConnector(
        harness.factory,
      );
      const sql: string =
        "SELECT 'DROP TABLE x' AS label, 1 AS value, 1700000000 AS time";

      await connector.queryTimeSeries(buildSettings(), sql, WINDOW);

      expect(findExecutedQuery(harness)).toBe(sql);
    });

    test("allows forbidden words inside bracket-quoted identifiers", async () => {
      mockEgressAllowed();
      const harness: Harness = createHarness({ rows: [] });
      const connector: SqlServerConnector = new SqlServerConnector(
        harness.factory,
      );
      const sql: string =
        "SELECT [delete] AS value, 1700000000 AS time FROM [orders]";

      await connector.queryTimeSeries(buildSettings(), sql, WINDOW);

      expect(findExecutedQuery(harness)).toBe(sql);
    });
  });

  describe("egress guard", () => {
    test("validates the database host before connecting", async () => {
      const harness: Harness = createHarness({ rows: [] });
      const egressSpy: jest.SpyInstance = mockEgressAllowed(harness.calls);
      const connector: SqlServerConnector = new SqlServerConnector(
        harness.factory,
      );

      await connector.queryTimeSeries(
        buildSettings(),
        "SELECT time, value FROM metrics_table",
        WINDOW,
      );

      expect(egressSpy).toHaveBeenCalledWith(HOST);
      expect(harness.calls[0]).toBe("egress");
      expect(harness.calls[1]).toBe("connect");
    });

    test("propagates an egress guard rejection without creating a pool", async () => {
      const egressSpy: jest.SpyInstance = jest.spyOn(
        DataSourceEgressGuard,
        "assertHostnameAllowed",
      );
      egressSpy.mockRejectedValue(
        new BadDataException(
          "Data source host 169.254.169.254 is not allowed: link-local address (cloud metadata range).",
        ),
      );
      const harness: Harness = createHarness();
      const connector: SqlServerConnector = new SqlServerConnector(
        harness.factory,
      );

      await expect(
        connector.queryTimeSeries(
          buildSettings(),
          "SELECT time, value FROM metrics_table",
          WINDOW,
        ),
      ).rejects.toThrow("not allowed");

      expect(harness.configs).toHaveLength(0);
      expect(harness.calls).toHaveLength(0);
    });

    test("throws without touching the guard when databaseHost is missing", async () => {
      const egressSpy: jest.SpyInstance = mockEgressAllowed();
      const harness: Harness = createHarness();
      const connector: SqlServerConnector = new SqlServerConnector(
        harness.factory,
      );

      await expect(
        connector.queryTimeSeries(
          buildSettings({ databaseHost: undefined }),
          "SELECT time, value FROM metrics_table",
          WINDOW,
        ),
      ).rejects.toThrow(/database host/i);

      expect(egressSpy).not.toHaveBeenCalled();
      expect(harness.configs).toHaveLength(0);
    });
  });

  describe("pool configuration", () => {
    test("maps settings and limits onto the mssql config", async () => {
      mockEgressAllowed();
      const harness: Harness = createHarness({ rows: [] });
      const connector: SqlServerConnector = new SqlServerConnector(
        harness.factory,
      );

      await connector.queryTable(
        buildSettings({ databasePort: 14330 }),
        "SELECT id FROM services",
        WINDOW,
      );

      const config: mssql.config = harness.configs[0]!;
      expect(config.server).toBe(HOST);
      expect(config.port).toBe(14330);
      expect(config.database).toBe("metrics");
      expect(config.user).toBe("readonly_login");
      expect(config.password).toBe(PASSWORD);
      expect(config.connectionTimeout).toBe(DATA_SOURCE_CONNECT_TIMEOUT_IN_MS);
      expect(config.requestTimeout).toBe(DATA_SOURCE_QUERY_TIMEOUT_IN_MS);
      expect(config.pool).toEqual({ max: 1, min: 0, idleTimeoutMillis: 30000 });
      expect(config.options?.appName).toBe("OneUptime-DataSource");
    });

    test("defaults the port to 1433 when none is configured", async () => {
      mockEgressAllowed();
      const harness: Harness = createHarness({ rows: [] });
      const connector: SqlServerConnector = new SqlServerConnector(
        harness.factory,
      );

      await connector.queryTable(
        buildSettings({ databasePort: undefined }),
        "SELECT id FROM services",
        WINDOW,
      );

      expect(harness.configs[0]!.port).toBe(1433);
    });

    test("disables encryption and trusts the certificate when TLS is off", async () => {
      mockEgressAllowed();
      const harness: Harness = createHarness({ rows: [] });
      const connector: SqlServerConnector = new SqlServerConnector(
        harness.factory,
      );

      await connector.queryTable(
        buildSettings(),
        "SELECT id FROM services",
        WINDOW,
      );

      const config: mssql.config = harness.configs[0]!;
      expect(config.options?.encrypt).toBe(false);
      expect(config.options?.trustServerCertificate).toBe(true);
    });

    test("enables encryption with certificate verification ON by default", async () => {
      mockEgressAllowed();
      const harness: Harness = createHarness({ rows: [] });
      const connector: SqlServerConnector = new SqlServerConnector(
        harness.factory,
      );

      await connector.queryTable(
        buildSettings({ additionalOptions: { sslEnabled: true } }),
        "SELECT id FROM services",
        WINDOW,
      );

      const config: mssql.config = harness.configs[0]!;
      expect(config.options?.encrypt).toBe(true);
      expect(config.options?.trustServerCertificate).toBe(false);
    });

    test("trusts the server certificate only on explicit opt-out", async () => {
      mockEgressAllowed();
      const harness: Harness = createHarness({ rows: [] });
      const connector: SqlServerConnector = new SqlServerConnector(
        harness.factory,
      );

      await connector.queryTable(
        buildSettings({
          additionalOptions: { sslEnabled: true, sslRejectUnauthorized: false },
        }),
        "SELECT id FROM services",
        WINDOW,
      );

      const config: mssql.config = harness.configs[0]!;
      expect(config.options?.encrypt).toBe(true);
      expect(config.options?.trustServerCertificate).toBe(true);
    });
  });

  describe("error handling", () => {
    test("sanitizes query failures and still rolls back and closes", async () => {
      mockEgressAllowed();
      const harness: Harness = createHarness({
        queryError: new Error(
          `Login failed for readonly_login using password ${PASSWORD} against ${HOST}`,
        ),
      });
      const connector: SqlServerConnector = new SqlServerConnector(
        harness.factory,
      );

      let thrown: Error | null = null;
      try {
        await connector.queryTimeSeries(
          buildSettings(),
          "SELECT time, value FROM metrics_table",
          WINDOW,
        );
      } catch (error) {
        thrown = error as Error;
      }

      expect(thrown).toBeInstanceOf(BadDataException);
      expect(thrown!.message).not.toContain(PASSWORD);
      expect(thrown!.message).not.toContain(HOST);
      expect(thrown!.message).not.toContain("readonly_login");
      expect(thrown!.message).toContain("***");
      expect(harness.calls).toContain("rollback");
      expect(harness.calls).toContain("close");
    });

    test("closes the pool without rolling back when connect fails", async () => {
      mockEgressAllowed();
      const harness: Harness = createHarness({
        connectError: new Error(`getaddrinfo ENOTFOUND ${HOST}`),
      });
      const connector: SqlServerConnector = new SqlServerConnector(
        harness.factory,
      );

      let thrown: Error | null = null;
      try {
        await connector.queryTimeSeries(
          buildSettings(),
          "SELECT time, value FROM metrics_table",
          WINDOW,
        );
      } catch (error) {
        thrown = error as Error;
      }

      expect(thrown).toBeInstanceOf(BadDataException);
      expect(thrown!.message).not.toContain(HOST);
      expect(harness.calls).not.toContain("rollback");
      expect(harness.calls).toContain("close");
    });

    test("closes the pool without rolling back when begin fails", async () => {
      mockEgressAllowed();
      const harness: Harness = createHarness({
        beginError: new Error("EALREADYBEGUN: transaction already begun"),
      });
      const connector: SqlServerConnector = new SqlServerConnector(
        harness.factory,
      );

      await expect(
        connector.queryTimeSeries(
          buildSettings(),
          "SELECT time, value FROM metrics_table",
          WINDOW,
        ),
      ).rejects.toThrow(BadDataException);

      expect(harness.calls).not.toContain("rollback");
      expect(harness.calls).toContain("close");
    });

    test("sanitizes SET ROWCOUNT batch failures and still tears down", async () => {
      mockEgressAllowed();
      const harness: Harness = createHarness({
        batchError: new Error(`syntax error near ROWCOUNT on ${HOST}`),
      });
      const connector: SqlServerConnector = new SqlServerConnector(
        harness.factory,
      );

      let thrown: Error | null = null;
      try {
        await connector.queryTimeSeries(
          buildSettings(),
          "SELECT time, value FROM metrics_table",
          WINDOW,
        );
      } catch (error) {
        thrown = error as Error;
      }

      expect(thrown).toBeInstanceOf(BadDataException);
      expect(thrown!.message).not.toContain(HOST);
      expect(harness.calls).toContain("rollback");
      expect(harness.calls).toContain("close");
    });

    test("swallows rollback failures and still returns rows", async () => {
      mockEgressAllowed();
      const harness: Harness = createHarness({
        rows: [{ time: 1700000000, value: 1 }],
        rollbackError: new Error("ENOTBEGUN: transaction is gone"),
      });
      const connector: SqlServerConnector = new SqlServerConnector(
        harness.factory,
      );

      const result: AggregatedResult = await connector.queryTimeSeries(
        buildSettings(),
        "SELECT time, value FROM metrics_table",
        WINDOW,
      );

      expect(result.data).toHaveLength(1);
      expect(harness.calls).toContain("close");
    });

    test("swallows pool close failures and still returns rows", async () => {
      mockEgressAllowed();
      const harness: Harness = createHarness({
        rows: [{ time: 1700000000, value: 1 }],
        closeError: new Error("pool close timed out"),
      });
      const connector: SqlServerConnector = new SqlServerConnector(
        harness.factory,
      );

      const result: AggregatedResult = await connector.queryTimeSeries(
        buildSettings(),
        "SELECT time, value FROM metrics_table",
        WINDOW,
      );

      expect(result.data).toHaveLength(1);
    });
  });

  describe("testConnection", () => {
    test("runs SELECT 1 through the guarded transactional path and closes", async () => {
      const egressSpy: jest.SpyInstance = mockEgressAllowed();
      const harness: Harness = createHarness({ rows: [{ "": 1 }] });
      const connector: SqlServerConnector = new SqlServerConnector(
        harness.factory,
      );

      await connector.testConnection(buildSettings());

      expect(egressSpy).toHaveBeenCalledWith(HOST);
      expect(harness.calls).toEqual([
        "connect",
        "begin",
        "batch:SET ROWCOUNT 1",
        "query:SELECT 1",
        "rollback",
        "close",
      ]);
    });

    test("validates egress before opening a connection", async () => {
      const harness: Harness = createHarness({ rows: [] });
      mockEgressAllowed(harness.calls);
      const connector: SqlServerConnector = new SqlServerConnector(
        harness.factory,
      );

      await connector.testConnection(buildSettings());

      expect(harness.calls[0]).toBe("egress");
      expect(harness.calls[1]).toBe("connect");
    });

    test("sanitizes connection failures so secrets never leak", async () => {
      mockEgressAllowed();
      const harness: Harness = createHarness({
        connectError: new Error(
          `Login failed. Connection string: Server=${HOST};Password=${PASSWORD}`,
        ),
      });
      const connector: SqlServerConnector = new SqlServerConnector(
        harness.factory,
      );

      let thrown: Error | null = null;
      try {
        await connector.testConnection(buildSettings());
      } catch (error) {
        thrown = error as Error;
      }

      expect(thrown).toBeInstanceOf(BadDataException);
      expect(thrown!.message).not.toContain(PASSWORD);
      expect(thrown!.message).not.toContain(HOST);
      expect(thrown!.message).toContain("***");
      expect(harness.calls).toContain("close");
    });
  });
});
