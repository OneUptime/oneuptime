# Dashboard Grafana Parity Plan

## Executive Summary

This document outlines the improvements needed to bring OneUptime's Dashboard feature to parity with Grafana. The current implementation provides basic visualization capabilities, while Grafana offers a comprehensive dashboarding platform with 15+ visualization types, template variables, transformations, and advanced querying.

**Goal:** Transform OneUptime Dashboards from a basic visualization tool into a full-featured observability dashboarding platform comparable to Grafana.

---

## Current State Analysis

### OneUptime Dashboard (Current)

| Feature | Status | Details |
|---------|--------|---------|
| Visualization Types | 3 | Line Chart, Bar Chart, Value (single metric), Text |
| Layout System | Basic | 12-unit grid, drag-and-drop |
| Query Builder | None | Direct metric selection only |
| Template Variables | None | No dynamic filtering |
| Transformations | None | No data manipulation |
| Annotations | None | No event markers |
| Alerting from Panels | None | Separate alerting system |
| Data Sources | 1 | Internal metrics only |
| Dashboard Sharing | None | No sharing/export |

### Grafana Features (Target)

| Feature | Details |
|---------|---------|
| Visualization Types | 15+ (time series, stat, gauge, bar, histogram, heatmap, table, geomap, etc.) |
| Query Language | PromQL/custom with autocomplete, builder & code modes |
| Template Variables | Query, constant, datasource, ad-hoc filters, chained variables |
| Transformations | 20+ (join, calculate, filter, sort, reduce, group by, partition, etc.) |
| Annotations | Event markers, alert annotations, custom annotations |
| Panel Features | Thresholds, overrides, legends, tooltips, data links |
| Dashboard Features | Tabs, rows, folders, playlists, snapshots, JSON import/export |
| Alerting | Panel-based alerting with notification channels |

---

## Metrics Ingestion Assessment

### Current Implementation Review

**Verdict: The metrics ingestion is well-implemented and follows best practices.**

**Strengths:**
1. **OTLP Compliance**: Full OpenTelemetry Protocol support for interoperability
2. **ClickHouse Storage**: Excellent choice for time-series analytics (MergeTree engine)
3. **Metric Types**: Supports Sum, Gauge, Histogram, ExponentialHistogram
4. **Aggregation Temporality**: Handles both Delta and Cumulative
5. **Async Processing**: BullMQ queue for reliable, scalable ingestion
6. **Batch Inserts**: Efficient database writes with configurable batch sizes
7. **Attribute Indexing**: Extracted `attributeKeys` for efficient filtering

**Minor Improvements Needed:**
1. Add `exemplars` support for trace-metric correlation (Grafana supports this)
2. Consider adding `MetricMetadata` for metric descriptions in query UI
3. Add metric cardinality tracking for performance monitoring

**File Locations:**
- Metric Model: `/Common/Models/AnalyticsModels/Metric.ts`
- Ingestion Service: `/Telemetry/Services/OtelMetricsIngestService.ts`
- Query Utilities: `/Dashboard/src/Components/Metrics/Utils/Metrics.ts`

---

## Implementation Phases

### Phase 1: Query Language & Builder (Foundation)

The most critical gap is the lack of a proper query language and builder. Grafana's power comes from PromQL and its visual query builder.

#### 1.1 OneUptime Query Language (OQL)

**Goal:** Create a simple, expressive query language for metrics

**Design:**
```
# Basic query
metric("http.request.duration")

# With aggregation
metric("http.request.duration") | avg()

# With filters
metric("http.request.duration")
  | where(service.name == "api-server")
  | where(endpoint contains "/api/")
  | avg()

# With grouping
metric("http.request.duration")
  | where(service.name == "api-server")
  | avg() by(endpoint, method)

# Rate calculation
metric("http.request.count")
  | rate(1m)

# Math operations
metric("http.request.count") / metric("http.error.count") * 100

# Histogram quantiles
metric("http.request.duration")
  | histogram_quantile(0.95)
```

**New Files:**
- `Common/Types/Dashboard/Query/OQLParser.ts` - Query parser
- `Common/Types/Dashboard/Query/OQLTypes.ts` - AST types
- `Common/Server/Utils/Dashboard/QueryExecutor.ts` - Query execution
- `Dashboard/src/Components/Dashboard/QueryEditor/QueryEditor.tsx` - UI

**Supported Functions:**
| Function | Description |
|----------|-------------|
| `avg()` | Average over time window |
| `sum()` | Sum of values |
| `min()` | Minimum value |
| `max()` | Maximum value |
| `count()` | Count of data points |
| `rate(interval)` | Per-second rate of increase |
| `increase(interval)` | Total increase over interval |
| `histogram_quantile(q)` | Quantile from histogram |
| `deriv()` | Derivative (rate of change) |
| `delta(interval)` | Difference over interval |
| `abs()` | Absolute value |
| `ceil()` / `floor()` | Rounding functions |
| `clamp(min, max)` | Clamp values to range |

---

#### 1.2 Visual Query Builder

**Goal:** No-code query building for users who don't want to write OQL

**UI Components:**

```
┌─────────────────────────────────────────────────────────────────┐
│ Query Builder                               [Builder] [Code]    │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│ Metric    [▼ http.request.duration                    ]        │
│                                                                 │
│ Filters   [+ Add Filter]                                        │
│           ┌──────────────┬────────┬─────────────────┐          │
│           │ service.name │   =    │ api-server      │ [×]      │
│           └──────────────┴────────┴─────────────────┘          │
│           ┌──────────────┬────────┬─────────────────┐          │
│           │ endpoint     │contains│ /api/           │ [×]      │
│           └──────────────┴────────┴─────────────────┘          │
│                                                                 │
│ Aggregate [▼ Average     ]                                      │
│                                                                 │
│ Group By  [▼ endpoint    ] [+ Add]                              │
│                                                                 │
│ ─────────────────────────────────────────────────────────────── │
│ Generated Query:                                                │
│ metric("http.request.duration")                                 │
│   | where(service.name == "api-server")                         │
│   | avg() by(endpoint)                                          │
└─────────────────────────────────────────────────────────────────┘
```

**Files to Create:**
- `Dashboard/src/Components/Dashboard/QueryBuilder/MetricSelector.tsx`
- `Dashboard/src/Components/Dashboard/QueryBuilder/FilterBuilder.tsx`
- `Dashboard/src/Components/Dashboard/QueryBuilder/AggregationSelector.tsx`
- `Dashboard/src/Components/Dashboard/QueryBuilder/GroupBySelector.tsx`
- `Dashboard/src/Components/Dashboard/QueryBuilder/QueryPreview.tsx`

---

#### 1.3 Query Autocomplete

**Goal:** IntelliSense-style autocomplete for metric names, labels, and functions

**Features:**
- Fuzzy search on metric names
- Label key/value suggestions based on selected metric
- Function signature hints
- Syntax error highlighting

**Implementation:**
- Use Monaco Editor or CodeMirror for code mode
- Custom autocomplete provider fetching from `/api/metrics/metadata`
- Real-time syntax validation

---

### Phase 2: Additional Visualizations

#### 2.1 New Visualization Types (Priority Order)

| Visualization | Description | Effort |
|---------------|-------------|--------|
| **Stat Panel** | Large single value with sparkline | Low |
| **Gauge** | Circular gauge with thresholds | Medium |
| **Table** | Tabular data with sorting/filtering | Medium |
| **Heatmap** | 2D histogram (time vs value buckets) | Medium |
| **Histogram** | Distribution bar chart | Medium |
| **State Timeline** | State changes over time | Medium |
| **Pie Chart** | Proportional data | Low |
| **Geomap** | Geographic data visualization | High |
| **Logs Panel** | Integrated log viewer | Medium |
| **Alert List** | Active alerts display | Low |

#### 2.2 Stat Panel Implementation

**Purpose:** Display a single prominent value with optional sparkline

**Configuration:**
```typescript
interface StatPanelConfig {
  title: string;
  metricQuery: OQLQuery;
  aggregation: "last" | "first" | "avg" | "sum" | "min" | "max";
  colorMode: "value" | "background" | "none";
  graphMode: "area" | "line" | "none";
  orientation: "horizontal" | "vertical" | "auto";
  textMode: "value" | "value_and_name" | "name" | "none";
  thresholds: Threshold[];
  unit: string;
  decimals: number;
}
```

**Mockup:**
```
┌────────────────────────────┐
│     Request Rate           │
│                            │
│        1,234               │
│        req/s               │
│     ▁▂▃▄▅▆▇█▆▅▃▂▁         │
└────────────────────────────┘
```

**Files:**
- `Common/Types/Dashboard/DashboardComponents/DashboardStatComponent.ts`
- `Common/Utils/Dashboard/Components/StatComponent.ts`
- `Dashboard/src/Components/Dashboard/Components/DashboardStatComponent.tsx`

---

#### 2.3 Gauge Panel Implementation

**Purpose:** Circular gauge for displaying values against thresholds

**Configuration:**
```typescript
interface GaugePanelConfig {
  title: string;
  metricQuery: OQLQuery;
  aggregation: AggregationType;
  min: number;
  max: number;
  thresholds: Threshold[];
  showThresholdLabels: boolean;
  showThresholdMarkers: boolean;
  unit: string;
  decimals: number;
}
```

**Mockup:**
```
┌────────────────────────────┐
│     CPU Usage              │
│                            │
│        ╭─────╮             │
│       ╱       ╲            │
│      │    72%  │           │
│       ╲       ╱            │
│        ╰─────╯             │
│     0%  ▓▓▓▓▓░░  100%      │
└────────────────────────────┘
```

---

#### 2.4 Table Panel Implementation

**Purpose:** Display metrics as sortable, filterable tables

**Features:**
- Column sorting
- Column filtering
- Pagination
- Cell value formatting
- Conditional cell coloring
- Column resizing
- Export to CSV

**Configuration:**
```typescript
interface TablePanelConfig {
  title: string;
  queries: OQLQuery[];
  columns: TableColumn[];
  pagination: boolean;
  pageSize: number;
  sortBy: string;
  sortDirection: "asc" | "desc";
}

interface TableColumn {
  field: string;
  header: string;
  width?: number;
  unit?: string;
  decimals?: number;
  thresholds?: Threshold[];
}
```

---

#### 2.5 Heatmap Panel Implementation

**Purpose:** Visualize histogram data or time-bucketed values

**Data Requirements:**
- Histogram metrics from OTLP (bucket counts + explicit bounds)
- Or: regular metrics bucketed by time and value range

**Configuration:**
```typescript
interface HeatmapPanelConfig {
  title: string;
  metricQuery: OQLQuery;
  yAxisBuckets: "auto" | number;
  colorScheme: "spectral" | "viridis" | "turbo" | "magma";
  showLegend: boolean;
  showTooltip: boolean;
}
```

---

### Phase 3: Template Variables

**Goal:** Enable dynamic, reusable dashboards that adapt to user selections

#### 3.1 Variable Types

| Type | Description | Example |
|------|-------------|---------|
| **Query** | Values from metric labels | All service names from `service.name` label |
| **Custom** | User-defined static list | `production, staging, development` |
| **Constant** | Hidden constant value | API base URL |
| **Interval** | Time interval selection | `1m, 5m, 15m, 1h` |
| **Datasource** | Future: datasource selection | - |

#### 3.2 Database Model

**New File:** `Common/Models/DatabaseModels/DashboardVariable.ts`

```typescript
interface DashboardVariable {
  id: ObjectID;
  dashboardId: ObjectID;
  name: string;              // e.g., "service"
  label: string;             // Display name: "Service"
  type: VariableType;        // query | custom | constant | interval
  query?: string;            // For query type: OQL to fetch values
  options?: string[];        // For custom type: static options
  defaultValue?: string;
  multi: boolean;            // Allow multiple selections
  includeAll: boolean;       // Include "All" option
  regex?: string;            // Filter options with regex
  sort: VariableSortOrder;   // none | alpha-asc | alpha-desc | num-asc | num-desc
  refresh: VariableRefresh;  // never | load | time-range-change
  order: number;             // Display order in toolbar
}
```

#### 3.3 Variable UI

**Toolbar Integration:**
```
┌─────────────────────────────────────────────────────────────────────────┐
│ Dashboard Name                                                          │
├─────────────────────────────────────────────────────────────────────────┤
│ Service: [▼ api-server    ] Environment: [▼ production ] Time: [1h ▼] │
└─────────────────────────────────────────────────────────────────────────┘
```

**Variable Configuration UI:**
```
┌─────────────────────────────────────────────────────────────────┐
│ Variables                                     [+ Add Variable]  │
├─────────────────────────────────────────────────────────────────┤
│ $service  Query    "All services in project"      [Edit] [×]   │
│ $env      Custom   production, staging, dev       [Edit] [×]   │
│ $interval Interval 1m, 5m, 15m, 1h, 6h, 24h      [Edit] [×]   │
└─────────────────────────────────────────────────────────────────┘
```

#### 3.4 Variable Interpolation

Variables are referenced in queries using `$variable` or `${variable}` syntax:

```
metric("http.request.duration")
  | where(service.name == "$service")
  | where(environment == "$env")
  | avg() by(endpoint)
```

**Implementation:**
- `Common/Utils/Dashboard/VariableInterpolator.ts` - Variable substitution
- Handle multi-value variables with `|` (OR) expansion
- Escape special characters

#### 3.5 Chained Variables

Variables can depend on other variables:

```typescript
// First variable: service
{
  name: "service",
  type: "query",
  query: 'label_values(service.name)'
}

// Second variable: endpoint (depends on service)
{
  name: "endpoint",
  type: "query",
  query: 'label_values(http.request.duration, endpoint) | where(service.name == "$service")'
}
```

When `$service` changes, `$endpoint` automatically refreshes.

---

### Phase 4: Data Transformations

**Goal:** Manipulate query results before visualization

#### 4.1 Transformation Pipeline

Transformations are applied sequentially after query execution:

```
Query Results → Transform 1 → Transform 2 → ... → Visualization
```

#### 4.2 Supported Transformations

| Transform | Description |
|-----------|-------------|
| **Filter by name** | Include/exclude series by name pattern |
| **Filter by value** | Keep rows matching condition |
| **Organize fields** | Rename, reorder, hide fields |
| **Join by field** | Merge multiple queries on common field |
| **Group by** | Aggregate rows by field values |
| **Sort by** | Order results by field |
| **Reduce** | Collapse series to single value |
| **Add field from calculation** | Create computed fields |
| **Convert field type** | Change data types |
| **Filter data by query** | Use query results to filter another |
| **Partition by values** | Split one series into multiple |
| **Rename by regex** | Regex-based field renaming |
| **Limit** | Limit number of rows |

#### 4.3 Transformation Configuration

```typescript
interface Transformation {
  id: string;
  type: TransformationType;
  options: TransformationOptions;
  disabled: boolean;
}

// Example: Add field from calculation
{
  type: "addFieldFromCalculation",
  options: {
    mode: "binary", // binary | unary | reduceRow | index
    fieldA: "requests",
    fieldB: "errors",
    operation: "divide",
    alias: "error_rate"
  }
}
```

#### 4.4 Transformation UI

```
┌─────────────────────────────────────────────────────────────────┐
│ Transformations                          [+ Add transformation] │
├─────────────────────────────────────────────────────────────────┤
│ 1. Filter by name                                    [≡] [×]    │
│    Match: /api-.*/                                              │
├─────────────────────────────────────────────────────────────────┤
│ 2. Group by                                          [≡] [×]    │
│    Group by: endpoint                                           │
│    Calculate: sum(requests), avg(latency)                       │
├─────────────────────────────────────────────────────────────────┤
│ 3. Sort by                                           [≡] [×]    │
│    Field: requests  Direction: Descending                       │
└─────────────────────────────────────────────────────────────────┘
```

**Files:**
- `Common/Types/Dashboard/Transformations/` - Transformation types
- `Common/Utils/Dashboard/TransformationExecutor.ts` - Execution engine
- `Dashboard/src/Components/Dashboard/Transformations/` - UI components

---

### Phase 5: Panel Features

#### 5.1 Thresholds

**Purpose:** Color-code values based on configurable ranges

```typescript
interface Threshold {
  value: number;
  color: string;  // hex color
  state: "ok" | "warning" | "critical";
}

// Example
thresholds: [
  { value: 0, color: "#73BF69", state: "ok" },
  { value: 80, color: "#FF9830", state: "warning" },
  { value: 90, color: "#F2495C", state: "critical" }
]
```

#### 5.2 Field Overrides

**Purpose:** Apply custom styling/formatting to specific fields

```typescript
interface FieldOverride {
  matcher: {
    type: "byName" | "byRegex" | "byType";
    options: string;
  };
  properties: {
    unit?: string;
    decimals?: number;
    displayName?: string;
    color?: string;
    thresholds?: Threshold[];
    links?: DataLink[];
  };
}
```

#### 5.3 Data Links

**Purpose:** Create clickable links from panel data

```typescript
interface DataLink {
  title: string;
  url: string;  // Can include variables: ${__value.raw}, ${__field.name}
  targetBlank: boolean;
}

// Example: Link to logs for a service
{
  title: "View Logs",
  url: "/project/${projectId}/logs?service=${__field.labels.service.name}",
  targetBlank: true
}
```

#### 5.4 Annotations

**Purpose:** Mark events on time-series charts

```typescript
interface Annotation {
  id: ObjectID;
  dashboardId: ObjectID;
  name: string;
  enabled: boolean;
  datasource: "alerts" | "incidents" | "deployments" | "custom";
  query?: string;
  color: string;
  iconColor: string;
}
```

**Built-in annotation sources:**
- Alerts triggered
- Incidents created/resolved
- Deployments (from CI/CD integration)
- Custom events via API

**Visualization:**
```
Time Series Chart
│
│    ▲ Alert: High CPU
│    │
├────┼──────▲──────────────────────┤
│    │      │ Deploy: v2.1.0      │
│ ───┼──────┼─────────────────────┤
│    │      │                     │
└────┴──────┴─────────────────────┘
     10:00  10:30                  11:00
```

---

### Phase 6: Dashboard Features

#### 6.1 Dashboard Rows

**Purpose:** Group panels into collapsible sections

```typescript
interface DashboardRow {
  id: string;
  title: string;
  collapsed: boolean;
  panels: string[];  // Panel IDs in this row
}
```

**UI:**
```
┌─────────────────────────────────────────────────────────────────┐
│ ▼ API Performance                                               │
├─────────────────────────────────────────────────────────────────┤
│ ┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐    │
│ │ Request Rate    │ │ Latency P95     │ │ Error Rate      │    │
│ └─────────────────┘ └─────────────────┘ └─────────────────┘    │
├─────────────────────────────────────────────────────────────────┤
│ ▶ Database Metrics (collapsed - click to expand)                │
├─────────────────────────────────────────────────────────────────┤
│ ▼ Infrastructure                                                │
├─────────────────────────────────────────────────────────────────┤
│ ┌─────────────────┐ ┌─────────────────┐                        │
│ │ CPU Usage       │ │ Memory Usage    │                        │
│ └─────────────────┘ └─────────────────┘                        │
└─────────────────────────────────────────────────────────────────┘
```

#### 6.2 Dashboard Tabs (Grafana 12 Feature)

**Purpose:** Organize large dashboards into tabbed views

```typescript
interface DashboardTab {
  id: string;
  title: string;
  icon?: string;
  components: string[];  // Component IDs in this tab
}
```

#### 6.3 Dashboard JSON Import/Export

**Purpose:** Enable dashboard portability and version control

**API Endpoints:**
- `GET /dashboard/:id/export` - Export as JSON
- `POST /dashboard/import` - Import from JSON

**JSON Structure:**
```json
{
  "version": 1,
  "dashboard": {
    "name": "API Monitoring",
    "description": "...",
    "variables": [...],
    "components": [...],
    "annotations": [...],
    "time": { "from": "now-1h", "to": "now" }
  }
}
```

#### 6.4 Dashboard Folders

**Purpose:** Organize dashboards hierarchically

**Model:** `Common/Models/DatabaseModels/DashboardFolder.ts`

```typescript
interface DashboardFolder {
  id: ObjectID;
  projectId: ObjectID;
  name: string;
  parentFolderId?: ObjectID;  // For nesting
  createdByUserId: ObjectID;
}
```

#### 6.5 Dashboard Sharing

**Features:**
- Share link with time range
- Public snapshots (read-only, time-limited)
- Embed via iframe
- PDF export

---

### Phase 7: Performance & Scale

#### 7.1 Query Caching

```typescript
interface QueryCache {
  key: string;  // Hash of query + time range + variables
  result: QueryResult;
  cachedAt: Date;
  expiresAt: Date;
}
```

**Cache Strategy:**
- Cache aligned time ranges
- Invalidate on data ingestion
- Configurable TTL per dashboard

#### 7.2 Incremental Queries

For live dashboards, fetch only new data since last query:

```typescript
// Instead of:
query.timeRange = { from: "now-1h", to: "now" }

// Use:
query.timeRange = { from: lastDataPoint, to: "now" }
// Merge with existing data
```

#### 7.3 Query Optimization

- Push down filters to ClickHouse
- Use materialized views for common aggregations
- Implement query result streaming for large datasets

---

## Implementation Priority

### P0 - Critical (Weeks 1-4)

| Feature | Files | Effort |
|---------|-------|--------|
| Query Builder UI | `Dashboard/src/Components/Dashboard/QueryBuilder/*` | Medium |
| Stat Panel | `**/DashboardStatComponent.*` | Low |
| Basic Thresholds | Component config updates | Low |
| Time range in URL | Dashboard state management | Low |

### P1 - High (Weeks 5-8)

| Feature | Files | Effort |
|---------|-------|--------|
| Template Variables | New model + UI + interpolation | High |
| Gauge Panel | `**/DashboardGaugeComponent.*` | Medium |
| Table Panel | `**/DashboardTableComponent.*` | Medium |
| Dashboard JSON Export/Import | API + UI | Medium |

### P2 - Medium (Weeks 9-12)

| Feature | Files | Effort |
|---------|-------|--------|
| OQL Parser (code mode) | `Common/Types/Dashboard/Query/*` | High |
| Basic Transformations | `Common/Utils/Dashboard/Transformations/*` | High |
| Heatmap Panel | `**/DashboardHeatmapComponent.*` | Medium |
| Annotations | New model + chart integration | Medium |

### P3 - Nice to Have (Future)

| Feature | Effort |
|---------|--------|
| Histogram Panel | Medium |
| State Timeline | Medium |
| Dashboard Folders | Low |
| Dashboard Tabs | Medium |
| Geomap Panel | High |
| Dashboard Sharing/Embedding | Medium |
| Query Caching | Medium |
| Chained Variables | Medium |

---

## File Structure (New Files)

```
Common/
├── Models/DatabaseModels/
│   ├── DashboardVariable.ts          # NEW
│   ├── DashboardAnnotation.ts        # NEW
│   └── DashboardFolder.ts            # NEW
├── Types/Dashboard/
│   ├── Query/
│   │   ├── OQLTypes.ts               # NEW
│   │   ├── OQLParser.ts              # NEW
│   │   └── OQLValidator.ts           # NEW
│   ├── DashboardComponents/
│   │   ├── DashboardStatComponent.ts     # NEW
│   │   ├── DashboardGaugeComponent.ts    # NEW
│   │   ├── DashboardTableComponent.ts    # NEW
│   │   ├── DashboardHeatmapComponent.ts  # NEW
│   │   └── DashboardHistogramComponent.ts # NEW
│   ├── Transformations/
│   │   ├── TransformationTypes.ts    # NEW
│   │   └── index.ts                  # NEW
│   └── Variable/
│       ├── VariableTypes.ts          # NEW
│       └── VariableInterpolator.ts   # NEW
├── Server/Utils/Dashboard/
│   ├── QueryExecutor.ts              # NEW
│   └── TransformationExecutor.ts     # NEW
└── Utils/Dashboard/Components/
    ├── StatComponent.ts              # NEW
    ├── GaugeComponent.ts             # NEW
    ├── TableComponent.ts             # NEW
    └── HeatmapComponent.ts           # NEW

Dashboard/src/Components/Dashboard/
├── QueryBuilder/
│   ├── QueryBuilder.tsx              # NEW
│   ├── MetricSelector.tsx            # NEW
│   ├── FilterBuilder.tsx             # NEW
│   ├── AggregationSelector.tsx       # NEW
│   ├── GroupBySelector.tsx           # NEW
│   └── QueryCodeEditor.tsx           # NEW
├── Components/
│   ├── DashboardStatComponent.tsx    # NEW
│   ├── DashboardGaugeComponent.tsx   # NEW
│   ├── DashboardTableComponent.tsx   # NEW
│   └── DashboardHeatmapComponent.tsx # NEW
├── Transformations/
│   ├── TransformationList.tsx        # NEW
│   ├── TransformationEditor.tsx      # NEW
│   └── transformations/              # NEW (one per transform type)
├── Variables/
│   ├── VariableToolbar.tsx           # NEW
│   ├── VariableEditor.tsx            # NEW
│   └── VariableDropdown.tsx          # NEW
└── Annotations/
    ├── AnnotationLayer.tsx           # NEW
    └── AnnotationEditor.tsx          # NEW
```

---

## Files to Modify

| File | Changes |
|------|---------|
| `Common/Types/Dashboard/DashboardComponentType.ts` | Add new component types |
| `Common/Types/Dashboard/DashboardViewConfig.ts` | Add variables, annotations |
| `Common/Models/DatabaseModels/Dashboard.ts` | Add folder relation |
| `Dashboard/src/Components/Dashboard/DashboardToolbar.tsx` | Add variable dropdowns |
| `Dashboard/src/Components/Dashboard/DashboardCanvas/Index.tsx` | Add annotation layer |
| `Dashboard/src/Components/Dashboard/DashboardView.tsx` | Variable state management |
| `Dashboard/src/Components/Dashboard/ComponentSettingsModal.tsx` | Query builder integration |

---

## Success Metrics

1. **Query Builder:** Users can build metric queries without writing code
2. **Variables:** Dashboards can filter data dynamically via dropdowns
3. **Visualizations:** At least 6 visualization types available
4. **Transformations:** Users can manipulate data post-query
5. **Performance:** Dashboard load time < 2 seconds with 10 panels
6. **Adoption:** 50% increase in dashboard usage after launch

---

## References

- [Grafana Visualizations Documentation](https://grafana.com/docs/grafana/latest/visualizations/panels-visualizations/visualizations/)
- [Grafana Variables Documentation](https://grafana.com/docs/grafana/latest/visualizations/dashboards/variables/)
- [Grafana Transform Data](https://grafana.com/docs/grafana/latest/visualizations/panels-visualizations/query-transform-data/transform-data/)
- [PromQL Introduction](https://grafana.com/blog/2020/02/04/introduction-to-promql-the-prometheus-query-language/)
- [Grafana 12 Release Notes](https://grafana.com/blog/2025/05/07/grafana-12-release-all-the-new-features/)
