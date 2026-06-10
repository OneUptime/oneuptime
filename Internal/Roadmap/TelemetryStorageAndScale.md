# Plan: Telemetry Storage & Scale (ClickHouse) for OneUptime

## Context

OneUptime's telemetry (logs, metrics, spans, exceptions, profiles) lives in single-node ClickHouse `MergeTree` tables. A storage / memory / query audit (2026-06) surfaced a set of structural improvements. The largest require **rebuilding** tables, so they are batched into one **`…V3` table cut** — that rewrite is the only cheap window for sort-key, column-type, or dropped-column changes. Detailed mechanics live in `Internal/Docs/`:

- [`ClickHousePartitioningAndScaling.md`](../Docs/ClickHousePartitioningAndScaling.md) — time-based partition key, the scaling ladder, and the full structural-changes list.
- [`RenameServiceIdToPrimaryEntityId.md`](../Docs/RenameServiceIdToPrimaryEntityId.md) — `serviceId → primaryEntityId` rename (hard break, no alias).
- [`OpenTelemetryEntities.md`](../Docs/OpenTelemetryEntities.md) — `entityKeys` multi-entity membership columns.

This roadmap is the phased, prioritized view; the docs hold the mechanics. The work is **cross-cutting** (all signal tables), which is why it lives here rather than in any one pillar; the per-pillar storage notes in [`Metrics.md`](./Metrics.md) / [`Traces.md`](./Traces.md) / [`Logs.md`](./Logs.md) point here.

## Completed

- ZSTD codecs on payload/timestamp columns (`AddTelemetryStorageCompression`).
- LowCardinality on `serviceType`, `severityText`, `kind`, `metricPointType`.
- `attributeKeys Array(String)` + bloom index for attribute-key existence.
- 1-minute metric rollups (`MetricItemAggMV1m`, `MetricItemAggMV1mByHost`).
- `retentionDate`-based TTL on all signal tables.
- Host-name canonicalization at ingest (casing-safe host identity).

## Gap Analysis Summary

| Gap | Priority | Lands |
|---|---|---|
| Partition key has no time component (`sipHash64(projectId) % 16`) → TTL rewrites parts; no time-range partition pruning | P0 | V3 cut |
| `serviceId`/`serviceType` is a misnamed polymorphic primary-entity pointer | P0 | V3 cut |
| Sort-key ordering inconsistent / unreviewed (`Metric` puts time last) | P0 | V3 cut |
| Nanosecond timestamps are `Int128` → no Delta codec, 2× storage | P1 | V3 cut |
| Metric values are `Decimal`+`ZSTD` → miss Gorilla float-series compression | P1 | V3 cut |
| Dead/uncodec'd base columns (`updatedAt`, maybe `createdAt`/`_id`) on append-only rows | P1 | V3 cut |
| Only 1-min rollups → long-range queries scan many buckets | P1 | additive |
| `attributes` Map value-filtering is a full-map scan | P2 | mixed |
| Single-node only (no `Distributed`/`Replicated`) | P2–P3 | feature |

## Phase 1 (P0): The V3 cut — one rewrite

Cut new `…V3` tables (6 signal tables + 2 MVs) and carry every rewrite-gated change in a single ClickHouse data-migration copy.

- **Time-based partition key** — `toYYYYMMDD(time)` (daily) for raw signals, `toYYYYMM(...)` for MVs/long-retention; `+ SETTINGS ttl_only_drop_parts = 1`; keep `projectId` as the first sort key.
- **Rename `serviceId → primaryEntityId`, `serviceType → primaryEntityType`** — hard break, no alias; frontend + Postgres (`TelemetryException`, `TelemetryUsageBilling`) in scope.
- **Sort-key (`ORDER BY`) review** — per table against real query shapes; resolve time-second vs time-last.
- **Timestamps `LongNumber`(Int128) → `UInt64`** (`timeUnixNano`/`startTimeUnixNano`/`observedTimeUnixNano`) → unlocks `DoubleDelta`.
- **Metric `value`/`sum`/`min`/`max`: `Decimal`+`ZSTD` → `Float64`+`Gorilla`**.
- **Drop `updatedAt`** (reconsider `createdAt`/`_id`) on append-only rows.
- **Add `entityKeys Array(String)` + per-type scalar entity keys** (membership; see entity doc).

## Phase 2 (P1): Additive storage wins (no rewrite)

- **Codec base columns** — `_id` → `ZSTD`, surviving dates → `DoubleDelta, ZSTD` (`MODIFY COLUMN … CODEC`).
- **Coarser rollups** — hourly + daily metric `AggregatingMergeTree` MVs with read-routing to the coarsest covering the range; log error-rate and span-latency-histogram rollups.
- **More projections** — alternate orderings for hot access patterns (pairs with entity-key orderings).

## Phase 3 (P2): Attributes

- **`attributes` strategy** — evaluate ClickHouse `JSON` type (rewrite → fold into a cut) and/or promote hot keys (`http.status_code`, `http.method`, …) to materialized typed columns (additive). Generalizes Metrics `S.4` across pillars.

## Phase 4 (P2–P3): Horizontal scale

- **Vertical-first guidance** — documented sizing; most single-project installs never exceed one node.
- **Sharding** — `ReplicatedMergeTree` + `Distributed`; shard key **high-cardinality** (`sipHash64(traceId)`/`rand`), **never** `projectId`; each shard's local table still partitions by time. A product feature, not a partition-key change.

## Deferred / Not pursued

- **Tiered hot/cold (S3) storage** (`TTL … TO VOLUME`) — not needed for now (2026-06-09). The per-row `retentionDate` would make it straightforward to add later; revisit only if a deployment becomes disk-bound.

## Recommended Implementation Order

1. **Phase 1** — the V3 cut (partition + rename + sort-key review + `UInt64` timestamps + `Float64`/Gorilla + drop `updatedAt` + `entityKeys`) as one rewrite.
2. **Phase 2** — additive codecs, coarser rollups, projections.
3. **Phase 3** — the `attributes` overhaul.
4. **Phase 4** — sharding only once vertical scaling + volume reduction are exhausted.

## Verification

- **Storage:** per-column compressed size before/after via `system.parts_columns`; confirm `DoubleDelta`/`Gorilla` applied.
- **Queries:** `EXPLAIN` shows time-range partition pruning; `primaryEntityId` filters + permissions correct; sample-query parity vs V2 baselines.
- **TTL:** confirm whole-partition drops with `ttl_only_drop_parts`.
- **Rollups:** long-range dashboards read coarse rollups; charts repopulate forward.
- **Functional:** traces/logs/metrics/profiles/exceptions UIs work on `primaryEntityId`; API breaking-change documented.

## References

- Design docs: [`ClickHousePartitioningAndScaling.md`](../Docs/ClickHousePartitioningAndScaling.md), [`RenameServiceIdToPrimaryEntityId.md`](../Docs/RenameServiceIdToPrimaryEntityId.md), [`OpenTelemetryEntities.md`](../Docs/OpenTelemetryEntities.md).
- Per-pillar storage notes: [`Metrics.md`](./Metrics.md), [`Traces.md`](./Traces.md), [`Logs.md`](./Logs.md).
