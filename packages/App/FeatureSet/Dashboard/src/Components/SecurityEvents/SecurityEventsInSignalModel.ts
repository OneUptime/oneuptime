import SecurityEvent from "Common/Models/AnalyticsModels/SecurityEvent";
import Route from "Common/Types/API/Route";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import Includes from "Common/Types/BaseDatabase/Includes";
import Query from "Common/Types/BaseDatabase/Query";
import { toExceptionGroupFingerprints } from "Common/Types/Telemetry/ExceptionGroupFingerprints";
import Dictionary from "Common/Types/Dictionary";
import ObjectID from "Common/Types/ObjectID";
import {
  SECURITY_REQUEST_ATTRIBUTES,
  getRequestOutcomeRank,
} from "Common/Types/SecurityEvent/SecurityEventRequestOutcome";
import { SECURITY_LOG_ID_ATTRIBUTE } from "Common/Types/SecurityEvent/SecurityLogFormat";
import {
  PluralTemplate,
  translationKey,
} from "Common/UI/Utils/TranslateTemplate";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import {
  SECURITY_EVENT_ATTRIBUTE_FACET_PREFIX,
  buildSecurityEventFacetLinkParams,
} from "./SecurityEventsFacets";
import { getSecurityEventsTimeRangeLinkParams } from "./SecurityEventsTimeRange";

/*
 * THE WAY BACK: from a log line, a trace, a session or an exception to the
 * security events it is part of. Security Events links out to them (the
 * event panel's Where it came from); these are the links in.
 *
 * What is asked for is one of:
 *   - the trace a log line or a span is in - every event of that request;
 *   - the log line itself, when it was written outside any request;
 *   - a session - every event of the session;
 *   - an exception group - the events whose request threw it, or threw an
 *     exception merged into it.
 *
 * Each read is the reader's own: one who may not read security events gets
 * a refusal, and the callout says nothing at all (SecurityEventsInSignal).
 * React-free, so a test pins every query and link.
 */

export interface SecurityEventsInSignalScope {
  traceId?: string | undefined;
  logId?: string | undefined;
  sessionId?: string | undefined;
  exceptionFingerprint?: string | undefined;
  /*
   * The fingerprints of the exceptions merged into the exception
   * (TelemetryExceptionService.getGroupFingerprints): their occurrences
   * count on it, so a request that threw one of them threw it.
   */
  mergedExceptionFingerprints?: Array<string> | undefined;
}

/*
 * The most of an exception's fingerprints a callout asks for, its own
 * first: they ride in its link into Security Events, one filter each.
 */
export const SECURITY_EVENTS_IN_SIGNAL_MAX_EXCEPTION_FINGERPRINTS: number = 20;

export enum SecurityEventsInSignalKind {
  Request = "request",
  LogLine = "log-line",
  Session = "session",
  Exception = "exception",
}

// The most events read for one callout: it counts and names the worst.
export const SECURITY_EVENTS_IN_SIGNAL_LIMIT: number = 50;

// A line or a request is looked for this far either side of its time.
export const SIGNAL_EVENT_WINDOW_IN_HOURS: number = 1;

// With no time to go by (a trace or an exception page), this far back.
export const SIGNAL_EVENT_LOOKBACK_IN_DAYS: number = 30;

// Which scope is asked: the narrowest that finds the most.
export function getSecurityEventsInSignalKind(
  scope: SecurityEventsInSignalScope,
): SecurityEventsInSignalKind | null {
  if ((scope.traceId || "").trim()) {
    return SecurityEventsInSignalKind.Request;
  }

  if ((scope.logId || "").trim()) {
    return SecurityEventsInSignalKind.LogLine;
  }

  if ((scope.sessionId || "").trim()) {
    return SecurityEventsInSignalKind.Session;
  }

  if ((scope.exceptionFingerprint || "").trim()) {
    return SecurityEventsInSignalKind.Exception;
  }

  return null;
}

export function getSecurityEventsInSignalWindow(data: {
  time?: Date | null | undefined;
  now: Date;
}): InBetween<Date> {
  const time: Date | null =
    data.time && !Number.isNaN(new Date(data.time).getTime())
      ? new Date(data.time)
      : null;

  if (time) {
    const reach: number = SIGNAL_EVENT_WINDOW_IN_HOURS * 60 * 60 * 1000;

    return new InBetween<Date>(
      new Date(time.getTime() - reach),
      new Date(time.getTime() + reach),
    );
  }

  return new InBetween<Date>(
    new Date(
      data.now.getTime() - SIGNAL_EVENT_LOOKBACK_IN_DAYS * 24 * 60 * 60 * 1000,
    ),
    data.now,
  );
}

/*
 * The filter a scope is, as a facet key and the values any of which an
 * event may carry: one, but for an exception others were merged into - its
 * own fingerprint, then theirs, at most
 * SECURITY_EVENTS_IN_SIGNAL_MAX_EXCEPTION_FINGERPRINTS.
 */
export function getSecurityEventsInSignalFilterValues(
  scope: SecurityEventsInSignalScope,
): [string, Array<string>] | null {
  switch (getSecurityEventsInSignalKind(scope)) {
    case SecurityEventsInSignalKind.Request:
      return ["traceId", [scope.traceId!.trim()]];
    case SecurityEventsInSignalKind.LogLine:
      return [
        `${SECURITY_EVENT_ATTRIBUTE_FACET_PREFIX}${SECURITY_LOG_ID_ATTRIBUTE}`,
        [scope.logId!.trim()],
      ];
    case SecurityEventsInSignalKind.Session:
      return ["sessionId", [scope.sessionId!.trim()]];
    case SecurityEventsInSignalKind.Exception:
      return [
        `${SECURITY_EVENT_ATTRIBUTE_FACET_PREFIX}${SECURITY_REQUEST_ATTRIBUTES.exceptionFingerprint}`,
        toExceptionGroupFingerprints(
          scope.exceptionFingerprint!.trim(),
          (scope.mergedExceptionFingerprints || []).map(
            (fingerprint: unknown): unknown => {
              return typeof fingerprint === "string"
                ? fingerprint.trim()
                : fingerprint;
            },
          ),
        ).slice(0, SECURITY_EVENTS_IN_SIGNAL_MAX_EXCEPTION_FINGERPRINTS),
      ];
    default:
      return null;
  }
}

// The filter a scope is, as a facet key and its first value.
export function getSecurityEventsInSignalFilter(
  scope: SecurityEventsInSignalScope,
): [string, string] | null {
  const filter: [string, Array<string>] | null =
    getSecurityEventsInSignalFilterValues(scope);

  return filter ? [filter[0], filter[1][0]!] : null;
}

export function buildSecurityEventsInSignalQuery(data: {
  scope: SecurityEventsInSignalScope;
  window: InBetween<Date>;
  projectId: ObjectID | null;
}): Query<SecurityEvent> | null {
  const filter: [string, Array<string>] | null =
    getSecurityEventsInSignalFilterValues(data.scope);

  if (!filter) {
    return null;
  }

  const query: Record<string, unknown> = {
    ...(data.projectId ? { projectId: data.projectId } : {}),
    time: data.window,
  };

  // One value as the plain equality it always was; more, any of them.
  const value: string | Includes =
    filter[1].length === 1 ? filter[1][0]! : new Includes(filter[1]);

  if (filter[0].startsWith(SECURITY_EVENT_ATTRIBUTE_FACET_PREFIX)) {
    query["attributes"] = {
      [filter[0].slice(SECURITY_EVENT_ATTRIBUTE_FACET_PREFIX.length)]: value,
    };
  } else {
    query[filter[0]] = value;
  }

  return query as Query<SecurityEvent>;
}

// The events list, narrowed to the scope over the window.
export function buildSecurityEventsInSignalRoute(data: {
  scope: SecurityEventsInSignalScope;
  window: InBetween<Date>;
}): Route | null {
  const filter: [string, Array<string>] | null =
    getSecurityEventsInSignalFilterValues(data.scope);

  if (!filter) {
    return null;
  }

  const params: Dictionary<string> = {
    // A chip for each value: the list reads chips of one key as any of them.
    ...buildSecurityEventFacetLinkParams(
      filter[1].map((value: string): [string, string] => {
        return [filter[0], value];
      }),
    ),
    ...getSecurityEventsTimeRangeLinkParams(
      new Date(data.window.startValue),
      new Date(data.window.endValue),
    ),
  };

  return new Route(
    RouteUtil.populateRouteParams(
      RouteMap[PageMap.SECURITY_EVENTS]!,
    ).toString(),
  ).addQueryParams(params);
}

/*
 * The event a callout names: the most severe, and of two as severe the one
 * whose request got furthest.
 */
export function getWorstSecurityEvent(
  events: ReadonlyArray<SecurityEvent>,
): SecurityEvent | null {
  let worst: SecurityEvent | null = null;

  for (const event of events) {
    if (!worst) {
      worst = event;
      continue;
    }

    const severity: number = Number(event.severityId) || 0;
    const worstSeverity: number = Number(worst.severityId) || 0;

    if (
      severity > worstSeverity ||
      (severity === worstSeverity &&
        getRequestOutcomeRank(event.requestOutcome) >
          getRequestOutcomeRank(worst.requestOutcome))
    ) {
      worst = event;
    }
  }

  return worst;
}

// ---------- Words ----------

export const SECURITY_EVENTS_IN_SIGNAL_TITLES: Record<
  SecurityEventsInSignalKind,
  PluralTemplate
> = {
  [SecurityEventsInSignalKind.Request]: {
    one: translationKey("1 security event happened in this request"),
    other: translationKey("{{count}} security events happened in this request"),
  },
  [SecurityEventsInSignalKind.LogLine]: {
    one: translationKey("This line raised 1 security event"),
    other: translationKey("This line raised {{count}} security events"),
  },
  [SecurityEventsInSignalKind.Session]: {
    one: translationKey("1 security event happened in this session"),
    other: translationKey("{{count}} security events happened in this session"),
  },
  [SecurityEventsInSignalKind.Exception]: {
    one: translationKey(
      "1 security event happened in a request that threw this exception",
    ),
    other: translationKey(
      "{{count}} security events happened in requests that threw this exception",
    ),
  },
};

// Past the read's limit, the count is a floor.
export const MORE_THAN_LIMIT_TITLE: string = translationKey(
  "{{count}}+ security events are part of this",
);

export const OPEN_IN_SECURITY_EVENTS: string = translationKey(
  "Open in Security Events",
);
