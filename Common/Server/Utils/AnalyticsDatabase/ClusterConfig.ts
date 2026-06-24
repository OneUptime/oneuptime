import AnalyticsTableEngine from "../../../Types/AnalyticsDatabase/AnalyticsTableEngine";

/*
 * ClickHouse cluster helpers.
 *
 * OneUptime's analytics schema runs as a sharded + replicated cluster on EVERY
 * deployment — there is no separate single-node code path. A single node is just
 * a "cluster of one": a 1-shard / 1-replica cluster backed by an (embedded)
 * Keeper. For each model:
 *
 *   - the model's `tableName` is a `Distributed` table the app reads from and
 *     writes to (scatter-gather on read, shard-routing on write);
 *   - the data lives in a local `<tableName>Local` table whose engine is the
 *     `Replicated*` variant of the model engine, so each shard's replicas hold a
 *     consistent copy of that shard's data (coordinated through Keeper).
 *
 * Because there is no dual mode, these helpers are unconditional: the storage
 * table is always `<tableName>Local`, the engine is always `Replicated*`, and
 * every object-lifecycle DDL statement carries `ON CLUSTER`.
 *
 * The cluster NAME is read live from process.env (CLICKHOUSE_CLUSTER_NAME,
 * default "oneuptime") so it can be pointed at a differently-named external
 * cluster, and so unit tests can vary it. It must match the cluster defined in
 * the ClickHouse config / ClickHouseInstallation.
 */

export const DEFAULT_CLICKHOUSE_CLUSTER_NAME: string = "oneuptime";
export const DEFAULT_CLICKHOUSE_SHARDING_KEY: string = "cityHash64(projectId)";
export const DEFAULT_CLICKHOUSE_DATABASE: string = "oneuptime";

// Suffix appended to a model's tableName to name its local (data) table.
export const LOCAL_TABLE_SUFFIX: string = "Local";

export function getClickhouseClusterName(): string {
  const name: string = (process.env["CLICKHOUSE_CLUSTER_NAME"] || "").trim();
  return name.length > 0 ? name : DEFAULT_CLICKHOUSE_CLUSTER_NAME;
}

/*
 * Global sharding-key OVERRIDE (CLICKHOUSE_SHARDING_KEY). Empty by default,
 * which means each model's own `shardingKey` is used (see getDistributedEngine).
 * Set it to force one expression across all tables.
 */
export function getClickhouseShardingKeyOverride(): string {
  return (process.env["CLICKHOUSE_SHARDING_KEY"] || "").trim();
}

export function getClickhouseDatabaseName(): string {
  return process.env["CLICKHOUSE_DATABASE"] || DEFAULT_CLICKHOUSE_DATABASE;
}

/*
 * The `ON CLUSTER '<name>'` clause (with a leading space), emitted on every
 * object-lifecycle DDL statement (CREATE TABLE / CREATE MATERIALIZED VIEW /
 * DROP / RENAME) so the object is created or dropped on every node of the
 * cluster. Per-table ALTERs and data mutations on ReplicatedMergeTree propagate
 * through Keeper automatically; emitting ON CLUSTER on them too is harmless and
 * keeps the reconcilers deterministic across replicas.
 */
export function onClusterClause(): string {
  return ` ON CLUSTER '${getClickhouseClusterName()}'`;
}

/*
 * The physical table that stores a model's rows: `<tableName>Local` (a
 * Replicated* table). All schema DDL (columns / indexes / projections) and data
 * mutations (ALTER ... DELETE/UPDATE) target this name; the app-facing
 * `tableName` is the Distributed wrapper.
 */
export function getStorageTableName(tableName: string): string {
  return `${tableName}${LOCAL_TABLE_SUFFIX}`;
}

/*
 * Map a logical model engine to the `Replicated*` engine string for the local
 * storage table, written WITHOUT explicit Keeper-path arguments so it relies on
 * the server's `default_replica_path` / `default_replica_name` macros (the
 * Altinity operator and the bundled embedded-Keeper config both provision these
 * as `/clickhouse/tables/{uuid}/{shard}` and `{replica}`).
 */
export function getStorageEngine(engine: AnalyticsTableEngine): string {
  switch (engine) {
    case AnalyticsTableEngine.AggregatingMergeTree:
      return "ReplicatedAggregatingMergeTree";
    case AnalyticsTableEngine.MergeTree:
    default:
      return "ReplicatedMergeTree";
  }
}

/*
 * The `Distributed(...)` engine string for the app-facing table wrapping a local
 * storage table. The sharding key resolves as: global override
 * (CLICKHOUSE_SHARDING_KEY) > the model's own shardingKey > cityHash64(projectId).
 * internal_replication is configured on the cluster definition (true) so the
 * Distributed table writes each row to one replica per shard and lets
 * ReplicatedMergeTree fan it out.
 */
export function getDistributedEngine(
  localTableName: string,
  modelShardingKey?: string | undefined,
): string {
  const cluster: string = getClickhouseClusterName();
  const database: string = getClickhouseDatabaseName();
  const shardingKey: string =
    getClickhouseShardingKeyOverride() ||
    (modelShardingKey && modelShardingKey.trim().length > 0
      ? modelShardingKey.trim()
      : DEFAULT_CLICKHOUSE_SHARDING_KEY);
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
  if (!tableSettings) {
    return tableSettings;
  }
  return tableSettings.replace(
    /non_replicated_deduplication_window/g,
    "replicated_deduplication_window",
  );
}

/*
 * Rewrite a model's canonical `CREATE MATERIALIZED VIEW … TO <target> AS SELECT
 * … FROM <source> …` statement for the cluster:
 *
 *   1. inject `ON CLUSTER '<name>'` after the view name, so the trigger exists
 *      on every node;
 *   2. point `TO <target>` at the LOCAL target table (`<target>Local`), so each
 *      shard aggregates into its own replicated table;
 *   3. point `FROM <source>` at the LOCAL source table (`<source>Local`), so the
 *      MV fires per-shard on local inserts rather than on the Distributed table.
 *
 * The Distributed wrapper over the target (created by the agg model's own
 * CREATE) then scatter-gathers reads across shards.
 *
 * The replacements are deliberately precise: only the FIRST `TO`/`FROM` clause
 * (the view's target/source) is rewritten, matched on the uppercase keyword our
 * canonical definitions use — so `toStartOfMinute(...)` and aggregate columns
 * are never touched. OneUptime MV definitions are single-source with no JOINs or
 * subqueries, which this relies on.
 */
export function applyClusterToMaterializedViewQuery(query: string): string {
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
