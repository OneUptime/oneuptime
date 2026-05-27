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
- **Live lists** — incidents, alerts, monitors, Kubernetes pods, Docker containers, hosts. Each list widget takes a filter and shows the matching items, updated live.
- **Static content** — the **Text** widget takes a block of Markdown. Use it for headings, context, links to runbooks, or temporary notes during an incident.

## Thresholds and formatting

Single-value widgets (**Value**, **Gauge**) let you set:

- A **warning threshold** — color turns yellow when the value crosses it.
- A **critical threshold** — color turns red when the value crosses it.

Charts let you set the Y-axis unit, choose where the legend goes, and pick whether series stack on top of each other or overlay. Tables let you pick the columns to show and how many rows.

## Time range and refresh

At the top of the dashboard, two controls affect every metric widget:

- **Time range** — a preset (past hour, 24 hours, 7 days, 30 days) or a custom range. Every chart and number uses this window.
- **Refresh** — how often widgets re-query. Off, 5s, 10s, 30s, 1m, 5m, 15m. Live lists update on their own regardless of this setting.

Widgets that don't use the time range (like a Text widget) ignore both controls.

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
