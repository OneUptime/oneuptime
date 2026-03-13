# OpenTelemetry Traces Audit: OneUptime vs Competition

**Date:** 2026-03-13
**Purpose:** Audit current traces implementation, identify gaps vs DataDog/NewRelic/Honeycomb/Grafana Tempo, and recommend improvements.

---

## 1. Current OneUptime Traces Implementation

### 1.1 Ingestion

- **Endpoint:** `POST /otlp/v1/traces`
- **Protocols:** OTLP Protobuf and JSON (content-type negotiation)
- **Processing:** Async queue-based ingestion (`TracesQueueService`) with configurable batch flush sizes
- **Auth:** Telemetry ingestion keys per service
- **Missing:** No Jaeger or Zipkin protocol support (only OTLP)

### 1.2 Storage

- **Engine:** ClickHouse (MergeTree)
- **Table:** `SpanItem`
- **Key fields:** projectId, serviceId, traceId (BloomFilter), spanId (BloomFilter), parentSpanId, name, kind, startTime/endTime (nanosecond precision), statusCode, statusMessage, attributes (JSON), events (JSONArray), links (JSON), traceState
- **Partitioning:** `sipHash64(projectId) % 16`
- **TTL:** Per-service retention via `retentionDate DELETE`
- **Indexing:** BloomFilter on traceId/spanId, TokenBF on name, Set index on statusCode

### 1.3 Frontend Visualization

- **Gantt Chart Timeline:** Hierarchical span visualization with color-coded services, time-unit auto-scaling, error indicators
- **Trace Table:** Tabbed view (All Spans / Root Spans) with filtering
- **Span Detail Panel:** Side-over with tabs for Basic Info, Logs, Attributes, Events, Exceptions
- **Filtering:** Service, span name, trace ID, status, kind, datetime range, advanced attribute filters
- **Service Dependency Graph:** Basic graph visualization of service relationships

### 1.4 Correlation

- **Trace-to-Log:** Log model has traceId/spanId columns; SpanViewer shows associated logs
- **Trace-to-Exception:** ExceptionInstance model links to traceId/spanId with stack trace parsing and fingerprinting
- **Trace-to-Metric:** No direct correlation (no traceId in metric model, no exemplars)

### 1.5 What We Do Well

- Clean OTLP-native ingestion pipeline
- ClickHouse storage with good indexing (BloomFilter on trace/span IDs)
- Full OpenTelemetry span model support (events, links, status, attributes, resources, scope)
- Automatic exception extraction and fingerprinting from span events
- Queue-based async processing for ingestion scalability
- Per-service data retention with TTL

---

## 2. ClickHouse Storage Audit

**Date:** 2026-03-13
**Purpose:** Verify the `SpanItem` ClickHouse schema is optimally configured for efficient searches and queries.

### 2.1 Current Schema Summary

| Setting | Value |
|---------|-------|
| **Table** | `SpanItem` |
| **Engine** | MergeTree |
| **Partition Key** | `sipHash64(projectId) % 16` |
| **Primary/Sort Key** | `(projectId, startTime, serviceId, traceId)` |
| **TTL** | `retentionDate DELETE` |
| **Inserts** | `async_insert=1, wait_for_async_insert=0` (via both `StatementGenerator` and `AnalyticsDatabaseService.insertJsonRows`) |

**Skip Indexes:**

| Index Name | Column | Type | Params | Granularity |
|-----------|--------|------|--------|-------------|
| `idx_trace_id` | traceId | BloomFilter | [0.01] | 1 |
| `idx_span_id` | spanId | BloomFilter | [0.01] | 1 |
| `idx_status_code` | statusCode | Set | [5] | 4 |
| `idx_name` | name | TokenBF | [10240, 3, 0] | 4 |

### 2.2 What's Done Well

1. **Primary/Sort key** — `(projectId, startTime, serviceId, traceId)` is well-ordered for the dominant query: "spans for project X in time range Y filtered by service". ClickHouse prunes by project first, then time range.
2. **Hash-based partitioning** — `sipHash64(projectId) % 16` distributes data evenly across 16 partitions, prevents hot-partition issues.
3. **Skip indexes** — BloomFilter on `traceId`/`spanId` (granularity 1) is tight, Set index on `statusCode` matches its low cardinality, TokenBF on `name` supports partial-match searches.
4. **TTL** — `retentionDate DELETE` provides clean per-service automatic expiration.
5. **Async inserts** — Both insert paths use `async_insert=1, wait_for_async_insert=0` preventing "too many parts" errors under high ingest. Batch flushing (`TELEMETRY_TRACE_FLUSH_BATCH_SIZE`) adds further protection.
6. **Dual attribute storage** — `attributes` (full JSON as String) + `attributeKeys` (Array(String)) is pragmatic: full JSON for detail reads, extracted keys for fast enumeration/autocomplete.

### 2.3 Issues Found

#### Issue 1: `attributes` stored as opaque `String` — no indexed filtering (HIGH)

**Problem:** `attributes` is `TableColumnType.JSON` → ClickHouse `String`. Querying by attribute value (e.g., "find spans where `http.status_code = 500`") requires `LIKE` or `JSONExtract()` scans on the full string. This is the most common trace query pattern after time-range filtering.

**Recommendation:** Migrate to ClickHouse **`Map(String, String)`** type. This enables:
- `attributes['http.method'] = 'GET'` without JSON parsing
- Bloom filter skip indexes on map keys/values (`INDEX idx_attr_keys mapKeys(attributes) TYPE bloom_filter`)
- Alternatively, extract high-cardinality hot attributes (`http.method`, `http.status_code`, `http.url`, `db.system`) into dedicated `LowCardinality(String)` columns with skip indexes.

**Impact:** Significant query speedup for attribute-based span filtering.

#### Issue 2: No compression codecs specified (HIGH)

**Problem:** No explicit `CODEC` is set on any column. ClickHouse defaults to `LZ4`. For high-volume trace data, better codecs can reduce storage 30–50%.

**Recommendation:**

| Column(s) | Recommended CODEC | Reason |
|-----------|-------------------|--------|
| `startTimeUnixNano`, `endTimeUnixNano`, `durationUnixNano` | `CODEC(Delta, ZSTD)` | Nanosecond timestamps compress extremely well with delta encoding |
| `statusCode` | `CODEC(T64, LZ4)` | Small integer set benefits from T64 |
| `attributes`, `events`, `links` | `CODEC(ZSTD(3))` | JSON text compresses well with ZSTD |
| `traceId`, `spanId`, `parentSpanId` | `CODEC(ZSTD(1))` | Hex strings with some repetition |

**Impact:** 30–50% storage reduction on trace data, which also improves query speed (less I/O).

#### Issue 3: `kind` column has no skip index (MEDIUM)

**Problem:** `kind` is a low-cardinality enum (5 values: SERVER, CLIENT, PRODUCER, CONSUMER, INTERNAL). Filtering by span kind (e.g., "show all server spans") is common but has no index.

**Recommendation:** Add a `Set` skip index on `kind`:
```
skipIndex: {
  name: "idx_kind",
  type: SkipIndexType.Set,
  params: [5],
  granularity: 4,
}
```
Also consider using `LowCardinality(String)` column type for `kind`.

#### Issue 4: `parentSpanId` has no skip index (MEDIUM)

**Problem:** Finding root spans (`WHERE parentSpanId = ''`) and finding children of a parent span are common trace-reconstruction queries. No index exists.

**Recommendation:** Add a BloomFilter skip index on `parentSpanId`:
```
skipIndex: {
  name: "idx_parent_span_id",
  type: SkipIndexType.BloomFilter,
  params: [0.01],
  granularity: 1,
}
```

#### Issue 5: No aggregation projection (MEDIUM)

**Problem:** `projections: []` is empty. Dashboard queries like "trace count by service over time" or "p99 latency by service" do full table scans against the primary sort key.

**Recommendation:** Add a projection for common aggregation patterns:
```sql
PROJECTION agg_by_service (
  SELECT
    serviceId,
    toStartOfMinute(startTime) AS minute,
    count(),
    avg(durationUnixNano),
    quantile(0.99)(durationUnixNano)
  GROUP BY serviceId, minute
)
```
This allows ClickHouse to serve aggregation queries from the pre-sorted projection instead of scanning raw spans.

#### Issue 6: Sort key trade-off for trace-by-ID lookups (LOW)

**Problem:** Sort key `(projectId, startTime, serviceId, traceId)` places `traceId` 4th. The trace detail view query ("get all spans for traceId X") can't narrow using the primary index — it must rely on the BloomFilter skip index.

**Current mitigation:** BloomFilter with granularity 1 and false positive rate 0.01 works reasonably well.

**Recommendation for high-volume instances:** Add a **projection** sorted by `(projectId, traceId, startTime)` specifically for trace-by-ID lookups:
```sql
PROJECTION trace_lookup (
  SELECT *
  ORDER BY (projectId, traceId, startTime)
)
```

#### Issue 7: `events` and `links` not queryable (LOW)

**Problem:** `events` (JSONArray→String) and `links` (JSON→String) are opaque blobs. Filtering spans by "has exception event" requires string scanning.

**Recommendation:** Add a `hasException` column (`UInt8` / Boolean) populated at ingest time. This is a very common filter ("show error spans with exceptions") that currently requires parsing the events JSON string.

#### Issue 8: `links` default value is `{}` but should be `[]` (LOW)

**Problem:** In `Span.ts` line 393, `links` column has `defaultValue: {}` but semantically represents an array of `SpanLink[]`. The ingest service correctly passes arrays, but the schema default is wrong.

**Fix:** Change `defaultValue: {}` → `defaultValue: []` on the `links` column definition.

### 2.4 Prioritized Action Items

| Priority | Issue | Effort | Impact |
|----------|-------|--------|--------|
| **HIGH** | Migrate `attributes` to `Map(String, String)` or extract hot attributes | Medium | Major query speedup for attribute filtering |
| **HIGH** | Add compression codecs to all columns | Low | 30–50% storage reduction |
| **MEDIUM** | Add `Set` skip index on `kind` | Low | Faster kind-based filtering |
| **MEDIUM** | Add BloomFilter skip index on `parentSpanId` | Low | Faster trace tree reconstruction |
| **MEDIUM** | Add aggregation projection | Low | Faster dashboard aggregation queries |
| **LOW** | Add `hasException` boolean column | Low | Faster error span filtering |
| **LOW** | Add trace-by-ID projection | Low | Faster trace detail view |
| **LOW** | Fix `links` default value `{}` → `[]` | Trivial | Schema correctness |

### 2.5 Key File Locations

| File | Purpose |
|------|---------|
| `Common/Models/AnalyticsModels/Span.ts` | Span table schema definition (columns, indexes, sort key, partitioning, TTL) |
| `Telemetry/Services/OtelTracesIngestService.ts` | Span ingestion processing, row building, batch flushing |
| `Common/Server/Services/SpanService.ts` | Span CRUD operations |
| `Common/Server/Services/AnalyticsDatabaseService.ts` | Generic ClickHouse insert/query (async insert settings) |
| `Common/Server/Utils/AnalyticsDatabase/StatementGenerator.ts` | SQL generation for CREATE TABLE, INSERT, SELECT |
| `Common/Types/AnalyticsDatabase/TableColumn.ts` | Column type and skip index type definitions |
| `Worker/DataMigrations/AddRetentionDateAndSkipIndexesToTelemetryTables.ts` | Migration that added TTL and skip indexes |

---

## 3. Gap Analysis vs Competition

### 3.1 CRITICAL GAPS (Must-have to compete)

#### Gap 1: No Trace Analytics / Aggregation Engine
**What competitors do:** DataDog has Trace Explorer with count/percentile aggregations. NewRelic has NRQL queries on span data. Grafana Tempo has TraceQL with `rate()`, `count_over_time()`, `quantile_over_time()`. Honeycomb allows arbitrary aggregation (COUNT, AVG, P50, P95, P99) on any span field.

**OneUptime today:** We can list/filter individual spans and view individual traces. There is no way to answer questions like "What is the p99 latency for service X over the last hour?" or "Which endpoints have the highest error rate?" directly from trace data.

**Recommendation:**
- Build a trace analytics query engine supporting aggregations: COUNT, AVG, SUM, MIN, MAX, P50/P75/P90/P95/P99
- Support GROUP BY on any span attribute (service, name, kind, status, custom attributes)
- Support time-series bucketing for trend charts
- ClickHouse is well-suited for this -- use `quantile()`, `countIf()`, `groupBy` queries

#### Gap 2: No Trace-Level Metrics (RED Metrics from Traces)
**What competitors do:** DataDog computes request rate, error rate, and latency percentiles on 100% of traffic. Grafana Tempo's metrics-generator writes RED metrics to Prometheus. New Relic derives golden signals from trace data.

**OneUptime today:** No automatic computation of service-level metrics from trace data. Users must look at raw spans.

**Recommendation:**
- Compute per-service, per-operation RED metrics (Request rate, Error rate, Duration distribution) from ingested spans
- Store these as pre-aggregated metrics in ClickHouse (materialized views or separate table)
- Display on a Service Overview page with request rate, error rate, p50/p95/p99 latency charts
- Enable alerting on these derived metrics

#### Gap 3: No Tail-Based or Configurable Sampling
**What competitors do:** DataDog has head-based adaptive sampling + retention filters. NewRelic has Infinite Tracing (tail-based). Honeycomb has Refinery with deterministic, dynamic, and rules-based sampling.

**OneUptime today:** Ingests 100% of received traces with no sampling controls. This means high-volume users will face storage cost issues and no way to prioritize important traces (errors, slow requests).

**Recommendation:**
- Phase 1: Add head-based probabilistic sampling at ingestion (configurable per service)
- Phase 2: Add rules-based sampling (always keep errors, sample successes at lower rate)
- Phase 3: Add tail-based sampling (buffer traces, decide after seeing all spans -- keep errors, outliers, slow traces)

#### Gap 4: No Flame Graph View
**What competitors do:** DataDog offers four trace views: Flame Graph (default), Waterfall, Span List, and Map. Flame graphs are the industry-standard way to visualize execution time distribution.

**OneUptime today:** Only Gantt chart (waterfall) view.

**Recommendation:**
- Add flame graph visualization showing proportional time spent in each span
- This is a high-value, moderate-effort feature that users expect from any APM tool

#### Gap 5: No Trace-to-Metric Correlation (Exemplars)
**What competitors do:** Grafana Tempo uses Prometheus exemplars to link metric data points to trace IDs. DataDog lets you pivot from metric graphs to example traces. NewRelic links metric charts to traces.

**OneUptime today:** Metric model has no traceId/spanId fields. No way to click from a metric spike to the trace that caused it.

**Recommendation:**
- Add traceId/spanId to the Metric model
- When displaying metric charts, show exemplar dots that link to traces
- Enable "view example traces" from any metric graph

### 3.2 HIGH-VALUE GAPS (Differentiation opportunities)

#### Gap 6: No Structural Trace Queries
**What competitors do:** DataDog Trace Queries let you find traces based on properties of multiple spans and their structural relationships (e.g., "find traces where service A called service B and B returned an error"). Grafana TraceQL supports spanset pipelines and structural queries.

**OneUptime today:** Can only filter on individual span attributes. Cannot query relationships between spans.

**Recommendation:**
- Build a trace query language or visual query builder that supports:
  - "Find traces where span X has child span Y"
  - "Find traces where service A called service B with latency > 500ms"
  - Ancestor/descendant span relationship queries

#### Gap 7: No Custom Metrics from Spans
**What competitors do:** DataDog lets users generate custom count/distribution/gauge metrics from any span tag, stored for 15 months. Honeycomb computes SLOs from span data.

**OneUptime today:** No way to create persistent metrics from trace data.

**Recommendation:**
- Allow users to define custom metrics from span attributes (e.g., "count of spans where http.status_code = 500 grouped by service.name")
- Use ClickHouse materialized views for efficient computation
- Feed these into alerting and dashboards

#### Gap 8: No Latency Breakdown / Critical Path Analysis
**What competitors do:** DataDog shows per-hop latency in dependency map. Honeycomb's BubbleUp automatically surfaces attributes correlated with slowness.

**OneUptime today:** Shows individual span durations but no automated analysis of where time is spent or what's causing slowness.

**Recommendation:**
- Compute critical path through a trace (longest sequential chain of spans)
- Show "self time" vs "child time" per span
- Highlight bottleneck spans automatically
- Show latency breakdown by service (% of total trace time per service)

#### Gap 9: No Trace Comparison / Diffing
**What competitors do:** NewRelic has side-by-side trace comparison. Grafana TraceQL has a `compare()` function for comparing metrics across time ranges.

**OneUptime today:** No way to compare two traces or compare trace behavior across time periods.

**Recommendation:**
- Add side-by-side trace comparison view (compare a slow trace to a fast trace of the same operation)
- Add time-range comparison for trace metrics (compare this week vs last week)

#### Gap 10: No In-Trace Search
**What competitors do:** DataDog allows searching/filtering spans within a trace view.

**OneUptime today:** TraceExplorer shows all spans with service filtering and error toggle, but no text search within a trace.

**Recommendation:**
- Add a search box in TraceExplorer to filter spans by name, attribute values, or status within the current trace

#### Gap 11: No Alerting on Trace Data
**What competitors do:** DataDog has APM Monitors for p50/p75/p90/p95/p99 latency, error rate, request rate, Apdex. NewRelic has NRQL alert conditions on span data. Honeycomb has Triggers.

**OneUptime today:** No ability to create alerts based on trace data (e.g., "alert when p99 latency exceeds 2s for service X").

**Recommendation:**
- Build trace-based alert conditions: latency threshold, error rate threshold, request rate anomaly
- Prerequisite: Gap 2 (RED metrics from traces) must be implemented first
- Integrate with existing OneUptime alerting/incident system

### 3.3 NICE-TO-HAVE GAPS (Long-term roadmap)

#### Gap 12: No Continuous Profiling Integration
**What competitors do:** DataDog has native continuous profiling with direct span-to-profile linking ("Code Hotspots"). Grafana has Pyroscope.

**Recommendation:** Long-term consideration. Would require building or integrating a profiling backend and linking profile data to span time windows.

#### Gap 13: No RUM (Real User Monitoring) Trace Correlation
**What competitors do:** DataDog and NewRelic link frontend browser sessions to backend traces. Grafana uses Faro. Honeycomb has frontend observability.

**Recommendation:** Long-term. Would require a browser SDK that propagates trace context from frontend to backend.

#### Gap 14: No AI/ML on Trace Data
**What competitors do:** DataDog has Watchdog AI for automatic anomaly detection and root cause analysis. NewRelic has NRAI. Honeycomb has BubbleUp for automatic pattern detection.

**Recommendation:** Medium-term. Start with:
- Anomaly detection on RED metrics (simple statistical methods)
- Automatic "similar traces" grouping
- Natural language trace query interface

#### Gap 15: No Map View for Individual Traces
**What competitors do:** DataDog has a Map view per trace showing service-to-service flow for that specific trace.

**OneUptime today:** Service dependency graph exists at the global level but not per-trace.

**Recommendation:** Add a per-trace service flow diagram showing the path of a request through services.

---

## 4. Prioritized Roadmap Recommendation

### Phase 1: Foundation (Highest Impact)
1. **Trace Analytics Engine** (Gap 1) -- Without this, users can't answer basic performance questions
2. **RED Metrics from Traces** (Gap 2) -- Service overview dashboards, prerequisite for alerting
3. **Trace-Based Alerting** (Gap 11) -- Core observability workflow: detect issues from traces
4. **Head-Based Sampling** (Gap 3, Phase 1) -- Essential for high-volume users

### Phase 2: Visualization & UX
5. **Flame Graph View** (Gap 4) -- Industry-standard visualization users expect
6. **Latency Breakdown / Critical Path** (Gap 8) -- Key debugging capability
7. **In-Trace Search** (Gap 10) -- Quick win, improves debugging workflow
8. **Per-Trace Map View** (Gap 15) -- Visual request flow

### Phase 3: Advanced Analytics
9. **Trace-to-Metric Exemplars** (Gap 5) -- Connects metrics and traces
10. **Custom Metrics from Spans** (Gap 7) -- Power-user feature
11. **Structural Trace Queries** (Gap 6) -- Advanced debugging
12. **Trace Comparison** (Gap 9) -- Performance regression analysis

### Phase 4: Competitive Differentiation
13. **Rules-Based / Tail-Based Sampling** (Gap 3, Phases 2-3)
14. **AI/ML on Traces** (Gap 14) -- Anomaly detection, BubbleUp-like features
15. **RUM Correlation** (Gap 13)
16. **Continuous Profiling** (Gap 12)

---

## 5. Quick Wins (Low effort, high value)

These can be implemented relatively quickly:

1. **In-trace span search** -- Add a text filter in TraceExplorer (few hours of work)
2. **Self-time calculation** -- Show "self time" (span duration minus child durations) in SpanViewer
3. **Span count per service in trace** -- Already tracked in `servicesInTrace`, just needs better display
4. **Trace duration distribution histogram** -- Use ClickHouse `histogram()` on durationUnixNano
5. **Top-N slowest operations** -- Simple ClickHouse query with ORDER BY durationUnixNano DESC
6. **Error rate by service** -- Aggregate statusCode=2 counts grouped by serviceId
7. **Span link navigation** -- Links data is stored but not navigable in UI (add clickable links to related traces)

---

## 6. Architecture Notes

### Why ClickHouse Is Well-Suited for These Improvements

ClickHouse already supports the query patterns needed for most gaps:
- `quantile(0.99)(durationUnixNano)` for percentile calculations
- `countIf(statusCode = 2) / count()` for error rates
- `toStartOfInterval(startTime, INTERVAL 1 MINUTE)` for time-series bucketing
- `groupBy` on any column including JSON-extracted attributes
- Materialized views for pre-aggregated RED metrics

The main work is building the API layer and UI, not the storage engine.

### Key Files to Modify

| Area | File | Purpose |
|------|------|---------|
| Span Model | `Common/Models/AnalyticsModels/Span.ts` | Add computed columns if needed |
| Trace Ingestion | `Telemetry/Services/OtelTracesIngestService.ts` | Add sampling, RED metric computation |
| Trace API | `Telemetry/API/OTelIngest.ts` | New analytics endpoints |
| Span Service | `Common/Server/Services/SpanService.ts` | Add aggregation query methods |
| Trace Explorer | `Dashboard/src/Components/Traces/TraceExplorer.tsx` | Flame graph, in-trace search, critical path |
| Span Viewer | `Dashboard/src/Components/Span/SpanViewer.tsx` | Self-time, span link navigation |
| Trace Table | `Dashboard/src/Components/Traces/TraceTable.tsx` | Analytics views |
| Service Page | `Dashboard/src/Pages/Service/View/Traces.tsx` | RED metrics dashboard |

---

## 7. Competitive Summary Matrix

| Feature | OneUptime | DataDog | NewRelic | Tempo | Honeycomb |
|---------|-----------|---------|----------|-------|-----------|
| OTLP Ingestion | Yes | Yes | Yes | Yes | Yes |
| Jaeger/Zipkin Ingestion | No | No | Zipkin | Yes | No |
| Waterfall/Gantt View | Yes | Yes | Yes | Yes | Yes |
| Flame Graph | **No** | Yes | No | No | No |
| Trace Analytics/Aggregations | **No** | Yes | Yes (NRQL) | Yes (TraceQL) | Yes |
| RED Metrics from Traces | **No** | Yes | Yes | Yes | Yes |
| Trace-Based Alerting | **No** | Yes | Yes | Via Grafana | Yes |
| Sampling Controls | **No** | Yes | Yes | Via OTel | Yes (Refinery) |
| Trace-to-Log Correlation | Yes | Yes | Yes | Yes | Yes |
| Trace-to-Metric Exemplars | **No** | Yes | Yes | Yes | No |
| Structural Trace Queries | **No** | Yes | Via NRQL | Yes | No |
| Custom Metrics from Spans | **No** | Yes | Via NRQL | Yes | Yes (SLOs) |
| Service Dependency Map | Basic | Advanced | Yes | Yes | Yes |
| Per-Trace Map/Flow | **No** | Yes | No | No | No |
| In-Trace Search | **No** | Yes | No | No | No |
| Critical Path Analysis | **No** | Yes | No | No | No |
| Trace Comparison | **No** | Partial | Yes | Partial | No |
| Continuous Profiling | **No** | Yes | Partial | Pyroscope | No |
| RUM Correlation | **No** | Yes | Yes | Faro | Yes |
| AI/ML on Traces | **No** | Watchdog | NRAI | No | BubbleUp |
| Span Events/Links | Yes | Yes | Yes | Yes | Yes |
| Exception Extraction | Yes | Yes | Yes | No | No |
| Open Source | Yes | No | No | Yes | No |

**Bold "No"** = Gap where we are behind multiple competitors.

---

## 8. Conclusion

OneUptime has a solid foundation for trace ingestion and storage with good OTLP support and ClickHouse as the backend. The core data model is complete (spans, events, links, attributes, resources are all captured).

The biggest gaps are in **trace analytics** (no aggregations, no RED metrics, no alerting) and **advanced visualization** (no flame graph, no critical path). These are table-stakes features that all major competitors offer.

The recommended approach is to focus Phase 1 on the analytics engine and RED metrics, which unlocks alerting and dashboards. This gives users the ability to answer "is my service healthy?" from trace data -- the most fundamental APM use case that we currently cannot serve.

Our advantage as an open-source, OpenTelemetry-native platform means we don't need to build proprietary SDKs or agents. We should lean into this by making our trace analytics as powerful as possible on standard OTLP data.
