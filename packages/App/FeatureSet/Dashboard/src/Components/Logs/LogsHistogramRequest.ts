import { JSONObject } from "Common/Types/JSON";
import Dictionary from "Common/Types/Dictionary";
import { DictionaryEntryValue } from "Common/UI/Components/Dictionary/DictionaryFilterOperator";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import Includes from "Common/Types/BaseDatabase/Includes";
import Search from "Common/Types/BaseDatabase/Search";
import Query from "Common/Types/BaseDatabase/Query";
import ObjectID from "Common/Types/ObjectID";
import Log from "Common/Models/AnalyticsModels/Log";
import RangeStartAndEndDateTime, {
  RangeStartAndEndDateTimeUtil,
} from "Common/Types/Time/RangeStartAndEndDateTime";
import { compileAttributeChipValues } from "Common/Types/Telemetry/TelemetrySearchQuery";
import {
  ALL_RESOURCE_FACET_KEYS,
  ResourceEntityFacetSelections,
  collectResourceEntityFacetSelections,
  collectServiceFacetSelections,
} from "Common/Types/Telemetry/ResourceEntityFacet";
import { HistogramBucket } from "Common/UI/Components/LogsViewer/types";
import { LogsHistogramData } from "Common/UI/Components/LogsViewer/useLogsHistogram";

/*
 * Every facet whose values name a resource, in sidebar order. Re-exported
 * from the shared module so the viewer, the query compiler and the pivot
 * all agree on the list; how a given key is turned into a predicate is
 * decided there (Service ids read out of `primaryEntityId`, everything else
 * has to go through the resource's entity key).
 */
export const RESOURCE_FACET_KEYS: Array<string> = [...ALL_RESOURCE_FACET_KEYS];

/** Facet-key prefix that routes a chip into `query.attributes[<key>]`. */
export const ATTRIBUTE_FACET_PREFIX: string = "attributes.";

export interface LogsHistogramRequestParams {
  /** Current picker selection. Preset ranges resolve against "now" on every call. */
  timeRange: RangeStartAndEndDateTime;
  /** Base scope from the host page (e.g. a service or trace detail view). */
  serviceIds?: Array<string> | undefined;
  traceIds?: Array<string> | undefined;
  spanIds?: Array<string> | undefined;
  /*
   * Base attribute filters from the host page's logQuery. Values are plain
   * scalars for the implicit `=` operator and operator instances
   * (`Includes`, `Search`, ...) for every other one — each serializes to its
   * `{_type, value}` shape on the wire, which the histogram endpoint
   * compiles into the same predicate the logs list uses.
   */
  attributes?: Dictionary<DictionaryEntryValue> | undefined;
  entityKeys?: Array<string> | undefined;
  /** Facet chips the user has applied in the sidebar / search bar. */
  appliedFacetFilters: Map<string, Set<string>>;
  /*
   * The viewer's list query as it stands — base scope, chips AND whatever
   * the user typed into the search bar. The typed part reaches the list
   * only through this object, so it has to reach the chart through it too;
   * see applyTypedLogFilterToRequest.
   */
  typedFilter?: Record<string, unknown> | undefined;
}

/**
 * Builds the POST body for `/telemetry/logs/histogram`.
 *
 * The window is resolved from the time range on every call rather than being
 * passed in, which is what lets live mode work: each poll re-resolves a
 * preset range ("past one hour") against the current clock, so the window
 * slides forward and newly ingested logs land in the chart. A custom range
 * has fixed edges and stays put.
 */
export function buildLogsHistogramRequest(
  params: LogsHistogramRequestParams,
): JSONObject {
  const dateRange: InBetween<Date> =
    RangeStartAndEndDateTimeUtil.getStartAndEndDate(params.timeRange);

  const requestData: JSONObject = {
    startTime: dateRange.startValue.toISOString(),
    endTime: dateRange.endValue.toISOString(),
  };

  if (params.serviceIds) {
    requestData["serviceIds"] = params.serviceIds;
  }

  /*
   * Base trace/span filters — must be applied so the chart matches the logs
   * list when the viewer is scoped to a trace/span.
   */
  if (params.traceIds) {
    requestData["traceIds"] = params.traceIds;
  }

  if (params.spanIds) {
    requestData["spanIds"] = params.spanIds;
  }

  // Active facet filters, so the histogram reflects the current view.
  const severityValues: Set<string> | undefined =
    params.appliedFacetFilters.get("severityText");

  if (severityValues && severityValues.size > 0) {
    requestData["severityTexts"] = Array.from(severityValues);
  }

  /*
   * The Services facet narrows the page's own service scope: its values are
   * ids of the same kind, so replacing is what "drill into this service"
   * means.
   */
  const serviceFacetIds: Array<string> = collectServiceFacetSelections(
    params.appliedFacetFilters.entries(),
  );

  if (serviceFacetIds.length > 0) {
    requestData["serviceIds"] = serviceFacetIds;
  }

  /*
   * Host / docker host / podman host / Kubernetes cluster selections ride
   * their own field instead of being folded into `serviceIds`. Their values
   * are ids of a different kind of row, and for OTLP telemetry the resource
   * is not the row's primary entity at all — the server resolves each id to
   * the resource's entity key and matches on membership. Folding them into
   * `serviceIds` compared a cluster id against a column that only ever
   * holds Service ids, which is why a Kubernetes cluster filter returned
   * nothing and why pairing it with a service silently dropped the cluster.
   */
  const resourceFilters: ResourceEntityFacetSelections =
    collectResourceEntityFacetSelections(params.appliedFacetFilters.entries());

  if (Object.keys(resourceFilters).length > 0) {
    requestData["resourceFilters"] = resourceFilters;
  }

  const traceFilterValues: Set<string> | undefined =
    params.appliedFacetFilters.get("traceId");

  if (traceFilterValues && traceFilterValues.size > 0) {
    requestData["traceIds"] = Array.from(traceFilterValues);
  }

  const spanFilterValues: Set<string> | undefined =
    params.appliedFacetFilters.get("spanId");

  if (spanFilterValues && spanFilterValues.size > 0) {
    requestData["spanIds"] = Array.from(spanFilterValues);
  }

  /*
   * A body chip is a contains-match on the message (the logs list compiles
   * it to a Search predicate). The histogram has to receive it as
   * bodySearchText or the chart would keep counting rows the list no longer
   * shows — which is exactly what a deep link from Insights' Top Errors
   * produces.
   */
  const bodyValues: Set<string> | undefined =
    params.appliedFacetFilters.get("body");

  if (bodyValues && bodyValues.size > 0) {
    const bodySearchText: string = Array.from(bodyValues)[0]!;

    if (bodySearchText.trim().length > 0) {
      requestData["bodySearchText"] = bodySearchText;
    }
  }

  /*
   * Attribute filters, from two sources that have to end up in ONE map:
   * the host page's pinned `logQuery.attributes`, and the `attributes.<key>`
   * chips the user applied. Only the former used to be forwarded, so an
   * attribute filter narrowed the list while the chart above it kept counting
   * every row in the project — the chart and the table disagreeing about a
   * filter the user could see applied.
   *
   * Chip values are compiled with the shared search grammar, exactly as the
   * list query compiles them, so `a*` is a prefix match in both.
   */
  const attributeFilters: JSONObject = {
    ...((params.attributes || {}) as unknown as JSONObject),
  };

  for (const [facetKey, values] of params.appliedFacetFilters.entries()) {
    if (!facetKey.startsWith(ATTRIBUTE_FACET_PREFIX)) {
      continue;
    }

    const compiled: unknown = compileAttributeChipValues(Array.from(values));

    if (compiled === undefined || !isAggregateAttributeValue(compiled)) {
      continue;
    }

    attributeFilters[facetKey.substring(ATTRIBUTE_FACET_PREFIX.length)] =
      compiled as unknown as JSONObject;
  }

  if (Object.keys(attributeFilters).length > 0) {
    requestData["attributes"] = attributeFilters;
  }

  if (params.entityKeys) {
    requestData["entityKeys"] = params.entityKeys;
  }

  // Last, so what the user typed wins exactly as it does in the list query.
  applyTypedLogFilterToRequest(requestData, params.typedFilter);

  return requestData;
}

const MINUTE_MS: number = 60 * 1000;

/**
 * Reads the answer to `/telemetry/logs/histogram`: the buckets, and how wide
 * the server made each one.
 *
 * A bucket is labelled with its start only, so the width is what lets a
 * click on a bar zoom into that bar's logs. Without it the chart can only
 * zoom from one bar's start to another's - on a single bar, a window zero
 * seconds wide that holds no logs at all.
 */
export function parseLogsHistogramResponse(
  data: JSONObject | null | undefined,
): LogsHistogramData {
  const rawBuckets: unknown = data?.["buckets"];
  const bucketSizeInMinutes: number = Number(data?.["bucketSizeInMinutes"]);

  return {
    buckets: Array.isArray(rawBuckets)
      ? (rawBuckets as unknown as Array<HistogramBucket>)
      : [],
    bucketIntervalMs:
      Number.isFinite(bucketSizeInMinutes) && bucketSizeInMinutes > 0
        ? bucketSizeInMinutes * MINUTE_MS
        : undefined,
  };
}

type ListQueryValuesFunction = (value: unknown) => Array<string>;

/*
 * The forms a typed column filter takes in the list query: one value, or
 * an Includes for `(a OR b)`. Any other operator (a negation, a wildcard) has
 * no aggregate-endpoint field and is left to the list alone.
 */
const listQueryValues: ListQueryValuesFunction = (
  value: unknown,
): Array<string> => {
  if (value instanceof Includes) {
    return value.values
      .map((item: string | number | ObjectID): string => {
        return item.toString();
      })
      .filter((item: string): boolean => {
        return item.length > 0;
      });
  }

  if (typeof value === "string") {
    return value.trim().length > 0 ? [value] : [];
  }

  if (typeof value === "number" || value instanceof ObjectID) {
    return [value.toString()];
  }

  return [];
};

type IsAggregateAttributeValueFunction = (value: unknown) => boolean;

/*
 * Whether one attribute filter value can be sent to the aggregate endpoints.
 *
 * Two filters on one key (`@k:a* @k:*b`, or a mixed chip group) compile to
 * an ARRAY of operator instances, which the list evaluates element by
 * element but the histogram / facets endpoints read as `IN (...)` — and an
 * operator object stringified into an IN list is `'[object Object]'`, a
 * chart of nothing under a table of rows. The endpoints cannot express an
 * AND of predicates on one key, so such a value is left to the list: a
 * wider chart is honest, an impossible one is not.
 */
const isAggregateAttributeValue: IsAggregateAttributeValueFunction = (
  value: unknown,
): boolean => {
  return !Array.isArray(value);
};

type ApplyTypedLogFilterToRequestFunction = (
  requestData: JSONObject,
  typedFilter: Record<string, unknown> | undefined,
) => JSONObject;

/**
 * Fold the viewer's list query onto a histogram / facets request.
 *
 * A search typed into the bar — `@attr:value`, `severity:error`,
 * `service:<id>`, `trace:<id>`, free text — used to reach the LIST only: the
 * chart above it and the facet counts beside it were built from the base
 * scope and the chips, so after pasting a copied filter the list narrowed
 * while the chart kept counting every row the page pinned. The list query is
 * the one statement of what the user is looking at, so the fields it carries
 * REPLACE the request's (a typed `service:` is a drill-down, exactly as it
 * is for the list) and its attributes merge over the base + chip map, typed
 * keys winning. Operator objects pass through untouched: they serialize to
 * the same `{_type, value}` wire shape the base attributes already use.
 *
 * Mutates and returns `requestData`, like the rest of this builder.
 */
export const applyTypedLogFilterToRequest: ApplyTypedLogFilterToRequestFunction =
  (
    requestData: JSONObject,
    typedFilter: Record<string, unknown> | undefined,
  ): JSONObject => {
    if (!typedFilter || typeof typedFilter !== "object") {
      return requestData;
    }

    const typedAttributes: unknown = typedFilter["attributes"];

    if (
      typedAttributes &&
      typeof typedAttributes === "object" &&
      !Array.isArray(typedAttributes)
    ) {
      const merged: JSONObject = {
        ...((requestData["attributes"] as JSONObject | undefined) || {}),
      };

      for (const [key, value] of Object.entries(
        typedAttributes as Record<string, unknown>,
      )) {
        if (
          !key ||
          value === undefined ||
          value === null ||
          !isAggregateAttributeValue(value)
        ) {
          continue;
        }

        merged[key] = value as unknown as JSONObject;
      }

      if (Object.keys(merged).length > 0) {
        requestData["attributes"] = merged;
      }
    }

    const columnFields: Array<[string, string]> = [
      ["severityText", "severityTexts"],
      ["primaryEntityId", "serviceIds"],
      ["traceId", "traceIds"],
      ["spanId", "spanIds"],
      ["sessionId", "sessionIds"],
    ];

    for (const [queryKey, requestKey] of columnFields) {
      const values: Array<string> = listQueryValues(typedFilter[queryKey]);

      if (values.length > 0) {
        requestData[requestKey] = values;
      }
    }

    /*
     * Host / cluster chips ride `resourceFilters` on the list query (see
     * applyLogsFacetFiltersToQuery); the facets endpoint resolves the same
     * field, so a cluster the sidebar selected scopes the sidebar's own
     * counts — otherwise the Services facet kept counting every cluster
     * while the list showed one.
     */
    const resourceFilters: unknown = typedFilter["resourceFilters"];

    if (
      resourceFilters &&
      typeof resourceFilters === "object" &&
      !Array.isArray(resourceFilters) &&
      Object.keys(resourceFilters as Record<string, unknown>).length > 0
    ) {
      requestData["resourceFilters"] = resourceFilters as JSONObject;
    }

    /*
     * Only a Search reaches the chart. A body chip and free text compile to
     * a Search, which the aggregate endpoints read as a contains-match — the
     * same predicate. A typed `message:x` compiles to an EQUALITY on the
     * body, for which the endpoints have no field; forwarding it as a
     * contains-match would draw bars above an (almost always) empty table,
     * so like every other operator they cannot express it is left to the
     * list alone.
     */
    const body: unknown = typedFilter["body"];

    if (body instanceof Search && body.toString().trim().length > 0) {
      requestData["bodySearchText"] = body.toString();
    }

    return requestData;
  };

type PreserveBaseAttributesInTypedFilterFunction = (
  filter: Query<Log>,
  baseAttributes: Dictionary<DictionaryEntryValue> | undefined,
) => Query<Log>;

/**
 * Keep the page's pinned attributes under whatever the search bar typed.
 *
 * The bar's submit spreads its parsed filter over the current query, and a
 * parsed `@attr:value` arrives as a fresh `attributes` object — so on a page
 * scoped by attribute alone (a Docker host, a pod, a serverless function)
 * one typed attribute search silently replaced the page's scope in the list
 * while the locked chip above it still claimed it. Typed keys still win over
 * a pinned key of the same name: that is the drill-down precedence chips
 * have always had.
 */
export const preserveBaseAttributesInTypedFilter: PreserveBaseAttributesInTypedFilterFunction =
  (
    filter: Query<Log>,
    baseAttributes: Dictionary<DictionaryEntryValue> | undefined,
  ): Query<Log> => {
    if (!baseAttributes || Object.keys(baseAttributes).length === 0) {
      return filter;
    }

    const typedAttributes: Record<string, unknown> =
      ((filter as unknown as Record<string, unknown>)["attributes"] as
        | Record<string, unknown>
        | undefined) || {};

    return {
      ...filter,
      attributes: { ...baseAttributes, ...typedAttributes },
    } as unknown as Query<Log>;
  };

/*
 * The keys of the list query the aggregate requests read — everything
 * applyTypedLogFilterToRequest looks at, and nothing else. `time` is
 * deliberately absent: the requests resolve their own window.
 */
export const TYPED_LOG_FILTER_KEYS: ReadonlyArray<string> = [
  "attributes",
  "severityText",
  "primaryEntityId",
  "traceId",
  "spanId",
  "sessionId",
  "body",
  "resourceFilters",
];

type PickTypedLogFilterFunction = (
  filter: Record<string, unknown> | undefined,
) => Record<string, unknown> | undefined;

/**
 * The slice of the list query the histogram / facets requests depend on.
 *
 * The viewer rebuilds its whole list query on every base-scope pass (and a
 * fresh object is a new identity even when nothing in it changed), so the
 * aggregate fetchers must not key on the query object itself: they would
 * refetch twice per mount and, worse, once with the PREVIOUS scope in the
 * render before the query catches up with new props. Keying them on this
 * slice — compared by value through {@link serializeTypedLogFilter} — means
 * they refetch exactly when what they send changes.
 */
export const pickTypedLogFilter: PickTypedLogFilterFunction = (
  filter: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined => {
  if (!filter || typeof filter !== "object") {
    return undefined;
  }

  const picked: Record<string, unknown> = {};
  const source: Record<string, unknown> = filter as Record<string, unknown>;

  for (const key of TYPED_LOG_FILTER_KEYS) {
    const value: unknown = source[key];

    if (value === undefined || value === null) {
      continue;
    }

    picked[key] = value;
  }

  return Object.keys(picked).length > 0 ? picked : undefined;
};

type SerializeTypedLogFilterFunction = (
  filter: Record<string, unknown> | undefined,
) => string;

/**
 * A value key for {@link pickTypedLogFilter}'s slice: equal content, equal
 * string. Operator instances serialize through their own `toJSON` (the same
 * `{_type, value}` shape the wire carries), so an `Includes` of the same ids
 * is the same key however many times it was rebuilt.
 */
export const serializeTypedLogFilter: SerializeTypedLogFilterFunction = (
  filter: Record<string, unknown> | undefined,
): string => {
  const picked: Record<string, unknown> | undefined =
    pickTypedLogFilter(filter);

  if (!picked) {
    return "";
  }

  return JSON.stringify(picked);
};
