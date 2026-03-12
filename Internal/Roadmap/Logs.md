# Plan: Bring OneUptime Log Management to Industry Parity

## Context

OneUptime's log management currently provides basic functionality: multi-protocol ingestion (OTLP, gRPC, Fluentd, Syslog), ClickHouse storage, text search on body, severity/time/attribute filtering, live tail (10s polling), and an expandable log detail view. While the foundation is solid, it falls significantly behind Datadog and New Relic in search UX, analytics, log processing, and operational features. This plan identifies the highest-impact gaps and proposes a phased implementation to close them.

## Gap Analysis Summary

| Feature | OneUptime | Datadog | New Relic | Priority |
|---------|-----------|---------|-----------|----------|
| Full-text search with query syntax | Basic substring on `body` | Boolean, attribute, range, wildcard, NLQ | Lucene + NRQL | **P0** |
| Log volume histogram (timeseries) | None | Always-on above log list | Always-on above log list | **P0** |
| Faceted sidebar (attribute drill-down) | Hidden behind "Advanced Filters" | Left sidebar with counts, click-to-filter | Left sidebar with counts | **P0** |
| Saved Views | None | Full state save/share | Full state save/share | **P1** |
| Log Patterns (ML clustering) | None | Auto-clustering + Pattern Inspector | ML clustering + anomaly | **P1** |
| Log-based analytics/charts | None | Timeseries, TopList, Table, Pie | Full NRQL charting | **P1** |
| Column customization | Fixed 4 columns | Fully customizable | Configurable | **P1** |
| Log context (surrounding logs) | None | Before/after from same host/service | Automatic via APM agent | **P2** |
| Log Pipelines (server-side processing) | None (raw storage only) | 270+ OOTB, 14+ processor types | Grok parsing, built-in rules | **P2** |
| Log-based Metrics | None | Count + Distribution, 15-month retention | Via NRQL | **P2** |
| Drop Filters (pre-storage filtering) | None | Exclusion filters with sampling | Drop rules per NRQL | **P2** |
| Export to CSV/JSON | None | CSV up to 100K rows | CSV/JSON up to 5K | **P2** |
| Service filter in sidebar | None (only attribute filter) | Facet on `service` | Filter on entity | **P1** |
| Keyboard shortcuts | None | Full keyboard nav | Basic | **P3** |
| Sensitive Data Scrubbing | None | Multi-layer (SaaS + agent + pipeline) | Auto-obfuscation + custom rules | **P3** |
| Data retention config UI | Referenced but no UI | Multi-tier (Standard/Flex/Archive) | Partitions + Live Archives | **P3** |

---

## Phase 1: Search & Discovery UX (P0) — Highest Impact

These changes directly improve the daily log investigation experience for every user.

### 1.1 Log Query Language / Search Bar Enhancement

**Current**: Single text input that does substring match on `body` field only.
**Target**: A structured query bar supporting field-specific searches, boolean operators, and severity/service shortcuts.

**Implementation**:

- Create a new `LogQueryParser` utility at `Common/Types/Log/LogQueryParser.ts` that parses a query string into a `Query<Log>` object
- Supported syntax:
  - Free text: `connection refused` → substring match on `body`
  - Field-specific: `service:api-gateway`, `severity:error`, `traceId:abc123`
  - Attribute access: `@http.status_code:500`, `@user.id:12345`
  - Boolean: `AND`, `OR`, `NOT` (e.g., `severity:error AND service:payments`)
  - Negation: `-severity:debug` (exclude debug logs)
  - Wildcards: `service:api-*`
  - Numeric ranges on attributes: `@duration:>1000`
  - Quoted phrases: `"connection refused"`
- Replace the single text input in `LogsFilterCard.tsx` with a new `LogSearchBar` component featuring:
  - Syntax highlighting (color-code field names, operators, values)
  - Autocomplete dropdown suggesting field names (`service:`, `severity:`, `@attribute.name:`) and values
  - Query validation with inline error indicators
- The parser generates ClickHouse-compatible WHERE clauses via the existing `StatementGenerator`

**Files to modify**:
- `Common/Types/Log/LogQueryParser.ts` (new)
- `Common/UI/Components/LogsViewer/components/LogSearchBar.tsx` (new)
- `Common/UI/Components/LogsViewer/components/LogsFilterCard.tsx` (replace text input)
- `Common/UI/Components/LogsViewer/LogsViewer.tsx` (wire new search bar)
- `Common/Server/Services/AnalyticsDatabaseService.ts` (extend query translation for new operators)

### 1.2 Log Volume Histogram

**Current**: No visual representation of log volume over time.
**Target**: A time-series bar chart above the log table showing log count per time bucket, colored by severity.

**Implementation**:

- Add a new API endpoint `POST /telemetry/logs/histogram` that runs a ClickHouse aggregation query:
  ```sql
  SELECT toStartOfInterval(time, INTERVAL {bucket_size}) AS bucket, severityText, count() AS cnt
  FROM LogItem
  WHERE projectId = {projectId} AND time BETWEEN {start} AND {end} [AND additional filters]
  GROUP BY bucket, severityText
  ORDER BY bucket
  ```
- Bucket size auto-calculated based on time range (e.g., 1min for last hour, 5min for last 6h, 1h for last week)
- Create a `LogsHistogram` React component at `Common/UI/Components/LogsViewer/components/LogsHistogram.tsx`
  - Stacked bar chart with severity colors (Error=red, Warning=amber, Info=blue, Debug=gray)
  - Click-and-drag to zoom into a time range (updates the filter's start/end date)
  - Hover tooltip showing exact count per severity at that time bucket
- Place above the log table in `LogsViewer.tsx`

**Files to modify**:
- `Common/Server/API/TelemetryAPI.ts` (add histogram endpoint)
- `Common/UI/Components/LogsViewer/components/LogsHistogram.tsx` (new)
- `Common/UI/Components/LogsViewer/LogsViewer.tsx` (integrate histogram)

### 1.3 Faceted Sidebar with Attribute Drill-Down

**Current**: Attributes are a hidden "Advanced Filter" with JSON key-value input.
**Target**: A persistent left sidebar showing top attribute values with counts, click-to-filter.

**Implementation**:

- Add a new API endpoint `POST /telemetry/logs/facets` that queries ClickHouse for top-N values of selected facet fields:
  ```sql
  SELECT JSONExtractString(attributes, {key}) AS val, count() AS cnt
  FROM LogItem
  WHERE projectId = {projectId} AND time BETWEEN {start} AND {end}
  GROUP BY val ORDER BY cnt DESC LIMIT 10
  ```
- Default facets: `severityText`, `serviceId` (resolved to service name), and auto-discovered high-value attribute keys
- Create `LogsFacetSidebar` component at `Common/UI/Components/LogsViewer/components/LogsFacetSidebar.tsx`:
  - Each facet section shows the attribute name, top values with bar charts showing relative count
  - Clicking a value adds it as a filter to the current query
  - Clicking with "NOT" modifier excludes that value
  - Expandable to see more values
  - Search within a facet for specific values
- Move from the current left nav (which just says "All Logs") to this facet sidebar

**Files to modify**:
- `Common/Server/API/TelemetryAPI.ts` (add facets endpoint)
- `Common/UI/Components/LogsViewer/components/LogsFacetSidebar.tsx` (new)
- `Common/UI/Components/LogsViewer/LogsViewer.tsx` (integrate sidebar layout)
- `App/FeatureSet/Dashboard/src/Pages/Logs/Index.tsx` (adjust page layout)

---

## Phase 2: Analytics & Organization (P1) — Power User Features

### 2.1 Saved Views

**Current**: No way to save filter/query state.
**Target**: Users can save, name, and share log views.

**Implementation**:

- Create a new PostgreSQL model `LogSavedView` with fields: `id`, `projectId`, `name`, `query` (JSON), `columns` (JSON array), `sortField`, `sortOrder`, `pageSize`, `createdByUserId`, `isDefault`, timestamps
- CRUD API via standard OneUptime model patterns
- Add a "Save View" button in the toolbar and a dropdown to load saved views
- Saved views appear in the left sidebar above the facets

**Files to modify**:
- `Common/Models/DatabaseModels/LogSavedView.ts` (new model)
- `Common/Server/Services/LogSavedViewService.ts` (new service)
- `Common/UI/Components/LogsViewer/components/SavedViewsDropdown.tsx` (new)
- `Common/UI/Components/LogsViewer/components/LogsViewerToolbar.tsx` (add save/load buttons)

### 2.2 Log Analytics View (Charts from Logs)

**Current**: Logs are only viewable as a list.
**Target**: A toggle to switch from "List" to "Analytics" mode showing aggregate visualizations.

**Implementation**:

- Add a view mode toggle in the toolbar: "List" | "Analytics"
- Analytics view provides a query builder for:
  - **Timeseries**: Count/unique count over time, grouped by up to 2 dimensions
  - **Top List**: Top N values for a dimension by count
  - **Table**: Pivot table with multiple group-by dimensions
- Reuse the histogram endpoint with extended aggregation support
- New API endpoint `POST /telemetry/logs/analytics` that supports flexible GROUP BY + aggregation queries
- Create `LogsAnalyticsView` component using a charting library (recommend recharts, already likely in the project)

**Files to modify**:
- `Common/Server/API/TelemetryAPI.ts` (add analytics endpoint)
- `Common/UI/Components/LogsViewer/components/LogsAnalyticsView.tsx` (new)
- `Common/UI/Components/LogsViewer/components/LogsViewerToolbar.tsx` (add view toggle)
- `Common/UI/Components/LogsViewer/LogsViewer.tsx` (conditional rendering)

### 2.3 Column Customization

**Current**: Fixed columns: Time, Service, Severity, Message.
**Target**: Users can add/remove/reorder columns from log attributes.

**Implementation**:

- Add a "Columns" button in the toolbar that opens a dropdown/popover
- Default columns: Time, Service, Severity, Message
- Available columns: any discovered attribute key (from the existing get-attributes endpoint)
- Selected columns persist in localStorage (and in Saved Views when that feature ships)
- Extend `LogsTable.tsx` to dynamically render columns based on configuration

**Files to modify**:
- `Common/UI/Components/LogsViewer/components/ColumnSelector.tsx` (new)
- `Common/UI/Components/LogsViewer/components/LogsTable.tsx` (dynamic columns)
- `Common/UI/Components/LogsViewer/LogsViewer.tsx` (column state management)

### 2.4 Service Filter in Sidebar

**Current**: No quick way to filter by service.
**Target**: Service list with checkboxes in the facet sidebar.

**Implementation**:

- Part of the facet sidebar (1.3) - `serviceId` is a default facet
- Service names resolved via the existing `serviceMap` loaded in `LogsViewer.tsx`
- Multi-select: check multiple services to include, or click "Only" to isolate one
- Color dots matching the service color coding already in the table

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

1. **Phase 1.2** - Log Volume Histogram (highest visual impact, moderate effort)
2. **Phase 1.3** - Faceted Sidebar (dramatically improves discovery UX)
3. **Phase 1.1** - Query Language (the biggest effort but highest long-term value)
4. **Phase 2.3** - Column Customization (small effort, high user value)
5. **Phase 2.1** - Saved Views (moderate effort, high retention value)
6. **Phase 3.4** - Export CSV/JSON (small effort, table-stakes feature)
7. **Phase 3.1** - Log Context (moderate effort, high debugging value)
8. **Phase 2.2** - Log Analytics View (larger effort, advanced user feature)
9. **Phase 3.2** - Log Pipelines (large effort, platform capability)
10. **Phase 3.3** - Drop Filters (moderate effort, cost optimization)
11. **Phase 4.x** - Patterns, Shortcuts, Data Scrubbing (future)

## Phase 5: ClickHouse Storage & Query Optimizations (P0) — Performance Foundation

These optimizations address fundamental storage and indexing gaps in the telemetry tables that directly impact search speed, data correctness, and operational cost.

### Completed

The following items have been implemented:
- **5.1** Skip indexes for full-text search on `body` (tokenbf_v1)
- **5.2** Skip indexes for `traceId`, `spanId`, `severityText` (bloom_filter, set) — applied to Log, Span, Metric, Exception tables
- **5.4** Per-service TTL via `retentionDate` column — applied to all 5 telemetry tables (Log, Span, Metric, Exception, MonitorLog) with ingestion-time computation
- **5.5** Parameterized SQL in `LogAggregationService` — replaced string interpolation with `Includes`-based parameterized queries
- **5.6** ZSTD compression on `body` column (Log), `stackTrace`/`message` (Exception)

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
