import { JSONObject } from "../../../Types/JSON";
import { toExcludeFacetKey } from "../../../Types/Telemetry/FacetExcludeKey";
import {
  EXCLUDED_RESOURCE_FILTERS_FIELD,
  ResourceEntityFacetSelections,
  collectExcludedResourceEntityFacetSelections,
  collectExcludedServiceFacetSelections,
} from "../../../Types/Telemetry/ResourceEntityFacet";

/*
 * What a logs view LEFT OUT, onto a request for the aggregate endpoints
 * (/telemetry/logs/histogram, /facets and /analytics) - the half of a facet
 * chip set those endpoints used to have no field for, so the logs explorer
 * offered no "is not" at all: an exclusion would have drawn bars and counts
 * for rows the list no longer showed.
 *
 *   !severityText: debug        -> excludedSeverityTexts: ["debug"]
 *   !primaryEntityId: <id>      -> excludedServiceIds: [<id>]
 *   !hostId: <id>               -> excludedResourceFilters: { hostId: [<id>] }
 *
 * A severity or a service the request already KEEPS (a chip, the page's own
 * scope) wins over a left-out one: a log has one severity and one primary
 * entity, so leaving a value out beside kept ones changes nothing - and the
 * list query, which holds one predicate per column, drops it the same way
 * (the Dashboard's applyLogsFacetFiltersToQuery). A resource left out is
 * applied beside resources kept: a log names several (its host, its
 * cluster), and each facet is its own group.
 *
 * Called after the kept values are written. Mutates and returns
 * `requestData`, like the builders it is called from. Kept free of React so
 * the Dashboard's builders and the analytics tab here share it.
 */
export const applyLogsFacetExclusionsToRequest: (
  requestData: JSONObject,
  facetFilters: ReadonlyMap<string, ReadonlySet<string>>,
) => JSONObject = (
  requestData: JSONObject,
  facetFilters: ReadonlyMap<string, ReadonlySet<string>>,
): JSONObject => {
  const entries: Array<[string, Iterable<string>]> = Array.from(
    facetFilters.entries(),
  );

  if (!hasValues(requestData["severityTexts"])) {
    const severities: Array<string> = Array.from(
      facetFilters.get(toExcludeFacetKey("severityText")) || [],
    ).filter((severity: string): boolean => {
      return typeof severity === "string" && severity.length > 0;
    });

    if (severities.length > 0) {
      requestData["excludedSeverityTexts"] = Array.from(
        new Set<string>(severities),
      );
    }
  }

  if (!hasValues(requestData["serviceIds"])) {
    const serviceIds: Array<string> =
      collectExcludedServiceFacetSelections(entries);

    if (serviceIds.length > 0) {
      requestData["excludedServiceIds"] = serviceIds;
    }
  }

  const resourceFilters: ResourceEntityFacetSelections =
    collectExcludedResourceEntityFacetSelections(entries);

  if (Object.keys(resourceFilters).length > 0) {
    requestData[EXCLUDED_RESOURCE_FILTERS_FIELD] = resourceFilters;
  }

  return requestData;
};

const hasValues: (value: unknown) => boolean = (value: unknown): boolean => {
  return Array.isArray(value) && value.length > 0;
};
