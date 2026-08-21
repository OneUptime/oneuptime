# Google SecOps Integration

Bring [Google SecOps](https://cloud.google.com/security/products/security-operations) (formerly Chronicle) SIEM signals into OneUptime, so security detections live in the same ClickHouse data lake as your logs, traces, and metrics — searchable, correlated with observability data, alertable, and routed to on-call.

There are three ways to connect, from zero-code to full event sync:

```text
1. SOAR playbook webhook   ──►  Security Events ingest  ──►  Events + Detection Rules + Alerts
2. Managed connector       ──►  polls detection alerts  ──►  Detection Finding events
3. UDM event forwarding    ──►  Security Events ingest  ──►  full event search + correlation
```

Every path normalizes events to [OCSF](https://schema.ocsf.io/) (Open Cybersecurity Schema Framework), OneUptime's canonical security-event shape, so rules and dashboards work the same whatever the source dialect.

## Prerequisites

- A OneUptime project with a **Telemetry Ingestion Key** (**Settings → Telemetry Ingestion Keys**).
- A Google SecOps tenant. For the managed connector: permission to create a Google Cloud service account with Chronicle API read access.

## Option 1 — SOAR playbook webhook (works in minutes)

Google SecOps SOAR playbooks can POST alerts to any HTTP endpoint. Point one at OneUptime's security events ingest:

1. In your SecOps SOAR playbook, add an **HTTP request** action that fires on new alerts.
2. Configure it:

   - **Method**: `POST`
   - **URL**: `https://oneuptime.com/security-events/v1/ingest` (or `https://<your-host>/security-events/v1/ingest` for self-hosted)
   - **Headers**:

     ```text
     Content-Type: application/json
     x-oneuptime-token: <your telemetry ingestion key>
     ```

   - **Body**: the alert JSON. Detection payloads (rule metadata plus matched UDM events under `collectionElements`) are recognized automatically and stored as **Detection Finding** events, with observables (users, hosts, IPs) mined from the matched events.

3. Alerts appear under **Security Events** in the dashboard within seconds.

## Option 2 — Managed connector (polled detections)

OneUptime polls your tenant's detection alerts on an interval — no SOAR configuration needed.

1. In Google Cloud, create a **service account** with the **Chronicle API Viewer** role on the project your SecOps instance is bound to, and download its **JSON key**.
2. In OneUptime, open **Security Events → Google SecOps Connections** and create a connection:

   - **Region**: your tenant's regional prefix (`us`, `europe`, ...).
   - **Instance resource name**: `projects/{project}/locations/{location}/instances/{instance}` — from your SecOps **SIEM Settings → Profile**.
   - **Service account JSON**: paste the key. It is encrypted at rest and never returned by the API.
   - **Poll interval**: how often to fetch new detection alerts (default 5 minutes).

3. New detections are ingested as **Detection Finding** events attributed to a `Google SecOps` telemetry service. Poll status (`last polled`, `last error`) is visible on the connection.

> The connector uses the Chronicle `v1alpha` alerts API, which Google ships as pre-GA. If your tenant's API shape differs, the connection's **Last Error** field says exactly what the API returned.

## Option 3 — Forward UDM events

For full-fidelity search and correlation, forward UDM events themselves (for example from a BigQuery export pipeline, Cloud Function, or any forwarder you already run):

```bash
curl -X POST "https://oneuptime.com/security-events/v1/ingest?format=udm" \
  -H "Content-Type: application/json" \
  -H "x-oneuptime-token: <your telemetry ingestion key>" \
  -d '{
    "events": [
      {
        "metadata": {
          "event_type": "USER_LOGIN",
          "event_timestamp": "2026-08-21T10:00:00Z",
          "vendor_name": "Google",
          "product_name": "Google SecOps"
        },
        "principal": { "user": { "userid": "alice" }, "ip": ["203.0.113.7"] },
        "target": { "hostname": "vpn-gw-01" },
        "security_result": [{ "severity": "HIGH", "action": ["BLOCK"] }]
      }
    ]
  }'
```

- `format` can be `udm`, `ocsf`, `google-secops-alert`, or `generic`; omit it and the dialect is detected per event.
- The body accepts a single object, a bare array, or `{ "events": [...] }`.
- Set `x-oneuptime-service-name` to control which telemetry service the events are attributed to (defaults to the payload's product name).

## What you get

- **Security Events explorer** — search and filter events by severity, OCSF class, actor, target, or any observable.
- **Correlation** — every event's observables (users, hosts, IPs, domains) are indexed, so "everything mentioning this host" is one query, next to that host's logs and metrics.
- **Detection Rules** — [Sigma](https://sigmahq.io/) detections-as-code evaluated every minute against your events; matches open deduplicated alerts (with on-call routing) and write Detection Finding events.
- **Security Events monitors** — alert when matching event counts cross a threshold, with the same criteria, incident, and on-call machinery as every other monitor.
- **Dashboards & AI** — security event widgets (including a Sankey flow view) on custom dashboards, and AI assistant tools (`search_security_events`, `security_event_summary`) for natural-language investigation.

## Billing

Security events are metered like other telemetry, per GB ingested. See [Pricing](https://oneuptime.com/pricing).
