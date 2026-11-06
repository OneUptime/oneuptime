import SecurityEvent from "../../Models/AnalyticsModels/SecurityEvent";
import InBetween from "../../Types/BaseDatabase/InBetween";
import Query from "../../Types/BaseDatabase/Query";
import ObjectID from "../../Types/ObjectID";
import {
  SECURITY_HUNT_FILTER_VALUES_MAX,
  SECURITY_HUNT_FILTER_VALUE_MAX_LENGTH,
  SECURITY_HUNT_MESSAGES,
  SecurityHuntFilters,
  readSecurityHuntFilters,
  securityHuntFiltersToMap,
} from "../../Types/SecurityEvent/SecurityHunt";
import { getWatchlistNamesInQuery } from "../../Types/SecurityEvent/SecurityWatchlistFilter";
import {
  applySecurityEventSearchToQuery,
  buildSecurityEventSearchQuery,
  isSecurityEventChipKey,
  parseSecurityEventSearch,
} from "./SecurityEventSearch";

/*
 * A hunt's search, as a read of the SecurityEvent table: its text and its
 * chips over a project and a window, compiled exactly as the Events page
 * compiles them (SecurityEventSearch), so a scheduled run counts what the
 * hunt's page lists for the same window.
 */

/*
 * What is wrong with a hunt's chips, in the shared words: a key the Events
 * sidebar cannot make, more values than a hunt keeps, or a value too long.
 * Null when they are fine.
 */
export function getSecurityHuntFiltersProblem(value: unknown): string | null {
  const filters: SecurityHuntFilters = readSecurityHuntFilters(value);
  let count: number = 0;

  for (const [key, values] of Object.entries(filters)) {
    if (!isSecurityEventChipKey(key)) {
      return SECURITY_HUNT_MESSAGES.unknownFilter.message;
    }

    for (const item of values) {
      if (item.length > SECURITY_HUNT_FILTER_VALUE_MAX_LENGTH) {
        return SECURITY_HUNT_MESSAGES.filterValueTooLong.message;
      }
    }

    count += values.length;
  }

  if (count > SECURITY_HUNT_FILTER_VALUES_MAX) {
    return SECURITY_HUNT_MESSAGES.tooManyFilterValues.message;
  }

  return null;
}

/*
 * The watchlists a hunt's search reads (`user:%vip_users%`), by name, each
 * once: what a save checks the project has, and what keeps a list from
 * being renamed or deleted while the hunt reads it. A chip names values,
 * never a list.
 */
export function getSecurityHuntWatchlistNames(
  searchQuery: string | undefined | null,
): Array<string> {
  if (!searchQuery || !searchQuery.includes("%")) {
    return [];
  }

  return getWatchlistNamesInQuery(
    applySecurityEventSearchToQuery({
      query: {},
      filters: parseSecurityEventSearch(searchQuery),
    }),
  );
}

// The read of a hunt's search over one project and one window.
export function buildSecurityHuntQuery(data: {
  projectId: ObjectID;
  searchQuery: string | undefined | null;
  filters: SecurityHuntFilters | undefined | null;
  startTime: Date;
  endTime: Date;
}): Query<SecurityEvent> {
  return buildSecurityEventSearchQuery({
    base: {
      projectId: data.projectId,
      time: new InBetween<Date>(data.startTime, data.endTime),
    } as Query<SecurityEvent>,
    search: data.searchQuery || "",
    filters: securityHuntFiltersToMap(data.filters),
  });
}
