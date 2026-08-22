import { JSONObject } from "Common/Types/JSON";
import Dictionary from "Common/Types/Dictionary";
import { DictionaryEntryValue } from "Common/UI/Components/Dictionary/DictionaryFilterOperator";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import RangeStartAndEndDateTime, {
  RangeStartAndEndDateTimeUtil,
} from "Common/Types/Time/RangeStartAndEndDateTime";
import {
  ALL_RESOURCE_FACET_KEYS,
  ResourceEntityFacetSelections,
  collectResourceEntityFacetSelections,
  collectServiceFacetSelections,
} from "Common/Types/Telemetry/ResourceEntityFacet";

/*
 * Every facet whose values name a resource, in sidebar order. Re-exported
 * from the shared module so the viewer, the query compiler and the pivot
 * all agree on the list; how a given key is turned into a predicate is
 * decided there (Service ids read out of `primaryEntityId`, everything else
 * has to go through the resource's entity key).
 */
export const RESOURCE_FACET_KEYS: Array<string> = [...ALL_RESOURCE_FACET_KEYS];

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

  if (params.attributes) {
    requestData["attributes"] = params.attributes;
  }

  if (params.entityKeys) {
    requestData["entityKeys"] = params.entityKeys;
  }

  return requestData;
}
