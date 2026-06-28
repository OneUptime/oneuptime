# Telemetry-monitor scale-out — flags, rollout & integration tests

This document covers the optional scale-out evaluation path for telemetry
monitors (Logs / Traces / Metrics / Exceptions / Profiles). It builds on the
in-process reliability fix (bounded fan-out, isolated background ClickHouse
pool, non-defeatable time window, per-query `max_execution_time`, overlap lock)
which is always on and needs no configuration.

All four phases are **on by default**. Each flag is the per-deployment
kill-switch: set its env var to `"false"` to disable that phase. **These paths
have not been integration-tested in CI — they are compile- and unit-verified
only — so validate them on a real ClickHouse / Redis / BullMQ stack (checklist
below) before shipping.** If you need to ship before validating a given phase,
set that phase's env var to `"false"`.

## Flags

| Env var                                       | Phase       | Default | Disable with | What it does                                                                                                                                                                   |
| --------------------------------------------- | ----------- | ------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `TELEMETRY_MONITOR_SHAPE_COLLAPSE_ENABLED`    | 1           | **on**  | `=false`     | In the in-process tick, prefetch one batched MV read per query shape and serve eligible metric monitors from it (per-monitor fallback on miss).                                |
| `TELEMETRY_MONITOR_SCHEDULER_FANOUT_ENABLED`  | 2           | **on**  | `=false`     | Turn the tick into a producer that claims + enqueues monitors onto `TelemetryMonitorEval`, drained by a worker fleet. Removes the single-process throughput ceiling.           |
| `TELEMETRY_MONITOR_ATTRIBUTE_KEY_MV_ENABLED`  | 3           | **on**  | `=false`     | Create + read the `MetricItemAggMV1mByAttributeKeys` rollup. **Its MV fans every metric insert across its attributes — set the allowlist (below) or disable until validated.** |
| `TELEMETRY_MONITOR_REACTIVE_FASTPATH_ENABLED` | 4           | **on**  | `=false`     | Emit a fresh-shape signal on metric ingest and let the scheduler skip provably-idle monitors.                                                                                  |
| `TELEMETRY_MONITOR_EVAL_CONCURRENCY`          | 2           | `10`    | —            | Per-replica concurrency of the eval worker fleet. Fleet throughput = replicas × this.                                                                                          |
| `CLICKHOUSE_BACKGROUND_MAX_OPEN_CONNECTIONS`  | (always on) | `10`    | —            | Size of the isolated background ClickHouse pool used by monitor evaluation.                                                                                                    |

## Recommended rollout order

Enable in this order, validating each before the next. Phase 0 (the Postgres
index, the unit cache, and the per-tick observability log) is always on.

1. **Phase 1 — shape collapse.** Lowest risk; in-process; per-monitor fallback
   keeps results authoritative. Biggest single-cluster ClickHouse-query-rate
   win.
2. **Phase 2 — scheduler/worker fan-out.** Removes the throughput ceiling.
   Roll out by scaling worker replicas.
3. **Phase 3 — per-attribute-key MV.** Only after validating ingest cost (see
   warning). Set the MV's attribute allowlist first.
4. **Phase 4 — reactive fast-path.** Pure upside; depends on Phase-equivalent
   ingest emission.

All four already default on. Until you've validated a phase on your stack,
disable it with its `=false` kill-switch (and re-enable per phase as each test
passes).

## ⚠️ Phase 3 ingest fan-out

`MetricItemAggMV1mByAttributeKeys`'s materialized view `ARRAY JOIN`s every
ingested metric row across its attributes, so a metric with N attributes
produces N rollup rows per insert. The MV is created (and starts firing on
ingest) the moment the flag is on — it is **not** gated by read traffic.
Before enabling:

1. Edit the MV's `WHERE 1 = 1` in
   `Common/Models/AnalyticsModels/MetricItemAggMV1mByAttributeKeys.ts` to an
   explicit `attributeKey IN (...)` allowlist of the attributes you actually
   alert on, so the fan-out is bounded.
2. Validate ingest CPU and storage on a representative volume **before**
   enabling cluster-wide.

## Integration-test checklist (per flag, on a live stack)

### Phase 1 — `SHAPE_COLLAPSE`

- [ ] With a few project-wide metric monitors of the same agg/window, confirm
      the tick logs a `collapseRatio > 1` and issues one MV read per shape.
- [ ] Diff alert outcomes vs. the flag off for the same monitors — must match.
- [ ] Confirm entity-scoped / attribute-filtered / multi-query monitors still
      take the per-monitor path (cache miss → fallback).

### Phase 2 — `SCHEDULER_FANOUT`

- [ ] Confirm the tick returns quickly and `TelemetryMonitorEval` drains across
      replicas; alerts still fire end-to-end.
- [ ] Kill a worker mid-evaluation; confirm the monitor is re-evaluated within
      one interval (claim-advance recovery), not skipped indefinitely.
- [ ] Confirm no double-incident on retried jobs (per-monitor lock holds).

### Phase 3 — `ATTRIBUTE_KEY_MV`

- [ ] **Measure ingest CPU/storage** with the allowlist set, on representative
      volume, before and after enabling.
- [ ] Confirm single-attribute-filtered metric monitors read from the MV and
      their results match the raw-table path.

### Phase 4 — `REACTIVE_FASTPATH`

- [ ] **Critical:** confirm a monitor with a `Trigger` or `Treat As Zero`
      no-data policy STILL fires when its metric stops arriving (must never be
      skipped).
- [ ] Confirm a pure-threshold monitor whose metric is idle is skipped (fewer
      ClickHouse reads) and resumes evaluating the moment data returns.
- [ ] Take Redis down; confirm the scheduler falls back to scanning everything
      (signal `null` → scan-all floor), not skipping everything.

## Notes / known follow-ups

- Phase 2 currently enqueues one job per monitor. Batching ~50 monitors per job
  (and batching the claim into a single `CASE` update) is the documented
  next optimization; it also unlocks worker-side shape collapse.
- Phase 1 collapse only applies to project-wide MV-eligible metric monitors
  (the set the per-host/primaryEntityId MVs already serve). Entity-scoped
  (`entityKeys`) monitors use the raw path until a matching rollup exists.
