import Dictionary from "Common/Types/Dictionary";
import Route from "Common/Types/API/Route";
import TimeRange from "Common/Types/Time/TimeRange";
import { JSONObject } from "Common/Types/JSON";

/*
 * Pure helpers behind the trace <-> other-signal correlation surfaces
 * (Trace Explorer's correlated-signals strip, the span list panel's Logs /
 * Exceptions tabs, SpanViewer's Profile tab, and the traces toolbar's
 * cross-signal pivots). Everything here is renderer-free so the App jest
 * suite can exercise it in plain Node.
 */

/**
 * Structural mirror of TelemetryCrossSignalScope
 * (Common/Utils/Telemetry/CrossSignalScope) so this pure util pulls in no
 * serializer code. Assignability to the real serializers is pinned by the
 * jest round-trip tests, which feed this scope straight into them.
 */
export interface TraceCrossSignalScope {
  /** Service ObjectID strings (Log/Span `primaryEntityId` values). */
  serviceIds?: Array<string> | undefined;
  /** Exact-match telemetry attribute filters. Keys may contain dots. */
  attributes?: Dictionary<string> | undefined;
  traceIds?: Array<string> | undefined;
  spanIds?: Array<string> | undefined;
  severityTexts?: Array<string> | undefined;
  startTime?: Date | undefined;
  endTime?: Date | undefined;
}

/**
 * One row returned by POST /telemetry/metrics/for-trace. Client-side mirror
 * of the server's MetricForTraceItem wire shape (Common/Server is not
 * importable from Dashboard code).
 */
export interface TraceCorrelatedMetricItem {
  name: string;
  time: string;
  value: number;
  spanId: string;
  serviceId: string;
  attributes: JSONObject;
}

/**
 * One metric name's sampled values across the trace, grouped client-side
 * from the interleaved /metrics/for-trace rows.
 */
export interface TraceMetricSeries {
  name: string;
  points: Array<TraceCorrelatedMetricItem>;
  minValue: number;
  maxValue: number;
  latestValue: number;
  distinctSpanCount: number;
}

type GroupMetricsForTraceFunction = (
  items: Array<TraceCorrelatedMetricItem> | null | undefined,
) => Array<TraceMetricSeries>;

/**
 * Group the endpoint's time-ordered, name-interleaved rows into one series
 * per metric name. Groups keep first-appearance order (which is
 * time-of-first-sample order for a time-ASC input); points within a group
 * are re-sorted by time so a malformed input ordering cannot corrupt the
 * "latest value" readout. Rows without a usable name or a finite value are
 * dropped rather than producing NaN stats.
 */
export const groupMetricsForTrace: GroupMetricsForTraceFunction = (
  items: Array<TraceCorrelatedMetricItem> | null | undefined,
): Array<TraceMetricSeries> => {
  if (!items || items.length === 0) {
    return [];
  }

  const seriesByName: Map<string, TraceMetricSeries> = new Map();

  for (const item of items) {
    if (!item || typeof item.name !== "string" || item.name.length === 0) {
      continue;
    }

    const value: number = Number(item.value);

    if (!Number.isFinite(value)) {
      continue;
    }

    let series: TraceMetricSeries | undefined = seriesByName.get(item.name);

    if (!series) {
      series = {
        name: item.name,
        points: [],
        minValue: value,
        maxValue: value,
        latestValue: value,
        distinctSpanCount: 0,
      };
      seriesByName.set(item.name, series);
    }

    series.points.push({ ...item, value });

    if (value < series.minValue) {
      series.minValue = value;
    }

    if (value > series.maxValue) {
      series.maxValue = value;
    }
  }

  const grouped: Array<TraceMetricSeries> = Array.from(seriesByName.values());

  for (const series of grouped) {
    /*
     * Stable sort: rows with unparseable times keep their relative input
     * position instead of jumping around.
     */
    series.points.sort(
      (
        left: TraceCorrelatedMetricItem,
        right: TraceCorrelatedMetricItem,
      ): number => {
        const leftTime: number = Date.parse(left.time);
        const rightTime: number = Date.parse(right.time);

        if (Number.isNaN(leftTime) || Number.isNaN(rightTime)) {
          return 0;
        }

        return leftTime - rightTime;
      },
    );

    series.latestValue = series.points[series.points.length - 1]!.value;

    const spanIds: Set<string> = new Set<string>();

    for (const point of series.points) {
      if (typeof point.spanId === "string" && point.spanId.length > 0) {
        spanIds.add(point.spanId);
      }
    }

    series.distinctSpanCount = spanIds.size;
  }

  return grouped;
};

export interface ProfilePresenceGate {
  isVisible: boolean;
  sampleCount: number;
}

type GetProfilePresenceGateFunction = (
  response: JSONObject | null | undefined,
) => ProfilePresenceGate;

/**
 * Interpret a POST /telemetry/profiles/trace-presence response as a tab
 * gate. Anything other than a finite positive sampleCount — including a
 * failed request, which callers signal by passing null — hides the tab
 * without crashing.
 */
export const getProfilePresenceGate: GetProfilePresenceGateFunction = (
  response: JSONObject | null | undefined,
): ProfilePresenceGate => {
  if (!response || typeof response !== "object") {
    return { isVisible: false, sampleCount: 0 };
  }

  const sampleCount: number = Number(response["sampleCount"]);

  if (!Number.isFinite(sampleCount) || sampleCount <= 0) {
    return { isVisible: false, sampleCount: 0 };
  }

  return { isVisible: true, sampleCount: Math.floor(sampleCount) };
};

export type SpanPanelLogScope = "span" | "trace";

export interface SpanPanelLogQueryPlan {
  scope: SpanPanelLogScope;
  query: Dictionary<string>;
}

type BuildSpanPanelLogQueryFunction = (args: {
  spanId?: string | undefined;
  traceId?: string | undefined;
}) => SpanPanelLogQueryPlan | null;

/**
 * Query plan for the span list panel's Logs tab: prefer the tight
 * spanId-scoped query, fall back to the whole trace when the row carries no
 * span id, and return null (no fetch at all) when it carries neither.
 */
export const buildSpanPanelLogQuery: BuildSpanPanelLogQueryFunction = (args: {
  spanId?: string | undefined;
  traceId?: string | undefined;
}): SpanPanelLogQueryPlan | null => {
  const spanId: string = (args.spanId || "").trim();
  const traceId: string = (args.traceId || "").trim();

  if (spanId.length > 0) {
    return { scope: "span", query: { spanId } };
  }

  if (traceId.length > 0) {
    return { scope: "trace", query: { traceId } };
  }

  return null;
};

type BuildExceptionsGroupRouteFunction = (args: {
  exceptionsListRoute: Route;
  fingerprint: string;
}) => Route | null;

/**
 * Deep link from an ExceptionInstance's fingerprint to its group on the
 * exceptions list page. The list's search DSL treats unknown `@alias`
 * tokens as backend columns, so `@fingerprint:<value>` compiles to an exact
 * fingerprint filter; `status=all` and the widest relative range keep
 * resolved / long-quiet groups from being filtered out on arrival. The
 * search value is pre-encoded because the exceptions viewer
 * decodeURIComponent()s the param a second time after URLSearchParams (and
 * Route rejects raw spaces/quotes outright).
 */
export const buildExceptionsGroupRoute: BuildExceptionsGroupRouteFunction =
  (args: { exceptionsListRoute: Route; fingerprint: string }): Route | null => {
    const fingerprint: string = (args.fingerprint || "").trim();

    if (fingerprint.length === 0) {
      return null;
    }

    const route: Route = new Route(args.exceptionsListRoute.toString());

    route.addQueryParams({
      search: encodeURIComponent(`@fingerprint:${fingerprint}`),
      status: "all",
      range: encodeURIComponent(TimeRange.PAST_THREE_MONTHS),
    });

    return route;
  };

type BuildTraceFlamegraphRequestFunction = (args: {
  traceId: string;
  spanIds?: Array<string> | undefined;
}) => JSONObject | null;

/**
 * Request body for the trace/span-scoped profile endpoints
 * (POST /telemetry/profiles/flamegraph and .../trace-presence — both take
 * { traceId, spanIds? }). Null when there is no usable traceId; spanIds are
 * trimmed, deduped, and omitted entirely when empty so the server treats
 * the request as trace-wide rather than filtering on an empty list.
 */
export const buildTraceFlamegraphRequest: BuildTraceFlamegraphRequestFunction =
  (args: {
    traceId: string;
    spanIds?: Array<string> | undefined;
  }): JSONObject | null => {
    const traceId: string = (args.traceId || "").trim();

    if (traceId.length === 0) {
      return null;
    }

    const spanIds: Array<string> = Array.from(
      new Set(
        (args.spanIds || [])
          .map((spanId: string): string => {
            return (spanId || "").trim();
          })
          .filter((spanId: string): boolean => {
            return spanId.length > 0;
          }),
      ),
    );

    const request: JSONObject = { traceId };

    if (spanIds.length > 0) {
      request["spanIds"] = spanIds;
    }

    return request;
  };

/*
 * The facet keys that all resolve to the Span `primaryEntityId` column
 * (mirrors the resource-facet union in TracesViewer's query builders).
 */
const RESOURCE_FACET_KEYS: Set<string> = new Set<string>([
  "primaryEntityId",
  "hostId",
  "dockerHostId",
  "podmanHostId",
  "kubernetesClusterId",
]);

/*
 * Human labels for the trace-explorer filters that cannot ride a
 * cross-signal scope at all (no TelemetryCrossSignalScope field exists for
 * them), keyed by the chip facetKey / parsed-search field they arrive as.
 */
const UNSUPPORTED_FILTER_LABELS: Dictionary<string> = {
  statusCode: "span status",
  kind: "span kind",
  hasException: "exception flag",
  statusMessage: "status message",
  name: "span name",
  durationUnixNano: "duration",
};

export interface TracesPivotInput {
  primaryEntityId?: string | undefined;
  scopeAttributeFilters?: Dictionary<string> | undefined;
  activeFilters: Array<{ facetKey: string; value: string }>;
  fieldFilters: Dictionary<Array<string>>;
  searchAttributes: Dictionary<string>;
  searchAttributeSearches: Dictionary<string>;
  freeText: string;
  rootOnly: boolean;
  hasEntityScope: boolean;
  startTime: Date;
  endTime: Date;
}

export interface TracesPivotScopeResult {
  scope: TraceCrossSignalScope;
  /** Filter descriptions no cross-signal scope field can express. */
  notCarried: Array<string>;
}

type BuildTracesPivotScopeFunction = (
  input: TracesPivotInput,
) => TracesPivotScopeResult;

/**
 * Distill the traces explorer's current view (facet chips, parsed search,
 * prop-level scoping, window) into a TelemetryCrossSignalScope for the
 * toolbar's Logs / Metrics pivots. Fields the scope grammar cannot express
 * (status, kind, contains-filters, ...) are reported in `notCarried` so the
 * pivot buttons can surface them instead of silently narrowing less than
 * the user expects. Target-specific losses (e.g. the metric explorer
 * dropping serviceIds) are reported by the serializers themselves.
 */
export const buildTracesPivotScope: BuildTracesPivotScopeFunction = (
  input: TracesPivotInput,
): TracesPivotScopeResult => {
  const notCarried: Set<string> = new Set<string>();

  const serviceIds: Array<string> = [];
  const traceIds: Array<string> = [];
  const spanIds: Array<string> = [];
  const attributes: Dictionary<string> = {};

  const addValue: (list: Array<string>, value: string) => void = (
    list: Array<string>,
    value: string,
  ): void => {
    const trimmed: string = (value || "").trim();

    if (trimmed.length > 0 && !list.includes(trimmed)) {
      list.push(trimmed);
    }
  };

  if (input.primaryEntityId) {
    addValue(serviceIds, input.primaryEntityId);
  }

  for (const filter of input.activeFilters) {
    if (RESOURCE_FACET_KEYS.has(filter.facetKey)) {
      addValue(serviceIds, filter.value);
      continue;
    }

    if (filter.facetKey === "traceId") {
      addValue(traceIds, filter.value);
      continue;
    }

    if (filter.facetKey === "spanId") {
      addValue(spanIds, filter.value);
      continue;
    }

    if (filter.facetKey.startsWith("attributeSearches.")) {
      notCarried.add("attribute contains-filters");
      continue;
    }

    if (filter.facetKey.startsWith("attributes.")) {
      const key: string = filter.facetKey.substring("attributes.".length);

      if (key.length > 0 && filter.value.length > 0) {
        attributes[key] = filter.value;
      }
      continue;
    }

    const label: string | undefined =
      UNSUPPORTED_FILTER_LABELS[filter.facetKey];

    if (label) {
      notCarried.add(label);
    }
  }

  for (const field of Object.keys(input.fieldFilters)) {
    const values: Array<string> = input.fieldFilters[field] || [];

    if (values.length === 0) {
      continue;
    }

    if (field === "primaryEntityId") {
      for (const value of values) {
        addValue(serviceIds, value);
      }
      continue;
    }

    if (field === "traceId") {
      for (const value of values) {
        addValue(traceIds, value);
      }
      continue;
    }

    if (field === "spanId") {
      for (const value of values) {
        addValue(spanIds, value);
      }
      continue;
    }

    const label: string | undefined = UNSUPPORTED_FILTER_LABELS[field];

    if (label) {
      notCarried.add(label);
    }
  }

  for (const key of Object.keys(input.searchAttributes)) {
    const value: string = input.searchAttributes[key] || "";

    if (key.length > 0 && value.length > 0) {
      attributes[key] = value;
    }
  }

  if (Object.keys(input.searchAttributeSearches).length > 0) {
    notCarried.add("attribute contains-filters");
  }

  // The prop-level read-only scope always wins over user-added chips.
  for (const key of Object.keys(input.scopeAttributeFilters || {})) {
    const value: string = (input.scopeAttributeFilters || {})[key] || "";

    if (key.length > 0 && value.length > 0) {
      attributes[key] = value;
    }
  }

  if (input.freeText && input.freeText.trim().length > 0) {
    notCarried.add("span name");
  }

  if (input.rootOnly) {
    notCarried.add("root-spans-only");
  }

  if (input.hasEntityScope) {
    notCarried.add("entity scope");
  }

  const scope: TraceCrossSignalScope = {
    startTime: input.startTime,
    endTime: input.endTime,
  };

  if (serviceIds.length > 0) {
    scope.serviceIds = serviceIds;
  }

  if (traceIds.length > 0) {
    scope.traceIds = traceIds;
  }

  if (spanIds.length > 0) {
    scope.spanIds = spanIds;
  }

  if (Object.keys(attributes).length > 0) {
    scope.attributes = attributes;
  }

  return { scope, notCarried: Array.from(notCarried) };
};

/*
 * Labels for the serializer-reported dropped scope fields
 * (CrossSignalQueryParams.dropped uses TelemetryCrossSignalScope key names).
 */
const DROPPED_FIELD_LABELS: Dictionary<string> = {
  serviceIds: "service filters",
  traceIds: "trace ids",
  spanIds: "span ids",
  severityTexts: "severities",
  startTime: "time window",
  endTime: "time window",
};

type DescribeDroppedScopeFieldsFunction = (
  fields: Array<string>,
) => Array<string>;

/**
 * Serializer `dropped` field names -> deduped human labels for the pivot
 * hint. Unknown names pass through verbatim so a new scope field is never
 * silently hidden.
 */
export const describeDroppedScopeFields: DescribeDroppedScopeFieldsFunction = (
  fields: Array<string>,
): Array<string> => {
  const labels: Set<string> = new Set<string>();

  for (const field of fields) {
    labels.add(DROPPED_FIELD_LABELS[field] || field);
  }

  return Array.from(labels);
};
