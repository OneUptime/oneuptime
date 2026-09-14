// Set required env vars before importing DatabaseMonitor (which reaches Config.ts).
process.env["ONEUPTIME_URL"] = "https://oneuptime.com";
process.env["PROBE_KEY"] = "test-probe-key";

import DatabaseMonitor from "../../../../../Utils/Monitors/MonitorTypes/DatabaseMonitor";
import { DatabaseHealthQuery } from "../../../../../Utils/Monitors/MonitorTypes/DatabaseMonitor/DatabaseHealthQueries";
import { DatabaseMetricGroup } from "Common/Types/Monitor/DatabaseMetricCatalog";
import DatabaseMonitorResponse, {
  DatabaseMetricGroupUnavailableReason,
} from "Common/Types/Monitor/DatabaseMonitor/DatabaseMonitorResponse";
import MonitorMetricType from "Common/Types/Monitor/MonitorMetricType";
import MonitorStepDatabaseMonitor, {
  MonitorStepDatabaseMonitorUtil,
} from "Common/Types/Monitor/MonitorStepDatabaseMonitor";
import SqlDatabaseType from "Common/Types/Monitor/SqlDatabaseType";
import { describe, expect, test } from "@jest/globals";

const buildQuery: (
  overrides?: Partial<DatabaseHealthQuery>,
) => DatabaseHealthQuery = (
  overrides: Partial<DatabaseHealthQuery> = {},
): DatabaseHealthQuery => {
  return {
    id: "test-query",
    group: DatabaseMetricGroup.Connections,
    sql: "SELECT 1",
    columnMappings: [],
    ...overrides,
  };
};

describe("DatabaseMonitor.classifyQueryFailure", () => {
  test.each([
    ["permission denied for view pg_stat_activity"],
    ["Access denied; you need (at least one of) the PROCESS privilege(s)"],
    [
      "The user does not have permission to perform this action. VIEW SERVER STATE permission was denied on object 'server'",
    ],
    ["must be superuser or a member of pg_read_all_stats"],
  ])("classifies %s as a missing permission", (message: string) => {
    expect(DatabaseMonitor.classifyQueryFailure(message)).toBe(
      DatabaseMetricGroupUnavailableReason.MissingPermission,
    );
  });

  test.each([
    ['relation "pg_stat_checkpointer" does not exist'],
    ["Table 'performance_schema.data_lock_waits' doesn't exist"],
    ["Unknown column 'redo_queue_size' in 'field list'"],
    ["Invalid object name 'sys.dm_hadr_database_replica_states'"],
  ])("classifies %s as unsupported by the engine", (message: string) => {
    expect(DatabaseMonitor.classifyQueryFailure(message)).toBe(
      DatabaseMetricGroupUnavailableReason.NotSupportedByEngine,
    );
  });

  test.each([
    ["canceling statement due to statement timeout"],
    [
      "Query execution was interrupted, maximum statement execution time exceeded",
    ],
    ["RequestError: Timeout: Request failed to complete in 10000ms"],
  ])("classifies %s as a timeout", (message: string) => {
    expect(DatabaseMonitor.classifyQueryFailure(message)).toBe(
      DatabaseMetricGroupUnavailableReason.Timeout,
    );
  });

  test("falls back to a generic error rather than guessing", () => {
    expect(
      DatabaseMonitor.classifyQueryFailure("connection reset by peer"),
    ).toBe(DatabaseMetricGroupUnavailableReason.Error);
  });

  test("a timeout inside a permission-shaped message is still a timeout", () => {
    /*
     * Order matters: a statement that times out while reading a privileged
     * view must not be reported as a missing grant, or the operator will go
     * and change permissions that were never the problem.
     */
    expect(
      DatabaseMonitor.classifyQueryFailure(
        "canceling statement due to statement timeout on pg_stat_activity: permission denied",
      ),
    ).toBe(DatabaseMetricGroupUnavailableReason.Timeout);
  });
});

describe("DatabaseMonitor.shouldRunQuery", () => {
  test("runs an ungated query on any version", () => {
    expect(
      DatabaseMonitor.shouldRunQuery({
        query: buildQuery(),
        serverVersionNum: 150018,
        isInRecovery: false,
      }),
    ).toBe(true);
  });

  test("respects a maximum version gate", () => {
    const query: DatabaseHealthQuery = buildQuery({
      maxServerVersionNum: 169999,
    });

    expect(
      DatabaseMonitor.shouldRunQuery({
        query,
        serverVersionNum: 150018,
        isInRecovery: false,
      }),
    ).toBe(true);

    expect(
      DatabaseMonitor.shouldRunQuery({
        query,
        serverVersionNum: 170000,
        isInRecovery: false,
      }),
    ).toBe(false);
  });

  test("respects a minimum version gate", () => {
    const query: DatabaseHealthQuery = buildQuery({
      minServerVersionNum: 170000,
    });

    expect(
      DatabaseMonitor.shouldRunQuery({
        query,
        serverVersionNum: 150018,
        isInRecovery: false,
      }),
    ).toBe(false);

    expect(
      DatabaseMonitor.shouldRunQuery({
        query,
        serverVersionNum: 170000,
        isInRecovery: false,
      }),
    ).toBe(true);
  });

  test("runs a version-gated query when the version is unknown", () => {
    /*
     * A gate encodes a KNOWN incompatibility. With no version in hand,
     * attempting and reporting the failure tells an operator more than
     * silently collecting nothing would.
     */
    expect(
      DatabaseMonitor.shouldRunQuery({
        query: buildQuery({ minServerVersionNum: 170000 }),
        serverVersionNum: null,
        isInRecovery: false,
      }),
    ).toBe(true);
  });

  test("splits replication queries by recovery state in both directions", () => {
    const primaryOnly: DatabaseHealthQuery = buildQuery({
      runOnlyWhenInRecovery: false,
    });
    const standbyOnly: DatabaseHealthQuery = buildQuery({
      runOnlyWhenInRecovery: true,
    });

    expect(
      DatabaseMonitor.shouldRunQuery({
        query: primaryOnly,
        serverVersionNum: 150018,
        isInRecovery: false,
      }),
    ).toBe(true);
    expect(
      DatabaseMonitor.shouldRunQuery({
        query: primaryOnly,
        serverVersionNum: 150018,
        isInRecovery: true,
      }),
    ).toBe(false);

    expect(
      DatabaseMonitor.shouldRunQuery({
        query: standbyOnly,
        serverVersionNum: 150018,
        isInRecovery: true,
      }),
    ).toBe(true);
    expect(
      DatabaseMonitor.shouldRunQuery({
        query: standbyOnly,
        serverVersionNum: 150018,
        isInRecovery: false,
      }),
    ).toBe(false);
  });
});

describe("DatabaseMonitor.readNumber", () => {
  test("reads the numeric shapes the drivers actually return", () => {
    /*
     * node-postgres returns bigint and numeric as STRINGS to avoid silently
     * losing precision, and MySQL returns every global_status value as a
     * string, so the string branch is the common case rather than the edge.
     */
    expect(DatabaseMonitor.readNumber({ v: 42 }, "v")).toBe(42);
    expect(DatabaseMonitor.readNumber({ v: "42" }, "v")).toBe(42);
    expect(DatabaseMonitor.readNumber({ v: "42.5" }, "v")).toBe(42.5);
    expect(DatabaseMonitor.readNumber({ v: BigInt(42) }, "v")).toBe(42);
    expect(DatabaseMonitor.readNumber({ v: true }, "v")).toBe(1);
    expect(DatabaseMonitor.readNumber({ v: false }, "v")).toBe(0);
  });

  test("returns null rather than a wrong number", () => {
    expect(DatabaseMonitor.readNumber({ v: null }, "v")).toBeNull();
    expect(DatabaseMonitor.readNumber({ v: "" }, "v")).toBeNull();
    expect(DatabaseMonitor.readNumber({ v: "n/a" }, "v")).toBeNull();
    expect(DatabaseMonitor.readNumber({ v: Infinity }, "v")).toBeNull();
    expect(DatabaseMonitor.readNumber({}, "missing")).toBeNull();
  });

  test("matches columns case-insensitively", () => {
    // Engines disagree about case; SHOW REPLICA STATUS is mixed-case.
    expect(
      DatabaseMonitor.readNumber(
        { Seconds_Behind_Source: "7" },
        "seconds_behind_source",
      ),
    ).toBe(7);
    expect(DatabaseMonitor.readNumber({ BYTES: "9" }, "bytes")).toBe(9);
  });
});

describe("DatabaseMonitor.applyColumnMappings", () => {
  test("records mapped values and applies the unit multiplier", () => {
    const metrics: Partial<Record<MonitorMetricType, number>> = {};

    DatabaseMonitor.applyColumnMappings({
      row: { connections_total: "12", log_send_queue_kb: "3" },
      mappings: [
        {
          column: "connections_total",
          metricType: MonitorMetricType.DatabaseConnectionsTotal,
        },
        {
          column: "log_send_queue_kb",
          metricType: MonitorMetricType.DatabaseReplicationLagBytes,
          multiplier: 1024,
        },
      ],
      metrics,
    });

    expect(metrics[MonitorMetricType.DatabaseConnectionsTotal]).toBe(12);
    // SQL Server reports queue sizes in KB; the series is bytes.
    expect(metrics[MonitorMetricType.DatabaseReplicationLagBytes]).toBe(3072);
  });

  test("leaves an absent value absent instead of writing zero", () => {
    /*
     * The whole point of the contract. A replication lag of zero means a
     * replica that is caught up; an absent replication lag means there is
     * no replica at all. Zero-filling would merge the two and make a
     * "lag > 60s" criterion look permanently healthy on a broken setup.
     */
    const metrics: Partial<Record<MonitorMetricType, number>> = {};

    DatabaseMonitor.applyColumnMappings({
      row: { replication_lag_seconds: null },
      mappings: [
        {
          column: "replication_lag_seconds",
          metricType: MonitorMetricType.DatabaseReplicationLagSeconds,
        },
      ],
      metrics,
    });

    expect(MonitorMetricType.DatabaseReplicationLagSeconds in metrics).toBe(
      false,
    );
  });
});

describe("DatabaseMonitor.applyDerivedMetrics", () => {
  test("derives connection headroom from total and max", () => {
    const metrics: Partial<Record<MonitorMetricType, number>> = {
      [MonitorMetricType.DatabaseConnectionsTotal]: 51,
      [MonitorMetricType.DatabaseConnectionsMax]: 100,
    };

    DatabaseMonitor.applyDerivedMetrics({
      databaseType: SqlDatabaseType.PostgreSQL,
      rawColumns: {},
      metrics,
    });

    expect(metrics[MonitorMetricType.DatabaseConnectionsUsedPercent]).toBe(51);
  });

  test("does not divide by a zero or absent connection ceiling", () => {
    /*
     * SQL Server leaves the ceiling at 0 meaning unlimited, so this is a
     * real configuration rather than a defensive hypothetical.
     */
    const metrics: Partial<Record<MonitorMetricType, number>> = {
      [MonitorMetricType.DatabaseConnectionsTotal]: 51,
      [MonitorMetricType.DatabaseConnectionsMax]: 0,
    };

    DatabaseMonitor.applyDerivedMetrics({
      databaseType: SqlDatabaseType.MicrosoftSqlServer,
      rawColumns: {},
      metrics,
    });

    expect(MonitorMetricType.DatabaseConnectionsUsedPercent in metrics).toBe(
      false,
    );
  });

  test("derives PostgreSQL cache hit ratio and rollback ratio", () => {
    const metrics: Partial<Record<MonitorMetricType, number>> = {};

    DatabaseMonitor.applyDerivedMetrics({
      databaseType: SqlDatabaseType.PostgreSQL,
      rawColumns: {
        blks_hit: 999,
        blks_read: 1,
        xact_commit: 90,
        xact_rollback: 10,
      },
      metrics,
    });

    expect(metrics[MonitorMetricType.DatabaseCacheHitPercent]).toBeCloseTo(
      99.9,
    );
    expect(metrics[MonitorMetricType.DatabaseTransactionsTotal]).toBe(100);
    expect(metrics[MonitorMetricType.DatabaseRollbackPercent]).toBe(10);
  });

  test("derives the MySQL buffer pool hit ratio", () => {
    const metrics: Partial<Record<MonitorMetricType, number>> = {};

    DatabaseMonitor.applyDerivedMetrics({
      databaseType: SqlDatabaseType.MySQL,
      rawColumns: { bp_read_requests: 1000, bp_disk_reads: 50 },
      metrics,
    });

    expect(metrics[MonitorMetricType.DatabaseCacheHitPercent]).toBe(95);
  });

  test("divides the SQL Server buffer cache hit ratio by its base counter", () => {
    /*
     * The raw counter alone is meaningless - on a live server it read 108,
     * which as a percentage is nonsense. It is only a ratio once divided by
     * the companion base counter.
     */
    const metrics: Partial<Record<MonitorMetricType, number>> = {};

    DatabaseMonitor.applyDerivedMetrics({
      databaseType: SqlDatabaseType.MicrosoftSqlServer,
      rawColumns: {
        buffer_cache_hit_ratio_raw: 108,
        buffer_cache_hit_ratio_base: 108,
      },
      metrics,
    });

    expect(metrics[MonitorMetricType.DatabaseCacheHitPercent]).toBe(100);
  });

  test("skips a ratio whose inputs are absent rather than writing NaN", () => {
    const metrics: Partial<Record<MonitorMetricType, number>> = {};

    DatabaseMonitor.applyDerivedMetrics({
      databaseType: SqlDatabaseType.PostgreSQL,
      rawColumns: { blks_hit: 0, blks_read: 0 },
      metrics,
    });

    expect(MonitorMetricType.DatabaseCacheHitPercent in metrics).toBe(false);
  });
});

describe("DatabaseMonitor.execute", () => {
  const buildConfig: (
    overrides?: Partial<MonitorStepDatabaseMonitor>,
  ) => MonitorStepDatabaseMonitor = (
    overrides: Partial<MonitorStepDatabaseMonitor> = {},
  ): MonitorStepDatabaseMonitor => {
    return {
      ...MonitorStepDatabaseMonitorUtil.getDefault(),
      host: "db.internal",
      databaseName: "orders",
      username: "monitoring",
      password: "super-secret",
      ...overrides,
    };
  };

  test("refuses an engine it cannot speak without attempting a connection", async () => {
    const response: DatabaseMonitorResponse | null =
      await DatabaseMonitor.execute(
        buildConfig({ databaseType: "Cassandra" as SqlDatabaseType }),
        { isOnlineCheckRequest: true },
      );

    expect(response?.isOnline).toBe(false);
    expect(response?.failureCause).toContain("not supported");
    expect(response?.metrics).toEqual({});
  });

  test("rejects integrated authentication on a non-SQL-Server engine", async () => {
    const response: DatabaseMonitorResponse | null =
      await DatabaseMonitor.execute(
        buildConfig({
          databaseType: SqlDatabaseType.PostgreSQL,
          useWindowsIntegratedAuthentication: true,
        }),
        { isOnlineCheckRequest: true },
      );

    expect(response?.isOnline).toBe(false);
    expect(response?.failureCause).toContain(
      "Windows Integrated Authentication",
    );
  });

  test("reports an unreachable database as offline without leaking the password", async () => {
    /*
     * Port 1 is reserved and never listening, so this exercises the real
     * connect-failure path rather than a mocked one.
     */
    const response: DatabaseMonitorResponse | null =
      await DatabaseMonitor.execute(
        buildConfig({
          databaseType: SqlDatabaseType.PostgreSQL,
          host: "127.0.0.1",
          port: 1,
          connectionTimeoutInMs: 1000,
        }),
        { retry: 1, isOnlineCheckRequest: true },
      );

    expect(response?.isOnline).toBe(false);
    expect(response?.connectionError).toBeTruthy();
    expect(JSON.stringify(response)).not.toContain("super-secret");
    // A failed connection collects nothing, and says so rather than inventing groups.
    expect(response?.collectedGroups).toEqual([]);
    expect(response?.metrics).toEqual({});
  }, 30000);
});
