# OpenTelemetry Metrics Audit: OneUptime vs. DataDog & New Relic

**Date:** 2026-03-13
**Purpose:** Identify gaps in OneUptime's metrics implementation compared to industry leaders and define a roadmap to build a best-in-class metrics product.

---

## 1. Current OneUptime Metrics Implementation

### 1.1 Ingestion

- **HTTP endpoint:** `POST /otlp/v1/metrics` (OTLP/HTTP)
- **gRPC endpoint:** Port 4317 via `metrics_service.proto`
- **Auth:** `x-oneuptime-token` or `x-oneuptime-service-token` headers
- **Pipeline:** Ingest -> immediate 200 OK -> async queue (`MetricsQueueService`) -> batch flush to ClickHouse
- **Batch size:** Configurable via `TELEMETRY_METRIC_FLUSH_BATCH_SIZE`

### 1.2 Metric Types Supported

| Type | Supported |
|------|-----------|
| Gauge | Yes |
| Sum | Yes |
| Histogram | Yes |
| ExponentialHistogram | Yes |
| Summary | No |

**Aggregation Temporality:** Both Delta and Cumulative are supported.

### 1.3 Storage (ClickHouse)

- **Engine:** MergeTree
- **Primary keys:** projectId, time, serviceId
- **Partition:** `sipHash64(projectId) % 16`
- **TTL:** Configurable per-service (`retainTelemetryDataForDays`, default 15 days) and per-monitor (default 1 day)
- **Indexes:** Bloom filter on `name`, set index on `serviceType`

**Schema highlights:**
- Core fields: value, sum, count, min, max, bucketCounts, explicitBounds
- Attributes stored as JSON with extracted `attributeKeys` array
- Timestamps at nanosecond precision (timeUnixNano, startTimeUnixNano)
- `retentionDate` for TTL-based deletion

### 1.4 Querying

- **Aggregations:** Avg, Sum, Min, Max, Count
- **Filtering:** By metric name, attributes (key-value JSON)
- **Grouping:** Single `groupByAttribute` field
- **Formulas:** Supported - users can define calculated metrics using aliases (e.g., `a / b * 100`)
- **No query language** - everything is form/UI-driven

### 1.5 Frontend UI

- **Metric Explorer:** Time range selection, multiple queries with aliases, formula support, URL state persistence
- **Charts:** Line and bar chart types via ChartGroup
- **Filtering:** Attribute-based filters with advanced toggle
- **Legends:** Custom aliases with descriptions and units
- **Table view:** MetricsTable component for tabular display

### 1.6 Alerting

- **Metric monitors:** Threshold-based alerting on aggregated metric values
- **Evaluation:** Extracts metric value by alias, compares against threshold
- **Monitor metrics:** Automatically records response time, availability, etc. with ServiceType.Monitor
- **No anomaly detection** - purely static thresholds

### 1.7 Metadata

- **MetricType model:** Stores name, description, unit, related services
- **Auto-discovery:** MetricType records created automatically on first ingest
- **Attributes:** Resource-level (prefixed `resource.`), metric-level (prefixed `metricAttributes.`), scope-level (prefixed `scope.`)

---

## 2. Competitor Feature Summary

### 2.1 DataDog Key Capabilities

- **Metric types:** Count, Rate, Gauge, Histogram, Distribution (DDSketch-based with globally accurate percentiles)
- **Query:** Two-step aggregation (time then space), `.rollup()` for custom intervals, nested queries, natural language querying (NLQ)
- **Visualization:** 12+ widget types including heatmap, geomap, treemap, scatter, distribution
- **Alerting:** Anomaly monitors (3 algorithm choices + seasonality), Watchdog (zero-config AI anomaly detection + root cause analysis + bad deployment detection), metric correlations
- **SLO/SLI:** Metric-based SLOs, Time Slice SLOs, distribution percentile support
- **Cost control:** Metrics Without Limits (decouple ingestion from indexing, tag allowlist/blocklist, up to 70% cost reduction), Cardinality Explorer, RBAC on tag configs
- **Tags:** Auto-detection from infrastructure, unified service tagging (env/service/version)
- **Retention:** Tiered with lower resolution for older data, custom rollup intervals

### 2.2 New Relic Key Capabilities

- **Metric types:** Gauge, Count, Summary, Distribution
- **Query:** NRQL (SQL-like language with FACET, COMPARE WITH, TIMESERIES, nested aggregation, math functions, percentile, stddev, uniqueCount, histogram, rate)
- **Visualization:** Line, area, bar, stacked bar, pie, table, billboard, histogram, heatmap; per-series colors, threshold coloring, conditional table coloring, custom SDK visualizations
- **Alerting:** Anomaly detection with configurable sigma bands, predictive alerting (forecasts future values), directional alerting (upper/lower/both), Smart Alerts
- **SLO/SLI:** One-click setup with auto-recommended SLIs from historical data, error budget tracking (1/7/28-day rolling), integrated across platform
- **Golden Signals:** Pre-built dashboards for Latency, Traffic, Errors, Saturation with default alerts
- **Cardinality:** 15M/account budget (expandable to 200M), pruning rules, Events to Metrics conversion
- **Retention:** 30-day raw + 13-month rollups (automatic)

---

## 3. Gap Analysis

### 3.1 Critical Gaps (Must Have)

| # | Gap | DataDog | New Relic | OneUptime |
|---|-----|---------|-----------|-----------|
| 1 | **Percentile aggregations (p50, p75, p90, p95, p99)** | Yes (DDSketch distributions) | Yes (NRQL percentile()) | Missing - only Avg/Sum/Min/Max/Count |
| 2 | **Rate/derivative calculations** | Native Rate type + `.as_rate()` | `rate()` NRQL function | Missing - no rate or delta computation |
| 3 | **Multi-attribute GROUP BY** | Yes (space aggregation across multiple tags) | Yes (FACET on multiple attributes) | Single `groupByAttribute` only |
| 4 | **Anomaly detection on metrics** | Watchdog + anomaly monitors | Anomaly detection with sigma bands | Missing - static thresholds only |
| 5 | **SLO/SLI tracking** | Metric-based + Time Slice SLOs | One-click setup + error budgets | Missing entirely |
| 6 | **Heatmap visualization** | Purpose-built for distributions | Built-in chart type | Missing |
| 7 | **Rollup/downsampling for long-range queries** | Automatic tiered rollups | 30-day raw + 13-month rollups | No rollups - raw data only with 15-day default TTL |
| 8 | **Time-over-time comparison** | Yes | `COMPARE WITH` in NRQL | Missing |
| 9 | **Summary metric type** | N/A (uses Distribution) | Yes | Not supported |

### 3.2 Important Gaps (Should Have)

| # | Gap | DataDog | New Relic | OneUptime |
|---|-----|---------|-----------|-----------|
| 10 | **Query language or advanced query builder** | Graphing editor + raw queries + NLQ | Full NRQL language | Form-based UI only, no text query |
| 11 | **Predictive alerting** | Watchdog forecasting | GA predictive alerting | Missing |
| 12 | **Metric correlations** | Auto-surfaces related metrics during anomalies | Applied Intelligence correlation | Missing |
| 13 | **Golden Signals dashboards** | Available via APM | Pre-built with default alerts | Missing |
| 14 | **Cardinality management** | Metrics Without Limits + Explorer | Budget system + pruning rules | No cardinality visibility or controls |
| 15 | **More chart types** | 12+ types (scatter, geomap, treemap, pie, etc.) | 10+ types with conditional coloring | Line and bar only |
| 16 | **Dashboard templates** | Pre-built integration dashboards | Pre-built entity dashboards | No templates |
| 17 | **Metric units on charts** | Auto-formatted by unit type | Y-axis unit customization | Units stored but not rendered on axes |
| 18 | **Tag/attribute auto-discovery from infrastructure** | Auto-detects AWS, K8s, Chef tags | K8s label ingestion | Manual only via OTEL resource attributes |

### 3.3 Nice-to-Have Gaps

| # | Gap | Description |
|---|-----|-------------|
| 19 | **Natural language metric querying** | DataDog's NLQ translates English to metric queries |
| 20 | **Events to Metrics conversion** | New Relic creates low-cardinality metrics from high-cardinality events |
| 21 | **Metric cost/volume management UI** | Both competitors provide dashboards showing metric volume, cost attribution |
| 22 | **Notebook / investigation mode** | DataDog Notebooks combine metrics with markdown for investigations |
| 23 | **Custom SDK visualizations** | New Relic allows building custom chart types via SDK |
| 24 | **Split graph by tag** | DataDog splits a single graph into sub-graphs by tag values |

---

## 4. Prioritized Improvement Roadmap

### Phase 1: Foundation (Weeks 1-4) - Close Critical Gaps

#### 4.1 Add Percentile Aggregations
- **What:** Support p50, p75, p90, p95, p99 aggregations on histogram/distribution metrics
- **Why:** This is table-stakes for any metrics product. Without percentiles, users cannot analyze latency distributions meaningfully
- **How:** ClickHouse supports `quantile()` and `quantileExact()` functions. Extend `AggregationType` enum to include Percentile variants. For histogram data stored with `bucketCounts` and `explicitBounds`, implement approximate percentile calculation from bucket data
- **Files:** `Common/Types/BaseDatabase/AggregationType.ts`, `Common/Server/Services/MetricService.ts`, query building logic

#### 4.2 Add Rate/Derivative Calculations
- **What:** Compute per-second rates and deltas from counter/sum metrics
- **Why:** Raw cumulative counters are meaningless without rate calculation (e.g., "requests per second" vs "total requests since boot")
- **How:** Add `Rate` and `Delta` as aggregation options. For cumulative sums, compute `(value_t - value_t-1) / (time_t - time_t-1)`. ClickHouse `runningDifference()` can help
- **Files:** `AggregationType.ts`, metric query execution layer

#### 4.3 Support Multi-Attribute GROUP BY
- **What:** Allow grouping by multiple attributes simultaneously (e.g., by region AND status_code)
- **Why:** Single-attribute grouping is too limiting for real-world debugging. Users need to slice data across multiple dimensions
- **How:** Change `groupByAttribute` from `string` to `string[]` in MetricsQuery. Update ClickHouse queries to GROUP BY multiple extracted JSON attributes
- **Files:** `Common/Types/Metrics/MetricsQuery.ts`, chart rendering logic

#### 4.4 Implement Rollups / Downsampling
- **What:** Pre-aggregate metrics at 1-minute, 5-minute, 1-hour, and 1-day intervals into separate ClickHouse tables or materialized views
- **Why:** Without rollups, querying a week of data at second granularity is prohibitively slow and expensive. The current 15-day default retention severely limits historical analysis
- **How:** Use ClickHouse materialized views to automatically create rollup tables. Route queries to the appropriate rollup based on the requested time range. Extend retention to 13+ months for rollup data
- **Impact:** Enables long-range queries, reduces query cost, and unlocks meaningful historical analysis

### Phase 2: Visualization & UX (Weeks 5-8)

#### 4.5 Add More Chart Types
- **Priority charts:** Heatmap (essential for histogram/distribution data), stacked area, pie/donut, scatter plot, single-value "billboard"
- **Why:** Line and bar charts cannot adequately represent distribution data or give at-a-glance metric summaries
- **How:** Integrate a more capable charting library or extend existing ChartGroup with new chart types

#### 4.6 Time-Over-Time Comparison
- **What:** Allow users to overlay current metric data with data from a previous period (1 hour ago, 1 day ago, 1 week ago)
- **Why:** Extremely useful for identifying deviations from normal patterns. Both competitors support this
- **How:** Execute the same query twice with shifted time ranges and overlay results on the same chart

#### 4.7 Render Metric Units on Charts
- **What:** Display units (ms, bytes, req/s, %, etc.) on Y-axis labels and tooltips
- **Why:** Units are already stored in MetricType but not rendered. Without units, charts are ambiguous
- **How:** Pass `MetricType.unit` through to chart rendering. Implement unit-aware formatting (e.g., auto-convert bytes to KB/MB/GB)

#### 4.8 Dashboard Templates
- **What:** Pre-built dashboards for common scenarios: HTTP service health, database performance, Kubernetes metrics, host metrics
- **Why:** Reduces time-to-value. Users should see useful data immediately after connecting their first service
- **How:** Create MetricsViewConfig templates that auto-populate based on detected metric names

### Phase 3: Alerting & Intelligence (Weeks 9-14)

#### 4.9 Anomaly Detection
- **What:** Detect metrics deviating from expected patterns using statistical methods
- **Why:** Static thresholds miss gradual degradation and produce false alarms during expected traffic changes. Both competitors treat this as a core feature
- **How:**
  - Start with simple statistical methods: rolling mean + N standard deviations (configurable sensitivity)
  - Account for daily/weekly seasonality by comparing to same-time-last-week
  - Store baseline data in ClickHouse for efficient comparison
  - Surface anomalies as alerts and visual highlights on charts

#### 4.10 SLO/SLI Tracking
- **What:** Let users define Service Level Objectives based on metric queries. Track SLI attainment over rolling windows. Calculate and display error budgets
- **Why:** SLOs are how modern teams measure reliability. Without SLO support, OneUptime cannot serve as a primary observability tool for SRE teams
- **How:**
  - New SLO model: target percentage, SLI metric query (good events / total events), time window (7-day, 28-day, 30-day rolling)
  - SLO dashboard showing attainment vs target, error budget remaining, burn rate
  - Alert when error budget drops below threshold or burn rate is too high
  - Integrate with existing monitor/incident system

#### 4.11 Metric Correlations
- **What:** When a metric anomaly is detected, automatically identify other metrics that changed around the same time
- **Why:** Dramatically reduces mean-time-to-root-cause. Instead of manually checking dozens of dashboards, the system surfaces likely related changes
- **How:** When an anomaly is detected, query all metrics for the same service/project in the surrounding time window. Rank by correlation coefficient with the anomalous metric. Surface top correlated metrics in the alert/incident view

### Phase 4: Scale & Power Features (Weeks 15-20)

#### 4.12 Cardinality Management
- **What:** Track metric cardinality (unique combinations of metric name + attribute values). Alert on cardinality spikes. Allow users to drop high-cardinality attributes
- **Why:** Uncontrolled cardinality is the #1 cause of metrics cost explosion. Without visibility and controls, users will either hit performance issues or leave the platform
- **How:**
  - Track unique series count per metric name in a separate ClickHouse table
  - Dashboard showing top metrics by cardinality, trend over time
  - Attribute-level cardinality breakdown (which attribute key is causing the explosion)
  - Allow configuring attribute allowlists/blocklists per metric (applied at ingest)

#### 4.13 Query Language
- **What:** A text-based metrics query language (inspired by PromQL or NRQL) for advanced users
- **Why:** Form-based UIs hit a ceiling for complex queries. Power users need the expressiveness of a query language for nested aggregations, complex filters, and ad-hoc analysis
- **How:** Define a simple grammar supporting: `metric_name{attribute="value"} | aggregation(duration) by (attribute1, attribute2)`. Parse to the existing ClickHouse query builder. Offer both UI builder and text modes (like New Relic's basic/advanced toggle)

#### 4.14 Golden Signals Dashboards
- **What:** Auto-generated dashboards showing the four golden signals (Latency, Traffic, Errors, Saturation) for each service
- **Why:** Provides immediate value without manual dashboard configuration. New Relic's pre-built golden signals dashboards are a major selling point
- **How:** Detect common OpenTelemetry metric names (http.server.duration, http.server.request.count, etc.) and auto-create dashboards with appropriate chart types and alert thresholds

#### 4.15 Predictive Alerting
- **What:** Forecast metric values into the near future and alert before thresholds are breached
- **Why:** Shifts from reactive to proactive monitoring. Particularly valuable for capacity planning (disk filling up, memory growing)
- **How:** Use linear regression or Holt-Winters on recent data to project forward. Alert if the projected value crosses a threshold within a configurable forecast window (e.g., "disk will be full in 4 hours")

---

## 5. Quick Wins (Can Ship This Week)

These require minimal effort and immediately improve the metrics experience:

1. **Display units on chart Y-axes** - Data already exists in MetricType, just needs wiring to chart rendering
2. **Add p50/p95/p99 to aggregation dropdown** - ClickHouse `quantile()` is straightforward to add
3. **Extend default retention** - 15 days is too short; increase default to 30 days for raw data
4. **Multi-attribute GROUP BY** - Change `groupByAttribute: string` to `groupByAttribute: string[]`
5. **Add stacked area chart type** - Simple extension of existing line chart

---

## 6. Architecture Recommendations

### 6.1 Rollup Architecture
```
Raw Data (1s resolution) -> 15-day retention
  |-> Materialized View -> 1-min rollups -> 90-day retention
  |-> Materialized View -> 1-hour rollups -> 13-month retention
  |-> Materialized View -> 1-day rollups -> 3-year retention
```
Route queries based on time range:
- < 6 hours: raw data
- 6 hours - 7 days: 1-min rollups
- 7 days - 30 days: 1-hour rollups
- 30 days+: 1-day rollups

### 6.2 Cardinality Tracking
```
Ingest Pipeline -> Count unique series -> Write to CardinalityTracking table
  |-> Periodic job: alert if cardinality > configured budget
  |-> Dashboard: show top-N metrics by cardinality
```

### 6.3 Anomaly Detection Pipeline
```
Metric Data -> Periodic baseline computation (hourly)
  |-> Store baselines (mean, stddev, seasonal patterns)
  |-> On each new data point: compare to baseline
  |-> If deviation > threshold: create anomaly event
  |-> Correlation engine: find related metric changes
```

---

## 7. Competitive Positioning Summary

| Capability | DataDog | New Relic | OneUptime Today | OneUptime After Roadmap |
|-----------|---------|-----------|-----------------|------------------------|
| OTLP ingestion | Yes | Yes | Yes | Yes |
| Percentiles | Yes | Yes | No | Yes (Phase 1) |
| Rates/deltas | Yes | Yes | No | Yes (Phase 1) |
| Rollups | Yes | Yes | No | Yes (Phase 1) |
| Heatmaps | Yes | Yes | No | Yes (Phase 2) |
| Time comparison | Yes | Yes | No | Yes (Phase 2) |
| Anomaly detection | Yes (AI) | Yes (AI) | No | Yes (Phase 3) |
| SLO/SLI | Yes | Yes | No | Yes (Phase 3) |
| Correlations | Yes | Yes | No | Yes (Phase 3) |
| Cardinality mgmt | Yes | Yes | No | Yes (Phase 4) |
| Query language | Partial | Yes (NRQL) | No | Yes (Phase 4) |
| Golden signals | Yes | Yes | No | Yes (Phase 4) |
| Predictive alerts | Yes | Yes | No | Yes (Phase 4) |
| Formulas | Yes | Yes | Yes | Yes |
| Custom dashboards | Yes | Yes | Yes | Enhanced |
| Open source | No | No | Yes | Yes |
| Self-hostable | No | No | Yes | Yes |

**OneUptime's differentiators after this roadmap:**
- Fully open-source and self-hostable (neither DataDog nor New Relic offers this)
- Native OTLP support without vendor agents or proprietary SDKs
- Transparent pricing without per-host or per-metric surprises
- Integrated with incident management, status pages, and monitors in a single platform

---

## 8. ClickHouse Storage Efficiency Audit

### 8.1 Current Table Configuration

```
Table: MetricItem
Engine: MergeTree
Sort/Primary Key: (projectId, time, serviceId)
Partition Key: sipHash64(projectId) % 16
TTL: retentionDate DELETE
Skip Indexes: BloomFilter on `name` (0.01 FPR, granularity 1), Set on `serviceType` (params [5], granularity 4)
```

### 8.2 Issues Found

#### CRITICAL: `name` missing from sort key

**Current:** `(projectId, time, serviceId)`
**Problem:** Virtually every metric query filters by `name` (e.g., `http_request_duration`, `cpu_usage`). Without `name` in the sort key, ClickHouse must scan all metric names within the time range for a project, relying only on the BloomFilter skip index to skip granules. For a project with 500 distinct metric names, queries for a single metric scan ~500x more data than necessary.

**Recommended sort key:** `(projectId, name, serviceId, time)`

This matches the dominant query pattern: "for project X, give me metric Y, optionally for service Z, over time range T." ClickHouse can binary-search directly to the right metric name instead of scanning all names. The tradeoff is that pure time-range queries across all metrics for a project become slightly less efficient, but that is a rare query pattern — users almost always filter by metric name.

#### HIGH: `DateTime` instead of `DateTime64` for time columns

**Current:** `time` column uses ClickHouse `DateTime` (second precision).
**Problem:** Metric data points often arrive at sub-second intervals from high-frequency instrumentation. Multiple data points within the same second share identical `time` values, making it impossible to distinguish ordering. The separate `timeUnixNano` column (stored as `Int128`) preserves nanosecond precision but is not in the sort key and is not used for time-range queries.

**Recommendation:** Use `DateTime64(3)` (millisecond precision) or `DateTime64(6)` (microsecond precision) for the `time` column. This also removes the need for separate `timeUnixNano`/`startTimeUnixNano` columns, reducing storage overhead and schema complexity.

#### MEDIUM: No skip index on `metricPointType`

**Problem:** Queries that filter by metric type (Sum vs Gauge vs Histogram) have no index support. Users frequently query specific metric types, especially when computing histogram percentiles or gauge averages.

**Recommendation:** Add a Set skip index on `metricPointType`, similar to the existing `serviceType` index:
```
skipIndex: { name: "idx_metric_point_type", type: Set, params: [5], granularity: 4 }
```

#### MEDIUM: `attributes` column type

**Current:** Stored as ClickHouse `JSON` (was experimental, now generally available).
**Consideration:** For attribute-based filtering, ClickHouse's `Map(String, String)` type allows direct key lookups without `JSONExtract*()` functions and is generally more performant for flat key-value data. However, since attributes can have nested values and mixed types, `JSON` may be intentional. The `attributeKeys` array column partially compensates by enabling key existence checks without parsing JSON.

**Recommendation:** Evaluate whether attribute queries are a performance bottleneck. If so, consider `Map(LowCardinality(String), String)` for flat attributes, keeping `JSON` only if nested structure is required.

#### LOW: No materialized views or projections

**Current:** `projections: []` (empty).
**Problem:** Common query patterns (aggregating by name+time, by service+time) could benefit from projections that pre-sort data in alternative orders, speeding up those queries without duplicating the full table.

**Recommendation:** Add projections for common alternative sort orders, e.g.:
- `(projectId, serviceId, name, time)` — for "show all metrics for service X" queries
- Consider materialized views for rollup tables (see Section 6.1)

#### LOW: `count` and `bucketCounts` use Int32

**Current:** `count` column is `Int32`, `bucketCounts` is `Array(Int32)`.
**Problem:** Histogram counts can exceed 2^31 (~2.1 billion) in high-throughput systems. Similarly, histogram bucket counts could overflow for high-cardinality histograms.

**Recommendation:** Use `Int64` / `UInt64` for `count` and `Array(Int64)` for `bucketCounts`.

### 8.3 What Is Done Well

| Aspect | Assessment |
|--------|-----------|
| **Partitioning** | `sipHash64(projectId) % 16` provides good multi-tenant data isolation and even distribution |
| **TTL-based retention** | `retentionDate DELETE` is clean and per-service configurable |
| **Async inserts** | `async_insert=1, wait_for_async_insert=0` correctly configured for high-throughput ingestion |
| **BloomFilter on `name`** | Good secondary defense for name lookups (but should not be the primary lookup path) |
| **Decimal types** | `value`/`sum`/`min`/`max` use `Double` which prevents integer truncation for floating-point aggregations |
| **Batch flushing** | Configurable batch size via `TELEMETRY_METRIC_FLUSH_BATCH_SIZE` prevents excessive small inserts |
| **Attribute key extraction** | `attributeKeys` array column enables efficient key existence queries without parsing JSON |

### 8.4 Recommended Changes Summary

| Priority | Change | Impact |
|----------|--------|--------|
| CRITICAL | Change sort key to `(projectId, name, serviceId, time)` | ~100x improvement for name-filtered queries |
| HIGH | Use `DateTime64(3)` or `DateTime64(6)` for time columns | Sub-second precision, removes need for `timeUnixNano` columns |
| MEDIUM | Add Set skip index on `metricPointType` | Faster type-filtered queries |
| MEDIUM | Evaluate `Map` type for `attributes` column | Faster attribute-based filtering |
| LOW | Add projections for alternative sort orders | Faster service-centric queries |
| LOW | Change `count` to `Int64`, `bucketCounts` to `Array(Int64)` | Prevents overflow for high-throughput histograms |

### 8.5 Migration Notes

Changing the sort key or column types on an existing table requires creating a new table with the desired schema and migrating data. ClickHouse does not support `ALTER TABLE ... MODIFY ORDER BY` on MergeTree tables (it only supports adding columns to the end of the sort key). The recommended migration approach:

1. Create `MetricItem_v2` with the new sort key and column types
2. Use `INSERT INTO MetricItem_v2 SELECT * FROM MetricItem` to backfill (can be done in batches)
3. Switch ingestion to write to `MetricItem_v2`
4. Update query layer to read from `MetricItem_v2`
5. Drop `MetricItem` after validation

For the `DateTime64` change, the migration must also convert existing `DateTime` values:
```sql
toDateTime64(time, 3) -- converts DateTime to DateTime64(3)
```

---

## 9. Key Files Reference

| Area | Key Files |
|------|-----------|
| Metric Model | `Common/Models/AnalyticsModels/Metric.ts` |
| MetricType Model | `Common/Models/DatabaseModels/MetricType.ts` |
| Ingest Service | `Telemetry/Services/OtelMetricsIngestService.ts` |
| Queue Service | `Telemetry/Services/Queue/MetricsQueueService.ts` |
| OTLP API | `Telemetry/API/OTelIngest.ts` |
| gRPC Server | `Telemetry/GrpcServer.ts` |
| Metric Service | `Common/Server/Services/MetricService.ts` |
| Query Types | `Common/Types/Metrics/MetricsQuery.ts` |
| View Config | `Common/Types/Metrics/MetricsViewConfig.ts` |
| Frontend Explorer | `App/FeatureSet/Dashboard/src/Components/Metrics/MetricExplorer.tsx` |
| Chart Rendering | `App/FeatureSet/Dashboard/src/Components/Metrics/MetricCharts.tsx` |
| Alert Criteria | `Common/Server/Utils/Monitor/Criteria/MetricMonitorCriteria.ts` |
| Aggregation Types | `Common/Types/BaseDatabase/AggregationType.ts` |
