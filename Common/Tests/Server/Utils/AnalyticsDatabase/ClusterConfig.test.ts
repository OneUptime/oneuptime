import AnalyticsTableEngine from "../../../../Types/AnalyticsDatabase/AnalyticsTableEngine";
import {
  DEFAULT_CLICKHOUSE_CLUSTER_NAME,
  DEFAULT_CLICKHOUSE_DATABASE,
  DEFAULT_CLICKHOUSE_SHARDING_KEY,
  DEFAULT_DISTRIBUTED_DDL_TASK_TIMEOUT_SECONDS,
  LOCAL_TABLE_SUFFIX,
  adaptTableSettingsForStorage,
  applyClusterToMaterializedViewQuery,
  getClickhouseClusterName,
  getClickhouseDatabaseName,
  getClickhouseShardingKeyOverride,
  getDistributedDdlTaskTimeoutSeconds,
  getDistributedEngine,
  getStorageEngine,
  getStorageTableName,
  onClusterClause,
} from "../../../../Server/Utils/AnalyticsDatabase/ClusterConfig";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * These helpers compose the DDL that runs against a customer's ClickHouse
 * cluster - every CREATE TABLE, every materialized view, every migration. A
 * wrong storage table name writes rows nothing reads back; a wrong sharding
 * key scatters one project across shards; an ON CLUSTER clause that goes
 * missing creates an object on one node out of N. None of it was covered.
 *
 * Every value is read live from process.env, so each test arranges the
 * environment and restores it afterwards.
 */

const ENV_KEYS: Array<string> = [
  "CLICKHOUSE_CLUSTER_NAME",
  "CLICKHOUSE_SHARDING_KEY",
  "CLICKHOUSE_DATABASE",
  "CLICKHOUSE_DISTRIBUTED_DDL_TASK_TIMEOUT_SECONDS",
];

const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const key of ENV_KEYS) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = saved[key];
    }
  }
});

describe("cluster identity from the environment", () => {
  test("an unset cluster name falls back to the shipped default", () => {
    expect(getClickhouseClusterName()).toBe(DEFAULT_CLICKHOUSE_CLUSTER_NAME);
  });

  test("a set cluster name is used, trimmed", () => {
    process.env["CLICKHOUSE_CLUSTER_NAME"] = "  analytics-eu  ";

    expect(getClickhouseClusterName()).toBe("analytics-eu");
  });

  test("a whitespace-only cluster name is treated as unset, never as an empty cluster", () => {
    process.env["CLICKHOUSE_CLUSTER_NAME"] = "   ";

    expect(getClickhouseClusterName()).toBe(DEFAULT_CLICKHOUSE_CLUSTER_NAME);
  });

  test("the database name defaults, and is used verbatim when set", () => {
    expect(getClickhouseDatabaseName()).toBe(DEFAULT_CLICKHOUSE_DATABASE);

    process.env["CLICKHOUSE_DATABASE"] = "telemetry";

    expect(getClickhouseDatabaseName()).toBe("telemetry");
  });

  test("the sharding-key override is empty unless an operator sets one", () => {
    expect(getClickhouseShardingKeyOverride()).toBe("");

    process.env["CLICKHOUSE_SHARDING_KEY"] = "  cityHash64(serviceId)  ";

    expect(getClickhouseShardingKeyOverride()).toBe("cityHash64(serviceId)");
  });
});

describe("the distributed DDL task timeout", () => {
  test("unset means the ClickHouse server default", () => {
    expect(getDistributedDdlTaskTimeoutSeconds()).toBe(
      DEFAULT_DISTRIBUTED_DDL_TASK_TIMEOUT_SECONDS,
    );
  });

  test("a number is honoured", () => {
    process.env["CLICKHOUSE_DISTRIBUTED_DDL_TASK_TIMEOUT_SECONDS"] = "900";

    expect(getDistributedDdlTaskTimeoutSeconds()).toBe(900);
  });

  test("zero is honoured: it means enqueue and return, and must not read as unset", () => {
    process.env["CLICKHOUSE_DISTRIBUTED_DDL_TASK_TIMEOUT_SECONDS"] = "0";

    expect(getDistributedDdlTaskTimeoutSeconds()).toBe(0);
  });

  test("a negative value is honoured: it removes the server-side wait limit", () => {
    process.env["CLICKHOUSE_DISTRIBUTED_DDL_TASK_TIMEOUT_SECONDS"] = "-1";

    expect(getDistributedDdlTaskTimeoutSeconds()).toBe(-1);
  });

  test("nonsense falls back to the default rather than to NaN", () => {
    for (const raw of ["", "   ", "not-a-number"]) {
      process.env["CLICKHOUSE_DISTRIBUTED_DDL_TASK_TIMEOUT_SECONDS"] = raw;

      expect(getDistributedDdlTaskTimeoutSeconds()).toBe(
        DEFAULT_DISTRIBUTED_DDL_TASK_TIMEOUT_SECONDS,
      );
    }
  });
});

describe("onClusterClause", () => {
  test("it carries a leading space so it can be concatenated straight into DDL", () => {
    expect(onClusterClause()).toBe(
      ` ON CLUSTER '${DEFAULT_CLICKHOUSE_CLUSTER_NAME}'`,
    );
    expect(onClusterClause().startsWith(" ")).toBe(true);
  });

  test("the cluster name is quoted, so a name with a hyphen is still valid", () => {
    process.env["CLICKHOUSE_CLUSTER_NAME"] = "analytics-eu";

    expect(onClusterClause()).toBe(" ON CLUSTER 'analytics-eu'");
  });
});

describe("storage table and engine", () => {
  test("the storage table is the model's table plus the local suffix", () => {
    expect(getStorageTableName("Span")).toBe(`Span${LOCAL_TABLE_SUFFIX}`);
    expect(getStorageTableName("Span")).toBe("SpanLocal");
  });

  test("every model engine maps to its Replicated variant", () => {
    expect(getStorageEngine(AnalyticsTableEngine.MergeTree)).toBe(
      "ReplicatedMergeTree",
    );
    expect(getStorageEngine(AnalyticsTableEngine.AggregatingMergeTree)).toBe(
      "ReplicatedAggregatingMergeTree",
    );
    /* The version column has to be carried through, or dedupe silently changes. */
    expect(getStorageEngine(AnalyticsTableEngine.ReplacingMergeTree)).toBe(
      "ReplicatedReplacingMergeTree(version)",
    );
  });

  test("an unknown engine falls back to plain replication rather than to nothing", () => {
    expect(
      getStorageEngine("SomethingElse" as unknown as AnalyticsTableEngine),
    ).toBe("ReplicatedMergeTree");
  });

  test("no engine is ever emitted without the Replicated prefix", () => {
    for (const engine of Object.values(AnalyticsTableEngine)) {
      expect(
        getStorageEngine(engine as AnalyticsTableEngine).startsWith(
          "Replicated",
        ),
      ).toBe(true);
    }
  });
});

describe("the Distributed engine string", () => {
  test("it names the cluster, database, local table and sharding key in order", () => {
    expect(getDistributedEngine("SpanLocal")).toBe(
      `Distributed('${DEFAULT_CLICKHOUSE_CLUSTER_NAME}', ${DEFAULT_CLICKHOUSE_DATABASE}, SpanLocal, ${DEFAULT_CLICKHOUSE_SHARDING_KEY})`,
    );
  });

  test("a model's own sharding key wins over the shipped default", () => {
    expect(getDistributedEngine("SpanLocal", "cityHash64(traceId)")).toContain(
      "cityHash64(traceId)",
    );
  });

  test("a blank model sharding key is ignored, not emitted as an empty expression", () => {
    expect(getDistributedEngine("SpanLocal", "   ")).toContain(
      DEFAULT_CLICKHOUSE_SHARDING_KEY,
    );
  });

  test("the global override beats the model's own key", () => {
    process.env["CLICKHOUSE_SHARDING_KEY"] = "cityHash64(tenantId)";

    const engine: string = getDistributedEngine(
      "SpanLocal",
      "cityHash64(traceId)",
    );

    expect(engine).toContain("cityHash64(tenantId)");
    expect(engine).not.toContain("cityHash64(traceId)");
  });

  test("the cluster and database it names are the configured ones", () => {
    process.env["CLICKHOUSE_CLUSTER_NAME"] = "analytics-eu";
    process.env["CLICKHOUSE_DATABASE"] = "telemetry";

    expect(getDistributedEngine("SpanLocal")).toBe(
      `Distributed('analytics-eu', telemetry, SpanLocal, ${DEFAULT_CLICKHOUSE_SHARDING_KEY})`,
    );
  });
});

describe("adaptTableSettingsForStorage", () => {
  test("the non-replicated dedupe window is rewritten for a replicated table", () => {
    expect(
      adaptTableSettingsForStorage(
        "non_replicated_deduplication_window = 1000",
      ),
    ).toBe("replicated_deduplication_window = 1000");
  });

  test("every occurrence is rewritten, not just the first", () => {
    const result: string | undefined = adaptTableSettingsForStorage(
      "non_replicated_deduplication_window = 100, x = 1, non_replicated_deduplication_window = 200",
    );

    expect(result).not.toContain("non_replicated_deduplication_window");
    expect(
      (result || "").match(/replicated_deduplication_window/g)?.length,
    ).toBe(2);
  });

  test("other settings are untouched", () => {
    expect(adaptTableSettingsForStorage("index_granularity = 8192")).toBe(
      "index_granularity = 8192",
    );
  });

  test("undefined stays undefined, and an empty string stays empty", () => {
    expect(adaptTableSettingsForStorage(undefined)).toBeUndefined();
    expect(adaptTableSettingsForStorage("")).toBe("");
  });
});

describe("applyClusterToMaterializedViewQuery", () => {
  const QUERY: string =
    "CREATE MATERIALIZED VIEW MetricAggregate TO MetricRollup AS SELECT toStartOfMinute(time) AS bucket, sum(value) FROM Metric GROUP BY bucket";

  test("the view is created on every node", () => {
    expect(applyClusterToMaterializedViewQuery(QUERY)).toContain(
      `CREATE MATERIALIZED VIEW MetricAggregate ON CLUSTER '${DEFAULT_CLICKHOUSE_CLUSTER_NAME}'`,
    );
  });

  test("both the target and the source become the local tables", () => {
    const result: string = applyClusterToMaterializedViewQuery(QUERY);

    expect(result).toContain("TO MetricRollupLocal");
    expect(result).toContain("FROM MetricLocal");
  });

  test("toStartOfMinute survives: only the TO keyword clause is rewritten", () => {
    /*
     * The rewrite matches on the word boundary of an uppercase TO. A regex
     * that caught "toStartOfMinute" would corrupt every aggregation in the
     * schema, and the view would still be created.
     */
    expect(applyClusterToMaterializedViewQuery(QUERY)).toContain(
      "toStartOfMinute(time)",
    );
  });

  test("IF NOT EXISTS is preserved and the clause lands after the view name", () => {
    const result: string = applyClusterToMaterializedViewQuery(
      "CREATE MATERIALIZED VIEW IF NOT EXISTS MetricAggregate TO MetricRollup AS SELECT 1 FROM Metric",
    );

    expect(result).toContain(
      `CREATE MATERIALIZED VIEW IF NOT EXISTS MetricAggregate ON CLUSTER '${DEFAULT_CLICKHOUSE_CLUSTER_NAME}'`,
    );
  });

  test("the configured cluster name is the one emitted", () => {
    process.env["CLICKHOUSE_CLUSTER_NAME"] = "analytics-eu";

    expect(applyClusterToMaterializedViewQuery(QUERY)).toContain(
      "ON CLUSTER 'analytics-eu'",
    );
  });

  test("only the FIRST TO and FROM are rewritten, so a later one is left alone", () => {
    const result: string = applyClusterToMaterializedViewQuery(
      "CREATE MATERIALIZED VIEW V TO Target AS SELECT 1 FROM Source WHERE x IN (SELECT y FROM Other)",
    );

    expect(result).toContain("TO TargetLocal");
    expect(result).toContain("FROM SourceLocal");
    expect(result).toContain("FROM Other)");
  });

  test("a query that is not a CREATE MATERIALIZED VIEW gets no ON CLUSTER injected", () => {
    const result: string = applyClusterToMaterializedViewQuery(
      "SELECT 1 FROM Metric",
    );

    expect(result).not.toContain("ON CLUSTER");
  });
});
