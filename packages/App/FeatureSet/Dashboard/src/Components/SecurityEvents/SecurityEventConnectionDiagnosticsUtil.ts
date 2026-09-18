import SecurityEventConnection from "Common/Models/DatabaseModels/SecurityEventConnection";
import Route from "Common/Types/API/Route";
import URL from "Common/Types/API/URL";
import { Green, LightGray, Red, Yellow } from "Common/Types/BrandColors";
import Color from "Common/Types/Color";
import { JSONObject, JSONValue } from "Common/Types/JSON";
import {
  SecurityConnectorCheck,
  SecurityConnectorCheckStatus,
  SecurityConnectorSample,
  SecurityConnectorTestReport,
} from "Common/Types/SecurityEvent/Connectors/ConnectorDiagnostics";
import {
  LEGACY_GOOGLE_SECOPS_CONNECTION_ID_ATTRIBUTE,
  SECURITY_CONNECTION_ID_ATTRIBUTE,
  SecurityEventConnectionRunResult,
  SecurityEventConnectionRunType,
} from "Common/Types/SecurityEvent/Connectors/SecurityEventConnectionDiagnostics";
import {
  ConnectorAlertingOnlyControl,
  SecurityEventConnectorDefinition,
  getSecurityEventConnectorTitle,
} from "Common/Types/SecurityEvent/Connectors/SecurityEventConnectorCatalog";
import { DOCS_URL } from "Common/UI/Config";
import TableFilterUrlState from "Common/UI/Utils/TableFilterUrlState";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import {
  SECURITY_EVENTS_TABLE_ID,
  getSecurityEventsTimeRangeLinkParams,
} from "./SecurityEventsTimeRange";

/*
 * Shared by every provider on the Security Event Connections page. The
 * vocabulary (health labels, run labels, date format, range rules) lives in
 * one place on purpose: a customer with a Google SecOps connection and a
 * Sentinel connection side by side reads the same words for the same state.
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
 * The Health vocabulary shared by every provider. Exported as constants so
 * the table column, the diagnostics modal and their tests spell each state
 * exactly once.
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
 * One decision tree for every provider. "No records returned" rather than
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
  /*
   * "No detections returned" is what the retired Google SecOps page called
   * an empty poll; kept so that label still reads as good.
   */
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

// Pill colour for a Health value; one mapping for every provider.
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
      return "The last poll could not read or process every record in its window. Scheduled polling continues on its own, from the last record read or with a shorter window; open Diagnostics for the warnings.";
    case CONNECTOR_HEALTH_CATCHING_UP:
      return "The connection is working through a backlog in windows of up to 24 hours.";
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
 * Runs carried over from the retired Google SecOps connector were written
 * before the shared result shape: samples name the rule and the detection
 * time, checks say "success" and "failed", and the provider diagnostics sit
 * at the top level of the result. The readers below accept both shapes, so
 * run history from before the move renders truthfully instead of as
 * "Untitled" rows and failed checks painted green.
 */
interface LegacyConnectorSampleFields {
  ruleName?: string | undefined;
  detectionTime?: string | undefined;
}

type ConnectorSampleWithLegacyFields = SecurityConnectorSample &
  LegacyConnectorSampleFields;

export function connectorSampleTitle(sample: SecurityConnectorSample): string {
  return (
    sample.title || (sample as ConnectorSampleWithLegacyFields).ruleName || ""
  );
}

// The record's own event (detection) time, never its creation time.
export function connectorSampleEventTime(
  sample: SecurityConnectorSample,
): string | undefined {
  return (
    sample.eventTime ||
    (sample as ConnectorSampleWithLegacyFields).detectionTime ||
    undefined
  );
}

const LEGACY_CHECK_STATUSES: Record<string, SecurityConnectorCheckStatus> = {
  success: "pass",
  failed: "fail",
};

export function normalizeConnectorCheckStatus(
  status: string,
): SecurityConnectorCheckStatus | string {
  return LEGACY_CHECK_STATUSES[status] || status;
}

// Keys the retired Google SecOps connector stored at the top of a result.
const LEGACY_PROVIDER_DETAIL_KEYS: Array<string> = [
  "basis",
  "sourceCounts",
  "creationLag",
  "includeNonAlertingDetections",
];

/*
 * The provider diagnostics of a run: result.providerDetails, or for a run
 * carried over from the retired Google SecOps connector the same fields read
 * from the top level of its result. Undefined when there are none.
 */
export function readConnectorProviderDetails(
  result: SecurityEventConnectionRunResult,
): JSONObject | undefined {
  if (isPlainCountObject(result.providerDetails)) {
    return result.providerDetails;
  }

  const raw: JSONObject = result as unknown as JSONObject;
  const legacy: JSONObject = {};

  for (const key of LEGACY_PROVIDER_DETAIL_KEYS) {
    if (raw[key] !== undefined && raw[key] !== null) {
      legacy[key] = raw[key] as JSONValue;
    }
  }

  return Object.keys(legacy).length > 0 ? legacy : undefined;
}

/*
 * The event attribute the rows this run imported carry the connection id
 * under. A run that names none was written by the shared poller, which
 * stamps SECURITY_CONNECTION_ID_ATTRIBUTE. The one exception is a run
 * carried over from the retired Google SecOps connector without the key
 * named: its result is recognisable by the includeNonAlertingDetections flag
 * that connector stored at the top level (the shared poller files provider
 * fields under providerDetails), and its rows carry the legacy attribute.
 * Filtering those on the new attribute would open an empty table.
 */
export function connectionEventAttributeKey(
  result: SecurityEventConnectionRunResult,
): string {
  if (result.eventAttributeKey) {
    return result.eventAttributeKey;
  }

  if (
    typeof (result as unknown as JSONObject)["includeNonAlertingDetections"] ===
    "boolean"
  ) {
    return LEGACY_GOOGLE_SECOPS_CONNECTION_ID_ATTRIBUTE;
  }

  return SECURITY_CONNECTION_ID_ATTRIBUTE;
}

/*
 * Link to Security Events on the event-time range this run touched and, when
 * something was imported, with the table filtered on this connection's
 * attribute (connectionEventAttributeKey). The range is the page's own time
 * range (the one its picker, volume chart and table share), not a table
 * filter. Without a stored event-time range the samples' EVENT times are used
 * before their creation times: a duplicate-only run of late-created
 * detections must open the range the detections are stored under, not the
 * day the source created them.
 */
export function connectionEventsRoute(
  result: SecurityEventConnectionRunResult,
  connectionId?: string,
): Route {
  const sampleTimes: Array<number> = result.samples
    .map((sample: SecurityConnectorSample): number => {
      return new Date(
        connectorSampleEventTime(sample) || sample.createdTime || "",
      ).getTime();
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
  ).addQueryParams({
    ...getSecurityEventsTimeRangeLinkParams(
      new Date(start.getTime() - 1000),
      new Date(end.getTime() + 1000),
    ),
    ...(connectionId && result.ingestedCount > 0
      ? TableFilterUrlState.getLinkQueryParams(SECURITY_EVENTS_TABLE_ID, {
          filter: {
            attributes: {
              [connectionEventAttributeKey(result)]: connectionId,
            },
          },
        })
      : {}),
  });
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

// The catalog title, or the raw identifier for a provider it does not list.
export function connectorProviderTitle(provider: string): string {
  return getSecurityEventConnectorTitle(provider) || provider;
}

type ConnectorScopeDefinition = Pick<
  SecurityEventConnectorDefinition,
  "supportsAlertingOnlyToggle" | "alertingOnlyControl"
>;

/*
 * How a provider's alertingOnly setting is named and summarised: in the
 * words of its catalog alertingOnlyControl ("Data to import": "Alerts only"
 * or "Alerts and detections") when it has one, generically otherwise.
 */
export function connectorScopeLabel(
  definition: ConnectorScopeDefinition | undefined,
): string {
  return definition?.alertingOnlyControl?.title || "Scope";
}

// Undefined for a provider whose records have no alerting distinction.
export function connectorScopeSummary(
  definition: ConnectorScopeDefinition | undefined,
  alertingOnly: boolean | undefined,
): string | undefined {
  if (!definition?.supportsAlertingOnlyToggle) {
    return undefined;
  }

  const control: ConnectorAlertingOnlyControl | undefined =
    definition.alertingOnlyControl;

  if (alertingOnly === false) {
    return control?.withNonAlertingSummary || "Alerts and detections";
  }

  return control?.alertingOnlySummary || "Alerts only";
}

/*
 * What an import brings in, in the control's own words: "alerts and
 * detections" or "alerts". Undefined without a control, where the record
 * name ("findings") already says it.
 */
export function connectorScopeImportNoun(
  definition: ConnectorScopeDefinition | undefined,
  alertingOnly: boolean | undefined,
): string | undefined {
  const control: ConnectorAlertingOnlyControl | undefined =
    definition?.supportsAlertingOnlyToggle
      ? definition.alertingOnlyControl
      : undefined;

  if (!control) {
    return undefined;
  }

  const alerting: string = control.alertingLabel.toLowerCase();

  return alertingOnly === false
    ? `${alerting} and ${control.nonAlertingLabel.toLowerCase()}`
    : alerting;
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
 * Human labels for the count keys the connectors report. Most put
 * { createdLast24h, createdLast7d, hasMoreLast24h, hasMoreLast7d } (plus
 * Okta's usingDefaultFilter) in their detections-available check details;
 * Google SecOps returns report counts with its own keys and a nested
 * otherScope object. Unknown keys fall back to a spaced-out version of the
 * key so a new count is never silently hidden.
 */
const CONNECTOR_COUNT_LABELS: Record<string, string> = {
  createdLast24h: "Created in the last 24 hours",
  createdLast7d: "Created in the last 7 days",
  // True when the source capped the count, so the number is a lower bound.
  hasMoreLast24h: "More than counted in the last 24 hours",
  hasMoreLast7d: "More than counted in the last 7 days",
  usingDefaultFilter: "Uses the default event filter",
  scope: "Data to import",
  otherScope: "Other Data to import choice",
  alertsViewLast24h: "Alerts by detection time, last 24 hours",
  alertsViewLast7d: "Alerts by detection time, last 7 days",
  ruleDetectionsCreatedLast24h: "Rule detections created in the last 24 hours",
  ruleDetectionsCreatedLast7d: "Rule detections created in the last 7 days",
};

export function connectorCountLabel(key: string): string {
  const known: string | undefined = CONNECTOR_COUNT_LABELS[key];

  if (known) {
    return known;
  }

  return key
    .replace(/Last24h$/, " in the last 24 hours")
    .replace(/Last7d$/, " in the last 7 days")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[-_]/g, " ")
    .toLowerCase()
    .replace(/^./, (character: string): string => {
      return character.toUpperCase();
    });
}

function isPlainCountObject(value: unknown): value is JSONObject {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    !(value instanceof Date)
  );
}

/*
 * Never falls back to String() for an object: that is how a nested count
 * rendered as "[object Object]". Arrays are listed; any other object is
 * shown as compact JSON so its content is still readable.
 */
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

  if (typeof value === "string") {
    return value;
  }

  if (Array.isArray(value)) {
    return value.length === 0
      ? "None"
      : value
          .map((item: unknown): string => {
            return formatConnectorCountValue(item);
          })
          .join(", ");
  }

  if (value instanceof Date) {
    return formatConnectionDate(value);
  }

  try {
    return JSON.stringify(value);
  } catch {
    return "Unknown";
  }
}

/*
 * The Google SecOps connector reports its scope as a machine value; show it
 * in the form's own vocabulary (Data to import: Alerts always, Detections
 * optional), worded as its check messages word it.
 */
function formatConnectorCountEntry(key: string, value: unknown): string {
  if (key === "scope") {
    if (value === "alerts-only") {
      return "Alerts only";
    }

    if (value === "alerts-and-detections") {
      return "Alerts and Detections";
    }
  }

  return formatConnectorCountValue(value);
}

export interface ConnectorCountRow {
  // Dotted path of the count in the report, e.g. "otherScope.scope".
  key: string;
  label: string;
  value: string;
}

// Deep enough for otherScope; anything deeper is shown as JSON.
const MAX_COUNT_NESTING: number = 3;

/*
 * One row per leaf count. A nested object becomes labelled rows prefixed by
 * its parent's label ("Other Data to import choice: rule detections created
 * in the last 24 hours"); its own `scope` leaf takes the parent label alone
 * because "Other Data to import choice: data to import" says it twice.
 */
export function connectorCountRows(
  counts: JSONObject,
  parent?: { key: string; label: string; depth: number } | undefined,
): Array<ConnectorCountRow> {
  const rows: Array<ConnectorCountRow> = [];

  for (const key of Object.keys(counts)) {
    const value: unknown = counts[key];
    const ownLabel: string = connectorCountLabel(key);
    const path: string = parent ? `${parent.key}.${key}` : key;
    const label: string = !parent
      ? ownLabel
      : key === "scope"
        ? parent.label
        : `${parent.label}: ${ownLabel.charAt(0).toLowerCase()}${ownLabel.slice(1)}`;
    const depth: number = parent ? parent.depth + 1 : 1;

    if (isPlainCountObject(value) && depth < MAX_COUNT_NESTING) {
      rows.push(
        ...connectorCountRows(value, { key: path, label, depth: depth }),
      );
      continue;
    }

    rows.push({
      key: path,
      label,
      value: formatConnectorCountEntry(key, value),
    });
  }

  return rows;
}

/*
 * The counts a report's "Availability counts" table shows. A connector that
 * returns counts from testConnection (Google SecOps) fills report.counts;
 * the others carry the same numbers in their detections-available check
 * details, so those are used when the report has none.
 */
export function connectorTestReportCounts(
  report: Pick<SecurityConnectorTestReport, "counts" | "checks">,
): JSONObject {
  if (isPlainCountObject(report.counts) && Object.keys(report.counts).length) {
    return report.counts;
  }

  const availability: SecurityConnectorCheck | undefined = (
    report.checks || []
  ).find((check: SecurityConnectorCheck): boolean => {
    return check.key === "detections-available";
  });

  if (
    availability &&
    isPlainCountObject(availability.details) &&
    Object.keys(availability.details).length
  ) {
    return availability.details;
  }

  return {};
}

export interface ConnectorProviderDetailRow {
  // Dotted path in providerDetails, e.g. "sourceCounts.alertsView".
  key: string;
  label: string;
  value: string;
}

export interface ConnectorProviderDetailGroup {
  key: string;
  // Absent for the group of top-level values.
  title?: string | undefined;
  rows: Array<ConnectorProviderDetailRow>;
}

/*
 * Labels for the provider diagnostics a connector reports on a run
 * (providerDetails). Google SecOps reports the time basis it read, how many
 * records each of its three passes returned, and how late Google created
 * records relative to their detection time. Unknown keys are spaced out the
 * way count keys are, so a new detail is never silently hidden.
 */
const CONNECTOR_PROVIDER_DETAIL_LABELS: Record<string, string> = {
  basis: "Time basis read",
  sourceCounts: "Returned by each pass",
  ruleDetections: "Rule detections",
  curatedDetections: "Curated rule detections",
  alertsView: "Alerts view",
  lateAlertsView: "Alerts view, late alerts from the previous day",
  curatedRulesWithDetections: "Curated rules with recent detections",
  creationLag: "Creation lag",
  measured: "Records measured",
  lateCount: "Created later than the poll interval",
  maxLagMinutes: "Longest lag (minutes)",
  includeNonAlertingDetections: "Includes non-alerting records",
};

const CONNECTOR_PROVIDER_DETAIL_VALUE_LABELS: Record<
  string,
  Record<string, string>
> = {
  basis: {
    "created-time": "Created time",
    "detection-time": "Detection time, with created time also read",
  },
};

export function connectorProviderDetailLabel(key: string): string {
  return CONNECTOR_PROVIDER_DETAIL_LABELS[key] || connectorCountLabel(key);
}

function formatConnectorProviderDetailValue(
  key: string,
  value: unknown,
): string {
  if (typeof value === "string") {
    return CONNECTOR_PROVIDER_DETAIL_VALUE_LABELS[key]?.[value] || value;
  }

  return formatConnectorCountValue(value);
}

/*
 * Top-level values first as one untitled group, then one titled group per
 * nested object ("Returned by each pass": rule detections, curated rule
 * detections, alerts view). Anything nested deeper is shown as JSON.
 * omitKeys drops details the caller renders in its own words, such as
 * includeNonAlertingDetections shown as the Data to import line.
 */
export function connectorProviderDetailGroups(
  details: JSONObject | undefined,
  omitKeys: Array<string> = [],
): Array<ConnectorProviderDetailGroup> {
  if (!details) {
    return [];
  }

  const general: ConnectorProviderDetailGroup = { key: "", rows: [] };
  const groups: Array<ConnectorProviderDetailGroup> = [general];

  for (const key of Object.keys(details)) {
    const value: unknown = details[key];

    if (omitKeys.includes(key) || value === undefined || value === null) {
      continue;
    }

    if (isPlainCountObject(value)) {
      groups.push({
        key,
        title: connectorProviderDetailLabel(key),
        rows: Object.keys(value).map(
          (childKey: string): ConnectorProviderDetailRow => {
            return {
              key: `${key}.${childKey}`,
              label: connectorProviderDetailLabel(childKey),
              value: formatConnectorProviderDetailValue(
                childKey,
                value[childKey],
              ),
            };
          },
        ),
      });
      continue;
    }

    general.rows.push({
      key,
      label: connectorProviderDetailLabel(key),
      value: formatConnectorProviderDetailValue(key, value),
    });
  }

  return groups.filter((group: ConnectorProviderDetailGroup): boolean => {
    return group.rows.length > 0;
  });
}

// A whole number of minutes from a run result, or null when absent or invalid.
export function readWindowMinutes(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.max(1, Math.round(value))
    : null;
}

// "1 minute", "45 minutes", "3 hours", "24 hours", "90 minutes".
export function formatWindowMinutes(minutes: number): string {
  if (minutes >= 60 && minutes % 60 === 0) {
    const hours: number = minutes / 60;
    return `${hours} hour${hours === 1 ? "" : "s"}`;
  }

  return `${minutes.toLocaleString()} minute${minutes === 1 ? "" : "s"}`;
}
