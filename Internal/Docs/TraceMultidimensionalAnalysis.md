# Trace Multidimensional Analysis (Dynatrace-style "split by dimension") — Implementation Plan

Status: Proposal
Owner: TBD
Last updated: 2026-06-09

> **Origin:** Customer request to reproduce Dynatrace's "Distributed traces" filtering + "Custom multidimensional analysis" views in OneUptime. Concretely they want, for URLs like `https://{tenant}.starship.online/Shipment/ShipShipment`:
> 1. Filter service traces by **request endpoint** (transaction name) **and URL host** (tenant) → see avg/median transaction time for one tenant.
> 2. **Split** trace count of one transaction (`Request:Name`) **by node** (`Service:Instance`).
> 3. **Split** median response time **by tenant** (`URL:Host`), filtered to one endpoint.
> 4. Filterable attributes needed (at least): **Service name, Instance/host name, Request endpoint, URL host.**

## Summary

**Filtering is already done.** All four requested attributes are filterable today — Service and Host are first-class facets; endpoint (`http.route`) and URL host (`url.host`/`server.address`) are reachable via the generic `@attribute:value` custom-attribute filter, which works on **any** OpenTelemetry span/resource attribute we store. The customer's "Dynatrace provides tons of attributes" concern is covered: attributes are an open `Map(String,String)`, not a fixed field list.

**The gap is aggregation + splitting.** Today the trace explorer can only chart **count, split by `statusCode`**. It cannot chart **duration aggregates** (avg / median / p95) and cannot **split by an arbitrary dimension** ad-hoc. Duration aggregates and single-dimension grouping exist only in the **Trace Recording Rules** worker (pre-defined, per-minute, writes a derived metric) — not in the interactive UI. So requests #2 and #3, and the "average transaction time" half of #1, are achievable only by hand-authoring a recording rule today.

This plan closes that gap in phases: a grouped-aggregation API (P1), an interactive "Analyze / Split by" trace UI (P2) that delivers all three customer screenshots ad-hoc, a "pin to dashboard" bridge (P3), ClickHouse performance hardening (P4), and finally multi-dimension cross-tabulation (P5) for full parity.

> **Verify line numbers at edit time** — citations are architecture-accurate as of 2026-06-09; exact lines may drift.

---

## Current state (verified audit)

| Capability | Status | Evidence |
|---|---|---|
| Filter by Service / Host (instance) | ✅ first-class facets | [`TracesViewer.tsx`](../../App/FeatureSet/Dashboard/src/Components/Traces/TracesViewer.tsx), [`TraceFilterConfig.ts`](../../App/FeatureSet/Dashboard/src/Components/FilterQueryBuilder/TraceFilterConfig.ts) |
| Filter by **any** span attribute (`http.route`, `url.host`, …) | ✅ `@attribute:value`, open Map | `TraceFilterConfig.ts` `supportCustomAttributes: true` (≈L39); `attributes` column is `MapStringString` in [`Span.ts`](../../Common/Models/AnalyticsModels/Span.ts) (≈L438–466) |
| Attribute filter → SQL | ✅ `arrayExists` over map keys/values, case-insensitive | [`TraceAggregationService.ts`](../../Common/Server/Services/TraceAggregationService.ts) `appendCommonFilters` (≈L702–721) |
| Histogram (count over time) | ✅ but **split by `statusCode` only** | `TraceAggregationService.buildHistogramStatement` (≈L473–542); endpoint `/telemetry/traces/histogram` in [`TelemetryAPI.ts`](../../Common/Server/API/TelemetryAPI.ts) (≈L514–605) |
| Facet values (one dimension, value+count) | ✅ one at a time, no time series | `buildFacetStatement` (≈L544–630); `/telemetry/traces/facets` (≈L610–769) |
| **Duration aggregates** (avg / p50 / p95 / p99 / min / max) | ⚠️ **only in recording-rules worker**, not in the aggregation API or UI | `toSpanAggregateSql` in [`ComputeTraceRecordingRules.ts`](../../App/FeatureSet/Workers/Jobs/Traces/ComputeTraceRecordingRules.ts) (≈L276–297); enum [`TraceAggregationType.ts`](../../Common/Types/Trace/TraceAggregationType.ts) (≈L6–17) |
| **Group/split by an attribute** | ⚠️ **single** dimension, only in recording rules, per-minute, raw-table scan | `runSourceQuery` group SQL (≈L240–248); `groupByAttribute` in [`TraceRecordingRuleDefinition.ts`](../../Common/Types/Trace/TraceRecordingRuleDefinition.ts) (≈L24–36) |
| Recording rule → derived metric → dashboard chart | ✅ end-to-end pipeline works | `buildDerivedMetricRow` (≈L299–333) → `MetricService.insertJsonRows` (≈L180); chart consumes via `groupByAttributeKeys` |
| Dashboard chart turns `groupByAttributeKeys` into one series per value | ✅ with top-N (10) + search + show-all | [`MetricCharts.tsx`](../../App/FeatureSet/Dashboard/src/Components/Metrics/MetricCharts.tsx) series build (≈L541–615), top-N cap (≈L64–84, L795–814) |
| Dashboard chart data source | ❌ **hard-coded to metrics** (no `dataSourceType`) | [`DashboardChartComponent.ts`](../../Common/Types/Dashboard/DashboardComponents/DashboardChartComponent.ts) (≈L11–18) |
| Reusable line/bar/area charts | ✅ multi-series `SeriesPoint[]` | [`ChartGroup.tsx`](../../Common/UI/Components/Charts/ChartGroup/ChartGroup.tsx) (≈L17–47) |
| Existing "create metric from spans" UI | ✅ Traces → Settings → Recording Rules | [`RecordingRules.tsx`](../../App/FeatureSet/Dashboard/src/Pages/Traces/Settings/RecordingRules.tsx) (≈L45–159) |

### ClickHouse facts that constrain the design

| Fact | Evidence | Consequence |
|---|---|---|
| `Span` ORDER BY `(projectId, startTime, serviceId, traceId)`; partition `sipHash64(projectId) % 16` (**no time component**) | `Span.ts` (≈L873–876) | Time-range pruning relies on the sort key + minute-bucketing, not partitions. |
| `attributes` Map has **no data-skipping index**; `attributeKeys` has a bloom filter (existence only); `durationUnixNano` has **no index** | `Span.ts` (≈L438–502, L239–268) | `GROUP BY attributes['key']` and duration predicates **full-scan** the time-filtered range. |
| Existing projections: `proj_hist_by_minute` (count by minute/service/status/isRoot), `proj_agg_by_service` (count + avg + p99 **by minute/service**), `proj_trace_by_id` | `Span.ts` (≈L856–872) | `proj_agg_by_service` already pre-computes duration aggregates **but is currently never queried.** Free perf win for service-split. |
| Query guardrails today: `max_execution_time = 45, timeout_overflow_mode = 'break', optimize_use_projections = 1`. **No** `max_memory_usage`, `max_rows_to_read`, or sampling. | `TraceAggregationService.ts` (per-statement `SETTINGS`); [`ClickhouseConfig.ts`](../../Common/Server/Infrastructure/ClickhouseConfig.ts) (≈L25–62) | Arbitrary-attribute grouping over wide windows is unbounded in memory/rows — needs explicit caps (see P4 and `clickhouse-memory-architecture` / `clickhouse-query-concurrency` notes). |
| `quantile()` used by recording rules is reservoir-sampled (approximate) | `toSpanAggregateSql` (≈L276–297) | Percentiles are approximate by design — fine for trends; label them as such. |

---

## Gaps

| ID | Gap | Blocks customer ask |
|---|---|---|
| **G1** | Duration aggregates (avg/median/p90/p95/p99) not exposed by the trace aggregation API or UI — count-by-status only. | #1 (avg time), #3 (median) |
| **G2** | Histogram/aggregation API cannot split by an arbitrary dimension — `statusCode` only. | #2, #3 |
| **G3** | No interactive "pick a metric + split by a dimension" control in the trace explorer, and no multi-series chart / "top dimensions" table for it. | #1, #2, #3 |
| **G4** | No aggregate summary stat for the current filter (e.g. "median response time for this filter") shown inline. | #1 |
| **G5** | No one-click "save this trace view as a metric / pin to dashboard" (Dynatrace "Create metric…") — recording rules must be hand-authored. | persistence of #2, #3 |
| **G6** | Engine + recording rules support only a **single** group-by dimension — no cross-tabulation (`{Request:Name} - {Service:Instance}`). | #2 (combined split) |
| **G7** | Grouping by arbitrary attribute over time is an unbounded full scan (no attribute/duration index, no per-query memory/row caps). | scale/safety of all |

---

## Phases

### Phase 0 — Filtering (already shipped, no code)

The four required filterable attributes work **today**. Document/educate only:

- **Service**, **Host (instance)** → facet panel.
- **Endpoint** → `@http.route:/Shipment/ShipShipment`.
- **URL host (tenant)** → `@url.host:torginol.starship.online` (confirm the exact key the customer's instrumentation emits — old OTel: `http.host`/`net.host.name`; new: `url.host`/`server.address`/`url.domain`).
- Combine filters to isolate "ShipShipment for tenant *torginol*" and see every matching trace with its duration.

**Deliverable:** customer request #1's *filtering* half, immediately. **Effort: none.**

---

### Phase 1 — Grouped trace-metric aggregation API (backend) — closes G1, G2

The foundation. A single backend method + endpoint that returns a time-bucketed aggregate, optionally split by one dimension.

- Factor `toSpanAggregateSql` out of `ComputeTraceRecordingRules.ts` (≈L276–297) into a shared `Common/Server` util so the interactive engine and recording rules compute identical SQL (count, errorCount, **errorRate**, avg, p50, p90, p95, p99, min, max).
- Add `TraceAggregationService.getGroupedTimeSeries({ metric, groupBy?, bucketSize, ...existingFilters })`:
  - `groupBy` is a top-level column (`serviceId`, `statusCode`, `name`, …) **or** `attributes['key']`.
  - Reuse `appendCommonFilters` (all existing filters, incl. attribute filters, work unchanged).
  - Mirror the two-stage minute-bucket pattern of `buildHistogramStatement` (≈L473–542).
  - **Server-side top-N series + an "other" rollup**, and return total distinct-dimension count (for "637 dimensions, showing top 100" UX) so the wire payload is bounded.
- New endpoint `POST /telemetry/traces/aggregate` in `TelemetryAPI.ts` (alongside `/histogram`, `/facets`).
- Carry over guardrails (`max_execution_time = 45`, `break`) and add the **essential** safety caps now: per-query `max_memory_usage`, `max_rows_to_read`, and a max time-range for attribute-grouped queries (full optimization is P4).

**Deliverable:** API can answer "median duration of ShipShipment split by `url.host` over time." **Effort: M.**

---

### Phase 2 — Trace explorer "Analyze / Split by" UI — closes G3, G4

The phase the customer actually sees. Turns the explorer into Dynatrace's multidimensional view.

- In `TracesViewer.tsx`, add to the `TelemetryViewer` toolbar (via `toolbarTrailingActions`, see [`TelemetryViewer.tsx`](../../Common/UI/Components/TelemetryViewer/TelemetryViewer.tsx) ≈L121–189):
  - **Metric selector** (Count / Error rate / Avg / Median / P90 / P95 / Max duration).
  - **Split-by dimension** picker — reuse the existing attribute autocomplete that powers `@attribute:value` so any attribute (plus Service/Host/Span name/Status) is selectable.
- Render results as a multi-series line/bar chart via `ChartGroup` (≈L17–47); **reuse the high-cardinality series control** from `MetricCharts.tsx` (top-N, search, show-all; ≈L64–84) — factor it into a shared component. Raise the cap toward ~100 to match Dynatrace's "top 100".
- Add a **"Top dimensions" table** below the chart (dimension value | count | metric), reusing the facet `FacetValue` shape; clicking a row drills in (adds it as a filter).
- Add the **median/avg overlay** on the count histogram and a **summary stat line** ("Median response time for this filter: X") → request #1.

**Deliverable:** customer screenshots #1, #2, #3 reproducible **ad-hoc, zero setup.** **Effort: L.** **Depends on: P1.**

---

### Phase 3 — Pin to dashboard / "Create metric" from a trace view — closes G5

Make an ad-hoc view permanent, reusing the proven recording-rule → metric → chart pipeline.

- Add a **"Create metric… / Pin to dashboard"** action in the P2 analyze view that captures the current `{metric, filters, groupBy}` and creates a `TraceRecordingRule` (existing model + worker + the [`RecordingRules.tsx`](../../App/FeatureSet/Dashboard/src/Pages/Traces/Settings/RecordingRules.tsx) editor pre-filled).
- The rule's `outputMetricName` + `groupByAttribute` then back a `DashboardChartComponent` via `MetricQueryConfigData` with `groupByAttributeKeys` — already renders one series per value (`MetricCharts.tsx` ≈L541–615).
- **Call out the limitation honestly:** recording rules are **forward-only** (the pinned chart fills from creation time, not retroactively) and run per-minute. Alerting comes free by pointing a metric monitor at the derived metric.

**Deliverable:** "ShipShipment median by tenant" as a permanent dashboard tile + optional alert. **Effort: M.** **Depends on: P2.**

---

### Phase 4 — ClickHouse performance & cost hardening — closes G7

Make grouped aggregation fast and safe at production scale (see `clickhouse-memory-architecture`, `clickhouse-query-concurrency`, `clickhouse-projection-engagement` notes).

- **Wire up the unused `proj_agg_by_service`** projection (count + avg + p99 by minute/service) so service-split count/avg/p99 is projection-fast; consider widening it to `quantileState` (p50/p90/p95) and adding host/status variants for the *common* non-arbitrary splits.
- Ensure the P1 query engages projections when **not** grouping by an arbitrary attribute (filter on `toStartOfMinute(startTime)`, `optimize_use_projections = 1`) — projections only engage on the bucketed key expression, not raw `startTime`.
- **Arbitrary-attribute grouping stays a bounded full scan:** enforce time-range caps, the per-query `max_memory_usage` / `max_rows_to_read` from P1, surface "results partial/sampled" when `timeout_overflow_mode='break'` truncates, and respect the per-pod CH pool cap to avoid error 202 under fan-out.
- Document the steering rule: ad-hoc arbitrary splits are for **recent/narrow** windows; long-range/high-frequency → pin a recording rule (P3).

**Deliverable:** grouped queries bounded and safe; common splits are projection-fast. **Effort: M–L.** **Hardens: P1.**

---

### Phase 5 — Multi-dimension grouping / cross-tabulation — closes G6

Full Dynatrace parity: split by **A × B** (e.g. `{Request:Name} - {Service:Instance}`, screenshot #2).

- Extend the P1 engine and recording rules from a single `groupByAttribute` to `groupByAttributes: string[]`, emitting composite series keys.
- Chart side already supports multiple keys (`groupByAttributeKeys` is an array) — work is the engine, the `TraceRecordingRuleDefinition`, and a multi-select in the P2 picker.

**Deliverable:** true multidimensional analysis (dimension A × B). **Effort: M.** **Depends on: P1, P3.**

---

## Sequencing

```
P0 (done) ─ educate customer now
P1 ──┬── P2 ──┬── P3 ──┐
     │        │        ├── P5
     └── P4 (hardening, parallel after P1)
```

**Customer's actual asks are satisfied by P0 + P1 + P2.** P3 makes them persistent; P4 makes them scale; P5 is full parity. Recommend shipping P1+P2 as the first milestone, then P3, with P4 hardening folded in before exposing arbitrary-attribute splits over wide time ranges.
