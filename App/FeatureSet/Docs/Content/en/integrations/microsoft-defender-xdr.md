# Microsoft Defender XDR Integration

Bring [Microsoft Defender XDR](https://learn.microsoft.com/en-us/defender-xdr/) alerts into OneUptime, so endpoint, identity, email and cloud-app detections from every Defender workload live in the same ClickHouse data lake as your logs, traces and metrics — searchable, correlated with observability data, alertable, and routed to on-call.

The connector polls the [Microsoft Graph security API](https://learn.microsoft.com/en-us/graph/api/security-list-alerts_v2) (`alerts_v2`) with an app registration's own credentials. No agent, playbook or Sentinel workspace is needed.

```text
Microsoft Defender XDR  ──►  Graph security API (alerts_v2)  ──►  OneUptime poll  ──►  Detection Finding events
```

Every alert is normalized to [OCSF](https://schema.ocsf.io/) (Open Cybersecurity Schema Framework), OneUptime's canonical security-event shape, so rules and dashboards work the same whatever the source dialect.

## Prerequisites

- A OneUptime project. Project owners, project admins and security admins can create connections; security members and viewers can read them and their run history.
- A Microsoft Entra tenant with a **Microsoft Defender XDR** license (any Defender workload onboarded to the Microsoft Defender portal — Defender for Endpoint, Identity, Office 365, Cloud Apps, or Microsoft Sentinel connected to the portal).
- An Entra role that can register applications (for example **Application Administrator** or **Cloud Application Administrator**), and a **Global Administrator** or **Privileged Role Administrator** to grant admin consent for the Microsoft Graph application permission below.
- Outbound HTTPS from the OneUptime app and worker processes to `login.microsoftonline.com` and `graph.microsoft.com` (or `login.microsoftonline.us` and `graph.microsoft.us` for Azure Government / GCC High).

## Step 1 — Create the app registration

The connector authenticates with the [OAuth 2.0 client credentials flow](https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-client-creds-grant-flow), so it needs an application (not a user) with one application permission.

1. In the [Microsoft Entra admin center](https://entra.microsoft.com), open **Identity → Applications → App registrations → New registration**. Name it (for example `OneUptime Security Events`), keep **Accounts in this organizational directory only**, leave the redirect URI empty, and select **Register**.
2. On the registration's **Overview** page, copy the **Application (client) ID** and the **Directory (tenant) ID**.
3. Open **API permissions → Add a permission → Microsoft Graph → Application permissions**, search for `SecurityAlert.Read.All`, select it, and select **Add permissions**. This is the least-privileged permission the [List alerts_v2](https://learn.microsoft.com/en-us/graph/api/security-list-alerts_v2#permissions) method accepts for application access; do not add `SecurityAlert.ReadWrite.All`.
4. Select **Grant admin consent for &lt;tenant&gt;** and confirm. The permission's status must read **Granted**. Without consent every read returns `403`.
5. Open **Certificates & secrets → Client secrets → New client secret**, choose an expiry, and copy the secret **Value** immediately (it is shown once). The **Secret ID** column is not the secret.

Set a reminder for the secret's expiry: when it lapses, polling stops with a `Microsoft Defender XDR token request failed (HTTP 401)` error until you rotate it with **Update credentials**.

## Step 2 — Create the connection

In OneUptime, open **Security Events → Connections** (`/dashboard/{projectId}/security-events/connections`), select **Add connection**, and choose **Microsoft Defender XDR** under **EDR / XDR**.

| Field | Where to find it | Notes |
| --- | --- | --- |
| **Directory (tenant) ID** | App registration → **Overview** | The Entra tenant that owns the app registration. The tenant GUID, or a verified domain such as `contoso.onmicrosoft.com`. |
| **Application (client) ID** | App registration → **Overview** | The GUID of the app registration granted `SecurityAlert.Read.All`. |
| **Cloud** | Where the tenant lives | **Azure public cloud** (default; also for Microsoft 365 GCC) or **Azure Government (US)** (GCC High: `login.microsoftonline.us` and `graph.microsoft.us`, per [national cloud deployments](https://learn.microsoft.com/en-us/graph/deployments)). Microsoft 365 DoD and 21Vianet (China) endpoints are not supported. |
| **Client secret** | App registration → **Certificates & secrets** | The secret **Value**. Write-only: encrypted at rest, never returned by the API, never shown back on the page. Rotate it later with the connection's **Update credentials** action. |

The connection also has a **Name**, an **Enabled** switch and a **Poll interval (minutes)** — a whole number from `1` to `1440`, default `5`.

Select **Test these settings** before saving to run the checklist described below against the unsaved credentials. Nothing is stored until you save.

## What is imported

Every Defender XDR [alert](https://learn.microsoft.com/en-us/graph/api/resources/security-alert) becomes one **Detection Finding** (OCSF class `2004`) event attributed to the `Microsoft Defender XDR` telemetry service, with vendor `Microsoft` and product `Microsoft Defender XDR`:

| OCSF column | Source |
| --- | --- |
| `eventUid` | `id` (the Graph alert id — also the dedupe key) |
| `time` | `firstActivityDateTime`, falling back to `createdDateTime` |
| `message`, `ruleName` | `title` |
| `ruleId` | `detectorId`, falling back to `alertPolicyId` |
| `severityName` | `severity` (`informational`, `low`, `medium`, `high`; `unknown` stays Unknown) |
| `statusName` | `status` (`new` → New, `inProgress` → In Progress, `resolved` → Resolved) |
| `mitreTechniques` | `mitreTechniques[]` |
| `mitreTactics` | `categories[]` / `category` when the value is an ATT&CK tactic name (for example `CredentialAccess` → `TA0006`); other categories stay in attributes |
| `principalHost`, `principalUser`, `principalIp`, `principalProcess` | `evidence[]` items with the `source`, `attacker` or `compromised` role (device, user, IP and process evidence), else the first of their kind |
| `targetHost`, `targetUser`, `targetIp`, `targetResource` | `evidence[]` items with a target-side role (`destination`, `attacked`, `created`, `added`, `edited`, `scanned`); URLs, mailboxes and cloud resources fill `targetResource` |
| `observables` | Every hostname, FQDN, IP, user (UPN or `DOMAIN\account`), file name, SHA-1/SHA-256, URL, domain, mailbox address and resource id found in `evidence[]` |
| `attributes` | The complete alert, flattened to dot-notation keys (`evidence.0.hostName`, `serviceSource`, `incidentId`, `alertWebUrl`, ...) |

Alerts from every `serviceSource` are imported, including Microsoft Sentinel alerts once Sentinel is connected to the Defender portal. Incidents are not imported; each alert carries its `incidentId` and `incidentWebUrl` in attributes.

## How polling works

- **Creation time is the cursor.** The connector lists alerts by `createdDateTime` — the moment Defender created the alert — never by the time of the activity the alert describes. Defender frequently creates an alert hours after its `firstActivityDateTime`; a cursor on activity time would skip every such alert. Each request is `GET /v1.0/security/alerts_v2?$filter=createdDateTime ge {start} and createdDateTime lt {end}&$top=100`, following `@odata.nextLink` until the window is exhausted.
- **First poll looks back 24 hours**, so a newly saved connection shows its recent alerts immediately instead of an empty window.
- **Every later poll starts 1 minute before the saved cursor.** An alert created on a window boundary is therefore read twice and imported once.
- **Duplicates are dropped by the vendor id.** Before inserting, the poller looks up each alert's `id` among the project's existing `Microsoft` / `Microsoft Defender XDR` events; alerts already stored are counted as duplicates, never re-imported. This is what makes the overlap, retries and historical imports safe.
- **A poll covers at most 24 hours.** A connection whose cursor fell behind (workers were down, the tenant was throttled) catches up in consecutive 24 hour windows rather than skipping to the present.
- **Bounded reads.** One run reads at most 20 pages of 100 alerts and stops after 10,000 alerts. When a bound stops a run, the run is reported as **Partial**, the warning names the limit, and the cursor is held so the next poll re-reads the same window from its start. Nothing is silently dropped.
- **The cursor moves only on a complete run.** A transport failure, a `4xx`/`5xx` from Graph, or an alert that fails normalization holds the cursor; the error is stored on the connection's **Last Error** with credentials redacted, and the next poll retries the same window.

The scheduler ticks once a minute and polls every enabled connection whose interval has elapsed. Use **Preview** and **Import history** in the connection's **Diagnostics** to read or import a chosen range of up to 7 days without touching the live cursor.

## Test connection

**Test connection** (on a saved connection's row, or **Test these settings** in the form) runs synchronously in the API process — it does not need a worker — and returns a checklist with remediation text under each failed check:

1. **Configuration** — the four fields are present and well formed (tenant GUID or domain, client GUID, known cloud, non-empty secret). Nothing is contacted when this fails.
2. **Authenticate with Microsoft Entra** — a client-credentials token for `https://graph.microsoft.com/.default` (or `graph.microsoft.us`) is issued. Fails on a wrong or expired secret, a wrong tenant or client id, or the wrong cloud.
3. **Read alerts from Microsoft Graph** — a one-record read (`$top=1`) of alerts created in the last 24 hours. A `403` here is the missing `SecurityAlert.Read.All` application permission, missing admin consent, or a tenant without a Defender XDR license.
4. **Alerts available to import** — how many alerts were created in the last 24 hours and in the last 7 days. Counts read a single page of 100, so a busy tenant shows `100+`. A tenant with zero alerts in 7 days is reported as a warning, not a failure: polling will import new alerts as Defender creates them.
5. **Background workers**, **Poll scheduler**, **Security event storage** and (for a saved connection) **Scheduled polling** — OneUptime's own side: whether a process is consuming the Worker queue, whether the minute-cadence poll job is registered, whether the security event store answers, and whether this connection's polls are running on schedule. These are the checks that distinguish "connected but nothing ingests" from "nothing to ingest".

A test never writes events and never moves the cursor. On a saved connection the report is kept in the run history.

## Troubleshooting

Read the prefix of **Last Error** (or of a failed check's message) first: it names the step that failed. Every stored message has credentials redacted; **View Error → Copy Error** copies it for support.

- `Microsoft Defender XDR token request failed (HTTP ...)` — Microsoft Entra rejected the client-credentials request before Graph was contacted. The message ends with a hint keyed on Entra's `error` code: `invalid_client` (`AADSTS7000215`) is a wrong, expired or wrong-app secret — create a new one under **Certificates & secrets** and use **Update credentials**; `unauthorized_client` (`AADSTS700016`) means the **Application (client) ID** is not in that **Directory (tenant) ID**, or the **Cloud** is wrong; `AADSTS90002` means the tenant itself was not found; `invalid_scope` means the Graph scope is not valid in the selected cloud.
- `Microsoft Defender XDR token request returned ...` — Entra answered, but with something unusable: no `access_token`, or a body that is not JSON. Usually a proxy or gateway between OneUptime and `login.microsoftonline.com`, not the credentials.
- `Microsoft Defender XDR token request did not complete: ...` — the token endpoint could not be reached or did not answer in time. Check outbound HTTPS from the OneUptime app and worker processes to `login.microsoftonline.com` (or `login.microsoftonline.us`).
- `Microsoft Defender XDR alerts request failed (HTTP ...)` — Graph rejected the alerts read. The message restates Graph's error code and adds a hint: a `403` (`Authorization_RequestDenied`) is the missing `SecurityAlert.Read.All` application permission or missing admin consent, or a tenant with no Defender XDR license — consent changes take a few minutes to apply; a `401` (`InvalidAuthenticationToken`) after a successful token usually means the **Cloud** does not match the tenant; a `429` (`TooManyRequests`) is throttling — the message includes Graph's `Retry-After` and the next poll retries the same window; a `5xx` is Graph's; a `400` is a query Graph would not run — copy the message for support, the query is built by OneUptime, not from your settings.
- `Microsoft Defender XDR alerts request returned ...` — Graph answered `200` with a body the connector could not use: not JSON, no `value` array, or an `@odata.nextLink` that is not an `https://` URL on the configured Graph host. It is reported rather than treated as an empty window on purpose, so the cursor never advances past alerts that were not read. A next-page link on an unexpected host is refused so the bearer token is never sent elsewhere.
- `Microsoft Defender XDR alerts request did not complete: ...` — Graph could not be reached or did not answer within the request timeout (60 seconds for polls, 20 seconds for tests). Check outbound HTTPS to `graph.microsoft.com` (or `graph.microsoft.us`).
- **Test passes but Last Polled is `Never`** — the poll job has never run. Read the **Background workers** and **Poll scheduler** checks: on self-hosted deployments the usual cause is `DISABLE_QUEUE_WORKERS=true` on the app container with no separate worker deployment draining the queues. Either set `DISABLE_QUEUE_WORKERS=false`, or run the dedicated worker deployment (Helm: `worker.enabled: true`, which is `false` by default).
- **Polls succeed but a known alert is missing** — check the alert's `createdDateTime` in the Defender portal against the run's window in **Diagnostics**; the window is on creation time, not activity time. An alert created before the connection existed is older than the initial 24 hour lookback: use **Import history** for it. A run reported as **Partial** was stopped by a bound and re-reads its window on the next poll.
- **Every alert imports twice** — it does not: the second read of the 1 minute overlap is counted as a duplicate in the run result and is not stored. If you see two events with the same `eventUid`, they were imported under different products (for example the same alert also arriving through a Microsoft Sentinel connection); dedupe is scoped per vendor and product.

## What you get

- **Security Events explorer** — search and filter Defender alerts by severity, status, MITRE technique, host, user, IP or any observable, next to that host's logs and metrics.
- **Correlation** — every alert's evidence (devices, users, IPs, files, URLs) is indexed as observables, so "everything mentioning this host" is one query across every source.
- **Detection Rules** — [Sigma](https://sigmahq.io/) detections-as-code evaluated every minute against your events; matches open deduplicated alerts (with on-call routing) and write Detection Finding events.
- **Security Events monitors** — alert when matching event counts cross a threshold, with the same incident and on-call machinery as every other monitor.
- **Dashboards & AI** — security event widgets on custom dashboards, and AI assistant tools (`search_security_events`, `security_event_summary`) for natural-language investigation.

## Billing

Security events are metered like other telemetry, per GB ingested. See [Pricing](https://oneuptime.com/pricing).
