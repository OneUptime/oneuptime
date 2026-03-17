# Plan: Bring OneUptime Traces to Industry Parity and Beyond

## Context

OneUptime's trace implementation provides OTLP-native ingestion (HTTP and gRPC), ClickHouse storage with a full OpenTelemetry span model (events, links, status, attributes, resources, scope), a Gantt/waterfall visualization, trace-to-log and trace-to-exception correlation, a basic service dependency graph, queue-based async ingestion, and per-service data retention with TTL. ClickHouse schema has been optimized with BloomFilter indexes on traceId/spanId/parentSpanId, Set indexes on statusCode/kind/hasException, TokenBF on name, and ZSTD compression on key columns.

This plan identifies the remaining gaps vs DataDog, NewRelic, Honeycomb, and Grafana Tempo, and proposes a phased implementation to close them and surpass competition.

## Completed

The following features have been implemented:
- **OTLP Ingestion** - HTTP and gRPC trace ingestion with async queue-based processing
- **ClickHouse Storage** - MergeTree with `sipHash64(projectId) % 16` partitioning, per-service TTL
- **Gantt/Waterfall View** - Hierarchical span visualization with color-coded services, time-unit auto-scaling, error indicators
- **Trace-to-Log Correlation** - Log model has traceId/spanId columns; SpanViewer shows associated logs
- **Trace-to-Exception Correlation** - ExceptionInstance model links to traceId/spanId with stack trace parsing and fingerprinting
- **Span Detail Panel** - Side-over with tabs for Basic Info, Logs, Attributes, Events, Exceptions
- **BloomFilter indexes** on traceId, spanId, parentSpanId
- **Set indexes** on statusCode, kind, hasException
- **TokenBF index** on name
- **ZSTD compression** on time/ID/attribute columns
- **hasException boolean column** for fast error span filtering
- **links default value** corrected to `[]`
- **Basic Trace-Based Alerting** - MonitorType.Traces with span count threshold alerting, span name/status/service/attribute filtering, time window (5s-24h), worker job running every minute, frontend form with preview
- **S.1** - Migrate `attributes` to Map(String, String) (TableColumnType.MapStringString in Span model with `attributeKeys` array for fast enumeration)
- **S.2** - Aggregation Projections (`proj_agg_by_service` for service-level COUNT/AVG/P99 aggregation, `proj_trace_by_id` for trace-by-ID queries)
- **Phase 2.1** - Flame Graph View (`FlameGraph.tsx`) — proportional rectangles by duration, service color coding, double-click to zoom subtree, tooltip with name/service/duration/self-time
- **Phase 2.2** - Latency Breakdown / Critical Path Analysis (`CriticalPath.ts`) — critical path algorithm (longest sequential chain), self-time computation (merged overlapping child intervals), service latency breakdown, critical path toggle in TraceExplorer, self-time display in SpanViewer
- **Phase 2.3** - In-Trace Span Search — search bar in TraceExplorer filtering by span name, span ID, or service name with match count display
- **Phase 2.4** - Per-Trace Service Flow Map (`TraceServiceMap.tsx`) — directed graph with Kahn's algorithm topological layout, SVG curved edges, call count/avg latency labels, error highlighting
- **Phase 2.5** - Span Link Navigation — clickable SpanLink entries in SpanViewer "Links" tab with trace navigation

## Gap Analysis Summary

| Feature | OneUptime | DataDog | NewRelic | Tempo/Honeycomb | Priority |
|---------|-----------|---------|----------|-----------------|----------|
| Trace analytics / aggregation engine | None | Trace Explorer with COUNT/percentiles | NRQL on span data | TraceQL rate/count/quantile | **P0** |
| RED metrics from traces | None | Auto-computed on 100% traffic | Derived golden signals | Metrics-generator to Prometheus | **P0** |
| Trace-based alerting | **Partial** — span count only, no latency/error rate/Apdex | APM Monitors (p50-p99, error rate, Apdex) | NRQL alert conditions | Via Grafana alerting / Triggers | **P0** |
| Sampling controls | None (100% ingestion) | Head-based adaptive + retention filters | Infinite Tracing (tail-based) | Refinery (rules/dynamic/tail) | **P0** |
| Flame graph view | **Yes** | Yes (default view) | No | No | ~~P1~~ Done |
| Latency breakdown / critical path | **Yes** | Per-hop latency, bottleneck detection | No | BubbleUp (Honeycomb) | ~~P1~~ Done |
| In-trace search | **Yes** | Yes | No | No | ~~P1~~ Done |
| Per-trace service map | **Yes** | Yes (Map view) | No | No | ~~P1~~ Done |
| Trace-to-metric exemplars | None | Pivot from metric graph to traces | Metric-to-trace linking | Prometheus exemplars | **P1** |
| Custom metrics from spans | None | Generate count/distribution/gauge from tags | Via NRQL | SLOs from span data | **P2** |
| Structural trace queries | None | Trace Queries (multi-span relationships) | Via NRQL | TraceQL spanset pipelines | **P2** |
| Trace comparison / diffing | None | Partial | Side-by-side comparison | compare() in TraceQL | **P2** |
| AI/ML on traces | None | Watchdog (auto anomaly + RCA) | NRAI | BubbleUp (pattern detection) | **P3** |
| RUM correlation | None | Frontend-to-backend trace linking | Yes | Faro / frontend observability | **P3** |
| Continuous profiling | None | Code Hotspots (span-to-profile) | Partial | Pyroscope | **P3** |

---

## Phase 1: Analytics & Alerting Foundation (P0) — Highest Impact

Without these, users cannot answer basic questions like "is my service healthy?" from trace data.

### 1.1 Trace Analytics / Aggregation Engine

**Current**: Can list/filter individual spans and view individual traces. No way to aggregate or compute statistics.
**Target**: Full trace analytics supporting COUNT, AVG, SUM, MIN, MAX, P50/P75/P90/P95/P99 aggregations with GROUP BY on any span attribute and time-series bucketing.

**Implementation**:

- Build a trace analytics API endpoint that translates query configs into ClickHouse aggregation queries
- Use ClickHouse's native functions: `quantile(0.99)(durationUnixNano)`, `countIf(statusCode = 2)`, `toStartOfInterval(startTime, INTERVAL 1 MINUTE)`
- Support GROUP BY on service, span name, kind, status, and any custom attribute (via JSON extraction)
- Frontend: Add an "Analytics" tab to the Traces page with chart types (timeseries, top list, table) similar to the existing LogsAnalyticsView
- Support switching between "List" view (current) and "Analytics" view

**Files to modify**:
- `Common/Server/API/TelemetryAPI.ts` (add trace analytics endpoint)
- `Common/Server/Services/SpanService.ts` (add aggregation query methods)
- `Common/Types/Traces/TraceAnalyticsQuery.ts` (new - query interface)
- `App/FeatureSet/Dashboard/src/Pages/Traces/Index.tsx` (add analytics view toggle)
- `App/FeatureSet/Dashboard/src/Components/Traces/TraceAnalyticsView.tsx` (new - analytics UI)

### 1.2 RED Metrics from Traces (Request Rate, Error Rate, Duration)

**Current**: No automatic computation of service-level metrics from trace data.
**Target**: Auto-computed per-service, per-operation RED metrics displayed on a Service Overview page.

**Implementation**:

- Create a ClickHouse materialized view that aggregates spans into per-service, per-operation metrics at 1-minute intervals:
  ```sql
  CREATE MATERIALIZED VIEW span_red_metrics
  ENGINE = AggregatingMergeTree()
  ORDER BY (projectId, serviceId, name, minute)
  AS SELECT
    projectId, serviceId, name,
    toStartOfMinute(startTime) AS minute,
    countState() AS request_count,
    countIfState(statusCode = 2) AS error_count,
    quantileState(0.50)(durationUnixNano) AS p50_duration,
    quantileState(0.95)(durationUnixNano) AS p95_duration,
    quantileState(0.99)(durationUnixNano) AS p99_duration
  FROM SpanItem
  GROUP BY projectId, serviceId, name, minute
  ```
- Build a Service Overview page showing: request rate chart, error rate chart, p50/p95/p99 latency charts
- Add an API endpoint to query the materialized view

**Files to modify**:
- `Common/Models/AnalyticsModels/SpanRedMetrics.ts` (new - materialized view model)
- `Telemetry/Services/SpanRedMetricsService.ts` (new - query service)
- `App/FeatureSet/Dashboard/src/Pages/Service/View/Overview.tsx` (new or enhanced - RED dashboard)
- `Worker/DataMigrations/` (new migration to create materialized view)

### 1.3 Trace-Based Alerting — Extend Beyond Span Count

**Current**: Basic trace alerting is implemented with `MonitorType.Traces`. The existing system supports:
- Filtering by span name, span status (Unset/Ok/Error), service, and attributes
- Configurable time windows (5s to 24h)
- Worker job evaluating every minute via `MonitorTelemetryMonitor`
- **Only one criteria check**: `CheckOn.SpanCount` — compares matching span count against a threshold
- Frontend form (`TraceMonitorStepForm.tsx`) with preview of matching spans

**What's missing**: The current implementation can only answer "are there more/fewer than N spans matching this filter?" It cannot alert on latency, error rates, or throughput — the core APM alerting use cases.

**Target**: Full APM-grade alerting with latency percentiles, error rate, request rate, and Apdex.

**Implementation — extend existing infrastructure**:

#### 1.3.1 Add Latency Percentile Alerts (P50/P90/P95/P99)
- Add `CheckOn.P50Latency`, `CheckOn.P90Latency`, `CheckOn.P95Latency`, `CheckOn.P99Latency` to `CriteriaFilter.ts`
- In `monitorTrace()` worker function, compute `quantile(0.50)(durationUnixNano)` etc. via ClickHouse instead of just `countBy()`
- Return latency values in `TraceMonitorResponse` alongside span count
- Add latency criteria evaluation in `TraceMonitorCriteria.ts`

#### 1.3.2 Add Error Rate Alerts
- Add `CheckOn.ErrorRate` to `CriteriaFilter.ts`
- Compute `countIf(statusCode = 2) / count() * 100` in the worker query
- Return error rate percentage in `TraceMonitorResponse`
- Criteria: "alert if error rate > 5%"

#### 1.3.3 Add Average/Max Duration Alerts
- Add `CheckOn.AvgDuration`, `CheckOn.MaxDuration` to `CriteriaFilter.ts`
- Compute `avg(durationUnixNano)`, `max(durationUnixNano)` in worker query
- Useful for simpler latency alerts without percentile overhead

#### 1.3.4 Add Request Rate (Throughput) Alerts
- Add `CheckOn.SpanRate` to `CriteriaFilter.ts`
- Compute `count() / time_window_seconds` to normalize to spans/second
- Criteria: "alert if request rate drops below 10 req/s" (detects outages)

#### 1.3.5 Add Apdex Score (Nice-to-have)
- Add `CheckOn.ApdexScore` to `CriteriaFilter.ts`
- Compute from duration thresholds: `(satisfied + tolerating*0.5) / total`
- Allow configuring satisfied/tolerating thresholds per monitor (e.g., satisfied < 500ms, tolerating < 2s)

**Files to modify**:
- `Common/Types/Monitor/CriteriaFilter.ts` (add new CheckOn values: P50Latency, P90Latency, P95Latency, P99Latency, ErrorRate, AvgDuration, MaxDuration, SpanRate, ApdexScore)
- `Common/Types/Monitor/TraceMonitor/TraceMonitorResponse.ts` (add latency, error rate, throughput fields)
- `Common/Server/Utils/Monitor/Criteria/TraceMonitorCriteria.ts` (add evaluation for new criteria types)
- `Worker/Jobs/TelemetryMonitor/MonitorTelemetryMonitor.ts` (change `monitorTrace()` from `countBy()` to aggregation query returning all metrics)
- `App/FeatureSet/Dashboard/src/Components/Form/Monitor/TraceMonitor/TraceMonitorStepForm.tsx` (add criteria type selector for latency/error rate/throughput)

### 1.4 Head-Based Probabilistic Sampling

**Current**: Ingests 100% of received traces.
**Target**: Configurable per-service probabilistic sampling with rules to always keep errors and slow traces.

**Implementation**:

- Create `TraceSamplingRule` PostgreSQL model: service filter, sample rate (0-100%), conditions to always keep (error status, duration > threshold)
- Evaluate sampling rules in `OtelTracesIngestService.ts` before ClickHouse insert
- Use deterministic sampling based on traceId hash (so all spans from the same trace are kept or dropped together)
- UI under Settings > Trace Configuration > Sampling Rules
- Show estimated storage savings

**Files to modify**:
- `Common/Models/DatabaseModels/TraceSamplingRule.ts` (new)
- `Telemetry/Services/OtelTracesIngestService.ts` (add sampling logic)
- Dashboard: new Settings page for sampling configuration

---

## Phase 3: Advanced Analytics & Correlation (P2) — Power Features

### 3.1 Trace-to-Metric Exemplars

**Current**: Metric model has no traceId/spanId fields.
**Target**: Link metric data points to trace IDs; show exemplar dots on metric charts that navigate to traces.

**Implementation**:

- Add optional `traceId` and `spanId` columns to the Metric ClickHouse model
- During metric ingestion, extract exemplar trace/span IDs from OTLP exemplar fields
- On metric charts, render exemplar dots at data points that have associated traces
- Clicking an exemplar dot navigates to the trace view

**Files to modify**:
- `Common/Models/AnalyticsModels/Metric.ts` (add traceId/spanId columns)
- `Telemetry/Services/OtelMetricsIngestService.ts` (extract exemplars)
- `App/FeatureSet/Dashboard/src/Components/Metrics/MetricGraph.tsx` (render exemplar dots)

### 3.2 Custom Metrics from Spans

**Current**: No way to create persistent metrics from trace data.
**Target**: Users define custom metrics from span attributes that are computed via ClickHouse materialized views and available for alerting and dashboards.

**Implementation**:

- Create `SpanDerivedMetric` model: name, filter query (which spans), aggregation (count/avg/p99 of what field), GROUP BY attributes
- Use ClickHouse materialized views for efficient computation
- Surface derived metrics in the metric explorer and alerting system

**Files to modify**:
- `Common/Models/DatabaseModels/SpanDerivedMetric.ts` (new)
- `Common/Server/Services/SpanDerivedMetricService.ts` (new)
- Dashboard: UI for defining derived metrics

### 3.3 Structural Trace Queries

**Current**: Can only filter on individual span attributes.
**Target**: Query traces based on properties of multiple spans and their relationships (e.g., "find traces where service A called service B and B returned an error").

**Implementation**:

- Design a visual query builder for structural queries (easier adoption than a query language)
- Translate structural queries to ClickHouse subqueries with JOINs on traceId
- Example: "Find traces where span with service=frontend has child span with service=database AND duration > 500ms"
  ```sql
  SELECT DISTINCT s1.traceId FROM SpanItem s1
  JOIN SpanItem s2 ON s1.traceId = s2.traceId AND s1.spanId = s2.parentSpanId
  WHERE s1.projectId = {pid}
    AND JSONExtractString(s1.attributes, 'service.name') = 'frontend'
    AND JSONExtractString(s2.attributes, 'service.name') = 'database'
    AND s2.durationUnixNano > 500000000
  ```

**Files to modify**:
- `Common/Types/Traces/StructuralTraceQuery.ts` (new - query model)
- `Common/Server/Services/SpanService.ts` (add structural query execution)
- `App/FeatureSet/Dashboard/src/Components/Traces/StructuralQueryBuilder.tsx` (new - visual builder)

### 3.4 Trace Comparison / Diffing

**Current**: No way to compare traces.
**Target**: Side-by-side comparison of two traces of the same operation, highlighting differences in span count, latency, and structure.

**Implementation**:

- Add "Compare" action to trace list (select two traces)
- Build a diff view showing: added/removed spans, latency differences per span, structural changes
- Useful for comparing a slow trace to a fast trace of the same operation

**Files to modify**:
- `App/FeatureSet/Dashboard/src/Components/Traces/TraceComparison.tsx` (new)
- `App/FeatureSet/Dashboard/src/Pages/Traces/Compare.tsx` (new page)

---

## Phase 4: Competitive Differentiation (P3) — Long-Term

### 4.1 Rules-Based and Tail-Based Sampling

**Current**: Phase 1 adds head-based probabilistic sampling.
**Target**: Rules-based sampling (always keep errors/slow traces, sample successes) and eventually tail-based sampling (buffer complete traces, decide after seeing all spans).

**Implementation**:

- Rules engine: configurable conditions (service, status, duration, attributes) with per-rule sample rates
- Tail-based: buffer spans for a configurable window (30s), assemble complete traces, then apply retention decisions
- Tail-based is complex; consider integrating with OpenTelemetry Collector's tail sampling processor as an alternative

### 4.2 AI/ML on Trace Data

- **Anomaly detection** on RED metrics (statistical deviation from baseline)
- **Auto-surfacing correlated attributes** when latency spikes (similar to Honeycomb BubbleUp)
- **Natural language trace queries** ("show me slow database calls from the last hour")
- **Automatic root cause analysis** from trace data during incidents

### 4.3 RUM (Real User Monitoring) Correlation

- Browser SDK that propagates W3C trace context from frontend to backend
- Link frontend page loads, interactions, and web vitals to backend traces
- Show end-to-end user experience from browser to backend services

### 4.4 Continuous Profiling Integration

- Integrate with a profiling backend (e.g., Pyroscope)
- Link profile data to span time windows
- Show "Code Hotspots" within spans (similar to DataDog)

---

## ClickHouse Storage Improvements

### S.3 Add Trace-by-ID Projection (LOW)

**Current**: Trace detail view relies on BloomFilter skip index for traceId lookups. (Note: `proj_trace_by_id` projection has been added but may need evaluation for further optimization.)
**Target**: Projection sorted by `(projectId, traceId, startTime)` for faster trace-by-ID queries.

---

## Quick Wins (Can Ship This Week)

1. ~~**In-trace span search**~~ - Done (Phase 2.3)
2. ~~**Self-time calculation**~~ - Done (Phase 2.2)
3. ~~**Span link navigation**~~ - Done (Phase 2.5)
4. **Top-N slowest operations** - Simple ClickHouse query: `ORDER BY durationUnixNano DESC LIMIT N`
5. **Error rate by service** - Aggregate `statusCode=2` counts grouped by serviceId
6. **Trace duration distribution histogram** - Use ClickHouse `histogram()` on durationUnixNano
7. **Span count per service display** - Already tracked in `servicesInTrace`, just needs better display

---

## Recommended Implementation Order

1. **Phase 1.1** - Trace Analytics Engine (highest impact, unlocks everything else)
2. **Phase 1.2** - RED Metrics from Traces (prerequisite for alerting, service overview)
3. **Quick Wins** - Ship top-N operations, error rate by service, trace duration histogram, span count display
4. **Phase 1.3** - Trace-Based Alerting (core observability workflow)
5. **Phase 1.4** - Head-Based Sampling (essential for high-volume users)
6. **Phase 3.1** - Trace-to-Metric Exemplars
7. **Phase 3.2-3.4** - Custom metrics, structural queries, comparison
8. **Phase 4.x** - AI/ML, RUM, profiling (long-term)

## Verification

For each feature:
1. Unit tests for new query builders, critical path algorithm, sampling logic
2. Integration tests for new API endpoints (analytics, RED metrics, sampling)
3. Manual verification via the dev server at `https://oneuptimedev.genosyn.com/dashboard/{projectId}/traces`
4. Check ClickHouse query performance with `EXPLAIN` for new aggregation queries
5. Verify trace correlation (logs, exceptions, metrics) still works correctly with new features
6. Load test sampling logic to ensure it doesn't add ingestion latency
