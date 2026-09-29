# Microsoft Sentinel Integration

Bring [Microsoft Sentinel](https://learn.microsoft.com/en-us/azure/sentinel/overview) incidents into OneUptime, so the incidents your analytics rules open live in the same ClickHouse data lake as your logs, traces and metrics — searchable, correlated with observability data, alertable, and routed to on-call.

```text
Microsoft Sentinel workspace  ──►  OneUptime polls the incidents API  ──►  Incident Finding events
```

OneUptime polls the workspace's incidents through Azure Resource Manager with an app registration you create, and normalizes every incident to an [OCSF](https://schema.ocsf.io/) **Incident Finding** (class `2005`), OneUptime's canonical security-event shape, so detection rules and dashboards work the same whatever the source.

## Prerequisites

- A OneUptime project. Project owners, project admins and security admins can create connections; security members and viewers can read them.
- A Log Analytics workspace with Microsoft Sentinel enabled, in the Azure public cloud or Azure Government (US).
- Permission in Microsoft Entra ID to create an **app registration** and a **client secret** for it.
- Permission on the Azure resource group that contains the workspace to assign the **Microsoft Sentinel Reader** built-in role (an Owner or User Access Administrator on that resource group). This role is what allows the app to call `Microsoft.SecurityInsights/incidents/read`; it grants no write access to the workspace.

The connector never needs a user account: it authenticates with the OAuth 2.0 client credentials flow (application permissions only), using the `https://management.azure.com/.default` scope (`https://management.usgovcloudapi.net/.default` for Azure Government).

## Step 1 — Create the app registration and a client secret

1. In the [Microsoft Entra admin center](https://entra.microsoft.com), open **Identity → Applications → App registrations → New registration**.
2. Give it a name such as `OneUptime Sentinel connector`, keep **Accounts in this organizational directory only**, leave the redirect URI empty, and select **Register**.
3. On the registration's **Overview** page, copy the **Application (client) ID** and the **Directory (tenant) ID**. You will paste both into the connection.
4. Open **Certificates & secrets → Client secrets → New client secret**, choose an expiry, and select **Add**. Copy the secret **Value** immediately — the portal shows it only once. Paste the Value, not the Secret ID.

No API permissions need to be added on the registration: access to incidents is granted through an Azure role assignment, not through Microsoft Graph or Entra application permissions.

## Step 2 — Assign Microsoft Sentinel Reader on the resource group

1. In the [Azure portal](https://portal.azure.com) (or [portal.azure.us](https://portal.azure.us) for Azure Government), open the **resource group** that contains your Log Analytics workspace.
2. Select **Access control (IAM) → Add → Add role assignment**.
3. On the **Role** tab, search for and select **Microsoft Sentinel Reader**.
4. On the **Members** tab, choose **User, group, or service principal**, select **Select members**, search for the app registration by name, and select it.
5. Select **Review + assign**.

Microsoft recommends assigning Sentinel roles at the resource group rather than the workspace, so that the role also covers the `SecurityInsights` solution resource that the incidents API is served from. Assignments can take a few minutes to propagate; if **Test connection** reports `HTTP 403` right after assigning, wait and test again.

## Step 3 — Find the subscription, resource group and workspace name

Open the Log Analytics workspace in the Azure portal. Its **Overview** page lists **Subscription ID**, **Resource group** and the workspace **Name** (also shown in the page title). The same three values appear in the workspace's resource ID:

```text
/subscriptions/{Subscription ID}/resourceGroups/{Resource group}/providers/Microsoft.OperationalInsights/workspaces/{Workspace name}
```

## Step 4 — Create the connection in OneUptime

Open **Security Events → Connections** (`/dashboard/{projectId}/security-events/connections`), select **Add connection**, choose **Microsoft Sentinel**, and fill in the form:

| Field                       | Where to find it                                                                                                                                                                                                    | Required |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| **Directory (tenant) ID**   | App registration → Overview. The tenant GUID (a verified tenant domain such as `contoso.onmicrosoft.com` also works).                                                                                               | Yes      |
| **Application (client) ID** | App registration → Overview. A GUID.                                                                                                                                                                                | Yes      |
| **Subscription ID**         | Workspace → Overview. A GUID.                                                                                                                                                                                       | Yes      |
| **Resource group**          | Workspace → Overview. 1–90 letters, digits, underscores, hyphens, periods or parentheses; not ending in a period.                                                                                                   | Yes      |
| **Workspace name**          | Workspace → Overview. Letters, digits and hyphens, starting and ending with a letter or digit.                                                                                                                      | Yes      |
| **Cloud**                   | **Azure public cloud** (`login.microsoftonline.com` / `management.azure.com`) or **Azure Government (US)** (`login.microsoftonline.us` / `management.usgovcloudapi.net`).                                           | Yes      |
| **Client secret**           | App registration → Certificates & secrets. The secret **Value**. Write-only: encrypted at rest, never returned by the API, never shown back on the page. Use **Update credentials** on the connection to rotate it. | Yes      |

The polling step of the form asks for a **Name**, an optional **Description**, whether the connection is **Enabled**, and the **Poll interval (minutes)** — a whole number from `1` to `1440`, default `5`.

Select **Test these settings** before saving. The test runs against your settings without persisting anything, so a wrong secret or a missing role assignment is caught before the connection exists.

## What is imported

Each Sentinel incident becomes one **Incident Finding** event (OCSF class `2005`, category `Findings`, activity `Create`) attributed to the `Microsoft Sentinel` telemetry service:

| OCSF column                   | Sentinel incident field                                                                                                                                              |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `time`                        | `properties.createdTimeUtc` (when Sentinel created the incident)                                                                                                     |
| `eventUid` (dedupe key)       | `name` — the incident GUID                                                                                                                                           |
| `message`, `ruleName`         | `properties.title`                                                                                                                                                   |
| `ruleId`                      | The rule GUID at the end of the first `properties.relatedAnalyticRuleIds` entry                                                                                      |
| `severityName` / `severityId` | `properties.severity`: High → `High` (4), Medium → `Medium` (3), Low → `Low` (2), Informational → `Informational` (1)                                                |
| `statusName`                  | `properties.status`: `New`, `Active` or `Closed`                                                                                                                     |
| `mitreTactics`                | `properties.additionalData.tactics`, mapped to ATT&CK ids (`Persistence` → `TA0003`)                                                                                 |
| `principalUser`               | `properties.owner.userPrincipalName`, or `properties.owner.email`                                                                                                    |
| `targetResource`              | `properties.incidentUrl` (deep link into the Azure portal)                                                                                                           |
| `observables`                 | Owner UPN, email and object id, plus every label name                                                                                                                |
| `attributes`                  | The complete incident, flattened to dot-notation keys (`properties.classification`, `properties.additionalData.alertsCount`, `properties.firstActivityTimeUtc`, ...) |

Closed incidents created inside the polled window are imported too; filter on `statusName` in the Security Events explorer if you only want open ones.

## How polling works

The connector ticks once a minute and polls every enabled connection that is due on its own interval. Each poll lists incidents by their **creation time** (`properties/createdTimeUtc`), ordered oldest first, 50 per page, following the API's `nextLink` until the window is read:

```text
GET https://management.azure.com/subscriptions/{sub}/resourceGroups/{rg}/providers/Microsoft.OperationalInsights/workspaces/{ws}/providers/Microsoft.SecurityInsights/incidents
    ?api-version=2024-03-01
    &$filter=(properties/createdTimeUtc ge {windowStart}) and (properties/createdTimeUtc lt {windowEnd})
    &$orderby=properties/createdTimeUtc asc
    &$top=50
```

Creation time is the poll basis on purpose. A scheduled analytics rule that runs hourly creates its incident long after the activity it matched; the incident's own `firstActivityTimeUtc` can be hours or days earlier. A cursor over activity time would skip every such incident. The activity times are still stored in `attributes` for anyone who needs them, and the diagnostics samples show both.

- The **first poll looks back 24 hours**, so a new connection shows its recent incidents immediately instead of an empty window.
- Every later poll resumes from the saved cursor with a **1 minute overlap**, so an incident created on a window boundary is never skipped.
- Each poll reads up to 24 hours past the cursor; a connection with an older cursor catches up in consecutive windows.
- Incidents are **deduplicated by the incident GUID** (`name`) within the project, so the overlap, retries and historical imports never store the same incident twice.

### When a window holds more than one poll can read

A poll reads at most 20 pages of 50 incidents (1,000 incidents) per run. When that limit stops a run before the window is read, the run is reported as **Partial** with a warning such as:

```text
Stopped after 20 incidents requests (the per-run request limit) before reading the whole window. Incidents are read oldest first; every incident created before 2026-09-14T08:12:44.000Z was read.
```

Because incidents are read oldest first, OneUptime moves the cursor to the creation time of the last incident read, and the next poll carries on from there with the same window length. A busy workspace catches up about 1,000 incidents per poll instead of re-reading the same ones. The overlap re-reads the incidents that share that last creation time, and dedupe drops the copies.

If a run cannot get past the saved cursor at all, OneUptime shortens the window instead of re-reading the same one:

- The next poll reads a window **half as long from the same starting point**, and keeps halving down to one minute until a window reads completely. The run's warning says so: `This window holds more records than one poll can read; the next poll reads a {n} minute window from the same starting point.`
- After a window reads completely, the next one is **twice as long again**, back up to 24 hours.
- If even a one minute window holds more than one poll can read, polling **moves past that minute** so newer incidents keep arriving. The run stays **Partial** and **Last Error** reads `More records were created in the one minute from {cursor} to {end} than one poll can read. Polling moved past this minute so newer records keep arriving; use Import this time range in Diagnostics on this minute to recover what one run can read.` Run **Import history** on that minute to recover the incidents it skipped.
- A run that fails outright (an error from Microsoft Entra or Azure Resource Manager) leaves the cursor and the window length unchanged, and the next poll retries the same window. A request that **timed out** keeps the cursor but halves the next window, since a window too heavy to answer in time would otherwise time out on every retry.

Shortening the **Poll interval** does not change any of this: the interval only decides how often a poll starts, not where its window begins.

Use **Diagnostics** on a connection to see recent runs, preview a time range without importing, import history (up to 7 days per import), and copy a report for support. Credentials are never included.

## Test connection

**Test connection** runs synchronously in the API process — deliberately not through the background workers, so it can still answer when the workers are the problem. The checklist:

1. **Configuration** — every field is present and well formed. Nothing is contacted if this fails.
2. **Authenticate with Microsoft Entra** — a client-credentials token for Azure Resource Manager is issued with your client secret.
3. **Read incidents** — one incident created in the last 24 hours is requested with `$top=1`. This proves the Microsoft Sentinel Reader assignment and the workspace path.
4. **Incidents available to import** — how many incidents were created in the last 24 hours and the last 7 days (one 50-incident page each; `50+` means there are more). A quiet workspace produces a warning, not a failure.
5. **Background workers**, **Poll scheduler** and **Security event storage** — whether a process is consuming OneUptime's Worker queue, whether the minute-cadence poll job is registered, and whether the security event store answers. A connection that tests green on its provider checks but never polls is almost always a worker deployment problem: set `DISABLE_QUEUE_WORKERS=false` on the app container or enable the worker deployment (Helm `worker.enabled: true`).
6. **Scheduled polling** (saved connections only) — whether polling is enabled, whether a queued run is stuck waiting for a worker, and whether the connection is being polled on schedule.

Each failed check carries remediation text. Tests never move the cursor or write events.

## Troubleshooting

The connection's **Last Error** stores the complete error message with credentials redacted, behind a prefix naming the step that failed. Select **View Error** in the connection's **Actions** column to read it. Read the prefix first:

- **`Microsoft Sentinel token request failed (HTTP ...)`** — Microsoft Entra refused the client-credentials request; Azure was never contacted. The message quotes Entra's `AADSTS` code:
  - `AADSTS7000215` / `invalid_client` — the **Client secret** is wrong, expired, or the Secret ID was pasted instead of the Value. Create a new secret and use **Update credentials**.
  - `AADSTS700016` / `unauthorized_client` — the **Application (client) ID** was not found in the **Directory (tenant) ID** given. Compare both with the registration's Overview page.
  - `AADSTS90002` or `HTTP 404` — the tenant does not exist; the **Directory (tenant) ID** is wrong or belongs to the other cloud. Check **Cloud**.
  - `HTTP 429` / `HTTP 5xx` — Entra is throttling or unavailable; the next poll retries on its own.
- **`Microsoft Sentinel token request returned ...`** — Entra answered but with something unusable: a body that is not JSON (`returned a non-JSON body`), no `access_token`, or an unexpected shape. Usually a proxy or gateway between OneUptime and `login.microsoftonline.com`.
- **`Microsoft Sentinel token request failed:`** (no HTTP status) — the request never got an answer: DNS, TLS, egress firewall or a connection refused between the OneUptime worker and Microsoft Entra.
- **`Microsoft Sentinel token request timed out after ... seconds with no response`** — Entra did not answer inside the request timeout. Check outbound HTTPS from the app and worker processes.
- **`Microsoft Sentinel incidents list failed (HTTP ...)`** — Azure Resource Manager rejected the incidents request:
  - `HTTP 401` — ARM did not accept the token. Almost always a **Cloud** mismatch (a public-cloud token presented to Azure Government, or the reverse), or the app registration was deleted. A stale token that expired between pages is retried once with a fresh one automatically.
  - `HTTP 403` / `AuthorizationFailed` — the app registration lacks **Microsoft Sentinel Reader** on the resource group that contains the workspace, or the assignment has not propagated yet. Repeat Step 2 and wait a few minutes.
  - `HTTP 404` — no workspace matched **Subscription ID**, **Resource group** and **Workspace name**, or Microsoft Sentinel is not enabled on it. Copy the values from the workspace's Overview page.
  - `HTTP 429` — ARM is throttling the subscription; the next poll retries.
  - `HTTP 400` — ARM rejected the query itself. The request is built by the connector, not from your settings; report the message to OneUptime support.
  - `HTTP 5xx` — ARM reported a server-side problem; the next poll retries.
- **`Microsoft Sentinel incidents list returned ...`** — ARM answered `200` but the body was not a readable incidents page: not JSON, not an object with a `value` array, or a `nextLink` that is unusable or points at a host other than Azure Resource Manager (the connector refuses to send the token anywhere else). Reported rather than treated as an empty window, because advancing the cursor past an unreadable page would lose incidents.
- **`Microsoft Sentinel incidents list failed:`** (no HTTP status) or **`... timed out after ... seconds with no response`** — the incidents request never got an answer. Check outbound HTTPS from the OneUptime worker to `management.azure.com` (or `management.usgovcloudapi.net`).
- **Last Polled is `Never` and Last Error is empty** — polling has never run. On self-hosted deployments the usual cause is `DISABLE_QUEUE_WORKERS=true` on the app container with no separate worker deployment draining the queues. Run **Test connection**: its **Background workers** and **Poll scheduler** checks name the cause.
- **A run is `Partial` with `Stopped after 20 incidents requests (the per-run request limit) before reading the whole window`** — the window held more than the 1,000 incidents one run can read. Nothing is lost: the cursor moves to the last incident read and the next poll continues from there (see [When a window holds more than one poll can read](#when-a-window-holds-more-than-one-poll-can-read)). A connection that stays `Partial` for many polls in a row is catching up on a backlog; **Last Polled** and **Last Event Imported** keep moving while it does.
- **`Microsoft Sentinel returned incidents out of creation-time order, so this run cannot name a point to resume from.`** — the incidents API ignored the oldest-first order the connector asked for, so the run cannot safely move the cursor to its last incident. The next poll shortens the window instead, as described above. If it recurs, report it to OneUptime support with the run's report.
- **Last Error reads `More records were created in the one minute from ... than one poll can read`** — a single minute held more incidents than one poll can read, so polling moved past it. Run **Import this time range** in **Diagnostics** on that minute to recover what one run can read; an import has the same per-run limit as a poll.
- **Everything passes but nothing is imported** — check **Incidents available to import** in the test report. `0` in the last 7 days means the workspace's analytics rules have not opened incidents; that is not a connector fault. Confirm rules are enabled and set to create incidents (Microsoft Sentinel → Analytics → rule → Incident settings).

## Azure Government

Set **Cloud** to **Azure Government (US)**. The connector then requests tokens from `login.microsoftonline.us` with the `https://management.usgovcloudapi.net/.default` scope and lists incidents from `management.usgovcloudapi.net`. Everything else, including the role assignment, is identical.

## What you get

- **Security Events explorer** — search and filter incidents by severity, status, owner, label or tactic, next to the rest of your security events.
- **Correlation** — every incident's observables (owner, labels) are indexed alongside the observables of every other source.
- **Detection Rules** — [Sigma](https://sigmahq.io/) rules evaluated every minute over imported incidents; matches open deduplicated alerts with on-call routing.
- **Security Events monitors** — alert when the number of new High incidents crosses a threshold, with the same incident and on-call machinery as every other monitor.
- **Dashboards & AI** — security event widgets on custom dashboards, and AI assistant tools for natural-language investigation.

## Billing

Security events are metered like other telemetry, per GB ingested. See [Pricing](https://oneuptime.com/pricing).
