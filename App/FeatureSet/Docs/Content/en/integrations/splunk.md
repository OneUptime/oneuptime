# Splunk Enterprise Security Integration

Bring [Splunk Enterprise Security](https://www.splunk.com/en_us/products/enterprise-security.html) notable events into OneUptime, so the detections your correlation searches raise live in the same ClickHouse data lake as your logs, traces, and metrics — searchable, correlated with observability data, alertable, and routed to on-call.

```text
Managed connector  ──►  polls index=notable by creation time  ──►  Detection Finding events
```

The connector runs a Splunk search on a schedule through the search head's REST API and normalizes every returned row to [OCSF](https://schema.ocsf.io/) (Open Cybersecurity Schema Framework), OneUptime's canonical security-event shape. It works with Splunk Enterprise and Splunk Cloud Platform search heads, and — because it is only a search — with any index or saved-search output, not just Enterprise Security notables.

## Prerequisites

- A OneUptime project where you are a **project owner**, **project admin** or **security admin** (the roles that can create connections).
- A Splunk search head running **Splunk Enterprise 9.0.1 or later** (or Splunk Cloud Platform) with the REST API reachable on its **management port**, usually `8089`. Splunk Web on port `8000` does not serve the REST API. Older search heads still work through the deprecated `search/jobs/export` endpoint, which the connector falls back to.
- **Token authentication enabled** on the search head (**Settings → Tokens**), unless you use a username and password.
- A Splunk **user and role** for OneUptime with:
  - the `search` capability;
  - read access to the index the search selects — for notable events, `notable` in the role's **Indexes searched by default / Indexes** settings (`srchIndexesAllowed`). Inheriting Enterprise Security's `ess_analyst` or `ess_user` role grants this.
  - nothing else: the connector only reads. It never updates a notable, so `edit_notable_events` and the other Enterprise Security write capabilities are not needed.
- Network reachability from OneUptime to the management port:
  - **OneUptime Cloud** connects from the public internet. The search head must have a public, TLS-served address; private addresses (RFC 1918, link-local, loopback) are refused by the egress guard.
  - **Self-hosted OneUptime** connects from your API and worker containers. A search head on a private network is reachable if those containers can route to it and `DATA_SOURCE_BLOCK_PRIVATE_ADDRESSES` is not set to `true` in your deployment's environment.

## Create an authentication token

Following [Splunk's instructions](https://help.splunk.com/en/splunk-enterprise/administer/manage-users-and-security/10.4/authenticate-into-the-splunk-platform-with-tokens/create-authentication-tokens):

1. In Splunk Web, open **Settings → Tokens**. If you see a message that token authentication is not enabled, enable it first (you need the `edit_tokens_settings` capability, which `admin` has).
2. Select **New Token**.
3. In **User**, enter the Splunk user created for OneUptime. Creating a token for another user needs the `edit_tokens_all` capability; users with `edit_tokens_own` can create their own.
4. In **Audience**, describe the purpose, for example `OneUptime security events`.
5. Optionally set an **Expiration**. Note the date: the connector stops working when the token expires, and the **Test connection** checklist reports it as an authentication failure.
6. Select **Create** and copy the token. Splunk shows it only once; if you close the dialog without copying, create a new token.

If you prefer a **Username** and **Password**, skip this section and leave the token empty; the connector then sends HTTP basic authentication on every request.

## Create the connection

In OneUptime, open **Security Events → Connections** (`/dashboard/{projectId}/security-events/connections`), select **Add connection**, and choose **Splunk Enterprise Security**.

| Field | Required | What to enter |
| --- | --- | --- |
| **Splunk management URL** | Yes | The REST API base URL of the search head, usually on port 8089, for example `https://splunk.example.com:8089`. It must be `https`, with no query string; a path is allowed when a reverse proxy prefixes the API. |
| **Search** | No | The SPL that selects the events to import. Defaults to `index=notable`. The connector adds the time range itself; do not include `earliest` or `latest`, and do not start with a pipe or a generating command (`| tstats ...`). A leading `search ` is stripped. Examples: `index=notable`, `index=notable rule_name="Threat - *"`, `index=notable urgency IN (high, critical)`. |
| **Username** | No | Only when authenticating with a password instead of an authentication token. |
| **Authentication token** | No | A Splunk authentication token (Settings > Tokens). Leave empty when using username and password. Encrypted at rest and never returned by the API. |
| **Password** | No | The password for the username above. Leave empty when using an authentication token. Encrypted at rest and never returned by the API. |
| **Poll interval (minutes)** | Yes | A whole number from `1` to `1440`, default `5`. |

Either the **Authentication token** or both **Username** and **Password** must be set. Use **Test these settings** on the credentials step before saving; it runs the checklist below against the unsaved settings without storing anything. To rotate the token later, use the connection's **Update credentials** action.

## What is imported

Each row the search returns becomes one **Detection Finding** (OCSF class `2004`) event with vendor `Splunk` and product `Splunk Enterprise Security`. For an Enterprise Security notable event:

| OneUptime column | Splunk field |
| --- | --- |
| Event id (dedupe key) | `event_id`; when the export lacks it (it is added at search time by the `notable` macro), Splunk's bucket and offset (`_bkt` + `_cd`); else a hash of the row |
| Time | `_time` — the moment the correlation search created the notable |
| Message | `rule_title`, else `rule_description`, else the rule name |
| Rule name / id | `rule_name`, else `search_name`, else `source` |
| Severity | `urgency` (informational, low, medium, high, critical), else `severity` |
| Status | `status_label`, else `status_description`, else the default review-status name for the numeric `status` |
| Principal user / host / IP | `user` or `src_user`; `src` (as host or IP), `src_ip`, `src_host` |
| Target user / host / IP / port | `dest_user`; `dest` (as host or IP), `dest_ip`, `dest_host`; `dest_port` |
| Process | `process`, `process_name` or `parent_process` |
| Resource | `file_path`, `url` or `risk_object` |
| MITRE ATT&CK | `annotations.mitre_attack`, `annotations.mitre_attack.mitre_technique_id`, `mitre_technique_id` (techniques); `annotations.mitre_attack.mitre_tactic_id`, `annotations.mitre_attack.mitre_tactic`, `mitre_tactic` (tactics, ids or names) |
| Observables | Every user, host, IP, `dvc`, `host`, `file_hash`, `file_name`, `url`, `domain`, `query` and `risk_object` value |
| Attributes | Every field of the row, dotted keys included (`security_domain`, `owner`, `orig_sid`, `_raw`, ...) |

Rows from a search other than the notable index are imported the same way; columns whose fields are absent stay empty, and the whole row is still searchable through its attributes.

## How polling works

The connector ticks once a minute and polls every enabled connection that is due on its own interval. Each poll runs one export search — `search <your Search> | fields * | head <limit>` — through `POST /services/search/v2/jobs/export` with `earliest_time` and `latest_time` set to the poll window.

- **Time basis is creation time.** The window is applied to `_time`, which for a notable event is when the correlation search created it — not the time of the activity it matched. A correlation search that runs hourly over the previous hour stamps its notables with the time it ran, so they land in the window that covers that run. This is what makes a forward-moving cursor safe: a detection created late still lands in a later window instead of falling behind the cursor.
- **The first poll looks back 24 hours**, so a new connection imports the last day of notables immediately.
- Every later poll resumes from the connection's stored cursor with a **1 minute overlap**, so rows on a window boundary are never missed. Each scheduled poll covers at most 24 hours; a connection with an older cursor catches up in consecutive windows.
- **Duplicates are dropped by event id.** Rows already stored in the project with the same `event_id` (or bucket/offset identity) are skipped, so the overlap and the catch-up never import a notable twice.
- **Bounds.** A poll reads at most 10,000 rows. When the search returns more than the limit, the run is recorded as **Partial** with the warning `Stopped after collecting ... records; the window holds more`, the cursor is held, and the next poll re-reads the same window. Narrow the **Search** or shorten the poll interval if a connection stays partial.
- **Search heads older than 9.0.1.** When `search/v2/jobs/export` answers `404`, the connector retries the deprecated `search/jobs/export` endpoint and records a warning on the run. Upgrade the search head; current releases disable the v1 endpoint.

Use **Preview** and **Import history** in the connection's **Diagnostics** to read or import a chosen range without moving the live cursor.

## Test connection

**Test connection** (on the connections table, or **Test these settings** in the form) runs synchronously in the API process — no worker is involved — and returns a checklist. The Splunk-side checks are:

| Check | What it does | Passes when |
| --- | --- | --- |
| **Authenticate with Splunk** | `GET /services/authentication/current-context` with the configured credential | Splunk answers with the user's name and roles. The message names the user and roles so you can compare them with the role you granted. |
| **Run the search on Splunk** | The export search over the last 24 hours with `head 1` | Splunk runs the search. The message names which export endpoint (`search/v2/jobs/export` or the deprecated `search/jobs/export`) served it. |
| **Notable events available to import** | `search <your Search> | stats count` over the last 24 hours and the last 7 days | At least one row exists. Zero rows in 7 days is a **warning**: the credentials and search are fine, but there is nothing to import yet. |

The report also includes OneUptime's own checks — worker consumers on the Worker queue, the poll scheduler, the connection's schedule and the event store — so "credentials accepted but nothing ingests" points at the actual cause. A failed check shows a remediation; the sections below explain the messages.

## Troubleshooting

Every error the connector records — in a run, in a failed check, or in the connection's **Last Error** — starts with `Splunk Enterprise Security` followed by the step that failed. Credentials are redacted before the message is stored. Read the prefix first:

- `Splunk Enterprise Security authentication request failed (HTTP 401)` — Splunk rejected the credential. The token is wrong, expired or revoked; token authentication is disabled on the search head; or the username and password are wrong. Create a new token (**Settings → Tokens**) and use **Update credentials**.
- `Splunk Enterprise Security authentication request failed (HTTP 404)`, `... returned a non-JSON body.` — the URL does not point at the REST API. The usual cause is port `8000` (Splunk Web) instead of the management port `8089`, or an extra path. The message says so when Splunk answered with HTML.
- `Splunk Enterprise Security authentication request returned an unrecognized response shape` — the URL answered JSON that is not Splunk's `current-context` document: a proxy or gateway between OneUptime and Splunk answered instead of the search head.
- `Splunk Enterprise Security search export failed (HTTP 403)` or `count search failed (HTTP 403)` — the credential works but the role lacks the `search` capability or read access to the searched index. Add `notable` (or your index) to the role's allowed indexes.
- `Splunk Enterprise Security search export failed (HTTP 400)` or `... was rejected by Splunk on an HTTP 200` — Splunk could not parse the search. Run the **Search** value in Splunk Web to see the parser's message; remove `earliest`/`latest` and any leading pipe. The connector only adds the time range, `| fields *` and `| head`.
- `Splunk Enterprise Security search export failed (HTTP 404)` — both the v2 and the deprecated v1 export endpoints answered `404`; the URL is not a search head's management port.
- `Splunk Enterprise Security search export failed (HTTP 429)` — Splunk throttled the user. Scheduled polls retry the same window automatically.
- `Splunk Enterprise Security search export failed (HTTP 5xx)` — the search head reported an error (under load, or a search that hit a limit). The next poll retries the same window.
- `Splunk Enterprise Security search export returned a body that is not newline-delimited JSON.` — Splunk answered `200` with something other than the JSON export stream (HTML from Splunk Web, a login page from a proxy). The run is reported as failed rather than as an empty window on purpose: treating an unreadable body as "no events" would move the cursor past whatever it held.
- `Splunk Enterprise Security count search returned an unrecognized response shape` — the `| stats count` probe returned rows without a `count` field. This only affects **Test connection**; the poll does not use it.
- `Splunk Enterprise Security ... did not complete` — the request never got an answer: a timeout, DNS failure, a certificate OneUptime does not trust, or the egress guard refusing a private address. Check that the OneUptime API and worker processes can open a TLS connection to the management port. On OneUptime Cloud the search head must be reachable from the internet; on self-hosted deployments check `DATA_SOURCE_BLOCK_PRIVATE_ADDRESSES`.
- **Last Polled is `Never` and Last Error is empty** — the background worker has not executed the poll job at all, so nothing has ever reached Splunk. On self-hosted deployments the usual cause is `DISABLE_QUEUE_WORKERS=true` on the app container with no separate worker deployment draining the queues. Either set `DISABLE_QUEUE_WORKERS=false` (the `config.example.env` default that Docker Compose ships with), or run the dedicated worker deployment (Helm: `worker.enabled: true`, which is `false` by default). **Test connection** reports this as a failed worker or scheduler check.
- **Test connection passes but nothing appears** — open **Notable events available to import** in the report. Zero rows in the last 7 days means the search matched nothing on Splunk's side: check that Enterprise Security's correlation searches are enabled and creating notables (Incident Review), and that the **Search** is not narrower than you intended. Rows older than 24 hours at the time the connection was created are not imported by scheduled polling; use **Import history**.

## What you get

- **Security Events explorer** — search and filter notables by severity, status, rule, actor, target, or any observable.
- **Correlation** — every event's observables (users, hosts, IPs, domains, hashes) are indexed, so "everything mentioning this host" is one query, next to that host's logs and metrics.
- **Detection Rules** — [Sigma](https://sigmahq.io/) detections-as-code evaluated every minute against your events; matches open deduplicated alerts (with on-call routing) and write Detection Finding events.
- **Security Events monitors** — alert when matching event counts cross a threshold, with the same criteria, incident, and on-call machinery as every other monitor.
- **Dashboards & AI** — security event widgets on custom dashboards, and AI assistant tools (`search_security_events`, `security_event_summary`) for natural-language investigation.

## Billing

Security events are metered like other telemetry, per GB ingested. See [Pricing](https://oneuptime.com/pricing).
