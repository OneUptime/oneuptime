import {
  getFacetTitle,
  getFilterFacets,
  isFacetActive,
  summarizeNames,
  type FilterFacet,
  type FilterableList,
  type RecordFilters,
} from "./recordFilters";
import {
  getSelectedNames,
  type FilterOption,
  type FilterSheetOptions,
} from "./filterOptions";

export interface FilterSummaryItem {
  facet: FilterFacet;
  title: string;
  summary: string;
}

function namesFor(
  options: Array<FilterOption>,
  ids: Array<string>,
): Array<string> {
  return getSelectedNames(options, ids);
}

/*
 * What a facet is set to, in words, for its chip under the search: "You",
 * "You or Platform team", "Critical or Major", "payments, checkout +2". A
 * value whose name has not arrived yet is counted, never shown as an id.
 */
export function summarizeFacet(
  facet: FilterFacet,
  filters: RecordFilters,
  options: FilterSheetOptions,
): string {
  switch (facet) {
    case "owner": {
      const names: Array<string> = [
        ...(filters.ownedByMe ? ["You"] : []),
        ...namesFor(options.teams.options, filters.ownerTeamIds),
        ...namesFor(options.people.options, filters.ownerUserIds),
      ];
      const total: number =
        (filters.ownedByMe ? 1 : 0) +
        filters.ownerTeamIds.length +
        filters.ownerUserIds.length;
      return summarizeNames(names, total);
    }
    case "state":
      return summarizeNames(
        namesFor(options.states.options, filters.stateIds),
        filters.stateIds.length,
      );
    case "severity":
      return summarizeNames(
        namesFor(options.severities.options, filters.severityIds),
        filters.severityIds.length,
      );
    case "label":
      return summarizeNames(
        namesFor(options.labels.options, filters.labelIds),
        filters.labelIds.length,
      );
    case "monitor":
      return summarizeNames(
        namesFor(options.monitors.options, filters.monitorIds),
        filters.monitorIds.length,
      );
    case "monitorType":
      // A type's id is its name ("Website").
      return summarizeNames(filters.monitorTypes, filters.monitorTypes.length);
  }
}

// The facets that are on for a list, each with its title and what it keeps.
export function getActiveFilterItems(
  list: FilterableList,
  filters: RecordFilters,
  options: FilterSheetOptions,
): Array<FilterSummaryItem> {
  return getFilterFacets(list)
    .filter((facet: FilterFacet): boolean => {
      return isFacetActive(filters, facet);
    })
    .map((facet: FilterFacet): FilterSummaryItem => {
      return {
        facet: facet,
        title: getFacetTitle(facet, list),
        summary: summarizeFacet(facet, filters, options),
      };
    });
}
