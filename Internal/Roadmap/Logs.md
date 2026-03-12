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

These optimizations address fundamental storage and indexing gaps in the `LogItem` table that directly impact search speed, data correctness, and operational cost. They should be prioritized alongside or before Phase 1 since search UX improvements are only as fast as the underlying queries.

### Current Schema

```
Table:      LogItem
Engine:     MergeTree
Partition:  sipHash64(projectId) % 16
Primary/Sort Keys: (projectId, time, serviceId)
```

| Column | ClickHouse Type | Notes |
|--------|----------------|-------|
| projectId | String | Tenant ID |
| serviceId | String | Service ID |
| time | DateTime | **Second precision only** |
| timeUnixNano | Int128 | Nanosecond timestamp (not in sort key) |
| severityText | String | Trace/Debug/Info/Warning/Error/Fatal |
| severityNumber | Int32 | OTEL severity number (0-24) |
| attributes | JSON | Flexible key-value store |
| attributeKeys | Array(String) | Pre-extracted keys for discovery |
| traceId | String | Optional trace correlation |
| spanId | String | Optional span correlation |
| body | String | Log message text |

### 5.1 Add Skip Indexes for Full-Text Search on `body` (Critical)

**Current**: `body ILIKE '%text%'` in `LogAggregationService.ts:244` performs a full scan of every row in the matching partitions. For a table with billions of rows, this is extremely slow.

**Target**: Add a token-based bloom filter index so ClickHouse can skip granules that definitely don't contain the search term.

**Implementation**:

- Add a `tokenbf_v1` index on the `body` column in the `Log` model definition at `Common/Models/AnalyticsModels/Log.ts`
- Extend `AnalyticsBaseModel` and `StatementGenerator` to support skip index definitions in the CREATE TABLE statement
- Migration to add the index to existing tables via `ALTER TABLE LogItem ADD INDEX`

```sql
-- Target DDL addition
INDEX idx_body body TYPE tokenbf_v1(10240, 3, 0) GRANULARITY 4
```

**Expected improvement**: 10-100x faster text search on `body` for selective queries (terms that appear in a small fraction of granules). Non-selective queries (very common terms) still benefit from reduced I/O.

**Files to modify**:
- `Common/Models/AnalyticsModels/Log.ts` (add index definition)
- `Common/Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel.ts` (support skip index metadata)
- `Common/Server/Utils/AnalyticsDatabase/StatementGenerator.ts` (emit INDEX clause in CREATE TABLE)
- `Worker/DataMigrations/` (new migration to add index to existing table)

### 5.2 Add Skip Indexes for `traceId`, `spanId`, `severityText` (Critical)

**Current**: Filtering by traceId or spanId (the primary way to correlate logs with distributed traces) requires scanning all data within the projectId+time range. Severity filtering has the same problem.

**Target**: Add bloom filter and set indexes so ClickHouse can skip irrelevant granules.

**Implementation**:

```sql
-- Bloom filters for high-cardinality string columns
INDEX idx_trace_id traceId TYPE bloom_filter(0.01) GRANULARITY 1
INDEX idx_span_id spanId TYPE bloom_filter(0.01) GRANULARITY 1

-- Set index for low-cardinality severity (only ~7 distinct values)
INDEX idx_severity severityText TYPE set(10) GRANULARITY 4
```

- Add these index definitions to the `Log` model
- Create a data migration to apply indexes to existing tables

**Expected improvement**:
- traceId/spanId lookups: 50-1000x faster (bloom filter skips nearly all granules for a specific trace)
- severity filtering: 2-5x faster (set index skips granules that don't contain the target severity)

**Files to modify**:
- `Common/Models/AnalyticsModels/Log.ts` (add index definitions)
- `Common/Server/Utils/AnalyticsDatabase/StatementGenerator.ts` (emit INDEX clauses)
- `Worker/DataMigrations/` (new migration)

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

### 5.4 Add TTL for Per-Service Automatic Data Retention (High)

**Current**: Each `Service` (PostgreSQL) has a `retainTelemetryDataForDays` field (default 15 days). Retention is enforced by an hourly cron job at `Worker/Jobs/TelemetryService/DeleteOldData.ts` that iterates over **every project → every service** and issues `ALTER TABLE DELETE` mutations per service. This is problematic because:
- `ALTER TABLE DELETE` creates ClickHouse **mutations** — expensive async background operations that rewrite entire data parts
- Running this for every service every hour can pile up hundreds of pending mutations
- Mutations compete with ingestion for disk I/O and can degrade cluster performance
- If the cron job fails or falls behind, data accumulates unboundedly

**Target**: ClickHouse-native TTL with per-service retention, eliminating the mutation-based cron job.

**Approach: `retentionDate` column with row-level TTL**

Since retention is per-service (not per-table), a simple `TTL time + INTERVAL N DAY` won't work — different rows in the same table need different expiry times. The solution is to compute the expiry date at ingest time and store it:

1. Add a `retentionDate DateTime` column to `LogItem`
2. At ingest time, compute `retentionDate = time + service.retainTelemetryDataForDays`
3. Set the table TTL to `TTL retentionDate DELETE`
4. ClickHouse automatically drops expired rows during background merges — no mutations, no cron job

**Implementation**:

- Add `retentionDate` column to the Log model at `Common/Models/AnalyticsModels/Log.ts`:
  ```typescript
  const retentionDateColumn = new AnalyticsTableColumn({
    key: "retentionDate",
    title: "Retention Date",
    description: "Date after which this row is eligible for TTL deletion",
    required: true,
    type: TableColumnType.Date,
    // no read/create access needed — internal-only column
  });
  ```

- Add TTL clause to table definition:
  ```sql
  TTL retentionDate DELETE
  ```

- Update ingestion in `OtelLogsIngestService.processLogsAsync()` to compute and store the retention date:
  ```typescript
  const retentionDays = serviceDictionary[serviceName]!.dataRententionInDays;
  const retentionDate = OneUptimeDate.addRemoveDays(timeDate, retentionDays);

  const logRow: JSONObject = {
    // ... existing fields ...
    retentionDate: OneUptimeDate.toClickhouseDateTime(retentionDate),
  };
  ```

- Also update `FluentLogsIngestService` and `SyslogIngestService` (same pattern)

- Data migration for existing data:
  ```sql
  -- Add the column
  ALTER TABLE LogItem ADD COLUMN retentionDate DateTime DEFAULT time + INTERVAL 15 DAY;

  -- Set the TTL
  ALTER TABLE LogItem MODIFY TTL retentionDate DELETE;
  ```
  Existing rows without an explicit `retentionDate` will use the DEFAULT expression (`time + 15 days`) which provides a safe fallback.

- Deprecate the cron job at `Worker/Jobs/TelemetryService/DeleteOldData.ts` — can be kept temporarily as a safety net for the transition period, then removed

**Edge cases**:

- **Retention policy changes**: If a user changes `retainTelemetryDataForDays` from 30 to 7, already-ingested rows still have the old `retentionDate`. Options:
  - Accept that the change only applies to newly ingested data (simplest, recommended)
  - Run a one-time `ALTER TABLE UPDATE retentionDate = time + INTERVAL 7 DAY WHERE serviceId = {sid}` mutation (expensive but correct). This could be triggered from the Service settings UI.
- **Default retention**: If `retainTelemetryDataForDays` is not set on a service, default to 15 days (matching current behavior)
- **Same approach for Span and Metric tables**: This pattern should be applied to `SpanItem` and `MetricItem` tables as well since they use the same cron-based deletion today

**Why this is better than the current approach**:

| | Current (cron + mutations) | Proposed (TTL + retentionDate) |
|---|---|---|
| Mechanism | Hourly `ALTER TABLE DELETE` per service | ClickHouse background merges |
| Cost | Creates mutations that rewrite data parts | Free — part of normal merge cycle |
| Reliability | Depends on cron job running | Built into ClickHouse engine |
| Scale | O(projects × services) mutations/hour | Zero external operations |
| Disk I/O | Heavy (mutation rewrites) | Minimal (parts dropped during merge) |

**Files to modify**:
- `Common/Models/AnalyticsModels/Log.ts` (add `retentionDate` column + TTL config)
- `Common/Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel.ts` (TTL support in base model)
- `Common/Server/Utils/AnalyticsDatabase/StatementGenerator.ts` (emit TTL clause in CREATE TABLE)
- `Telemetry/Services/OtelLogsIngestService.ts` (compute and store `retentionDate`)
- `Telemetry/Services/FluentLogsIngestService.ts` (same)
- `Telemetry/Services/SyslogIngestService.ts` (same)
- `Common/Server/Services/OpenTelemetryIngestService.ts` (ensure `dataRetentionInDays` is passed through)
- `Worker/DataMigrations/` (new migration to add column + set TTL)
- `Worker/Jobs/TelemetryService/DeleteOldData.ts` (deprecate after transition)
- Apply same pattern to `Common/Models/AnalyticsModels/Span.ts` and `Common/Models/AnalyticsModels/Metric.ts`

### 5.5 Fix SQL Construction in `LogAggregationService` (High)

**Current**: `LogAggregationService.appendCommonFilters()` at lines 206-249 constructs SQL via string interpolation for serviceIds, severityTexts, traceIds, and spanIds:

```typescript
// Current - string interpolation with manual escaping
const idStrings = request.serviceIds.map(id => `'${id.toString()}'`);
statement.append(` AND serviceId IN (${idStrings.join(",")})`);
```

While `ObjectID.toString()` is likely safe, severity and trace/span values come from user input and are only protected by a simple `escapeSingleQuotes` function. This is fragile and inconsistent with the parameterized approach used elsewhere.

**Target**: Use parameterized queries for all filter values.

**Implementation**:

- Refactor `appendCommonFilters` to use the `Statement` class's parameterized query support for all IN clauses
- Each value should be a named parameter with proper type annotation
- Remove the `escapeSingleQuotes` helper since it would no longer be needed

**Files to modify**:
- `Common/Server/Services/LogAggregationService.ts` (refactor appendCommonFilters)

### 5.6 Add ZSTD Compression on `body` Column (Medium)

**Current**: The table uses ClickHouse's default LZ4 compression for all columns. The `body` column is typically the largest column (log messages are verbose text) and is highly compressible.

**Target**: Use ZSTD compression on `body` for better compression ratio.

**Implementation**:

- Add codec specification to the `body` column: `body String CODEC(ZSTD(3))`
- Extend `AnalyticsBaseModel`/`StatementGenerator` to support per-column codec specifications
- Migration: `ALTER TABLE LogItem MODIFY COLUMN body String CODEC(ZSTD(3))`
- Consider ZSTD for `attributes` column as well (JSON is also highly compressible)

**Expected improvement**: 30-50% reduction in storage for the `body` column compared to LZ4, with minimal CPU overhead increase on reads.

**Files to modify**:
- `Common/Models/AnalyticsModels/Log.ts` (add codec config)
- `Common/Types/AnalyticsDatabase/TableColumn.ts` (add codec property)
- `Common/Server/Utils/AnalyticsDatabase/StatementGenerator.ts` (emit CODEC clause)
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

### 5.x Performance Impact Summary

| Optimization | Query Pattern Improved | Expected Speedup | Effort |
|-------------|----------------------|-------------------|--------|
| 5.1 Body text index | Full-text search on body | 10-100x | Medium |
| 5.2 traceId/spanId/severity indexes | Trace correlation, severity filter | 50-1000x (trace), 2-5x (severity) | Small |
| 5.3 DateTime64 time column | Sub-second log ordering | Correctness fix | Medium |
| 5.4 TTL data retention | Storage management | Prevents disk exhaustion | Small |
| 5.5 Parameterized SQL | Security hardening | N/A (security fix) | Small |
| 5.6 ZSTD compression | Storage cost | 30-50% less disk for body | Small |
| 5.7 Histogram projections | Histogram and severity aggregation | 5-10x | Medium |
| 5.8 Missing OTEL fields | OTEL compliance | N/A (completeness) | Small |

### 5.x Recommended Sub-Phase Order

1. **5.2** — Skip indexes for traceId/spanId/severity (smallest effort, largest query speedup)
2. **5.1** — Body text index (biggest impact on user-facing search)
3. **5.5** — Parameterized SQL fix (security, small effort)
4. **5.4** — TTL data retention (operational necessity)
5. **5.3** — DateTime64 upgrade (correctness)
6. **5.6** — ZSTD compression (cost optimization)
7. **5.7** — Projections (performance polish)
8. **5.8** — Missing OTEL fields (completeness)

---

## Verification

For each feature:
1. Unit tests for new parsers/utilities (LogQueryParser, CSV export, etc.)
2. Integration tests for new API endpoints (histogram, facets, analytics, context)
3. Manual verification via the dev server at `https://oneuptimedev.genosyn.com/dashboard/{projectId}/logs`
4. Check ClickHouse query performance with `EXPLAIN` for new aggregation queries
5. Verify real-time/live mode still works correctly with new UI components
