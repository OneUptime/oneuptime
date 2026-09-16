import SecurityEventConnectorProvider from "Common/Types/SecurityEvent/Connectors/SecurityEventConnectorProvider";
import { SecurityEventConnectorCatalog } from "Common/Types/SecurityEvent/Connectors/SecurityEventConnectorCatalog";

/*
 * In-product help for a provider whose behaviour needs more than the
 * framework-level help on the Security Event Connections card: how its
 * passes and budgets work, what its Last Error prefixes mean, and which of
 * its own controls to reach for. The provider's setup guide on the docs site
 * stays the canonical, longer text; this is what the card's help panel shows
 * without leaving the page.
 *
 * Kept out of the catalog on purpose: the catalog is shared with the server
 * and the docs tests, and has no use for long markdown.
 */

export interface ConnectorProviderHelpEntry {
  // Heading the section is known by, e.g. in the help panel's description.
  title: string;
  markdown: string;
}

/*
 * The docs-accuracy test (SecurityEventsConnectorGuidanceAccuracy.test.ts)
 * extracts this literal by its declaration and checks it against the
 * connector's real error messages and warnings, so the declaration line is
 * part of the contract.
 */
const googleSecOpsDocumentationMarkdown: string = `
### How the Google SecOps Connector Works

The managed connector polls your Google SecOps (Chronicle) tenant on the interval set here and ingests each matching detection as a **Detection Finding** security event, attributed to a \`Google SecOps\` telemetry service. **Alerts** are always imported. Select **Detections** to also import non-alerting rule matches. From there the findings are searchable, correlatable, and available to detection rules, alerts and monitors.

- **Region** is your tenant's regional endpoint prefix (\`us\`, \`europe\`, ...). It is used to build the Chronicle API base URL.
- **Instance resource name** comes from your SecOps **SIEM Settings → Profile** and looks like \`projects/{project}/locations/{location}/instances/{instance}\`.
- **Service account JSON** is a Google Cloud service-account key with the **Chronicle API Viewer** role. It is encrypted at rest and never returned by the API, so it can never be shown back to you — rotating it goes through the row's **Update credentials** action.
- **Poll Interval (Minutes)** is how often new detections are fetched, as a whole number of minutes between 1 and 1440.

Each poll reads one time window three ways and merges the results by detection id: **rule detections by created time** (\`legacySearchDetections\`, paginated), **curated rule detections by created time** (\`legacySearchCuratedDetections\`, once per curated rule that \`countAllCuratedRuleSetDetections\` reports detections for in the week before the window, since that endpoint has no wildcard; a tenant without curated-rule access gets a warning, not a failure) and **the alerts view by detection time** (\`legacyFetchAlertsView\`, for telemetry, SOAR, machine-intelligence and rule alerts). The alerts view can only filter by detection time, so a scheduled poll also sweeps it, alerts only, over the 24 hours before its window (**Read late alerts by detection time**) for alerts Google made readable after their detection time; that sweep is best effort and never makes a poll Partial or holds the cursor. Polling by created time is the point: a rule that runs hourly or daily creates its detections long after their detection time, and a cursor over detection time has already moved past them. The first poll of a new connection looks back **24 hours** by created time; later polls resume from the stored cursor with a 1 minute overlap and process at most 24 hours each, so an old cursor catches up in 24 hour windows. Use **Import this time range** for detections created before the first 24 hour window.

A poll's budgets are 20 search pages for rule detections, 200 curated requests (the count plus at least one page per curated rule active that week, busiest first; rules a poll cannot reach are a warning, not a Partial poll), 16 alerts-view requests shared with the late-alert sweep and 4 minutes; a pass cut short by them is a warning check, never a success. When a window holds more detections than that, polling never re-reads the same window forever. The poll is **Partial**, the cursor stays put, and the next poll reads half as long a window from the same starting point (\`This window holds more records than one poll can read; the next poll reads a {n} minute window from the same starting point.\`), halving down to one minute; each complete poll doubles the window back towards 24 hours. If even one minute cannot be read in full, polling moves past it so newer detections keep arriving, and stores this in **Last Error**: \`More records were created in the one minute from {start} to {end} than one poll can read. Polling moved past this minute so newer records keep arriving; use Import this time range in Diagnostics on this minute to recover what one run can read.\` Recover that minute with **Import this time range** in **Diagnostics** (the range inputs use your local time; the message is in UTC). A Partial poll's warnings are also stored in **Last Error** until a complete poll clears them. A failed poll keeps its cursor and window length and retries on the next tick, except that a request that timed out halves the next window. Shortening the poll interval does not change the window.

---

### Reading Connector Health

**Status** shows whether scheduled polling is enabled. **Health**, **Last Successful Poll**, and **Last Event Imported** describe the most recent polling outcome. **Last Polled** is the last attempt, which may have failed or returned zero detections.

- **Last Polled: Never** means no poll has finished for this connection yet. A connection created moments ago shows this until the next tick — but one that has sat at "Never" for longer than its poll interval is not being polled at all: its run history in **Diagnostics** holds no poll, a poll stuck in queued, or polls that stopped before reaching the connection (\`Another poll or import for this source is still running in this project\` means another Google SecOps poll or import in this project held the source lock). **Test connection** reports this as a failed **Background workers**, **Poll scheduler** or **Scheduled polling** check, and a scheduler that could not queue a poll stamps the reason on Last Error behind \`Scheduler could not queue a poll:\`.
- **Test connection** runs in the API process without a worker and reports a checklist: **Configuration**, **Authenticate with Google**, **Read rule detections**, **Read curated rule detections**, **Read the alerts view**, **Detections available to import**, **Background workers**, **Poll scheduler**, **Security event storage** (the same duplicate lookup polling runs before every insert) and, for a saved connection, **Scheduled polling**. The availability check counts what Google has with the saved **Data to import** selection and with the other one over the last 24 hours and 7 days; when the saved selection has nothing but the other one does, your rules create detections but alerting is not enabled on them — edit the connection and select **Detections** under **Data to import**, or enable alerting on the rules in Google SecOps. Every request in a test has a 20 second deadline. Tests never import events or move the cursor. **Diagnostics** runs the same test inline, and a saved connection's test is kept in run history with its checklist. You can also test settings from the create form (**Add connection**, then **Google SecOps**) with **Test these settings** under **Test before saving**, before anything is stored; on the edit form the same button tests the region, instance and **Data to import** on screen with the stored key, and records no run history when anything tested differs from the saved settings. **Run now** imports the next poll window immediately.
- **Diagnostics** shows the exact requested time range, the basis it was read by, how many records each pass returned, and the **Returned by Google SecOps** (records Google handed back after merging by id), **Imported into OneUptime** (rows written to the event store), **Already imported** (skipped because the same source identifier is already stored in this project; the 1 minute overlap makes this normal), **Rejected** (returned objects that are not Google SecOps detections; counted and warned, never retried, and they do not hold the cursor) and **Failed** counts, creation-lag statistics, warnings, connection checks and recent run history. An empty result means Google returned no detections in that window with that **Data to import** selection; it does not establish that a detection elsewhere is absent.
- **Health: Partial import** means the last poll could not read its whole window. Its warnings in **Diagnostics** say whether polling is narrowing from the same starting point (no action needed) or moved past a minute it names, which you recover with **Import this time range**.
- **Why am I not seeing events?** First **Data to import**: by default only **Alerts** are imported, so a rule detection arrives only when alerting is enabled on the rule; select **Detections** to import the rest, and the availability check in Test connection says when that would add records. Then rule frequency: detections are created when the rule runs, up to an hour or a day after the events, and arrive on the first poll after Google creates them. Then the last run's counts, above. Then whether anything polls at all, above. Then where you are looking: events are stored under their detection time, so a recent-events filter hides a detection imported a minute ago about yesterday.
- Use **Preview detections** to read a selected detection-time range without importing; the search passes also read detections created in it. **Import this time range** imports up to 7 days of history after confirmation. Scheduled first polls look back 24 hours by created time. A stale cursor catches up in 24 hour windows, narrower when a window holds more than one poll can read; use historical import for detections created before the first poll.
- A detection's original time may be earlier than its creation time. **View events in this time range** opens the returned detection-time range so late-created detections are visible.
- **Last Error** stores the complete error message with credentials redacted. When a connection has an error, select **View Error** in its **Actions** column to read it, then **Copy Error** in the dialog to copy it for support. It is cleared by the next complete poll, so a value here describes the most recent attempt rather than a permanent state. A message beginning \`More records were created in the one minute from\` is not a failure: polling moved past a minute it could not read in full (see **Partial import** above). Otherwise read the prefix first; only four prefixes carry an HTTP status, and a message without one is not evidence of a fault on OneUptime's side:
  - \`Google token exchange failed (HTTP ...)\` — the service-account credential was rejected at Google's OAuth endpoint, before Chronicle was reached. Usually a malformed, revoked, or wrong-project key.
  - \`Google token exchange returned ...\` — that same endpoint answered with something unusable (no access token, or a body that is not JSON), still before Chronicle. Usually a proxy or gateway in between.
  - \`Google SecOps detections search failed (HTTP ...)\` — Chronicle itself rejected the created-time search. \`403\` is usually a missing **Chronicle API Viewer** role; on the curated pass a \`400\`, \`403\` or \`404\` is downgraded to a warning because the tenant may have no curated-rule access.
  - \`Google SecOps detections search returned ...\` — Chronicle answered \`200\` to the search with a body that is not a readable detections page. Reported rather than counted as a quiet window, so the cursor cannot advance past what was missed.
  - \`Google SecOps curated rule detection counts failed (HTTP ...)\` — Chronicle rejected \`countAllCuratedRuleSetDetections\`, which names the curated rules to search. A \`400\`, \`403\` or \`404\` is downgraded to a warning like the curated search; anything else fails the poll.
  - \`Google SecOps curated rule detection counts returned ...\` — Chronicle answered \`200\` to the curated rule counts with a body that is empty, not JSON or not recognized. Reported rather than read as no curated rule fired, so curated detections are not silently skipped.
  - \`Google SecOps alerts fetch failed (HTTP ...)\` — Chronicle itself rejected the alerts-view request. \`403\` is usually a missing **Chronicle API Viewer** role; \`404\` is usually a wrong instance resource name or region.
  - \`Google SecOps alerts fetch returned ...\` — Chronicle answered \`200\` with a body that is not a readable detection-alerts stream. It is reported rather than counted as an empty window, so the cursor cannot advance past what was missed.
  - \`Google SecOps alerts query was rejected by Chronicle on an HTTP 200\` — Chronicle ran the request and rejected the query inside the body it returned. Google's rejection, with no HTTP status anywhere in it.
  - \`timed out after 60 seconds with no response\` — nothing answered before the client gave up (a connection test uses a 20 second deadline per request and says so), so the message assigns no side. Check the worker's egress as well as the tenant.
  - A message matching none of the above did not come from Google. One beginning with a field name (\`Region\`, \`Instance resource name\` or \`Service account JSON\`) means the saved settings do not pass validation: edit the connection, or replace the key with **Update credentials**. Otherwise the failure was on OneUptime's side, usually writing the detections to the telemetry store after they arrived.
  - \`Google SecOps alerts fetch failed (HTTP 400)\` quoting \`Unknown name "pageSize": Cannot bind query parameter\` identifies an unsupported request parameter on the alerts view. Upstream **13.0.0** already replaced \`pageSize\` with \`alertListOptions.maxReturnedAlerts\` there; the created-time searches use \`pageSize\` and \`pageToken\` as Chronicle documents for them. Inspect the actual app and worker images, including custom builds and separately deployed workers, if this error still appears. Rotating the service-account key does not correct an unsupported query parameter. A successful OAuth token exchange confirms credential acceptance; the parameter rejection alone does not establish authentication or authorization.

Scheduled polls skip disabled connections. On-demand checks and imports remain available; **Run now** updates poll state even while the schedule is paused.

Errors recorded before upgrading may already be truncated; a subsequent failed poll records the complete message.
`;

export const ConnectorProviderHelp: Partial<
  Record<SecurityEventConnectorProvider, ConnectorProviderHelpEntry>
> = {
  [SecurityEventConnectorProvider.GoogleSecOps]: {
    title: "How the Google SecOps Connector Works",
    markdown: googleSecOpsDocumentationMarkdown,
  },
};

export function getConnectorProviderHelp(
  provider: string | undefined,
): ConnectorProviderHelpEntry | undefined {
  if (!provider) {
    return undefined;
  }

  return ConnectorProviderHelp[provider as SecurityEventConnectorProvider];
}

/*
 * The provider sections, in catalog order so the help panel lists them the
 * way the provider picker does. A provider without its own help is skipped;
 * its setup guide link on the form covers it.
 */
export function connectorProviderHelpEntries(): Array<ConnectorProviderHelpEntry> {
  const entries: Array<ConnectorProviderHelpEntry> = [];

  for (const definition of SecurityEventConnectorCatalog) {
    const entry: ConnectorProviderHelpEntry | undefined =
      getConnectorProviderHelp(definition.provider);

    if (entry) {
      entries.push(entry);
    }
  }

  return entries;
}

export default ConnectorProviderHelp;
