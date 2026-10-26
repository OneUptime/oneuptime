// Set required env vars before importing DatabaseMonitor (which reaches Config.ts).
process.env["ONEUPTIME_URL"] = "https://oneuptime.com";
process.env["PROBE_KEY"] = "test-probe-key";

import DatabaseMonitor from "../../../../../Utils/Monitors/MonitorTypes/DatabaseMonitor";
import DatabaseCounterHistory, {
  DATABASE_COUNTER_HISTORY_MAX_ENTRIES,
  DATABASE_RATIO_COUNTER_COLUMNS,
  DatabaseCounterReading,
  getDatabaseCounterHistoryKey,
  pickDatabaseRatioCounters,
} from "../../../../../Utils/Monitors/MonitorTypes/DatabaseMonitor/DatabaseCounterHistory";
import { DatabaseMetricGroup } from "Common/Types/Monitor/DatabaseMetricCatalog";
import DatabaseMonitorResponse from "Common/Types/Monitor/DatabaseMonitor/DatabaseMonitorResponse";
import MonitorMetricType from "Common/Types/Monitor/MonitorMetricType";
import MonitorStepDatabaseMonitor, {
  MonitorStepDatabaseMonitorUtil,
} from "Common/Types/Monitor/MonitorStepDatabaseMonitor";
import SqlDatabaseType from "Common/Types/Monitor/SqlDatabaseType";
import ObjectID from "Common/Types/ObjectID";
import logger from "Common/Server/Utils/Logger";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * Follow-up of #5076: a Database monitor's Cache Hit Ratio and Rollback
 * Ratio were the engine's counters divided as read - a ratio over the
 * server's whole life, which on a long-running server barely moves. A
 * PostgreSQL cache that served 99.9% of a billion reads and then fell to
 * 80% for the last hour still read 99.9%, so "Cache Hit Ratio below 90"
 * never fired. Each check now divides what the counters moved since the
 * previous check of the same monitor on the same probe.
 */

type Metrics = Partial<Record<MonitorMetricType, number>>;

const MONITOR_ID: string = "8f1f2a3b-0000-4000-8000-00000000d001";
const OTHER_MONITOR_ID: string = "8f1f2a3b-0000-4000-8000-00000000d002";

const derive: (input: {
  databaseType: SqlDatabaseType;
  rawColumns: Record<string, number>;
  previousCounters?: Record<string, number> | undefined;
}) => Metrics = (input: {
  databaseType: SqlDatabaseType;
  rawColumns: Record<string, number>;
  previousCounters?: Record<string, number> | undefined;
}): Metrics => {
  const metrics: Metrics = {};
  DatabaseMonitor.applyDerivedMetrics({ ...input, metrics });
  return metrics;
};

describe("Cache Hit Ratio and Rollback Ratio are ratios over the interval", () => {
  /*
   * The customer-visible case: a long-running PostgreSQL server whose cache
   * served a billion reads, then a working set that stopped fitting. The
   * lifetime ratio read 99.98%; the last interval's is 80%.
   */
  test("a PostgreSQL cache that fell to 80% reads 80%, not its lifetime 99.98%", () => {
    const previous: Record<string, number> = {
      blks_hit: 1_000_000_000,
      blks_read: 200_000,
    };
    const current: Record<string, number> = {
      blks_hit: 1_000_000_000 + 8_000,
      blks_read: 200_000 + 2_000,
    };

    const lifetime: number =
      (current["blks_hit"]! / (current["blks_hit"]! + current["blks_read"]!)) *
      100;
    expect(lifetime).toBeGreaterThan(99.9);

    const metrics: Metrics = derive({
      databaseType: SqlDatabaseType.PostgreSQL,
      rawColumns: current,
      previousCounters: previous,
    });

    expect(metrics[MonitorMetricType.DatabaseCacheHitPercent]).toBe(80);
  });

  test("a burst of rollbacks reads as the share of this interval's transactions", () => {
    const metrics: Metrics = derive({
      databaseType: SqlDatabaseType.PostgreSQL,
      rawColumns: { xact_commit: 50_000_150, xact_rollback: 1_050 },
      previousCounters: { xact_commit: 50_000_000, xact_rollback: 1_000 },
    });

    // 150 commits and 50 rollbacks since the previous check: 25%.
    expect(metrics[MonitorMetricType.DatabaseRollbackPercent]).toBe(25);
    // Transactions stays the cumulative counter it always was.
    expect(metrics[MonitorMetricType.DatabaseTransactionsTotal]).toBe(
      50_001_200,
    );
  });

  test("a MySQL buffer pool that fell to 90% reads 90%", () => {
    const metrics: Metrics = derive({
      databaseType: SqlDatabaseType.MySQL,
      rawColumns: {
        bp_read_requests: 5_000_000_000 + 10_000,
        bp_disk_reads: 1_000 + 1_000,
      },
      previousCounters: {
        bp_read_requests: 5_000_000_000,
        bp_disk_reads: 1_000,
      },
    });

    expect(metrics[MonitorMetricType.DatabaseCacheHitPercent]).toBe(90);
  });

  test("the first check of a monitor - no previous reading - carries neither ratio", () => {
    const postgres: Metrics = derive({
      databaseType: SqlDatabaseType.PostgreSQL,
      rawColumns: {
        blks_hit: 999,
        blks_read: 1,
        xact_commit: 90,
        xact_rollback: 10,
      },
    });

    expect(MonitorMetricType.DatabaseCacheHitPercent in postgres).toBe(false);
    expect(MonitorMetricType.DatabaseRollbackPercent in postgres).toBe(false);
    // The counter itself is there from the first check.
    expect(postgres[MonitorMetricType.DatabaseTransactionsTotal]).toBe(100);

    const mysql: Metrics = derive({
      databaseType: SqlDatabaseType.MySQL,
      rawColumns: { bp_read_requests: 1000, bp_disk_reads: 50 },
    });

    expect(MonitorMetricType.DatabaseCacheHitPercent in mysql).toBe(false);
  });

  test("a counter that went backwards - a restart, a statistics reset - carries no ratio", () => {
    const metrics: Metrics = derive({
      databaseType: SqlDatabaseType.PostgreSQL,
      rawColumns: {
        blks_hit: 500,
        blks_read: 10,
        xact_commit: 40,
        xact_rollback: 1,
      },
      previousCounters: {
        blks_hit: 1_000_000,
        blks_read: 1_000,
        xact_commit: 90_000,
        xact_rollback: 100,
      },
    });

    expect(MonitorMetricType.DatabaseCacheHitPercent in metrics).toBe(false);
    expect(MonitorMetricType.DatabaseRollbackPercent in metrics).toBe(false);
  });

  test("one counter going backwards is enough to withhold its ratio", () => {
    const metrics: Metrics = derive({
      databaseType: SqlDatabaseType.PostgreSQL,
      rawColumns: { blks_hit: 2_000, blks_read: 5 },
      previousCounters: { blks_hit: 1_000, blks_read: 10 },
    });

    expect(MonitorMetricType.DatabaseCacheHitPercent in metrics).toBe(false);
  });

  test("an idle interval - nothing read, nothing committed - carries no ratio rather than 0% or 100%", () => {
    const metrics: Metrics = derive({
      databaseType: SqlDatabaseType.PostgreSQL,
      rawColumns: {
        blks_hit: 1_000,
        blks_read: 10,
        xact_commit: 90,
        xact_rollback: 10,
      },
      previousCounters: {
        blks_hit: 1_000,
        blks_read: 10,
        xact_commit: 90,
        xact_rollback: 10,
      },
    });

    expect(MonitorMetricType.DatabaseCacheHitPercent in metrics).toBe(false);
    expect(MonitorMetricType.DatabaseRollbackPercent in metrics).toBe(false);

    const mysql: Metrics = derive({
      databaseType: SqlDatabaseType.MySQL,
      rawColumns: { bp_read_requests: 1000, bp_disk_reads: 50 },
      previousCounters: { bp_read_requests: 1000, bp_disk_reads: 50 },
    });

    expect(MonitorMetricType.DatabaseCacheHitPercent in mysql).toBe(false);
  });

  test("a previous reading without the counters - the group was off or failed - carries no ratio", () => {
    const metrics: Metrics = derive({
      databaseType: SqlDatabaseType.PostgreSQL,
      rawColumns: { blks_hit: 2_000, blks_read: 20 },
      previousCounters: { xact_commit: 1, xact_rollback: 0 },
    });

    expect(MonitorMetricType.DatabaseCacheHitPercent in metrics).toBe(false);
  });

  test("a MySQL ratio never leaves 0-100, whatever the counters do", () => {
    const metrics: Metrics = derive({
      databaseType: SqlDatabaseType.MySQL,
      rawColumns: { bp_read_requests: 1_100, bp_disk_reads: 400 },
      previousCounters: { bp_read_requests: 1_000, bp_disk_reads: 100 },
    });

    // 300 disk reads for 100 requests would be -200%.
    expect(metrics[MonitorMetricType.DatabaseCacheHitPercent]).toBe(0);
  });

  test("SQL Server's buffer cache hit ratio is the engine's own recent figure, read as it is", () => {
    const metrics: Metrics = derive({
      databaseType: SqlDatabaseType.MicrosoftSqlServer,
      rawColumns: {
        buffer_cache_hit_ratio_raw: 90,
        buffer_cache_hit_ratio_base: 100,
      },
    });

    expect(metrics[MonitorMetricType.DatabaseCacheHitPercent]).toBe(90);
  });

  test("counterDelta says how far a counter moved, or nothing", () => {
    expect(
      DatabaseMonitor.counterDelta({
        column: "blks_hit",
        rawColumns: { blks_hit: 15 },
        previousCounters: { blks_hit: 10 },
      }),
    ).toBe(5);
    expect(
      DatabaseMonitor.counterDelta({
        column: "blks_hit",
        rawColumns: { blks_hit: 10 },
        previousCounters: { blks_hit: 10 },
      }),
    ).toBe(0);
    expect(
      DatabaseMonitor.counterDelta({
        column: "blks_hit",
        rawColumns: { blks_hit: 9 },
        previousCounters: { blks_hit: 10 },
      }),
    ).toBeNull();
    expect(
      DatabaseMonitor.counterDelta({
        column: "blks_hit",
        rawColumns: { blks_hit: 9 },
        previousCounters: undefined,
      }),
    ).toBeNull();
    expect(
      DatabaseMonitor.counterDelta({
        column: "blks_hit",
        rawColumns: {},
        previousCounters: { blks_hit: 1 },
      }),
    ).toBeNull();
  });
});

describe("DatabaseCounterHistory keeps the previous check's counters", () => {
  const reading: (
    counters: Record<string, number>,
    at: string,
  ) => DatabaseCounterReading = (
    counters: Record<string, number>,
    at: string,
  ): DatabaseCounterReading => {
    return { counters, readAt: new Date(at) };
  };

  test("the first reading has no previous one; the second gets the first back", () => {
    const history: DatabaseCounterHistory = new DatabaseCounterHistory();

    expect(
      history.swap("a", reading({ blks_hit: 1 }, "2026-10-26T10:00:00Z")),
    ).toBeUndefined();

    const previous: DatabaseCounterReading | undefined = history.swap(
      "a",
      reading({ blks_hit: 5 }, "2026-10-26T10:01:00Z"),
    );

    expect(previous?.counters).toEqual({ blks_hit: 1 });
    expect(previous?.readAt.toISOString()).toBe("2026-10-26T10:00:00.000Z");
    expect(history.size).toBe(1);
  });

  test("keys keep apart", () => {
    const history: DatabaseCounterHistory = new DatabaseCounterHistory();

    history.swap("a", reading({ blks_hit: 1 }, "2026-10-26T10:00:00Z"));
    expect(
      history.swap("b", reading({ blks_hit: 7 }, "2026-10-26T10:00:00Z")),
    ).toBeUndefined();
    expect(
      history.swap("a", reading({ blks_hit: 2 }, "2026-10-26T10:01:00Z"))
        ?.counters,
    ).toEqual({ blks_hit: 1 });
  });

  test("past its size, the monitor checked longest ago is forgotten", () => {
    const history: DatabaseCounterHistory = new DatabaseCounterHistory(3);

    history.swap("a", reading({ blks_hit: 1 }, "2026-10-26T10:00:00Z"));
    history.swap("b", reading({ blks_hit: 1 }, "2026-10-26T10:00:00Z"));
    history.swap("c", reading({ blks_hit: 1 }, "2026-10-26T10:00:00Z"));
    // "a" is checked again, so "b" is now the one checked longest ago.
    history.swap("a", reading({ blks_hit: 2 }, "2026-10-26T10:01:00Z"));
    history.swap("d", reading({ blks_hit: 1 }, "2026-10-26T10:01:00Z"));

    expect(history.size).toBe(3);
    expect(
      history.swap("b", reading({ blks_hit: 9 }, "2026-10-26T10:02:00Z")),
    ).toBeUndefined();
    expect(
      history.swap("a", reading({ blks_hit: 3 }, "2026-10-26T10:02:00Z"))
        ?.counters,
    ).toEqual({ blks_hit: 2 });
  });

  test("a probe's history is bounded by default", () => {
    expect(DATABASE_COUNTER_HISTORY_MAX_ENTRIES).toBeGreaterThanOrEqual(1000);
    expect(DATABASE_COUNTER_HISTORY_MAX_ENTRIES).toBeLessThanOrEqual(100_000);
  });

  test("clear forgets everything, as a probe that just started", () => {
    const history: DatabaseCounterHistory = new DatabaseCounterHistory();

    history.swap("a", reading({ blks_hit: 1 }, "2026-10-26T10:00:00Z"));
    history.clear();

    expect(history.size).toBe(0);
    expect(
      history.swap("a", reading({ blks_hit: 2 }, "2026-10-26T10:01:00Z")),
    ).toBeUndefined();
  });

  test("a key names the monitor and the database, never the password", () => {
    const base: Parameters<typeof getDatabaseCounterHistoryKey>[0] = {
      monitorId: MONITOR_ID,
      databaseType: SqlDatabaseType.PostgreSQL,
      host: "DB.Internal",
      port: 5432,
      databaseName: "orders",
      username: "monitoring",
    };
    const key: string = getDatabaseCounterHistoryKey(base);

    // Host names are not case-sensitive.
    expect(getDatabaseCounterHistoryKey({ ...base, host: "db.internal" })).toBe(
      key,
    );
    // Another monitor, database, port, user or engine is another reading.
    for (const other of [
      { monitorId: OTHER_MONITOR_ID },
      { databaseName: "billing" },
      { port: 5433 },
      { username: "readonly" },
      { databaseType: SqlDatabaseType.MySQL },
      { host: "db2.internal" },
    ]) {
      expect(getDatabaseCounterHistoryKey({ ...base, ...other })).not.toBe(key);
    }
  });

  test("only the counters the ratios are divided from are kept", () => {
    expect(
      pickDatabaseRatioCounters({
        blks_hit: 10,
        blks_read: 1,
        xact_commit: 5,
        xact_rollback: 0,
        bp_read_requests: 7,
        bp_disk_reads: 2,
        numbackends: 30,
        temp_bytes: 4096,
        engine_version_num: 160002,
      }),
    ).toEqual({
      blks_hit: 10,
      blks_read: 1,
      xact_commit: 5,
      xact_rollback: 0,
      bp_read_requests: 7,
      bp_disk_reads: 2,
    });
    expect(pickDatabaseRatioCounters({ numbackends: 30 })).toEqual({});
    expect([...DATABASE_RATIO_COUNTER_COLUMNS].sort()).toEqual([
      "blks_hit",
      "blks_read",
      "bp_disk_reads",
      "bp_read_requests",
      "xact_commit",
      "xact_rollback",
    ]);
  });
});

/*
 * Two real checks in a row, through execute, with the connection stubbed at
 * openSession (the one seam between the monitor and the drivers): the
 * statistics query answers what pg_stat_database would, check by check.
 */
describe("DatabaseMonitor.execute divides each check by the previous one", () => {
  type DatabaseMonitorPrivate = {
    openSession: (input: unknown) => Promise<unknown>;
  };

  interface PostgresCounters {
    blks_hit: number;
    blks_read: number;
    xact_commit: number;
    xact_rollback: number;
  }

  const buildConfig: (
    overrides?: Partial<MonitorStepDatabaseMonitor>,
  ) => MonitorStepDatabaseMonitor = (
    overrides: Partial<MonitorStepDatabaseMonitor> = {},
  ): MonitorStepDatabaseMonitor => {
    return {
      ...MonitorStepDatabaseMonitorUtil.getDefault(),
      databaseType: SqlDatabaseType.PostgreSQL,
      host: "db.internal",
      databaseName: "orders",
      username: "monitoring",
      password: "super-secret",
      enabledMetricGroups: [DatabaseMetricGroup.Throughput],
      ...overrides,
    };
  };

  // Each check reads the next set of counters; a null reads none (failed).
  const stubChecks: (counters: Array<PostgresCounters | null>) => jest.Mock = (
    counters: Array<PostgresCounters | null>,
  ): jest.Mock => {
    const queue: Array<PostgresCounters | null> = [...counters];

    return (
      jest.spyOn(
        DatabaseMonitor as unknown as DatabaseMonitorPrivate,
        "openSession",
      ) as unknown as jest.Mock
    ).mockImplementation(async (): Promise<unknown> => {
      const current: PostgresCounters | null | undefined = queue.shift();

      return {
        runQuery: async (
          sql: string,
        ): Promise<Array<Record<string, unknown>>> => {
          if (sql.includes("engine_version")) {
            return [{ engine_version: "16.2", has_stats_access: true }];
          }

          if (sql.includes("FROM pg_stat_database")) {
            if (!current) {
              throw new Error("canceling statement due to statement timeout");
            }
            // node-postgres hands bigint back as text.
            return [
              {
                blks_hit: String(current.blks_hit),
                blks_read: String(current.blks_read),
                xact_commit: String(current.xact_commit),
                xact_rollback: String(current.xact_rollback),
              },
            ];
          }

          return [];
        },
        close: async (): Promise<void> => {},
      };
    });
  };

  const check: (
    monitorId: string | undefined,
    overrides?: Partial<MonitorStepDatabaseMonitor>,
  ) => Promise<Metrics> = async (
    monitorId: string | undefined,
    overrides?: Partial<MonitorStepDatabaseMonitor>,
  ): Promise<Metrics> => {
    const response: DatabaseMonitorResponse | null =
      await DatabaseMonitor.execute(buildConfig(overrides), {
        retry: 0,
        isOnlineCheckRequest: true,
        monitorId: monitorId ? new ObjectID(monitorId) : undefined,
      });

    expect(response?.isOnline).toBe(true);
    return response?.metrics || {};
  };

  beforeEach(() => {
    DatabaseMonitor.resetCounterHistory();
    jest.spyOn(logger, "debug").mockImplementation((): void => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
    DatabaseMonitor.resetCounterHistory();
  });

  test("the first check carries no ratio, the second the ratio of what moved between them", async () => {
    stubChecks([
      {
        blks_hit: 1_000_000_000,
        blks_read: 200_000,
        xact_commit: 1_000_000,
        xact_rollback: 1_000,
      },
      {
        blks_hit: 1_000_008_000,
        blks_read: 202_000,
        xact_commit: 1_000_090,
        xact_rollback: 1_010,
      },
    ]);

    const first: Metrics = await check(MONITOR_ID);
    expect(MonitorMetricType.DatabaseCacheHitPercent in first).toBe(false);
    expect(MonitorMetricType.DatabaseRollbackPercent in first).toBe(false);
    expect(first[MonitorMetricType.DatabaseTransactionsTotal]).toBe(1_001_000);

    const second: Metrics = await check(MONITOR_ID);
    expect(second[MonitorMetricType.DatabaseCacheHitPercent]).toBe(80);
    expect(second[MonitorMetricType.DatabaseRollbackPercent]).toBe(10);
    expect(second[MonitorMetricType.DatabaseTransactionsTotal]).toBe(1_001_100);
  });

  test("two monitors on the same database each divide by their own previous check", async () => {
    stubChecks([
      { blks_hit: 100, blks_read: 0, xact_commit: 10, xact_rollback: 0 },
      { blks_hit: 1_000, blks_read: 0, xact_commit: 20, xact_rollback: 0 },
      { blks_hit: 1_090, blks_read: 10, xact_commit: 30, xact_rollback: 0 },
    ]);

    await check(MONITOR_ID);
    // Another monitor's first check: nothing to divide by yet.
    const other: Metrics = await check(OTHER_MONITOR_ID);
    expect(MonitorMetricType.DatabaseCacheHitPercent in other).toBe(false);

    // The first monitor divides by ITS previous check (100, 0), not the other's.
    const again: Metrics = await check(MONITOR_ID);
    expect(again[MonitorMetricType.DatabaseCacheHitPercent]).toBeCloseTo(
      (990 / 1_000) * 100,
    );
  });

  test("a check that could not read the counters keeps the previous reading for the next one", async () => {
    stubChecks([
      { blks_hit: 1_000, blks_read: 0, xact_commit: 10, xact_rollback: 0 },
      null,
      { blks_hit: 1_900, blks_read: 100, xact_commit: 20, xact_rollback: 0 },
    ]);

    await check(MONITOR_ID);

    const failed: Metrics = await check(MONITOR_ID);
    expect(MonitorMetricType.DatabaseCacheHitPercent in failed).toBe(false);

    // Divided over both intervals: 900 hits and 100 reads since the first.
    const next: Metrics = await check(MONITOR_ID);
    expect(next[MonitorMetricType.DatabaseCacheHitPercent]).toBe(90);
  });

  test("a check with no monitor - a test run - keeps nothing and carries no ratio", async () => {
    stubChecks([
      { blks_hit: 1_000, blks_read: 0, xact_commit: 10, xact_rollback: 0 },
      { blks_hit: 1_900, blks_read: 100, xact_commit: 20, xact_rollback: 0 },
    ]);

    const first: Metrics = await check(undefined);
    const second: Metrics = await check(undefined);

    expect(MonitorMetricType.DatabaseCacheHitPercent in first).toBe(false);
    expect(MonitorMetricType.DatabaseCacheHitPercent in second).toBe(false);
  });

  test("a monitor pointed at another database starts again", async () => {
    stubChecks([
      { blks_hit: 1_000, blks_read: 0, xact_commit: 10, xact_rollback: 0 },
      { blks_hit: 1_900, blks_read: 100, xact_commit: 20, xact_rollback: 0 },
    ]);

    await check(MONITOR_ID);
    const moved: Metrics = await check(MONITOR_ID, {
      databaseName: "billing",
    });

    expect(MonitorMetricType.DatabaseCacheHitPercent in moved).toBe(false);
  });

  test("a server restart between checks carries no ratio, and the check after it does", async () => {
    stubChecks([
      {
        blks_hit: 9_000_000,
        blks_read: 1_000,
        xact_commit: 500_000,
        xact_rollback: 50,
      },
      // Restarted: every counter began again.
      { blks_hit: 300, blks_read: 50, xact_commit: 12, xact_rollback: 0 },
      { blks_hit: 1_200, blks_read: 150, xact_commit: 32, xact_rollback: 5 },
    ]);

    await check(MONITOR_ID);

    const restarted: Metrics = await check(MONITOR_ID);
    expect(MonitorMetricType.DatabaseCacheHitPercent in restarted).toBe(false);
    expect(MonitorMetricType.DatabaseRollbackPercent in restarted).toBe(false);

    const after: Metrics = await check(MONITOR_ID);
    expect(after[MonitorMetricType.DatabaseCacheHitPercent]).toBe(90);
    expect(after[MonitorMetricType.DatabaseRollbackPercent]).toBe(20);
  });
});
