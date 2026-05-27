# Dashboards Overview

Dashboards turn the data OneUptime is already collecting — metrics, logs, traces, incidents, monitors, Kubernetes resources, hosts — into a single page someone can glance at and understand what's going on.

Put a chart for request latency next to a list of open incidents, next to a gauge for CPU, next to a paragraph of context. Save it. Share the link.

## What dashboards are good for

- **An "is everything OK?" page** — for on-call, a team standup, or a wall-mounted TV.
- **Spotting connections** — a CPU spike at the same time as a latency increase and an open incident is much easier to see on one page than across three tabs.
- **Investigating** — when you're debugging, a dashboard you build on the fly beats running ten queries one at a time.
- **Sharing externally** — a customer-facing performance page, a partner status page, a public dashboard for an open-source project.

## What you can put on a dashboard

- **Charts** for trends over time — latency, errors, throughput.
- **Single-value tiles and gauges** — current error rate, CPU, open incidents.
- **Tables** for breakdowns — top 10 noisiest hosts, error count per service.
- **Text blocks** for headings, context, and links to runbooks.
- **Live lists** of incidents, alerts, monitors, logs, traces, Kubernetes resources, Docker resources, and hosts.

See [Widgets](/docs/dashboards/widgets) for the full list and what each one shows.

## Key terms

| Term | What it means |
| --- | --- |
| **Dashboard** | The whole page — a name, a grid of widgets, time range controls, and a list of variables. |
| **Widget** | One tile on the page — a chart, a number, a list, a paragraph. |
| **Variable** | A dropdown at the top that filters every widget at once (cluster, service, customer, environment). |
| **Time range** | The window of time every chart and number uses. Set it once at the top of the page. |
| **Refresh** | How often widgets re-query the data. Off, every few seconds, every few minutes. |
| **Mode** | Either **Edit** (drag widgets around) or **View** (read-only, the way visitors see it). |

## Where to find dashboards

Open **Dashboards** in the left navigation.

| Page | What you do there |
| --- | --- |
| **Dashboards** | Your list of dashboards. Create a new one, search, or filter by label. |
| **Dashboard → View** | The canvas. Toggle between **Edit** and **View** in the header. |
| **Dashboard → Overview** | Description, owners, and labels. |
| **Dashboard → Settings** | Public sharing, password, IP allowlist, custom domain, branding. |
| **Dashboard → Owners** | Users and teams with explicit access. |
| **Dashboard → Delete** | Remove the dashboard. |

## Building a dashboard

1. **Create** — pick a name. The canvas opens empty.
2. **Add widgets** — choose a widget type, configure its data, drag it where you want.
3. **(Optional) Add variables** — for example, a `service` dropdown so the same dashboard works for every service.
4. **Set the time range** — defaults are fine; tune later.
5. **(Optional) Share publicly** — flip the switch in Settings, add a password or IP allowlist if needed.
6. **(Optional) Custom domain** — host the dashboard on `status.your-domain.com`.

## A quick example

Goal: an on-call page for the checkout service with latency, error rate, open incidents, and a live log tail.

1. Create a dashboard called "Checkout on-call."
2. Add a `service` variable. Default it to `checkout`.
3. Add a **Chart** widget with P95 latency, filtered by the `service` variable.
4. Next to it, add a **Value** widget for error rate, with warning at 1% and critical at 5%.
5. Below, add an **Incident List** widget for incidents tagged `checkout`.
6. Below that, a **Log Stream** widget showing logs from the same service.
7. Save. Switch the dropdown to `payments` — the same dashboard now shows the payments service.

## How dashboards fit with the rest of OneUptime

- **Monitors and telemetry** are the sources of data. Every metric, log, and trace you collect is queryable on a widget.
- **Incidents and alerts** show up in **Incident List** and **Alert List** widgets. Dashboards are read-only for these — create and update them elsewhere.
- **Status pages** are customer-facing communication ("is the system up?"). Dashboards are for looking at how the system is behaving in detail. The two work together, they don't replace each other.
- **Workflows** are how OneUptime takes action. Dashboards are how you read what's happening.

## Where to read next

- [Authoring a Dashboard](/docs/dashboards/authoring) — using the canvas, editing widgets.
- [Widgets](/docs/dashboards/widgets) — the full list of widgets.
- [Variables & Filters](/docs/dashboards/variables) — making a dashboard work for many services or customers.
- [Sharing & Public Dashboards](/docs/dashboards/sharing) — public URLs, passwords, IP allowlist, custom domains.
- [Configuration & Permissions](/docs/dashboards/configuration) — owners, labels, access control.
