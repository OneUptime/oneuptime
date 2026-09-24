import {
  DATABASE_SERVER_INSTANCE_ATTRIBUTE_KEYS,
  DATABASE_SERVER_METRICS,
  DatabaseServerMetricDefinition,
  findDatabaseServerMetricByName,
  getDatabaseServerMetricGroupKeys,
  getDatabaseServerMetricId,
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

/*
 * The datapoint attributes each curated metric carries, from the v0.161.0
 * receivers' metadata.yaml (with name_override applied, as ingest stores
 * them). Every one of them splits the metric into several series, so each
 * catalog entry has to say what happens to it: pinned by `attributes`,
 * added up / maxed through `seriesKeys`, or pooled as a repeat through
 * `duplicatedAcross`.
 */
const RECEIVER_DATAPOINT_ATTRIBUTES: Record<string, Array<string>> = {
  "postgresql.backends": ["db.namespace"],
  "postgresql.commits": ["db.namespace"],
  "postgresql.rollbacks": ["db.namespace"],
  "postgresql.db_size": ["db.namespace"],
  "postgresql.replication.data_delay": ["replication_client"],
  "mysql.threads": ["kind"],
  "mysql.buffer_pool.usage": ["status"],
  "mysql.handlers": ["kind"],
  "mysql.row_operations": ["operation"],
  "mysql.row_locks": ["kind"],
  "mongodb.connection.count": ["type", "db.namespace"],
  "mongodb.memory.usage": ["type", "db.namespace"],
  "mongodb.data.size": ["db.namespace"],
  "mongodb.operation.count": ["operation"],
  "mongodb.operation.time": ["operation"],
  "mongodb.cache.operations": ["type"],
  "sqlserver.page.life_expectancy": ["performance_counter.object_name"],
  "oracledb.sessions.usage": [
    "session_type",
    "session_status",
    "oracle.db.pdb",
  ],
  "oracledb.tablespace_size.usage": ["tablespace_name", "oracle.db.pdb"],
  "oracledb.executions": ["oracle.db.pdb"],
  "oracledb.user_commits": ["oracle.db.pdb"],
  "oracledb.user_rollbacks": ["oracle.db.pdb"],
  "oracledb.physical_reads": ["oracle.db.pdb"],
};

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

function entriesNamed(name: string): Array<DatabaseServerMetricDefinition> {
  return DATABASE_SERVER_METRICS.filter(
    (candidate: DatabaseServerMetricDefinition): boolean => {
      return candidate.metricName === name;
    },
  );
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

  test("entry ids are unique; names are lowercase, as ingest stores them", () => {
    const ids: Array<string> = DATABASE_SERVER_METRICS.map(
      (metric: DatabaseServerMetricDefinition): string => {
        return getDatabaseServerMetricId(metric);
      },
    );
    expect(new Set(ids).size).toBe(ids.length);
    for (const metric of DATABASE_SERVER_METRICS) {
      expect(metric.metricName).toBe(metric.metricName.toLowerCase());
      expect(metric.metricName).toBe(metric.metricName.trim());
    }
  });

  test("a metric backs several entries only when each pins a different value", () => {
    const byName: Map<
      string,
      Array<DatabaseServerMetricDefinition>
    > = new Map();
    for (const metric of DATABASE_SERVER_METRICS) {
      byName.set(metric.metricName, [
        ...(byName.get(metric.metricName) || []),
        metric,
      ]);
    }
    for (const [, entries] of byName) {
      if (entries.length < 2) {
        continue;
      }
      for (const entry of entries) {
        expect(Object.keys(entry.attributes || {}).length).toBeGreaterThan(0);
      }
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
      expect(["sum", "max", "min", "avg"]).toContain(metric.seriesCombine);
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

  test("counters read Max per series per bucket, and their rates add up", () => {
    for (const metric of DATABASE_SERVER_METRICS) {
      if (metric.kind === "counter") {
        // The latest cumulative value of ONE series in the bucket.
        expect(metric.aggregation).toBe(AggregationType.Max);
        // Rates of separate series are parts of one total.
        expect(metric.seriesCombine).toBe("sum");
        // Counters are split by their whole attribute set, never by a list.
        expect(metric.seriesKeys).toBeUndefined();
        expect(metric.duplicatedAcross).toBeUndefined();
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

/*
 * The audit's failure scenarios: a tile that averaged MongoDB's available
 * connections into "Connections", averaged MySQL's lifetime Threads_created
 * into "Threads", showed the per-database MEAN of PostgreSQL backends next
 * to the server-wide max_connections, and took the Max of MySQL's row-lock
 * waits and row-lock TIME counters.
 */
describe("how each metric's series combine", () => {
  test.each(Object.keys(RECEIVER_DATAPOINT_ATTRIBUTES))(
    "%s declares what happens to every attribute that splits it",
    (name: string) => {
      const entries: Array<DatabaseServerMetricDefinition> = entriesNamed(name);
      expect(entries.length).toBeGreaterThan(0);

      for (const entry of entries) {
        if (entry.kind === "counter") {
          // Every distinct attribute set is its own series; nothing to list.
          continue;
        }
        const maxOfMax: boolean =
          entry.aggregation === AggregationType.Max &&
          entry.seriesCombine === "max";
        for (const attribute of RECEIVER_DATAPOINT_ATTRIBUTES[name]!) {
          const declared: boolean =
            Object.keys(entry.attributes || {}).includes(attribute) ||
            (entry.seriesKeys || []).includes(attribute) ||
            (entry.duplicatedAcross || []).includes(attribute) ||
            maxOfMax;
          expect({ metric: name, attribute, declared }).toEqual({
            metric: name,
            attribute,
            declared: true,
          });
        }
      }
    },
  );

  test("MongoDB connections are the CURRENT ones, never averaged with available", () => {
    const connections: DatabaseServerMetricDefinition = metricByName(
      "mongodb.connection.count",
    );
    expect(connections.attributes).toEqual({ type: "current" });
    // Repeated once per database by the receiver: pooled, not added up.
    expect(connections.duplicatedAcross).toContain("db.namespace");
    expect(connections.seriesKeys).toBeUndefined();
  });

  test("MongoDB memory is resident memory, not resident averaged with virtual", () => {
    const memory: DatabaseServerMetricDefinition = metricByName(
      "mongodb.memory.usage",
    );
    expect(memory.attributes).toEqual({ type: "resident" });
    expect(memory.title).toBe("Resident memory");
  });

  test("MySQL threads are split into connected and running; created and cached never mix in", () => {
    const threads: Array<DatabaseServerMetricDefinition> =
      entriesNamed("mysql.threads");
    expect(
      threads.map((entry: DatabaseServerMetricDefinition) => {
        return [entry.title, entry.attributes];
      }),
    ).toEqual([
      ["Connected threads", { kind: "connected" }],
      ["Running threads", { kind: "running" }],
    ]);
  });

  test("PostgreSQL connections add up across databases", () => {
    const backends: DatabaseServerMetricDefinition = metricByName(
      "postgresql.backends",
    );
    expect(backends.seriesCombine).toBe("sum");
    expect(backends.seriesKeys).toEqual([
      "db.namespace",
      "resource.postgresql.database.name",
    ]);
  });

  test("the InnoDB buffer pool adds its clean and dirty pages", () => {
    const pool: DatabaseServerMetricDefinition = metricByName(
      "mysql.buffer_pool.usage",
    );
    expect(pool.seriesKeys).toEqual(["status"]);
    expect(pool.seriesCombine).toBe("sum");
  });

  test("Oracle sessions add every type, status and PDB", () => {
    const sessions: DatabaseServerMetricDefinition = metricByName(
      "oracledb.sessions.usage",
    );
    expect(sessions.seriesKeys).toEqual([
      "session_type",
      "session_status",
      "oracle.db.pdb",
    ]);
    expect(sessions.seriesCombine).toBe("sum");
  });

  test("row lock waits count waits, never the cumulative lock time", () => {
    expect(metricByName("mysql.row_locks").attributes).toEqual({
      kind: "waits",
    });
  });

  test("worst-of metrics keep the worst series", () => {
    for (const name of [
      "postgresql.replication.data_delay",
      "postgresql.db_size",
      "postgresql.wal.age",
      "sqlserver.transaction_log.usage",
      "oracledb.tablespace_size.usage",
    ]) {
      expect({ name, combine: metricByName(name).seriesCombine }).toEqual({
        name,
        combine: "max",
      });
    }
    // The member that restarted last, not the longest-running one.
    expect(metricByName("mysql.uptime").seriesCombine).toBe("min");
    expect(metricByName("sqlserver.page.life_expectancy").seriesCombine).toBe(
      "min",
    );
  });

  test("ratios are averaged, never added", () => {
    for (const name of [
      "redis.memory.fragmentation_ratio",
      "sqlserver.page.buffer_cache.hit_ratio",
    ]) {
      expect(metricByName(name).seriesCombine).toBe("avg");
    }
  });

  test("settings are not added up across replicas", () => {
    for (const name of [
      "postgresql.connection.max",
      "postgresql.database.count",
      "mysql.buffer_pool.limit",
      "oracledb.sessions.limit",
    ]) {
      expect(metricByName(name).seriesCombine).toBe("max");
    }
  });
});

describe("getDatabaseServerMetrics", () => {
  test("aliases resolve to the engine's list", () => {
    expect(getDatabaseServerMetrics("postgres")).toEqual(
      getDatabaseServerMetrics("postgresql"),
    );
    expect(getDatabaseServerMetrics("MSSQL")).toEqual(
      getDatabaseServerMetrics("microsoft.sql_server"),
    );
  });

  test("a fork its family's receiver monitors gets the family's set", () => {
    // The redis / mysql receivers report redis.* / mysql.* for these.
    expect(getDatabaseServerMetrics("valkey")).toEqual(
      getDatabaseServerMetrics("redis"),
    );
    expect(getDatabaseServerMetrics("mariadb")).toEqual(
      getDatabaseServerMetrics("mysql"),
    );
    expect(getDatabaseServerMetrics("redis").length).toBeGreaterThan(0);
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

describe("catalog helpers", () => {
  test("an entry's id is its name, plus its pins in key order", () => {
    expect(getDatabaseServerMetricId(metricByName("postgresql.backends"))).toBe(
      "postgresql.backends",
    );
    const [connected, running] = entriesNamed("mysql.threads");
    expect(getDatabaseServerMetricId(connected!)).toBe(
      "mysql.threads{kind=connected}",
    );
    expect(getDatabaseServerMetricId(running!)).toBe(
      "mysql.threads{kind=running}",
    );
    expect(
      getDatabaseServerMetricId({
        ...metricByName("postgresql.backends"),
        attributes: { z: "1", a: "2" },
      }),
    ).toBe("postgresql.backends{a=2,z=1}");
  });

  test("gauges group by their series keys, then the reporting instance", () => {
    expect(
      getDatabaseServerMetricGroupKeys(metricByName("postgresql.backends")),
    ).toEqual([
      "db.namespace",
      "resource.postgresql.database.name",
      ...DATABASE_SERVER_INSTANCE_ATTRIBUTE_KEYS,
    ]);
    expect(
      getDatabaseServerMetricGroupKeys(metricByName("redis.memory.used")),
    ).toEqual(["resource.server.address", "resource.server.port"]);
    expect(
      getDatabaseServerMetricGroupKeys({
        ...metricByName("redis.memory.used"),
        seriesKeys: ["resource.server.address", "x"],
      }),
    ).toEqual(["resource.server.address", "x", "resource.server.port"]);
  });

  test("group keys stay within the server's ten-key limit", () => {
    for (const metric of DATABASE_SERVER_METRICS) {
      expect(getDatabaseServerMetricGroupKeys(metric).length).toBeLessThan(10);
    }
  });

  test("a metric name finds its entry, preferring one that pins nothing", () => {
    expect(
      findDatabaseServerMetricByName("postgres", " postgresql.commits ")?.title,
    ).toBe("Commits");
    // Every mysql.threads entry pins; the first one is used.
    expect(
      findDatabaseServerMetricByName("mysql", "mysql.threads")?.title,
    ).toBe("Connected threads");
    expect(
      findDatabaseServerMetricByName("mysql", "postgresql.commits"),
    ).toBeNull();
    expect(findDatabaseServerMetricByName(null, "mysql.threads")).toBeNull();
    expect(findDatabaseServerMetricByName("mysql", "")).toBeNull();
  });
});
