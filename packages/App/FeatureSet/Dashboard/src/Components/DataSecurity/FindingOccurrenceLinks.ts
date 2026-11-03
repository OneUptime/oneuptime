import Route from "Common/Types/API/Route";
import Dictionary from "Common/Types/Dictionary";
import {
  DataSecurityFindingOccurrence,
  DataSecurityOccurrenceRecordKind,
} from "Common/Types/DataSecurity/DataSecurityApiTypes";
import { readTelemetryDataStoreKeyOwnerId } from "Common/Types/DataSecurity/DataStoreKey";
import { DataStoreKind } from "Common/Types/DataSecurity/DataStoreKind";
import ObjectID from "Common/Types/ObjectID";
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
 * trace view focused on the span; the logs explorer filtered to the line's
 * span in the minutes around it - or, for a line written outside any
 * request, to its service in the second around it; the exceptions list
 * filtered to the exception's group; the session's replay. The store's
 * own service or RUM application opens at the same signal.
 *
 * Nothing a record holds goes into an address but ids and times: never the
 * value it carried. The explorers apply the reader's own permissions when
 * a link is followed. Built here without React, so a test pins each one.
 */

export enum OccurrenceLinkKind {
  Trace = "Trace",
  Logs = "Logs",
  Exception = "Exception",
  SessionReplay = "SessionReplay",
}

export interface OccurrenceLink {
  kind: OccurrenceLinkKind;
  route: Route;
}

// How far either side of a line written in a request its span's lines are looked for.
export const REQUEST_LOGS_WINDOW_IN_MINUTES: number = 15;

// How far either side of a line written outside any request its neighbours are.
export const NEIGHBOUR_LOGS_WINDOW_IN_SECONDS: number = 1;

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
 * The logs explorer at a line: its span's lines in the minutes around it,
 * or - written outside any request - its service's lines in the second
 * around it. Null without a time, or anything to filter by.
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
  });

  return withQuery(logsRoute, query.params);
}

/*
 * Where one record opens, its own explorer first: a span or an AI call's
 * trace; a log line's lines, then its trace; an exception's group, then
 * its trace; and the session a RUM record belongs to.
 */
export function getOccurrenceLinks(
  occurrence: DataSecurityFindingOccurrence,
): Array<OccurrenceLink> {
  const links: Array<OccurrenceLink> = [];
  const traceId: string = trimmed(occurrence.traceId);
  const spanId: string = trimmed(occurrence.spanId);
  const sessionId: string = trimmed(occurrence.sessionId);
  const rumApplicationId: string = trimmed(occurrence.rumApplicationId);

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
