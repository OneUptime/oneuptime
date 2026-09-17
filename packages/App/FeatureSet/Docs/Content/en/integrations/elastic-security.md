# Elastic Security Integration

Bring [Elastic Security](https://www.elastic.co/security) detection alerts into OneUptime, so the alerts your Kibana detection rules raise live in the same ClickHouse data lake as your logs, traces, and metrics — searchable, correlated with observability data, alertable, and routed to on-call.

```text
Managed connector  ──►  polls the Kibana detections API  ──►  Detection Finding events
```

Every imported alert is normalized to [OCSF](https://schema.ocsf.io/) (Open Cybersecurity Schema Framework), OneUptime's canonical security-event shape, so detection rules, monitors and dashboards work the same whatever the source.

## Prerequisites

- A OneUptime project. Project owners, project admins and security admins can create connections; security members and viewers can read them.
- An Elastic Stack with Elastic Security enabled in Kibana (Elastic Cloud or self-managed, 8.x or later). The connector uses the Kibana [detection alerts search API](https://www.elastic.co/docs/api/doc/kibana/operation/operation-searchalerts).
- A Kibana user, or API key role descriptors, with the [privileges required to view detection alerts](https://www.elastic.co/guide/en/security/current/detections-permissions-section.html) in the space that holds your rules:
  - Elasticsearch index privileges `read` and `view_index_metadata` on `.alerts-security.alerts-<space-id>` (and on `.siem-signals-<space-id>` only for clusters upgraded from 8.0 or earlier).
  - The Kibana **Security** feature privilege that allows viewing alerts in that space (**Read** for **Alerts** on Elastic Stack 9.4 and later; on earlier releases, the Security feature's read privilege on the space).
- Network access from the OneUptime API and worker processes to Kibana. OneUptime Cloud can only reach a Kibana that is exposed on the public internet (Elastic Cloud deployments are). A Kibana on a private network needs a self-hosted OneUptime that can route to it, or a network path such as a reverse proxy that forwards the `Authorization` header unchanged.

## Step 1 — Create an API key

1. In Kibana, open **Stack Management → API keys** and select **Create API key**.
2. Give the key a name such as `oneuptime-security-events`. To limit what the key can do, enable **Restrict privileges** and grant only the index and Kibana privileges listed above; otherwise the key inherits the privileges of the user creating it.
3. Optionally set an expiration. An expired key answers `401` and the connection stops importing until you replace it.
4. Select **Create API key**, then copy the **Base64** (`encoded`) value. It is shown once. This is the value the connection needs — not the key **ID**, and not the raw `id:api_key` pair.

Kibana authenticates the key with the `Authorization: ApiKey <encoded>` header. Paste the encoded value on its own; the connection adds the `ApiKey` prefix itself.

## Step 2 — Create the connection

In OneUptime, open **Security Events → Connections** (`/dashboard/{projectId}/security-events/connections`), select **Add connection** and choose **Elastic Security**.

| Field            | Required | What to enter                                                                                                                                                                                                                                       |
| ---------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Kibana URL**   | Yes      | The origin Kibana is served from, without a trailing path, for example `https://kibana.example.com` or `https://<deployment>.kb.<region>.cloud.es.io`. Do not include `/app/security`, `/api`, or the `/s/<space>` prefix.                          |
| **Kibana space** | No       | The id of the Kibana space that holds the detection rules (the segment after `/s/` in Kibana's URL). Leave empty for the default space. Use the space id, not its display name. Alerts are stored per space, so a wrong space reads an empty index. |
| **API key**      | Yes      | The Base64 encoded value from Step 1. It is write-only: encrypted at rest, never returned by the API, and never shown back to you on the page. To rotate it later, use the connection's **Update credentials** action.                              |

The connection also asks for a **Name**, an optional **Description**, a **Poll interval (minutes)** — a whole number from `1` to `1440`, default `5` — and whether scheduled polling is **Enabled**.

Before saving, use **Test these settings** to run the connection test described below against the unsaved values; nothing is stored until you save.

## What is imported

Every detection alert in the space — alerts raised by custom query, threshold, EQL, indicator match, machine learning and new-terms rules alike — is imported as an OCSF **Detection Finding** (class `2004`) event attributed to the `Elastic Security` telemetry service. The columns are filled from the alert document:

- **Severity** from `kibana.alert.severity` (`low`, `medium`, `high`, `critical`); when a rule type does not set it, the rule's `kibana.alert.risk_score` band is used.
- **Status** from `kibana.alert.workflow_status` (`open`, `acknowledged`, `closed`).
- **Rule id** and **rule name** from `kibana.alert.rule.uuid` and `kibana.alert.rule.name`.
- **MITRE ATT&CK** tactics and techniques (including sub-techniques) from `kibana.alert.rule.threat`.
- **Message** from `kibana.alert.reason`, falling back to the rule name.
- **Event time** from `kibana.alert.original_time` (the matched source event's timestamp), then `kibana.alert.start`, then the alert's own `@timestamp`.
- **Principal** host, user, IP and process from `host.name`, `user.name`, `source.ip` (or `host.ip`) and `process.name`; **target** from `destination.ip`, `destination.port`, `destination.domain` and `file.path`.
- **Observables** from all of those plus `related.*`, `dns.question.name`, `url.domain` and file hashes, so "everything mentioning this host" is one query.
- The complete alert document, flattened to dotted keys, in the event's attributes.

The alert's `_id` is stored as the event's source identifier. Repeated polls and imports skip alerts already stored with the same identifier in the project.

## How polling works

The scheduler ticks once a minute and polls every enabled connection that is due on its own interval.

- **Time basis is creation time.** The connector selects alerts by the alert document's `@timestamp`, which Kibana sets when the rule execution creates the alert — not by the time of the underlying activity. A rule that runs hourly writes alerts about events that happened up to an hour earlier; polling by event time would skip every one of them. The activity time is still stored as the event time, so an alert created today about yesterday's event shows yesterday's time in the explorer.
- **The first poll looks back 24 hours**, so a new connection shows recent alerts immediately instead of an empty window.
- **Every later poll resumes from the saved cursor with a one-minute overlap**, so an alert created on a window boundary is never missed; the overlap is harmless because duplicates are dropped by `_id`.
- **Each scheduled poll covers at most 24 hours past the cursor.** A connection whose cursor is older catches up in consecutive daily windows instead of skipping ahead.
- **Bounds.** A poll reads up to 1,000 alerts per request, up to 20 requests and up to 10,000 alerts. Alerts are read oldest first. When a bound stops the poll, the run is reported as **Partial** with a warning such as `Stopped after collecting 10000 alerts; the window holds more.`, and the cursor moves to the `@timestamp` of the last alert read. The next poll starts there, minus the one-minute overlap, and skips alerts it already imported, so a backlog drains up to 10,000 alerts per poll.
- **When a poll cannot move forward.** If more than 10,000 alerts were created in the minute before the resume point, a poll cannot get past it. The next poll then reads a shorter window from the same starting point: half the length each time, down to one minute. The run warns `This window holds more records than one poll can read; the next poll reads a {n} minute window from the same starting point.` The window doubles again after each poll that reads its window completely. If even a one-minute window holds more than one poll can read, polling moves past that minute so newer alerts keep arriving. The run stays **Partial**, and **Last Error** reads `More records were created in the one minute from {cursor} to {end} than one poll can read. Polling moved past this minute so newer records keep arriving; use Import this time range in Diagnostics on this minute to recover what one run can read.` Scheduled polling does not come back for the alerts in that minute it could not read; run **Import history** on that minute to recover them.

Kibana's detection alerts search accepts a size and a sort but no page cursor. The connector therefore pages by moving the lower bound of its `@timestamp` range to the last alert on each page. The next request leaves out, by `_id`, the alerts already read at that exact timestamp. One rule execution often stamps many alerts with the same time, so a group of alerts sharing one timestamp can be larger than a page. Such a group is read page by page, without re-reading or skipping any alert. The excluded ids travel in the request body, which Kibana limits to 1,048,576 bytes by default (`server.maxPayload`). When more alerts share one timestamp than fit in that list (about 7,800), the poll stops as **Partial** with a warning naming that timestamp.

For alerts older than the initial 24-hour window, open **Diagnostics** on the connection and use **Import history** for a range of up to seven days at a time; **Preview** reads a range without importing or moving the cursor.

## Test connection

**Test connection** (on a saved connection's row, or **Test these settings** in the form) runs synchronously in the API process — it does not need a background worker, which is exactly why it can tell you when no worker is running. It reports a checklist:

1. **Configuration** — the Kibana URL, space and API key are present and well formed. Nothing is contacted if this fails.
2. **Authenticate with Kibana** — `GET <Kibana URL>[/s/<space>]/api/status`. Kibana answers this request for unauthenticated callers too, but with a document redacted to the overall status level; a redacted answer therefore fails this check (the key was not applied), and a `401` fails it with the key remediation.
3. **Read detection alerts** — a one-alert search over the last 24 hours. A `403` here means the key authenticated but lacks the index or feature privileges above.
4. **Alerts available to import** — how many alerts were created in the last 24 hours and the last 7 days (`10000+` when Elasticsearch answers with a lower bound). Zero in seven days is a warning, not a failure: polling imports new alerts as Elastic Security creates them, but check that rules are enabled in this space.
5. **Background workers**, **Poll scheduler** and **Security event storage** — whether OneUptime's own worker queue has consumers, whether the minute-cadence poll scheduler is registered, and whether the analytics database answers.
6. **Scheduled polling** (saved connections only) — whether the connection is polled on its interval and what its last poll reported.

Each failed check carries remediation text. **Copy report** copies the checklist as JSON for support; credentials are never included.

## Troubleshooting

Every failure a poll records in the connection's **Last Error** (select **View Error** in the row's **Actions** column) is prefixed with the step that failed. Credentials are redacted before the message is stored. Read the prefix first:

- `Elastic Security status request failed (HTTP ...)` — Kibana answered the `/api/status` probe with an error status. `401`: the API key was rejected — paste the Base64 encoded value, and check the key has not expired or been invalidated. `404`: the Kibana URL is not Kibana's origin (a path was included, or the URL points somewhere else). `503`: Kibana reports itself unavailable, usually because Elasticsearch is unreachable. A `3xx` means Kibana redirected the request; redirects are refused, so use the URL Kibana is served from directly.
- `Elastic Security status request did not complete` — nothing came back: a timeout, a refused connection or an unresolvable host. Check that Kibana is reachable from the OneUptime API and worker processes, with the right scheme and port. OneUptime Cloud cannot reach a private network.
- `Elastic Security status request returned a non-JSON body.` — the URL answered with something that is not Kibana's status document, typically a login page or a proxy error. Point the connection at Kibana's origin, not at a page in front of it.
- `Elastic Security status request returned an unrecognized response shape` — JSON came back, but without Kibana's `status` object. The URL is serving a different application.
- `Elastic Security alerts search failed (HTTP ...)` — Kibana rejected the detection alerts search. `403`: the key lacks `read` and `view_index_metadata` on `.alerts-security.alerts-<space-id>` or the Kibana Security feature privilege for the space. `404`: the space id is wrong, or Elastic Security is not enabled in that space. `429`: Kibana or Elasticsearch is rate limiting; the next poll retries. `5xx`: Kibana or Elasticsearch failed internally; check the Kibana server logs.
- `Elastic Security alerts search did not complete` — the search timed out or the connection dropped after authentication succeeded. Large windows on a slow cluster can hit the 60 second request timeout; a timed-out poll does not move the cursor, and the next poll reads a window half as long from the same starting point, down to one minute.
- `Elastic Security alerts search returned a non-JSON body.` — Kibana answered `200` with a body that is not JSON. It is reported rather than treated as an empty window on purpose: counting a body that could not be read as "no alerts" would advance the cursor past whatever was missed.
- `Elastic Security alerts search returned an unrecognized response shape` — a JSON body without the Elasticsearch `hits` envelope, usually Kibana's own error envelope on a `200`. The message quotes the body so the reason is visible.
- **Last Polled is `Never` and Last Error is empty** — no worker has run the poll job. On self-hosted deployments the usual cause is `DISABLE_QUEUE_WORKERS=true` on the app container with no separate worker deployment. Run **Test connection**: its **Background workers** and **Poll scheduler** checks name the cause and the fix.
- **Test connection passes but the explorer shows nothing** — check **Alerts available to import**. If the space created no alerts in seven days there is nothing to import yet; enable rules or confirm the **Kibana space** matches the space the rules run in. If alerts exist, remember the explorer's time filter applies to the alert's activity time, which can be much earlier than its creation time; widen the range.
- **Health is Partial** — the last poll found more alerts than one poll reads; read the run's warnings in **Diagnostics**. A warning that the poll stopped after a number of requests or alerts means polling is working through a backlog: the cursor moves to the last alert read on every poll, and no action is needed. A warning that the next poll reads a shorter window means the window is being narrowed until one poll can read it. If **Last Error** says polling moved past a minute, alerts from that minute were left behind: run **Import history** on it. A connection that is Partial on every poll creates more than 10,000 alerts per poll interval; shorten the **Poll interval (minutes)** so more polls run per hour.

## What you get

- **Security Events explorer** — search and filter Elastic alerts by severity, rule, MITRE technique, actor, target, or any observable, next to events from every other source.
- **Correlation** — every event's observables are indexed, so "everything mentioning this host" is one query, next to that host's logs and metrics.
- **Detection Rules** — [Sigma](https://sigmahq.io/) detections-as-code evaluated every minute against your events, including the imported alerts.
- **Security Events monitors** — alert when matching event counts cross a threshold, with the same incident and on-call machinery as every other monitor.
- **Dashboards & AI** — security event widgets on custom dashboards, and AI assistant tools for natural-language investigation.

## Billing

Security events are metered like other telemetry, per GB ingested. See [Pricing](https://oneuptime.com/pricing).
