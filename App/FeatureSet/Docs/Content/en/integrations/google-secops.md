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

- A OneUptime project with a **Telemetry Ingestion Key** (**Settings → Telemetry Ingestion Keys**) for the webhook and UDM forwarding paths.
- A Google SecOps tenant. For the managed connector: permission to create a Google Cloud service account with Chronicle API read access, and the project owner, project admin or security admin role in OneUptime (security members and viewers can read connections but not create them).

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

OneUptime polls your tenant's detections and alerts on an interval — no SOAR configuration needed. Google SecOps is a provider of **Security Event Connections**, so it is created, tested, polled and diagnosed on the same page and in the same way as every other managed connector.

```text
Google SecOps instance  ──►  OneUptime reads it in three passes  ──►  Detection Finding events
```

### Step 1 — Create a service account key

1. In Google Cloud, create a **service account** on the project your SecOps instance is bound to, and grant it the **Chronicle API Viewer** role (`roles/chronicle.viewer`). That role includes the `legacySearchDetections`, `legacySearchCuratedDetections` and `legacyFetchAlertsView` permissions the connector reads with.
2. On the service account's **Keys** tab, add a key of type **JSON** and download it. You paste the whole file into the connection. Its `token_uri` must be an `https` URL on a Google host, which a key downloaded from Google Cloud already is.

### Step 2 — Find the region and instance resource name

In Google SecOps, open **SIEM Settings → Profile**. The instance resource name has the form `projects/{project}/locations/{location}/instances/{instance}`, where the instance component is the SecOps instance ID; a connection display name or service-account name is not a substitute. The region is the regional endpoint that serves that location, and it must match the locations segment of the instance resource name, or the connection is rejected when you save it.

### Step 3 — Create the connection in OneUptime

Open **Security Events → Connections** (`/dashboard/{projectId}/security-events/connections`), select **Add connection**, choose **Google SecOps**, and fill in the form:

| Field                      | Where to find it                                                                                                                                                                                                                   | Required      |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- |
| **Region**                 | The Google SecOps regional endpoint (`us`, `europe`, `asia-southeast1`, ...) that matches the location in your instance resource name. There is no default, so a tenant outside the US cannot save the wrong endpoint by accident. | Yes           |
| **Instance resource name** | Google SecOps **SIEM Settings → Profile**: `projects/{project}/locations/{location}/instances/{instance}`.                                                                                                                         | Yes           |
| **Service account JSON**   | Google Cloud → the service account → **Keys**. Paste the whole JSON key file. Write-only: encrypted at rest, never returned by the API, never shown back on the page. Use **Update credentials** on the connection to rotate it.   | Yes           |
| **Data to import**         | **Alerts** are always imported because Google's alerts API always returns them. Select **Detections** to also import rule matches that did not generate an alert. This does not forward raw UDM events; use option 3 for those.    | Alerts always |

The polling step of the form asks for a **Name**, an optional **Description**, whether the connection is **Enabled**, and the **Poll Interval (Minutes)** — a whole number from `1` to `1440`, default `5`. Anything outside that range is rejected when you save.

Select **Test these settings** under **Test before saving** before you save. The test runs against the values on the form without storing anything, so a malformed key, a missing role or a wrong instance is caught before the connection exists. On the edit form the same button tests the **Region**, **Instance resource name** and **Data to import** shown on screen with the stored key; a credential field left blank keeps the stored key. When anything tested differs from what the connection has saved, including a newly entered key, no run-history row is recorded, because the connection does not have those settings yet.

New detections are imported as **Detection Finding** events attributed to a `Google SecOps` telemetry service.

The connections list shows **Name**, **Provider** (with the connection's Data to import selection underneath), **Status** (Enabled or Disabled), **Health**, **Interval (Minutes)**, **Last Polled**, **Last Successful Poll** and **Last Event Imported**. When a connection has an error, **View Error** appears in its **Actions** column, next to **Test connection**, **Run now**, **Diagnostics**, **Edit** and **Update credentials**. Enabled means automatic polling is configured. Last Polled records an attempt; a successful empty window does not establish that a particular detection was imported.

**Health** reads **Last poll succeeded** only once an event has been imported. Until then a succeeding connection reads **Polling, no events imported yet**, which is the state to investigate with Test connection. The other states are **No records returned**, **Partial import**, **Catching up**, **Last poll failed**, **Poll overdue**, **Schedule paused** and **Waiting for first poll**; hover a state for what it means.

> The connector uses the Chronicle `v1alpha` legacy detections and alerts APIs, which Google ships as pre-GA. When a poll fails, the connection's **Last Error** field stores the complete error message with credentials redacted, behind a prefix naming the step that failed — including the case where Chronicle answers `200` and puts the rejection inside the body. Select **View Error** in the connection's **Actions** column to read the message, then **Copy Error** in the dialog to copy it for support.

### How polling works

Once a minute a background worker queues a poll for every enabled connection whose interval has passed since it was last polled. Each poll is a run in the connection's history, executed by a worker. It reads one time window three ways and merges the results by detection id, so a record returned by more than one pass is stored once:

1. **Rule detections by created time** — `legacy:legacySearchDetections` with `ruleId=-` (every revision of every rule) and `listBasis=CREATED_TIME`, following `nextPageToken` until the page is the last one.
2. **Curated rule detections by created time** — `legacy:legacySearchCuratedDetections`, the same way. A tenant without curated-rule access answers this pass with `400`, `403` or `404`; that is recorded as a warning on the run, not as a failure.
3. **The alerts view by detection time** — `legacy:legacyFetchAlertsView`, which covers telemetry alerts, SOAR alerts and machine-intelligence alerts whose detection time is close to real time. The endpoint has no pagination, so a response Google limits is split into smaller windows and read again.

Polling by **created time** is the whole design. A Google SecOps rule runs on a schedule (every 10 minutes, hourly, daily), and the detection it creates carries a `detectionTime` that is the end of the rule's time window or the time of the matched event, while `createdTime` is when the detection engine actually produced it. A detection created at 10:05 for a window ending 09:00 has a detection time that is already behind a cursor that moved past 09:00 several polls ago, so a connector that polls by detection time never sees it, and neither does any late-arriving event. Reading by created time makes each poll ask "what did Google create since I last looked", which is the question that has an answer. Every run records its creation lag — how many fetched records were created more than one poll interval (plus a minute) after their detection time, and the largest gap — so the effect is visible in Diagnostics.

The first poll of a new connection looks back **24 hours** by created time. Every poll after that resumes from the connection's stored cursor with a **1 minute** overlap; a record created on a window boundary is read by both polls and stored once, because polls skip events already stored with the same source identifier. Each scheduled poll reads at most **24 hours** past the cursor, so a connection with an older saved cursor catches up in consecutive 24 hour windows (Health reads **Catching up**) instead of discarding the intervening detections. Use **Import this time range** in Diagnostics for records created before the first 24 hour window.

#### When a window holds more than one poll can read

The connector gives each poll fixed budgets: the two created-time passes share **20** search pages, the alerts view has **16** requests of its own, and the whole read stops after **4 minutes**. A pass that a budget stopped part way is recorded as a warning check that names the budget (for example `Read rule detections by created time was stopped by the request budget after 20 requests.`), and a pass the budget never let start is a skipped check with the same reason in the run's warnings — never a success. A window with more detections than that cannot be read in one poll, and polling never re-reads the same window forever:

1. **Narrow.** Google's search endpoints return the newest detections first, so a poll that stops early has no point it can resume from. The poll is recorded as **Partial**, the cursor stays where it was, and the next poll reads half as long a window from the same starting point, with the warning `This window holds more records than one poll can read; the next poll reads a {n} minute window from the same starting point.` Halving continues down to one minute until a window fits.
2. **Grow back.** Every complete poll doubles the next window, up to the 24 hour maximum, so a burst costs a few short polls rather than a permanently slow connection.
3. **Move past a single minute.** If even one minute holds more detections than a poll can read, polling moves the cursor past that minute so newer detections keep arriving. The run is **Partial** and the same text leads **Last Error**: `More records were created in the one minute from {start} to {end} than one poll can read. Polling moved past this minute so newer records keep arriving; use Import this time range in Diagnostics on this minute to recover what one run can read.` To recover what one run can read, open **Diagnostics**, choose a custom range covering that minute (the range inputs use your local time; the message is in UTC) and run **Import this time range**; an import has the same per-run limits as a poll. Already imported detections are skipped.

A Partial poll also stores its warnings in **Last Error**, where they stay until a complete poll clears them. A poll that fails outright (an error, not too many records) keeps its cursor and window length and is retried on the next tick. The one exception is a request that timed out: the next poll reads half as long a window from the same starting point (`The source did not answer in time for this window; the next poll reads a {n} minute window from the same starting point.`), since a window too heavy to answer in time would otherwise time out on every retry. Shortening the poll interval changes none of this: the window is decided by the cursor and the last poll's outcome, not by how often polls run.

### Test connection

**Test connection**, on the connection's row or in **Diagnostics**, runs synchronously in the API process. It does not need a background worker, which is exactly why it can tell you when no worker is running. The checklist:

1. **Configuration** — every field is present and well formed: a supported **Region** that matches the instance's location, an **Instance resource name** of the right shape, and a **Service account JSON** key with `client_email`, a readable `private_key` and a Google `token_uri`. Nothing is contacted if this fails.
2. **Authenticate with Google** — the key is exchanged for an access token at Google's OAuth endpoint, before Chronicle is contacted.
3. **Read rule detections**, **Read curated rule detections** and **Read the alerts view** — a one-record probe of each pass over the last 24 hours. A curated read answered with `400`, `403` or `404` is a warning, because the tenant may simply have no curated-rule access.
4. **Detections available to import** — what Google has with the saved **Data to import** selection _and_ with the other one (Alerts only, or Alerts and **Detections**) over the last 24 hours and the last 7 days: the alerts view's matched count and one created-time search page per range, reported as a number or as `1000+`. When the saved selection has nothing but the other one does, the check warns: your rules create detections but alerting is not enabled on them. Edit the connection and select **Detections** under **Data to import**, or enable alerting on the rules in Google SecOps.
5. **Background workers**, **Poll scheduler** and **Security event storage** — whether a process is consuming OneUptime's Worker queue, whether the minute-cadence poll job is registered, and whether the security event store answers the same duplicate lookup polling runs before every insert, so a broken analytics database fails here with a name rather than an hour later as a poll error.
6. **Scheduled polling** (saved connections only) — whether polling is enabled, whether a queued run is stuck waiting for a worker, and whether the connection is being polled on schedule.

Every request in a test has a 20 second deadline. Tests leave the polling cursor and event store untouched. A saved connection tested with its saved settings gets a run-history row of type test, and the row's details show the same checklist.

### Preview, run and import on demand

Open **Diagnostics** on a connection to see recent runs and operate the connector. Project owners, project admins and security admins can start operations. Security members and viewers can read the history.

- **Run now** queues a poll immediately, using the normal cursor and ingestion path, even while scheduled polling is disabled. Queued and running states remain visible while the worker executes the request. If a run remains queued, check that workers are processing the Worker queue; the **Background workers** check in Test connection says whether any process is.
- **Preview detections** reads a selected time range without importing or changing the cursor. Use the last hour, 24 hours, 7 days, or a custom range of up to 7 days. The range matches the SecOps alerts view, which reads by detection time, and the two search passes read detections _created_ in it as well as detections whose detection time falls in it, so previewing yesterday shows detections created yesterday about older events as well. The preview shows detection time and creation time separately. Results reflect the connection's saved **Data to import** selection.
- **Import this time range** imports the selected range, after you confirm it, without moving the polling cursor. It is also how you recover a minute that polling moved past, as described above. Preview the range first. Repeated polls and imports skip events already stored with the same source identifier in the project. Imports may trigger configured detection rules and monitors just like scheduled polling.

Each run's details show the **Requested window (UTC)**, the connection's **Data to import** selection and five counts: **Returned by Google SecOps** (records Google handed back across the three passes, after merging by id), **Imported into OneUptime** (rows written to the event store), **Already imported** (records skipped because the same source identifier is already stored in this project; the 1 minute overlap and re-runs make this normal), **Rejected** (returned objects that are not Google SecOps detections; they are counted and warned about, never retried, and do not hold the cursor) and **Failed** (records that could not be normalized; a poll retries them in a shorter window). **Provider details** add the **Time basis read**, the records **Returned by each pass** (rule detections, curated rule detections and the alerts view) and the **Creation lag**. The checks, one per pass, the warnings and sample detections follow. A scheduled poll's details also show the **Window read by this poll** and what the **Next scheduled poll reads**, and a Partial poll says whether it kept its starting point and narrowed the next window, or moved past a single minute it names. **Success**, **No records returned**, **Partial** and **Failed** are distinct outcomes.

Use **View events in this time range** on a run to open the event-time range of the detections it returned. A detection created today with yesterday's detection time can otherwise be hidden by a recent-events filter. Run history preserves failures after a later complete poll clears Last Error. Use **Copy diagnostics** when contacting support; service-account credentials and tokens are never included.

### Why am I not seeing events?

Work through these in order. Each one is distinguishable from the next in **Diagnostics** or from **Test connection**.

1. **Data to import.** By default only **Alerts** are imported, and a rule detection is only an alert when alerting is enabled on the rule in Google SecOps. A tenant whose rules create detections without alerting polls honestly empty forever. Run **Test connection**: the **Detections available to import** check counts with and without **Detections** and says so when selecting it would add records. Edit the connection and select **Detections** under **Data to import**, or enable alerting on the rules.
2. **Rule run frequency and detection latency.** Detections are created when the rule runs, which can be up to an hour or a day after the events they describe. The connector polls by created time, so they arrive on the first poll after Google creates them, not at their detection time. A rule you just enabled has created nothing yet, and a quiet tenant has nothing to create. The availability check reports how many detections were created in the last 24 hours and 7 days; zero with and without **Detections** means Google has nothing for OneUptime to import yet.
3. **Read the last run's counts.** In Diagnostics, **Returned by Google SecOps** with zero **Imported into OneUptime** and a matching **Already imported** count is the connector working as designed: those detections were imported by an earlier poll. **Rejected** records are objects Google returned that are not detections at all.
4. **Is anything polling at all?** **Last Polled: Never** with an empty Last Error means no poll has finished for this connection. Test connection reports **Background workers** (processes consuming the Worker queue), **Poll scheduler** (the minute-cadence scheduler registration) and **Scheduled polling** (this connection's own schedule, including an overdue poll or a run stuck in queued). See the Troubleshooting entry below for the deployment settings that cause it.
5. **Look in the right place.** Events are stored under their detection time, which can be hours or days before the time they were created and imported, so a "last hour" filter in Security Events hides a detection imported a minute ago about yesterday. Use **View events in this time range** on a run in Diagnostics: it opens the event-time range of the detections that run returned.

### Troubleshooting

- **Google returns zero records** — check the exact time window, the time basis and the saved **Data to import** selection in Diagnostics, and run Test connection to read the availability counts with and without **Detections**. A non-alerting rule match requires the **Detections** checkbox. Preview a period covering both its detection time and creation time. The initial scheduled poll looks back 24 hours by created time; use **Import this time range** for older records.
- **Health is Partial import** — open the latest run in **Diagnostics** and read its warnings; the same warnings are in Last Error. `This window holds more records than one poll can read; ...` means polling is narrowing its window from the same starting point and needs no action: it grows back once polls complete. `More records were created in the one minute from ...` means polling moved past that minute; import it with **Import this time range** to recover the detections it skipped. A warning that says a pass was stopped by, or not run because of, the request budget or the poll time budget names the pass that was cut short. Shortening the poll interval does not change the window. A blank Last Error alone does not establish complete coverage.
- **Health is Poll overdue** — scheduled polls are not running on time; check the worker queue and run Test connection for the **Background workers** and **Scheduled polling** checks.
- **Status is `Disabled`** — scheduled polling skips the connection. Authorized users can still test, preview, run a poll with **Run now**, or import from Diagnostics.
- **Last Polled is `Never` and Last Error is empty** — no poll has finished for this connection. Open **Diagnostics**: when its run history holds no poll, or only one stuck in queued, the background worker has not executed the poll job at all, so nothing has ever reached Chronicle. On self-hosted deployments the usual cause is `DISABLE_QUEUE_WORKERS=true` on the app container with no separate worker deployment draining the queues. Either set `DISABLE_QUEUE_WORKERS=false` (the `config.example.env` default that Docker Compose ships with), or run the dedicated worker deployment (Helm: `worker.enabled: true`, which is `false` by default). Test connection reports this as a failed **Background workers**, **Poll scheduler** or **Scheduled polling** check. A poll that ran but stopped before it reached the connection is a failed run in that history instead: `Another poll or import for this source is still running in this project` means another Google SecOps poll or import in this project held the source lock, and the connection is queued again on the next tick. A scheduler that could not even queue a poll stamps `Scheduler could not queue a poll:` and the reason on Last Error.
- **Last Error is populated** — a poll was attempted and something in it failed, a poll could not read its whole window, or the scheduler could not queue a poll. For a failed poll the field stores the complete error message with credentials redacted. When a connection has an error, select **View Error** in its **Actions** column to open the full message, then **Copy Error** in the dialog to copy it for support. The field clears on the next complete poll, which also removes the **View Error** action; run history keeps it. Read the prefix first. A message beginning `More records were created in the one minute from` is that skipped minute rather than a failure; see **Health is Partial import** above. Only three prefixes carry an HTTP status, so a message without one is not evidence of a fault on OneUptime's side:
  - `Google token exchange failed (HTTP ...)` — the service-account credential was rejected at Google's OAuth endpoint, before Chronicle was ever contacted. Usually a malformed, revoked, or wrong-project key.
  - `Google token exchange returned ...` — that same OAuth endpoint answered, but with something unusable: no `access_token`, or a body that is not JSON. Still before Chronicle, and usually a proxy or gateway sitting in between rather than the key itself.
  - `Google SecOps detections search failed (HTTP ...)` — Chronicle itself rejected the created-time search (`legacySearchDetections` or `legacySearchCuratedDetections`). A `403` usually means the service account is missing the **Chronicle API Viewer** role on the project the instance is bound to; on the curated pass a `400`, `403` or `404` is downgraded to a warning because the tenant may simply have no curated-rule access.
  - `Google SecOps detections search returned ...` — Chronicle answered `200` to the search, but the body was not a readable detections page: empty, not JSON, or a shape the parser does not recognize. Reported rather than counted as a quiet window, so the cursor cannot advance past what was missed.
  - `Google SecOps alerts fetch failed (HTTP ...)` — Chronicle itself rejected the alerts-view request. A `403` usually means the service account is missing the **Chronicle API Viewer** role on the project the instance is bound to; a `404` usually means the instance resource name points at a different instance, or the region prefix is not one Chronicle serves.
  - `Google SecOps alerts fetch returned ...` — Chronicle answered `200`, but the body was not a readable detection-alerts stream: empty, not JSON, or a shape the parser does not recognize. It is reported rather than counted as an empty window on purpose — treating a body it could not read as "no alerts" would advance the cursor past whatever was missed.
  - `Google SecOps alerts query was rejected by Chronicle on an HTTP 200` — Chronicle accepted the request, ran it, and rejected the query inside the body it returned (`validSnapshotQuery` or `validBaselineQuery` false, or `queryValidationErrors`). This is Google's rejection, and there is no HTTP status anywhere in it.
  - `timed out after 60 seconds with no response` — neither Google's OAuth endpoint nor Chronicle answered before the client gave up (a connection test uses a 20 second deadline per request and reports the same wording with that number). Nothing came back, so the message assigns no side; check egress from the OneUptime worker as well as the tenant.
  - A message matching none of the above did not come from Google. One that begins with a field name — `Region`, `Instance resource name` or `Service account JSON` — means the saved settings do not pass validation: edit the connection, or replace the key with **Update credentials**. A connection carried over from the earlier Google SecOps connector whose saved settings no longer pass today's rules lands here until it is edited. Otherwise the failure was on OneUptime's side: usually the detections arrived and writing them to the telemetry store is what failed.
- **Last Error reads `Google SecOps alerts fetch failed (HTTP 400)` and quotes `Unknown name "pageSize": Cannot bind query parameter`** — this identifies an unsupported request parameter on the alerts view. Upstream **13.0.0** already replaced `pageSize` with `alertListOptions.maxReturnedAlerts` on that endpoint. Inspect the actual app and worker images, including custom builds and separately deployed workers, if this error still appears. Rotating the service-account key does not correct an unsupported query parameter. A successful OAuth token exchange confirms credential acceptance; the parameter rejection alone does not establish authentication or authorization.

### An alert request still returns `400 INVALID_ARGUMENT`

A successful OAuth token exchange confirms that Google accepted the service-account credential. It does not confirm the SecOps instance resource name or permission to read that instance. A generic `Request contains an invalid argument` response does not identify which argument failed.

The upstream **13.0.0** release already uses `alertListOptions.maxReturnedAlerts` on the alerts view. If a deployment reporting that version still sends `pageSize` there, check the actual images used by every polling worker, including separately deployed workers and custom builds.

1. Check the **running app and worker image versions**. Updating a local connector source file or re-uploading the service-account JSON does not update a deployed container. Deploy an image containing the connector correction to every app or dedicated worker that runs the poll job. If you build your own image, rebuild it with the corrected source and deploy a new, immutable tag; restarting a pod with the old image is insufficient.
2. Verify the alerts-view request against the [Google API reference](https://docs.cloud.google.com/chronicle/docs/reference/rest/v1alpha/projects.locations.instances.legacy/legacyFetchAlertsView). It uses `timeRange.startTime`, `timeRange.endTime`, `snapshotQuery=` (an empty value includes all alert statuses), `alertListOptions.maxReturnedAlerts`, and `includeNonAlertingDetections` set explicitly from the saved **Data to import** selection. It must not send `pageSize` or `pageToken` on that endpoint. The two created-time passes use [`legacySearchDetections`](https://docs.cloud.google.com/chronicle/docs/reference/rest/v1alpha/projects.locations.instances.legacy/legacySearchDetections) and `legacySearchCuratedDetections`, where `ruleId`, `listBasis`, `alertState`, `pageSize` and `pageToken` are the documented parameters, and their failures carry the detections-search prefix instead. Do not substitute a filter excluding closed alerts, since that loses detections.
3. Compare the full `projects/{project}/locations/{location}/instances/{instance}` resource with the values in your Google SecOps tenant settings. The instance component must be the SecOps instance ID; a connection display name or service-account name is not a substitute. Confirm that the regional endpoint matches the instance location.
4. Wait for the next configured poll interval after the rollout completes. **Last Polled** should advance and **Last Error** should clear on a complete poll. If the window contains detections, they should appear under **Security Events**; a quiet window can legitimately ingest zero events.

If the same error persists, open **View Error** from the connection's **Actions** column, use **Copy Error** in the dialog, and provide support with that message, the image tag or digest, region, and instance resource name. Credentials in the recorded message are redacted; do not send the service-account private key, JWT assertion, or access token separately. Errors recorded before upgrading may already be truncated; a subsequent failed poll records the complete message. A failed poll keeps its window for retry, and a partial poll narrows its next window or moves past a single minute it names in Last Error. Scheduled catch-up processes up to 24 hours per run.

### Upgrading from the earlier Google SecOps connector

Google SecOps used to have its own connections card, API and poller. It is now a provider of Security Event Connections, and upgrading moves existing connections for you.

- **Connections move automatically.** When the upgraded release runs its data migrations, every Google SecOps connection is copied into Security Event Connections with provider `google-secops`. It keeps its id, name, **Region**, **Instance resource name**, service account key, **Enabled** state, poll interval, **Data to import** selection, polling cursor, Last Polled, Last Successful Poll, Last Event Imported and Last Error, so polling resumes where it stopped. The connector keeps the `Google` / `Google SecOps` identity the earlier one imported under, so detections already imported count as **Already imported** rather than being stored twice.
- **Recent run history comes along.** The most recent 500 runs of each connection are copied into its run history in **Diagnostics**. A run that was still queued or running is copied as failed with `This operation was still in progress when Google SecOps moved to Security Event Connections, so its outcome was not recorded here. Check the imported security events before running it again.`
- **The earlier rows are disabled, not deleted.** An old worker still running during a rolling deploy therefore cannot poll the same instance a second time. Rolling back to a release with the earlier connector requires enabling those rows again.
- **A connection that cannot be moved stays where it was.** One with no stored key, or whose key cannot be decrypted with this server's `ENCRYPTION_SECRET`, is skipped and named in the worker log; add it again under **Security Events → Connections**. One whose saved settings no longer pass today's validation is moved anyway, and its polls fail with a message naming the field until you edit it. One that a transient database error interrupted is moved when the migration runs again on the next worker start, and polling resumes from its copied cursor.
- **The API routes changed.** The `/google-secops-connection` and `/google-secops-connection-run` routes, including `/google-secops-connection/test` and `/google-secops-connection/:connectionId/run`, are replaced by `/security-event-connection` and `/security-event-connection-run` with provider `google-secops`; the operations are `/security-event-connection/test` and `/security-event-connection/:connectionId/run`. The earlier top-level fields move into `config` and `secrets`:

  ```json
  {
    "data": {
      "name": "Google SecOps production",
      "provider": "google-secops",
      "config": {
        "region": "us",
        "instanceResourceName": "projects/{project}/locations/{location}/instances/{instance}"
      },
      "secrets": {
        "serviceAccountJson": "<the service account key file, as a JSON string>"
      },
      "alertingOnly": true,
      "pollIntervalInMinutes": 5,
      "isEnabled": true
    }
  }
  ```

  `alertingOnly` is the inverse of the earlier `includeNonAlertingDetections`: set it to `false` to import **Detections** too. `secrets` is write-only, as `serviceAccountJson` was.

- **Events carry a new connection attribute.** Detections imported before the move keep the attribute `oneuptime.google_secops.connection_id`. Detections imported after it carry `oneuptime.security_connection.id` (with `oneuptime.security_connection.provider` set to `google-secops`), like every managed connector. Both hold the same connection id, so filter on both to search across the upgrade. **View events in this time range** on a carried-over run uses the attribute its events were written with.

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
