# Cluster-aware ClickHouse analytics schema

## Why

OneUptime's analytics tables (`Span`, `Log`, `Metric`, …) were always created as
plain `MergeTree` with **no** `ReplicatedMergeTree` / `Distributed` / `ON CLUSTER`.
If ClickHouse is deployed as more than one node (e.g. the Altinity-operator path
with `cluster.shardsCount` / `replicasCount` > 1, or a scaled StatefulSet), each
node holds an **independent, un-replicated** subset of telemetry. Ingest lands on
one node; the app's reads round-robin across all nodes via the Service, so any
given span/trace is visible only on the fraction of reads that hit the node that
holds it. Symptom: the trace UI intermittently shows "Span not found" / "No spans
found" for data that exists. (See memory `clickhouse-split-data-span-not-found`.)

This change makes the schema **cluster-aware**: sharded + replicated, so reads are
consistent and the cluster is HA.

## Topology

`shardsCount = S`, `replicasCount = R`:

- **Local table** `<tableName>Local` — `Replicated{Aggregating}MergeTree`. Holds
  one shard's rows; the shard's `R` replicas keep consistent copies (coordinated
  by Keeper).
- **Distributed table** `<tableName>` (the model's own `tableName`, unchanged) —
  `Distributed('<cluster>', <db>, <tableName>Local, <shardingKey>)`. The app reads
  from and writes to this. Reads scatter-gather across all `S` shards; writes route
  by sharding key (with `internal_replication=true` so each row is written to one
  replica per shard and `ReplicatedMergeTree` fans it out).

Because the **app-facing name is the Distributed table**, the entire
read / write / query-generation layer is unchanged — only schema *creation* changes.

### Sharding key (per model)

The sharding key is a **per-model property** (`AnalyticsBaseModel.shardingKey`),
chosen to be high-cardinality (so a big tenant spreads evenly) and to co-locate
what you read/aggregate together. Correctness never depends on it — the Distributed
read fans out to all shards regardless; it is purely a distribution/locality choice.

| Model | shardingKey |
|---|---|
| Span | `cityHash64(traceId)` |
| Log | `cityHash64(traceId)` |
| Metric / agg MVs | `cityHash64(projectId, name, primaryEntityId)` (the series) |
| ExceptionInstance | `cityHash64(projectId, fingerprint)` |
| MonitorLog | `cityHash64(monitorId)` |
| Profile / ProfileSample | `cityHash64(projectId, primaryEntityId)` / `cityHash64(profileId)` |
| AuditLog | `cityHash64(projectId, resourceId)` |

`projectId` was the original key but is a **bad** choice: low cardinality (few
projects) → uneven shards and a big tenant hotspots one shard. The Metric/agg keys
align with the rollup MV `GROUP BY` so each series' states stay on one shard.
Resolution order: `CLICKHOUSE_SHARDING_KEY` (global override) → model `shardingKey`
→ `cityHash64(projectId)` fallback.

## Always-on (no dual mode)

There is **no** single-node-vs-cluster branch: the schema is ALWAYS Distributed over
local `ReplicatedMergeTree`. A single node is a "cluster of one" (1 shard, 1 replica)
backed by an **embedded** ClickHouse Keeper. `CLICKHOUSE_CLUSTER_NAME` defaults to
`oneuptime` and only selects WHICH cluster to target; it can never disable clustering.

This means **every** deployment needs a Keeper:
- bundled StatefulSet / Docker Compose → embedded Keeper + a 1-node `oneuptime`
  cluster, configured in `Clickhouse/config.d/cluster.xml` and the Helm
  `clickhouse.configuration` (a `config.d` drop-in);
- Altinity operator → its bundled Keeper ensemble + CHI cluster;
- external ClickHouse → the operator MUST provide a Keeper + a cluster named via
  `externalClickhouse.clusterName`.

Helpers: `Common/Server/Utils/AnalyticsDatabase/ClusterConfig.ts` (live env readers);
documented env surface: `Common/Server/EnvironmentConfig.ts`.

## Engine / settings mapping

| logical (model) | storage (local table) |
|---|---|
| `MergeTree` | `ReplicatedMergeTree` |
| `AggregatingMergeTree` | `ReplicatedAggregatingMergeTree` |
| `non_replicated_deduplication_window` | `replicated_deduplication_window` |

`Replicated*` engines are written **without** explicit Keeper-path args, relying on
the server's `default_replica_path` / `default_replica_name` macros
(`/clickhouse/tables/{uuid}/{shard}` and `{replica}`) — provisioned by the embedded
Keeper config and the Altinity operator alike.

## DDL rules

- `ON CLUSTER '<name>'` is required only on **object-lifecycle** DDL: `CREATE TABLE`,
  `CREATE MATERIALIZED VIEW`, `DROP TABLE/VIEW`. These create/drop the object on every
  node; replication does **not** propagate object existence.
- Per-table `ALTER` (ADD/DROP/MODIFY COLUMN, ADD/DROP INDEX, ADD/MATERIALIZE
  PROJECTION) and data mutations replicate automatically through Keeper, so they do
  **not** need `ON CLUSTER`. They DO need to target the **local** table
  (`<tableName>Local`), since you cannot alter a `Distributed` table's columns.
- After a column add/drop on the local table, the **Distributed** wrapper must be
  recreated (`DROP` + `CREATE ... AS <local>`) so its layout matches. The Distributed
  table holds no data, so recreation is cheap. (Phase 3.)
- Lightweight `DELETE FROM` / `ALTER UPDATE` are not supported on `Distributed`; in
  cluster mode they become `ALTER TABLE <local> ON CLUSTER ... DELETE/UPDATE`
  mutations. (Phase 3.)

## Materialized views (Phase 2)

Each MV pipeline (3 today, all sourced from `MetricItemV3`) becomes, in cluster mode:

- source local `MetricItemV3Local` (Replicated) →
- MV trigger `…_mv ON CLUSTER` reading the **local** source, writing the **local**
  target →
- target local `<target>Local` (ReplicatedAggregatingMergeTree) →
- Distributed `<target>` over the target for reads.

The MV must read/write **local** tables (so each shard aggregates its own inserts).
The `MaterializedView` type is refactored from a single opaque `query` string into a
structured `{ name, to, from, select }` so cluster naming + `ON CLUSTER` can be
injected programmatically instead of string-rewriting raw SQL.

## In-place converter (Phase 4)

Existing non-replicated `MergeTree` tables cannot be converted by
`CREATE … IF NOT EXISTS`. A guarded data-migration will, per table:

1. rename old `<table>` → `<table>_preclustered` (per node),
2. let `createTables` build `<table>Local` (Replicated) + `<table>` (Distributed) `ON CLUSTER`,
3. `INSERT INTO <table> SELECT * FROM <table>_preclustered` — routes/re-shards/
   replicates the old rows; run on **each** physical node so split data is fully
   recovered,
4. verify counts, then drop `<table>_preclustered`.

Idempotent + guarded; documented as needing a maintenance window. For already-split
multi-node data (the original incident) the per-node re-insert is what reunifies it.

## Helm (Phase 5)

- `_helpers.tpl` → `oneuptime.env.runtime`: set `CLICKHOUSE_CLUSTER_NAME` to
  `oneuptime` when the Altinity operator is enabled, else empty (single-node
  StatefulSet). Auto-propagates to app / worker / migrate.
- CHI: ensure `internal_replication: true` and the `default_replica_path` /
  `default_replica_name` macros.
- Document topology + converter in `HelmChart/Docs/Clickhouse.md`.

## Phase status

- [x] **Phase 1** — config + `ClusterConfig` helper + `StatementGenerator`
  (local Replicated CREATE + Distributed wrapper + ALTER retargeting) + unit tests.
- [x] **Phase 2** — materialized-view cluster rewiring via
  `applyClusterToMaterializedViewQuery` (injects ON CLUSTER, retargets TO/FROM at
  `*Local`); MV drift check already tolerant (base names ⊂ `*Local`). + unit tests.
- [x] **Phase 3** — reconcilers (`system.*` lookups), ALTER/DML (delete/update),
  and codec/column checks target the local table; `createTables` creates + re-syncs
  the Distributed wrapper, guarded so it never clobbers legacy single-node data.
- [x] **Phase 4** — `ConvertAnalyticsTablesToCluster` in-place converter +
  `DataMigrationBase.runsInClusterMode()` baseline hook + runner support; all legacy
  ClickHouse-DDL migrations gated off (boot builds the schema).
- [x] **Phase 5** — Helm: `CLICKHOUSE_CLUSTER_NAME` / `CLICKHOUSE_SHARDING_KEY`
  wired in `oneuptime.env.runtime`, CHI cluster name shared via `cluster.name`,
  values + values.schema.json, and `HelmChart/Docs/Clickhouse.md`.
- [x] **Unify (Q1)** — removed the single-node branch; schema is always Replicated +
  Distributed. Embedded Keeper + 1-node `oneuptime` cluster added to
  `Clickhouse/config.d/cluster.xml`, the Helm `clickhouse.configuration` drop-in, and
  the base Docker Compose mount. `CLICKHOUSE_CLUSTER_NAME` defaults to `oneuptime`
  everywhere (operator / built-in / external).
- [x] **Per-model shard keys (Q2)** — `AnalyticsBaseModel.shardingKey` set per model.

## Limitations / validation

> **CRITICAL — needs a real-ClickHouse smoke-test before merge.** Because the schema
> is now always `ReplicatedMergeTree`, ClickHouse MUST have a reachable Keeper and the
> `oneuptime` cluster defined, or boot fails to create tables. The embedded-Keeper
> config (`Clickhouse/config.d/cluster.xml` + Helm `clickhouse.configuration`) is
> **unvalidated against a live boot** in this change — verify a single-node ClickHouse
> starts, creates the `*Local`/Distributed tables, and ingests/reads before shipping.

- End-to-end behaviour (replication, Distributed scatter-gather, MV-on-shard,
  async_insert + dedup token through Distributed, the converter's `cluster()` copy)
  requires a real ClickHouse to validate; unit tests cover DDL generation only.
- Sharding keys are per-model now; a very large single tenant could still hotspot if
  its co-location key (e.g. one giant trace) is skewed — switch the
  sharding key if needed.
