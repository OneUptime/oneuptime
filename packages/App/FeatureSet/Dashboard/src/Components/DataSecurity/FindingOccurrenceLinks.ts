import Route from "Common/Types/API/Route";
import Dictionary from "Common/Types/Dictionary";
import {
  DataSecurityFindingOccurrence,
  DataSecurityOccurrenceRecordKind,
} from "Common/Types/DataSecurity/DataSecurityApiTypes";
import { readTelemetryDataStoreKeyOwnerId } from "Common/Types/DataSecurity/DataStoreKey";
import { DataStoreKind } from "Common/Types/DataSecurity/DataStoreKind";
import OneUptimeDate from "Common/Types/Date";
import ObjectID from "Common/Types/ObjectID";
import {
  MetricExplorerUrlParam,
  SerializedMetricQuery,
} from "Common/Utils/Metrics/MetricExplorerUrl";
import {
  CrossSignalQueryParams,
  toLogsExplorerQueryParams,
} from "Common/Utils/Telemetry/CrossSignalScope";
import {
  buildSessionReplayRoute,
  buildTraceViewRoute,
} from "../../Utils/LogsCrossSignalPivot";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import { buildExceptionsGroupRoute } from "../../Utils/TraceCorrelatedSignals";

/*
 * WHERE A TELEMETRY FINDING'S RECORDS OPEN IN THE REST OF ONEUPTIME.
 *
 * A finding's records (Server/Utils/DataSecurity/Telemetry/
 * TelemetryFindingOccurrences) lead to the explorers that already show
 * them (issue #5594: "if I see a trace, I can go to trace detail"): the
 * trace view focused on the span; the logs explorer open on the very line,
 * by its id (#9793), over its span's lines in the minutes around it - or,
 * for a line written outside any request, over its service's lines in the
 * second around it (a server of the release before sends no id: the list
 * alone, as it always opened); the exceptions list
 * filtered to the exception's group; the session's replay; the metrics
 * explorer on a metric's point - its metric, of its service, split by the
 * attribute the data is under. The store's own service or RUM application
 * opens at the same signal.
 *
 * Nothing a record holds goes into an address but ids, times, a metric's
 * name and an attribute's key: never the value it carried, and a metric's
 * name only when nothing sensitive is in it (the server leaves metricName
 * out otherwise). The explorers apply the reader's own permissions when a
 * link is followed. Built here without React, so a test pins each one.
 */

export enum OccurrenceLinkKind {
  Trace = "Trace",
  Logs = "Logs",
  Exception = "Exception",
  SessionReplay = "SessionReplay",
  Metrics = "Metrics",
}

export interface OccurrenceLink {
  kind: OccurrenceLinkKind;
  route: Route;
}

// How far either side of a line written in a request its span's lines are looked for.
export const REQUEST_LOGS_WINDOW_IN_MINUTES: number = 15;

// How far either side of a line written outside any request its neighbours are.
export const NEIGHBOUR_LOGS_WINDOW_IN_SECONDS: number = 1;

// How far either side of a metric's point the metrics explorer opens.
export const METRIC_WINDOW_IN_MINUTES: number = 30;

function withQuery(route: Route, params: Dictionary<string>): Route {
  const encoded: Dictionary<string> = {};

  for (const key of Object.keys(params)) {
    encoded[key] = encodeURIComponent(params[key] as string);
  }

  return Object.keys(encoded).length > 0
    ? new Route(route.toString()).addQueryParams(encoded)
    : route;
}

function timeOf(occurrence: DataSecurityFindingOccurrence): Date | null {
  const time: Date = new Date(occurrence.time);

  return Number.isNaN(time.getTime()) ? null : time;
}

function trimmed(value: string | undefined): string {
  return (value || "").trim();
}

/*
 * The line itself, when the record names it by its id (#9793): the logs
 * explorer opens that very line above its list, read by its id with the
 * reader's own permissions (#9620's `log` and `logTime`). Nothing when it
 * names none - a record from a server of the release before - or its id
 * is not one.
 */
function openedLine(
  occurrence: DataSecurityFindingOccurrence,
  time: Date,
): { logId?: string; logTime?: Date } {
  const logId: string = trimmed(occurrence.logId);

  return ObjectID.isValidUUID(logId) ? { logId, logTime: time } : {};
}

/*
 * The logs explorer at a line: the line itself opened above the list when
 * the record names it by its id, and under it its span's lines in the
 * minutes around it, or - written outside any request - its service's
 * lines in the second around it. Null without a time, or anything to
 * filter by.
 */
export function getOccurrenceLogsRoute(
  occurrence: DataSecurityFindingOccurrence,
): Route | null {
  const time: Date | null = timeOf(occurrence);
  const traceId: string = trimmed(occurrence.traceId);
  const spanId: string = trimmed(occurrence.spanId);
  const ownerId: string = trimmed(
    occurrence.serviceId || occurrence.rumApplicationId,
  );

  if (!time) {
    return null;
  }

  const logsRoute: Route = RouteUtil.populateRouteParams(
    RouteMap[PageMap.LOGS]!,
  );

  if (traceId) {
    const query: CrossSignalQueryParams = toLogsExplorerQueryParams({
      traceIds: [traceId],
      spanIds: spanId ? [spanId] : undefined,
      startTime: new Date(
        time.getTime() - REQUEST_LOGS_WINDOW_IN_MINUTES * 60 * 1000,
      ),
      endTime: new Date(
        time.getTime() + REQUEST_LOGS_WINDOW_IN_MINUTES * 60 * 1000,
      ),
      ...openedLine(occurrence, time),
    });

    return withQuery(logsRoute, query.params);
  }

  if (!ownerId) {
    return null;
  }

  const query: CrossSignalQueryParams = toLogsExplorerQueryParams({
    serviceIds: [ownerId],
    startTime: new Date(
      time.getTime() - NEIGHBOUR_LOGS_WINDOW_IN_SECONDS * 1000,
    ),
    endTime: new Date(time.getTime() + NEIGHBOUR_LOGS_WINDOW_IN_SECONDS * 1000),
    ...openedLine(occurrence, time),
  });

  return withQuery(logsRoute, query.params);
}

/*
 * The metrics explorer at a metric's point: its metric, of its service,
 * split by the attribute the data is under, in the half hour around it -
 * so the reader sees the series that carry it, under their own
 * permissions, and never a value in the address. A point whose metric's
 * name holds sensitive data names no metric (no metricName): its
 * service's metrics open instead. Null without a time or a service.
 */
export function getOccurrenceMetricsRoute(
  occurrence: DataSecurityFindingOccurrence,
): Route | null {
  const time: Date | null = timeOf(occurrence);
  const serviceId: string = trimmed(occurrence.serviceId);
  const metricName: string = occurrence.metricName || "";
  const attributeKey: string = trimmed(occurrence.excerpt?.field);

  if (!time || !ObjectID.isValidUUID(serviceId)) {
    return null;
  }

  if (!metricName.trim()) {
    return RouteUtil.populateRouteParams(
      RouteMap[PageMap.SERVICE_VIEW_METRICS]!,
      { modelId: new ObjectID(serviceId) },
    );
  }

  const query: SerializedMetricQuery = {
    metricName,
    serviceIds: [serviceId],
  };

  if (attributeKey) {
    query.groupByAttributeKeys = [attributeKey];
  }

  return withQuery(
    RouteUtil.populateRouteParams(RouteMap[PageMap.METRIC_VIEW]!),
    {
      [MetricExplorerUrlParam.MetricQueries]: JSON.stringify([query]),
      [MetricExplorerUrlParam.StartTime]: OneUptimeDate.toString(
        new Date(time.getTime() - METRIC_WINDOW_IN_MINUTES * 60 * 1000),
      ),
      [MetricExplorerUrlParam.EndTime]: OneUptimeDate.toString(
        new Date(time.getTime() + METRIC_WINDOW_IN_MINUTES * 60 * 1000),
      ),
    },
  );
}

/*
 * Where one record opens, its own explorer first: a span or an AI call's
 * trace; a log line's lines, then its trace; an exception's group, then
 * its trace; a metric's point in the metrics explorer; and the session a
 * RUM record belongs to.
 */
export function getOccurrenceLinks(
  occurrence: DataSecurityFindingOccurrence,
): Array<OccurrenceLink> {
  const links: Array<OccurrenceLink> = [];
  const traceId: string = trimmed(occurrence.traceId);
  const spanId: string = trimmed(occurrence.spanId);
  const sessionId: string = trimmed(occurrence.sessionId);
  const rumApplicationId: string = trimmed(occurrence.rumApplicationId);

  if (occurrence.recordKind === DataSecurityOccurrenceRecordKind.Metric) {
    const metrics: Route | null = getOccurrenceMetricsRoute(occurrence);

    if (metrics) {
      links.push({ kind: OccurrenceLinkKind.Metrics, route: metrics });
    }
  }

  if (occurrence.recordKind === DataSecurityOccurrenceRecordKind.Log) {
    const logs: Route | null = getOccurrenceLogsRoute(occurrence);

    if (logs) {
      links.push({ kind: OccurrenceLinkKind.Logs, route: logs });
    }
  }

  if (occurrence.recordKind === DataSecurityOccurrenceRecordKind.Exception) {
    const exception: Route | null = buildExceptionsGroupRoute({
      exceptionsListRoute: RouteUtil.populateRouteParams(
        RouteMap[PageMap.EXCEPTIONS_UNRESOLVED]!,
      ),
      fingerprint: trimmed(occurrence.fingerprint),
    });

    if (exception) {
      links.push({ kind: OccurrenceLinkKind.Exception, route: exception });
    }
  }

  if (traceId) {
    links.push({
      kind: OccurrenceLinkKind.Trace,
      route: buildTraceViewRoute(traceId, spanId || undefined),
    });
  }

  if (sessionId && ObjectID.isValidUUID(rumApplicationId)) {
    links.push({
      kind: OccurrenceLinkKind.SessionReplay,
      route: buildSessionReplayRoute(rumApplicationId, sessionId),
    });
  }

  return links;
}

const SERVICE_PAGE_OF_KIND: Readonly<Partial<Record<string, PageMap>>> = {
  [DataStoreKind.TelemetryLogs]: PageMap.SERVICE_VIEW_LOGS,
  [DataStoreKind.TelemetryTraces]: PageMap.SERVICE_VIEW_TRACES,
  [DataStoreKind.TelemetryExceptions]: PageMap.SERVICE_VIEW_EXCEPTIONS,
  [DataStoreKind.TelemetryAiConversations]: PageMap.SERVICE_VIEW,
  [DataStoreKind.TelemetryMetrics]: PageMap.SERVICE_VIEW_METRICS,
};

/*
 * The service a telemetry store is the telemetry of, at the store's signal
 * - its logs, its traces, its exceptions - or the RUM application whose
 * session replays it is. Null for a store that is not telemetry, or whose
 * owner it cannot name.
 */
export function getTelemetryStoreOwnerRoute(store: {
  kind?: string | null | undefined;
  serviceId?: ObjectID | string | null | undefined;
  storeKey?: string | null | undefined;
}): Route | null {
  if (store.kind === DataStoreKind.TelemetrySessionReplays) {
    const rumApplicationId: string =
      readTelemetryDataStoreKeyOwnerId(store.storeKey) || "";

    return ObjectID.isValidUUID(rumApplicationId)
      ? RouteUtil.populateRouteParams(
          RouteMap[PageMap.RUM_APPLICATION_VIEW_SESSION_REPLAY]!,
          { modelId: new ObjectID(rumApplicationId) },
        )
      : null;
  }

  const page: PageMap | undefined = store.kind
    ? SERVICE_PAGE_OF_KIND[store.kind]
    : undefined;
  const serviceId: string = store.serviceId ? store.serviceId.toString() : "";

  return page && ObjectID.isValidUUID(serviceId)
    ? RouteUtil.populateRouteParams(RouteMap[page]!, {
        modelId: new ObjectID(serviceId),
      })
    : null;
}
