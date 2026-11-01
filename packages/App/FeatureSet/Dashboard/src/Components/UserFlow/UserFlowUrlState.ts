import RangeStartAndEndDateTime from "Common/Types/Time/RangeStartAndEndDateTime";
import TimeRange from "Common/Types/Time/TimeRange";
import { SESSION_REPLAY_VISITOR_ID_PATTERN } from "Common/Types/Rum/SessionReplay";
import { SESSION_REPLAY_SESSION_ID_MAX_LENGTH } from "Common/Types/Rum/SessionReplayApi";
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
import {
  DEFAULT_USER_FLOW_PERSON_VIEW,
  UserFlowPerson,
  UserFlowView,
} from "./UserFlowPerson";

/*
 * The User Flows page's URL state: every control on the page round-trips
 * through the query string, so a flow map is a link someone can paste into
 * a ticket ("this is how people reach /checkout on mobile").
 *
 * The time range uses the session list's own keys and helpers, so the
 * window carries across the Sessions / Users / User Flows pages. Defaults
 * are written as absence.
 *
 * A person is written with the session list's own keys too, so "everything
 * this person did" is a link either page opens. Only what names nobody is
 * ever written: a digest, a visitor id, a session id. What someone typed may
 * be an email, and a query string reaches browser history, shared links and
 * the access log of every proxy in front of the installation (see
 * FILTER_URL_KEYS), so a lookup stays in memory until the server has said
 * which of the three it was.
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
  userKey: string;
  visitor: string;
  session: string;
  view: string;
} = {
  anchor: "page",
  direction: "dir",
  steps: "steps",
  pagesPerStep: "perStep",
  group: "group",
  hide: "hide",
  device: "device",
  sessions: "sessions",
  userKey: FILTER_URL_KEYS.identifiedUserKey as string,
  visitor: FILTER_URL_KEYS.visitorId as string,
  session: "sessionId",
  view: "view",
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
  /* One person's sessions; absent is everyone's flows. */
  person?: UserFlowPerson | undefined;
  /* Only means anything with a person: everyone's flows are a map. */
  view?: UserFlowView | undefined;
}

const SESSION_FILTERS: Array<UserFlowSessionFilter> = [
  "all",
  "errors",
  "frustration",
];

const WHOLE_NUMBER: RegExp = /^\d+$/;

/* SessionReplayIdentity.buildUserKey: hex of a SHA-256. */
const USER_KEY_PATTERN: RegExp = /^[0-9a-f]{64}$/;

function readInteger(value: string | null, fallback: number): number {
  if (value === null || !WHOLE_NUMBER.test(value)) {
    return fallback;
  }

  return Number(value);
}

/*
 * A pasted link is untrusted input, like the session list's. A value that
 * could never be one of these would come back as a 400 the page can only
 * show as a failure, so it degrades to everyone's flows instead. The session
 * comes first: it is the narrowest thing a link can name.
 */
function readPersonFromSearch(
  params: URLSearchParams,
): UserFlowPerson | undefined {
  const sessionId: string = (
    params.get(USER_FLOW_URL_KEYS.session) || ""
  ).trim();

  if (sessionId && sessionId.length <= SESSION_REPLAY_SESSION_ID_MAX_LENGTH) {
    return { kind: "session", sessionId: sessionId };
  }

  const userKey: string = (params.get(USER_FLOW_URL_KEYS.userKey) || "")
    .trim()
    .toLowerCase();

  if (USER_KEY_PATTERN.test(userKey)) {
    return { kind: "user", identifiedUserKey: userKey };
  }

  const visitorId: string = (params.get(USER_FLOW_URL_KEYS.visitor) || "")
    .trim()
    .toLowerCase();

  if (SESSION_REPLAY_VISITOR_ID_PATTERN.test(visitorId)) {
    return { kind: "visitor", visitorId: visitorId };
  }

  return undefined;
}

export function readUserFlowStateFromSearch(search: string): UserFlowUrlState {
  const params: URLSearchParams = new URLSearchParams(search);
  const hasRange: boolean = TIME_RANGE_URL_KEYS.some((key: string): boolean => {
    return params.has(key);
  });

  const sessionFilter: string | null = params.get(USER_FLOW_URL_KEYS.sessions);
  const person: UserFlowPerson | undefined = readPersonFromSearch(params);

  return {
    person: person,
    view:
      person && params.get(USER_FLOW_URL_KEYS.view) === "map"
        ? "map"
        : undefined,
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

  const person: UserFlowPerson | undefined = state.person;

  /* A lookup is deliberately missing here: see the top of this file. */
  if (person?.kind === "user") {
    params.set(USER_FLOW_URL_KEYS.userKey, person.identifiedUserKey);
  } else if (person?.kind === "visitor") {
    params.set(USER_FLOW_URL_KEYS.visitor, person.visitorId);
  } else if (person?.kind === "session") {
    params.set(USER_FLOW_URL_KEYS.session, person.sessionId);
  }

  if (
    person &&
    person.kind !== "lookup" &&
    state.view &&
    state.view !== DEFAULT_USER_FLOW_PERSON_VIEW
  ) {
    params.set(USER_FLOW_URL_KEYS.view, state.view);
  }

  return url.toString();
}

/*
 * The query string that opens this page on one person, on the window they
 * were counted in: what the Users page and the session list link here with.
 * Written by the page's own builder, so this page's default window (a week,
 * not the session list's day) is the one left as absence.
 */
export function buildUserFlowPersonSearch(
  person: UserFlowPerson,
  timeRange: RangeStartAndEndDateTime,
): string {
  return new URL(
    buildUserFlowPageUrl("https://oneuptime.invalid/", {
      timeRange: timeRange,
      options: DEFAULT_USER_FLOW_OPTIONS,
      person: person,
    }),
  ).search;
}

/*
 * The session list's keys for a person, on the params given. False when the
 * list has no way to say it: it filters by person, not to one session, and a
 * lookup is not yet anyone it could name.
 */
function writePersonToListParams(
  params: URLSearchParams,
  person: UserFlowPerson,
): boolean {
  if (person.kind === "user") {
    params.set(
      FILTER_URL_KEYS.identifiedUserKey as string,
      person.identifiedUserKey,
    );

    return true;
  }

  if (person.kind === "visitor") {
    params.set(FILTER_URL_KEYS.visitorId as string, person.visitorId);

    return true;
  }

  return false;
}

function paramsForTimeRange(
  timeRange: RangeStartAndEndDateTime,
): URLSearchParams {
  const rangeSearch: string = buildTimeRangeSearch(timeRange);

  return new URLSearchParams(
    rangeSearch.startsWith("?") ? rangeSearch.slice(1) : rangeSearch,
  );
}

/*
 * "?urlPrefix=/product/&range=..." for the session list: every recorded
 * session that visited this page, on this page's window. Empty for the
 * "Other pages" bucket, which has no single prefix.
 *
 * With a person, only theirs: the page is about one person, and a link off it
 * must not bring everybody else's sessions back. Empty when the list cannot
 * say who that is.
 */
export function buildSessionsForPageSearch(
  page: string,
  timeRange: RangeStartAndEndDateTime,
  person?: UserFlowPerson | undefined,
): string {
  const prefix: string = toSessionListUrlPrefix(page);

  if (!prefix) {
    return "";
  }

  const params: URLSearchParams = paramsForTimeRange(timeRange);

  if (person && !writePersonToListParams(params, person)) {
    return "";
  }

  params.set(FILTER_URL_KEYS.urlPrefix as string, prefix);

  return `?${params.toString()}`;
}

/* The session list on this person, on this page's window; "" when it can't. */
export function buildSessionsForPersonSearch(
  person: UserFlowPerson,
  timeRange: RangeStartAndEndDateTime,
): string {
  const params: URLSearchParams = paramsForTimeRange(timeRange);

  return writePersonToListParams(params, person) ? `?${params.toString()}` : "";
}
