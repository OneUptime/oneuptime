# Variables & Filters

A variable turns a single dashboard into a template. Define a `service` variable and the same chart re-renders for `checkout`, `payments`, and `search` — pick from a dropdown at the top instead of building three near-identical dashboards.

This page covers the four variable types, how their values are injected into widget queries, and the global time range and refresh controls that sit next to them.

## Variable types

Add variables under **Dashboard → Settings → Variables**. Each has a name (referenced as `{{name}}` in widget queries), an optional label, and a type.

### Custom List

A static drop-down. You supply a comma-separated list of values; the viewer picks one.

Use it when: the set of choices is small, fixed, and meaningful only to your team. `environment` with values `prod, staging, dev`. `region` with values `us-east-1, eu-west-1, ap-south-1`.

### Query

The options for the drop-down are computed by a ClickHouse query at render time.

Use it when: the choices are dynamic and live in your telemetry. "Every customer ID that has logged in the past 24 hours" via `SELECT DISTINCT customer_id FROM ...`. The query runs against your project's data; treat the result as untrusted input even though it's your own data.

### Text Input

A free-text field. Whatever the viewer types is injected.

Use it when: you want the dashboard to act like a search tool. A "filter by IP" or "filter by request ID" dashboard.

### Telemetry Attribute

The options are the distinct values of an OpenTelemetry attribute key across your project's telemetry, over the dashboard's time range.

Configure the **attribute key** (e.g., `k8s.cluster.name`, `service.name`, `host.name`). The widget fetches distinct values from logs / metrics / traces and offers them as a drop-down.

Use it when: the choices are exactly the entities you've already tagged your telemetry with. Cluster name, service name, region, customer ID, deployment environment — anything you already send as an OpenTelemetry resource or span attribute.

This is the most common variable type for service-oriented dashboards because it auto-updates: when you ship a new service tagged `service.name = inventory`, that value shows up in the dropdown without anyone editing the dashboard.

## Multi-select

Each variable can be configured **multi-select**. When on, the viewer picks one or more values; the dashboard filters to `value IN (...)` instead of `value = ...`.

Use multi-select when: you want to look at "checkout + payments together" without leaving the dashboard. Avoid it when the chart math doesn't add up across selected values — e.g., averaging averages.

## Default values

Every variable takes an optional default. The dashboard renders with the default until the viewer changes the dropdown. For public dashboards, the default is what visitors land on.

## How interpolation works

Anywhere a widget query takes a string filter — a metric query's `WHERE` clause, a list widget's filter, a log stream's attribute match — you can reference `{{variable_name}}`.

For example, a Chart's metric query might be:

```
SELECT avg(latency_ms) FROM spans WHERE service.name = '{{service}}'
```

When `service` is set to `checkout`, the query runs with `service.name = 'checkout'`. When the viewer flips to `payments`, the query re-runs with `service.name = 'payments'`.

For **Telemetry Attribute** variables specifically, OneUptime knows the attribute key and injects the filter into every widget that mentions the same attribute — you don't have to hand-edit each widget's query when the variable changes. This is the magic that makes service-templated dashboards work out of the box.

## Time range

The dashboard header has a global **time range** picker. Every metric widget queries against this window. Choices:

- **Presets** — Past 1 hour, 24 hours, 7 days, 30 days, 90 days (depending on your retention).
- **Custom range** — pick start and end timestamps.

The time range is part of the dashboard's URL — sharing the URL shares the window. This is convenient during an incident: pin the time range to "10:00–10:30 UTC today" and share the link in the incident channel.

## Refresh interval

Next to the time range, choose how often widgets re-query:

- **Off** — widgets query once on load.
- **5s / 10s / 30s / 1m / 5m / 15m** — auto-refresh.

Auto-refresh is convenient for a wall-mounted screen and a current-incident view. For ad-hoc investigation, leave it off so the view stays stable while you scroll.

## Putting it together

A service-templated dashboard typically has:

1. A `service` variable of type **Telemetry Attribute** bound to `service.name`. Default: your most-watched service. Multi-select: off (so charts always show one service at a time).
2. An `environment` variable of type **Custom List**. Default: `prod`.
3. A `cluster` variable of type **Telemetry Attribute** bound to `k8s.cluster.name`. Multi-select: on (so you can roll up across clusters).
4. The dashboard's widgets reference these variables in their filters.

The result: one dashboard, the entire fleet's coverage, a few drop-downs at the top.

## Where to read next

- [Widgets](/docs/dashboards/widgets) — how each widget consumes a filter.
- [Sharing & Public Dashboards](/docs/dashboards/sharing) — variables in URLs, including their values for shared links.
- [Authoring a Dashboard](/docs/dashboards/authoring) — the canvas mechanics.
