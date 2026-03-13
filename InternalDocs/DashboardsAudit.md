# Dashboards Audit: OneUptime vs. Grafana, Datadog & New Relic

**Date:** 2026-03-13
**Purpose:** Identify gaps in OneUptime's dashboard implementation compared to industry leaders and define a roadmap to build a best-in-class dashboards product.

---

## 1. Current OneUptime Dashboard Implementation

### 1.1 Data Model

- **Database Model:** `Dashboard` (PostgreSQL) with CRUD API at `/dashboard`
- **Key fields:** `projectId`, `name`, `slug`, `description`, `labels`, `dashboardViewConfig` (JSON blob)
- **Permissions:** Role-based (ProjectOwner, ProjectAdmin, ProjectMember) plus custom permissions (CreateDashboard, ReadDashboard, EditDashboard, DeleteDashboard)
- **Config storage:** Entire dashboard layout + component config stored as a single JSON column (`dashboardViewConfig`)

### 1.2 Layout System

- **Grid:** Fixed 12-column grid, default 60 rows (expandable)
- **Unit spacing:** 10px between units, 5px margin per unit
- **Responsive:** Unit pixel size calculated dynamically from viewport width; height units = width units (square)
- **Drag-and-drop:** Components can be moved and resized
- **Bounds checking:** Components constrained within dashboard boundaries
- **No rows/sections/tabs:** Components are placed freely on the grid with no grouping mechanism

### 1.3 Supported Widget Types

| Widget | Data Source | Visualization | Default Size | Min Size |
|--------|-----------|---------------|-------------|---------|
| **Chart** | Metric query | Line or Bar chart | 6x3 | 6x3 |
| **Value** | Single metric aggregation | Large number display | 3x1 | 1x1 |
| **Text** | Static | Bold/Italic/Underline text | 6x1 | 3x1 |

**Total: 3 widget types**

### 1.4 Chart Component Details

- Supports **Line** and **Bar** chart types only
- Single metric query config per chart
- Configurable: title, description, legend text, legend unit
- Data fetched via `MetricQueryConfigData` with filtering and group-by support
- Aggregation types: Avg, Sum, Min, Max, etc.

### 1.5 Time Range Support

- Global time range applied to all metric components
- Preset ranges: 30min, 1h, 2h, 3h, 1d, 2d, 1w, 2w, 1mo, 3mo
- Custom date range picker supported

### 1.6 Dashboard Modes

- **View mode:** Read-only, time range selection, full screen
- **Edit mode:** Add/move/resize/configure/delete components, side panel for component settings
- **Toolbar:** Mode toggle, add component buttons, save/cancel, full screen

### 1.7 Data Sources

- **Metrics only** - dashboards can only query OpenTelemetry metrics stored in ClickHouse
- No log panels, trace panels, or other telemetry data visualization
- No external data source support

### 1.8 Persistence & API

- Save serializes entire `dashboardViewConfig` JSON via `ModelAPI.updateById()`
- Load deserializes JSON via `ModelAPI.getItem()`
- Standard CRUD REST API (auto-generated from model annotations)
- No dashboard versioning or history

---

## 2. Competitor Feature Comparison

### 2.1 Widget / Visualization Types

| Widget Type | OneUptime | Grafana | Datadog | New Relic |
|------------|----------|---------|---------|-----------|
| Line Chart | Yes | Yes | Yes | Yes |
| Bar Chart | Yes | Yes | Yes | Yes |
| Area Chart | No | Yes | Yes | Yes |
| Pie Chart | No | Yes | Yes | Yes |
| Scatter Plot | No | Yes | Yes | Yes |
| Heatmap | No | Yes | Yes | Yes |
| Histogram | No | Yes | Yes (Distribution) | Yes |
| Gauge | No | Yes | Via Query Value | No |
| Single Value / Stat | Yes | Yes (Stat w/ sparkline) | Yes (Query Value) | Yes (Billboard) |
| Table | No | Yes | Yes | Yes |
| Text / Markdown | Partial (no markdown) | Yes (full markdown) | Yes (Notes/Free Text) | Yes (Markdown) |
| Logs Panel | No | Yes | Yes (List widget) | Yes (via NRQL) |
| Traces Panel | No | Yes (Tempo) | Yes (APM/Topology) | Yes |
| Geomap / Map | No | Yes | Yes | Via plugin |
| Topology / Service Map | No | Yes (Node Graph) | Yes | Yes |
| SLO Widget | No | Yes | Yes | Via NRQL |
| Funnel | No | Via plugin | Yes | Yes |
| Sankey | No | No | Yes | No |
| Treemap | No | No | Yes | No |
| Flame Graph / Profiling | No | Yes (Pyroscope) | Yes | No |
| State Timeline | No | Yes | No | No |
| Candlestick | No | Yes | No | No |
| Alert Status | No | Yes | Yes | No |
| Image / Iframe | No | No | Yes | No |
| Traffic Light | No | No | No | Yes |
| APDEX | No | No | No | Yes |
| Dashboard List | No | Yes | No | No |

**OneUptime: 3 widget types vs Grafana: 20+, Datadog: 40+, New Relic: 15+**

### 2.2 Layout & Organization

| Feature | OneUptime | Grafana | Datadog | New Relic |
|---------|----------|---------|---------|-----------|
| Grid layout | Yes (12-col) | Yes | Yes | Yes |
| Drag-and-drop | Yes | Yes | Yes | Yes |
| Resize | Yes | Yes | Yes | Yes |
| Row grouping | No | Yes (collapsible rows) | Yes (Groups) | No |
| Tabs / Pages | No | Yes (Grafana 12) | No | Yes (multi-page) |
| Conditional rendering | No | Yes (Grafana 12) | No | No |
| Reusable widget templates | No | No | Yes (Powerpacks) | No |
| Dashboard outline / nav | No | Yes (tree-view nav) | No | No |

### 2.3 Variables & Templating

| Feature | OneUptime | Grafana | Datadog | New Relic |
|---------|----------|---------|---------|-----------|
| Template variables | No | Yes (6+ types) | Yes | Yes (3 types) |
| Query-based variables | No | Yes | Yes | Yes |
| Cascading / chained variables | No | Yes | No | No |
| Multi-value selection | No | Yes | No | Yes |
| Ad hoc filters | No | Yes | Yes | No |
| Variables in titles | No | Yes | Yes | Yes |

### 2.4 Interactivity & Navigation

| Feature | OneUptime | Grafana | Datadog | New Relic |
|---------|----------|---------|---------|-----------|
| Click-to-drill-down | No | Yes (data links) | Yes | Yes (facet linking) |
| Cross-dashboard linking | No | Yes | Yes | Yes |
| Annotations / event overlays | No | Yes | Yes | Yes (Labs) |
| Tooltip with details | Basic | Rich | Rich | Rich |
| Zoom on chart (time selection) | No | Yes | Yes | Yes |
| Legend toggle (show/hide series) | No | Yes | Yes | Yes |
| Auto-refresh intervals | No | Yes (configurable) | Yes (real-time) | Yes |

### 2.5 Alerting Integration

| Feature | OneUptime | Grafana | Datadog | New Relic |
|---------|----------|---------|---------|-----------|
| Create alert from panel | No | Yes | Yes | Yes (NRQL alerts) |
| Show alert state on panel | No | Yes | Yes | No |
| Alert threshold lines | No | Yes | Yes | Yes (Billboard) |
| Alert status widget | No | Yes | Yes | No |

### 2.6 Sharing & Collaboration

| Feature | OneUptime | Grafana | Datadog | New Relic |
|---------|----------|---------|---------|-----------|
| Share via URL | Basic | Yes | Yes | Yes |
| Public dashboards (no login) | No | Yes | Yes | Yes |
| Embed via iframe | No | Yes | Yes | No |
| Snapshot sharing | No | Yes | No | No |
| PDF export | No | Yes (Enterprise) | No | No |
| CSV export (table data) | No | Yes | Yes | Yes |
| Scheduled email reports | No | No | Yes | Yes |

### 2.7 Dashboard-as-Code & API

| Feature | OneUptime | Grafana | Datadog | New Relic |
|---------|----------|---------|---------|-----------|
| JSON import/export | No | Yes | Yes | Yes |
| Terraform provider | No | Yes | Yes | Yes |
| SDK for dashboard creation | No | Yes (Foundation SDK) | No | No |
| Dashboard versioning / history | No | Yes | Yes | No |
| Git-based provisioning | No | Yes | No | No |
| Full CRUD API | Yes (basic) | Yes | Yes | Yes (GraphQL) |

### 2.8 Presentation & Theming

| Feature | OneUptime | Grafana | Datadog | New Relic |
|---------|----------|---------|---------|-----------|
| Dark mode | No | Yes | Yes | Yes |
| TV / Kiosk mode | Full screen only | Yes (kiosk mode) | Yes | Yes (auto-cycling) |
| Mobile app support | No | Yes | Yes | Yes |
| Custom color schemes per panel | No | Yes | Yes | Yes |
| Threshold-based color coding | No | Yes | Yes | Yes (Billboard) |

### 2.9 Data Sources

| Feature | OneUptime | Grafana | Datadog | New Relic |
|---------|----------|---------|---------|-----------|
| Metrics | Yes | Yes (multi-source) | Yes | Yes (NRQL) |
| Logs | No | Yes (Loki) | Yes | Yes |
| Traces | No | Yes (Tempo) | Yes | Yes |
| External data sources | No | Yes (100+ plugins) | Integrations | Limited |
| Multiple data sources per dashboard | No | Yes | Yes | Yes |
| Query language | Config-based | PromQL/LogQL/etc. | Custom | NRQL (SQL-like) |

---

## 3. Gap Analysis: Critical Missing Features

### 3.1 Priority 1 - Essential (Must Have to be Competitive)

These gaps make OneUptime dashboards fundamentally non-competitive:

1. **More Chart Types** - Need at minimum: Area, Pie, Table, Gauge, Heatmap, Histogram. Currently only Line and Bar is far too limited for any real use case.

2. **Template Variables** - Every competitor has this. Drop-down selectors that dynamically filter all widgets on a dashboard. Without this, users must create separate dashboards for each service/host/environment.

3. **Log and Trace Panels** - Dashboards should be able to display log streams and trace data, not just metrics. This is table-stakes for an observability platform.

4. **Table Widget** - Essential for displaying tabular metric data, top-N lists, log entries, etc.

5. **Auto-Refresh** - Dashboards should auto-refresh at configurable intervals (5s, 10s, 30s, 1m, 5m, etc.). Currently data goes stale.

6. **Threshold Lines & Color Coding** - Ability to set warning/critical thresholds on charts with color-coded regions. Critical for at-a-glance monitoring.

7. **Multiple Queries per Chart** - Overlay multiple metric series on a single chart for correlation. Currently limited to single metric query config.

8. **Legend Interaction** - Click legend items to show/hide series. Standard in all competitors.

9. **Full Markdown Support** - Text widget should support full markdown rendering, not just bold/italic/underline.

10. **Chart Zoom** - Click-and-drag on a time series chart to zoom into a time range.

### 3.2 Priority 2 - Important (Needed to Match Competitors)

These are expected by users migrating from other platforms:

11. **Dashboard Linking / Drill-down** - Click a chart element to navigate to another dashboard or filtered view.

12. **Annotations / Event Overlays** - Show deployment events, incidents, or alerts as vertical markers on time series charts.

13. **Row/Section Grouping** - Group related panels into collapsible rows or sections.

14. **Public / Shared Dashboards** - Share dashboards with external stakeholders without requiring login.

15. **JSON Import/Export** - Allow dashboards to be exported as JSON and re-imported. Essential for backup, migration, and dashboard-as-code workflows.

16. **Dashboard Versioning** - Track changes to dashboards over time with the ability to revert.

17. **Alert Integration** - Create alerts from dashboard panels and display alert state on panels.

18. **TV / Kiosk Mode** - Full-screen dashboard display optimized for wall-mounted monitors with auto-cycling between dashboards.

19. **CSV Export** - Export table/chart data as CSV for offline analysis.

20. **Custom Time Ranges per Widget** - Allow individual widgets to have their own time range override.

### 3.3 Priority 3 - Differentiation (Nice to Have)

Features that would differentiate OneUptime:

21. **Multi-Page Dashboards** - Organize complex dashboards into multiple pages/tabs.

22. **SLO/SLI Widget** - Dedicated widget showing SLO status, error budget burn rate, and remaining budget.

23. **Geomap Widget** - Display data on a world map for geographic distribution visualization.

24. **Funnel Widget** - Visualize conversion funnels.

25. **Service Map Widget** - Display service dependency topology.

26. **Terraform Provider for Dashboards** - Dashboard-as-code via Terraform.

27. **Scheduled Reports** - Email dashboard screenshots/PDFs on a schedule.

28. **Mobile App Dashboard View** - View dashboards on mobile devices.

---

## 4. Recommendations to Surpass Competition

Beyond closing gaps, here are opportunities to build a **better** dashboard product:

### 4.1 AI-Powered Dashboards

No competitor does this well yet. OneUptime could lead with:

- **Natural Language Dashboard Creation** - "Show me CPU usage by service for the last 24 hours" auto-creates the right widget with the right query.
- **Anomaly Detection Overlays** - AI automatically highlights anomalous data points on charts without manual threshold configuration.
- **Smart Dashboard Suggestions** - Based on the services and telemetry data a user has, auto-suggest relevant dashboards. ("You're sending Node.js metrics, here's a recommended Node.js dashboard.")
- **AI-Powered Root Cause Analysis** - Click on a spike in a chart and AI explains what likely caused it by correlating across metrics, logs, and traces.

### 4.2 Correlated Observability Panels

OneUptime has metrics, logs, and traces in one platform. Use this advantage:

- **Unified Time Selection** - Select a time range on any chart and have all panels (metrics, logs, traces) automatically filter to that window.
- **Click-to-Correlate** - Click a point on a metric chart to instantly see related logs and traces from that exact timestamp.
- **Split View** - Side-by-side metrics + logs + traces panels that stay synchronized.
- **Automatic Context Propagation** - When drilling into a metric spike, automatically show relevant log errors and slow traces.

### 4.3 Collaborative Dashboards

- **Real-time Collaborative Editing** - Multiple users editing the same dashboard simultaneously (like Google Docs). No competitor offers this on dashboards.
- **Comments on Widgets** - Leave comments on specific widgets for team communication.
- **Dashboard Annotations** - Team members can annotate specific time periods with notes about incidents, deployments, or investigations.

### 4.4 Pre-Built Dashboard Templates

- **One-Click Dashboard Templates** - Pre-built dashboards for common stacks: Node.js, Python, Go, Java, Kubernetes, PostgreSQL, Redis, Nginx, etc.
- **Community Dashboard Library** - Let users share and install dashboards created by others.
- **Auto-Generated Dashboards** - When a user connects a service, auto-generate a relevant dashboard based on the telemetry data being sent.

### 4.5 Advanced Query Builder

- **Visual Query Builder** - Drag-and-drop query construction without writing query syntax. Competitors require PromQL/NRQL knowledge.
- **Query Suggestions** - Auto-suggest metrics, filters, and aggregations based on available data.
- **Query History** - Save and reuse previous queries.

### 4.6 Status Dashboards for External Stakeholders

Unique to OneUptime as a status page platform:

- **Embedded Status Widgets** - Dashboard widgets that show status page component health.
- **Customer-Facing Dashboards** - Create dashboards visible on status pages showing real-time performance metrics to end users.
- **SLA Compliance Dashboard** - Pre-built dashboard showing SLA compliance across all monitored services.

### 4.7 Developer Experience

- **Dashboard-as-Code SDK** - TypeScript/Python SDK to define dashboards programmatically.
- **Git-Based Dashboard Provisioning** - Store dashboard definitions in Git and auto-sync.
- **Dashboard CLI** - Create, update, and manage dashboards from the command line.
- **Dashboard API with OpenAPI Spec** - Well-documented API for dashboard automation.

---

## 5. Suggested Implementation Roadmap

### Phase 1: Foundation (Close Critical Gaps)
- Add chart types: Area, Pie, Table, Gauge
- Add template variables (query-based, custom list)
- Add auto-refresh with configurable intervals
- Add multiple queries per chart
- Full markdown support for text widget
- Threshold lines and color coding on charts
- Legend show/hide interaction
- Chart zoom (click-drag time selection)

### Phase 2: Observability Integration
- Add Log stream widget
- Add Trace list widget
- Click-to-correlate between metric, log, and trace panels
- Annotations / event overlays on charts
- Alert integration (create from panel, show alert state)
- SLO/SLI widget

### Phase 3: Collaboration & Sharing
- Public/shared dashboards (no login required)
- JSON import/export
- Dashboard versioning with history
- Row/section grouping with collapsible sections
- TV/Kiosk mode with auto-cycling
- CSV export from table/chart widgets
- Dashboard linking and drill-down

### Phase 4: Differentiation
- AI-powered dashboard creation from natural language
- Pre-built dashboard template library
- Auto-generated dashboards from telemetry data
- Visual query builder
- Dashboard-as-code SDK (TypeScript)
- Customer-facing dashboards on status pages
- Anomaly detection overlays

---

## 6. Summary

OneUptime's current dashboard implementation provides basic functionality with a 12-column grid layout, drag-and-drop editing, and 3 widget types (Line/Bar chart, single value, text). While the foundation is solid, it is significantly behind competitors in every dimension:

| Dimension | OneUptime | Industry Standard |
|-----------|----------|------------------|
| Widget types | 3 | 15-40+ |
| Chart types | 2 (Line, Bar) | 10+ |
| Data sources | Metrics only | Metrics + Logs + Traces + External |
| Template variables | None | Essential feature |
| Auto-refresh | None | Standard |
| Dashboard-as-code | None | JSON/Terraform/SDK |
| Sharing | Basic URL | Public, embed, PDF, email |
| Alerting integration | None | Create from panel, show state |

The biggest opportunity lies in OneUptime's unique position as an all-in-one observability + status page platform. By deeply integrating metrics, logs, traces, alerts, and status pages into the dashboard experience with AI-powered features, OneUptime can offer a unified experience that fragmented tools like Grafana cannot match.
