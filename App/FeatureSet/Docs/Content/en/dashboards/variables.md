# Variables & Filters

A variable turns a single dashboard into a template. Add a `service` variable to your dashboard and the same charts re-render for `checkout`, `payments`, or `search` — viewers pick from a dropdown at the top instead of you building three near-identical dashboards.

## Variable types

Add variables under **Dashboard → Settings → Variables**. Each variable has a name (used as `{{name}}` in your widgets), an optional label, and a type.

### Custom List

A static dropdown. You type the options yourself.

Use it when: the choices are small and fixed. `environment` with values `prod, staging, dev`. `region` with values `us-east-1, eu-west-1, ap-south-1`.

### Query

Existing query variable definitions are preserved, but loading dropdown options from a custom query is not supported. Use **Telemetry Attribute** for choices discovered from telemetry, or **Project Labels** for monitor label choices.

### Text Input

A free-text field. Whatever the viewer types is used.

Use it when: you want the dashboard to act like a search tool. Filter by IP address, request ID, or any other free-form value.

### Telemetry Attribute

The options are the distinct values of an attribute in your telemetry over the dashboard's time range.

Configure the **attribute key** (for example, `service.name`, `host.name`, `k8s.cluster.name`). The dropdown fills with every distinct value seen in your logs, metrics, and traces.

Use it when: the choices match the tags you already send with your telemetry. This is the most common type because it updates automatically — when you ship a new service tagged `service.name = inventory`, that name appears in the dropdown without you editing the dashboard.

### Project Labels

Choose existing project labels to offer as a dashboard dropdown. For example, create a variable named `UNIT`, set its source to **Project Labels**, and choose the labels `0660` and `0661`.

The dashboard saves the chosen label IDs and display names. Filtering uses IDs, so renaming a project label does not break its binding. Display names are saved with the dashboard; reselect a renamed label in the variable editor to update its displayed name. Public dashboards show these same saved choices.

In a **Monitor List** widget, open **Filters → Label Variable** and select `UNIT`. Selecting `0660` now shows monitors carrying that label. Other widgets are unaffected unless they explicitly support and bind the variable.

Fixed widget filters remain in effect. For example, with a fixed `network` label and `UNIT` set to `0660`, a monitor must carry both labels. Multiple selected units match any selected unit. Choosing **All** removes only the variable condition, keeping fixed label, status, and monitor-type filters.

A missing variable or a selection outside its configured choices shows an error. A selected label with no matching monitors shows the empty list. Remove the widget binding explicitly when it is no longer needed.

## Multi-select

Custom List, Telemetry Attribute, and Project Labels variables can allow multiple selections. When on, the viewer can pick one or more values; the dashboard filters to any of them. An empty selection means **All**.

Use multi-select when: you want to compare "checkout and payments together" without leaving the dashboard. Avoid it when the math doesn't work across selected values (for example, averaging averages).

## Default values

Single-select variables can have a default. The dashboard renders with the default until the viewer changes it. Multi-select variables start on **All** and do not use a default. A shared URL's explicit selection takes precedence, including an explicit **All**.

## How to use a variable in a widget

Variable support depends on the widget and filter. Telemetry attribute variables bind to their configured attribute key; Monitor List label filters use the explicit **Label Variable** setting described above.

For example, a chart filtered by service:

```
service.name = '{{service}}'
```

When the dropdown is set to `checkout`, the chart filters to the checkout service. When the viewer switches to `payments`, the chart re-renders for payments.

For **Telemetry Attribute** variables, OneUptime knows which attribute the variable maps to and applies the filter to every widget that uses the same attribute — you don't have to edit each widget by hand.

Monitor List titles also support `{{variable_name}}`. For example, `{{UNIT}} NETWORK` displays `0660 NETWORK`, `0660, 0661 NETWORK`, or `All NETWORK`. A title controls displayed text; configure **Label Variable** to filter the monitor query.

## Time range

The dashboard header has a global time range. Every metric widget queries against this window. Options:

- **Presets** — past hour, 24 hours, 7 days, 30 days, 90 days (depending on your data retention).
- **Custom** — pick a start and end time.

The time range is part of the dashboard's URL — sharing the URL shares the window. Useful during an incident: pin the time range to "10:00–10:30 UTC today" and paste the link in the incident channel.

## Refresh interval

Next to the time range, pick how often widgets re-query:

- **Off** — widgets query once when the page loads.
- **5s / 10s / 30s / 1m / 5m / 15m** — auto-refresh.

Auto-refresh is good for a wall-mounted screen or a live incident view. Leave it off when you're investigating so the view stays still while you look.

## Putting it together

A service-templated dashboard typically has:

1. A `service` variable of type **Telemetry Attribute** for `service.name`. Default: your most-watched service. Multi-select off (so charts always show one at a time).
2. An `environment` variable of type **Custom List**. Default: `prod`.
3. A `cluster` variable of type **Telemetry Attribute** for `k8s.cluster.name`. Multi-select on (so you can compare across clusters).
4. Widgets that reference these variables in their filters.

The result: one dashboard, every service covered, three dropdowns at the top.

## Where to read next

- [Widgets](/docs/dashboards/widgets) — how each widget uses a filter.
- [Sharing & Public Dashboards](/docs/dashboards/sharing) — variables and shared links.
- [Authoring a Dashboard](/docs/dashboards/authoring) — the canvas mechanics.
