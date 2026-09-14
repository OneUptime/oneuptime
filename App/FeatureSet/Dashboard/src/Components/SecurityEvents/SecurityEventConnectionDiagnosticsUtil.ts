import SecurityEventConnection from "Common/Models/DatabaseModels/SecurityEventConnection";
import Route from "Common/Types/API/Route";
import URL from "Common/Types/API/URL";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import { Green, LightGray, Red, Yellow } from "Common/Types/BrandColors";
import Color from "Common/Types/Color";
import { JSONObject } from "Common/Types/JSON";
import {
  SecurityConnectorCheck,
  SecurityConnectorCheckStatus,
  SecurityConnectorSample,
  SecurityConnectorTestReport,
} from "Common/Types/SecurityEvent/Connectors/ConnectorDiagnostics";
import {
  SecurityEventConnectionRunResult,
  SecurityEventConnectionRunType,
} from "Common/Types/SecurityEvent/Connectors/SecurityEventConnectionDiagnostics";
import {
  SecurityEventConnectorDefinition,
  getSecurityEventConnectorTitle,
} from "Common/Types/SecurityEvent/Connectors/SecurityEventConnectorCatalog";
import { DOCS_URL } from "Common/UI/Config";
import TableFilterUrlState from "Common/UI/Utils/TableFilterUrlState";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";

/*
 * Provider-agnostic twins of GoogleSecOpsDiagnosticsUtil. The vocabulary
 * (health labels, run labels, date format, range rules) is kept identical
 * on purpose: a customer with a Google SecOps connection and a Sentinel
 * connection side by side should read the same words for the same state.
 */

// API path (under APP_API_URL) of the synchronous connection test.
export const SECURITY_EVENT_CONNECTION_TEST_ROUTE: string =
  "/security-event-connection/test";

export const securityEventConnectionRunLabels: Record<
  SecurityEventConnectionRunType,
  string
> = {
  test: "Test connection",
  poll: "Poll",
  preview: "Preview",
  backfill: "Historical import",
};

export function readSecurityEventConnectionResult(
  value: JSONObject | undefined,
): SecurityEventConnectionRunResult | null {
  if (!value || !value["status"] || !value["type"]) {
    return null;
  }

  return value as unknown as SecurityEventConnectionRunResult;
}

/*
 * A synchronous test run stores the checklist report in `result`, not a
 * run result; recognise it by the report's own shape (checks + summary).
 */
export function readSecurityConnectorTestReport(
  value: JSONObject | undefined,
): SecurityConnectorTestReport | null {
  if (
    !value ||
    !Array.isArray(value["checks"]) ||
    typeof value["summary"] !== "string" ||
    typeof value["status"] !== "string"
  ) {
    return null;
  }

  return value as unknown as SecurityConnectorTestReport;
}

export function formatConnectionDate(value: string | Date | undefined): string {
  if (!value) {
    return "Never";
  }

  const date: Date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Unknown"
    : date
        .toISOString()
        .replace("T", " ")
        .replace(/\.\d{3}Z$/, " UTC");
}

/*
 * The same instant in the viewer's own clock, for a tooltip or secondary
 * line next to the UTC value. Every timestamp in the diagnostics UI is
 * printed in UTC because that is what run history, the API and support
 * tickets use; the local rendering exists so a reader comparing "Last
 * polled" with the wall clock on their desk does not have to convert in
 * their head, and so the two bases are never mixed silently.
 */
export function formatConnectionLocalDate(
  value: string | Date | undefined,
): string {
  if (!value) {
    return "";
  }

  const date: Date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return date.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    timeZoneName: "short",
  });
}

// Title attribute for a UTC timestamp: the local rendering, or nothing.
export function connectionTimeTitle(
  value: string | Date | undefined,
): string | undefined {
  const local: string = formatConnectionLocalDate(value);
  return local ? `Local time: ${local}` : undefined;
}

/*
 * Where a provider's setup guide lives on the docs site. Catalog paths are
 * absolute ("/docs/integrations/okta") while DOCS_URL already ends in
 * "/docs", so the prefix is dropped before joining.
 */
export function connectorDocsUrl(
  definition: Pick<SecurityEventConnectorDefinition, "docsPath">,
): URL {
  const relativePath: string = definition.docsPath.replace(/^\/docs/, "");
  return URL.fromString(`${DOCS_URL.toString()}${relativePath}`);
}

export function connectorNextPoll(
  connection: SecurityEventConnection,
): Date | null {
  if (!connection.isEnabled || !connection.lastPolledAt) {
    return null;
  }

  return new Date(
    new Date(connection.lastPolledAt).getTime() +
      Math.max(1, connection.pollIntervalInMinutes || 5) * 60_000,
  );
}

/*
 * The Health vocabulary shared by every connection family. Exported as
 * constants so the Google SecOps column, the generic column and their
 * tests spell each state exactly once.
 */
export const CONNECTOR_HEALTH_SUCCEEDED: string = "Last poll succeeded";
export const CONNECTOR_HEALTH_NO_EVENTS_YET: string =
  "Polling, no events imported yet";
export const CONNECTOR_HEALTH_FAILED: string = "Last poll failed";
export const CONNECTOR_HEALTH_OVERDUE: string = "Poll overdue";
export const CONNECTOR_HEALTH_PARTIAL: string = "Partial import";
export const CONNECTOR_HEALTH_CATCHING_UP: string = "Catching up";
export const CONNECTOR_HEALTH_PAUSED: string = "Schedule paused";
export const CONNECTOR_HEALTH_WAITING: string = "Waiting for first poll";
export const CONNECTOR_HEALTH_UNAVAILABLE: string = "Details unavailable";

/*
 * "Last poll succeeded" is only earned once an event has actually landed.
 * The customer complaint behind this page was a connection whose polls
 * all succeeded while nothing was ever imported; a green "succeeded" pill
 * on that row told them the connector was fine when it was not. A
 * succeeding poll that has never imported anything reads as a neutral
 * "still waiting" state instead, and its tooltip points at Test
 * connection, which is the tool that says WHY nothing arrives.
 */
export function connectorHealthAfterSuccessfulPoll(connection: {
  lastEventIngestedAt?: Date | string | undefined;
}): string {
  return connection.lastEventIngestedAt
    ? CONNECTOR_HEALTH_SUCCEEDED
    : CONNECTOR_HEALTH_NO_EVENTS_YET;
}

/*
 * Same decision tree and labels as googleSecOpsHealth so the two Health
 * columns on the Connections page agree. "No records returned" replaces
 * "No detections returned" because not every provider imports detections
 * (Okta imports log events, Security Hub imports findings).
 */
export function connectorHealth(
  connection: SecurityEventConnection,
  now: number = Date.now(),
): string {
  if (!connection.isEnabled) {
    return CONNECTOR_HEALTH_PAUSED;
  }

  const due: Date | null = connectorNextPoll(connection);
  // The scheduler ticks once a minute; allow two ticks before calling it overdue.
  if (
    (due && now > due.getTime() + 120_000) ||
    (!connection.lastPolledAt &&
      connection.createdAt &&
      now > new Date(connection.createdAt).getTime() + 120_000)
  ) {
    return CONNECTOR_HEALTH_OVERDUE;
  }

  const result: SecurityEventConnectionRunResult | null =
    readSecurityEventConnectionResult(connection.lastPollResult);

  if (result?.status === "partial") {
    return CONNECTOR_HEALTH_PARTIAL;
  }
  if (result?.status === "failed" || connection.lastError) {
    return CONNECTOR_HEALTH_FAILED;
  }
  if (
    result?.complete &&
    new Date(result.startedAt).getTime() -
      new Date(result.windowEnd).getTime() >
      (Math.max(1, connection.pollIntervalInMinutes || 5) + 2) * 60_000
  ) {
    return CONNECTOR_HEALTH_CATCHING_UP;
  }
  if (result?.status === "empty") {
    return "No records returned";
  }
  if (result?.status === "success") {
    return connectorHealthAfterSuccessfulPoll(connection);
  }
  return connection.lastPolledAt
    ? CONNECTOR_HEALTH_UNAVAILABLE
    : CONNECTOR_HEALTH_WAITING;
}

export type ConnectorHealthTone = "good" | "bad" | "attention" | "neutral";

export function connectorHealthTone(health: string): ConnectorHealthTone {
  if (
    health === CONNECTOR_HEALTH_SUCCEEDED ||
    health === "No records returned" ||
    health === "No detections returned"
  ) {
    return "good";
  }
  if (health === CONNECTOR_HEALTH_FAILED) {
    return "bad";
  }
  if (
    health === CONNECTOR_HEALTH_OVERDUE ||
    health === CONNECTOR_HEALTH_PARTIAL ||
    health === CONNECTOR_HEALTH_CATCHING_UP
  ) {
    return "attention";
  }
  return "neutral";
}

// Pill colour for a Health value; one mapping for both connection families.
export function connectorHealthPillColor(health: string): Color {
  switch (connectorHealthTone(health)) {
    case "good":
      return Green;
    case "bad":
      return Red;
    case "attention":
      return Yellow;
    default:
      return LightGray;
  }
}

/*
 * Hover text for the states whose one-line label needs a second sentence.
 * Returned for every state so the pill has a consistent affordance.
 */
export function connectorHealthTooltip(health: string): string {
  switch (health) {
    case CONNECTOR_HEALTH_NO_EVENTS_YET:
      return "Scheduled polls succeed, but no event has been imported yet. Use Test connection to see what the source has available to import and whether OneUptime's workers are running.";
    case CONNECTOR_HEALTH_SUCCEEDED:
      return "The last scheduled poll succeeded and this connection has imported events.";
    case CONNECTOR_HEALTH_FAILED:
      return "The last scheduled poll failed. Open View Error for the full message.";
    case CONNECTOR_HEALTH_OVERDUE:
      return "The scheduler has not polled this connection when it was due. Use Test connection to check whether OneUptime's workers and scheduler are running.";
    case CONNECTOR_HEALTH_PARTIAL:
      return "The last poll imported some records but could not process every one. Open Diagnostics for the warnings.";
    case CONNECTOR_HEALTH_CATCHING_UP:
      return "The connection is working through a backlog in 24 hour windows.";
    case CONNECTOR_HEALTH_PAUSED:
      return "Scheduled polling is disabled. Run now still works.";
    case CONNECTOR_HEALTH_WAITING:
      return "Created moments ago; the scheduler polls once a minute.";
    case CONNECTOR_HEALTH_UNAVAILABLE:
      return "A poll ran but recorded no result details.";
    default:
      return "The last poll returned no records in its window. Use Test connection to see what the source has available to import.";
  }
}

export function validateConnectionRange(
  startTime: string,
  endTime: string,
  now: number = Date.now(),
): string | null {
  const start: number = new Date(startTime).getTime();
  const end: number = new Date(endTime).getTime();

  if (
    !startTime ||
    !endTime ||
    !Number.isFinite(start) ||
    !Number.isFinite(end)
  ) {
    return "Choose a valid start and end time.";
  }
  if (start >= end) {
    return "The start time must be before the end time.";
  }
  if (end > now) {
    return "The end time must not be in the future.";
  }
  if (end - start > 7 * 24 * 60 * 60_000) {
    return "Choose a time range of 7 days or less.";
  }
  return null;
}

/*
 * Link to the Security Events table filtered on the event-time range this
 * run touched and, when something was imported, on this connection's
 * attribute (the poller stamps oneuptime.security_connection.id on every
 * event it writes).
 */
export function connectionEventsRoute(
  result: SecurityEventConnectionRunResult,
  connectionId?: string,
): Route {
  const sampleTimes: Array<number> = result.samples
    .map((sample: SecurityConnectorSample): number => {
      return new Date(sample.eventTime || sample.createdTime || "").getTime();
    })
    .filter(Number.isFinite);
  const start: Date = new Date(
    result.eventTimeStart ||
      (sampleTimes.length ? Math.min(...sampleTimes) : result.windowStart),
  );
  const end: Date = new Date(
    result.eventTimeEnd ||
      (sampleTimes.length ? Math.max(...sampleTimes) : result.windowEnd),
  );

  return RouteUtil.populateRouteParams(
    RouteMap[PageMap.SECURITY_EVENTS] as Route,
  ).addQueryParams(
    TableFilterUrlState.getLinkQueryParams("security-events-table", {
      filter: {
        time: new InBetween(
          new Date(start.getTime() - 1000),
          new Date(end.getTime() + 1000),
        ),
        ...(connectionId && result.ingestedCount > 0
          ? {
              attributes: {
                "oneuptime.security_connection.id": connectionId,
              },
            }
          : {}),
      },
    }),
  );
}

/*
 * Grouping used by ConnectorTestReportView. Keys are the stable machine
 * keys every tester emits (ConnectorPlatformHealth for the platform ones;
 * "<something>-available" / "<something>-count" for availability counts);
 * everything else is a check against the provider itself.
 */
export type ConnectorCheckGroup = "provider" | "availability" | "platform";

const PLATFORM_CHECK_KEYS: Array<string> = [
  "worker-consumers",
  "scheduler",
  "storage",
  "connection-schedule",
];

export function connectorCheckGroup(
  check: SecurityConnectorCheck,
): ConnectorCheckGroup {
  if (PLATFORM_CHECK_KEYS.includes(check.key)) {
    return "platform";
  }

  if (
    check.key === "detections-available" ||
    check.key.endsWith("-available") ||
    check.key.endsWith("-count")
  ) {
    return "availability";
  }

  return "provider";
}

export function connectorCheckGroupTitle(
  group: ConnectorCheckGroup,
  provider: string,
): string {
  switch (group) {
    case "platform":
      return "OneUptime workers and scheduler";
    case "availability":
      return "What is available to import";
    default:
      return `Access to ${connectorProviderTitle(provider)}`;
  }
}

/*
 * Google SecOps is not in the catalog (it predates the framework) but its
 * report carries provider "google-secops"; give it a readable title too.
 */
export function connectorProviderTitle(provider: string): string {
  if (provider === "google-secops") {
    return "Google SecOps";
  }

  return getSecurityEventConnectorTitle(provider) || provider;
}

export const connectorCheckStatusLabels: Record<
  SecurityConnectorCheckStatus,
  string
> = {
  pass: "Passed",
  fail: "Failed",
  warn: "Warning",
  skip: "Skipped",
};

/*
 * Human labels for the count keys testers emit. Unknown keys fall back to a
 * spaced-out version of the key so a new count is never silently hidden.
 */
export function connectorCountLabel(key: string): string {
  const known: Record<string, string> = {
    createdLast24h: "Created in the last 24 hours",
    createdLast7d: "Created in the last 7 days",
    ruleDetectionsLast24h: "Rule detections created in the last 24 hours",
    ruleDetectionsLast7d: "Rule detections created in the last 7 days",
    curatedDetectionsLast24h: "Curated detections created in the last 24 hours",
    curatedDetectionsLast7d: "Curated detections created in the last 7 days",
    baselineAlertsLast24h: "Alerts by detection time, last 24 hours",
    baselineAlertsLast7d: "Alerts by detection time, last 7 days",
    hasMoreLast24h: "More than one page in the last 24 hours",
    hasMoreLast7d: "More than one page in the last 7 days",
  };

  if (known[key]) {
    return known[key] as string;
  }

  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[-_]/g, " ")
    .toLowerCase()
    .replace(/^./, (character: string): string => {
      return character.toUpperCase();
    });
}

export function formatConnectorCountValue(value: unknown): string {
  if (typeof value === "boolean") {
    return value ? "Yes" : "No";
  }

  if (typeof value === "number") {
    return value.toLocaleString();
  }

  if (value === null || value === undefined || value === "") {
    return "Unknown";
  }

  return String(value);
}
