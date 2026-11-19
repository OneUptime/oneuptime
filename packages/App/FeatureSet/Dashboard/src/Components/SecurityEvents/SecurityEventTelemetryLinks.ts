import SecurityEvent from "Common/Models/AnalyticsModels/SecurityEvent";
import Route from "Common/Types/API/Route";
import Dictionary from "Common/Types/Dictionary";
import ObjectID from "Common/Types/ObjectID";
import { JSONObject } from "Common/Types/JSON";
import ServiceType from "Common/Types/Telemetry/ServiceType";
import {
  SecurityLogResource,
  readSecurityLogResource,
} from "Common/Utils/SecurityCase/SecurityConnectionMatch";
import {
  CrossSignalQueryParams,
  toLogsExplorerQueryParams,
} from "Common/Utils/Telemetry/CrossSignalScope";
import { SECURITY_LOG_ID_ATTRIBUTE } from "Common/Types/SecurityEvent/SecurityLogFormat";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import { buildTraceViewRoute } from "../../Utils/LogsCrossSignalPivot";
import { buildExceptionsGroupRoute } from "../../Utils/TraceCorrelatedSignals";

/*
 * Where a security event leads in the rest of OneUptime: the log line it
 * was read from, the trace of the request it happened in, the exception
 * that request threw, the log lines that request wrote. Each is a route the
 * existing explorers already read - the logs explorer open on the line, by
 * its id, with its service's lines in the second around it (#9620); the
 * trace view focused on the span that answered; the exceptions list
 * filtered to one fingerprint; the logs explorer filtered to one trace.
 *
 * The routes are built here, without React, so a test pins each one. The
 * explorers apply the reader's own permissions when the link is followed.
 */

// How far either side of the event a request's logs are looked for.
export const REQUEST_LOGS_WINDOW_IN_MINUTES: number = 15;

// How far either side of a line its service's lines are shown under it.
export const NEIGHBOUR_LOGS_WINDOW_IN_SECONDS: number = 1;

function eventTime(event: SecurityEvent): Date | null {
  if (!event.time) {
    return null;
  }

  const time: Date = new Date(event.time);

  return Number.isNaN(time.getTime()) ? null : time;
}

function withQuery(route: Route, params: Dictionary<string>): Route {
  const encoded: Dictionary<string> = {};

  for (const key of Object.keys(params)) {
    encoded[key] = encodeURIComponent(params[key] as string);
  }

  return Object.keys(encoded).length > 0
    ? new Route(route.toString()).addQueryParams(encoded)
    : route;
}

// The id of the log record the event was read from, when it was.
export function getSecurityEventLogId(event: SecurityEvent): string {
  const attributes: JSONObject = (event.attributes || {}) as JSONObject;
  const value: unknown = attributes[SECURITY_LOG_ID_ATTRIBUTE];

  return typeof value === "string" ? value.trim() : "";
}

// The service the event's log line was sent under, when it names one.
export function getSecurityEventLogServiceId(event: SecurityEvent): string {
  const resource: SecurityLogResource | null = readSecurityLogResource(
    (event.attributes || {}) as JSONObject,
  );

  return resource && resource.type === ServiceType.OpenTelemetry
    ? resource.id
    : "";
}

/*
 * The trace view, focused on the span that answered the request when the
 * event knows it, else the span the line was written in.
 */
export function getSecurityEventTraceRoute(data: {
  event: SecurityEvent;
  serverSpanId?: string | undefined;
}): Route | null {
  const traceId: string = (data.event.traceId || "").trim();

  if (!traceId) {
    return null;
  }

  const spanId: string =
    (data.serverSpanId || "").trim() || (data.event.spanId || "").trim();

  return buildTraceViewRoute(traceId, spanId || undefined);
}

// The exceptions list, filtered to the group the request's exception is in.
export function getSecurityEventExceptionRoute(
  fingerprint: string,
): Route | null {
  if (!(fingerprint || "").trim()) {
    return null;
  }

  return buildExceptionsGroupRoute({
    exceptionsListRoute: RouteUtil.populateRouteParams(
      RouteMap[PageMap.EXCEPTIONS_UNRESOLVED]!,
    ),
    fingerprint,
  });
}

/*
 * The logs explorer, open on the very line the event was read from (#9620):
 * the line above the list, read by its id with the reader's own
 * permissions, and under it its service's lines in the second around it.
 * The address is stable - the line's id and when it was written - so it
 * can be shared. Null when the event came from no log line, or says not
 * when it was written.
 */
export function getSecurityEventLogLineRoute(
  event: SecurityEvent,
): Route | null {
  const time: Date | null = eventTime(event);
  const logId: string = getSecurityEventLogId(event);

  // A line is opened by its id: one that is not an id opens nothing.
  if (!ObjectID.isValidUUID(logId) || !time) {
    return null;
  }

  const serviceId: string = getSecurityEventLogServiceId(event);
  const query: CrossSignalQueryParams = toLogsExplorerQueryParams({
    serviceIds: serviceId ? [serviceId] : undefined,
    startTime: new Date(
      time.getTime() - NEIGHBOUR_LOGS_WINDOW_IN_SECONDS * 1000,
    ),
    endTime: new Date(time.getTime() + NEIGHBOUR_LOGS_WINDOW_IN_SECONDS * 1000),
    logId,
    logTime: time,
  });

  return withQuery(
    RouteUtil.populateRouteParams(RouteMap[PageMap.LOGS]!),
    query.params,
  );
}

export interface SecurityEventLogsLink {
  route: Route;
  // Every line the request wrote.
  scope: "request";
}

/*
 * The logs explorer, filtered to the lines the event's request wrote. Null
 * for an event that names no request: a line written outside any request
 * opens with its service's lines around it (getSecurityEventLogLineRoute).
 */
export function getSecurityEventLogsLink(
  event: SecurityEvent,
): SecurityEventLogsLink | null {
  const time: Date | null = eventTime(event);
  const traceId: string = (event.traceId || "").trim();

  if (!traceId || !time) {
    return null;
  }

  const query: CrossSignalQueryParams = toLogsExplorerQueryParams({
    traceIds: [traceId],
    startTime: new Date(
      time.getTime() - REQUEST_LOGS_WINDOW_IN_MINUTES * 60 * 1000,
    ),
    endTime: new Date(
      time.getTime() + REQUEST_LOGS_WINDOW_IN_MINUTES * 60 * 1000,
    ),
  });

  return {
    route: withQuery(
      RouteUtil.populateRouteParams(RouteMap[PageMap.LOGS]!),
      query.params,
    ),
    scope: "request",
  };
}
