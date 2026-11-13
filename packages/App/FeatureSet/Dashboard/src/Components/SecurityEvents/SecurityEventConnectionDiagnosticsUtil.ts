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
  SecurityEventConnectionRunStatus,
  SecurityEventConnectionRunType,
} from "Common/Types/SecurityEvent/Connectors/SecurityEventConnectionDiagnostics";
import {
  ConnectorAlertingOnlyControl,
  SecurityEventConnectorDefinition,
  getSecurityEventConnectorTitle,
} from "Common/Types/SecurityEvent/Connectors/SecurityEventConnectorCatalog";
import { DOCS_URL } from "Common/UI/Config";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import {
  SECURITY_EVENT_ATTRIBUTE_FACET_PREFIX,
  buildSecurityEventFacetLinkParams,
} from "./SecurityEventsFacets";
import { getSecurityEventsTimeRangeLinkParams } from "./SecurityEventsTimeRange";
import {
  getLocaleClockHourOption,
  getReaderDateLocale,
  getReaderNumberLocale,
} from "Common/Types/DateLanguage";
import {
  TemplateValue,
  Translator,
  composedValue,
  translatableTerm,
  translationKey,
} from "Common/UI/Utils/TranslateTemplate";

/*
 * Shared by every provider on the Security Event Connections page. The
 * vocabulary (health labels, run labels, date format, range rules) lives in
 * one place on purpose: a customer with a Google SecOps connection and a
 * Sentinel connection side by side reads the same words for the same state.
 *
 * Every word here is kept in English and looked up where it is drawn
 * (#6658): a constant is a translationKey(), and a helper that writes a
 * sentence takes the reader's Translator. Without one it writes the English
 * the server, the API and support tickets read.
 */

// API path (under APP_API_URL) of the synchronous connection test.
export const SECURITY_EVENT_CONNECTION_TEST_ROUTE: string =
  "/security-event-connection/test";

export const securityEventConnectionRunLabels: Record<
  SecurityEventConnectionRunType,
  string
> = {
  test: translationKey("Test connection"),
  poll: translationKey("Poll"),
  preview: translationKey("Preview"),
  backfill: translationKey("Historical import"),
};

// The heading over one run, each written whole so a language words it its way.
export const securityEventConnectionRunDetailsTitles: Record<
  SecurityEventConnectionRunType,
  string
> = {
  test: translationKey("Test connection details"),
  poll: translationKey("Poll details"),
  preview: translationKey("Preview details"),
  backfill: translationKey("Historical import details"),
};

/*
 * A run's status as run history and the run's own line say it. The stored
 * values are machine words ("success", "empty"); a status the server adds
 * later is shown as stored.
 */
export const securityEventConnectionRunStatusLabels: Record<
  SecurityEventConnectionRunStatus,
  string
> = {
  queued: translationKey("Queued"),
  running: translationKey("Running"),
  success: translationKey("Success"),
  empty: translationKey("No records"),
  partial: translationKey("Partial"),
  failed: translationKey("Failed"),
};

export function securityEventConnectionRunStatusLabel(
  status: string,
  translator?: Translator | undefined,
): string {
  const label: string | undefined =
    securityEventConnectionRunStatusLabels[
      status as SecurityEventConnectionRunStatus
    ];

  if (!label) {
    return status;
  }

  return translator ? translator.translateText(label) || label : label;
}

/*
 * What one source's records are called, more than one of them: the catalog
 * names one record ("detection"), and every name there takes an s in
 * English. Each is a key here because the extractor does not read the
 * catalog; SecurityEventConnectionTextsInLanguage holds every catalog name
 * to an entry, so a new provider cannot leave its sentences in English.
 */
export const CONNECTOR_RECORDS_NAMES: Readonly<Record<string, string>> = {
  incident: translationKey("incidents"),
  alert: translationKey("alerts"),
  "notable event": translationKey("notable events"),
  finding: translationKey("findings"),
  "log event": translationKey("log events"),
  record: translationKey("records"),
  "audit event": translationKey("audit events"),
  detection: translationKey("detections"),
};

export function connectorRecordsName(
  definition:
    | Pick<SecurityEventConnectorDefinition, "importedRecordName">
    | undefined,
): string {
  const name: string = definition?.importedRecordName || "record";

  return CONNECTOR_RECORDS_NAMES[name] || `${name}s`;
}

/*
 * The records as a sentence names them: "detections" in English,
 * "Erkennungen" in German, in the sentence's language.
 */
export function connectorRecordsTerm(
  definition:
    | Pick<SecurityEventConnectorDefinition, "importedRecordName">
    | undefined,
): TemplateValue {
  return translatableTerm(connectorRecordsName(definition), {
    inSentence: true,
  });
}

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

const CONNECTION_DATE_NEVER: string = translationKey("Never");
const CONNECTION_DATE_UNKNOWN: string = translationKey("Unknown");

/*
 * A UTC timestamp as run history, the API and support tickets write it
 * ("2026-09-10 12:00:00 UTC"), the same in every language; only "Never" and
 * "Unknown" are words, in the reader's language with a translator.
 */
export function formatConnectionDate(
  value: string | Date | undefined,
  translator?: Translator | undefined,
): string {
  const word: (english: string) => string = (english: string): string => {
    return translator ? translator.translateText(english) || english : english;
  };

  if (!value) {
    return word(CONNECTION_DATE_NEVER);
  }

  const date: Date = new Date(value);
  return Number.isNaN(date.getTime())
    ? word(CONNECTION_DATE_UNKNOWN)
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

  // On the language's own clock, a 12-hour hour without its zero (#7279).
  return date.toLocaleString(getReaderDateLocale(), {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: getLocaleClockHourOption(getReaderDateLocale()),
    minute: "2-digit",
    second: "2-digit",
    timeZoneName: "short",
  });
}

const LOCAL_TIME_TITLE: string = translationKey("Local time: {{time}}");

// Title attribute for a UTC timestamp: the local rendering, or nothing.
export function connectionTimeTitle(
  value: string | Date | undefined,
  translator?: Translator | undefined,
): string | undefined {
  const local: string = formatConnectionLocalDate(value);

  if (!local) {
    return undefined;
  }

  return translator
    ? translator.translateTemplate(LOCAL_TIME_TITLE, { time: local })
    : `Local time: ${local}`;
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
export const CONNECTOR_HEALTH_SUCCEEDED: string = translationKey(
  "Last poll succeeded",
);
export const CONNECTOR_HEALTH_NO_EVENTS_YET: string = translationKey(
  "Polling, no events imported yet",
);
export const CONNECTOR_HEALTH_FAILED: string =
  translationKey("Last poll failed");
export const CONNECTOR_HEALTH_OVERDUE: string = translationKey("Poll overdue");
export const CONNECTOR_HEALTH_PARTIAL: string =
  translationKey("Partial import");
export const CONNECTOR_HEALTH_CATCHING_UP: string =
  translationKey("Catching up");
export const CONNECTOR_HEALTH_PAUSED: string =
  translationKey("Schedule paused");
export const CONNECTOR_HEALTH_WAITING: string = translationKey(
  "Waiting for first poll",
);
export const CONNECTOR_HEALTH_UNAVAILABLE: string = translationKey(
  "Details unavailable",
);
export const CONNECTOR_HEALTH_NO_RECORDS: string = translationKey(
  "No records returned",
);

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
    return CONNECTOR_HEALTH_NO_RECORDS;
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
    health === CONNECTOR_HEALTH_NO_RECORDS ||
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
 * Returned for every state so the pill has a consistent affordance. In
 * English: the Pill and the diagnostics line look it up as they draw it.
 */
export function connectorHealthTooltip(health: string): string {
  switch (health) {
    case CONNECTOR_HEALTH_NO_EVENTS_YET:
      return translationKey(
        "Scheduled polls succeed, but no event has been imported yet. Use Test connection to see what the source has available to import and whether OneUptime's workers are running.",
      );
    case CONNECTOR_HEALTH_SUCCEEDED:
      return translationKey(
        "The last scheduled poll succeeded and this connection has imported events.",
      );
    case CONNECTOR_HEALTH_FAILED:
      return translationKey(
        "The last scheduled poll failed. Open View Error for the full message.",
      );
    case CONNECTOR_HEALTH_OVERDUE:
      return translationKey(
        "The scheduler has not polled this connection when it was due. Use Test connection to check whether OneUptime's workers and scheduler are running.",
      );
    case CONNECTOR_HEALTH_PARTIAL:
      return translationKey(
        "The last poll could not read or process every record in its window. Scheduled polling continues on its own, from the last record read or with a shorter window; open Diagnostics for the warnings.",
      );
    case CONNECTOR_HEALTH_CATCHING_UP:
      return translationKey(
        "The connection is working through a backlog in windows of up to 24 hours.",
      );
    case CONNECTOR_HEALTH_PAUSED:
      return translationKey(
        "Scheduled polling is disabled. Run now still works.",
      );
    case CONNECTOR_HEALTH_WAITING:
      return translationKey(
        "Created moments ago; the scheduler polls once a minute.",
      );
    case CONNECTOR_HEALTH_UNAVAILABLE:
      return translationKey("A poll ran but recorded no result details.");
    default:
      return translationKey(
        "The last poll returned no records in its window. Use Test connection to see what the source has available to import.",
      );
  }
}

/*
 * Why a time range cannot be previewed or imported, in English: the
 * diagnostics modal looks the sentence up where it shows it.
 */
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
    return translationKey("Choose a valid start and end time.");
  }
  if (start >= end) {
    return translationKey("The start time must be before the end time.");
  }
  if (end > now) {
    return translationKey("The end time must not be in the future.");
  }
  if (end - start > 7 * 24 * 60 * 60_000) {
    return translationKey("Choose a time range of 7 days or less.");
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
      ? buildSecurityEventFacetLinkParams([
          [
            `${SECURITY_EVENT_ATTRIBUTE_FACET_PREFIX}${connectionEventAttributeKey(
              result,
            )}`,
            connectionId,
          ],
        ])
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

const CHECK_GROUP_PLATFORM_TITLE: string = translationKey(
  "OneUptime workers and scheduler",
);
const CHECK_GROUP_AVAILABILITY_TITLE: string = translationKey(
  "What is available to import",
);
const CHECK_GROUP_PROVIDER_TITLE: string = translationKey(
  "Access to {{provider}}",
);

export function connectorCheckGroupTitle(
  group: ConnectorCheckGroup,
  provider: string,
  translator?: Translator | undefined,
): string {
  const word: (english: string) => string = (english: string): string => {
    return translator ? translator.translateText(english) || english : english;
  };

  switch (group) {
    case "platform":
      return word(CHECK_GROUP_PLATFORM_TITLE);
    case "availability":
      return word(CHECK_GROUP_AVAILABILITY_TITLE);
    default:
      return translator
        ? translator.translateTemplate(CHECK_GROUP_PROVIDER_TITLE, {
            provider: connectorProviderTitle(provider),
          })
        : `Access to ${connectorProviderTitle(provider)}`;
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
  return definition?.alertingOnlyControl?.title || translationKey("Scope");
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
    return (
      control?.withNonAlertingSummary || translationKey("Alerts and detections")
    );
  }

  return control?.alertingOnlySummary || translationKey("Alerts only");
}

/*
 * What an import brings in, as a sentence names it: "alerts and detections"
 * or "alerts" in the control's own words and the sentence's language, or
 * the source's records ("findings") without a control.
 */
export function connectorScopeImportValue(
  definition:
    | (ConnectorScopeDefinition &
        Pick<SecurityEventConnectorDefinition, "importedRecordName">)
    | undefined,
  alertingOnly: boolean | undefined,
): TemplateValue {
  const control: ConnectorAlertingOnlyControl | undefined =
    definition?.supportsAlertingOnlyToggle
      ? definition.alertingOnlyControl
      : undefined;

  if (!control) {
    return connectorRecordsTerm(definition);
  }

  if (alertingOnly !== false) {
    return translatableTerm(control.alertingLabel, { inSentence: true });
  }

  return composedValue((sentence: Translator): string => {
    return sentence.translateTemplate("{{first}} and {{second}}", {
      first: translatableTerm(control.alertingLabel, { inSentence: true }),
      second: translatableTerm(control.nonAlertingLabel, { inSentence: true }),
    });
  });
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
  pass: translationKey("Passed"),
  fail: translationKey("Failed"),
  warn: translationKey("Warning"),
  skip: translationKey("Skipped"),
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
  createdLast24h: translationKey("Created in the last 24 hours"),
  createdLast7d: translationKey("Created in the last 7 days"),
  // True when the source capped the count, so the number is a lower bound.
  hasMoreLast24h: translationKey("More than counted in the last 24 hours"),
  hasMoreLast7d: translationKey("More than counted in the last 7 days"),
  usingDefaultFilter: translationKey("Uses the default event filter"),
  scope: translationKey("Data to import"),
  otherScope: translationKey("Other Data to import choice"),
  alertsViewLast24h: translationKey("Alerts by detection time, last 24 hours"),
  alertsViewLast7d: translationKey("Alerts by detection time, last 7 days"),
  ruleDetectionsCreatedLast24h: translationKey(
    "Rule detections created in the last 24 hours",
  ),
  ruleDetectionsCreatedLast7d: translationKey(
    "Rule detections created in the last 7 days",
  ),
};

/*
 * A count's label, in the reader's language with a translator. A key no
 * label names is spaced out from the machine key in English
 * ("incidentsCreatedLast7d": "Incidents created in the last 7 days") in
 * every language, so a new count is never silently hidden.
 */
export function connectorCountLabel(
  key: string,
  translator?: Translator | undefined,
): string {
  const known: string | undefined = CONNECTOR_COUNT_LABELS[key];

  if (known) {
    return translator ? translator.translateText(known) || known : known;
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
export function formatConnectorCountValue(
  value: unknown,
  translator?: Translator | undefined,
): string {
  const word: (english: string) => string = (english: string): string => {
    return translator ? translator.translateText(english) || english : english;
  };

  if (typeof value === "boolean") {
    return value ? word(translationKey("Yes")) : word(translationKey("No"));
  }

  if (typeof value === "number") {
    return value.toLocaleString(getReaderNumberLocale());
  }

  if (value === null || value === undefined || value === "") {
    return word(translationKey("Unknown"));
  }

  if (typeof value === "string") {
    return value;
  }

  if (Array.isArray(value)) {
    return value.length === 0
      ? word(translationKey("None"))
      : value
          .map((item: unknown): string => {
            return formatConnectorCountValue(item, translator);
          })
          .join(", ");
  }

  if (value instanceof Date) {
    return formatConnectionDate(value, translator);
  }

  try {
    return JSON.stringify(value);
  } catch {
    return word(translationKey("Unknown"));
  }
}

/*
 * The Google SecOps connector reports its scope as a machine value; show it
 * in the form's own vocabulary (Data to import: Alerts always, Detections
 * optional), worded as its check messages word it.
 */
function formatConnectorCountEntry(
  key: string,
  value: unknown,
  translator?: Translator | undefined,
): string {
  const word: (english: string) => string = (english: string): string => {
    return translator ? translator.translateText(english) || english : english;
  };

  if (key === "scope") {
    if (value === "alerts-only") {
      return word(translationKey("Alerts only"));
    }

    if (value === "alerts-and-detections") {
      return word(translationKey("Alerts and Detections"));
    }
  }

  return formatConnectorCountValue(value, translator);
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
interface ConnectorCountParent {
  key: string;
  label: string;
  // The English label, for a sentence that names the group in the reader's language.
  englishLabel: string;
  depth: number;
}

const COUNT_IN_GROUP_LABEL: string = translationKey("{{group}}: {{measure}}");

/*
 * With a translator, every label is in the reader's language, a nested one
 * written whole ("{{group}}: {{measure}}") with the measure cased for the
 * middle of a line the way that language cases it.
 */
export function connectorCountRows(
  counts: JSONObject,
  parent?: ConnectorCountParent | undefined,
  translator?: Translator | undefined,
): Array<ConnectorCountRow> {
  const rows: Array<ConnectorCountRow> = [];

  for (const key of Object.keys(counts)) {
    const value: unknown = counts[key];
    const ownLabel: string = connectorCountLabel(key);
    const path: string = parent ? `${parent.key}.${key}` : key;
    const englishLabel: string = !parent
      ? ownLabel
      : key === "scope"
        ? parent.englishLabel
        : `${parent.englishLabel}: ${ownLabel.charAt(0).toLowerCase()}${ownLabel.slice(1)}`;
    const label: string = !translator
      ? englishLabel
      : !parent
        ? connectorCountLabel(key, translator)
        : key === "scope"
          ? parent.label
          : translator.translateTemplate(COUNT_IN_GROUP_LABEL, {
              group: translatableTerm(parent.englishLabel),
              measure: translatableTerm(ownLabel, { inSentence: true }),
            });
    const depth: number = parent ? parent.depth + 1 : 1;

    if (isPlainCountObject(value) && depth < MAX_COUNT_NESTING) {
      rows.push(
        ...connectorCountRows(
          value,
          { key: path, label, englishLabel, depth: depth },
          translator,
        ),
      );
      continue;
    }

    rows.push({
      key: path,
      label,
      value: formatConnectorCountEntry(key, value, translator),
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
  basis: translationKey("Time basis read"),
  sourceCounts: translationKey("Returned by each pass"),
  ruleDetections: translationKey("Rule detections"),
  curatedDetections: translationKey("Curated rule detections"),
  alertsView: translationKey("Alerts view"),
  lateAlertsView: translationKey(
    "Alerts view, late alerts from the previous day",
  ),
  curatedRulesWithDetections: translationKey(
    "Curated rules with recent detections",
  ),
  creationLag: translationKey("Creation lag"),
  measured: translationKey("Records measured"),
  lateCount: translationKey("Created later than the poll interval"),
  maxLagMinutes: translationKey("Longest lag (minutes)"),
  includeNonAlertingDetections: translationKey("Includes non-alerting records"),
};

const CONNECTOR_PROVIDER_DETAIL_VALUE_LABELS: Record<
  string,
  Record<string, string>
> = {
  basis: {
    "created-time": translationKey("Created time"),
    "detection-time": translationKey(
      "Detection time, with created time also read",
    ),
  },
};

export function connectorProviderDetailLabel(
  key: string,
  translator?: Translator | undefined,
): string {
  const known: string | undefined = CONNECTOR_PROVIDER_DETAIL_LABELS[key];

  if (!known) {
    return connectorCountLabel(key, translator);
  }

  return translator ? translator.translateText(known) || known : known;
}

function formatConnectorProviderDetailValue(
  key: string,
  value: unknown,
  translator?: Translator | undefined,
): string {
  if (typeof value === "string") {
    const known: string | undefined =
      CONNECTOR_PROVIDER_DETAIL_VALUE_LABELS[key]?.[value];

    if (!known) {
      return value;
    }

    return translator ? translator.translateText(known) || known : known;
  }

  return formatConnectorCountValue(value, translator);
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
  translator?: Translator | undefined,
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
        title: connectorProviderDetailLabel(key, translator),
        rows: Object.keys(value).map(
          (childKey: string): ConnectorProviderDetailRow => {
            return {
              key: `${key}.${childKey}`,
              label: connectorProviderDetailLabel(childKey, translator),
              value: formatConnectorProviderDetailValue(
                childKey,
                value[childKey],
                translator,
              ),
            };
          },
        ),
      });
      continue;
    }

    general.rows.push({
      key,
      label: connectorProviderDetailLabel(key, translator),
      value: formatConnectorProviderDetailValue(key, value, translator),
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

/*
 * "1 minute", "45 minutes", "3 hours", "24 hours", "90 minutes": counted
 * the way the reader's language counts with a translator ("3 Stunden").
 */
export function formatWindowMinutes(
  minutes: number,
  translator?: Translator | undefined,
): string {
  if (minutes >= 60 && minutes % 60 === 0) {
    const hours: number = minutes / 60;

    if (translator) {
      return translator.translatePlural(
        { one: "{{count}} hour", other: "{{count}} hours" },
        hours,
      );
    }

    return `${hours} hour${hours === 1 ? "" : "s"}`;
  }

  if (translator) {
    return translator.translatePlural(
      { one: "{{count}} minute", other: "{{count}} minutes" },
      minutes,
    );
  }

  return `${minutes.toLocaleString("en-US")} minute${minutes === 1 ? "" : "s"}`;
}

/*
 * A window length that goes into a sentence: worded in the sentence's own
 * language, so an English sentence never carries "3 Stunden".
 */
export function windowMinutesValue(minutes: number): TemplateValue {
  return composedValue((sentence: Translator): string => {
    return formatWindowMinutes(minutes, sentence);
  });
}
