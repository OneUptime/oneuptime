# Plan: Bring OneUptime Log Management to Industry Parity

## Context

OneUptime's log management provides multi-protocol ingestion (OTLP, gRPC, Fluentd, Syslog), ClickHouse storage, a structured query language with field-specific searches and boolean operators, a log volume histogram with severity stacking, a faceted sidebar with attribute drill-down and service filtering, live tail, and an expandable log detail view. This plan identifies the remaining gaps vs Datadog and New Relic and proposes a phased implementation to close them.

## Completed

The following features have been implemented and removed from this plan:
- **Phase 1.1** - Log Query Language / Search Bar (LogQueryParser, LogSearchBar with syntax highlighting and autocomplete)
- **Phase 1.2** - Log Volume Histogram (recharts-based stacked bar chart with drag-to-zoom)
- **Phase 1.3** - Faceted Sidebar with Attribute Drill-Down (LogsFacetSidebar with search, include/exclude filters)
- **Phase 2.4** - Service Filter in Sidebar (implemented as part of the faceted sidebar)
- **Phase 5.1** - Skip indexes for full-text search on `body`
- **Phase 5.2** - Skip indexes for `traceId`, `spanId`, `severityText`
- **Phase 5.4** - Per-service TTL via `retentionDate` column
- **Phase 5.5** - Parameterized SQL in `LogAggregationService`
- **Phase 5.6** - ZSTD compression on `body` column
- **Phase 2.1** - Saved Views (LogSavedView model, SavedViewsDropdown, CRUD API)
- **Phase 2.2** - Log Analytics View (LogsAnalyticsView with timeseries, toplist, table charts; analytics endpoint)
- **Phase 2.3** - Column Customization (ColumnSelector with dynamic columns from log attributes)
- **Phase 5.8** - Store Missing OpenTelemetry Log Fields (observedTimeUnixNano, droppedAttributesCount, flags columns + ingestion + migration)
- **Phase 3.1** - Log Context / Surrounding Logs (Context tab in LogDetailsPanel, context endpoint in TelemetryAPI)
- **Phase 3.2** - Log Pipelines (LogPipeline + LogPipelineProcessor models, GrokParser/AttributeRemapper/SeverityRemapper/CategoryProcessor, pipeline execution service)
- **Phase 3.3** - Drop Filters (LogDropFilter model, LogDropFilterService, dashboard UI for configuration)
- **Phase 3.4** - Export to CSV/JSON (Export button in toolbar, LogExport utility with CSV and JSON support)
- **Phase 4.2** - Keyboard Shortcuts (j/k navigation, Enter expand/collapse, Esc close, / focus search, Ctrl+Enter apply filters, ? help)
- **Phase 4.3** - Sensitive Data Scrubbing (LogScrubRule model with PII patterns: Email, CreditCard, SSN, PhoneNumber, IPAddress, custom regex)
- **Phase 5.3** - DateTime64 time column upgrade (DateTime64(9) nanosecond precision, toClickhouseDateTime64 utility, data migration, all ingestion services updated)

## Gap Analysis Summary

| Feature | OneUptime | Datadog | New Relic | Priority |
|---------|-----------|---------|-----------|----------|
| Log Patterns (ML clustering) | None | Auto-clustering + Pattern Inspector | ML clustering + anomaly | **P1** |
| Log-based Metrics | None | Count + Distribution, 15-month retention | Via NRQL | **P2** |
| Data retention config UI | Referenced but no UI | Multi-tier (Standard/Flex/Archive) | Partitions + Live Archives | **P3** |

---

---

## Remaining Features

### Log Patterns (ML Clustering) — P1

**Current**: No pattern detection.
**Target**: Auto-cluster similar log messages and surface pattern groups with anomaly detection.

### Log-based Metrics — P2

**Current**: No log-to-metric conversion.
**Target**: Create count/distribution metrics from log queries with long-term retention.

### Data Retention Config UI — P3

**Current**: `retainTelemetryDataForDays` exists on the service model and is displayed in usage history, but there is no dedicated UI to configure retention settings.
**Target**: Settings page for configuring per-service log data retention.

## Phase 5: ClickHouse Storage & Query Optimizations (P0) — Performance Foundation

These optimizations address fundamental storage and indexing gaps in the telemetry tables that directly impact search speed, data correctness, and operational cost.

### 5.7 Add Projections for Histogram Queries (Medium)

**Current**: `projections: []` is empty. Every histogram query (group by time bucket + severity) and facet query scans raw data and performs the aggregation from scratch.

**Target**: ClickHouse projections that pre-aggregate data for the most common query patterns.

**Implementation**:

- Add a projection for histogram/severity aggregation:
  ```sql
  PROJECTION proj_severity_histogram (
    SELECT
      severityText,
      toStartOfInterval(time, INTERVAL 1 MINUTE) AS minute,
      count() AS cnt
    ORDER BY (projectId, minute, severityText)
  )
  ```
- Extend the existing `Projection` type at `Common/Types/AnalyticsDatabase/Projection.ts` to support full projection definitions
- Wire projection creation into `StatementGenerator.toTableCreateStatement()`
- Migration to materialize the projection on existing data: `ALTER TABLE LogItem MATERIALIZE PROJECTION proj_severity_histogram`

**Expected improvement**: 5-10x faster histogram queries since ClickHouse reads the pre-aggregated projection instead of scanning raw log rows.

**Files to modify**:
- `Common/Models/AnalyticsModels/Log.ts` (define projections)
- `Common/Types/AnalyticsDatabase/Projection.ts` (extend type)
- `Common/Server/Utils/AnalyticsDatabase/StatementGenerator.ts` (emit PROJECTION clause)
- `Worker/DataMigrations/` (new migration to materialize)

### 5.x Remaining Performance Impact Summary

| Optimization | Query Pattern Improved | Expected Speedup | Effort |
|-------------|----------------------|-------------------|--------|
| 5.7 Histogram projections | Histogram and severity aggregation | 5-10x | Medium |

---

## Recommended Remaining Implementation Order

1. **5.7** — Projections (performance polish)
2. **Log-based Metrics** (platform capability)
3. **Data Retention Config UI** (operational)
4. **Log Patterns / ML Clustering** (advanced, larger effort)

---

## Verification

For each remaining feature:
1. Unit tests for new utilities
2. Integration tests for new API endpoints
3. Manual verification via the dev server at `https://oneuptimedev.genosyn.com/dashboard/{projectId}/logs`
4. Check ClickHouse query performance with `EXPLAIN` for new aggregation queries
