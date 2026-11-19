/*
 * The filters a list offers beyond its search and its quick chips - the
 * ones the Dashboard's tables offer: who owns a record, its state, its
 * severity, its labels and the monitors it is about (for a monitor: its
 * status and its type). Pure, so every rule here is unit tested
 * (recordFilters.test.ts) and every list reads it the same way.
 *
 * The filters are asked of the server (api/recordFilterQuery.ts), so they
 * cover every record of the project, not only the newest hundred the list
 * holds.
 */

// The lists that take filters, one per kind of record.
export type FilterableList =
  | "incidents"
  | "incidentEpisodes"
  | "alerts"
  | "alertEpisodes"
  | "monitors";

// One question a filter answers, as a section of the filter sheet.
export type FilterFacet =
  | "owner"
  | "state"
  | "severity"
  | "label"
  | "monitor"
  | "monitorType";

export interface RecordFilters {
  /*
   * Owned by the reader: named an owner, or on a team that is. The way most
   * people use the filter, so it is one tap, and it stays true for whoever
   * reads it (a saved list of ids would not follow a change of teams).
   */
  ownedByMe: boolean;
  ownerUserIds: Array<string>;
  ownerTeamIds: Array<string>;
  // A record's current state; for a monitor, its current status.
  stateIds: Array<string>;
  severityIds: Array<string>;
  labelIds: Array<string>;
  monitorIds: Array<string>;
  // A monitor's type, by the server's own value ("Website", "API").
  monitorTypes: Array<string>;
}

export const NO_FILTERS: RecordFilters = Object.freeze({
  ownedByMe: false,
  ownerUserIds: [],
  ownerTeamIds: [],
  stateIds: [],
  severityIds: [],
  labelIds: [],
  monitorIds: [],
  monitorTypes: [],
}) as RecordFilters;

/*
 * The questions each list can ask, in the order the sheet asks them: who
 * owns it first - "what is mine?" is what most people open the filters
 * for - then what it is like, then what it is about.
 */
const FACETS_BY_LIST: Record<FilterableList, Array<FilterFacet>> = {
  incidents: ["owner", "severity", "state", "label", "monitor"],
  alerts: ["owner", "severity", "state", "label", "monitor"],
  incidentEpisodes: ["owner", "severity", "state", "label"],
  alertEpisodes: ["owner", "severity", "state", "label"],
  monitors: ["owner", "state", "monitorType", "label"],
};

export function getFilterFacets(list: FilterableList): Array<FilterFacet> {
  return FACETS_BY_LIST[list];
}

// A fresh, empty set of filters: never the shared frozen one, so it can be edited.
export function emptyFilters(): RecordFilters {
  return {
    ownedByMe: false,
    ownerUserIds: [],
    ownerTeamIds: [],
    stateIds: [],
    severityIds: [],
    labelIds: [],
    monitorIds: [],
    monitorTypes: [],
  };
}

/*
 * A stored or navigated value, read defensively: a field that is missing or
 * of the wrong shape is no filter, rather than a crash or a filter nobody
 * set.
 */
export function normalizeFilters(value: unknown): RecordFilters {
  if (!value || typeof value !== "object") {
    return emptyFilters();
  }
  const record: Record<string, unknown> = value as Record<string, unknown>;
  const ids: (key: keyof RecordFilters) => Array<string> = (
    key: keyof RecordFilters,
  ): Array<string> => {
    const list: unknown = record[key];
    if (!Array.isArray(list)) {
      return [];
    }
    return uniqueStrings(
      list.filter((item: unknown): item is string => {
        return typeof item === "string" && item.length > 0;
      }),
    );
  };
  return {
    ownedByMe: record["ownedByMe"] === true,
    ownerUserIds: ids("ownerUserIds"),
    ownerTeamIds: ids("ownerTeamIds"),
    stateIds: ids("stateIds"),
    severityIds: ids("severityIds"),
    labelIds: ids("labelIds"),
    monitorIds: ids("monitorIds"),
    monitorTypes: ids("monitorTypes"),
  };
}

function uniqueStrings(values: Array<string>): Array<string> {
  return Array.from(new Set(values));
}

// Whether a facet narrows the list.
export function isFacetActive(
  filters: RecordFilters,
  facet: FilterFacet,
): boolean {
  switch (facet) {
    case "owner":
      return (
        filters.ownedByMe ||
        filters.ownerUserIds.length > 0 ||
        filters.ownerTeamIds.length > 0
      );
    case "state":
      return filters.stateIds.length > 0;
    case "severity":
      return filters.severityIds.length > 0;
    case "label":
      return filters.labelIds.length > 0;
    case "monitor":
      return filters.monitorIds.length > 0;
    case "monitorType":
      return filters.monitorTypes.length > 0;
  }
}

/*
 * How many of a list's questions are answered: the number on the Filters
 * button. A facet counts once however many values it holds - "Severity:
 * Critical or Major" is one filter - and a facet the list does not ask is
 * never counted, so a filter carried over from another list cannot hide
 * rows without saying so.
 */
export function countActiveFacets(
  filters: RecordFilters,
  list: FilterableList,
): number {
  return getFilterFacets(list).filter((facet: FilterFacet): boolean => {
    return isFacetActive(filters, facet);
  }).length;
}

export function hasActiveFilters(
  filters: RecordFilters,
  list: FilterableList,
): boolean {
  return countActiveFacets(filters, list) > 0;
}

// Only what the list asks: the rest is dropped before a query is built.
export function filtersForList(
  filters: RecordFilters,
  list: FilterableList,
): RecordFilters {
  const facets: Set<FilterFacet> = new Set(getFilterFacets(list));
  return {
    ownedByMe: facets.has("owner") && filters.ownedByMe,
    ownerUserIds: facets.has("owner") ? [...filters.ownerUserIds] : [],
    ownerTeamIds: facets.has("owner") ? [...filters.ownerTeamIds] : [],
    stateIds: facets.has("state") ? [...filters.stateIds] : [],
    severityIds: facets.has("severity") ? [...filters.severityIds] : [],
    labelIds: facets.has("label") ? [...filters.labelIds] : [],
    monitorIds: facets.has("monitor") ? [...filters.monitorIds] : [],
    monitorTypes: facets.has("monitorType") ? [...filters.monitorTypes] : [],
  };
}

/*
 * The filters a list's sheet hands back, put into the screen's: the list's
 * own facets take the new values, and the facets only the screen's other
 * list asks (an incident's Monitors, while the episodes are on screen) keep
 * theirs - the sheet never showed them, so it never changed them.
 */
export function applyListFilters(
  current: RecordFilters,
  next: RecordFilters,
  list: FilterableList,
): RecordFilters {
  const facets: Set<FilterFacet> = new Set(getFilterFacets(list));
  const pick: (
    facet: FilterFacet,
    values: (filters: RecordFilters) => Array<string>,
  ) => Array<string> = (
    facet: FilterFacet,
    values: (filters: RecordFilters) => Array<string>,
  ): Array<string> => {
    return [...values(facets.has(facet) ? next : current)];
  };
  return {
    ownedByMe: facets.has("owner") ? next.ownedByMe : current.ownedByMe,
    ownerUserIds: pick("owner", (filters: RecordFilters) => {
      return filters.ownerUserIds;
    }),
    ownerTeamIds: pick("owner", (filters: RecordFilters) => {
      return filters.ownerTeamIds;
    }),
    stateIds: pick("state", (filters: RecordFilters) => {
      return filters.stateIds;
    }),
    severityIds: pick("severity", (filters: RecordFilters) => {
      return filters.severityIds;
    }),
    labelIds: pick("label", (filters: RecordFilters) => {
      return filters.labelIds;
    }),
    monitorIds: pick("monitor", (filters: RecordFilters) => {
      return filters.monitorIds;
    }),
    monitorTypes: pick("monitorType", (filters: RecordFilters) => {
      return filters.monitorTypes;
    }),
  };
}

// The facet cleared, everything else kept.
export function clearFacet(
  filters: RecordFilters,
  facet: FilterFacet,
): RecordFilters {
  switch (facet) {
    case "owner":
      return {
        ...filters,
        ownedByMe: false,
        ownerUserIds: [],
        ownerTeamIds: [],
      };
    case "state":
      return { ...filters, stateIds: [] };
    case "severity":
      return { ...filters, severityIds: [] };
    case "label":
      return { ...filters, labelIds: [] };
    case "monitor":
      return { ...filters, monitorIds: [] };
    case "monitorType":
      return { ...filters, monitorTypes: [] };
  }
}

// A value added to a list, or taken out of it if it was there.
export function toggleValue(
  values: Array<string>,
  value: string,
): Array<string> {
  return values.includes(value)
    ? values.filter((existing: string): boolean => {
        return existing !== value;
      })
    : [...values, value];
}

/*
 * A stable key for a set of filters: the same filters in any order give the
 * same key, so a list asked again with the same filters is answered from
 * the cache, and a query key never changes because a value moved.
 */
export function getFiltersKey(filters: RecordFilters): string {
  const sorted: (values: Array<string>) => string = (
    values: Array<string>,
  ): string => {
    return [...values].sort().join(",");
  };
  return [
    filters.ownedByMe ? "me" : "",
    sorted(filters.ownerUserIds),
    sorted(filters.ownerTeamIds),
    sorted(filters.stateIds),
    sorted(filters.severityIds),
    sorted(filters.labelIds),
    sorted(filters.monitorIds),
    sorted(filters.monitorTypes),
  ].join("|");
}

export function areFiltersEqual(a: RecordFilters, b: RecordFilters): boolean {
  return getFiltersKey(a) === getFiltersKey(b);
}

// A facet's name as the sheet and its chips say it.
export function getFacetTitle(
  facet: FilterFacet,
  list: FilterableList,
): string {
  switch (facet) {
    case "owner":
      return "Owner";
    case "state":
      return list === "monitors" ? "Status" : "State";
    case "severity":
      return "Severity";
    case "label":
      return "Labels";
    case "monitor":
      return "Monitors";
    case "monitorType":
      return "Type";
  }
}

/*
 * A list of names as a chip says it: up to two names, then how many more.
 * "Critical", "Critical or Major", "Critical, Major +1". Names the reader
 * does not have yet (an option still loading) are counted, never shown as
 * ids.
 */
export function summarizeNames(
  names: Array<string>,
  total: number,
  joiner: "or" | "and" = "or",
): string {
  const known: Array<string> = names.filter((name: string): boolean => {
    return name.trim().length > 0;
  });
  if (total <= 0) {
    return "";
  }
  if (known.length === 0) {
    return total === 1 ? "1 selected" : `${total} selected`;
  }
  if (total === 1) {
    return known[0] as string;
  }
  if (total === 2 && known.length === 2) {
    return `${known[0]} ${joiner} ${known[1]}`;
  }
  const shown: Array<string> = known.slice(0, 2);
  return `${shown.join(", ")} +${total - shown.length}`;
}
