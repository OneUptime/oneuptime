# ClickHouse Partitioning & Scaling Strategy

Status: Proposal
Owner: TBD
Last updated: 2026-06-09

## Summary

Every OneUptime analytics (ClickHouse) table partitions by `sipHash64(projectId) % 16` — a **project hash with no time component**. For append-only, time-bounded, TTL-expired telemetry this is the wrong partitioning axis. This document proposes switching to **time-based partitioning** and records the reasoning for the alternatives that were considered and rejected, plus the real scaling story for high-volume single-project deployments.

The core changes:

1. Partition the high-volume signal tables by **`toYYYYMMDD(time)`** (daily) and the long-retention / rollup tables by **`toYYYYMM(...)`** (monthly). Drop the `projectId` hash from the partition key; keep `projectId` as the first `ORDER BY` key (unchanged).
2. Set **`ttl_only_drop_parts = 1`** so expired partitions are dropped wholesale instead of rewritten.
3. Treat **partition key** and **shard key** as two different jobs (table below). Partitioning is a single-node lifecycle mechanism; it does not add capacity.
4. Document the scaling ladder for a single high-volume project (vertical → reduce volume → tiered storage → horizontal sharding), and flag that true horizontal scale requires a `Distributed`/`ReplicatedMergeTree` layer OneUptime does **not** have today.

A partition key cannot be altered in place in ClickHouse, so this is a **new-table (`…V3`) + copy + swap** migration for existing installs; new installs pick up the new key for free via a one-line model change.

This is independent of, but lands naturally alongside, the additive entity-membership work in [`OpenTelemetryEntities.md`](./OpenTelemetryEntities.md) — see [Interaction with the entity model](#interaction-with-the-entity-model).

---

## Background

### Current scheme (verified)

All 11 analytics models share the same partition expression. Verified in `Common/Models/AnalyticsModels/` and emitted by [`StatementGenerator.toTableCreateStatement()`](../../Common/Server/Utils/AnalyticsDatabase/StatementGenerator.ts) as `PARTITION BY (${model.partitionKey})`:

| Model (ClickHouse table) | Engine | `ORDER BY` / sort key | Partition key | TTL |
|---|---|---|---|---|
| `Log` (`LogItemV2`) | MergeTree | `projectId, time, serviceId` | `sipHash64(projectId) % 16` | `retentionDate DELETE` |
| `Metric` (`MetricItemV2`) | MergeTree | `projectId, name, serviceId, time` | `sipHash64(projectId) % 16` | `retentionDate DELETE` |
| `Span` (`SpanItemV2`) | MergeTree | `projectId, startTime, serviceId, traceId` | `sipHash64(projectId) % 16` | `retentionDate DELETE` |
| `ExceptionInstance` (`ExceptionItemV2`) | MergeTree | `projectId, time, serviceId, fingerprint` | `sipHash64(projectId) % 16` | `retentionDate DELETE` |
| `ProfileSample` (`ProfileSampleItemV2`) | MergeTree | `projectId, time, …` | `sipHash64(projectId) % 16` | `retentionDate DELETE` |
| `Profile` (`ProfileItemV2`) | MergeTree | `projectId, startTime, serviceId, profileType` | `sipHash64(projectId) % 16` | `retentionDate DELETE` |
| `MonitorLog` (`MonitorLogV2`) | MergeTree | `projectId, time, monitorId` | `sipHash64(projectId) % 16` | `retentionDate DELETE` |
| `AuditLog` (`AuditLogV1`) | MergeTree | `projectId, createdAt, resourceType, resourceId` | `sipHash64(projectId) % 16` | `retentionDate DELETE` |
| `MetricItemAggMV1m` | AggregatingMergeTree | `projectId, name, serviceId, bucketTime` | `sipHash64(projectId) % 16` | `retentionDate DELETE` |
| `MetricItemAggMV1mByHost` | AggregatingMergeTree | `projectId, name, hostIdentifier, bucketTime` | `sipHash64(projectId) % 16` | `retentionDate DELETE` |
| `MetricBaselineHourly` | AggregatingMergeTree | `projectId, name, serviceId, hourOfWeek, day` | `sipHash64(projectId) % 16` | `day + INTERVAL 90 DAY` |

Other relevant facts:

- `time` / `startTime` / `bucketTime` are `DateTime64`; `time` is already the **second sort key** on most tables, so time-range queries already prune at the *granule* level via the sparse primary index.
- `retentionDate` is a per-row `Date`, computed at ingest as `time + service.retainTelemetryDataForDays` — so retention varies per service.
- Engines are plain `MergeTree` / `AggregatingMergeTree`. There is **no `Distributed` table and no `ReplicatedMergeTree`** anywhere in the models or app code — ClickHouse runs single-node. (The `<remote_servers>` / `<shard>` blocks in `Clickhouse/config.xml` are ClickHouse's stock example cluster, not OneUptime config.)
- `async_insert = 1, wait_for_async_insert = 0` is already set in [`AnalyticsDatabaseService.ts`](../../Common/Server/Services/AnalyticsDatabaseService.ts).
- Tiered storage (`storage_configuration` / S3 disk / `TTL … TO VOLUME`) is **not** wired up — no model uses a storage policy.

---

## Problem

A `sipHash64(projectId) % 16` partition key gives exactly 16 buckets per table, forever, each holding **all of history** for the projects that hash into it. For time-series telemetry that produces four problems:

1. **TTL can never drop a partition — it rewrites parts.** Because the hash is time-independent, every bucket always contains the oldest *and* newest rows for its projects. No bucket is ever wholly expired, so `retentionDate DELETE` can only be enforced by **TTL merges that read each part and rewrite it** to evict expired rows — rewriting multi-GB parts to remove a few percent of rows. With a time-based key, expired data forms whole partitions that are dropped as an instant metadata op.

2. **No partition pruning by time.** Telemetry queries are almost always time-bounded ("last 1h / 24h"). Today a time filter prunes nothing at the partition level — it must consult the sparse index across all 16 buckets. Time-based partitioning prunes a 1h query to one partition before touching the index, cutting parts/marks scanned and peak memory (relevant to the memory-pressure findings in the broader ClickHouse audit).

3. **The hash is a no-op for single-project deployments.** Many self-hosted installs have **one project**. A single `projectId` hashes to one constant bucket — 7 of 8 (or 15 of 16) buckets sit empty and the whole "spread" collapses to one. The project hash buys nothing for exactly the deployments most likely to be high-volume.

4. **Unbounded partition growth.** 16 buckets holding all history grow without limit; merges get larger and slower. Daily/monthly partitions bound each partition's size and keep merges small and parallel.

The hash's only real benefit — ~16× partition pruning for single-project queries in a multi-tenant instance — is largely redundant because `projectId` is already the first sort key, so project filtering is handled by the primary index regardless.

---

## Proposed Design

### 1. Partition by time; keep `projectId` as the first sort key

| Tier | Tables | New `PARTITION BY` |
|---|---|---|
| High-volume raw signals | `Log`, `Metric`, `Span`, `ExceptionInstance`, `ProfileSample`, `Profile`, `MonitorLog` | `toYYYYMMDD(time)` (daily); `startTime` for Span/Profile |
| Long-retention / low-volume | `AuditLog` | `toYYYYMM(createdAt)` (monthly) |
| Rollup MVs | `MetricItemAggMV1m`, `MetricItemAggMV1mByHost` | `toYYYYMM(bucketTime)` (monthly) |
| Baseline | `MetricBaselineHourly` | `toYYYYMM(day)` (monthly; already TTL `day + INTERVAL 90 DAY`) |

`projectId` stays the first `ORDER BY` key on every table, so project locality and pruning are preserved at the primary-index level. No sort/primary key changes.

**Why daily for raw signals, not monthly.** Partitions are global across all tenants (no project dimension), so the live count is just the retention window — e.g. 30-day retention ≈ 30 partitions, dropped as they age out. Daily means TTL drops at most ~1 extra day of data; monthly would hold up to a full extra month before a partition becomes droppable.

**Why monthly for long-retention/rollup tables.** Keeps the partition count small for data kept for months/years while remaining monotonic (so pruning and partition-drop TTL still work). `toYYYYMM` over even 3 years is 36 partitions.

### 2. `ttl_only_drop_parts = 1`

Set per-table so ClickHouse drops a whole expired partition's parts instead of rewriting them. Caveat from the per-row, per-service `retentionDate`: a partition only becomes droppable when its **longest-retention** row expires, so an instance mixing 7-day and 365-day retention in one day holds that day for 365 days. Mitigations: keep the row-level `retentionDate DELETE` TTL as the correctness backstop, and/or only enable `ttl_only_drop_parts` where retention is fairly uniform. The query-pruning win is unconditional regardless.

### 3. Partition key vs shard key — two different jobs

This is the crux of the whole analysis. They are not interchangeable, and "spread load evenly" belongs on the shard key, never the partition key.

| Key | Job | Right choice |
|---|---|---|
| `PARTITION BY` | lifecycle on one node (pruning, TTL drops) | `toYYYYMMDD(time)` |
| Sharding key (Distributed) | spread capacity across nodes | high-cardinality (`traceId` / `rand`) — never `projectId` |

A partition key **does not add capacity** — it organizes data on one node. Spreading rows across nodes is the shard key's job, and it must be high-cardinality so that even a single-project firehose distributes evenly (`projectId` would pin one project to one shard — the same no-op as problem #3 above).

### 4. Rejected alternatives

Recorded so they are not relitigated.

- **`projectId` raw in the partition key** (`(projectId, toYYYYMMDD(time))`). Cardinality explosion: projects × days. 1,000 projects × 30 days = 30,000 partitions/table. Hard no.
- **Hashed project bucket + time** (`(sipHash64(projectId) % 8, toYYYYMMDD(time))`). The only *bounded* way to keep a project dimension, and a defensible knob for a large multi-tenant instance that has **measured** per-project scan volume as the bottleneck (and ingest is per-project, so inserts still hit one bucket → no fan-out). But it multiplies partition/part count ~8×, adds startup-memory and merge overhead, is a **no-op for single-project installs**, and provides a query benefit the `projectId` sort key largely already gives. Not the default.
- **Combined hash of project + date** (`(sipHash64(projectId) + toYYYYMMDD(time)) % 24`, to "use all buckets equally"). **Breaks everything.** Partition pruning on a range requires the partition expression to be *monotonic* in the column; a modulo bucket is deliberately non-monotonic, so time-range pruning is disabled, and no bucket is ever wholly old, so TTL partition-drops are gone. It optimizes for even distribution (a non-goal on a single node) at the cost of the two real wins. For time-series you want time-*clustering*, not even scatter.
- **Year-stripped date** (`MMDD`, "so partitions rotate yearly"). `toYYYYMMDD` does **not** accumulate partitions forever — TTL drops old ones, so the live count is steady-state ≈ retention window. Stripping the year makes the expression non-monotonic (it wraps Dec 31 → Jan 1), which kills pruning, and collides every year's same-day data into one partition that can never be wholly dropped. For long retention, use coarser-but-monotonic `toYYYYMM`, never year-stripping.

---

## Scaling a single high-volume project

A common shape: a self-hosted org with **one project** generating a lot of telemetry. The partition key is the wrong tool here (it doesn't add capacity, and the project hash is a no-op). The real ladder, in order:

1. **Vertical scaling — first and usually sufficient.** ClickHouse is built for it: a single well-specced node (NVMe, ample RAM for mark cache + queries, cores for merges) sustains 1M+ rows/sec and tens of TB compressed. Most single-project installs never hit this ceiling.
2. **Cut the volume.** Retention (`retainTelemetryDataForDays`) is the biggest dial. Then sampling at ingest (trace head/tail sampling, log-level filtering), rollups (the `MetricItemAggMV1m` MVs already let dashboards read aggregates), and compression (ZSTD codecs + LowCardinality, already shipped).
3. **Tiered storage (hot/cold) — the biggest current gap.** Keep recent data on NVMe and move older parts to a large cheap disk or S3 via a storage policy + `TTL … TO VOLUME 'cold'`. ClickHouse supports this; OneUptime does not wire it up yet. With the per-row `retentionDate` already present, a `TO VOLUME` tier is a natural, high-leverage feature for "drowning in disk, not CPU."
4. **Write-path tuning.** `async_insert` is already on (coalesces small inserts → fewer parts → less merge pressure). Beyond that, `background_pool_size`. Note: for a single project all "now" writes inherently target the current time-partition; ClickHouse runs concurrent merges *within* it, and a single hot write-partition is the normal, healthy pattern — you cannot partition-key your way to more write capacity.
5. **Horizontal sharding — the real ceiling-raiser, needs product work.** Multi-node via `ReplicatedMergeTree` + a `Distributed` front table. **OneUptime does not support this today.** When built, the shard key must be high-cardinality (e.g. `sipHash64(traceId)` / `rand()`), **not** `projectId`, so a single project spreads across all nodes; each shard's local table still partitions by `toYYYYMMDD(time)`.

---

## Interaction with the entity model

[`OpenTelemetryEntities.md`](./OpenTelemetryEntities.md) currently assumes the partition/sort keys stay byte-for-byte and lands its `entityKeys Array(String)` membership column via a metadata-only `ALTER TABLE ADD COLUMN`. The two efforts touch the same tables:

- This proposal **changes the partition key**, which (unlike `ADD COLUMN`) cannot be done in place and forces a new `…V3` table + copy + swap (below).
- That table cut is the **natural moment to also land the entity columns** (`entityKeys`, the scalar per-type key columns) directly in the `V3` schema, instead of a later `ADD COLUMN`. One migration, one rewrite.
- `serviceId` is **renamed** `primaryEntityId` (and `serviceType` → `primaryEntityType`) as part of this same `V3` rewrite (Option B) — the column stays in the sort key under the new name, with `serviceId` kept as a deprecated API alias. It is *kept*, not dropped: it is the auth + identity anchor, distinct from the additive `entityKeys` filtering column. See the entity doc's decision-update note.

If both ship, sequence the entity *identity/registry* work first (code-only, no schema change), then cut `V3` **once** — new partition key, entity columns, and the `serviceId → primaryEntityId` rename together. One rewrite.

---

## Migration / Phasing

ClickHouse **cannot `ALTER` a partition key in place** — it is fixed at table creation (this is exactly why the tables are already `…V2`). So:

1. **New installs / new tables — free.** Change `partitionKey` (and add the `SETTINGS ttl_only_drop_parts = 1`) in each model; `CREATE TABLE IF NOT EXISTS` in [`StatementGenerator`](../../Common/Server/Utils/AnalyticsDatabase/StatementGenerator.ts) picks it up. No migration, immediate benefit. Ship this first.
2. **Existing installs — `…V3` swap.** A guarded, resumable [`DataMigration`](../../App/FeatureSet/Workers/DataMigrations/) per table that:
   - creates `LogItemV3` (etc.) with the new `PARTITION BY` and identical columns/indexes,
   - copies via `INSERT INTO …V3 SELECT * FROM …V2` (partition-by-partition with progress; watch the `retentionDate` epoch-zero gotcha handled in [`AddRetentionDateAndSkipIndexesToTelemetryTables`](../../App/FeatureSet/Workers/DataMigrations/AddRetentionDateAndSkipIndexesToTelemetryTables.ts)),
   - swaps with `EXCHANGE TABLES … AND …` (atomic database) or rename, then drops `…V2`.
   - Requires ~2× transient disk and is IO-heavy on large tables — gate behind an explicit opt-in / maintenance window.

   `AnalyticsTableManagement` only does `CREATE TABLE IF NOT EXISTS`, so it will **not** silently repartition an existing table — the migration must be explicit.

Pragmatic rollout: land the model change (step 1) so every new install/table benefits at zero cost, and ship the `…V3` swap (step 2) separately as opt-in for existing large installs.

---

## Recommended Decisions

1. **Partition by time, not project hash.** `toYYYYMMDD(time)` for raw signals, `toYYYYMM(...)` for long-retention/rollup tables. Default to time-only; the `% 8` composite is a measured-need knob, not the default.
2. **Keep `projectId` as the first sort key.** Project pruning stays at the primary-index level; the partition key does not need it.
3. **`ttl_only_drop_parts = 1`**, with the row-level `retentionDate DELETE` TTL kept as the correctness backstop for mixed retention.
4. **Partition key ≠ shard key.** Even-distribution / capacity is the shard key's job (high-cardinality, never `projectId`); the partition key is for lifecycle (pruning + TTL).
5. **Scale a single big project vertically + reduce volume + tiered storage**; horizontal sharding is a future `Distributed`/`Replicated` feature, not a partition-key change.
6. **Migration is a `…V3` table cut**, not an in-place ALTER — free for new installs via the model change, opt-in copy/swap for existing ones.
7. **Co-sequence with the entity columns** if [`OpenTelemetryEntities.md`](./OpenTelemetryEntities.md) ships in the same window — one rewrite.

## Open Questions

1. **Daily vs monthly cutoff.** Confirm typical `retainTelemetryDataForDays` distributions in the field to validate daily for raw signals (vs weekly) and the monthly choice for AuditLog/MVs.
2. **`ttl_only_drop_parts` default.** On by default, or opt-in per deployment given mixed-retention storage overhang?
3. **Historical data on existing installs.** Is the `…V3` copy worth it for large installs, or forward-only (new installs get the new key, existing keep `V2`) until a customer needs it?
4. **Tiered S3 storage.** Prioritize the `TTL … TO VOLUME` storage-policy feature independently — it may relieve more pressure than repartitioning for disk-bound single-project installs.

## Non-Goals

- *Moving* `serviceId` out of the sort/primary key. (It is *renamed* to `primaryEntityId` in the same V3 cut — see the entity doc — but keeps its position and meaning.)
- Adding a `Distributed`/`ReplicatedMergeTree` layer (separate, larger effort; only the shard-key guidance is recorded here).
- Changing retention semantics, billing, or access control.
- Backfilling `entityKeys` on historical rows (covered by the entity doc).

## References

- [Custom partitioning key](https://clickhouse.com/docs/en/engines/table-engines/mergetree-family/custom-partitioning-key) — monotonicity requirement for pruning; `ttl_only_drop_parts`
- [MergeTree TTL](https://clickhouse.com/docs/en/engines/table-engines/mergetree-family/mergetree#table_engine-mergetree-ttl) — `DELETE` vs `TO VOLUME`/`TO DISK`
- [Distributed table engine](https://clickhouse.com/docs/en/engines/table-engines/special/distributed) — sharding key, separate from partition key
- Internal: [`OpenTelemetryEntities.md`](./OpenTelemetryEntities.md) (signal schema / `serviceId` / membership columns), [`Clickhouse/Docs/ClickhouseOps.md`](../../Clickhouse/Docs/ClickhouseOps.md)
- Code: [`StatementGenerator.ts`](../../Common/Server/Utils/AnalyticsDatabase/StatementGenerator.ts), [`AnalyticsDatabaseService.ts`](../../Common/Server/Services/AnalyticsDatabaseService.ts), models in [`Common/Models/AnalyticsModels/`](../../Common/Models/AnalyticsModels/)
