# Authoring a Dashboard

To create a dashboard, open **Dashboards → Create Dashboard**, give it a name, and open it. The canvas opens in **Edit** mode, ready for you to start adding widgets.

## The canvas

A dashboard is a grid. Widgets snap into place — you decide where each one sits and how big it is. You can grow the page down as you add more rows. Every widget keeps its proportions on bigger or smaller screens.

## Edit and View

The toggle in the header switches between two modes:

- **Edit** — the widget palette is open, you can drag widgets around, resize them, and click any widget to change its settings.
- **View** — the dashboard is read-only, exactly the way visitors and other team members see it. Use this to check the result before sharing.

It's the same dashboard in both modes. There's no separate "publish" step — every edit is live the moment it saves.

## Adding a widget

1. Click the **+** button to open the widget palette.
2. Pick the widget type. See [Widgets](/docs/dashboards/widgets) for the catalog.
3. The widget appears on the canvas.
4. Click the gear icon on the widget to open its settings.
5. Choose the data source (a metric, a list filter, a paragraph of text, etc.) and any display options.
6. Drag the widget to move it. Drag a corner to resize.

## Where data comes from

Most widgets read from one of three places:

- **Metrics** — pick a metric and an aggregation (average, max, count, percentile). Add filters. Choose how to group the result. This is the same query builder you see elsewhere in OneUptime.
- **Logs and traces** — chart log volume or trace performance over time, or show recent matching telemetry in a list. Telemetry widgets can be narrowed by service, severity, body text, and attributes.
- **Live lists** — incidents, alerts, monitors, Kubernetes pods, Docker containers, hosts. Each list widget takes a filter and shows the matching items, updated live.
- **Static content** — the **Text** widget takes a block of Markdown. Use it for headings, context, links to runbooks, or temporary notes during an incident.

## Thresholds and formatting

Single-value widgets (**Value**, **Gauge**) let you set:

- A **warning threshold** — color turns yellow when the value crosses it.
- A **critical threshold** — color turns red when the value crosses it.

Charts let you set the Y-axis unit, choose where the legend goes, and pick whether series stack on top of each other or overlay. Tables let you pick the columns to show and how many rows.

## Time range and refresh

At the top of the dashboard, two controls affect every time-based telemetry widget:

- **Time range** — a preset (past hour, 24 hours, 7 days, 30 days) or a custom range. Every metric, log, and trace chart uses this window.
- **Refresh** — how often widgets re-query. Off, 5s, 10s, 30s, 1m, 5m, 15m. Live lists update on their own regardless of this setting.

Widgets that don't use the time range (like a Text widget) ignore both controls.

### Zooming into a spike

You don't have to reach for the time-range picker to look at a spike. Drag
across the interesting stretch of any line or area chart and the **whole
dashboard** moves to that window — every other panel re-queries alongside it,
so you're reading one moment across the board instead of one chart at a
different scale from its neighbours.

**Double-click any chart** to undo it: the dashboard goes back to the range it
had before you started zooming, however many times you drilled in. A **Reset
zoom** button appears next to the time-range picker while a zoom is active, and
double-clicking a dashboard that isn't zoomed does nothing.

A zoomed window is a fixed one, so it stops rolling forward while auto-refresh
is on — that's deliberate, since a window that slid out from under you
mid-investigation would be worse. Reset the zoom to start rolling again.

Zooming works in View mode only; in Edit mode dragging moves and resizes
widgets instead. Bar charts can't originate a zoom (there's nothing to drag
across), but double-clicking one still resets the dashboard.

## Saving

The canvas saves on its own as you work. A small indicator in the header tells you when the latest change is saved. If you're making a big change, duplicate the dashboard first so you have a safe copy.

## Tips for dashboards that age well

- **One topic per dashboard.** Resist putting "everything we monitor" on one page. A few focused dashboards beat one giant page.
- **Put the most important widget at the top.** People scan from the top down — make the first thing they see the answer to "is this system healthy?"
- **Label sections with Text widgets.** A short heading every few rows ("Latency," "Errors," "Capacity") makes the page scannable from across the room.
- **Use variables instead of duplicating.** If you're about to build the same dashboard for a second service, build one dashboard with a `service` variable instead. See [Variables & Filters](/docs/dashboards/variables).

## Where to read next

- [Widgets](/docs/dashboards/widgets) — the catalog.
- [Variables & Filters](/docs/dashboards/variables) — variables, filters, and the time range.
- [Sharing & Public Dashboards](/docs/dashboards/sharing) — sharing outside your team.
- [Configuration & Permissions](/docs/dashboards/configuration) — owners and access control.
