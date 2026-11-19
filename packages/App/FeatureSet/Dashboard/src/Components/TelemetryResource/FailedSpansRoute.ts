import { SpanKind, SpanStatus } from "Common/Models/AnalyticsModels/Span";
import Route from "Common/Types/API/Route";
import Dictionary from "Common/Types/Dictionary";
import RangeStartAndEndDateTime from "Common/Types/Time/RangeStartAndEndDateTime";
import {
  TRACE_SPAN_TYPE_URL_PARAM,
  TraceSpanType,
} from "Common/Types/Telemetry/TraceSpanType";
import {
  buildTelemetryTimeRangeParams,
  withRouteQueryParams,
} from "../../Utils/TelemetryTabScope";

/*
 * AN ERROR RATE OPENS THE REQUESTS THAT FAILED (#9593).
 *
 * A telemetry Overview's Error rate said something failed and never what:
 * the Requests tile beside it opened the traces, the error tile opened
 * nothing, and nothing on the page listed which requests failed. Now the
 * tile opens the traces explorer of the same resource on exactly the spans
 * its number counts:
 *
 *   - the spans that failed (status Error), as a chip the reader can see
 *     and take off - the explorer's own `statusCode` facet, by its value;
 *   - the same kind of span the tile counted: every span of a service, a
 *     function, a RUM application, a queue or a database (spanType=all),
 *     the entry spans of an App Platforms environment or app, the client
 *     calls of a database (kind);
 *   - over the window the tile counted (range, and start and end for a
 *     Custom one), as every explorer reads it.
 *
 * A count beside it that opens the traces (a service's Requests, a
 * database's Queries) opens the same spans, failed or not: it counted every
 * span, and opened the entry spans of the last hour.
 *
 * The resource itself is the Traces tab's own scope (its locked chip), so
 * the link carries only what narrows it. A page whose Traces is a tab of
 * the same page names that tab in `params` (?tab=Traces).
 *
 * Pure: no React, no RouteMap; App tests read the links as they are.
 */

export interface SpansRouteOptions {
  // The resource's Traces page, its route params filled.
  tracesRoute: Route;
  // The window the tile counted.
  timeRange: RangeStartAndEndDateTime;
  // The spans the tile counted: All for every span, Entry where requests enter.
  spanType: TraceSpanType;
  // Only this kind of span: a database's client calls.
  kind?: SpanKind | undefined;
  // Only spans of this name: a RUM application's page loads (documentLoad).
  spanName?: string | undefined;
  // What else the page needs to land on its traces, such as its tab.
  params?: Dictionary<string> | undefined;
}

// The explorer's chips for the spans a tile counted, as its sidebar writes them.
export function getSpanFilters(data: {
  isFailedOnly: boolean;
  kind?: SpanKind | undefined;
  spanName?: string | undefined;
}): Array<[string, string]> {
  const filters: Array<[string, string]> = [];

  if (data.isFailedOnly) {
    filters.push(["statusCode", String(SpanStatus.Error)]);
  }

  if (data.kind) {
    filters.push(["kind", data.kind]);
  }

  // A name chip matches as a typed name does: the name it contains.
  if (data.spanName) {
    filters.push(["name", data.spanName]);
  }

  return filters;
}

// The chips for the failed spans of a kind, or of every kind.
export function getFailedSpanFilters(
  kind?: SpanKind | undefined,
): Array<[string, string]> {
  return getSpanFilters({ isFailedOnly: true, kind: kind });
}

function getSpansRouteWith(
  options: SpansRouteOptions,
  isFailedOnly: boolean,
): Route {
  const params: Dictionary<string> = { ...(options.params || {}) };
  const filters: Array<[string, string]> = getSpanFilters({
    isFailedOnly: isFailedOnly,
    kind: options.kind,
    spanName: options.spanName,
  });

  if (filters.length > 0) {
    params["filters"] = JSON.stringify(filters);
  }

  const window: Dictionary<string | null> = buildTelemetryTimeRangeParams(
    options.timeRange,
  );

  for (const key of Object.keys(window)) {
    const value: string | null | undefined = window[key];

    if (value) {
      params[key] = value;
    }
  }

  /*
   * Always written, the explorer's default included: a queue's and a
   * database's Traces default to every span, a service's to entry spans,
   * and the link says which the tile counted whatever the page defaults to.
   */
  params[TRACE_SPAN_TYPE_URL_PARAM] = options.spanType;

  /*
   * A value Route rejects leaves the traces unfiltered rather than the
   * tile with no link: the reader still lands on the resource's traces.
   */
  return (
    withRouteQueryParams(options.tracesRoute, params) || options.tracesRoute
  );
}

// The spans an error tile counts: those of the tile's kind that failed.
export function getFailedSpansRoute(options: SpansRouteOptions): Route {
  return getSpansRouteWith(options, true);
}

// The spans a count of requests counts, failed or not.
export function getCountedSpansRoute(options: SpansRouteOptions): Route {
  return getSpansRouteWith(options, false);
}
