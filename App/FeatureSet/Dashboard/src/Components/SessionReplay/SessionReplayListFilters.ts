import { JSONObject } from "Common/Types/JSON";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import RangeStartAndEndDateTime from "Common/Types/Time/RangeStartAndEndDateTime";
import TimeRange from "Common/Types/Time/TimeRange";
import {
  parseSessionReplayListCursor,
  SESSION_REPLAY_SORT_BY_VALUES,
  SessionReplayListCursorDto,
  SessionReplaySortBy,
  SessionReplaySortedListCursorDto,
} from "Common/Types/Rum/SessionReplayApi";

/*
 * The list's filter model and its translations: UI state -> the
 * /telemetry/rum/session-replay/list endpoint's filter object, and UI
 * state <-> the URL query string.
 *
 * Plain dependency-free TypeScript, deliberately outside the table
 * component: misspell one endpoint field name here and the filter silently
 * matches nothing (the endpoint ignores unknown keys), so this has to be
 * pinned by tests that need no React and no Common/UI.
 */

export interface SessionReplayAdvancedFilters {
  browserName: string;
  osName: string;
  deviceType: string;
  countryCode: string;
  identifiedUserRef: string;
  /* Exact match against the routes array (the original filter). */
  route: string;
  minDurationSeconds: string;
  triggerReason: string;
  /* startsWith over the routes array and the entry URL: "/checkout". */
  urlPrefix: string;
  /*
   * "key=value, key2=value2". Kept as the text a person types so the
   * modal and the search box edit the same string; parseTagFilter turns it
   * into the map the endpoint takes.
   */
  tags: string;
  /* Free text: the server's `search` filter (sessionId prefix, URLs, ...). */
  search: string;
}

export const EMPTY_ADVANCED_FILTERS: SessionReplayAdvancedFilters = {
  browserName: "",
  osName: "",
  deviceType: "",
  countryCode: "",
  identifiedUserRef: "",
  route: "",
  minDurationSeconds: "",
  triggerReason: "",
  urlPrefix: "",
  tags: "",
  search: "",
};

/*
 * The quick filters above the table. Each is one server-side predicate so
 * the button narrows the whole table, not the fetched page.
 */
export interface SessionReplaySignalOption {
  value: string;
  label: string;
  /* One sentence for the button's tooltip: what the predicate really is. */
  description: string;
}

export const SESSION_REPLAY_SIGNAL_OPTIONS: Array<SessionReplaySignalOption> = [
  { value: "all", label: "All", description: "Every session in the range." },
  {
    value: "errors",
    label: "Errors",
    description: "Sessions with at least one JavaScript error.",
  },
  {
    value: "frustration",
    label: "Frustration",
    description:
      "Sessions with a rage click, dead click, error click or refresh rage.",
  },
  {
    value: "identified",
    label: "Identified",
    description: "Sessions where the page called identify().",
  },
  {
    value: "playable",
    label: "Playable",
    description:
      "Sessions with footage to watch: still recording, or finalized with chunks and not lost.",
  },
  {
    value: "slow",
    label: "Slow",
    description:
      "Sessions the recorder uploaded because a performance budget was blown.",
  },
  {
    value: "live",
    label: "Live",
    description: "Sessions that have not been finalized yet.",
  },
  {
    value: "traced",
    label: "Traced",
    description: "Sessions that carry at least one backend trace id.",
  },
];

export const SESSION_REPLAY_SIGNALS: Array<string> =
  SESSION_REPLAY_SIGNAL_OPTIONS.map(
    (option: SessionReplaySignalOption): string => {
      return option.value;
    },
  );

export interface SessionReplaySortOption {
  value: SessionReplaySortBy;
  label: string;
}

export const DEFAULT_SESSION_REPLAY_SORT_BY: SessionReplaySortBy = "startTime";

export const SESSION_REPLAY_SORT_OPTIONS: Array<SessionReplaySortOption> = [
  { value: "startTime", label: "Newest" },
  { value: "durationMs", label: "Longest" },
  { value: "errorCount", label: "Most errors" },
  { value: "frustration", label: "Most frustration" },
];

export function isSessionReplaySortBy(
  value: unknown,
): value is SessionReplaySortBy {
  return (
    typeof value === "string" &&
    (SESSION_REPLAY_SORT_BY_VALUES as ReadonlyArray<string>).includes(value)
  );
}

/*
 * The list's default window. One day, because the strip above the list
 * already says whether the recorder is healthy: a quiet day should read as
 * a quiet day, not as a broken install.
 */
export const DEFAULT_SESSION_REPLAY_TIME_RANGE: RangeStartAndEndDateTime = {
  range: TimeRange.PAST_ONE_DAY,
};

export const DEFAULT_SESSION_REPLAY_ITEMS_ON_PAGE: number = 20;

export const SESSION_REPLAY_ITEMS_ON_PAGE_OPTIONS: Array<number> = [
  20, 50, 100,
];

/*
 * "key=value, key2=value2" -> map. A pair without "=" or with an empty key
 * is dropped rather than sent: the endpoint would treat it as a tag that
 * can never match and the list would come back empty for a typo.
 */
export function parseTagFilter(value: string): Record<string, string> {
  const tags: Record<string, string> = {};

  for (const pair of value.split(",")) {
    const trimmed: string = pair.trim();

    if (!trimmed) {
      continue;
    }

    const separatorIndex: number = trimmed.indexOf("=");

    if (separatorIndex <= 0) {
      continue;
    }

    const key: string = trimmed.substring(0, separatorIndex).trim();
    const tagValue: string = trimmed.substring(separatorIndex + 1).trim();

    if (!key) {
      continue;
    }

    tags[key] = tagValue;
  }

  return tags;
}

export function stringifyTagFilter(tags: Record<string, string>): string {
  return Object.keys(tags)
    .map((key: string): string => {
      return `${key}=${tags[key]}`;
    })
    .join(", ");
}

const ABSOLUTE_URL_PATTERN: RegExp = /^https?:\/\//i;

/* Where the authority ends: the first path, query or fragment character. */
const AUTHORITY_END_PATTERN: RegExp = /[/?#]/;
const PORT_SUFFIX_PATTERN: RegExp = /:\d{2,5}$/;

/*
 * Is this meant to be an address rather than a path? Only when the value
 * carries an authority AND something after it - "shop.example.com/cart",
 * "localhost:3000/cart" - or the unmistakable "www." prefix. A dotted word
 * on its own ("checkout.html") stays a path: it is far more often a page
 * than a host somebody typed without a scheme, and guessing wrong there
 * would send a filter to an origin that does not exist.
 */
function looksLikeHost(value: string): boolean {
  const authority: string = value.split(AUTHORITY_END_PATTERN)[0] as string;

  if (!authority.includes(".") && !PORT_SUFFIX_PATTERN.test(authority)) {
    return false;
  }

  if (authority.toLowerCase().startsWith("www.")) {
    return true;
  }

  return value.length > authority.length;
}

/*
 * Anchors a URL filter so the endpoint's prefix comparison can ever hit.
 *
 * The endpoint matches `urlPrefix` against each stored route and the entry
 * URL - both absolute ("https://shop.example.com/cart") - AND, since the
 * path fix, against their path ("/cart"). So a value that starts with "/"
 * or with a scheme is a filter the server can answer; anything else
 * ("checkout") anchors nowhere and would silently match nothing, which is
 * the one failure mode this list must never have. A host-looking value
 * gets the scheme it is missing, everything else is read as a path.
 */
export function normalizeUrlPrefix(value: string): string {
  const trimmed: string = value.trim();

  if (!trimmed) {
    return "";
  }

  if (trimmed.startsWith("/") || ABSOLUTE_URL_PATTERN.test(trimmed)) {
    return trimmed;
  }

  if (looksLikeHost(trimmed)) {
    return `https://${trimmed}`;
  }

  return `/${trimmed}`;
}

/*
 * Filter state <-> URL query string keys. Persisted so back-navigation
 * from a replay restores the triage the viewer had built, and so a
 * filtered list is a shareable link.
 *
 * identifiedUserRef is deliberately ABSENT. It is the only filter whose
 * value is a named end user of the customer's product - typically their
 * email - and a query string reaches the operator's history and bookmarks,
 * every shared link, and the request line in every reverse proxy and CDN
 * access log in front of the instance. The filter still round-trips through
 * the POST body; it just does not survive a reload, which is the right
 * trade for the one field here that carries a third party's identity.
 */
export const FILTER_URL_KEYS: Partial<
  Record<keyof SessionReplayAdvancedFilters, string>
> = {
  browserName: "browser",
  osName: "os",
  deviceType: "device",
  countryCode: "country",
  route: "route",
  minDurationSeconds: "minDuration",
  triggerReason: "trigger",
  urlPrefix: "urlPrefix",
  tags: "tag",
  search: "q",
};

/* The non-filter parts of the list URL. */
export const LIST_URL_KEYS: {
  signal: string;
  sort: string;
  range: string;
  startTime: string;
  endTime: string;
  page: string;
} = {
  signal: "signal",
  sort: "sort",
  range: "range",
  startTime: "startTime",
  endTime: "endTime",
  page: "page",
};

export function hasAnyAdvancedFilter(
  filters: SessionReplayAdvancedFilters,
): boolean {
  return Object.values(filters).some((value: string): boolean => {
    return value.trim().length > 0;
  });
}

/*
 * Translates the signal buttons and field filters into the endpoint's
 * filter object. Every predicate is server-side — "frustration" included,
 * so the filter applies to the whole table rather than to whichever page
 * happened to be fetched.
 */
export function buildSessionReplayListFilters(
  signal: string,
  advanced?: SessionReplayAdvancedFilters,
): JSONObject {
  const filters: JSONObject = {};

  if (signal === "errors") {
    filters["hasError"] = true;
  }

  if (signal === "frustration") {
    filters["hasFrustration"] = true;
  }

  if (signal === "identified") {
    filters["hasIdentifiedUser"] = true;
  }

  if (signal === "playable") {
    filters["isPlayable"] = true;
  }

  if (signal === "live") {
    filters["isFinalized"] = false;
  }

  if (signal === "traced") {
    filters["hasTraces"] = true;
  }

  if (signal === "slow") {
    /*
     * The quick filter wins over the advanced trigger field: both name the
     * same IN (...) predicate and a person who pressed "Slow" asked for
     * slow sessions, whatever the modal still holds.
     */
    filters["triggerReasons"] = ["performance"];
  }

  if (advanced) {
    if (advanced.browserName.trim()) {
      filters["browserNames"] = [advanced.browserName.trim()];
    }

    if (advanced.osName.trim()) {
      filters["osNames"] = [advanced.osName.trim()];
    }

    if (advanced.deviceType.trim()) {
      filters["deviceTypes"] = [advanced.deviceType.trim()];
    }

    if (advanced.countryCode.trim()) {
      filters["countryCodes"] = [advanced.countryCode.trim().toUpperCase()];
    }

    if (advanced.identifiedUserRef.trim()) {
      /*
       * The reference, not the digest: the server hashes it with the
       * per-project derivation the ingest used. See SessionReplayIdentity.
       */
      filters["identifiedUserRef"] = advanced.identifiedUserRef.trim();
    }

    if (advanced.route.trim()) {
      filters["route"] = advanced.route.trim();
    }

    const minDurationSeconds: number = parseFloat(advanced.minDurationSeconds);

    if (Number.isFinite(minDurationSeconds) && minDurationSeconds > 0) {
      filters["minDurationMs"] = Math.round(minDurationSeconds * 1000);
    }

    if (advanced.triggerReason.trim() && signal !== "slow") {
      filters["triggerReasons"] = [advanced.triggerReason.trim()];
    }

    /*
     * Normalized here as well as in the search box, because the modal
     * writes this field straight from a text input: an un-anchored prefix
     * reaching the endpoint comes back as "no sessions match" with no way
     * for the viewer to tell why.
     */
    const urlPrefix: string = normalizeUrlPrefix(advanced.urlPrefix);

    if (urlPrefix) {
      filters["urlPrefix"] = urlPrefix;
    }

    const tags: Record<string, string> = parseTagFilter(advanced.tags);

    if (Object.keys(tags).length > 0) {
      filters["tags"] = tags;
    }

    if (advanced.search.trim()) {
      filters["search"] = advanced.search.trim();
    }
  }

  return filters;
}

/* The whole list state a URL can carry. */
export interface SessionReplayListUrlState {
  signal: string;
  advanced: SessionReplayAdvancedFilters;
  sortBy: SessionReplaySortBy;
  timeRange: RangeStartAndEndDateTime;
  /* 1-based. Only meaningful with a remembered cursor; see cursor memory. */
  page: number;
}

function parseIsoDate(value: string | null): Date | null {
  if (!value) {
    return null;
  }

  const parsed: number = Date.parse(value);

  return Number.isFinite(parsed) ? new Date(parsed) : null;
}

/*
 * The absolute window is written as startTime/endTime by this module, but
 * the RUM overview's tiles link with start/end (buildRangedListRoute in
 * Pages/Rum/View/Overview.tsx). Both spellings are read so the window a
 * tile counted is the window the list opens on; only the canonical pair is
 * ever written.
 */
const START_TIME_URL_KEYS: Array<string> = [LIST_URL_KEYS.startTime, "start"];
const END_TIME_URL_KEYS: Array<string> = [LIST_URL_KEYS.endTime, "end"];

function readFirstParam(
  params: URLSearchParams,
  keys: Array<string>,
): string | null {
  for (const key of keys) {
    const value: string | null = params.get(key);

    if (value) {
      return value;
    }
  }

  return null;
}

function isTimeRangeValue(value: string | null): value is TimeRange {
  return (
    value !== null &&
    (Object.values(TimeRange) as Array<string>).includes(value) &&
    value !== TimeRange.CUSTOM
  );
}

/*
 * Time range from the query string. An absolute startTime/endTime pair
 * wins over a named range so an incident can link "sessions during this
 * window"; a named range is honoured on its own; anything else is the
 * default window.
 */
export function readTimeRangeFromSearch(
  search: string,
): RangeStartAndEndDateTime {
  const params: URLSearchParams = new URLSearchParams(search);
  const startTime: Date | null = parseIsoDate(
    readFirstParam(params, START_TIME_URL_KEYS),
  );
  const endTime: Date | null = parseIsoDate(
    readFirstParam(params, END_TIME_URL_KEYS),
  );

  if (startTime && endTime && startTime.getTime() < endTime.getTime()) {
    return {
      range: TimeRange.CUSTOM,
      startAndEndDate: new InBetween<Date>(startTime, endTime),
    };
  }

  const range: string | null = params.get(LIST_URL_KEYS.range);

  if (isTimeRangeValue(range)) {
    return { range: range };
  }

  return DEFAULT_SESSION_REPLAY_TIME_RANGE;
}

export function readListStateFromSearch(
  search: string,
): SessionReplayListUrlState {
  const params: URLSearchParams = new URLSearchParams(search);

  const advanced: SessionReplayAdvancedFilters = { ...EMPTY_ADVANCED_FILTERS };

  for (const field of Object.keys(FILTER_URL_KEYS) as Array<
    keyof SessionReplayAdvancedFilters
  >) {
    const key: string | undefined = FILTER_URL_KEYS[field];

    /* Fields deliberately kept out of the URL - see FILTER_URL_KEYS. */
    if (!key) {
      continue;
    }

    if (field === "tags") {
      /* One `tag=key=value` param per pair; joined back into the text form. */
      advanced.tags = params
        .getAll(key)
        .map((value: string): string => {
          return value.trim();
        })
        .filter((value: string): boolean => {
          return value.length > 0;
        })
        .join(", ");
      continue;
    }

    advanced[field] = params.get(key) || "";
  }

  const signal: string = params.get(LIST_URL_KEYS.signal) || "all";
  const sort: string | null = params.get(LIST_URL_KEYS.sort);
  const page: number = parseInt(params.get(LIST_URL_KEYS.page) || "1", 10);

  return {
    signal: SESSION_REPLAY_SIGNALS.includes(signal) ? signal : "all",
    advanced: advanced,
    sortBy: isSessionReplaySortBy(sort) ? sort : DEFAULT_SESSION_REPLAY_SORT_BY,
    timeRange: readTimeRangeFromSearch(search),
    page: Number.isFinite(page) && page > 1 ? Math.floor(page) : 1,
  };
}

/* The original reader, kept for callers that only want the filters. */
export function readFiltersFromSearch(search: string): {
  signal: string;
  advanced: SessionReplayAdvancedFilters;
} {
  const state: SessionReplayListUrlState = readListStateFromSearch(search);

  return { signal: state.signal, advanced: state.advanced };
}

export interface SessionReplayListUrlExtras {
  sortBy?: SessionReplaySortBy | undefined;
  timeRange?: RangeStartAndEndDateTime | undefined;
  page?: number | undefined;
}

/*
 * The given href with the list state stamped into its query string.
 * Pure — the caller owns history.replaceState — so a round trip is
 * testable without a browser. Defaults are written as ABSENCE so a
 * pristine list has a clean URL.
 */
export function buildFilteredUrl(
  href: string,
  signal: string,
  advanced: SessionReplayAdvancedFilters,
  extras?: SessionReplayListUrlExtras,
): string {
  const url: URL = new URL(href);

  if (signal && signal !== "all") {
    url.searchParams.set(LIST_URL_KEYS.signal, signal);
  } else {
    url.searchParams.delete(LIST_URL_KEYS.signal);
  }

  for (const field of Object.keys(FILTER_URL_KEYS) as Array<
    keyof SessionReplayAdvancedFilters
  >) {
    const key: string | undefined = FILTER_URL_KEYS[field];

    if (!key) {
      continue;
    }

    const value: string = advanced[field].trim();

    url.searchParams.delete(key);

    if (!value) {
      continue;
    }

    if (field === "tags") {
      const tags: Record<string, string> = parseTagFilter(value);

      for (const tagKey of Object.keys(tags)) {
        url.searchParams.append(key, `${tagKey}=${tags[tagKey]}`);
      }

      continue;
    }

    url.searchParams.set(key, value);
  }

  if (extras?.sortBy && extras.sortBy !== DEFAULT_SESSION_REPLAY_SORT_BY) {
    url.searchParams.set(LIST_URL_KEYS.sort, extras.sortBy);
  } else {
    url.searchParams.delete(LIST_URL_KEYS.sort);
  }

  url.searchParams.delete(LIST_URL_KEYS.range);

  /*
   * Both spellings go, including the overview tile's start/end: leaving an
   * alias behind would let a stale window win the next time this URL is
   * read back (readTimeRangeFromSearch accepts either).
   */
  for (const key of [...START_TIME_URL_KEYS, ...END_TIME_URL_KEYS]) {
    url.searchParams.delete(key);
  }

  if (extras?.timeRange) {
    if (
      extras.timeRange.range === TimeRange.CUSTOM &&
      extras.timeRange.startAndEndDate
    ) {
      url.searchParams.set(
        LIST_URL_KEYS.startTime,
        extras.timeRange.startAndEndDate.startValue.toISOString(),
      );
      url.searchParams.set(
        LIST_URL_KEYS.endTime,
        extras.timeRange.startAndEndDate.endValue.toISOString(),
      );
    } else if (
      extras.timeRange.range !== DEFAULT_SESSION_REPLAY_TIME_RANGE.range &&
      extras.timeRange.range !== TimeRange.CUSTOM
    ) {
      url.searchParams.set(LIST_URL_KEYS.range, extras.timeRange.range);
    }
  }

  if (extras?.page && extras.page > 1) {
    url.searchParams.set(LIST_URL_KEYS.page, String(Math.floor(extras.page)));
  } else {
    url.searchParams.delete(LIST_URL_KEYS.page);
  }

  return url.toString();
}

/*
 * ---- Cursor memory ----
 *
 * Keyset pagination has no skip: page 3 is only reachable through the
 * cursor page 2 returned. A URL that says page=3 is therefore only
 * honourable when the cursors learned under the SAME query are still
 * around, which is what the table stores in sessionStorage on every page
 * change. The memory key folds in everything that changes the ordering or
 * the result set; a mismatch means "start from page 1".
 */
export interface SessionReplayCursorMemory {
  key: string;
  cursors: Array<[number, SessionReplayListCursorDto]>;
}

export function buildCursorMemoryKey(input: {
  rumApplicationId: string;
  signal: string;
  advanced: SessionReplayAdvancedFilters;
  sortBy: SessionReplaySortBy;
  timeRange: RangeStartAndEndDateTime;
  itemsOnPage: number;
}): string {
  return JSON.stringify({
    app: input.rumApplicationId,
    signal: input.signal,
    filters: buildSessionReplayListFilters(input.signal, input.advanced),
    sortBy: input.sortBy,
    range: input.timeRange.range,
    start: input.timeRange.startAndEndDate?.startValue.toISOString() ?? null,
    end: input.timeRange.startAndEndDate?.endValue.toISOString() ?? null,
    itemsOnPage: input.itemsOnPage,
  });
}

export function serializeCursorMemory(
  memory: SessionReplayCursorMemory,
): string {
  return JSON.stringify(memory);
}

/*
 * Reads a memory back, dropping anything malformed: every cursor is
 * re-validated through the shared parser so a stale shape from an older
 * build cannot be echoed to the server (a cursor for another ordering is a
 * 400 there).
 */
export function parseCursorMemory(
  raw: string | null,
  expectedKey: string,
): Map<number, SessionReplaySortedListCursorDto> {
  const cursors: Map<number, SessionReplaySortedListCursorDto> = new Map<
    number,
    SessionReplaySortedListCursorDto
  >();

  if (!raw) {
    return cursors;
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(raw);
  } catch {
    return cursors;
  }

  if (parsed === null || typeof parsed !== "object") {
    return cursors;
  }

  const memory: Record<string, unknown> = parsed as Record<string, unknown>;

  if (memory["key"] !== expectedKey || !Array.isArray(memory["cursors"])) {
    return cursors;
  }

  for (const entry of memory["cursors"] as Array<unknown>) {
    if (!Array.isArray(entry) || entry.length !== 2) {
      continue;
    }

    const page: number = Number(entry[0]);
    const cursor: SessionReplaySortedListCursorDto | null =
      parseSessionReplayListCursor(entry[1]);

    if (Number.isFinite(page) && page >= 1 && cursor !== null) {
      cursors.set(page, cursor);
    }
  }

  return cursors;
}
