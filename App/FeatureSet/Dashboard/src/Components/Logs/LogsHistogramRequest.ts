import { JSONObject } from "Common/Types/JSON";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import RangeStartAndEndDateTime, {
  RangeStartAndEndDateTimeUtil,
} from "Common/Types/Time/RangeStartAndEndDateTime";

/*
 * Facets that all read out of the same `primaryEntityId` column — the
 * discriminator (Service / Host / Docker host / Podman host / Kubernetes
 * cluster) only matters when the facet values are computed. Filtering by any
 * of them is a single `primaryEntityId IN (...)` predicate, so selections
 * across these facets are coalesced into one list.
 */
export const RESOURCE_FACET_KEYS: Array<string> = [
  "primaryEntityId",
  "hostId",
  "dockerHostId",
  "podmanHostId",
  "kubernetesClusterId",
];

export interface LogsHistogramRequestParams {
  /** Current picker selection. Preset ranges resolve against "now" on every call. */
  timeRange: RangeStartAndEndDateTime;
  /** Base scope from the host page (e.g. a service or trace detail view). */
  serviceIds?: Array<string> | undefined;
  traceIds?: Array<string> | undefined;
  spanIds?: Array<string> | undefined;
  attributes?: Record<string, string> | undefined;
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

  const resourceFilterIds: Set<string> = new Set<string>();

  for (const facetKey of RESOURCE_FACET_KEYS) {
    const values: Set<string> | undefined =
      params.appliedFacetFilters.get(facetKey);

    if (values) {
      for (const value of values) {
        resourceFilterIds.add(value);
      }
    }
  }

  if (resourceFilterIds.size > 0) {
    requestData["serviceIds"] = Array.from(resourceFilterIds);
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

  if (params.attributes) {
    requestData["attributes"] = params.attributes;
  }

  if (params.entityKeys) {
    requestData["entityKeys"] = params.entityKeys;
  }

  return requestData;
}
