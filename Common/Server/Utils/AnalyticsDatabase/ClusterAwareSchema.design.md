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

### Sharding key

`CLICKHOUSE_SHARDING_KEY`, default `cityHash64(projectId)`. Co-locates a project's
rows (hence all spans of a trace) on a single shard — better locality, keeps a
trace whole. Correctness does not depend on this (the Distributed read fans out to
all shards regardless); it is a locality/perf choice. Override to `rand()` for even
spread if a single tenant is too large for one shard.

## Gating

Everything is gated by `CLICKHOUSE_CLUSTER_NAME`:

- **empty (default)** → single-node behaviour, byte-for-byte unchanged: plain
  `MergeTree`, no `ON CLUSTER`, no Distributed wrapper, `non_replicated_deduplication_window`.
- **non-empty** → cluster mode as above. Must match the cluster name in the
  ClickHouse config / CHI (the bundled Altinity operator names its cluster
  `oneuptime`).

Live, test-toggleable readers: `Common/Server/Utils/AnalyticsDatabase/ClusterConfig.ts`.
Mirror consts on the documented env surface: `Common/Server/EnvironmentConfig.ts`.

## Engine / settings mapping (cluster mode)

| single-node | cluster (local table) |
|---|---|
| `MergeTree` | `ReplicatedMergeTree` |
| `AggregatingMergeTree` | `ReplicatedAggregatingMergeTree` |
| `non_replicated_deduplication_window` | `replicated_deduplication_window` |

`Replicated*` engines are written **without** explicit Keeper-path args, relying on
the server's `default_replica_path` / `default_replica_name` macros (the Altinity
operator provisions `/clickhouse/tables/{uuid}/{shard}` and `{replica}`).

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
- [ ] **Phase 2** — materialized-view cluster rewiring (structured MV type).
- [ ] **Phase 3** — reconcilers + DML target local table; Distributed kept in sync.
- [ ] **Phase 4** — in-place converter migration.
- [ ] **Phase 5** — Helm wiring + docs.

## Limitations / validation

- End-to-end behaviour (replication, Distributed scatter-gather, MV-on-shard,
  async_insert + dedup token through Distributed) requires a real multi-node
  ClickHouse to validate; unit tests cover DDL generation only.
- Sharding by `projectId` can hotspot a very large single tenant; switch the
  sharding key if needed.
