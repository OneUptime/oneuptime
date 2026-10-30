import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import {
  SECURITY_EVENTS_END_PARAM,
  SECURITY_EVENTS_RANGE_PARAM,
  SECURITY_EVENTS_START_PARAM,
} from "../SecurityEventsTimeRange";
import Route from "Common/Types/API/Route";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import ObjectID from "Common/Types/ObjectID";
import {
  DEFAULT_SECURITY_HUNT_TIME_RANGE,
  SecurityHuntFilters,
  SecurityHuntRunWindow,
  SecurityHuntSchedule,
  areSecurityHuntFiltersEqual,
  countSecurityHuntFilterValues,
  getSecurityHuntTimeRangeForLength,
  isScheduledSecurityHunt,
  isSecurityHuntTimeRange,
  readSecurityHuntFilters,
  securityHuntFiltersFromMap,
} from "Common/Types/SecurityEvent/SecurityHunt";
import RangeStartAndEndDateTime, {
  RangeStartAndEndDateTimeUtil,
} from "Common/Types/Time/RangeStartAndEndDateTime";
import TimeRange from "Common/Types/Time/TimeRange";

/*
 * The small rules hunts are drawn and saved by in the Dashboard: where a
 * hunt opens, what Save as Hunt saves from the Events page, when a hunt's
 * page holds a change to save, and what its row says about its runs.
 * React-free, so a plain test pins them.
 */

// What the Events explorer is searching, as a hunt keeps it.
export interface HuntSearchState {
  search: string;
  filters: Map<string, Set<string>>;
  timeRange: RangeStartAndEndDateTime;
}

// A hunt's page; on a run's window when one is given (the Events page's own params).
export function getHuntViewRoute(
  huntId: ObjectID | string,
  window?: SecurityHuntRunWindow | undefined,
): Route {
  const route: Route = RouteUtil.populateRouteParams(
    RouteMap[PageMap.SECURITY_EVENTS_HUNT_VIEW] as Route,
    { modelId: huntId.toString() },
  );

  if (!window) {
    return route;
  }

  return new Route(route.toString()).addQueryParams({
    [SECURITY_EVENTS_RANGE_PARAM]: TimeRange.CUSTOM,
    [SECURITY_EVENTS_START_PARAM]: encodeURIComponent(
      new Date(window.startTime).toISOString(),
    ),
    [SECURITY_EVENTS_END_PARAM]: encodeURIComponent(
      new Date(window.endTime).toISOString(),
    ),
  });
}

export function getHuntsRoute(): Route {
  return RouteUtil.populateRouteParams(
    RouteMap[PageMap.SECURITY_EVENTS_HUNTS] as Route,
  );
}

export function getSecurityEventsRoute(): Route {
  return RouteUtil.populateRouteParams(
    RouteMap[PageMap.SECURITY_EVENTS] as Route,
  );
}

/*
 * How far back a hunt saved from the page looks: the page's window when it
 * moves with the clock, else the shortest moving window that holds the
 * fixed one on screen.
 */
export function getHuntTimeRangeToSave(
  timeRange: RangeStartAndEndDateTime | undefined,
): TimeRange {
  if (!timeRange) {
    return DEFAULT_SECURITY_HUNT_TIME_RANGE;
  }

  if (isSecurityHuntTimeRange(timeRange.range)) {
    return timeRange.range;
  }

  const window: InBetween<Date> =
    RangeStartAndEndDateTimeUtil.getStartAndEndDate(timeRange);
  const lengthInMinutes: number =
    (new Date(window.endValue).getTime() -
      new Date(window.startValue).getTime()) /
    60000;

  return Number.isFinite(lengthInMinutes) && lengthInMinutes > 0
    ? getSecurityHuntTimeRangeForLength(lengthInMinutes)
    : DEFAULT_SECURITY_HUNT_TIME_RANGE;
}

// Whether the page holds something a hunt can save: a search, or a filter.
export function hasHuntSearchToSave(data: {
  search: string;
  filters: Map<string, Set<string>>;
}): boolean {
  return (
    data.search.trim().length > 0 ||
    countSecurityHuntFilterValues(securityHuntFiltersFromMap(data.filters)) > 0
  );
}

// What a hunt saved from the page holds, before its name and schedule.
export function getHuntValuesToSave(state: HuntSearchState): {
  searchQuery: string;
  filters: SecurityHuntFilters;
  timeRange: TimeRange;
} {
  return {
    searchQuery: state.search.trim(),
    filters: securityHuntFiltersFromMap(state.filters),
    timeRange: getHuntTimeRangeToSave(state.timeRange),
  };
}

// The window a hunt opens on: its own, moving with the clock.
export function getHuntTimeRange(
  timeRange: TimeRange | string | undefined | null,
): RangeStartAndEndDateTime {
  return {
    range: isSecurityHuntTimeRange(timeRange)
      ? timeRange
      : DEFAULT_SECURITY_HUNT_TIME_RANGE,
  };
}

/*
 * Whether what the page searches differs from what the hunt keeps: its
 * text (as trimmed) or its chips. The window is the page's to move - a
 * notification opens the hunt on a run's window - and saving it is Edit's
 * Time Range.
 */
export function isHuntSearchChanged(data: {
  savedSearch: string | undefined | null;
  savedFilters: unknown;
  search: string;
  filters: Map<string, Set<string>>;
}): boolean {
  return (
    (data.savedSearch || "").trim() !== data.search.trim() ||
    !areSecurityHuntFiltersEqual(
      readSecurityHuntFilters(data.savedFilters),
      securityHuntFiltersFromMap(data.filters),
    )
  );
}

// The spaces between a search's terms.
const SEARCH_TERM_SEPARATOR: RegExp = /\s+/;

/*
 * A search's terms, as the search bar reads them apart - by the spaces
 * between them - to draw each kept whole on its line where a search wraps
 * (HuntSearchLine).
 */
export function getHuntSearchTerms(search: string): Array<string> {
  return search
    .trim()
    .split(SEARCH_TERM_SEPARATOR)
    .filter((term: string): boolean => {
      return Boolean(term);
    });
}

// Who a scheduled hunt tells, named on its row: the first two, then how many more.
export interface HuntRecipientsLine {
  names: Array<string>;
  moreCount: number;
}

export const HUNT_RECIPIENTS_NAMED: number = 2;

export function getHuntRecipientsLine(
  names: Array<string>,
): HuntRecipientsLine {
  const named: Array<string> = names
    .map((name: string): string => {
      return name.trim();
    })
    .filter((name: string): boolean => {
      return Boolean(name);
    });

  return {
    names: named.slice(0, HUNT_RECIPIENTS_NAMED),
    moreCount: Math.max(0, named.length - HUNT_RECIPIENTS_NAMED),
  };
}

// What a hunt's last runs say, as its row and its page draw them.
export enum HuntRunState {
  // Opened by hand only.
  NotScheduled = "not-scheduled",
  // Scheduled, and no run made yet.
  NotRunYet = "not-run-yet",
  // Its last run could not be made.
  Failed = "failed",
  // A run found events (the last one that did).
  Found = "found",
  // Its runs have found nothing yet.
  NothingFound = "nothing-found",
}

export function getHuntRunState(hunt: {
  schedule?: SecurityHuntSchedule | string | undefined | null;
  lastRunAt?: Date | string | undefined | null;
  lastRunError?: string | undefined | null;
  lastFoundAt?: Date | string | undefined | null;
  lastFoundEventCount?: number | undefined | null;
}): HuntRunState {
  const isScheduled: boolean = isScheduledSecurityHunt(hunt.schedule);

  if (isScheduled && hunt.lastRunError) {
    return HuntRunState.Failed;
  }

  if (hunt.lastFoundAt && (hunt.lastFoundEventCount || 0) > 0) {
    return HuntRunState.Found;
  }

  if (!isScheduled) {
    return HuntRunState.NotScheduled;
  }

  return hunt.lastRunAt ? HuntRunState.NothingFound : HuntRunState.NotRunYet;
}

// The window the last run that found something read, to show what it found.
export function getHuntLastFoundWindow(hunt: {
  lastFoundAt?: Date | string | undefined | null;
  lastFoundSinceAt?: Date | string | undefined | null;
}): SecurityHuntRunWindow | null {
  if (!hunt.lastFoundAt || !hunt.lastFoundSinceAt) {
    return null;
  }

  const startTime: Date = new Date(hunt.lastFoundSinceAt);
  const endTime: Date = new Date(hunt.lastFoundAt);

  if (
    Number.isNaN(startTime.getTime()) ||
    Number.isNaN(endTime.getTime()) ||
    startTime.getTime() >= endTime.getTime()
  ) {
    return null;
  }

  return { startTime, endTime };
}

// The window as the Events explorer's time picker holds it.
export function toCustomTimeRange(
  window: SecurityHuntRunWindow,
): RangeStartAndEndDateTime {
  return {
    range: TimeRange.CUSTOM,
    startAndEndDate: new InBetween<Date>(
      new Date(window.startTime),
      new Date(window.endTime),
    ),
  };
}
