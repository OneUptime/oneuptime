# CrowdStrike Falcon Integration

Bring [CrowdStrike Falcon](https://www.crowdstrike.com/platform/) alerts into OneUptime, so endpoint, identity and cloud detections live in the same ClickHouse data lake as your logs, traces, and metrics — searchable, correlated with observability data, alertable, and routed to on-call.

```text
Managed connector  ──►  polls the Falcon Alerts API  ──►  Detection Finding events
```

Every alert is normalized to [OCSF](https://schema.ocsf.io/) (Open Cybersecurity Schema Framework), OneUptime's canonical security-event shape, so detection rules, monitors and dashboards work the same whatever the source.

## Prerequisites

- A OneUptime project. Project owners, project admins and security admins can create and edit connections; security members and viewers can read them and their run history.
- A Falcon customer ID (CID) and a Falcon console user who can manage API clients (the **Falcon Administrator** role, or a custom role with the **API clients and keys** permission).
- A Falcon **API client** with the **Alerts: Read** scope. No other scope is needed; the connector never writes to Falcon.
- Outbound HTTPS from the OneUptime API and worker processes to your Falcon cloud's API hostname (see the **Falcon cloud** field below).

## Create the API client

1. In the Falcon console, open **Support and resources → API clients and keys**.
2. Select **Create API client**. Give it a name such as `OneUptime security events` and a description.
3. Under **API scopes**, enable **Alerts** → **Read**. Leave every other scope off.
4. Select **Create**. Falcon shows the **Client ID**, the **Secret** and the **Base URL** once. Copy all three now — the secret cannot be shown again, only reset.
5. Note which cloud the base URL belongs to. It decides the **Falcon cloud** setting:

   | Base URL shown by Falcon                 | Falcon cloud |
   | ---------------------------------------- | ------------ |
   | `https://api.crowdstrike.com`            | US-1         |
   | `https://api.us-2.crowdstrike.com`       | US-2         |
   | `https://api.eu-1.crowdstrike.com`       | EU-1         |
   | `https://api.laggar.gcw.crowdstrike.com` | US-GOV-1     |

   The cloud is also shown on the API clients and keys page next to each client. A client created in one cloud is rejected by the other clouds' token endpoints.

## Connect it in OneUptime

1. Open **Security Events → Connections** (`/dashboard/{projectId}/security-events/connections`) and select **Add connection**.
2. Choose **CrowdStrike Falcon** as the provider and fill in the connection form:

   | Field                       | What to enter                                                                                                                                                                                                                                                 |
   | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
   | **Client ID**               | The Falcon API client ID shown when the client was created.                                                                                                                                                                                                   |
   | **Falcon cloud**            | The CrowdStrike cloud your CID is hosted in: **US-1 (api.crowdstrike.com)**, **US-2 (api.us-2.crowdstrike.com)**, **EU-1 (api.eu-1.crowdstrike.com)** or **US-GOV-1 (api.laggar.gcw.crowdstrike.com)**. It decides the API hostname every request is sent to. |
   | **Client secret**           | The Falcon API client secret. It is write-only: encrypted at rest, never returned by the API, and never shown back to you. To rotate it later, use the connection's **Update credentials** action.                                                            |
   | **Poll interval (minutes)** | A whole number from `1` to `1440`, default `5`.                                                                                                                                                                                                               |
   | **Enabled**                 | Whether scheduled polling runs. A disabled connection can still be tested and run on demand.                                                                                                                                                                  |

3. Select **Test these settings** before saving. The checklist (below) tells you whether Falcon accepted the credentials, whether the client may read alerts, and whether there is anything to import.
4. Save. New alerts are imported as **Detection Finding** events attributed to vendor `CrowdStrike`, product `Falcon`.

## What is imported

The connector reads Falcon **alerts** — the records behind **Endpoint security → Endpoint detections** and **Next-Gen SIEM → Alerts** in the Falcon console, across every product that raises them (endpoint, identity protection, cloud security, and so on). Each alert becomes one OCSF **Detection Finding** (class `2004`):

| Falcon field                                                                                    | OneUptime column                     |
| ----------------------------------------------------------------------------------------------- | ------------------------------------ |
| `composite_id`                                                                                  | Event UID (the dedupe key)           |
| `created_timestamp`                                                                             | Event time                           |
| `display_name` or `name`                                                                        | Rule name                            |
| `pattern_id`                                                                                    | Rule ID                              |
| `description` (or the name)                                                                     | Message                              |
| `severity_name` (`severity` 0–100 as fallback)                                                  | Severity                             |
| `status` (`new`, `in_progress`, `closed`, …)                                                    | Status                               |
| `tactic_id`, `technique_id`                                                                     | MITRE ATT&CK tactics and techniques  |
| `device.hostname`, `device.local_ip`, `user_name`, `filename` / `cmdline`                       | Principal host, IP, user and process |
| `device.hostname`, `device.local_ip`, `device.external_ip`, `user_name`, `sha256`               | Observables                          |
| everything else (`device.platform_name`, `falcon_host_link`, `product`, `type`, `timestamp`, …) | Flattened `attributes`               |

The Falcon behaviour time (`timestamp`) is kept in `attributes.timestamp`; the event time is the alert's creation time on purpose (see below).

## How polling works

- The connector ticks once a minute and polls every enabled connection that is due on its own interval.
- Alerts are listed by **creation time** (`created_timestamp`), never by the time of the underlying behaviour. Falcon can raise an alert well after the activity it describes; polling by activity time with a forward-moving cursor would skip every such alert. Polling by creation time cannot.
- The **first poll looks back 24 hours**, so a new connection shows recent alerts right away. Every later poll resumes from the saved cursor with a **1 minute overlap**, so an alert created on a window boundary is never missed. Each scheduled poll reads up to 24 hours past the cursor; an older cursor catches up in consecutive windows.
- Alerts already stored in the project under the same `composite_id` are skipped, so the overlap and re-runs never create duplicates.
- Each window costs one token request (cached for its lifetime), one alerts query per 1,000 alerts and one entity fetch per 1,000 alerts, sent to your cloud's API hostname with a timeout on every request.

### When a window holds more than one poll can read

A run may send at most 20 requests. With one token request and two requests per 1,000 alerts, a run reads at most **9,000 alerts**. When a window holds more, the run is reported as **Partial** with a warning such as:

```text
Stopped after 19 requests before reading the whole window. Alerts are read oldest first; every alert created before 2026-09-14T08:12:44.995Z was read.
```

The alerts query is sorted by `created_timestamp` ascending, so OneUptime moves the cursor to the creation time of the last alert read and the next poll carries on from there with the same window length, querying again from offset `0`. A busy CID catches up about 9,000 alerts per poll instead of re-reading the same ones. The overlap re-reads the alerts that share that last creation time, and dedupe drops the copies.

Falcon's alerts query cannot page past 10,000 results (`limit + offset`). The request limit stops a run at 9,000 alerts, before that ceiling is reached. If the ceiling ever does stop a read, it is handled the same way: the run is **Partial**, the cursor moves to the last alert read, and the next query starts again at offset `0`, so the ceiling never pins a window.

If a run cannot get past the saved cursor at all (for example, more than 9,000 alerts share the minute of overlap), OneUptime shortens the window instead:

- The next poll reads a window **half as long from the same starting point**, and keeps halving down to one minute until a window reads completely. The run's warning says so: `This window holds more records than one poll can read; the next poll reads a {n} minute window from the same starting point.`
- After a window reads completely, the next one is **twice as long again**, back up to 24 hours.
- If even a one minute window holds more than one poll can read, polling **moves past that minute** so newer alerts keep arriving. The run stays **Partial** and **Last Error** reads `More records were created in the one minute from {cursor} to {end} than one poll can read. Polling moved past this minute so newer records keep arriving; use Import this time range in Diagnostics on this minute to recover what one run can read.` Run **Import history** on that minute to recover the alerts it skipped.
- A run that fails outright (an error from Falcon) leaves the cursor and the window length unchanged, and the next poll retries the same window. A request that **timed out** keeps the cursor but halves the next window, since a window too heavy to answer in time would otherwise time out on every retry.

Shortening the **Poll interval (minutes)** does not change any of this: the interval only decides how often a poll starts, not where its window begins.

Use **Diagnostics** on a connection for run history, **Run now**, **Preview** (read a range without importing) and **Import history** (import a past range of up to 7 days without moving the live cursor).

## Test connection

**Test connection** (on the connection's row, or **Test these settings** in the form) runs synchronously from the API — it does not need a worker — and returns a checklist. The Falcon checks are:

| Check                                      | What it does                                                               | Passes when                                                                                                                       |
| ------------------------------------------ | -------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| **Configuration**                          | Validates the fields without contacting Falcon.                            | Client ID, Falcon cloud and Client secret are present and well formed.                                                            |
| **Authenticate with CrowdStrike Falcon**   | `POST /oauth2/token` with the client credentials on your cloud's hostname. | Falcon issues an access token.                                                                                                    |
| **Read alerts from the Falcon Alerts API** | One-record alerts query (`limit=1`) over the last 24 hours.                | The Alerts API accepts the query, which proves the **Alerts: Read** scope.                                                        |
| **Alerts available to import**             | Counts alerts created in the last 24 hours and the last 7 days.            | At least one alert exists. Zero in 7 days is a **warning**, not a failure: polling will import new alerts as Falcon creates them. |

The report then adds the OneUptime platform checks — **Background workers** (a process consuming the Worker queue), **Poll scheduler**, **Security event storage**, and (for a saved connection) **Scheduled polling** — so "nothing is imported" can be told apart from "Falcon has nothing to import". Each failed check carries remediation text. **Copy report** copies the checklist as JSON; credentials and tokens are never included.

## Troubleshooting

The connection's **Last Error** and every failed check quote the complete error message with credentials redacted, behind a prefix naming the step that failed. Read the prefix first:

- `CrowdStrike Falcon token request failed (HTTP 401)` or `(HTTP 403)` — Falcon's OAuth2 endpoint rejected the client credentials before the Alerts API was contacted. Check that **Falcon cloud** is the cloud your CID is hosted in (a client from another cloud is rejected here), that **Client ID** matches the API client, and that **Client secret** is the secret issued with it. If the secret was lost, reset it in the Falcon console and use **Update credentials**.
- `CrowdStrike Falcon token request returned ...` — the OAuth2 endpoint answered, but with something unusable: no `access_token`, or a body that is not JSON. Usually a proxy or gateway between OneUptime and Falcon rather than the credentials.
- `CrowdStrike Falcon alerts query failed (HTTP 403)` — the token was accepted but the Alerts API refused the query: the API client is missing the **Alerts: Read** scope. Edit the client under **API clients and keys**, enable the scope and save; the change applies to the next token, so test again after a minute.
- `CrowdStrike Falcon alerts query failed (HTTP 401)` — the token was minted but the Alerts API refused it, which almost always means the **Falcon cloud** does not match the cloud that issued the client.
- `CrowdStrike Falcon alerts query failed (HTTP 429)` or `CrowdStrike Falcon alerts fetch failed (HTTP 429)` — Falcon is rate limiting this API client. OneUptime's outbound HTTP client does not keep response headers on an error, so the message usually ends with `the X-RateLimit-RetryAfter header was not available` rather than quoting it. Wait a few minutes; scheduled polls retry automatically on the next tick. If it recurs, give OneUptime its own API client instead of sharing one with other integrations.
- `CrowdStrike Falcon alerts query failed (HTTP 400)` — Falcon rejected the query. The connector sends a fixed FQL filter on `created_timestamp`, so copy the report and contact OneUptime support with it.
- `CrowdStrike Falcon alerts query returned ...` or `CrowdStrike Falcon alerts fetch returned ...` — Falcon answered `200` but the body was not a readable alerts response: not JSON, or a shape the parser does not recognize. It is reported rather than counted as an empty window on purpose — treating a body it could not read as "no alerts" would advance the cursor past whatever was missed.
- `CrowdStrike Falcon alerts fetch failed (HTTP ...)` — the alert ids were listed but fetching the full alert entities failed. Same causes as the query step; a `403` here means the scope was removed between the two calls.
- `CrowdStrike Falcon token request could not be completed`, `CrowdStrike Falcon alerts query could not be completed` or `CrowdStrike Falcon alerts fetch could not be completed` — nothing came back: a timeout, DNS failure or blocked egress. Check outbound connectivity from the OneUptime API and worker processes to your cloud's API hostname (for example `api.crowdstrike.com`).
- `CrowdStrike Falcon cloud "..." is not one of us-1, us-2, eu-1, us-gov-1` — the saved cloud value is not one the connector knows. Edit the connection and pick a cloud from the list.
- A run reports **Partial** with `Stopped after 19 requests before reading the whole window` — the window held more than the 9,000 alerts one run can read. Nothing is lost: the cursor moves to the last alert read and the next poll continues from there (see [When a window holds more than one poll can read](#when-a-window-holds-more-than-one-poll-can-read)). A connection that stays **Partial** for many polls in a row is catching up on a backlog; **Last Polled** and **Last Event Imported** keep moving while it does. The count can be a little higher than 19 when a token was refreshed during the run.
- `Falcon returned alerts out of created_timestamp order, so this run cannot name a point to resume from.` — the alerts query ignored the ascending sort the connector asked for, so the run cannot safely move the cursor to its last alert. The next poll shortens the window instead. If it recurs, contact OneUptime support with the run's report.
- **Last Error** reads `More records were created in the one minute from ... than one poll can read` — a single minute held more alerts than one poll can read, so polling moved past it. Run **Import this time range** in **Diagnostics** on that minute to recover what one run can read; an import has the same per-run limit as a poll.
- **Last Polled is `Never` and Last Error is empty** — the poll job has not run at all, so nothing has reached Falcon. **Test connection** reports this as a failed worker or scheduler check. On self-hosted deployments the usual cause is `DISABLE_QUEUE_WORKERS=true` on the app container with no separate worker deployment; set `DISABLE_QUEUE_WORKERS=false` or run the worker deployment (Helm: `worker.enabled: true`).
- **Test connection passes but no events appear** — check **Alerts available to import**: a warning there means Falcon created no alerts in the last 7 days, so there is nothing to import yet. Otherwise open **Diagnostics**, confirm the latest poll's window and counts, and use **View events** on a run to open the imported alerts' time range.

## What you get

- **Security Events explorer** — search and filter Falcon alerts by severity, status, MITRE tactic, host, user, or any observable.
- **Correlation** — every alert's observables (hostnames, IPs, users, file hashes) are indexed, so "everything mentioning this host" is one query, next to that host's logs and metrics.
- **Detection Rules** — [Sigma](https://sigmahq.io/) detections-as-code evaluated every minute against imported alerts; matches open deduplicated alerts (with on-call routing) and write Detection Finding events.
- **Security Events monitors** — alert when matching alert counts cross a threshold, with the same criteria, incident, and on-call machinery as every other monitor.
- **Dashboards & AI** — security event widgets on custom dashboards, and AI assistant tools (`search_security_events`, `security_event_summary`) for natural-language investigation.

## Billing

Security events are metered like other telemetry, per GB ingested. See [Pricing](https://oneuptime.com/pricing).
