# Authoring a Dashboard

Create a dashboard under **Dashboards → Create Dashboard**, give it a name, and open it. The canvas opens in **Edit** mode, ready for widgets.

## The canvas

A dashboard is a grid. The default canvas is **12 dashboard units wide** by **60 units tall** — you can grow the height by adding rows past the bottom. Each unit is a square that scales with the viewport: on a desktop it's wider than on a phone, but every widget keeps its proportions.

Widgets occupy a rectangle of units. You decide both the position (top-left corner, measured in units from the top-left of the canvas) and the size (width and height in units). Minimum dimensions enforce that a tiny widget is still readable.

## Edit vs. View

The toggle in the page header switches between the two modes:

- **Edit** — the widget palette is open, widgets are draggable and resizable, every widget has a settings cog. Use this while building.
- **View** — the dashboard renders read-only, exactly as someone with view-only access (or a public visitor) sees it. Use this to check the result before sharing.

The same dashboard is shown in both modes — there's no separate "publish" step. Saving an edit takes effect immediately for every viewer.

## Adding a widget

1. Open the widget palette (the **+** button in Edit mode).
2. Pick the widget type. See [Widgets](/docs/dashboards/widgets) for the catalog.
3. The widget lands on the canvas at the next free position with a default size.
4. Click the widget's cog to open its settings panel.
5. Configure the data source (metric query, list filter, text body, etc.) and any display options (thresholds, units, axes, columns).
6. Drag the widget to position it. Drag a corner to resize.

Repeat. The grid snaps widgets to whole-unit boundaries.

## Configuring data sources

Most widgets read from one of three places:

- **Metrics** — a ClickHouse-backed metric query. The widget builds a `metricQueryConfig` (a single series) or `metricQueryConfigs` (multiple series stacked or overlaid). Optional `transformAsRate` converts an OpenTelemetry cumulative counter into a rate of change. Optional `formula` lets you combine two queries (e.g., error count / total count).
- **Live resource lists** — incidents, alerts, monitors, Kubernetes resources, Docker resources, hosts. Each list widget takes a filter (e.g., labels, status, namespace) and displays the matching rows live.
- **Static content** — the **Text** widget takes a Markdown body. Use it for headers, dividers, runbook links, and "what is this dashboard?" annotations.

For metric widgets, the configuration mirrors the inline query builder you see elsewhere in OneUptime — pick a metric, pick an aggregation, add `WHERE` filters, choose a time grouping. The query runs against your project's telemetry data.

## Thresholds and formatting

Widgets that display a single number (**Value**, **Gauge**) take optional thresholds:

- **Warning threshold** — render the value in yellow when it crosses this.
- **Critical threshold** — render the value in red when it crosses this.

Charts let you set the Y-axis unit, the legend position, and whether to stack series. Tables let you pick which columns to show and the row limit.

## Time range and refresh

The dashboard header carries two global controls that affect every metric widget:

- **Time range** — pick a preset (Past 1 hour, 24 hours, 7 days, 30 days) or a custom range. Every metric widget queries against this window.
- **Refresh interval** — Off, 5s, 10s, 30s, 1m, 5m, 15m. Re-runs every widget's query on the chosen cadence. List widgets that natively support websockets update on push regardless of the chosen interval.

For widgets that ignore the global time range (e.g., a text block), the control is a no-op.

## Saving

The canvas autosaves as you edit. A small indicator in the header tells you when the latest change is persisted. There is no "publish" — every edit is live the moment it saves. If you're making a risky change, duplicate the dashboard first.

## Patterns that work well

- **One topic per dashboard.** Resist the temptation to put "everything we monitor" on one page. Three dashboards labeled `oncall-checkout`, `oncall-payments`, `oncall-search` age better than one mega-dashboard.
- **Anchor the top of the page with the most important widget.** People scan from the top — make sure the first thing they see is the answer to "is this system healthy?"
- **Use Text widgets to label sections.** A short heading every few rows ("Latency" / "Errors" / "Capacity") makes the dashboard scannable from across the room.
- **Use variables instead of duplicating.** If you find yourself building the same dashboard twice for two services, you want a `service` variable. See [Variables & Filters](/docs/dashboards/variables).

## Where to read next

- [Widgets](/docs/dashboards/widgets) — the catalog and per-widget configuration.
- [Variables & Filters](/docs/dashboards/variables) — templating with variables, attribute filters, and time range.
- [Sharing & Public Dashboards](/docs/dashboards/sharing) — making a dashboard reachable outside the team.
- [Configuration & Permissions](/docs/dashboards/configuration) — ownership and access control.
