import Includes from "Common/Types/BaseDatabase/Includes";
import IncludesNone from "Common/Types/BaseDatabase/IncludesNone";
import NotContains from "Common/Types/BaseDatabase/NotContains";
import NotEqual from "Common/Types/BaseDatabase/NotEqual";
import {
  SearchQueryValue,
  SearchValueOperator,
  SearchValuePredicate,
  compileAttributeChipValues,
  parseSearchValue,
  predicateToQueryValue,
} from "Common/Types/Telemetry/TelemetrySearchQuery";
import {
  getBaseFacetKey,
  isExcludeFacetKey,
} from "Common/Types/Telemetry/FacetExcludeKey";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import Search from "Common/Types/BaseDatabase/Search";
import Query from "Common/Types/BaseDatabase/Query";
import Dictionary from "Common/Types/Dictionary";
import { DictionaryEntryValue } from "Common/UI/Components/Dictionary/DictionaryFilterOperator";
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
  EXCLUDED_RESOURCE_FILTERS_FIELD,
  ResourceEntityFacetSelections,
  collectExcludedResourceEntityFacetSelections,
  collectExcludedServiceFacetSelections,
  collectResourceEntityFacetSelections,
  collectServiceFacetSelections,
  isResourceEntityFacetKey,
  isResourceFacetKey,
  isServiceFacetKey,
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
   * Non-Service resource facet selections (host, Docker / Podman host,
   * Kubernetes / Proxmox cluster, …), keyed by facet. Kept separate from serviceIds
   * because the target explorer has to resolve them through the resource's
   * entity key — folding a cluster id into serviceIds carried a filter that
   * matches nothing.
   */
  resourceFacetSelections?: ResourceEntityFacetSelections | undefined;
  attributes?: Dictionary<string> | undefined;
  traceIds?: Array<string> | undefined;
  spanIds?: Array<string> | undefined;
  severityTexts?: Array<string> | undefined;
  /*
   * RUM session ids. Not a TelemetryCrossSignalScope field - the shared
   * serializers do not know sessions - so it rides beside the scope and is
   * carried into the traces explorer by carrySessionScopeIntoTracesPivot
   * (Span has a sessionId column) and reported dropped for metrics, which
   * has no session dimension.
   */
  sessionIds?: Array<string> | undefined;
  startTime?: Date | undefined;
  endTime?: Date | undefined;
}

/*
 * Structural mirror of CrossSignalQueryParams (Common/Utils/Telemetry/
 * CrossSignalScope), for the same reason LogsCrossSignalScope mirrors the
 * scope type: this module stays serializer-free.
 */
export interface LogsPivotQueryParams {
  params: Dictionary<string>;
  dropped: Array<string>;
}

/*
 * The Span column a session filter compiles to. The traces explorer applies
 * any `filters` tuple whose key is not a resource/attribute facet as an
 * equality on that column (TracesViewer facetGroups -> query[key]), which
 * is exactly what Span.sessionId needs.
 */
export const TRACES_SESSION_FILTER_KEY: string = "sessionId";

export interface LogsPivotScopeInput {
  /** Base scope from the host page (service ObjectID strings). */
  serviceIds?: Array<string> | undefined;
  traceIds?: Array<string> | undefined;
  spanIds?: Array<string> | undefined;
  sessionIds?: Array<string> | undefined;
  /*
   * Base attribute filters from the host page's logQuery. Values are plain
   * strings only for the implicit `=` operator; every other operator on an
   * attribute filter row stores an operator instance (`Includes`, `Search`,
   * ...), which no cross-signal scope field can express.
   */
  attributes?: Dictionary<DictionaryEntryValue> | undefined;
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

/*
 * The one top-level column whose facet chip is a contains-match rather than
 * an equality. Shared with CrossSignalScope's logs serializer, which emits
 * chips under this key for a `bodyContains` scope.
 */
export const BODY_FACET_KEY: string = "body";

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
    if (!key || !value) {
      continue;
    }

    /*
     * The scope's attribute filters are exact single-value matches, so an
     * operator filter (`contains`, `is any of`, `is empty`, ...) has no
     * representation. Report it dropped rather than stringifying the operator
     * object into the target explorer's query params, where it arrived as
     * "[object Object]" and silently matched nothing.
     */
    if (typeof value === "object") {
      dropped.push(`${ATTRIBUTE_FACET_PREFIX}${key}`);
      continue;
    }

    attributes[key] = String(value);
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

  const sessionIds: Array<string> = mergeUnique(input.sessionIds, undefined);

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

  if (sessionIds.length > 0) {
    scope.sessionIds = sessionIds;
  }

  return { scope, dropped };
};

type CarrySessionScopeIntoTracesPivotFunction = (
  serialized: LogsPivotQueryParams,
  sessionIds: Array<string> | undefined,
) => LogsPivotQueryParams;

/**
 * Append the session scope to serialized traces-explorer params as
 * `["sessionId", <id>]` filter tuples, one per id (the explorer groups
 * same-key chips into one Includes). Without this the pivot from a
 * session's logs to traces silently widened to every trace in the project
 * for the window (correlation-6). Existing tuples in `filters` are kept; a
 * malformed `filters` value is replaced rather than left to drop the
 * session. Returns a new object; the input is not mutated.
 */
export const carrySessionScopeIntoTracesPivot: CarrySessionScopeIntoTracesPivotFunction =
  (
    serialized: LogsPivotQueryParams,
    sessionIds: Array<string> | undefined,
  ): LogsPivotQueryParams => {
    const ids: Array<string> = mergeUnique(sessionIds, undefined);

    if (ids.length === 0) {
      return {
        params: { ...serialized.params },
        dropped: [...serialized.dropped],
      };
    }

    let tuples: Array<[string, string]> = [];
    const existing: string | undefined = serialized.params["filters"];

    if (existing) {
      try {
        const parsed: unknown = JSON.parse(existing);

        if (Array.isArray(parsed)) {
          tuples = (parsed as Array<unknown>).filter(
            (pair: unknown): pair is [string, string] => {
              return (
                Array.isArray(pair) &&
                pair.length === 2 &&
                typeof pair[0] === "string" &&
                typeof pair[1] === "string"
              );
            },
          );
        }
      } catch {
        tuples = [];
      }
    }

    for (const sessionId of ids) {
      const alreadyPresent: boolean = tuples.some(
        (pair: [string, string]): boolean => {
          return pair[0] === TRACES_SESSION_FILTER_KEY && pair[1] === sessionId;
        },
      );

      if (!alreadyPresent) {
        tuples.push([TRACES_SESSION_FILTER_KEY, sessionId]);
      }
    }

    return {
      params: { ...serialized.params, filters: JSON.stringify(tuples) },
      dropped: [...serialized.dropped],
    };
  };

type DropSessionScopeFromPivotFunction = (
  serialized: LogsPivotQueryParams,
  sessionIds: Array<string> | undefined,
) => LogsPivotQueryParams;

/**
 * For a target with no session dimension (the metrics explorer): report the
 * session scope as dropped so the pivot button's tooltip says so, instead
 * of the session quietly vanishing from the scope.
 */
export const dropSessionScopeFromPivot: DropSessionScopeFromPivotFunction = (
  serialized: LogsPivotQueryParams,
  sessionIds: Array<string> | undefined,
): LogsPivotQueryParams => {
  const ids: Array<string> = mergeUnique(sessionIds, undefined);

  return {
    params: { ...serialized.params },
    dropped:
      ids.length > 0
        ? mergeDroppedScopeFields(serialized.dropped, ["sessionIds"])
        : [...serialized.dropped],
  };
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
  /*
   * Resource facet keys, as reported dropped by the metrics serializer —
   * one per resource facet catalog entry (a test holds the two in step).
   * Read mid-sentence ("Not carried over: services, Proxmox clusters"), so
   * generic nouns are lower case and product names / acronyms keep theirs.
   */
  hostId: "hosts",
  dockerHostId: "Docker hosts",
  podmanHostId: "Podman hosts",
  kubernetesClusterId: "Kubernetes clusters",
  dockerSwarmClusterId: "Docker Swarm clusters",
  proxmoxClusterId: "Proxmox clusters",
  openStackCloudId: "OpenStack clouds",
  vmwareVCenterId: "vCenters",
  cephClusterId: "Ceph clusters",
  storageArrayId: "storage arrays",
  serverlessFunctionId: "serverless functions",
  cloudResourceId: "cloud resources",
  rumApplicationId: "RUM applications",
  iotFleetId: "IoT fleets",
  databaseServerId: "databases",
};

/*
 * Chip keys a pivot reports dropped by the chip's own key (an unknown
 * facet, or one that leaves its value out), named as the hint reads them.
 */
const DROPPED_CHIP_LABELS: Record<string, string> = {
  severityText: "severity",
  primaryEntityId: "services",
  serviceId: "services",
  traceId: "traces",
  spanId: "spans",
  body: "message text",
};

/*
 * How one dropped field reads mid-sentence. A chip that leaves values out
 * (`!severityText`) is never carried over - no pivot target has a scope
 * field for "is not" yet - and reads as what it leaves out: "excluded
 * severity", "excluded hosts".
 */
const getDroppedFieldLabel: (field: string) => string = (
  field: string,
): string => {
  const baseField: string = getBaseFacetKey(field);

  const label: string = baseField.startsWith(ATTRIBUTE_FACET_PREFIX)
    ? `attribute ${baseField.substring(ATTRIBUTE_FACET_PREFIX.length)}`
    : DROPPED_FIELD_LABELS[baseField] ||
      DROPPED_CHIP_LABELS[baseField] ||
      baseField;

  return isExcludeFacetKey(field) ? `excluded ${label}` : label;
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
    const label: string = getDroppedFieldLabel(field);

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
 *  - every other resource selection (host, Docker / Podman host,
 *    Kubernetes / Proxmox / Ceph cluster, vCenter, … — one per resource
 *    facet catalog entry) rides `query.resourceFilters` instead, keyed by
 *    facet. The server resolves each id to the resource's entity key and
 *    matches `primaryEntityId IN (...) OR hasAny(entityKeys, ...)`, because for
 *    telemetry that carries a `service.name` the resource is not the row's
 *    primary entity at all. Each facet is its own AND group, so a cluster
 *    and a service intersect;
 *  - `attributes.<key>` facets land under `query.attributes[<key>]`;
 *  - a `body` facet compiles to a CONTAINS match, not equality — a message
 *    filter is only ever a substring of the line, and equality on a body
 *    carrying a timestamp or a request id matches nothing. This is what
 *    lets an Insights "Top Errors" row deep-link to the raw occurrences it
 *    counted;
 *  - every other facet key is a top-level column predicate;
 *  - single values compile to equality, multiple to Includes;
 *  - a chip that LEAVES its value out (`!severityText`, FacetExcludeKey)
 *    compiles after the ones that keep values: see
 *    applyLogsFacetExclusionsToQuery.
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

    // The same for the resources left out ("Host is not web-01").
    const excludedResourceFilters: ResourceEntityFacetSelections =
      collectExcludedResourceEntityFacetSelections(facetFilters.entries());

    if (Object.keys(excludedResourceFilters).length > 0) {
      (query as any)[EXCLUDED_RESOURCE_FILTERS_FIELD] = excludedResourceFilters;
    } else {
      delete (query as any)[EXCLUDED_RESOURCE_FILTERS_FIELD];
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

      // Left-out values are compiled below, once every kept one is.
      if (isExcludeFacetKey(key)) {
        continue;
      }

      /*
       * Body is a free-text predicate, so multiple values cannot be an
       * Includes (that is an exact-set match). The first value wins — the
       * chip UI only ever sets one, and a second would silently widen the
       * result rather than narrow it.
       */
      if (key === BODY_FACET_KEY) {
        (query as any).body = new Search(Array.from(values)[0]!);
        continue;
      }

      if (key.startsWith(ATTRIBUTE_FACET_PREFIX)) {
        const attributeKey: string = key.substring(
          ATTRIBUTE_FACET_PREFIX.length,
        );
        /*
         * A COPY, never the map that was handed in. The viewer's base query
         * carries the host page's own `logQuery.attributes` object; writing
         * the chip into it pinned the chip to the page — remove the chip and
         * the list, chart and facets kept filtering by it, and it came back
         * as a page-locked chip whose tooltip claimed the page pinned it.
         */
        const existing: Record<string, unknown> = {
          ...(((query as any).attributes as Record<string, unknown>) || {}),
        };

        /*
         * An attribute chip carries the value exactly as it was typed into
         * the search bar, so it is compiled with the SAME grammar the search
         * string uses — `a*` is a prefix match here as well. Before this, a
         * typed `@platform.team:a*` became an exact-equality chip on the
         * three-character string "a*" and matched nothing, while the same
         * text submitted with Ctrl+Enter went through the parser. Two paths,
         * two answers, from one keystroke.
         */
        const compiled: unknown = compileAttributeChipValues(
          Array.from(values),
        );

        if (compiled === undefined) {
          continue;
        }

        existing[attributeKey] = compiled;
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

    return applyLogsFacetExclusionsToQuery(query, facetFilters);
  };

type ApplyLogsFacetExclusionsToQueryFunction = (
  query: Query<Log>,
  facetFilters: Map<string, Set<string>>,
) => Query<Log>;

/*
 * The values the chips LEAVE OUT, onto a logs query that already carries
 * what they keep (and the page's own scope):
 *
 *   !severityText: debug          severityText != 'debug'
 *   !severityText: debug, trace   severityText NOT IN ('debug', 'trace')
 *   !primaryEntityId: <id>        primaryEntityId != <id>
 *   !hostId: <id>                 excludedResourceFilters (above)
 *   !body: text                   body does not contain the text
 *   !attributes.k: v              attributes['k'] != 'v'
 *
 * A column that already holds a predicate keeps it, and the values left out
 * of it are dropped: a log has one severity and one primary entity, so
 * leaving a value out beside kept ones changes nothing, and a query holds
 * one predicate per column. The page's own service scope counts as kept, as
 * a chip's does. The aggregate requests drop them the same way
 * (applyLogsFacetExclusionsToRequest), so the chart and the counts agree
 * with the list.
 */
export const applyLogsFacetExclusionsToQuery: ApplyLogsFacetExclusionsToQueryFunction =
  (query: Query<Log>, facetFilters: Map<string, Set<string>>): Query<Log> => {
    const record: Record<string, unknown> = query as unknown as Record<
      string,
      unknown
    >;

    const excludedServiceIds: Array<string> =
      collectExcludedServiceFacetSelections(facetFilters.entries());

    if (
      excludedServiceIds.length > 0 &&
      record["primaryEntityId"] === undefined
    ) {
      record["primaryEntityId"] = toExcludedQueryValue(excludedServiceIds);
    }

    for (const [chipKey, valueSet] of facetFilters.entries()) {
      if (!isExcludeFacetKey(chipKey)) {
        continue;
      }

      const key: string = getBaseFacetKey(chipKey);
      const values: Array<string> = Array.from(valueSet).filter(
        (value: string): boolean => {
          return typeof value === "string" && value.length > 0;
        },
      );

      // Resources and services are compiled above.
      if (
        !key ||
        values.length === 0 ||
        isServiceFacetKey(key) ||
        isResourceEntityFacetKey(key)
      ) {
        continue;
      }

      if (key === BODY_FACET_KEY) {
        if (record["body"] === undefined) {
          record["body"] = new NotContains(values[0]!);
        }
        continue;
      }

      if (key.startsWith(ATTRIBUTE_FACET_PREFIX)) {
        const attributeKey: string = key.substring(
          ATTRIBUTE_FACET_PREFIX.length,
        );
        const attributes: Record<string, unknown> = {
          ...((record["attributes"] as Record<string, unknown>) || {}),
        };

        if (!attributeKey || attributes[attributeKey] !== undefined) {
          continue;
        }

        const compiled: unknown = compileExcludedAttributeChipValues(values);

        if (compiled !== undefined) {
          attributes[attributeKey] = compiled;
          record["attributes"] = attributes;
        }
        continue;
      }

      if (record[key] === undefined) {
        record[key] = toExcludedQueryValue(values);
      }
    }

    return query;
  };

/*
 * Several values left out are one NOT IN; one value is a plain `!=`, which
 * keeps the column's skip index usable.
 */
const toExcludedQueryValue: (
  values: Array<string>,
) => NotEqual<string> | IncludesNone = (
  values: Array<string>,
): NotEqual<string> | IncludesNone => {
  const unique: Array<string> = Array.from(new Set<string>(values));

  return unique.length === 1
    ? new NotEqual<string>(unique[0]!)
    : new IncludesNone(unique);
};

/*
 * An attribute chip's values are search-grammar tokens (a literal clicked
 * or typed is written as one), so the values it leaves out are read as the
 * grammar reads them: literals are one NOT IN, and a token that is a
 * pattern is negated as the grammar negates it (`a*` -> not like `a*`), the
 * negations AND-ed.
 */
const compileExcludedAttributeChipValues: (
  values: Array<string>,
) => SearchQueryValue | Array<SearchQueryValue> | undefined = (
  values: Array<string>,
): SearchQueryValue | Array<SearchQueryValue> | undefined => {
  const predicates: Array<SearchValuePredicate> = values.map(
    (value: string): SearchValuePredicate => {
      return parseSearchValue(value);
    },
  );

  if (predicates.length === 0) {
    return undefined;
  }

  const isEveryLiteral: boolean = predicates.every(
    (predicate: SearchValuePredicate): boolean => {
      return predicate.operator === SearchValueOperator.Equals;
    },
  );

  if (isEveryLiteral) {
    return toExcludedQueryValue(
      predicates.map((predicate: SearchValuePredicate): string => {
        return predicate.value;
      }),
    );
  }

  const negated: Array<SearchQueryValue> = values.map(
    (value: string): SearchQueryValue => {
      return predicateToQueryValue(parseSearchValue(value, true));
    },
  );

  return negated.length === 1 ? negated[0]! : negated;
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
