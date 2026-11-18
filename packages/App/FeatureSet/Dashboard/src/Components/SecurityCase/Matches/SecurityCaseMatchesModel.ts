import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import { withRouteQueryParams } from "../../../Utils/TelemetryTabScope";
import { toSecurityEvent } from "../Evidence/EventEvidence";
import { getEntityRiskRoute } from "../../SecurityEvents/EntityRisk/EntityRiskModel";
import {
  SecurityEventLogsLink,
  getSecurityEventExceptionRoute,
  getSecurityEventLogsLink,
  getSecurityEventTraceRoute,
} from "../../SecurityEvents/SecurityEventTelemetryLinks";
import { getSecurityEventsTimeRangeLinkParams } from "../../SecurityEvents/SecurityEventsTimeRange";
import {
  BASIS_NOTES,
  EVENT_FROM_LOG_LINE,
  EVENT_FROM_LOG_LINE_OF,
  EVENT_FROM_PRODUCT,
  EVENT_LINK_EXCEPTION,
  EVENT_LINK_LOGS,
  EVENT_LINK_TRACE,
  FIRES_ON_EACH_MATCH,
  FIRES_WHEN_EVENTS,
  FIRES_WHEN_EVENTS_FOR_SAME,
  FIRES_WHEN_SAME_SHOWS_VALUES,
  FIRES_WHEN_VALUES,
  LOOK_NEXT_CONNECTED,
  LOOK_NEXT_ENTITY,
  LOOK_NEXT_EVENTS_NAMING,
  LOOK_NEXT_LOG_LINES_NAMING,
  LOOK_NEXT_SERVICE_LOGS,
  LOOK_NEXT_STORY,
  LOOK_NEXT_TRACES,
  MATCHED_BETWEEN,
  MATCHED_FROM_BETWEEN,
  MATCHED_NAMING_BETWEEN,
  REQUESTS_ALL_TURNED_AWAY,
  REQUESTS_GOT_THROUGH,
} from "./SecurityCaseMatchesCopy";
import SecurityEvent from "Common/Models/AnalyticsModels/SecurityEvent";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import {
  SecurityCaseMatchBasis,
  SecurityCaseMatchRuleJson,
  SecurityCaseMatchedDetectionJson,
  SecurityCaseMatchedEventJson,
} from "Common/Types/SecurityCase/SecurityCaseMatches";
import {
  SecurityEntity,
  SecurityEntityType,
  inferSecurityEntityType,
  securityEntityTypeForField,
} from "Common/Types/SecurityCase/SecurityEntity";
import SecurityEventRequestOutcome, {
  SECURITY_REQUEST_ATTRIBUTES,
} from "Common/Types/SecurityEvent/SecurityEventRequestOutcome";
import { buildSearchTokenValue } from "Common/Types/Telemetry/TelemetrySearchQuery";
import ServiceType from "Common/Types/Telemetry/ServiceType";
import { PluralTemplate } from "Common/UI/Utils/TranslateTemplate";
import {
  SecurityLogResource,
  readSecurityLogResource,
} from "Common/Utils/SecurityCase/SecurityConnectionMatch";
import { getTelemetryMessageSearchText } from "Common/Utils/SecurityCase/SecurityTelemetrySearch";
import {
  CrossSignalQueryParams,
  toLogsExplorerQueryParams,
  toTracesExplorerQueryParams,
} from "Common/Utils/Telemetry/CrossSignalScope";

/*
 * WHY A CASE WAS OPENED, AS DATA: what the case's "Why This Case Was
 * Opened" card says about each detection - how its rule counts, what it
 * matched and over when, how far its requests got - what each event row
 * says it came from and opens, and where to look next (#9556).
 *
 * React-free, so a plain test pins every rule of it. Its words are English
 * keys (SecurityCaseMatchesCopy.ts), looked up where they are drawn.
 */

// Rows shown of a detection's events before "Show more".
export const MATCHED_EVENTS_SHOWN: number = 5;

// The most traces a "these requests" link carries.
export const LOOK_NEXT_MAX_TRACES: number = 20;

// Padding either side of a detection's window for the explorers it opens.
export const LOOK_NEXT_PADDING_IN_MINUTES: number = 5;

// ---------- How a rule counts ----------

/*
 * The sentence that says when a single rule fires, as the parts the card
 * draws it from: the template, the fields it names (drawn as code) and its
 * values. Null for a correlation, whose own sentence says how it counts
 * (DetectionRuleSummary), and for no rule.
 */
export interface RuleCountingSentence {
  template: string;
  // Each slot's field: drawn as the column name it is.
  fields: Record<string, string>;
  // The rule's threshold, as the template counts it.
  count: number;
  // How long a window it counts in, for the timespan.
  windowInSeconds: number;
}

export function getRuleCountingSentence(
  rule: SecurityCaseMatchRuleJson | null,
): RuleCountingSentence | null {
  if (!rule || rule.isCorrelation) {
    return null;
  }

  const grouped: boolean = Boolean(rule.groupByField);
  const windowInSeconds: number = Math.max(1, rule.windowInMinutes) * 60;

  if (rule.distinctCountField) {
    return grouped
      ? {
          template: FIRES_WHEN_SAME_SHOWS_VALUES,
          fields: {
            groupBy: rule.groupByField,
            fields: rule.distinctCountField,
          },
          count: rule.threshold,
          windowInSeconds,
        }
      : {
          template: FIRES_WHEN_VALUES,
          fields: { fields: rule.distinctCountField },
          count: rule.threshold,
          windowInSeconds,
        };
  }

  if (rule.threshold <= 1) {
    return {
      template: FIRES_ON_EACH_MATCH,
      fields: {},
      count: 1,
      windowInSeconds,
    };
  }

  return grouped
    ? {
        template: FIRES_WHEN_EVENTS_FOR_SAME,
        fields: { groupBy: rule.groupByField },
        count: rule.threshold,
        windowInSeconds,
      }
    : {
        template: FIRES_WHEN_EVENTS,
        fields: {},
        count: rule.threshold,
        windowInSeconds,
      };
}

// ---------- What it matched ----------

// The fields a rule groups the one who acted by: their events come "from" the value.
const ACTING_FIELDS: ReadonlyArray<string> = [
  "principalip",
  "principaluser",
  "principalhost",
];

/*
 * "12 events from 35.196.249.14 between 19:22 and 19:28": how many matched,
 * about what, over when. The events are "from" the value when the rule
 * groups by who acted, "naming" it otherwise. Null when the events were not
 * read (no window, or the read failed).
 */
export interface MatchedSentence {
  template: PluralTemplate;
  count: number;
  value: string;
  start: Date;
  end: Date;
}

export function getMatchedSentence(
  detection: SecurityCaseMatchedDetectionJson,
): MatchedSentence | null {
  if (
    detection.matchedEventCount === null ||
    !detection.windowStart ||
    !detection.windowEnd
  ) {
    return null;
  }

  const value: string = detection.groupValue.trim();
  const groupByField: string = (detection.rule?.groupByField || "")
    .trim()
    .toLowerCase();
  const template: PluralTemplate = !value
    ? MATCHED_BETWEEN
    : detection.basis === SecurityCaseMatchBasis.RuleCondition &&
        ACTING_FIELDS.includes(groupByField)
      ? MATCHED_FROM_BETWEEN
      : MATCHED_NAMING_BETWEEN;

  return {
    template,
    count: detection.matchedEventCount,
    value,
    start: new Date(detection.windowStart),
    end: new Date(detection.windowEnd),
  };
}

// What the listed events are, when they are not exactly what the rule matched.
export function getBasisNote(
  detection: Pick<SecurityCaseMatchedDetectionJson, "basis" | "groupValue">,
): string {
  const note: string = BASIS_NOTES[detection.basis] || "";

  // A note about a value says nothing without one.
  if (note.includes("{{value}}") && !detection.groupValue.trim()) {
    return "";
  }

  return note;
}

// ---------- How far its requests got ----------

export enum RequestOutcomeSummaryKind {
  // Every followed request was turned away.
  AllTurnedAway = "AllTurnedAway",
  // At least one got past the app's checks: it reached a handler, errored or reached the database.
  SomeGotThrough = "SomeGotThrough",
  // No request was followed into its trace.
  NotFollowed = "NotFollowed",
}

export interface RequestOutcomeSummary {
  kind: RequestOutcomeSummaryKind;
  // Requests followed into their trace.
  followed: number;
  // Of those, the ones past the app's checks.
  through: number;
  // Each outcome and how many, the most serious first, none for an unfollowed request.
  tally: Array<{ outcome: SecurityEventRequestOutcome; count: number }>;
}

const OUTCOMES_MOST_SERIOUS_FIRST: ReadonlyArray<SecurityEventRequestOutcome> =
  [
    SecurityEventRequestOutcome.ReachedDatabase,
    SecurityEventRequestOutcome.Errored,
    SecurityEventRequestOutcome.ReachedApp,
    SecurityEventRequestOutcome.Rejected,
  ];

export function getRequestOutcomeSummary(
  outcomes: Record<string, number>,
): RequestOutcomeSummary {
  const tally: Array<{ outcome: SecurityEventRequestOutcome; count: number }> =
    [];
  let followed: number = 0;
  let through: number = 0;

  for (const outcome of OUTCOMES_MOST_SERIOUS_FIRST) {
    const count: number = Math.max(0, Math.trunc(outcomes[outcome] || 0));

    if (count === 0) {
      continue;
    }

    tally.push({ outcome, count });
    followed += count;

    if (outcome !== SecurityEventRequestOutcome.Rejected) {
      through += count;
    }
  }

  return {
    kind:
      followed === 0
        ? RequestOutcomeSummaryKind.NotFollowed
        : through > 0
          ? RequestOutcomeSummaryKind.SomeGotThrough
          : RequestOutcomeSummaryKind.AllTurnedAway,
    followed,
    through,
    tally,
  };
}

// The sentence the summary is said in; null when no request was followed.
export function getRequestOutcomeSentence(
  summary: RequestOutcomeSummary,
): PluralTemplate | null {
  switch (summary.kind) {
    case RequestOutcomeSummaryKind.AllTurnedAway:
      return REQUESTS_ALL_TURNED_AWAY;
    case RequestOutcomeSummaryKind.SomeGotThrough:
      return REQUESTS_GOT_THROUGH;
    default:
      return null;
  }
}

// ---------- An event's row ----------

// The service a log line was sent under, by name and id, when the event says.
export function getEventLogService(
  event: Pick<SecurityCaseMatchedEventJson, "attributes">,
): { id: string; name: string } | null {
  const name: string = (event.attributes["oneuptime.log.service"] || "").trim();
  const resource: SecurityLogResource | null = readSecurityLogResource(
    event.attributes,
  );
  const id: string =
    resource && resource.type === ServiceType.OpenTelemetry ? resource.id : "";

  return name || id ? { id, name } : null;
}

/*
 * Where an event came from, in a few words: the log line and the service
 * it was sent under, or the product that sent it.
 */
export interface EventSourceLabel {
  template: string;
  values: Record<string, string>;
}

export function getEventSourceLabel(
  event: SecurityCaseMatchedEventJson,
): EventSourceLabel | null {
  const isLogLine: boolean = Boolean(
    (event.attributes["oneuptime.log.id"] || "").trim(),
  );
  const service: { id: string; name: string } | null =
    getEventLogService(event);

  if (isLogLine) {
    return service?.name
      ? { template: EVENT_FROM_LOG_LINE_OF, values: { service: service.name } }
      : { template: EVENT_FROM_LOG_LINE, values: {} };
  }

  const product: string = [event.vendorName, event.productName]
    .map((part: string): string => {
      return part.trim();
    })
    .filter((part: string, index: number, parts: Array<string>): boolean => {
      // "Okta Okta" says nothing twice.
      return Boolean(part) && parts.indexOf(part) === index;
    })
    .join(" ");

  return product ? { template: EVENT_FROM_PRODUCT, values: { product } } : null;
}

// The text an event's row reads: its message, else what it acted on, else its class.
export function getEventRowText(event: SecurityCaseMatchedEventJson): string {
  return (
    event.message.trim() ||
    event.attributes[SECURITY_REQUEST_ATTRIBUTES.url]?.trim() ||
    event.className.trim()
  );
}

export type EventLinkKey = "trace" | "logs" | "exception";

export interface EventLink {
  key: EventLinkKey;
  label: string;
  icon: IconProp;
  route: Route;
}

/*
 * What an event's row opens, in this order: the trace of the request it
 * happened in (at the span that answered it), the log lines that request
 * wrote - or, for a line written outside a request, its service's lines
 * around it - and the exception the request threw.
 */
export function getEventLinks(
  event: SecurityCaseMatchedEventJson,
): Array<EventLink> {
  const securityEvent: SecurityEvent = toSecurityEvent(event);
  const links: Array<EventLink> = [];
  const trace: Route | null = getSecurityEventTraceRoute({
    event: securityEvent,
    serverSpanId: event.attributes[SECURITY_REQUEST_ATTRIBUTES.serverSpanId],
  });

  if (trace) {
    links.push({
      key: "trace",
      label: EVENT_LINK_TRACE,
      icon: IconProp.Waterfall,
      route: trace,
    });
  }

  const logs: SecurityEventLogsLink | null =
    getSecurityEventLogsLink(securityEvent);

  if (logs) {
    links.push({
      key: "logs",
      label: EVENT_LINK_LOGS,
      icon: IconProp.Logs,
      route: logs.route,
    });
  }

  const exception: Route | null = getSecurityEventExceptionRoute(
    event.attributes[SECURITY_REQUEST_ATTRIBUTES.exceptionFingerprint] || "",
  );

  if (exception) {
    links.push({
      key: "exception",
      label: EVENT_LINK_EXCEPTION,
      icon: IconProp.Bug,
      route: exception,
    });
  }

  return links;
}

// ---------- Where to look next ----------

function window(detection: SecurityCaseMatchedDetectionJson): {
  start: Date;
  end: Date;
} | null {
  const first: string | null = detection.windowStart || detection.firstSeenAt;
  const last: string | null = detection.windowEnd || detection.lastSeenAt;

  if (!first || !last) {
    return null;
  }

  const padding: number = LOOK_NEXT_PADDING_IN_MINUTES * 60 * 1000;
  const start: Date = new Date(new Date(first).getTime() - padding);
  const end: Date = new Date(new Date(last).getTime() + padding);

  return Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())
    ? null
    : { start, end };
}

// The Events explorer on what a detection is about, over its window.
export function getDetectionEventsRoute(
  detection: SecurityCaseMatchedDetectionJson,
): Route | null {
  const value: string = detection.groupValue.trim();
  const range: { start: Date; end: Date } | null = window(detection);

  if (!value || !range) {
    return null;
  }

  return (
    RouteUtil.populateRouteParams(
      RouteMap[PageMap.SECURITY_EVENTS] as Route,
    ) as Route
  ).addQueryParams({
    search: encodeURIComponent(`observable:${buildSearchTokenValue(value)}`),
    ...getSecurityEventsTimeRangeLinkParams(range.start, range.end),
  });
}

// The entity a detection is about, typed by the field its rule groups by or by its shape.
export function getDetectionEntity(
  detection: SecurityCaseMatchedDetectionJson,
): SecurityEntity | null {
  const value: string = detection.groupValue.trim();

  if (!value || value.includes(" / ")) {
    return null;
  }

  return {
    type:
      securityEntityTypeForField(detection.rule?.groupByField) ||
      inferSecurityEntityType(value),
    value,
  };
}

export type LookNextKey =
  | "entity"
  | "events"
  | "logLines"
  | "serviceLogs"
  | "traces"
  | "story"
  | "connected";

export interface LookNextLink {
  key: LookNextKey;
  // The template, its values in `values`, and a plural's count.
  template: string | PluralTemplate;
  values: Record<string, string>;
  count?: number | undefined;
  icon: IconProp;
  route: Route;
}

function casePage(page: PageMap, caseId: ObjectID): Route | null {
  try {
    return RouteUtil.populateRouteParams(RouteMap[page] as Route, {
      modelId: caseId,
    });
  } catch {
    return null;
  }
}

function explorerRoute(
  page: PageMap,
  query: CrossSignalQueryParams,
): Route | null {
  return withRouteQueryParams(
    RouteUtil.populateRouteParams(RouteMap[page] as Route),
    query.params,
  );
}

/*
 * Where to look next from the detection that opened the case, the most
 * telling first: everything about what it is about, the events naming it,
 * the log lines naming it, the logs of the services its log lines came
 * from, the traces of the requests it matched - each over its window - and
 * the case's own Story and Connected Signals. A link with nothing to go on
 * is left out.
 */
export function getLookNextLinks(data: {
  detection: SecurityCaseMatchedDetectionJson | null;
  caseId: ObjectID;
}): Array<LookNextLink> {
  const links: Array<LookNextLink> = [];
  const add: (
    link: Omit<LookNextLink, "route">,
    route: Route | null,
  ) => void = (
    link: Omit<LookNextLink, "route">,
    route: Route | null,
  ): void => {
    if (route) {
      links.push({ ...link, route });
    }
  };

  const detection: SecurityCaseMatchedDetectionJson | null = data.detection;
  const range: { start: Date; end: Date } | null = detection
    ? window(detection)
    : null;

  if (detection) {
    const entity: SecurityEntity | null = getDetectionEntity(detection);

    if (entity && entity.type !== SecurityEntityType.Other) {
      add(
        {
          key: "entity",
          template: LOOK_NEXT_ENTITY,
          values: { value: entity.value },
          icon: IconProp.Fingerprint,
        },
        getEntityRiskRoute(entity.value, entity.type),
      );
    }

    if (entity) {
      add(
        {
          key: "events",
          template: LOOK_NEXT_EVENTS_NAMING,
          values: { value: entity.value },
          icon: IconProp.List,
        },
        getDetectionEventsRoute(detection),
      );
    }

    const searchText: string = entity
      ? getTelemetryMessageSearchText(entity.value)
      : "";

    if (searchText && range) {
      add(
        {
          key: "logLines",
          template: LOOK_NEXT_LOG_LINES_NAMING,
          values: { value: entity!.value },
          icon: IconProp.Logs,
        },
        explorerRoute(
          PageMap.LOGS,
          toLogsExplorerQueryParams({
            bodyContains: searchText,
            startTime: range.start,
            endTime: range.end,
          }),
        ),
      );
    }

    // The services the matched log lines were sent under, each once.
    const services: Map<string, string> = new Map();

    for (const event of detection.events) {
      const service: { id: string; name: string } | null =
        getEventLogService(event);

      if (service?.id && ObjectID.isValidUUID(service.id)) {
        services.set(service.id, service.name || service.id);
      }
    }

    if (range) {
      for (const [id, name] of Array.from(services.entries()).slice(0, 2)) {
        add(
          {
            key: "serviceLogs",
            template: LOOK_NEXT_SERVICE_LOGS,
            values: { service: name },
            icon: IconProp.Logs,
          },
          explorerRoute(
            PageMap.LOGS,
            toLogsExplorerQueryParams({
              serviceIds: [id],
              startTime: range.start,
              endTime: range.end,
            }),
          ),
        );
      }
    }

    const traceIds: Array<string> = Array.from(
      new Set(
        detection.events
          .map((event: SecurityCaseMatchedEventJson): string => {
            return event.traceId.trim();
          })
          .filter(Boolean),
      ),
    ).slice(0, LOOK_NEXT_MAX_TRACES);

    if (traceIds.length > 0 && range) {
      add(
        {
          key: "traces",
          template: LOOK_NEXT_TRACES,
          values: {},
          count: traceIds.length,
          icon: IconProp.Waterfall,
        },
        explorerRoute(
          PageMap.TRACES,
          toTracesExplorerQueryParams({
            traceIds,
            startTime: range.start,
            endTime: range.end,
          }),
        ),
      );
    }
  }

  add(
    {
      key: "story",
      template: LOOK_NEXT_STORY,
      values: {},
      icon: IconProp.BookOpen,
    },
    casePage(PageMap.SECURITY_CASE_VIEW_STORY, data.caseId),
  );

  add(
    {
      key: "connected",
      template: LOOK_NEXT_CONNECTED,
      values: {},
      icon: IconProp.Link,
    },
    casePage(PageMap.SECURITY_CASE_VIEW_CONNECTED_SIGNALS, data.caseId),
  );

  return links;
}

// The page that lists every detection of a case.
export function getCaseDetectionsRoute(caseId: ObjectID): Route | null {
  return casePage(PageMap.SECURITY_CASE_VIEW_DETECTIONS, caseId);
}

// The page that keeps a case's evidence.
export function getCaseEvidenceRoute(caseId: ObjectID): Route | null {
  return casePage(PageMap.SECURITY_CASE_VIEW_EVIDENCE, caseId);
}
