import Includes from "Common/Types/BaseDatabase/Includes";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import Query from "Common/Types/BaseDatabase/Query";
import Dictionary from "Common/Types/Dictionary";
import Log from "Common/Models/AnalyticsModels/Log";
import RumSession from "Common/Models/AnalyticsModels/RumSession";
import Span from "Common/Models/AnalyticsModels/Span";
import Route from "Common/Types/API/Route";
import RangeStartAndEndDateTime, {
  RangeStartAndEndDateTimeUtil,
} from "Common/Types/Time/RangeStartAndEndDateTime";
import RouteMap, { RouteUtil } from "./RouteMap";
import PageMap from "./PageMap";
import { RESOURCE_FACET_KEYS } from "../Components/Logs/LogsHistogramRequest";
import {
  ResourceEntityFacetSelections,
  collectResourceEntityFacetSelections,
  collectServiceFacetSelections,
  isResourceFacetKey,
} from "Common/Types/Telemetry/ResourceEntityFacet";

/*
 * Cross-signal glue that is specific to the logs explorer: compiling its
 * current view (base scope props + applied facet chips + time window) into a
 * cross-signal scope for the Traces/Metrics pivot buttons, and the route
 * builders its trace/span/session ids link out through.
 */

/*
 * Structural mirror of TelemetryCrossSignalScope
 * (Common/Utils/Telemetry/CrossSignalScope) so this pure util and its jest
 * suite stay free of the serializer module — the container feeds the built
 * scope straight into toTracesExplorerQueryParams /
 * toMetricsExplorerQueryParams, which accept it structurally. Field
 * semantics (serviceIds are ObjectID strings, severity casing, both window
 * ends required) are defined there.
 */
export interface LogsCrossSignalScope {
  serviceIds?: Array<string> | undefined;
  /*
   * Non-Service resource facet selections (host / docker host / podman host
   * / Kubernetes cluster), keyed by facet. Kept separate from serviceIds
   * because the target explorer has to resolve them through the resource's
   * entity key — folding a cluster id into serviceIds carried a filter that
   * matches nothing.
   */
  resourceFacetSelections?: ResourceEntityFacetSelections | undefined;
  attributes?: Dictionary<string> | undefined;
  traceIds?: Array<string> | undefined;
  spanIds?: Array<string> | undefined;
  severityTexts?: Array<string> | undefined;
  startTime?: Date | undefined;
  endTime?: Date | undefined;
}

export interface LogsPivotScopeInput {
  /** Base scope from the host page (service ObjectID strings). */
  serviceIds?: Array<string> | undefined;
  traceIds?: Array<string> | undefined;
  spanIds?: Array<string> | undefined;
  sessionIds?: Array<string> | undefined;
  /** Base attribute filters from the host page's logQuery. */
  attributes?: Record<string, string> | undefined;
  /** Facet chips the user has applied in the sidebar / search bar. */
  appliedFacetFilters: Map<string, Set<string>>;
  /** Current picker selection; preset ranges resolve against "now". */
  timeRange: RangeStartAndEndDateTime;
}

export interface LogsPivotScopeResult {
  scope: LogsCrossSignalScope;
  /*
   * Scope the logs view holds that no cross-signal scope field can carry
   * (sessions, multi-valued attribute selections, unknown facet keys).
   * Callers merge these with the serializer's own dropped list via
   * mergeDroppedScopeFields so nothing is lost silently.
   */
  dropped: Array<string>;
}

const ATTRIBUTE_FACET_PREFIX: string = "attributes.";

function mergeUnique(
  base: Array<string> | undefined,
  extra: Set<string> | undefined,
): Array<string> {
  const merged: Array<string> = [];
  const seen: Set<string> = new Set<string>();

  for (const value of [...(base || []), ...Array.from(extra || [])]) {
    if (!value || seen.has(value)) {
      continue;
    }

    seen.add(value);
    merged.push(value);
  }

  return merged;
}

type BuildLogsPivotScopeFunction = (
  input: LogsPivotScopeInput,
) => LogsPivotScopeResult;

export const buildLogsPivotScope: BuildLogsPivotScopeFunction = (
  input: LogsPivotScopeInput,
): LogsPivotScopeResult => {
  const dropped: Array<string> = [];

  /*
   * Only the Services facet unions with the base service scope — its values
   * are the same kind of id. Host / docker / podman / Kubernetes selections
   * name a different row and travel under their own key so the target
   * explorer can resolve them to entity keys.
   */
  const serviceIds: Array<string> = mergeUnique(
    input.serviceIds,
    new Set<string>(
      collectServiceFacetSelections(input.appliedFacetFilters.entries()),
    ),
  );

  const resourceFacetSelections: ResourceEntityFacetSelections =
    collectResourceEntityFacetSelections(input.appliedFacetFilters.entries());
  const traceIds: Array<string> = mergeUnique(
    input.traceIds,
    input.appliedFacetFilters.get("traceId"),
  );
  const spanIds: Array<string> = mergeUnique(
    input.spanIds,
    input.appliedFacetFilters.get("spanId"),
  );
  const severityTexts: Array<string> = mergeUnique(
    undefined,
    input.appliedFacetFilters.get("severityText"),
  );

  const attributes: Dictionary<string> = {};

  for (const [key, value] of Object.entries(input.attributes || {})) {
    if (key && value) {
      attributes[key] = value;
    }
  }

  const knownFacetKeys: Set<string> = new Set<string>([
    ...RESOURCE_FACET_KEYS,
    "traceId",
    "spanId",
    "severityText",
  ]);

  for (const [facetKey, values] of input.appliedFacetFilters.entries()) {
    if (knownFacetKeys.has(facetKey) || values.size === 0) {
      continue;
    }

    if (!facetKey.startsWith(ATTRIBUTE_FACET_PREFIX)) {
      // Unknown facet keys carry scope this module cannot translate.
      dropped.push(facetKey);
      continue;
    }

    const attributeKey: string = facetKey.substring(
      ATTRIBUTE_FACET_PREFIX.length,
    );

    if (!attributeKey) {
      continue;
    }

    /*
     * The scope's attribute filters are exact single-value matches; a
     * multi-valued selection has no representation, so it is reported
     * dropped rather than silently narrowed to one of its values.
     */
    if (values.size > 1) {
      dropped.push(facetKey);
      continue;
    }

    attributes[attributeKey] = Array.from(values)[0]!;
  }

  if (input.sessionIds && input.sessionIds.length > 0) {
    // No TelemetryCrossSignalScope field carries a session dimension.
    dropped.push("sessionIds");
  }

  const resolvedWindow: InBetween<Date> =
    RangeStartAndEndDateTimeUtil.getStartAndEndDate(input.timeRange);

  const scope: LogsCrossSignalScope = {
    startTime: resolvedWindow.startValue,
    endTime: resolvedWindow.endValue,
  };

  if (serviceIds.length > 0) {
    scope.serviceIds = serviceIds;
  }

  if (Object.keys(resourceFacetSelections).length > 0) {
    scope.resourceFacetSelections = resourceFacetSelections;
  }

  if (traceIds.length > 0) {
    scope.traceIds = traceIds;
  }

  if (spanIds.length > 0) {
    scope.spanIds = spanIds;
  }

  if (severityTexts.length > 0) {
    scope.severityTexts = severityTexts;
  }

  if (Object.keys(attributes).length > 0) {
    scope.attributes = attributes;
  }

  return { scope, dropped };
};

type MergeDroppedScopeFieldsFunction = (
  first: Array<string>,
  second: Array<string>,
) => Array<string>;

/**
 * Union of the scope-construction drops and the serializer's drops, first
 * occurrence wins — the complete "not carried over" list one pivot button
 * must surface.
 */
export const mergeDroppedScopeFields: MergeDroppedScopeFieldsFunction = (
  first: Array<string>,
  second: Array<string>,
): Array<string> => {
  const merged: Array<string> = [];
  const seen: Set<string> = new Set<string>();

  for (const value of [...first, ...second]) {
    if (seen.has(value)) {
      continue;
    }

    seen.add(value);
    merged.push(value);
  }

  return merged;
};

const DROPPED_FIELD_LABELS: Record<string, string> = {
  serviceIds: "services",
  traceIds: "traces",
  spanIds: "spans",
  severityTexts: "severity",
  sessionIds: "sessions",
  startTime: "window start",
  endTime: "window end",
  // Resource facet keys, as reported dropped by the metrics serializer.
  hostId: "hosts",
  dockerHostId: "docker hosts",
  podmanHostId: "podman hosts",
  kubernetesClusterId: "Kubernetes clusters",
};

type FormatDroppedScopeHintFunction = (dropped: Array<string>) => string;

/**
 * Human-readable hint for the pivot button tooltips. Empty string when the
 * whole scope carries over; otherwise e.g.
 * "Not carried over: services, severity".
 */
export const formatDroppedScopeHint: FormatDroppedScopeHintFunction = (
  dropped: Array<string>,
): string => {
  const labels: Array<string> = [];
  const seen: Set<string> = new Set<string>();

  for (const field of dropped) {
    const label: string = field.startsWith(ATTRIBUTE_FACET_PREFIX)
      ? `attribute ${field.substring(ATTRIBUTE_FACET_PREFIX.length)}`
      : DROPPED_FIELD_LABELS[field] || field;

    if (seen.has(label)) {
      continue;
    }

    seen.add(label);
    labels.push(label);
  }

  if (labels.length === 0) {
    return "";
  }

  return `Not carried over: ${labels.join(", ")}`;
};

type ApplyLogsSessionScopeToQueryFunction = (
  query: Query<Log>,
  sessionIds: Array<string> | undefined,
) => Query<Log>;

/**
 * Compile a base session scope onto a logs query — the exact shape the
 * traceIds prop compiles to (`sessionId IN (...)` via Includes). No-op for a
 * missing or empty list.
 */
export const applyLogsSessionScopeToQuery: ApplyLogsSessionScopeToQueryFunction =
  (query: Query<Log>, sessionIds: Array<string> | undefined): Query<Log> => {
    if (sessionIds && sessionIds.length > 0) {
      query.sessionId = new Includes(sessionIds);
    }

    return query;
  };

type ApplyLogsFacetFiltersToQueryFunction = (
  query: Query<Log>,
  facetFilters: Map<string, Set<string>>,
) => Query<Log>;

/**
 * Compile applied facet filters (sidebar chips, search-bar chips, or the URL
 * `filters` param they round-trip through) onto a logs list query. This is
 * the single compilation the viewer uses for BOTH the user-interaction path
 * and URL hydration, so a deep-linked /logs page filters its list exactly
 * like the chips and histogram claim.
 *
 * Semantics:
 *  - the Services facet compiles to a `primaryEntityId` predicate — that
 *    column holds Service ids for OTLP telemetry;
 *  - host / docker host / podman host / Kubernetes cluster selections ride
 *    `query.resourceFilters` instead, keyed by facet. The server resolves
 *    each id to the resource's entity key and matches
 *    `primaryEntityId IN (...) OR hasAny(entityKeys, ...)`, because for
 *    telemetry that carries a `service.name` the resource is not the row's
 *    primary entity at all. Each facet is its own AND group, so a cluster
 *    and a service intersect;
 *  - `attributes.<key>` facets land under `query.attributes[<key>]`;
 *  - every other facet key is a top-level column predicate;
 *  - single values compile to equality, multiple to Includes.
 */
export const applyLogsFacetFiltersToQuery: ApplyLogsFacetFiltersToQueryFunction =
  (query: Query<Log>, facetFilters: Map<string, Set<string>>): Query<Log> => {
    const resourceFilters: ResourceEntityFacetSelections =
      collectResourceEntityFacetSelections(facetFilters.entries());

    /*
     * Written unconditionally (deleted when empty) so re-compiling onto a
     * query that already carried a selection cannot leave a stale one behind.
     */
    if (Object.keys(resourceFilters).length > 0) {
      (query as any).resourceFilters = resourceFilters;
    } else {
      delete (query as any).resourceFilters;
    }

    const resourceIds: Set<string> = new Set<string>(
      collectServiceFacetSelections(facetFilters.entries()),
    );

    for (const [key, values] of facetFilters.entries()) {
      if (values.size === 0) {
        continue;
      }

      // Both resource groups are compiled above.
      if (isResourceFacetKey(key)) {
        continue;
      }

      if (key.startsWith(ATTRIBUTE_FACET_PREFIX)) {
        const attributeKey: string = key.substring(
          ATTRIBUTE_FACET_PREFIX.length,
        );
        const existing: Record<string, unknown> =
          ((query as any).attributes as Record<string, unknown>) || {};
        existing[attributeKey] =
          values.size === 1
            ? Array.from(values)[0]!
            : new Includes(Array.from(values));
        (query as any).attributes = existing;
        continue;
      }

      if (values.size === 1) {
        (query as any)[key] = Array.from(values)[0]!;
      } else {
        (query as any)[key] = new Includes(Array.from(values));
      }
    }

    if (resourceIds.size === 1) {
      (query as any).primaryEntityId = Array.from(resourceIds)[0]!;
    } else if (resourceIds.size > 1) {
      (query as any).primaryEntityId = new Includes(Array.from(resourceIds));
    }

    return query;
  };

type ExtractTraceIdFromSpansFunction = (spans: Array<Span>) => string | null;

/** First non-empty traceId in a span lookup result, or null. */
export const extractTraceIdFromSpans: ExtractTraceIdFromSpansFunction = (
  spans: Array<Span>,
): string | null => {
  for (const span of spans) {
    const traceId: string = span.traceId?.toString() || "";

    if (traceId) {
      return traceId;
    }
  }

  return null;
};

type ExtractRumApplicationIdFromRumSessionsFunction = (
  sessions: Array<RumSession>,
) => string | null;

/** First non-empty rumApplicationId in a RumSession lookup result, or null. */
export const extractRumApplicationIdFromRumSessions: ExtractRumApplicationIdFromRumSessionsFunction =
  (sessions: Array<RumSession>): string | null => {
    for (const session of sessions) {
      const rumApplicationId: string =
        session.rumApplicationId?.toString() || "";

      if (rumApplicationId) {
        return rumApplicationId;
      }
    }

    return null;
  };

type BuildTraceViewRouteFunction = (
  traceId: string,
  spanId?: string | undefined,
) => Route;

/**
 * The trace detail route, optionally deep-linked to one span via the
 * `spanId` query param the trace view parses.
 */
export const buildTraceViewRoute: BuildTraceViewRouteFunction = (
  traceId: string,
  spanId?: string | undefined,
): Route => {
  const route: Route = RouteUtil.populateRouteParams(
    RouteMap[PageMap.TRACE_VIEW]!,
    {
      modelId: traceId,
    },
  );

  if (!spanId) {
    return route;
  }

  const routeWithQuery: Route = new Route(route.toString());
  routeWithQuery.addQueryParams({ spanId });

  return routeWithQuery;
};

type BuildSpanChipOpenRouteFunction = (
  spanId: string,
  candidateTraceIds: Array<string> | undefined,
) => Route | undefined;

/**
 * Open-affordance route for a span filter chip. A span chip carries no trace
 * id of its own, so it can only link out when the surrounding view is scoped
 * to exactly one trace.
 */
export const buildSpanChipOpenRoute: BuildSpanChipOpenRouteFunction = (
  spanId: string,
  candidateTraceIds: Array<string> | undefined,
): Route | undefined => {
  if (!spanId) {
    return undefined;
  }

  const uniqueTraceIds: Array<string> = mergeUnique(
    candidateTraceIds,
    undefined,
  );

  if (uniqueTraceIds.length !== 1) {
    return undefined;
  }

  return buildTraceViewRoute(uniqueTraceIds[0]!, spanId);
};

type BuildSessionReplayRouteFunction = (
  rumApplicationId: string,
  sessionId: string,
) => Route;

/** The RUM session replay player route for one session. */
export const buildSessionReplayRoute: BuildSessionReplayRouteFunction = (
  rumApplicationId: string,
  sessionId: string,
): Route => {
  return RouteUtil.populateRouteParams(
    RouteMap[PageMap.RUM_APPLICATION_VIEW_SESSION_REPLAY_VIEW]!,
    {
      modelId: rumApplicationId,
      subModelId: sessionId,
    },
  );
};
