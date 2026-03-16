# Plan: Bring OneUptime Metrics to Industry Parity and Beyond

## Context

OneUptime's metrics implementation provides OTLP ingestion (HTTP and gRPC), ClickHouse storage with support for Gauge, Sum, Histogram, and ExponentialHistogram metric types, basic aggregations (Avg, Sum, Min, Max, Count), single-attribute GROUP BY, formula support for calculated metrics, threshold-based metric monitors, and a metric explorer with line/bar charts. Auto-discovery creates MetricType metadata (name, description, unit) on first ingest. Per-service data retention with TTL (default 15 days).

This plan identifies the remaining gaps vs DataDog and New Relic, and proposes a phased implementation to close them and build a best-in-class metrics product.

## Completed

The following features have been implemented:
- **OTLP Ingestion** - HTTP and gRPC metric ingestion with async queue-based batch processing
- **Metric Types** - Gauge, Sum, Histogram, ExponentialHistogram support
- **ClickHouse Storage** - MergeTree with `sipHash64(projectId) % 16` partitioning, per-service TTL
- **Aggregations** - Avg, Sum, Min, Max, Count
- **Single-Attribute GROUP BY** - Group by one attribute at a time
- **Formulas** - Calculated metrics using aliases (e.g., `a / b * 100`)
- **Metric Explorer** - Time range selection, multiple queries with aliases, URL state persistence
- **Threshold-Based Monitors** - Static threshold alerting on aggregated metric values
- **MetricType Auto-Discovery** - Name, description, unit captured on first ingest
- **Attribute Storage** - Full JSON with extracted `attributeKeys` array for fast enumeration
- **BloomFilter index** on `name`, Set index on `serviceType`

## Gap Analysis Summary

| Feature | OneUptime | DataDog | New Relic | Priority |
|---------|-----------|---------|-----------|----------|
| Percentile aggregations (p50/p75/p90/p95/p99) | None | DDSketch distributions | NRQL percentile() | **P0** |
| Rate/derivative calculations | None | Native Rate type + .as_rate() | rate() NRQL function | **P0** |
| Multi-attribute GROUP BY | Single attribute only | Multiple tags | FACET on multiple attrs | **P0** |
| Rollup/downsampling for long-range queries | None (raw data, 15-day TTL) | Automatic tiered rollups | 30-day raw + 13-month rollups | **P0** |
| Anomaly detection | Static thresholds only | Watchdog + anomaly monitors | Anomaly detection + sigma bands | **P1** |
| SLO/SLI tracking | None | Metric-based + Time Slice SLOs | One-click setup + error budgets | **P1** |
| Heatmap visualization | None | Purpose-built for distributions | Built-in chart type | **P1** |
| Time-over-time comparison | None | Yes | COMPARE WITH in NRQL | **P1** |
| Summary metric type | Not supported | N/A (uses Distribution) | Yes | **P1** |
| Query language | Form-based UI only | Graphing editor + NLQ | Full NRQL language | **P2** |
| Predictive alerting | None | Watchdog forecasting | GA predictive alerting | **P2** |
| Metric correlations | None | Auto-surfaces related metrics | Applied Intelligence correlation | **P2** |
| Golden Signals dashboards | None | Available via APM | Pre-built with default alerts | **P2** |
| Cardinality management | None | Metrics Without Limits + Explorer | Budget system + pruning rules | **P2** |
| More chart types | Line and bar only | 12+ types | 10+ types with conditional coloring | **P2** |
| Dashboard templates | None | Pre-built integration dashboards | Pre-built entity dashboards | **P2** |
| Units on charts | Stored but not rendered | Auto-formatted by unit type | Y-axis unit customization | **P2** |
| Natural language querying | None | NLQ translates English to queries | None | **P3** |
| Metric cost/volume management | None | Cost attribution dashboards | Volume dashboards | **P3** |

---

## Phase 1: Foundation (P0) — Close Critical Gaps

These are table-stakes features without which the metrics product is fundamentally limited.

### 1.1 Percentile Aggregations (p50, p75, p90, p95, p99)

**Current**: Only Avg, Sum, Min, Max, Count aggregations.
**Target**: Support percentile aggregations on all metric data, especially histograms and distributions.

**Implementation**:

- Add `P50`, `P75`, `P90`, `P95`, `P99` to the `AggregationType` enum
- For raw metric values: use ClickHouse `quantile(0.50)(value)`, `quantile(0.95)(value)`, etc.
- For histogram data (with `bucketCounts` and `explicitBounds`): implement approximate percentile calculation from bucket data using linear interpolation between bucket boundaries
- Update the metric query builder to include percentile options in the aggregation dropdown
- Update chart rendering to display percentile series

**Files to modify**:
- `Common/Types/BaseDatabase/AggregationType.ts` (add P50, P75, P90, P95, P99)
- `Common/Server/Services/MetricService.ts` (generate quantile SQL)
- `App/FeatureSet/Dashboard/src/Components/Metrics/MetricQueryConfig.tsx` (add to dropdown)

### 1.2 Rate/Derivative Calculations

**Current**: No rate or delta computation. Raw cumulative counters are meaningless without rate calculation.
**Target**: Compute per-second rates and deltas from counter/sum metrics.

**Implementation**:

- Add `Rate` and `Delta` as aggregation options
- For cumulative sums: compute `(value_t - value_t-1) / (time_t - time_t-1)` using ClickHouse `runningDifference()`
- Handle counter resets (when value decreases, treat as reset and skip that interval)
- For delta temporality sums: rate is simply `value / interval_seconds`
- Display rate with appropriate units (e.g., "req/s", "bytes/s")

**Files to modify**:
- `Common/Types/BaseDatabase/AggregationType.ts` (add Rate, Delta)
- `Common/Server/Services/MetricService.ts` (generate rate SQL with runningDifference)
- `Common/Types/Metrics/MetricsQuery.ts` (support rate in query config)

### 1.3 Multi-Attribute GROUP BY

**Current**: Single `groupByAttribute: string` field.
**Target**: Group by multiple attributes simultaneously (e.g., by region AND status_code).

**Implementation**:

- Change `groupByAttribute` from `string` to `string[]` in `MetricsQuery`
- Update ClickHouse query generation to GROUP BY multiple extracted JSON attributes
- Update chart rendering to handle multi-dimensional grouping (composite legend labels)
- Update the UI to allow selecting multiple group-by attributes

**Files to modify**:
- `Common/Types/Metrics/MetricsQuery.ts` (change type)
- `Common/Server/Services/MetricService.ts` (update query generation)
- `App/FeatureSet/Dashboard/src/Components/Metrics/MetricQueryConfig.tsx` (multi-select UI)
- `App/FeatureSet/Dashboard/src/Components/Metrics/MetricGraph.tsx` (composite legends)

### 1.4 Rollups / Downsampling

**Current**: Raw data only with 15-day default TTL. No rollups means long-range queries are slow and historical analysis is limited.
**Target**: Pre-aggregated rollups at multiple resolutions with extended retention.

**Implementation**:

- Create ClickHouse materialized views for automatic rollup:
  ```
  Raw Data (1s resolution) -> 15-day retention
    |-> Materialized View -> 1-min rollups -> 90-day retention
    |-> Materialized View -> 1-hour rollups -> 13-month retention
    |-> Materialized View -> 1-day rollups -> 3-year retention
  ```
- Each rollup table stores: min, max, sum, count, avg, and quantile sketches per metric name + attributes
- Route queries based on time range:
  - < 6 hours: raw data
  - 6 hours - 7 days: 1-min rollups
  - 7 days - 30 days: 1-hour rollups
  - 30+ days: 1-day rollups
- Automatic query routing in the metric service layer

**Files to modify**:
- `Common/Models/AnalyticsModels/MetricRollup1Min.ts` (new)
- `Common/Models/AnalyticsModels/MetricRollup1Hour.ts` (new)
- `Common/Models/AnalyticsModels/MetricRollup1Day.ts` (new)
- `Common/Server/Services/MetricService.ts` (query routing by time range)
- `Worker/DataMigrations/` (new migration to create materialized views)

---

## Phase 2: Visualization & UX (P1) — Match Industry Standard

### 2.1 More Chart Types

**Current**: Line and bar charts only.
**Target**: Add Heatmap, Stacked Area, Pie/Donut, Scatter, Single-Value Billboard, and Gauge.

**Implementation**:

- **Heatmap**: Essential for histogram/distribution data. Use a heatmap library that renders time on X-axis, bucket values on Y-axis, and color intensity for count
- **Stacked Area**: Extension of existing line chart with fill and stacking
- **Pie/Donut**: For showing proportional breakdowns (e.g., request distribution by service)
- **Scatter**: For correlation analysis between two metrics
- **Billboard**: Large single-value display with configurable thresholds for color coding (green/yellow/red)
- **Gauge**: Circular gauge showing a value against a min/max range

**Files to modify**:
- `Common/Types/Dashboard/Chart/ChartType.ts` (add new chart types)
- `App/FeatureSet/Dashboard/src/Components/Metrics/MetricGraph.tsx` (render new chart types)
- `App/FeatureSet/Dashboard/src/Components/Metrics/MetricCharts.tsx` (chart type selector)

### 2.2 Time-Over-Time Comparison

**Current**: No comparison capability.
**Target**: Overlay current metric data with data from a previous period (1h ago, 1d ago, 1w ago).

**Implementation**:

- Add a "Compare with" dropdown in the metric explorer toolbar (options: 1 hour ago, 1 day ago, 1 week ago, custom)
- Execute the same query twice with shifted time ranges
- Render the comparison series as a dashed/translucent overlay on the same chart
- Show the delta (absolute and percentage) in tooltips

**Files to modify**:
- `App/FeatureSet/Dashboard/src/Components/Metrics/MetricExplorer.tsx` (add compare dropdown)
- `Common/Types/Metrics/MetricsQuery.ts` (add compareWith field)
- `App/FeatureSet/Dashboard/src/Components/Metrics/MetricGraph.tsx` (render comparison series)

### 2.3 Render Metric Units on Charts

**Current**: Units stored in MetricType but not rendered on chart axes.
**Target**: Display units on Y-axis labels and tooltips with smart formatting.

**Implementation**:

- Pass `MetricType.unit` through to chart rendering
- Implement unit-aware formatting:
  - Bytes: auto-convert to KB/MB/GB/TB
  - Duration: auto-convert ns/us/ms/s
  - Percentage: append `%`
  - Rate: append `/s`
- Display formatted unit on Y-axis label and in tooltip values

**Files to modify**:
- `App/FeatureSet/Dashboard/src/Components/Metrics/MetricGraph.tsx` (Y-axis unit formatting)
- `Common/Utils/Metrics/UnitFormatter.ts` (new - unit formatting logic)

### 2.4 Dashboard Templates

**Current**: No templates.
**Target**: Pre-built dashboards for common scenarios that auto-populate based on detected metrics.

**Implementation**:

- Create MetricsViewConfig templates for:
  - HTTP Service Health (request rate, error rate, latency percentiles)
  - Database Performance (query duration, connection pool, error rate)
  - Kubernetes Metrics (CPU, memory, pod restarts, network)
  - Host Metrics (CPU, memory, disk, network)
  - Runtime Metrics (GC, heap, threads - per language)
- Auto-detect which templates are relevant based on ingested metric names
- "One-click apply" creates a dashboard from the template

**Files to modify**:
- `Common/Types/Metrics/DashboardTemplates/` (new directory with template definitions)
- `App/FeatureSet/Dashboard/src/Pages/Dashboards/Templates.tsx` (new - template gallery)

### 2.5 Summary Metric Type Support

**Current**: Summary type not supported.
**Target**: Ingest and store Summary metrics from OTLP.

**Implementation**:

- Add `Summary` to the metric point type enum
- Store quantile values from summary data points
- Display summary quantiles in the metric explorer

**Files to modify**:
- `Telemetry/Services/OtelMetricsIngestService.ts` (handle summary type)
- `Common/Models/AnalyticsModels/Metric.ts` (add summary-specific columns if needed)

---

## Phase 3: Alerting & Intelligence (P1-P2) — Smart Monitoring

### 3.1 Anomaly Detection

**Current**: Static threshold alerting only.
**Target**: Detect metrics deviating from expected patterns using statistical methods.

**Implementation**:

- Start with rolling mean + N standard deviations (configurable sensitivity: low/medium/high)
- Account for daily/weekly seasonality by comparing to same-time-last-week baselines
- Store baselines in ClickHouse (periodic computation job, hourly)
- Baseline table: metric name, service, hour_of_week, mean, stddev
- On each evaluation: compare current value to baseline, alert if deviation > configured sigma
- Surface anomalies as visual highlights on metric charts (shaded band showing expected range)

**Files to modify**:
- `Common/Models/AnalyticsModels/MetricBaseline.ts` (new - baseline storage)
- `Worker/Jobs/Metrics/ComputeMetricBaselines.ts` (new - periodic baseline computation)
- `Common/Server/Utils/Monitor/Criteria/MetricMonitorCriteria.ts` (add anomaly detection)
- `App/FeatureSet/Dashboard/src/Components/Metrics/MetricGraph.tsx` (render anomaly bands)

### 3.2 SLO/SLI Tracking

**Current**: No SLO support.
**Target**: Define Service Level Objectives based on metric queries, track attainment over rolling windows, calculate error budgets.

**Implementation**:

- Create `SLO` PostgreSQL model:
  - Name, description, target percentage (e.g., 99.9%)
  - SLI definition: good events query / total events query (both metric queries)
  - Time window: 7-day, 28-day, or 30-day rolling
  - Alert thresholds: error budget remaining %, burn rate
- SLO dashboard page showing:
  - Current attainment vs target (e.g., 99.85% / 99.9%)
  - Error budget remaining (absolute and percentage)
  - Burn rate chart (current burn rate vs sustainable burn rate)
  - SLI time series chart
- Alert when error budget drops below threshold or burn rate exceeds sustainable rate
- Integrate with existing monitor/incident system

**Files to modify**:
- `Common/Models/DatabaseModels/SLO.ts` (new)
- `Common/Server/Services/SLOService.ts` (new - SLI computation, budget calculation)
- `Worker/Jobs/SLO/EvaluateSLOs.ts` (new - periodic SLO evaluation)
- `App/FeatureSet/Dashboard/src/Pages/SLO/` (new - SLO list, detail, creation pages)

### 3.3 Metric Correlations

**Current**: No correlation capability.
**Target**: When an anomaly is detected, automatically identify other metrics that changed around the same time.

**Implementation**:

- When an anomaly is detected on a metric, query all metrics for the same service/project in the surrounding time window (e.g., +/- 30 minutes)
- Compute Pearson correlation coefficient between the anomalous metric and each candidate
- Rank by absolute correlation value
- Surface top 5-10 correlated metrics in the alert/incident view
- Show correlation chart: anomalous metric overlaid with top correlated metrics

**Files to modify**:
- `Common/Server/Services/MetricCorrelationService.ts` (new)
- `App/FeatureSet/Dashboard/src/Components/Metrics/CorrelatedMetrics.tsx` (new - correlation view)

---

## Phase 4: Scale & Power Features (P2-P3) — Differentiation

### 4.1 Cardinality Management

**Current**: No cardinality visibility or controls.
**Target**: Track unique series count, alert on spikes, allow attribute allowlist/blocklist.

**Implementation**:

- Track unique series count per metric name (via periodic ClickHouse `uniq()` queries)
- Store in a dedicated cardinality tracking table
- Dashboard showing: top metrics by cardinality, cardinality trend over time, per-attribute breakdown
- Allow configuring attribute allowlists/blocklists per metric (applied at ingest time)
- Alert when cardinality exceeds configured budget

**Files to modify**:
- `Worker/Jobs/Metrics/TrackMetricCardinality.ts` (new - periodic cardinality computation)
- `Common/Models/DatabaseModels/MetricCardinalityConfig.ts` (new - allowlist/blocklist)
- `Telemetry/Services/OtelMetricsIngestService.ts` (apply attribute filtering)
- `App/FeatureSet/Dashboard/src/Pages/Settings/MetricCardinality.tsx` (new - cardinality dashboard)

### 4.2 Query Language

**Current**: Form-based UI only.
**Target**: Text-based metrics query language inspired by PromQL/NRQL for advanced users.

**Implementation**:

- Define a grammar supporting:
  ```
  metric_name{attribute="value", attribute2=~"regex"}
    | aggregation(duration)
    by (attribute1, attribute2)
  ```
- Build a parser that translates to the existing ClickHouse query builder
- Offer both UI builder and text modes (toggle like New Relic's basic/advanced)
- Syntax highlighting and autocomplete in the text editor (metric names, attribute keys, functions)
- Functions: `rate()`, `delta()`, `avg()`, `sum()`, `min()`, `max()`, `p50()`, `p95()`, `p99()`, `count()`, `topk()`, `bottomk()`

**Files to modify**:
- `Common/Utils/Metrics/MetricsQueryLanguage.ts` (new - parser and translator)
- `App/FeatureSet/Dashboard/src/Components/Metrics/MetricQueryEditor.tsx` (new - text editor with autocomplete)

### 4.3 Golden Signals Dashboards

**Current**: No auto-generated dashboards.
**Target**: Auto-generated dashboards showing Latency, Traffic, Errors, Saturation for each service.

**Implementation**:

- Detect common OpenTelemetry metric names per service:
  - Latency: `http.server.duration`, `http.server.request.duration`
  - Traffic: `http.server.request.count`, `http.server.active_requests`
  - Errors: `http.server.request.count` where status_code >= 500
  - Saturation: `process.runtime.*.memory`, `system.cpu.utilization`
- Auto-create a Golden Signals dashboard for each service with detected metrics
- Include default alert thresholds

**Files to modify**:
- `Worker/Jobs/Metrics/GenerateGoldenSignalsDashboards.ts` (new)
- `Common/Utils/Metrics/GoldenSignalsDetector.ts` (new - metric name pattern matching)

### 4.4 Predictive Alerting

**Current**: No forecasting capability.
**Target**: Forecast metric values and alert before thresholds are breached.

**Implementation**:

- Use linear regression or Holt-Winters on recent data to project forward
- Alert if projected value crosses threshold within configurable forecast window (e.g., "disk full in 4 hours")
- Particularly valuable for capacity planning metrics (disk, memory, connection pools)
- Show forecast as a dashed line extension on metric charts

**Files to modify**:
- `Common/Server/Utils/Monitor/Criteria/MetricMonitorCriteria.ts` (add predictive evaluation)
- `Common/Utils/Metrics/Forecasting.ts` (new - regression/Holt-Winters)
- `App/FeatureSet/Dashboard/src/Components/Metrics/MetricGraph.tsx` (render forecast line)

---

## ClickHouse Storage Improvements

### S.1 Fix Sort Key Order (CRITICAL)

**Current**: Sort key is `(projectId, time, serviceId)`.
**Target**: Change to `(projectId, name, serviceId, time)`.

**Impact**: ~100x improvement for name-filtered queries. Virtually every metric query filters by `name`, but currently ClickHouse must scan all metric names within the time range.

**Migration**: Requires creating `MetricItem_v2` with new sort key and migrating data (ClickHouse doesn't support `ALTER TABLE MODIFY ORDER BY`).

**Files to modify**:
- `Common/Models/AnalyticsModels/Metric.ts` (change sort key)
- `Worker/DataMigrations/` (new migration - create v2 table, backfill, swap)

### S.2 Upgrade time to DateTime64 (HIGH)

**Current**: `DateTime` with second precision.
**Target**: `DateTime64(3)` or `DateTime64(6)` for sub-second precision.

**Impact**: Correct sub-second metric ordering. Removes need for separate `timeUnixNano`/`startTimeUnixNano` columns.

**Files to modify**:
- `Common/Models/AnalyticsModels/Metric.ts` (change column type)
- `Common/Types/AnalyticsDatabase/TableColumnType.ts` (add DateTime64 type if not present)
- `Common/Server/Utils/AnalyticsDatabase/StatementGenerator.ts` (handle DateTime64)
- `Worker/DataMigrations/` (migration)

### S.3 Add Skip Index on metricPointType (MEDIUM)

**Current**: No index support for metric type filtering.
**Target**: Set skip index on `metricPointType`.

**Files to modify**:
- `Common/Models/AnalyticsModels/Metric.ts` (add skip index)

### S.4 Evaluate Map Type for Attributes (MEDIUM)

**Current**: Attributes stored as JSON.
**Target**: Evaluate `Map(LowCardinality(String), String)` for faster attribute-based filtering.

### S.5 Upgrade count/bucketCounts to Int64 (LOW)

**Current**: `Int32` for count and `Array(Int32)` for bucketCounts.
**Target**: `Int64` / `Array(Int64)` to prevent overflow in high-throughput systems.

---

## Quick Wins (Can Ship This Week)

1. **Display units on chart Y-axes** - Data exists in MetricType, just needs wiring to chart rendering
2. **Add p50/p95/p99 to aggregation dropdown** - ClickHouse `quantile()` is straightforward to add
3. **Extend default retention** - 15 days is too short; increase default to 30 days
4. **Multi-attribute GROUP BY** - Change `groupByAttribute: string` to `groupByAttribute: string[]`
5. **Add stacked area chart type** - Simple extension of existing line chart
6. **Add skip index on metricPointType** - Low effort, faster type-filtered queries

---

## Recommended Implementation Order

1. **Quick Wins** - Ship units on charts, p50/p95/p99, multi-attribute GROUP BY, stacked area
2. **Phase 1.1** - Percentile aggregations (full implementation beyond quick win)
3. **Phase 1.2** - Rate/derivative calculations
4. **S.1** - Fix sort key order (critical performance improvement)
5. **Phase 1.4** - Rollups/downsampling (enables long-range queries)
6. **Phase 2.1** - More chart types (heatmap, pie, gauge, billboard)
7. **Phase 2.2** - Time-over-time comparison
8. **Phase 1.3** - Multi-attribute GROUP BY (full implementation)
9. **S.2** - Upgrade time to DateTime64
10. **Phase 3.1** - Anomaly detection
11. **Phase 3.2** - SLO/SLI tracking
12. **Phase 2.4** - Dashboard templates
13. **Phase 4.1** - Cardinality management
14. **Phase 4.2** - Query language
15. **Phase 4.3** - Golden Signals dashboards
16. **Phase 4.4** - Predictive alerting
17. **Phase 3.3** - Metric correlations

## Verification

For each feature:
1. Unit tests for new aggregation types, rate calculations, unit formatting, query language parser
2. Integration tests for new API endpoints (percentiles, rollup queries, SLO evaluation)
3. Manual verification via the dev server at `https://oneuptimedev.genosyn.com/dashboard/{projectId}/metrics`
4. Check ClickHouse query performance with `EXPLAIN` for new query patterns
5. Verify rollup accuracy by comparing rollup results to raw data results for overlapping time ranges
6. Load test cardinality tracking and anomaly detection jobs to ensure they don't impact ingestion
