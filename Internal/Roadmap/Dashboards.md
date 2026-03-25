# Plan: Bring OneUptime Dashboards to Industry Parity and Beyond

## Context

OneUptime's dashboard implementation provides a 12-column grid layout with drag-and-drop editing, 3 widget types (Chart with Line/Bar, Value, Text with basic formatting), global time range with presets, view/edit modes, role-based permissions, and full-screen support. Dashboard config is stored as a single JSON column. Dashboards can only query OpenTelemetry metrics from ClickHouse.

This plan identifies the remaining gaps vs Grafana, Datadog, and New Relic, and proposes a phased implementation to build a best-in-class dashboard product that leverages OneUptime's unique position as an all-in-one observability + status page platform.

## Completed

The following features have been implemented:
- **12-Column Grid Layout** - Fixed grid with dynamic unit sizing, 60 default rows (expandable)
- **Drag-and-Drop Editing** - Move and resize components with bounds checking
- **Chart Widget** - Line and Bar chart types with single metric query, configurable title/description/legend
- **Value Widget** - Single metric aggregation displayed as large number
- **Text Widget** - Bold/Italic/Underline formatting (no markdown)
- **Global Time Range** - Presets (30min to 3mo) + custom date range picker
- **View/Edit Modes** - Read-only view with full-screen, edit mode with side panel settings
- **Role-Based Permissions** - ProjectOwner, ProjectAdmin, ProjectMember + custom permissions
- **Dashboard CRUD API** - Standard REST API with slug generation
- **Billing Enforcement** - Free plan limited to 1 dashboard

## Gap Analysis Summary

| Feature | OneUptime | Grafana | Datadog | New Relic | Priority |
|---------|-----------|---------|---------|-----------|----------|
| Widget types | 3 | 20+ | 40+ | 15+ | **P0** |
| Chart types | 2 (Line, Bar) | 10+ | 12+ | 10+ | **P0** |
| Template variables | None | 6+ types | Yes | 3 types | **P0** |
| Auto-refresh | None | Configurable | Real-time | Yes | **P0** |
| Log panels | None | Yes (Loki) | Yes | Yes (NRQL) | **P0** |
| Trace panels | None | Yes (Tempo) | Yes | Yes | **P0** |
| Table widget | None | Yes | Yes | Yes | **P0** |
| Multiple queries per chart | Single query | Yes | Yes | Yes | **P0** |
| Markdown support | Basic formatting only | Full markdown | Full markdown | Full markdown | **P0** |
| Threshold lines / color coding | None | Yes | Yes | Yes | **P0** |
| Legend interaction (show/hide) | None | Yes | Yes | Yes | **P0** |
| Chart zoom | None | Yes | Yes | Yes | **P0** |
| Unified query plugin interface | None | Datasource plugins | Yes | NRQL | **P0** |
| Dashboard linking / drill-down | None | Data links | Yes | Facet linking | **P1** |
| Annotations / event overlays | None | Yes | Yes | Yes (Labs) | **P1** |
| Row/section grouping | None | Collapsible rows | Groups | No | **P1** |
| Public/shared dashboards | None | Yes | Yes | Yes | **P1** |
| JSON import/export | None | Yes | Yes | Yes | **P1** |
| Dashboard versioning | None | Yes | Yes | No | **P1** |
| Alert integration | None | Create from panel + show state | Yes | NRQL alerts | **P1** |
| TV/Kiosk mode | Full-screen only | Kiosk mode | Yes | Auto-cycling | **P1** |
| CSV export | None | Yes | Yes | Yes | **P1** |
| Custom time per widget | None | No | No | No | **P1** |
| Perses/Grafana import | None | N/A | No | No | **P1** |
| AI dashboard creation | None | None | None | None | **P2** |
| Dashboard-as-code SDK | None | Foundation SDK | No | No | **P2** |
| Terraform provider | None | Yes | Yes | Yes | **P2** |

---

## Architecture: Query Plugin Interface & Perses Compatibility

Before implementing features, we should establish a `QueryPlugin` interface that all widget data sources use. This is a foundational architectural change that enables Phase 2 (logs, traces) and Phase 4 (Dashboard-as-Code) cleanly.

### Why Not Adopt Perses Wholesale?

[Perses](https://perses.dev) is a CNCF Sandbox project providing an open dashboard specification and embeddable UI components. We evaluated it as a potential protocol for our dashboard system. The decision is to **selectively borrow patterns** rather than adopt it fully:

**Against full adoption:**
- Our `AggregateBy` API queries ClickHouse directly. Perses assumes Prometheus/PromQL as the primary query language — mapping our ClickHouse aggregation queries into Perses's `PrometheusTimeSeriesQuery` plugin model adds unnecessary indirection.
- Phase 2 (click-to-correlate, cross-signal correlation) is our biggest differentiator. Perses has basic Tempo/Loki plugins but nothing like unified correlation. Adopting their panel model would constrain our ability to build these features.
- Perses is still CNCF Sandbox stage with data model structs marked deprecated in favor of a new `perses/spec` repo. The spec is not yet stable enough to build a product on.
- Maintaining a translation layer between Perses spec and our internal `DashboardViewConfig` format for every feature would add ongoing overhead.

**What we selectively adopt:**

| Perses Concept | Where It Helps | How |
|---|---|---|
| `kind`+`spec` plugin pattern | Phase 1.9 (QueryPlugin), Phase 2.1-2.2 | Formalize widget data sources as plugins instead of hardcoding every widget type |
| Variable model with scoping | Phase 1.2 (Template Variables) | Adopt query-based, list, and text variable types with dashboard → project → global scoping |
| Decoupled layout from panels | Phase 3.4 (Sections) | Separate panel definitions from grid positions to make sections/grouping cleaner |
| Dashboard JSON schema | Phase 3.2 (Import/Export) | Support importing Perses-format dashboards alongside native format for Grafana migration path |

### 1.9 Unified Query Plugin Interface

**Current**: Widgets are hardcoded to query metrics via `MetricQueryConfigData` and the `AggregateBy` API. Adding logs or traces as data sources requires duplicating the entire query path.
**Target**: A `QueryPlugin` interface that abstracts data sources, enabling any widget to query metrics, logs, or traces through a unified contract.

**Design**:

```typescript
// The plugin pattern borrowed from Perses: kind + spec
interface QueryPlugin {
  kind: "MetricQuery" | "LogQuery" | "TraceQuery" | "FormulaQuery";
  spec: MetricQuerySpec | LogQuerySpec | TraceQuerySpec | FormulaQuerySpec;
}

interface MetricQuerySpec {
  metricName: string;
  attributes: JSONObject;
  aggregationType: AggregationType;
  groupBy?: string[];
}

interface LogQuerySpec {
  severityFilter?: SeverityLevel[];
  serviceFilter?: string[];
  bodyContains?: string;
  attributes?: JSONObject;
}

interface TraceQuerySpec {
  serviceFilter?: string[];
  operationFilter?: string[];
  statusFilter?: TraceStatus[];
  minDuration?: Duration;
}

interface FormulaQuerySpec {
  formula: string;           // e.g., "a / b * 100"
  queries: Record<string, QueryPlugin>;  // named sub-queries
}

// Each widget stores an array of QueryPlugins instead of MetricQueryConfigData
interface DashboardWidgetConfig {
  queries: QueryPlugin[];
  // ... other widget config
}
```

**Benefits**:
- Log stream and trace list widgets (Phase 2.1, 2.2) plug in without new query plumbing
- Cross-signal correlation (Phase 2.3) becomes a multi-query widget with mixed `kind` values
- Formula queries (Phase 1.4) compose naturally across query types
- Future data sources (e.g., external Prometheus, custom APIs) add a new `kind` without touching widget code
- Aligns with Perses's extensibility model without coupling to their spec

**Files to modify**:
- `Common/Types/Dashboard/QueryPlugin.ts` (new - interface definitions)
- `Common/Types/Metrics/MetricsQuery.ts` (refactor to implement MetricQuerySpec)
- `Common/UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI.ts` (add query resolver that dispatches by `kind`)
- `Common/Server/API/BaseAnalyticsAPI.ts` (add unified query endpoint)
- `App/FeatureSet/Dashboard/src/Components/Metrics/Utils/Metrics.ts` (refactor fetchResults to use QueryPlugin)

---

## Phase 1: Foundation (P0) — Close Critical Gaps

These gaps make OneUptime dashboards fundamentally non-competitive. Every major competitor has these.

### 1.1 Add Core Chart Types: Area, Pie, Table, Gauge, Heatmap, Histogram

**Current**: Line and Bar only.
**Target**: 8+ chart types covering all standard observability visualization needs.

**Implementation**:

- **Area Chart** (stacked and non-stacked): Extension of line chart with fill. Use existing chart library's area mode
- **Pie/Donut Chart**: For proportional breakdowns (e.g., error distribution by service). New component
- **Table Widget**: Tabular metric data, top-N lists, multi-column display with sortable columns. New component type
- **Gauge Widget**: Circular gauge with configurable min/max/thresholds and color zones. New component
- **Heatmap**: Time on X-axis, value buckets on Y-axis, color intensity for count. Essential for distribution/histogram metrics
- **Histogram**: Bar chart showing value distribution. Important for latency analysis

Each chart type needs:
- A new entry in `DashboardComponentType` or `ChartType` enum
- A rendering component in `Dashboard/Components/`
- Configuration options in the component settings side panel

**Files to modify**:
- `Common/Types/Dashboard/Chart/ChartType.ts` (add Area, Pie, Heatmap, Histogram, Gauge)
- `Common/Types/Dashboard/DashboardComponentType.ts` (add Table, Gauge)
- `App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardChartComponent.tsx` (render new types)
- `App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardTableComponent.tsx` (new)
- `App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardGaugeComponent.tsx` (new)

### 1.2 Template Variables

**Current**: No template variables. Users must create separate dashboards for each service/host/environment.
**Target**: Drop-down variable selectors that dynamically filter all widgets.

**Implementation**:

- Create a `DashboardVariable` type stored in `dashboardViewConfig`:
  - Name, label, type (query-based, custom list, text input)
  - Query-based: runs a ClickHouse query to populate options (e.g., `SELECT DISTINCT service FROM MetricItem WHERE projectId = {pid}`)
  - Custom list: manually defined options
  - Multi-value selection support
- Render variables as dropdown selectors in the dashboard toolbar
- Variables can be referenced in metric queries as `$variable_name`
- When a variable changes, all widgets re-query with the new value
- Support cascading variables (variable B's query depends on variable A's value)
- **Scoping model (from Perses)**: Variables can be defined at dashboard, project, or global scope. Dashboard-level overrides project-level, which overrides global. This lets teams define org-wide variables (e.g., `$environment`) once and reuse across dashboards.

**Files to modify**:
- `Common/Types/Dashboard/DashboardVariable.ts` (new)
- `Common/Types/Dashboard/DashboardViewConfig.ts` (add variables array)
- `App/FeatureSet/Dashboard/src/Components/Dashboard/Toolbar/DashboardToolbar.tsx` (render variable dropdowns)
- `App/FeatureSet/Dashboard/src/Components/Dashboard/DashboardView.tsx` (pass variable values to widgets)
- `Common/Server/Services/MetricService.ts` (resolve variable references in queries)

### 1.3 Auto-Refresh

**Current**: Data goes stale after initial load.
**Target**: Configurable auto-refresh intervals.

**Implementation**:

- Add auto-refresh dropdown in toolbar with options: Off, 5s, 10s, 30s, 1m, 5m, 15m
- Store selected interval in dashboard config and URL state
- Use `setInterval` to trigger re-fetch on all metric widgets
- Show a subtle refresh indicator when data is being updated
- Pause auto-refresh when the dashboard is in edit mode

**Files to modify**:
- `App/FeatureSet/Dashboard/src/Components/Dashboard/Toolbar/DashboardToolbar.tsx` (add refresh dropdown)
- `App/FeatureSet/Dashboard/src/Components/Dashboard/DashboardView.tsx` (implement refresh timer)
- `Common/Types/Dashboard/DashboardViewConfig.ts` (store refresh interval)

### 1.4 Multiple Queries per Chart with Formulas

**Current**: Single `MetricQueryConfigData` per chart.
**Target**: Overlay multiple metric series on a single chart for correlation, with cross-query formulas.

**Implementation**:

- Change chart component's data source from single `MetricQueryConfigData` to `QueryPlugin[]` (using the new unified interface)
- Each query gets its own alias and legend entry
- Support `FormulaQuery` plugin kind for cross-query formulas (e.g., `a / b * 100` where `a` and `b` reference other queries by alias)
- Y-axis: support dual Y-axes for metrics with different scales
- Formula evaluation happens server-side to avoid shipping raw data to the client

**Files to modify**:
- `Common/Utils/Dashboard/Components/DashboardChartComponent.ts` (change to QueryPlugin array)
- `App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardChartComponent.tsx` (render multiple series)
- `App/FeatureSet/Dashboard/src/Components/Dashboard/Canvas/ComponentSettingsSideOver.tsx` (multi-query config UI)
- `Common/Server/Services/FormulaEvaluator.ts` (new - server-side formula evaluation)

### 1.5 Full Markdown Support for Text Widget

**Current**: Only bold, italic, underline formatting.
**Target**: Full markdown rendering including headers, links, lists, code blocks, tables, and images.

**Implementation**:

- Replace the current custom formatting with a markdown renderer (e.g., `react-markdown` or `marked`)
- Support: headers (h1-h6), links, ordered/unordered lists, code blocks with syntax highlighting, tables, images, blockquotes
- Edit mode: raw markdown text area with preview toggle

**Files to modify**:
- `App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardTextComponent.tsx` (replace with markdown renderer)
- `Common/Utils/Dashboard/Components/DashboardTextComponent.ts` (store raw markdown)

### 1.6 Threshold Lines & Color Coding

**Current**: No threshold visualization.
**Target**: Configurable warning/critical thresholds on charts with color-coded regions.

**Implementation**:

- Add threshold configuration to chart settings: value, label, color (default: yellow for warning, red for critical)
- Render horizontal lines on the chart at threshold values
- Optionally fill regions above/below thresholds with translucent color
- For value/billboard widgets: change background color based on which threshold range the value falls in (green/yellow/red)

**Files to modify**:
- `Common/Utils/Dashboard/Components/DashboardChartComponent.ts` (add thresholds config)
- `App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardChartComponent.tsx` (render threshold lines)
- `App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardValueComponent.tsx` (color coding)

### 1.7 Legend Interaction (Show/Hide Series)

**Current**: Legends are display-only.
**Target**: Click legend items to toggle series visibility.

**Implementation**:

- Add click handler on legend items to toggle series visibility
- Clicked-off series should be visually dimmed in the legend and removed from the chart
- Support "isolate" mode: Ctrl+Click shows only that series and hides all others
- Persist toggled state during the session (reset on page reload)

**Files to modify**:
- `App/FeatureSet/Dashboard/src/Components/Metrics/MetricGraph.tsx` (add legend click handlers)

### 1.8 Chart Zoom (Click-Drag Time Selection)

**Current**: No zoom capability.
**Target**: Click and drag on a time series chart to zoom into a time range.

**Implementation**:

- Enable brush/selection mode on time series charts
- When user drags to select a range, update the global time range to the selected range
- Show a "Reset zoom" button to return to the previous time range
- Maintain a zoom stack so users can zoom in multiple times and zoom back out

**Files to modify**:
- `App/FeatureSet/Dashboard/src/Components/Metrics/MetricGraph.tsx` (add brush selection)
- `App/FeatureSet/Dashboard/src/Components/Dashboard/DashboardView.tsx` (handle time range updates from zoom)

---

## Phase 2: Observability Integration (P0-P1) — Leverage the Full Platform

This is where OneUptime can differentiate: metrics, logs, and traces in one platform. The `QueryPlugin` interface from Phase 1.9 makes this phase significantly easier — each new signal type is a new `kind` in the plugin system rather than a new query pipeline.

### 2.1 Log Stream Widget

**Current**: Dashboards can only show metrics.
**Target**: Widget that displays a live log stream with filtering.

**Implementation**:

- New `DashboardComponentType.LogStream` widget type
- Uses `QueryPlugin` with `kind: "LogQuery"` — same interface as metric widgets
- Configuration: log query filter, severity filter, service filter, max rows
- Renders as a scrolling log list with severity color coding, timestamp, and body
- Click a log entry to expand and see full details
- Respects dashboard time range and template variables

**Files to modify**:
- `Common/Types/Dashboard/DashboardComponentType.ts` (add LogStream)
- `Common/Utils/Dashboard/Components/DashboardLogStreamComponent.ts` (new - config)
- `App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardLogStreamComponent.tsx` (new - rendering)
- `Common/Server/Services/LogQueryResolver.ts` (new - implements QueryPlugin for logs)

### 2.2 Trace List Widget

**Current**: No trace visualization in dashboards.
**Target**: Widget showing a filtered trace list with duration and status.

**Implementation**:

- New `DashboardComponentType.TraceList` widget type
- Uses `QueryPlugin` with `kind: "TraceQuery"` — same interface as metric and log widgets
- Configuration: service filter, operation filter, status filter, min duration
- Renders as a table: trace ID, operation, service, duration, status, timestamp
- Click a row to navigate to the full trace view
- Respects dashboard time range and template variables

**Files to modify**:
- `Common/Types/Dashboard/DashboardComponentType.ts` (add TraceList)
- `Common/Utils/Dashboard/Components/DashboardTraceListComponent.ts` (new)
- `App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardTraceListComponent.tsx` (new)
- `Common/Server/Services/TraceQueryResolver.ts` (new - implements QueryPlugin for traces)

### 2.3 Click-to-Correlate Across Signals

**Current**: No cross-signal correlation in dashboards.
**Target**: Click a point on a metric chart to instantly see related logs and traces from that timestamp.

**Implementation**:

- When clicking a data point on a metric chart, open a correlation panel showing:
  - Logs from the same service and time window (+/- 5 minutes around the clicked point)
  - Traces from the same service and time window
  - Filtered by the same template variables
- The correlation panel uses the `QueryPlugin` interface internally — it fires a `LogQuery` and `TraceQuery` scoped to the clicked timestamp and service context
- The correlation panel appears as a slide-over or split view below the chart
- This is a major differentiator vs Grafana (which requires separate datasources) and ties into OneUptime's all-in-one advantage
- No competitor, including Perses, has this level of built-in cross-signal correlation

**Files to modify**:
- `App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardChartComponent.tsx` (add click handler)
- `App/FeatureSet/Dashboard/src/Components/Dashboard/CorrelationPanel.tsx` (new - shows correlated logs/traces)

### 2.4 Annotations / Event Overlays

**Current**: No event markers on charts.
**Target**: Show deployment events, incidents, and alerts as vertical markers on time series charts.

**Implementation**:

- Query OneUptime's own data for events in the chart's time range:
  - Incidents (from Incident model)
  - Deployments (can be sent as OTLP resource attributes or a custom event API)
  - Alert triggers (from monitor alert history)
- Render as vertical dashed lines with icons on hover
- Color-code by type: red for incidents, blue for deployments, yellow for alerts
- Allow users to add manual annotations (text + timestamp)

**Files to modify**:
- `Common/Types/Dashboard/DashboardAnnotation.ts` (new)
- `App/FeatureSet/Dashboard/src/Components/Metrics/MetricGraph.tsx` (render annotation markers)
- `Common/Server/API/DashboardAnnotationAPI.ts` (new - query events)

### 2.5 Alert Integration

**Current**: No connection between dashboards and alerting.
**Target**: Create alerts from dashboard panels and display alert state on panels.

**Implementation**:

- "Create Alert" button in chart settings that pre-fills a metric monitor with the chart's query
- Show alert state indicator on chart headers (green/yellow/red dot) based on associated monitor status
- Alert status widget: shows a summary of all active alerts with severity and duration

**Files to modify**:
- `App/FeatureSet/Dashboard/src/Components/Dashboard/Canvas/ComponentSettingsSideOver.tsx` (add "Create Alert" button)
- `App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardChartComponent.tsx` (show alert state)
- `Common/Types/Dashboard/DashboardComponentType.ts` (add AlertStatus widget type)

### 2.6 SLO/SLI Widget

**Current**: No SLO visualization.
**Target**: Dedicated widget showing SLO status, error budget burn rate, and remaining budget.

**Implementation** (depends on Metrics roadmap Phase 3.2 - SLO/SLI Tracking):

- New `DashboardComponentType.SLO` widget type
- Configuration: select an SLO definition
- Displays: current attainment (%), target (%), error budget remaining (%), burn rate chart
- Color-coded: green (healthy), yellow (burning fast), red (budget exhausted)

**Files to modify**:
- `Common/Types/Dashboard/DashboardComponentType.ts` (add SLO)
- `App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardSLOComponent.tsx` (new)

---

## Phase 3: Collaboration & Sharing (P1) — Production Workflows

### 3.1 Public/Shared Dashboards

**Current**: Dashboards require login.
**Target**: Share dashboards with external stakeholders without requiring authentication.

**Implementation**:

- Add `isPublic` flag and `publicAccessToken` to Dashboard model
- Generate a shareable URL with token: `/public/dashboard/{token}`
- Public view is read-only with no editing controls
- Option to restrict public access to specific IP ranges
- Render without the OneUptime navigation chrome

**Files to modify**:
- `Common/Models/DatabaseModels/Dashboard.ts` (add isPublic, publicAccessToken)
- `App/FeatureSet/Dashboard/src/Pages/Public/Dashboard.tsx` (new - public dashboard view)

### 3.2 JSON Import/Export with Perses & Grafana Compatibility

**Current**: No import/export capability.
**Target**: Export dashboards as JSON and re-import for backup, migration, and dashboard-as-code. Support importing Perses and Grafana dashboard formats.

**Implementation**:

- **Native export**: Serialize `dashboardViewConfig` + metadata (name, description, variables) as a JSON file download. Include a schema version for forward compatibility.
- **Perses-compatible export**: Alongside native format, output a Perses-spec-compatible JSON. This gives users interoperability with the CNCF ecosystem without coupling our internals. Map our `QueryPlugin` kinds to Perses panel plugin types where possible.
- **Grafana import**: Perses already has tooling to convert Grafana dashboards to Perses format. By supporting Perses import, we get Grafana migration for free: Grafana → Perses → OneUptime.
- **Import pipeline**: Upload a JSON file → detect format (native, Perses, Grafana) → translate to `DashboardViewConfig` → validate → create dashboard.
- Handle version compatibility (include a schema version in the export)

**Files to modify**:
- `App/FeatureSet/Dashboard/src/Pages/Dashboards/Dashboards.tsx` (add import button)
- `App/FeatureSet/Dashboard/src/Pages/Dashboards/View/Settings.tsx` (add export button)
- `Common/Server/API/DashboardImportExportAPI.ts` (new)
- `Common/Server/Utils/Dashboard/PersesConverter.ts` (new - bidirectional Perses format conversion)
- `Common/Server/Utils/Dashboard/GrafanaConverter.ts` (new - Grafana JSON to native format)

### 3.3 Dashboard Versioning

**Current**: No change history.
**Target**: Track changes to dashboards over time with the ability to view history and revert.

**Implementation**:

- Create `DashboardVersion` model: dashboardId, version number, config snapshot, changedBy, timestamp
- On each save, create a new version entry
- UI: "Version History" in settings showing a list of versions with timestamps and authors
- "Restore" button to revert to a previous version
- Optional: diff view comparing two versions

**Files to modify**:
- `Common/Models/DatabaseModels/DashboardVersion.ts` (new)
- `Common/Server/Services/DashboardService.ts` (create version on save)
- `App/FeatureSet/Dashboard/src/Pages/Dashboards/View/VersionHistory.tsx` (new)

### 3.4 Row/Section Grouping with Decoupled Layout

**Current**: Components placed freely with no grouping. Panel definitions and grid positions are mixed together in each component.
**Target**: Collapsible rows/sections for organizing related panels, with layout decoupled from panel definitions.

**Implementation**:

- **Decouple layout from panels** (pattern from Perses): Separate panel definitions (what to render) from layout definitions (where to render it). Panels are stored in a `panels` map keyed by ID. Layouts reference panels by `$ref`. This makes it easier to rearrange panels without modifying their query/display config.
- Add a "Section" component type that acts as a collapsible container
- Section has a title bar that can be clicked to collapse/expand
- When collapsed, hides all components within the section's vertical range
- Sections can be nested one level deep
- Migration: existing `DashboardViewConfig` components are automatically split into panel + layout entries on first load

**Files to modify**:
- `Common/Types/Dashboard/DashboardViewConfig.ts` (add panels map + layouts array, deprecate inline component positions)
- `Common/Types/Dashboard/DashboardComponentType.ts` (add Section)
- `App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardSectionComponent.tsx` (new)
- `App/FeatureSet/Dashboard/src/Components/Dashboard/Canvas/Index.tsx` (handle section collapse, resolve panel refs)

### 3.5 TV/Kiosk Mode

**Current**: Full-screen only.
**Target**: Dedicated kiosk mode optimized for wall-mounted monitors with auto-cycling.

**Implementation**:

- Kiosk mode: hides all chrome (toolbar, navigation, URL bar), shows only the dashboard grid
- Auto-cycle: rotate through a list of dashboards at a configurable interval (30s, 1m, 5m)
- Dashboard playlist: define an ordered list of dashboards to cycle through
- Support per-dashboard display duration

**Files to modify**:
- `App/FeatureSet/Dashboard/src/Pages/Dashboards/Kiosk.tsx` (new - kiosk view)
- `Common/Models/DatabaseModels/DashboardPlaylist.ts` (new - playlist model)

### 3.6 CSV Export

**Current**: No data export.
**Target**: Export chart/table data as CSV for offline analysis.

**Implementation**:

- Add "Export CSV" option in chart/table context menu
- Client-side: serialize the current rendered data to CSV format
- Include column headers, timestamps, and values
- Trigger browser download

**Files to modify**:
- `App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardChartComponent.tsx` (add export option)
- `Common/Utils/Dashboard/CSVExport.ts` (new - CSV serialization)

### 3.7 Custom Time Range per Widget

**Current**: All widgets share the global time range.
**Target**: Individual widgets can override the global time range.

**Implementation**:

- Add optional `timeRangeOverride` to each component's config
- When set, the widget uses its own time range instead of the global one
- Show a small clock icon on widgets with custom time ranges
- Configuration in the component settings side panel

**Files to modify**:
- `Common/Utils/Dashboard/Components/DashboardBaseComponent.ts` (add timeRangeOverride)
- `App/FeatureSet/Dashboard/src/Components/Dashboard/DashboardView.tsx` (pass per-widget time ranges)

---

## Phase 4: Differentiation (P2-P3) — Surpass Competition

### 4.1 AI-Powered Dashboard Creation

**Current**: Manual dashboard creation only.
**Target**: Natural language dashboard creation - "Show me CPU usage by service for the last 24 hours" auto-creates the right widget.

**Implementation**:

- Natural language input in the "Add Widget" dialog
- AI translates to: metric name, aggregation, group by, chart type, time range
- Uses available MetricType metadata to match metric names
- Preview the generated widget before adding to dashboard
- This is a feature NO competitor has done well yet - major differentiator

### 4.2 Pre-Built Dashboard Templates

**Current**: No templates.
**Target**: One-click dashboard templates for common stacks.

**Implementation**:

- Template library: Node.js, Python, Go, Java, Kubernetes, PostgreSQL, Redis, Nginx, MongoDB, etc.
- Auto-detect relevant templates based on ingested telemetry data
- "One-click create" instantiates a full dashboard from the template
- Community template sharing (future)

### 4.3 Auto-Generated Dashboards

**Current**: Users must manually build dashboards.
**Target**: When a service connects, auto-generate a relevant dashboard.

**Implementation**:

- On first telemetry ingest from a new service, analyze the metric names and types
- Auto-create a service dashboard with relevant charts based on detected metrics
- Include golden signals (latency, traffic, errors, saturation) where applicable
- Notify the user and link to the auto-generated dashboard

### 4.4 Customer-Facing Dashboards on Status Pages

**Current**: Status pages and dashboards are separate.
**Target**: Embed dashboard widgets on status pages for real-time performance visibility.

**Implementation**:

- Allow selecting specific dashboard widgets to embed on a status page
- Render widgets in read-only mode without internal navigation
- Respect public/private data boundaries (only show metrics the customer should see)
- This is unique to OneUptime - no competitor has integrated observability dashboards with status pages

### 4.5 Dashboard-as-Code SDK (Perses-Compatible)

**Current**: No programmatic dashboard creation.
**Target**: TypeScript SDK for defining dashboards as code, with optional Perses-compatible output.

**Implementation**:

```typescript
const dashboard = new Dashboard("Service Health")
  .addVariable("service", { type: "query", query: "SELECT DISTINCT service FROM MetricItem" })
  .addRow("Latency")
    .addChart({ metric: "http.server.duration", aggregation: "p99", groupBy: ["$service"] })
    .addChart({ metric: "http.server.duration", aggregation: "p50", groupBy: ["$service"] })
  .addRow("Throughput")
    .addChart({ metric: "http.server.request.count", aggregation: "rate", groupBy: ["$service"] })

// Output native OneUptime format
dashboard.toJSON();

// Output Perses-compatible format for ecosystem interop
dashboard.toPerses();
```

- SDK generates the JSON config and uses the Dashboard API to create/update
- Git-based provisioning: store dashboard definitions in repo, CI/CD syncs to OneUptime
- `toPerses()` output allows users to share dashboard definitions with teams using Perses or other CNCF-compatible tools
- Perses's CUE SDK patterns can inform our builder API design

### 4.6 Anomaly Detection Overlays

**Current**: No anomaly visualization.
**Target**: AI highlights anomalous data points on charts without manual threshold configuration.

**Implementation** (depends on Metrics roadmap Phase 3.1 - Anomaly Detection):

- Automatically overlay expected range bands (baseline +/- N sigma) on metric charts
- Highlight data points outside the expected range with color indicators
- Click an anomaly to see correlated changes across metrics, logs, and traces

### 4.7 Terraform / OpenTofu Provider

**Current**: No infrastructure-as-code support for dashboards.
**Target**: Manage dashboards via Terraform/OpenTofu for GitOps workflows.

**Implementation**:

- Expose dashboard CRUD via a well-documented REST API (already exists)
- Build a Terraform provider that maps dashboard resources to the API
- Support `oneuptime_dashboard`, `oneuptime_dashboard_variable`, and `oneuptime_dashboard_template` resources
- This complements the Dashboard-as-Code SDK (4.5) — SDK for developers, Terraform for ops teams

---

## Quick Wins (Can Ship This Week)

1. **Auto-refresh** - Add a simple `setInterval` refresh with dropdown selector in toolbar
2. **Full markdown for text widget** - Replace custom formatting with a markdown renderer
3. **Legend show/hide** - Add click handler on legend items to toggle series
4. **Stacked area chart** - Simple extension of existing line chart with fill
5. **Chart zoom** - Enable brush selection on time series charts

---

## Recommended Implementation Order

### Phase 0: Architecture Foundation
1. **Phase 1.9** - QueryPlugin interface (enables everything else; do this first)

### Phase 1: Core Features
2. **Quick Wins** - Auto-refresh, markdown, legend toggle, stacked area, chart zoom
3. **Phase 1.1** - More chart types (Area, Pie, Table, Gauge)
4. **Phase 1.2** - Template variables with scoping (highest-impact feature for dashboard usability)
5. **Phase 1.4** - Multiple queries per chart with formulas
6. **Phase 1.6** - Threshold lines & color coding

### Phase 2: Platform Leverage (Differentiators)
7. **Phase 2.1** - Log stream widget (leverages all-in-one platform + QueryPlugin)
8. **Phase 2.2** - Trace list widget (leverages all-in-one platform + QueryPlugin)
9. **Phase 2.3** - Click-to-correlate (major differentiator — no competitor has this built-in)
10. **Phase 2.4** - Annotations / event overlays
11. **Phase 2.5** - Alert integration

### Phase 3: Collaboration
12. **Phase 3.1** - Public/shared dashboards
13. **Phase 3.2** - JSON import/export with Perses & Grafana compatibility
14. **Phase 3.4** - Row/section grouping with decoupled layout
15. **Phase 3.5** - TV/Kiosk mode
16. **Phase 3.3** - Dashboard versioning
17. **Phase 2.6** - SLO widget (depends on SLO/SLI from Metrics roadmap)

### Phase 4: Differentiation
18. **Phase 4.2** - Pre-built dashboard templates
19. **Phase 4.3** - Auto-generated dashboards
20. **Phase 4.1** - AI-powered dashboard creation
21. **Phase 4.4** - Customer-facing dashboards on status pages
22. **Phase 4.5** - Dashboard-as-code SDK (Perses-compatible)
23. **Phase 4.7** - Terraform / OpenTofu provider
24. **Phase 4.6** - Anomaly detection overlays

## Verification

For each feature:
1. Unit tests for new widget types, template variable resolution, CSV export logic, QueryPlugin dispatching
2. Integration tests for new API endpoints (annotations, public dashboards, import/export, Perses/Grafana conversion)
3. Manual verification via the dev server at `https://oneuptimedev.genosyn.com/dashboard/{projectId}/dashboards`
4. Visual regression testing for new chart types (ensure correct rendering across browsers)
5. Performance testing: verify dashboards with 20+ widgets and auto-refresh don't cause excessive API load
6. Test template variables with edge cases: empty results, special characters, multi-value selections
7. Verify public dashboards don't leak private data
8. Test Perses/Grafana import with real-world dashboard exports to validate conversion fidelity
9. Test QueryPlugin interface with mixed query types (metric + log + trace) on a single dashboard
