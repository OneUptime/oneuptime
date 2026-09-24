import {
  DATABASE_SERVER_METRICS,
  DatabaseServerMetricDefinition,
  getDatabaseServerMetrics,
} from "../../../Types/DatabaseServer/DatabaseServerMetricCatalog";
import {
  DatabaseSystemDescriptor,
  getDatabaseSystemDescriptor,
} from "../../../Types/DatabaseServer/DatabaseSystem";
import AggregationType from "../../../Types/BaseDatabase/AggregationType";
import { describe, expect, test } from "@jest/globals";

const CURATED_SYSTEMS: Array<string> = [
  "postgresql",
  "mysql",
  "redis",
  "mongodb",
  "microsoft.sql_server",
  "oracle.db",
];

/*
 * Cumulative monotonic sums per the receivers' metadata.yaml (research map
 * otel-db-receivers.md §2). Each MUST be a "counter" — charting the raw value
 * would draw an ever-rising line.
 */
const KNOWN_CUMULATIVE_COUNTERS: Array<string> = [
  "postgresql.commits",
  "postgresql.rollbacks",
  "mysql.handlers",
  "mysql.row_operations",
  "mysql.row_locks",
  "redis.commands.processed",
  "redis.keyspace.hits",
  "redis.keyspace.misses",
  "redis.keys.evicted",
  "mongodb.operation.count",
  "mongodb.operation.time",
  "mongodb.cache.operations",
  "oracledb.executions",
  "oracledb.user_commits",
  "oracledb.user_rollbacks",
  "oracledb.physical_reads",
];

/*
 * Receiver-computed per-second gauges and point-in-time values: never a
 * counter (a rate of a rate is meaningless).
 */
const KNOWN_GAUGES: Array<string> = [
  "postgresql.backends",
  "postgresql.connection.max",
  "postgresql.db_size",
  "redis.commands",
  "redis.memory.used",
  "sqlserver.batch.request.rate",
  "sqlserver.transaction.rate",
  "sqlserver.lock.wait.rate",
  "sqlserver.page.buffer_cache.hit_ratio",
  "oracledb.sessions.usage",
];

/*
 * Off-by-default receiver metrics (otel-db-receivers.md §8.5). The catalog
 * lists only what a stock receiver emits, so none of these may appear.
 */
const OFF_BY_DEFAULT: Array<string> = [
  "postgresql.deadlocks",
  "postgresql.blks_hit",
  "postgresql.blks_read",
  "postgresql.database.locks",
  "mysql.query.count",
  "mysql.query.slow.count",
  "mysql.commands",
  "mysql.connection.count",
  "mysql.replica.time_behind_source",
  "redis.maxmemory",
  "redis.cmd.latency",
  "mongodb.replica_set.lag",
  "mongodb.lock.deadlock.count",
  "sqlserver.deadlock.rate",
  "sqlserver.processes.blocked",
];

function metricByName(name: string): DatabaseServerMetricDefinition {
  const metric: DatabaseServerMetricDefinition | undefined =
    DATABASE_SERVER_METRICS.find(
      (candidate: DatabaseServerMetricDefinition): boolean => {
        return candidate.metricName === name;
      },
    );
  expect(metric).toBeDefined();
  return metric!;
}

describe("DATABASE_SERVER_METRICS", () => {
  test.each(CURATED_SYSTEMS)("%s has 5-8 curated metrics", (system: string) => {
    const count: number = getDatabaseServerMetrics(system).length;
    expect(count).toBeGreaterThanOrEqual(5);
    expect(count).toBeLessThanOrEqual(8);
  });

  test("only the six curated engines have entries", () => {
    const systems: Set<string> = new Set<string>(
      DATABASE_SERVER_METRICS.map(
        (metric: DatabaseServerMetricDefinition): string => {
          return metric.system;
        },
      ),
    );
    expect(Array.from(systems).sort()).toEqual([...CURATED_SYSTEMS].sort());
  });

  test("metric names are unique and lowercase, as ingest stores them", () => {
    const names: Array<string> = DATABASE_SERVER_METRICS.map(
      (metric: DatabaseServerMetricDefinition): string => {
        return metric.metricName;
      },
    );
    expect(new Set(names).size).toBe(names.length);
    for (const name of names) {
      expect(name).toBe(name.toLowerCase());
      expect(name).toBe(name.trim());
    }
  });

  test("every metric carries its engine's receiver prefix", () => {
    for (const metric of DATABASE_SERVER_METRICS) {
      const descriptor: DatabaseSystemDescriptor | null =
        getDatabaseSystemDescriptor(metric.system);
      expect(descriptor).not.toBeNull();
      expect(
        descriptor!.receiverMetricPrefixes.some((prefix: string): boolean => {
          return metric.metricName.startsWith(prefix);
        }),
      ).toBe(true);
    }
  });

  test("every entry is fully described", () => {
    for (const metric of DATABASE_SERVER_METRICS) {
      expect(metric.title.trim().length).toBeGreaterThan(0);
      expect(metric.description.trim().length).toBeGreaterThan(0);
      expect(metric.unit.trim().length).toBeGreaterThan(0);
      expect(Object.values(AggregationType)).toContain(metric.aggregation);
      expect(["gauge", "counter"]).toContain(metric.kind);
    }
  });

  test("titles are unique within an engine", () => {
    for (const system of CURATED_SYSTEMS) {
      const titles: Array<string> = getDatabaseServerMetrics(system).map(
        (metric: DatabaseServerMetricDefinition): string => {
          return metric.title;
        },
      );
      expect(new Set(titles).size).toBe(titles.length);
    }
  });

  test.each(KNOWN_CUMULATIVE_COUNTERS)(
    "%s is a counter (charted as a rate)",
    (name: string) => {
      expect(metricByName(name).kind).toBe("counter");
    },
  );

  test("counters aggregate with Max (the latest cumulative value per bucket)", () => {
    for (const metric of DATABASE_SERVER_METRICS) {
      if (metric.kind === "counter") {
        expect(metric.aggregation).toBe(AggregationType.Max);
      }
    }
  });

  test.each(KNOWN_GAUGES)("%s is a gauge", (name: string) => {
    expect(metricByName(name).kind).toBe("gauge");
  });

  test("SQL Server's metrics are all receiver-computed gauges", () => {
    for (const metric of getDatabaseServerMetrics("microsoft.sql_server")) {
      expect(metric.kind).toBe("gauge");
    }
  });

  test("every engine has at least one gauge for the Overview tiles", () => {
    for (const system of CURATED_SYSTEMS) {
      expect(
        getDatabaseServerMetrics(system).some(
          (metric: DatabaseServerMetricDefinition): boolean => {
            return metric.kind === "gauge";
          },
        ),
      ).toBe(true);
    }
  });

  test.each(OFF_BY_DEFAULT)(
    "%s (off by default in the receiver) is not curated",
    (name: string) => {
      expect(
        DATABASE_SERVER_METRICS.some(
          (metric: DatabaseServerMetricDefinition): boolean => {
            return metric.metricName === name;
          },
        ),
      ).toBe(false);
    },
  );
});

describe("getDatabaseServerMetrics", () => {
  test("aliases resolve to the engine's list", () => {
    expect(getDatabaseServerMetrics("postgres")).toEqual(
      getDatabaseServerMetrics("postgresql"),
    );
    expect(getDatabaseServerMetrics("MSSQL")).toEqual(
      getDatabaseServerMetrics("microsoft.sql_server"),
    );
    expect(getDatabaseServerMetrics("valkey")).toEqual(
      getDatabaseServerMetrics("redis"),
    );
  });

  test("returns only that engine's metrics, in catalog order", () => {
    const metrics: Array<DatabaseServerMetricDefinition> =
      getDatabaseServerMetrics("redis");
    for (const metric of metrics) {
      expect(metric.system).toBe("redis");
    }
    expect(metrics[0]!.metricName).toBe("redis.clients.connected");
  });

  test("engines without a curated set, and junk, give []", () => {
    expect(getDatabaseServerMetrics("cockroachdb")).toEqual([]);
    expect(getDatabaseServerMetrics("tidb")).toEqual([]);
    expect(getDatabaseServerMetrics("")).toEqual([]);
    expect(getDatabaseServerMetrics(null)).toEqual([]);
    expect(getDatabaseServerMetrics(undefined)).toEqual([]);
  });

  test("the returned array is a copy (callers may not mutate the catalog)", () => {
    const first: Array<DatabaseServerMetricDefinition> =
      getDatabaseServerMetrics("mysql");
    first.pop();
    expect(getDatabaseServerMetrics("mysql").length).toBe(first.length + 1);
  });
});
