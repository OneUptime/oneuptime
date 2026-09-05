# Real User Monitoring

## What it is

Real User Monitoring (RUM) is what your **users** actually experienced, as opposed to what a probe or a synthetic check experienced. A browser or mobile app you own reports its own telemetry — page loads, route changes, fetches, errors, Core Web Vitals — and OneUptime groups it into a **RUM application** you can open, chart, search and alert on.

It is the same OpenTelemetry pipeline as the rest of OneUptime. There is no separate RUM agent and no proprietary wire format: you point an OpenTelemetry browser or mobile SDK at OneUptime, and the telemetry is classified as RUM on arrival.

Session Replay — watching a recording of what the user saw — is a separate, optional layer on top. It has its own script tag and its own privacy controls, documented in [Session Replay](/docs/telemetry/session-replay).

## Where it lives

In the dashboard, **Resources → Real User Monitoring**. Each application has its own Overview, Metrics, Logs, Traces, Clients, Session Replay, Replay Policy and Replay Access Log tabs. Project-wide settings (owner rules, label rules, the session replay master switch) live under the RUM side menu's **Settings** section.

## How OneUptime decides something is RUM

This is the part worth understanding, because it is where almost every "my app is not showing up" question ends.

Classification happens per telemetry batch, from **resource attributes**, at ingest:

1. If the resource carries any of `browser.platform`, `browser.language` or a non-empty `browser.brands`, the batch is **browser** RUM.
2. Otherwise, if it carries any of `device.id`, `device.model.identifier` or `device.manufacturer`, it is **mobile** RUM.
3. Otherwise it is not RUM at all — it is treated as a backend Service.

Backend services never set `browser.*` or `device.*`, which is what makes this a clean signal rather than a heuristic.

Once a batch is classified as RUM, the application's identity is its **`service.name`**. OneUptime looks for a RUM application in the project with that identifier (case-insensitively) and creates one if there is none. Client telemetry is owned entirely by its RUM application — it is never also listed as a backend Service, so nothing is double-counted.

| Attribute | Required | What it does |
| --- | --- | --- |
| `service.name` | **yes** | The application's identity, e.g. `storefront-web`. No `service.name`, no RUM application. |
| `browser.platform` / `browser.language` / `browser.brands` | for web | Marks the batch as browser RUM. |
| `device.id` / `device.model.identifier` / `device.manufacturer` | for mobile | Marks the batch as mobile RUM. |
| `telemetry.sdk.language` | no | Shown on the overview, e.g. `webjs`, `swift`. |
| `telemetry.sdk.version` | no | Shown as the SDK version. `oneuptime.agent.version` is used if this is absent. |
| `oneuptime.label.<name>` | no | Promoted to a project label `<name>:<value>` on the application. See [Managing Applications](/docs/rum/applications). |

> **The single most common mistake.** The OpenTelemetry browser SDKs do **not** add `browser.*` attributes unless you enable the browser resource detector or set the attributes yourself. Setting only `service.name` produces a perfectly valid backend Service, not a RUM application. [Browser Setup](/docs/rum/browser-setup) shows both ways to do it.

## What you get

**Overview** — page views, error rate and p95 duration over a selectable time range, with trend charts, plus tiles for client platforms and recorded sessions. The counts are derived from the spans your instrumentation emits, so what "page views" means is exactly what your instrumentation reports (document loads, route changes, interactions).

**Core Web Vitals** — LCP, INP, CLS, FCP and TTFB with good / needs-improvement / poor ratings, when your SDK reports them as metrics. See [Core Web Vitals](/docs/rum/web-vitals) for the metric names OneUptime looks for.

**Logs, Traces and Metrics** — the full telemetry explorers, scoped to this application.

**Clients** — the browser platforms and device models the application has been seen on. Coarse by platform, never per end user.

**Session Replay** — a recording of the session, played back next to the errors, traces and logs from that same session, with a searchable list of sessions and a health strip that says whether recordings are arriving. See [Session Replay](/docs/telemetry/session-replay), and in particular [Watching a session](/docs/telemetry/session-replay#watching-a-session).

**Connection status** — an application shows *Connected* while telemetry keeps arriving and flips to *Disconnected* after 15 minutes of silence.

## Getting started

1. Create a **Telemetry Ingestion Token** in _Project Settings → Telemetry & APM → Ingestion Keys_.
2. Instrument your app: [Browser Setup](/docs/rum/browser-setup) or [Mobile Setup](/docs/rum/mobile-setup).
3. Load a page. The application appears under **Resources → Real User Monitoring** on its first batch of telemetry — you do not need to create it by hand.
4. Optional: emit [Core Web Vitals](/docs/rum/web-vitals), and add [Session Replay](/docs/telemetry/session-replay).

If nothing shows up, [Troubleshooting](/docs/rum/troubleshooting) walks the failure modes in the order they actually occur.
