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
2. In OneUptime, open **Security Events → Connections** (`/dashboard/{projectId}/security-events/connections`) and create a connection on the **Google SecOps Connections** card:

   - **Region**: your tenant's regional prefix, lowercase — `us`, `europe`, and so on. It is used to build the API base URL.
   - **Instance resource name**: `projects/{project}/locations/{location}/instances/{instance}` — from your SecOps **SIEM Settings → Profile**.
   - **Service account JSON**: paste the key. It is write-only — encrypted at rest, never returned by the API, and never shown back to you on the page. To rotate it later, use the connection's **Update Service Account JSON** action.
   - **Poll interval (minutes)**: a whole number from `1` to `1440`, default `5`. Anything outside that range is rejected when you save.

3. New detections are ingested as **Detection Finding** events attributed to a `Google SecOps` telemetry service.

The connector ticks once a minute and polls every enabled connection that is due on its own interval. The first poll looks back **15 minutes**; every poll after that resumes from the connection's stored cursor with a **1 minute** overlap, so alerts landing on a window boundary are never missed. No single poll replays more than **24 hours** — a connection that sat disabled for a week resumes a day back, not a week.

The connections list is the poll's health readout: **Name**, **Status** (Enabled/Disabled), **Region**, **Interval (Minutes)**, **Last Polled** and **Last Error**.

> The connector uses the Chronicle `v1alpha` alerts API, which Google ships as pre-GA. The connection's **Last Error** field stores the complete error message with credentials redacted, behind a prefix naming the step that failed — including the case where Chronicle answers `200` and puts the rejection inside the body. Select **View Full Error** to read the message or **Copy Error** to copy it for support.

### Troubleshooting

- **Status is `Disabled`** — disabled connections are skipped entirely. The poller only picks up enabled ones.
- **Last Polled is `Never` and Last Error is empty** — the background worker has not executed the poll job at all, so nothing has ever reached Chronicle. On self-hosted deployments the usual cause is `DISABLE_QUEUE_WORKERS=true` on the app container with no separate worker deployment draining the queues. Either set `DISABLE_QUEUE_WORKERS=false` (the `config.example.env` default that Docker Compose ships with), or run the dedicated worker deployment (Helm: `worker.enabled: true`, which is `false` by default).
- **Last Error is populated** — a poll was attempted and something in it failed. The field stores the complete error message with credentials redacted. The table shows a short preview; **View Full Error** opens the full message and **Copy Error** copies it, including details beyond the preview. The error clears on the next successful poll. Read the prefix first. Only two prefixes carry an HTTP status, so a message without one is not evidence of a fault on OneUptime's side:
  - `Google token exchange failed (HTTP ...)` — the service-account credential was rejected at Google's OAuth endpoint, before Chronicle was ever contacted. Usually a malformed, revoked, or wrong-project key.
  - `Google token exchange returned ...` — that same OAuth endpoint answered, but with something unusable: no `access_token`, or a body that is not JSON. Still before Chronicle, and usually a proxy or gateway sitting in between rather than the key itself.
  - `Google SecOps alerts fetch failed (HTTP ...)` — Chronicle itself rejected the request. A `403` usually means the service account is missing the **Chronicle API Viewer** role on the project the instance is bound to; a `404` usually means the instance resource name points at a different instance, or the region prefix is not one Chronicle serves.
  - `Google SecOps alerts fetch returned ...` — Chronicle answered `200`, but the body was not a readable detection-alerts stream: empty, not JSON, or a shape the parser does not recognize. It is reported rather than counted as an empty window on purpose — treating a body it could not read as "no alerts" would advance the cursor past whatever was missed.
  - `Google SecOps alerts query was rejected by Chronicle on an HTTP 200` — Chronicle accepted the request, ran it, and rejected the query inside the body it returned (`validSnapshotQuery` or `validBaselineQuery` false, or `queryValidationErrors`). This is Google's rejection, and there is no HTTP status anywhere in it.
  - `timed out after 60 seconds with no response` — neither Google's OAuth endpoint nor Chronicle answered before the client gave up. Nothing came back, so the message assigns no side; check egress from the OneUptime worker as well as the tenant.
  - A message matching none of the above — the failure was on OneUptime's side. `Google SecOps connection is missing id, projectId, region, instance, or credentials` means this connection row is incomplete despite the `Google` in front of it; otherwise the alerts arrived and writing them to the telemetry store is what failed.
- **Last Error reads `Google SecOps alerts fetch failed (HTTP 400)` and quotes `Unknown name "pageSize": Cannot bind query parameter`** — this identifies an unsupported request parameter. Upstream **13.0.0** already replaced `pageSize` with `alertListOptions.maxReturnedAlerts`. Inspect the actual app and worker images, including custom builds and separately deployed workers, if this error still appears. Rotating the service-account key does not correct an unsupported query parameter. A successful OAuth token exchange confirms credential acceptance; the parameter rejection alone does not establish authentication or authorization.

### An alert request still returns `400 INVALID_ARGUMENT`

A successful OAuth token exchange confirms that Google accepted the service-account credential. It does not confirm the SecOps instance resource name or permission to read that instance. A generic `Request contains an invalid argument` response does not identify which argument failed.

The upstream **13.0.0** release already uses `alertListOptions.maxReturnedAlerts`. If a deployment reporting that version still sends `pageSize`, check the actual images used by every polling worker, including separately deployed workers and custom builds.

1. Check the **running app and worker image versions**. Updating a local connector source file or re-uploading the service-account JSON does not update a deployed container. Deploy an image containing the connector correction to every app or dedicated worker that runs the poll job. If you build your own image, rebuild it with the corrected source and deploy a new, immutable tag; restarting a pod with the old image is insufficient.
2. Verify the connector request against the [Google API reference](https://docs.cloud.google.com/chronicle/docs/reference/rest/v1alpha/projects.locations.instances.legacy/legacyFetchAlertsView). It uses `timeRange.startTime`, `timeRange.endTime`, `snapshotQuery=` (an empty value includes all alert statuses), and `alertListOptions.maxReturnedAlerts`. It must not send `pageSize` or `pageToken`. Do not substitute a filter excluding closed alerts, since that loses detections.
3. Compare the full `projects/{project}/locations/{location}/instances/{instance}` resource with the values in your Google SecOps tenant settings. The instance component must be the SecOps instance ID; a connection display name or service-account name is not a substitute. Confirm that the regional endpoint matches the instance location.
4. Wait for the next configured poll interval after the rollout completes. **Last Polled** should advance and **Last Error** should clear on a successful poll. If the window contains detections, they should appear under **Security Events**; a quiet window can legitimately ingest zero events.

If the same error persists, use **Copy Error** and provide support with that message, the image tag or digest, region, and instance resource name. Credentials in the recorded message are redacted; do not send the service-account private key, JWT assertion, or access token separately. Errors recorded before upgrading may already be truncated; a subsequent failed poll records the complete message. Failed polls preserve the cursor, but catch-up is limited to the most recent 24 hours.

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
