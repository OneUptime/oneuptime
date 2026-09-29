import RangeStartAndEndDateTime from "Common/Types/Time/RangeStartAndEndDateTime";
import TimeRange from "Common/Types/Time/TimeRange";
import {
  DEFAULT_USER_FLOW_OPTIONS,
  normalizeUserFlowOptions,
  toSessionListUrlPrefix,
  UserFlowOptions,
  UserFlowSessionFilter,
} from "Common/Utils/Rum/UserFlow";
import {
  buildTimeRangeSearch,
  FILTER_URL_KEYS,
  readTimeRangeFromSearch,
} from "../SessionReplay/SessionReplayListFilters";

/*
 * The User Flows page's URL state: every control on the page round-trips
 * through the query string, so a flow map is a link someone can paste into
 * a ticket ("this is how people reach /checkout on mobile").
 *
 * The time range uses the session list's own keys and helpers, so the
 * window carries across the Sessions / Users / User Flows pages. Defaults
 * are written as absence.
 *
 * Plain TypeScript with no React and no Common/UI import, so node tests can
 * pin it (see the window-at-load trap for why that matters).
 */

export const USER_FLOW_URL_KEYS: {
  anchor: string;
  direction: string;
  steps: string;
  pagesPerStep: string;
  group: string;
  hide: string;
  device: string;
  sessions: string;
} = {
  anchor: "page",
  direction: "dir",
  steps: "steps",
  pagesPerStep: "perStep",
  group: "group",
  hide: "hide",
  device: "device",
  sessions: "sessions",
};

/*
 * A week, not the session list's day: a flow map needs enough sessions to
 * show a shape, and it reads at most the newest few thousand anyway.
 */
export const DEFAULT_USER_FLOW_TIME_RANGE: RangeStartAndEndDateTime = {
  range: TimeRange.PAST_ONE_WEEK,
};

/* Every spelling the shared reader accepts, so a rewrite leaves none behind. */
const TIME_RANGE_URL_KEYS: Array<string> = [
  "range",
  "startTime",
  "endTime",
  "start",
  "end",
];

export interface UserFlowUrlState {
  timeRange: RangeStartAndEndDateTime;
  options: UserFlowOptions;
}

const SESSION_FILTERS: Array<UserFlowSessionFilter> = [
  "all",
  "errors",
  "frustration",
];

const WHOLE_NUMBER: RegExp = /^\d+$/;

function readInteger(value: string | null, fallback: number): number {
  if (value === null || !WHOLE_NUMBER.test(value)) {
    return fallback;
  }

  return Number(value);
}

export function readUserFlowStateFromSearch(search: string): UserFlowUrlState {
  const params: URLSearchParams = new URLSearchParams(search);
  const hasRange: boolean = TIME_RANGE_URL_KEYS.some((key: string): boolean => {
    return params.has(key);
  });

  const sessionFilter: string | null = params.get(USER_FLOW_URL_KEYS.sessions);

  return {
    timeRange: hasRange
      ? readTimeRangeFromSearch(search)
      : DEFAULT_USER_FLOW_TIME_RANGE,
    options: normalizeUserFlowOptions({
      anchorPage: params.get(USER_FLOW_URL_KEYS.anchor) || null,
      direction:
        params.get(USER_FLOW_URL_KEYS.direction) === "backward"
          ? "backward"
          : "forward",
      steps: readInteger(
        params.get(USER_FLOW_URL_KEYS.steps),
        DEFAULT_USER_FLOW_OPTIONS.steps,
      ),
      pagesPerStep: readInteger(
        params.get(USER_FLOW_URL_KEYS.pagesPerStep),
        DEFAULT_USER_FLOW_OPTIONS.pagesPerStep,
      ),
      groupDynamicSegments: params.get(USER_FLOW_URL_KEYS.group) !== "0",
      hiddenPages: params.getAll(USER_FLOW_URL_KEYS.hide).filter(Boolean),
      deviceType: params.get(USER_FLOW_URL_KEYS.device) || "",
      sessionFilter: SESSION_FILTERS.includes(
        sessionFilter as UserFlowSessionFilter,
      )
        ? (sessionFilter as UserFlowSessionFilter)
        : "all",
    }),
  };
}

/* The href with this state written in and every other flow key removed. */
export function buildUserFlowPageUrl(
  href: string,
  state: UserFlowUrlState,
): string {
  const url: URL = new URL(href);
  const params: URLSearchParams = url.searchParams;

  /*
   * Same keys as the session list, but this page's default window (a
   * week) is the one written as absence.
   */
  for (const key of TIME_RANGE_URL_KEYS) {
    params.delete(key);
  }

  if (
    state.timeRange.range === TimeRange.CUSTOM &&
    state.timeRange.startAndEndDate
  ) {
    params.set(
      "startTime",
      state.timeRange.startAndEndDate.startValue.toISOString(),
    );
    params.set(
      "endTime",
      state.timeRange.startAndEndDate.endValue.toISOString(),
    );
  } else if (
    state.timeRange.range !== DEFAULT_USER_FLOW_TIME_RANGE.range &&
    state.timeRange.range !== TimeRange.CUSTOM
  ) {
    params.set("range", state.timeRange.range);
  }

  for (const key of Object.values(USER_FLOW_URL_KEYS)) {
    params.delete(key);
  }

  const options: UserFlowOptions = state.options;

  if (options.anchorPage) {
    params.set(USER_FLOW_URL_KEYS.anchor, options.anchorPage);

    if (options.direction === "backward") {
      params.set(USER_FLOW_URL_KEYS.direction, "backward");
    }
  }

  if (options.steps !== DEFAULT_USER_FLOW_OPTIONS.steps) {
    params.set(USER_FLOW_URL_KEYS.steps, String(options.steps));
  }

  if (options.pagesPerStep !== DEFAULT_USER_FLOW_OPTIONS.pagesPerStep) {
    params.set(USER_FLOW_URL_KEYS.pagesPerStep, String(options.pagesPerStep));
  }

  if (!options.groupDynamicSegments) {
    params.set(USER_FLOW_URL_KEYS.group, "0");
  }

  for (const page of options.hiddenPages) {
    params.append(USER_FLOW_URL_KEYS.hide, page);
  }

  if (options.deviceType) {
    params.set(USER_FLOW_URL_KEYS.device, options.deviceType);
  }

  if (options.sessionFilter !== "all") {
    params.set(USER_FLOW_URL_KEYS.sessions, options.sessionFilter);
  }

  return url.toString();
}

/*
 * "?urlPrefix=/product/&range=..." for the session list: every recorded
 * session that visited this page, on this page's window. Empty for the
 * "Other pages" bucket, which has no single prefix.
 */
export function buildSessionsForPageSearch(
  page: string,
  timeRange: RangeStartAndEndDateTime,
): string {
  const prefix: string = toSessionListUrlPrefix(page);

  if (!prefix) {
    return "";
  }

  const rangeSearch: string = buildTimeRangeSearch(timeRange);
  const params: URLSearchParams = new URLSearchParams(
    rangeSearch.startsWith("?") ? rangeSearch.slice(1) : rangeSearch,
  );

  params.set(FILTER_URL_KEYS.urlPrefix as string, prefix);

  return `?${params.toString()}`;
}
