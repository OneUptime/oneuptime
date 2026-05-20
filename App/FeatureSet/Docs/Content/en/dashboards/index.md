# Dashboards Overview

Dashboards are how you turn the telemetry OneUptime is already collecting — metrics, logs, traces, incidents, monitors, Kubernetes and Docker resources — into a single page someone can glance at and understand the health of a system.

Drop a chart for request latency next to a list of open incidents next to a gauge for CPU utilization next to a status sentence in plain English. Save it. Share the link.

## At a glance

- **Top-level feature** in the OneUptime dashboard under **Dashboards**.
- **Grid-based canvas** — 12 units wide by 60 units tall by default. Drag widgets in, resize them, snap to the grid.
- **20+ widget types** — charts, single values, gauges, tables, text blocks, log streams, trace lists, and live resource lists for incidents, alerts, monitors, Kubernetes (pods, nodes, deployments, …), Docker, and hosts.
- **Variables and filters** — turn a single dashboard into a templated view that re-uses for every cluster, service, customer, or environment.
- **Public sharing** — flip a switch and the dashboard is reachable on a public URL, with optional password protection and IP allowlisting.
- **Custom domains** — host a public dashboard on `status.your-domain.com` instead of OneUptime's.

## Why use dashboards?

Dashboards earn their keep when one of these is true:

- **You need an "is everything OK?" page** for an oncall rotation, a team standup, or a CEO who walks past the wall TV.
- **You need to correlate signals** — a CPU spike at the same minute as a trace latency increase and an open incident is far more obvious on one dashboard than across three tabs.
- **You're investigating** — a freeform dashboard you build during a debugging session is faster than running ten queries by hand.
- **You're publishing externally** — a customer-facing performance dashboard, a partner-facing rollup, a public health board for an open-source service.

## Key concepts

| Term | Meaning |
| --- | --- |
| **Dashboard** | The canvas. A named, reusable view that contains a list of widgets, a time range control, and a set of variables. |
| **Widget** | One component on the canvas — a chart, a value, a table, a text block, a list. Each has a type and a JSON-style configuration. |
| **Dashboard unit** | The grid square. Widgets are sized in dashboard units (e.g., "4 wide × 6 tall"). Units convert to pixels based on the viewport. |
| **Variable** | A named value that the viewer picks from a dropdown (or types) and the dashboard injects into every widget's query. Cluster, service, customer, environment — anything you'd filter on. |
| **Time range** | The window of time every widget queries against. Choose a preset ("past 24 hours") or a custom range. |
| **Refresh interval** | How often widgets re-query in **View** mode. Off, 5s, 10s, 30s, 1m, 5m, 15m. |
| **Mode** | `Edit` (drag, resize, configure) or `View` (read-only). The two share the same canvas. |

## The widget catalog

A non-exhaustive map of what you can put on a dashboard:

| Category | Widgets |
| --- | --- |
| **Time series** | Chart |
| **Single number** | Value, Gauge |
| **Tabular** | Table |
| **Annotation** | Text |
| **Logs & traces** | LogStream, TraceList |
| **Operational lists** | IncidentList, AlertList, MonitorList |
| **Kubernetes** | KubernetesPodList, KubernetesNodeList, KubernetesNamespaceList, KubernetesDeploymentList, KubernetesStatefulSetList, KubernetesDaemonSetList, KubernetesJobList, KubernetesCronJobList |
| **Docker** | DockerHostList, DockerContainerList, DockerImageList, DockerNetworkList, DockerVolumeList |
| **Infrastructure** | HostList |

For each one's arguments and when to reach for it, see [Widgets](/docs/dashboards/widgets).

## Where dashboards live in the dashboard

| Page | What you do there |
| --- | --- |
| **Dashboards** | Browse, create, search, label dashboards. |
| **A dashboard → View** | The canvas — Edit mode for authors, View mode for everyone else. Toggle between them in the header. |
| **A dashboard → Overview** | Description, ownership, labels. |
| **A dashboard → Settings** | Public sharing, master password, IP allowlist, custom domains, branding (page title, description, logo, favicon). |
| **A dashboard → Owners** | Users and teams with explicit ownership. |
| **A dashboard → Delete** | Remove the dashboard (irreversible). |

## The lifecycle of a dashboard

1. **Create** — Under **Dashboards → Create Dashboard**, give it a name. The canvas opens empty.
2. **Drop widgets** — From the widget palette, pick a type, configure its source (a metric query, a list filter, a free text body). Position and resize.
3. **(Optional) Add variables** — Define a dropdown like `cluster` or `service` so the same dashboard renders for each value.
4. **Set the time range and refresh interval** — Defaults work fine; tune them later.
5. **(Optional) Share publicly** — Under **Settings**, flip **Public Dashboard** on. Add a master password if you want a gate, or restrict by IP.
6. **(Optional) Custom domain** — Add a `dashboard.your-domain.com` record and verify DNS, then serve the dashboard on your own URL.

## A worked example

Goal: an oncall page for the checkout service with latency, error rate, open incidents, and a recent log tail.

1. Create a dashboard "Checkout oncall."
2. Add a `service` variable of type **Telemetry Attribute** bound to the attribute key `service.name`. Default value `checkout`.
3. Add a **Chart** widget: P95 latency from your APM metric, filtered by `service.name = {{service}}`. Time range follows the dashboard.
4. Next to it, add a **Value** widget: error rate percentage with a warning threshold at 1% and a critical threshold at 5%.
5. Below, add an **IncidentList** widget filtered by labels that include `checkout`.
6. Below that, a **LogStream** widget filtered by `service.name = {{service}}`.
7. Save. Change the variable dropdown to `payments` — the entire dashboard re-renders for the payments service. Same template, different filter.

## How dashboards fit with the rest of OneUptime

- **Monitors and telemetry** feed dashboards with raw data — every metric you've configured, every log line you've ingested, every trace span is queryable on a widget.
- **Incidents and alerts** show up in **IncidentList** and **AlertList** widgets — dashboards are read-only views over them; create/edit those entities elsewhere.
- **Status pages** are a customer-facing communication tool ("is the system up right now?"). Dashboards are an analytical tool ("how is the system behaving in detail?"). The two are complementary, not substitutes.
- **Workflows** are the write side of OneUptime — dashboards are the read side.

## Where to read next

- [Authoring a Dashboard](/docs/dashboards/authoring) — using the canvas, the grid, edit vs view mode.
- [Widgets](/docs/dashboards/widgets) — the catalog and per-widget configuration.
- [Variables & Filters](/docs/dashboards/variables) — templating a dashboard so it works for many services / customers / clusters.
- [Sharing & Public Dashboards](/docs/dashboards/sharing) — public URLs, master password, IP allowlist, custom domains.
- [Configuration & Permissions](/docs/dashboards/configuration) — ownership, labels, retention, role-based access.
