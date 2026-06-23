import AnalyticsTableEngine from "../../../Types/AnalyticsDatabase/AnalyticsTableEngine";

/*
 * ClickHouse cluster-awareness helpers.
 *
 * When CLICKHOUSE_CLUSTER_NAME is set, OneUptime's analytics schema is created
 * as a sharded + replicated cluster:
 *
 *   - the model's `tableName` becomes a `Distributed` table the app reads from
 *     and writes to (scatter-gather on read, shard-routing on write);
 *   - the actual data lives in a local `<tableName>Local` table whose engine is
 *     the `Replicated*` variant of the model engine, so each shard's replicas
 *     hold a consistent copy of that shard's data.
 *
 * When CLICKHOUSE_CLUSTER_NAME is empty (the default) every helper here is a
 * no-op: storage table name == model table name, engine is unchanged, and no
 * ON CLUSTER clause is emitted — i.e. the historical single-node behaviour.
 *
 * These functions intentionally read process.env LIVE (rather than importing
 * the cached EnvironmentConfig consts) so unit tests can toggle cluster mode by
 * setting/clearing the env vars around a call. The keys and defaults mirror the
 * `Clickhouse*` consts in Common/Server/EnvironmentConfig.ts. Env is stable for
 * the lifetime of a real process, so the live read costs nothing at runtime.
 */

export const DEFAULT_CLICKHOUSE_SHARDING_KEY: string = "cityHash64(projectId)";
export const DEFAULT_CLICKHOUSE_DATABASE: string = "oneuptime";

// Suffix appended to a model's tableName to name its local (data) table.
export const LOCAL_TABLE_SUFFIX: string = "Local";

export function getClickhouseClusterName(): string {
  return (process.env["CLICKHOUSE_CLUSTER_NAME"] || "").trim();
}

export function isClickhouseClustered(): boolean {
  return getClickhouseClusterName().length > 0;
}

export function getClickhouseShardingKey(): string {
  return (
    process.env["CLICKHOUSE_SHARDING_KEY"] || DEFAULT_CLICKHOUSE_SHARDING_KEY
  );
}

export function getClickhouseDatabaseName(): string {
  return process.env["CLICKHOUSE_DATABASE"] || DEFAULT_CLICKHOUSE_DATABASE;
}

/*
 * The `ON CLUSTER '<name>'` clause (with a leading space) when clustered, or an
 * empty string otherwise. Used on every object-lifecycle DDL statement
 * (CREATE TABLE / CREATE MATERIALIZED VIEW / DROP) so the object is created or
 * dropped on every node of the cluster. Per-table ALTERs and data mutations are
 * NOT required to carry ON CLUSTER — ReplicatedMergeTree propagates those
 * through Keeper automatically — but emitting it is harmless and keeps the
 * reconcilers deterministic across replicas.
 */
export function onClusterClause(): string {
  if (!isClickhouseClustered()) {
    return "";
  }
  return ` ON CLUSTER '${getClickhouseClusterName()}'`;
}

/*
 * The physical table that actually stores rows for a model. In cluster mode
 * this is `<tableName>Local` (a ReplicatedMergeTree); in single-node mode it is
 * the model's own tableName. All schema DDL (columns / indexes / projections)
 * and data mutations (ALTER ... DELETE/UPDATE) must target this name.
 */
export function getStorageTableName(tableName: string): string {
  return isClickhouseClustered()
    ? `${tableName}${LOCAL_TABLE_SUFFIX}`
    : tableName;
}

/*
 * Map a logical model engine to the engine string used for the local storage
 * table. In cluster mode this is the `Replicated*` variant, written WITHOUT
 * explicit Keeper-path arguments so it relies on the server's
 * `default_replica_path` / `default_replica_name` macros (the Altinity operator
 * provisions these as `/clickhouse/tables/{uuid}/{shard}` and `{replica}`).
 * In single-node mode the engine is unchanged.
 */
export function getStorageEngine(engine: AnalyticsTableEngine): string {
  if (!isClickhouseClustered()) {
    return engine;
  }
  switch (engine) {
    case AnalyticsTableEngine.AggregatingMergeTree:
      return "ReplicatedAggregatingMergeTree";
    case AnalyticsTableEngine.MergeTree:
    default:
      return "ReplicatedMergeTree";
  }
}

/*
 * The `Distributed(...)` engine string for the app-facing table that wraps a
 * local storage table. internal_replication is configured on the cluster
 * definition (the CHI sets it true) so the Distributed table writes each row to
 * a single replica per shard and lets ReplicatedMergeTree fan it out.
 */
export function getDistributedEngine(localTableName: string): string {
  const cluster: string = getClickhouseClusterName();
  const database: string = getClickhouseDatabaseName();
  const shardingKey: string = getClickhouseShardingKey();
  return `Distributed('${cluster}', ${database}, ${localTableName}, ${shardingKey})`;
}

/*
 * ReplicatedMergeTree deduplicates inserts via `replicated_deduplication_window`
 * (coordinated through Keeper), whereas plain MergeTree uses
 * `non_replicated_deduplication_window`. OneUptime's models declare the latter
 * in their tableSettings; rewrite it for the replicated local tables so insert
 * idempotency (retried telemetry batches keyed by a dedup token) is preserved.
 */
export function adaptTableSettingsForStorage(
  tableSettings: string | undefined,
): string | undefined {
  if (!tableSettings || !isClickhouseClustered()) {
    return tableSettings;
  }
  return tableSettings.replace(
    /non_replicated_deduplication_window/g,
    "replicated_deduplication_window",
  );
}

/*
 * Rewrite a model's canonical `CREATE MATERIALIZED VIEW … TO <target> AS SELECT
 * … FROM <source> …` statement for cluster mode:
 *
 *   1. inject `ON CLUSTER '<name>'` after the view name, so the trigger exists
 *      on every node;
 *   2. point `TO <target>` at the LOCAL target table (`<target>Local`), so each
 *      shard aggregates into its own replicated table;
 *   3. point `FROM <source>` at the LOCAL source table (`<source>Local`), so the
 *      MV fires per-shard on local inserts rather than on the Distributed table.
 *
 * The Distributed wrapper over the target (created by the agg model's own
 * CREATE) then scatter-gathers reads across shards. No-op in single-node mode.
 *
 * The replacements are deliberately precise: only the FIRST `TO`/`FROM` clause
 * (the view's target/source) is rewritten, matched on the uppercase keyword our
 * canonical definitions use — so `toStartOfMinute(...)` and aggregate columns
 * are never touched. OneUptime MV definitions are single-source with no JOINs or
 * subqueries, which this relies on.
 */
export function applyClusterToMaterializedViewQuery(query: string): string {
  if (!isClickhouseClustered()) {
    return query;
  }

  const cluster: string = getClickhouseClusterName();

  let result: string = query.replace(
    /^(\s*CREATE\s+MATERIALIZED\s+VIEW\s+(?:IF\s+NOT\s+EXISTS\s+)?[A-Za-z_][A-Za-z0-9_]*)/,
    (match: string): string => {
      return `${match} ON CLUSTER '${cluster}'`;
    },
  );

  result = result.replace(
    /(\bTO\s+)([A-Za-z_][A-Za-z0-9_]*)/,
    (_match: string, lead: string, table: string): string => {
      return `${lead}${getStorageTableName(table)}`;
    },
  );

  result = result.replace(
    /(\bFROM\s+)([A-Za-z_][A-Za-z0-9_]*)/,
    (_match: string, lead: string, table: string): string => {
      return `${lead}${getStorageTableName(table)}`;
    },
  );

  return result;
}
