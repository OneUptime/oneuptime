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

## Gap Analysis Summary

| Feature | OneUptime | Datadog | New Relic | Priority |
|---------|-----------|---------|-----------|----------|
| Log Patterns (ML clustering) | None | Auto-clustering + Pattern Inspector | ML clustering + anomaly | **P1** |
| Log context (surrounding logs) | None | Before/after from same host/service | Automatic via APM agent | **P2** |
| Log Pipelines (server-side processing) | None (raw storage only) | 270+ OOTB, 14+ processor types | Grok parsing, built-in rules | **P2** |
| Log-based Metrics | None | Count + Distribution, 15-month retention | Via NRQL | **P2** |
| Drop Filters (pre-storage filtering) | None | Exclusion filters with sampling | Drop rules per NRQL | **P2** |
| Export to CSV/JSON | None | CSV up to 100K rows | CSV/JSON up to 5K | **P2** |
| Keyboard shortcuts | None | Full keyboard nav | Basic | **P3** |
| Sensitive Data Scrubbing | None | Multi-layer (SaaS + agent + pipeline) | Auto-obfuscation + custom rules | **P3** |
| Data retention config UI | Referenced but no UI | Multi-tier (Standard/Flex/Archive) | Partitions + Live Archives | **P3** |

---

## Phase 3: Processing & Operations (P2) — Platform Capabilities

### 3.1 Log Context (Surrounding Logs)

**Current**: Clicking a log shows only that log's details.
**Target**: A "Context" tab in the log detail panel showing N logs before/after from the same service.

**Implementation**:

- When a log is expanded, add a "Context" tab that queries ClickHouse:
  ```sql
  (SELECT * FROM LogItem WHERE projectId={pid} AND serviceId={sid} AND time < {logTime} ORDER BY time DESC LIMIT 5)
  UNION ALL
  (SELECT * FROM LogItem WHERE projectId={pid} AND serviceId={sid} AND time >= {logTime} ORDER BY time ASC LIMIT 6)
  ```
- Display as a mini log list with the current log highlighted
- Add to `LogDetailsPanel.tsx` as a tabbed section alongside the existing body/attributes view

**Files to modify**:
- `Common/Server/API/TelemetryAPI.ts` (add context endpoint)
- `Common/UI/Components/LogsViewer/components/LogDetailsPanel.tsx` (add tabs + context view)

### 3.2 Log Pipelines (Server-Side Processing)

**Current**: Logs are stored raw as received (after OTLP normalization).
**Target**: Configurable processing pipelines that transform logs at ingest time.

**Implementation**:

- Create `LogPipeline` and `LogPipelineProcessor` PostgreSQL models
- Pipeline has: name, filter (which logs it applies to), enabled flag, sort order
- Processor types (start with these 4):
  - **Grok Parser**: Parse body text into structured attributes using Grok patterns
  - **Attribute Remapper**: Rename/copy one attribute to another
  - **Severity Remapper**: Map an attribute value to the severity field
  - **Category Processor**: Assign a new attribute value based on if/else conditions
- Processing runs in the telemetry ingestion worker (`Telemetry/Jobs/TelemetryIngest/ProcessTelemetry.ts`) after normalization but before ClickHouse insert
- Pipeline configuration UI under Settings > Log Pipelines

**Files to modify**:
- `Common/Models/DatabaseModels/LogPipeline.ts` (new)
- `Common/Models/DatabaseModels/LogPipelineProcessor.ts` (new)
- `Telemetry/Services/LogPipelineService.ts` (new - pipeline execution engine)
- `Telemetry/Services/OtelLogsIngestService.ts` (hook pipeline execution before insert)
- Dashboard: new Settings page for pipeline configuration

### 3.3 Drop Filters (Pre-Storage Filtering)

**Current**: All ingested logs are stored.
**Target**: Configurable rules to drop or sample logs before storage.

**Implementation**:

- Create `LogDropFilter` PostgreSQL model: name, filter query, action (drop or sample at N%), enabled
- Evaluate drop filters in the ingestion pipeline before ClickHouse insert
- UI under Settings > Log Configuration > Drop Filters
- Show estimated volume savings based on recent log volume

### 3.4 Export to CSV/JSON

**Current**: No export capability.
**Target**: Download current filtered log results as CSV or JSON.

**Implementation**:

- Add "Export" button in the toolbar
- Client-side: serialize current page of logs to CSV/JSON and trigger browser download
- Server-side (for large exports): new endpoint that streams results to a downloadable file (up to 10K rows)

**Files to modify**:
- `Common/UI/Components/LogsViewer/components/LogsViewerToolbar.tsx` (add export button)
- `Common/UI/Utils/LogExport.ts` (new - CSV/JSON serialization)
- `Common/Server/API/TelemetryAPI.ts` (add export endpoint for large exports)

---

## Phase 4: Advanced Features (P3) — Differentiation


### 4.2 Keyboard Shortcuts

- `j`/`k` to navigate between log rows
- `Enter` to expand/collapse selected log
- `Escape` to close detail panel
- `/` to focus search bar
- `Ctrl+Enter` to apply filters

### 4.3 Sensitive Data Scrubbing

- Auto-detect common PII patterns (credit cards, SSNs, emails) at ingest time
- Configurable scrubbing rules: mask, hash, or redact
- UI under Settings > Data Privacy

---

## Recommended Implementation Order

1. **Phase 3.4** - Export CSV/JSON (small effort, table-stakes feature)
2. **Phase 3.1** - Log Context (moderate effort, high debugging value)
3. **Phase 3.2** - Log Pipelines (large effort, platform capability)
4. **Phase 3.3** - Drop Filters (moderate effort, cost optimization)
5. **Phase 4.x** - Patterns, Shortcuts, Data Scrubbing (future)

## Phase 5: ClickHouse Storage & Query Optimizations (P0) — Performance Foundation

These optimizations address fundamental storage and indexing gaps in the telemetry tables that directly impact search speed, data correctness, and operational cost.

### 5.3 Upgrade `time` Column to `DateTime64(9)` (High)

**Current**: The `time` column uses ClickHouse `DateTime` which has **1-second granularity**. Logs within the same second from the same service are stored in arbitrary order. The `timeUnixNano` field (Int128) preserves nanosecond precision but is not in the sort key, so it cannot be used for sub-second ordering.

**Target**: Use `DateTime64(9)` (nanosecond precision) so the sort key naturally orders logs at sub-second resolution.

**Implementation**:

- Change the `time` column type from `TableColumnType.Date` to a new `TableColumnType.DateTime64` in the Log model
- Add `DateTime64` support to `StatementGenerator` and the ClickHouse type mapping in `Statement.ts`
- Update ingestion code in `OtelLogsIngestService.ts` to write DateTime64-compatible timestamps
- Migration: `ALTER TABLE LogItem MODIFY COLUMN time DateTime64(9)` (this is a metadata-only operation in ClickHouse for MergeTree tables)
- Consider whether `timeUnixNano` column can be deprecated after this change since `time` would carry the same precision

**Impact**: Correct sub-second log ordering. Currently, logs from a burst of activity within the same second may appear in wrong order.

**Files to modify**:
- `Common/Models/AnalyticsModels/Log.ts` (change column type)
- `Common/Types/AnalyticsDatabase/TableColumnType.ts` (add DateTime64 type)
- `Common/Server/Utils/AnalyticsDatabase/Statement.ts` (add DateTime64 mapping)
- `Common/Server/Utils/AnalyticsDatabase/StatementGenerator.ts` (handle DateTime64 in CREATE/SELECT)
- `Telemetry/Services/OtelLogsIngestService.ts` (write DateTime64 timestamps)
- `Worker/DataMigrations/` (new migration)

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

### 5.8 Store Missing OpenTelemetry Log Fields (Low)

**Current**: Several standard OTEL log record fields are dropped during ingestion:
- `observedTimeUnixNano` — when the log was collected by the pipeline (useful for measuring ingestion lag)
- `droppedAttributesCount` — signals data loss during collection
- `flags` — log record flags (e.g., W3C trace flags)

**Target**: Preserve these fields for full OTEL compliance and operational debugging.

**Implementation**:

- Add optional columns to the Log model:
  - `observedTimeUnixNano` (LongNumber)
  - `droppedAttributesCount` (Number, default 0)
  - `flags` (Number, default 0)
- Update `OtelLogsIngestService.processLogsAsync()` to extract and store these fields
- Migration to add columns to existing table

**Files to modify**:
- `Common/Models/AnalyticsModels/Log.ts` (add columns)
- `Telemetry/Services/OtelLogsIngestService.ts` (extract additional fields)
- `Worker/DataMigrations/` (new migration)

### 5.x Remaining Performance Impact Summary

| Optimization | Query Pattern Improved | Expected Speedup | Effort |
|-------------|----------------------|-------------------|--------|
| 5.3 DateTime64 time column | Sub-second log ordering | Correctness fix | Medium |
| 5.7 Histogram projections | Histogram and severity aggregation | 5-10x | Medium |
| 5.8 Missing OTEL fields | OTEL compliance | N/A (completeness) | Small |

### 5.x Recommended Remaining Order

1. **5.3** — DateTime64 upgrade (correctness)
2. **5.7** — Projections (performance polish)
3. **5.8** — Missing OTEL fields (completeness)

---

## Verification

For each feature:
1. Unit tests for new parsers/utilities (LogQueryParser, CSV export, etc.)
2. Integration tests for new API endpoints (histogram, facets, analytics, context)
3. Manual verification via the dev server at `https://oneuptimedev.genosyn.com/dashboard/{projectId}/logs`
4. Check ClickHouse query performance with `EXPLAIN` for new aggregation queries
5. Verify real-time/live mode still works correctly with new UI components
