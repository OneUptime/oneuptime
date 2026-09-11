import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import { APP_API_URL } from "Common/UI/Config";
import URL from "Common/Types/API/URL";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import { JSONArray, JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import OneUptimeDate from "Common/Types/Date";
import {
  readDtoBoolean,
  readDtoNumber,
  readDtoString,
  readDtoUnixMs,
} from "Common/Types/Rum/SessionReplayApi";
import { formatReplayDuration } from "./ReplayTimeFormat";

/*
 * "This user's other sessions", for the player's header
 * (github.com/OneUptime/oneuptime/issues/3705).
 *
 * A support engineer watching one recording almost always wants the one
 * before it ("what did they do last time?") or the one after ("did the
 * fix take?"). Until now that meant going back to the list, finding the
 * user filter, and re-opening - three page loads to move one step. The
 * manifest header now carries the two keys the list can group by, the
 * pseudonymous identity digest and the recorder's per-browser visitor
 * id, and this module turns them into a sorted list of sibling sessions
 * the header can offer as a menu and as older/newer buttons.
 *
 * Everything but fetchReplayUserSessions is pure and runs under node, so
 * the window arithmetic, the merge and the copy are tested without a
 * DOM. The module is deliberately independent of the list page's own
 * parser (SessionReplayTable / SessionReplaySearchQuery): those files
 * change with the list's filters and facets, and the player must not
 * take a dependency that pulls the whole table into its chunk.
 */

/* The same read route the list page calls; the filters differ, the shape does not. */
export const REPLAY_USER_SESSIONS_LIST_ROUTE: string =
  "/telemetry/rum/session-replay/list";

/*
 * Rows per request. Per key, one page of older sessions and up to
 * REPLAY_USER_SESSIONS_MAX_PAGES of newer ones, so the dropdown tops out
 * in the low hundreds - beyond that a person's history is a list page
 * problem, not a dropdown's.
 */
export const REPLAY_USER_SESSIONS_LIMIT: number = 50;

/*
 * How many pages the newer side may walk towards the watched session
 * (fetchReplayUserSessions) before giving up and reporting the list as
 * truncated. Four pages is two hundred sessions after the one being
 * watched - a very active user, or a shared kiosk browser - and the cap
 * is what keeps one dropdown from issuing an unbounded run of requests.
 */
export const REPLAY_USER_SESSIONS_MAX_PAGES: number = 4;

/*
 * How far back from the session's own start the lookup reaches. Thirty
 * days covers a person's recent history - what "the one before this" and
 * "did the fix take" are about - without asking ClickHouse to aggregate a
 * quarter of an application's headers for one dropdown; retention can be
 * configured up to 90 days (SESSION_REPLAY_ALLOWED_RETENTION_DAYS), and
 * anything older than the window stays reachable through the list's user
 * and visitor filters, which the header copy points at.
 */
export const REPLAY_USER_SESSIONS_WINDOW_MS: number = 30 * 24 * 60 * 60 * 1000;

/*
 * What the header needs of a sibling session: enough to pick it out of a
 * list (when, where it started, on what, how long) and enough to warn
 * (errors, still recording). The identity fields ride along so the
 * current session can be represented in the same shape without a
 * second type.
 */
export interface ReplayUserSessionItem {
  sessionId: string;
  startTimeUnixMs: number;
  durationMs: number;
  entryUrl: string;
  browserName: string;
  deviceType: string;
  hasError: boolean;
  errorCount: number;
  isFinalized: boolean;
  identifiedUserKey: string;
  visitorId: string;
  /* null when the caller lacks the identity permission (the field is absent). */
  identifiedUserLabel: string | null;
}

/*
 * Which key links this session to its siblings. "identified" wins over
 * "visitor" because identify() is the stronger statement: a person on
 * two browsers has two visitor ids and one identity, and following the
 * identity is what "this user's sessions" means. "none" is a session an
 * older recorder produced for a page that never identified anyone -
 * there is nothing to look up, and the header says so rather than
 * showing an empty menu.
 */
export type ReplayUserSessionsKind = "identified" | "visitor" | "none";

export function resolveReplayUserSessionsKind(args: {
  identifiedUserKey: string;
  visitorId: string;
}): ReplayUserSessionsKind {
  if (args.identifiedUserKey.length > 0) {
    return "identified";
  }

  if (args.visitorId.length > 0) {
    return "visitor";
  }

  return "none";
}

/* The shell's view of the lookup, as the header receives it. */
export interface ReplayUserSessionsState {
  status: "idle" | "loading" | "ready" | "error";
  kind: ReplayUserSessionsKind;
  /* Newest first; always contains the current session once ready. */
  sessions: Array<ReplayUserSessionItem>;
  currentSessionId: string;
  /*
   * The newer walk (fetchReplayUserSessions) hit its page cap before it
   * reached the session being watched: the sessions between the newest
   * fetched page and this one are unknown, so the "newer" neighbour is
   * the nearest FETCHED session rather than the nearest one, and the
   * header must not describe it as the next. The older side is never
   * affected - that request is anchored on the session, so its first
   * rows are the nearest older ones by construction.
   */
  isTruncated: boolean;
}

export interface ReplayUserSessionsWindow {
  /* Thirty days before the session started. */
  startTime: Date;
  /*
   * The session's own start: where the two requests split. OLDER runs
   * [startTime, anchorTime] and NEWER [anchorTime, endTime]; the server
   * treats both bounds as inclusive, so the session itself comes back
   * from both and the merge collapses it to one row.
   */
  anchorTime: Date;
  /* Now, or the session's start when the device clock ran ahead of ours. */
  endTime: Date;
}

/*
 * The three edges of the lookup: thirty days before THIS session started,
 * the session's own start, and now. Anchored on the session rather than
 * on now because a viewer opening a three-week-old recording wants the
 * sessions around it, not only the ones since - and because the two
 * requests split at the session (fetchReplayUserSessions), which is what
 * makes the older neighbour exact for a person with hundreds of sessions.
 * The end is never earlier than the session's own start (a device clock
 * that runs ahead of the server's could otherwise put the session outside
 * its own window), and a start the manifest could not supply falls back
 * to a window ending now, split at now as well.
 */
export function buildReplayUserSessionsWindow(
  startTimeUnixMs: number | null | undefined,
  nowUnixMs: number,
): ReplayUserSessionsWindow {
  const safeNow: number = Number.isFinite(nowUnixMs) ? nowUnixMs : Date.now();
  const anchor: number =
    typeof startTimeUnixMs === "number" && Number.isFinite(startTimeUnixMs)
      ? startTimeUnixMs
      : safeNow;

  return {
    startTime: new Date(anchor - REPLAY_USER_SESSIONS_WINDOW_MS),
    anchorTime: new Date(anchor),
    endTime: new Date(Math.max(safeNow, anchor)),
  };
}

/* ---- Row parsing. ---- */

/*
 * One list row, read defensively: the list is a hand-written ClickHouse
 * projection, so numbers may arrive as strings and any additive field
 * may be absent. A row without a session id is not a session and is
 * dropped by the caller.
 */
export function parseReplayUserSessionItem(
  row: Record<string, unknown>,
): ReplayUserSessionItem {
  /*
   * The numeric clock when the server sends it, the ISO string parsed
   * otherwise; 0 only when neither is readable, which sorts the row to
   * the bottom rather than throwing the whole menu away.
   */
  const startTimeUnixMs: number =
    readDtoUnixMs(row, "startTimeUnixMs") ??
    readDtoUnixMs(row, "startTime") ??
    0;

  /*
   * The label is served only behind the identity permission, so its
   * absence must stay distinguishable from an empty label - the same
   * rule the manifest parser applies.
   */
  const hasLabel: boolean = Object.prototype.hasOwnProperty.call(
    row,
    "identifiedUserLabel",
  );

  return {
    sessionId: readDtoString(row, "sessionId"),
    startTimeUnixMs: startTimeUnixMs,
    durationMs: readDtoNumber(row, "durationMs"),
    entryUrl: readDtoString(row, "entryUrl"),
    browserName: readDtoString(row, "browserName"),
    deviceType: readDtoString(row, "deviceType"),
    hasError: readDtoBoolean(row, "hasError"),
    errorCount: readDtoNumber(row, "errorCount"),
    isFinalized: readDtoBoolean(row, "isFinalized"),
    identifiedUserKey: readDtoString(row, "identifiedUserKey"),
    visitorId: readDtoString(row, "visitorId"),
    identifiedUserLabel: hasLabel
      ? readDtoString(row, "identifiedUserLabel")
      : null,
  };
}

/* The { sessions, nextCursor } body, as the items the header wants. */
export function parseReplayUserSessionsResponse(
  data: JSONObject,
): Array<ReplayUserSessionItem> {
  const rows: JSONArray = Array.isArray(data["sessions"])
    ? (data["sessions"] as JSONArray)
    : [];
  const items: Array<ReplayUserSessionItem> = [];

  for (const row of rows) {
    if (row === null || typeof row !== "object" || Array.isArray(row)) {
      continue;
    }

    const item: ReplayUserSessionItem = parseReplayUserSessionItem(
      row as Record<string, unknown>,
    );

    if (item.sessionId.length > 0) {
      items.push(item);
    }
  }

  return items;
}

/* ---- Pure list logic. ---- */

/*
 * Newest first, with the session id as the tiebreak so two sessions that
 * started in the same millisecond (a duplicated tab) keep one order
 * across renders and across the two requests that may both return them.
 */
function compareNewestFirst(
  a: ReplayUserSessionItem,
  b: ReplayUserSessionItem,
): number {
  if (a.startTimeUnixMs !== b.startTimeUnixMs) {
    return b.startTimeUnixMs - a.startTimeUnixMs;
  }

  return a.sessionId < b.sessionId ? -1 : a.sessionId > b.sessionId ? 1 : 0;
}

/*
 * The union of the per-key lists, with the session being watched
 * guaranteed present.
 *
 * Two lists because an identified user's sessions and a browser's
 * sessions overlap without coinciding: the same person identified on
 * one visit and anonymous on the next shows up under the key on one and
 * the visitor id on the other. A fetched row wins over `current` (the
 * manifest-built stand-in) because it is the fresher read - a live
 * session's row says whether it has since finalized - and `current` is
 * only inserted when no request returned it, which happens when the
 * session is too new for the list's index, too old for the window, or
 * further from now than the newer walk could page (isTruncated).
 */
export function mergeReplayUserSessions(
  lists: Array<Array<ReplayUserSessionItem>>,
  current: ReplayUserSessionItem,
): Array<ReplayUserSessionItem> {
  const byId: Map<string, ReplayUserSessionItem> = new Map<
    string,
    ReplayUserSessionItem
  >();

  for (const list of lists) {
    for (const item of list) {
      if (item.sessionId.length > 0 && !byId.has(item.sessionId)) {
        byId.set(item.sessionId, item);
      }
    }
  }

  if (current.sessionId.length > 0 && !byId.has(current.sessionId)) {
    byId.set(current.sessionId, current);
  }

  return Array.from(byId.values()).sort(compareNewestFirst);
}

export interface ReplayAdjacentUserSessions {
  /* The session that started after the current one; null at the newest end. */
  newer: ReplayUserSessionItem | null;
  /* The session that started before it; null at the oldest end. */
  older: ReplayUserSessionItem | null;
}

/*
 * The neighbours of the current session in a newest-first list, for the
 * older/newer buttons and the { / } keys. Both null when the current
 * session is not in the list at all - which the merge prevents, but a
 * caller passing an arbitrary id must get "nowhere to go", not the ends.
 */
export function findAdjacentUserSessions(
  sessions: Array<ReplayUserSessionItem>,
  currentSessionId: string,
): ReplayAdjacentUserSessions {
  const index: number = sessions.findIndex(
    (item: ReplayUserSessionItem): boolean => {
      return item.sessionId === currentSessionId;
    },
  );

  if (index < 0) {
    return { newer: null, older: null };
  }

  return {
    newer: index > 0 ? sessions[index - 1] ?? null : null,
    older: sessions[index + 1] ?? null,
  };
}

/* ---- Copy. ---- */

/*
 * pathname + search of an absolute URL, so a list of sessions from one
 * application reads "/checkout?step=2" rather than repeating the host on
 * every row; a value that is not a URL (a relative path, a route name)
 * is shown as it is. A local copy rather than the list page's pathOf:
 * see the module comment on why this file does not import the table.
 */
export function replayUserSessionPathOf(url: string): string {
  if (!url) {
    return "";
  }

  try {
    const parsed: globalThis.URL = new globalThis.URL(url);

    return `${parsed.pathname}${parsed.search}` || "/";
  } catch {
    return url;
  }
}

const MINUTE_MS: number = 60 * 1000;
const HOUR_MS: number = 60 * MINUTE_MS;
const DAY_MS: number = 24 * HOUR_MS;

/*
 * "5 minutes ago" against a SUPPLIED now, in the same voice as
 * OneUptimeDate.fromNow (moment's thresholds). Not fromNow itself: the
 * menu renders a whole list against one clock read, so every row agrees
 * about what "now" is, and the tests can pin the words without freezing
 * the process clock. A session that appears to start in the future (a
 * device clock ahead of the server's) reads "just now" rather than
 * "in 3 minutes", which would be a claim about the future no recording
 * can make.
 */
export function formatReplayUserSessionAge(
  startTimeUnixMs: number,
  nowUnixMs: number,
): string {
  const elapsedMs: number = nowUnixMs - startTimeUnixMs;

  if (!Number.isFinite(elapsedMs) || elapsedMs < 45 * 1000) {
    return "just now";
  }

  if (elapsedMs < 90 * 1000) {
    return "a minute ago";
  }

  if (elapsedMs < 45 * MINUTE_MS) {
    return `${Math.round(elapsedMs / MINUTE_MS)} minutes ago`;
  }

  if (elapsedMs < 90 * MINUTE_MS) {
    return "an hour ago";
  }

  if (elapsedMs < 22 * HOUR_MS) {
    return `${Math.round(elapsedMs / HOUR_MS)} hours ago`;
  }

  if (elapsedMs < 36 * HOUR_MS) {
    return "a day ago";
  }

  if (elapsedMs < 14 * DAY_MS) {
    return `${Math.round(elapsedMs / DAY_MS)} days ago`;
  }

  return `${Math.round(elapsedMs / (7 * DAY_MS))} weeks ago`;
}

export interface ReplayUserSessionDescription {
  /* "5 minutes ago" - the row's lead, what a viewer scans by. */
  when: string;
  /* The full local timestamp, under the relative one. */
  absolute: string;
  /* "4m 12s" */
  duration: string;
  /* Where the session started: "/checkout?step=2". */
  path: string;
  /* "Chrome · desktop"; "" when the row carries neither. */
  deviceHint: string;
}

export function describeReplayUserSession(
  item: ReplayUserSessionItem,
  nowUnixMs: number,
): ReplayUserSessionDescription {
  const hasStart: boolean =
    Number.isFinite(item.startTimeUnixMs) && item.startTimeUnixMs > 0;

  return {
    when: hasStart
      ? formatReplayUserSessionAge(item.startTimeUnixMs, nowUnixMs)
      : "Unknown time",
    absolute: hasStart
      ? OneUptimeDate.getDateAsLocalFormattedString(
          new Date(item.startTimeUnixMs),
          false,
          false,
          true,
        )
      : "Start time unavailable",
    duration: formatReplayDuration(item.durationMs),
    path: replayUserSessionPathOf(item.entryUrl),
    deviceHint: [item.browserName, item.deviceType]
      .filter((part: string): boolean => {
        return part.length > 0;
      })
      .join(" · "),
  };
}

/* ---- Transport. ---- */

export interface FetchReplayUserSessionsArgs {
  rumApplicationId: ObjectID | string;
  /*
   * The session being watched. The newer walk pages towards it and stops
   * the moment it appears, so the rows fetched are the ones between it
   * and now - see fetchReplayUserSessions.
   */
  sessionId: string;
  identifiedUserKey: string;
  visitorId: string;
  /* The three edges of the two requests: see ReplayUserSessionsWindow. */
  startTime: Date;
  anchorTime: Date;
  endTime: Date;
  limit?: number | undefined;
}

export interface ReplayUserSessionsFetchResult {
  /*
   * One list per key the session carries, the newer rows before the
   * older, for mergeReplayUserSessions - which is where the session
   * itself, returned by both requests, is collapsed to one row.
   */
  lists: Array<Array<ReplayUserSessionItem>>;
  /* See ReplayUserSessionsState.isTruncated. */
  isTruncated: boolean;
}

interface ReplayUserSessionsPage {
  items: Array<ReplayUserSessionItem>;
  /*
   * The server's cursor object, kept verbatim for the next request. The
   * server decides its shape (SessionReplayListCursorDto, in either of
   * its two spellings) and refuses one from another ordering, so nothing
   * here reads it, let alone rebuilds it - the list page echoes it the
   * same way.
   */
  nextCursor: JSONObject | null;
}

interface ReplayUserSessionsWalk {
  items: Array<ReplayUserSessionItem>;
  isTruncated: boolean;
}

/*
 * The cursor as the server sent it, or null when the response says this
 * was the last page - or does not say (an older server, a malformed
 * body), which must read as "no more pages" rather than as a cursor
 * worth echoing.
 */
export function readReplayUserSessionsCursor(
  data: JSONObject,
): JSONObject | null {
  const raw: unknown = data["nextCursor"];

  if (
    raw === null ||
    raw === undefined ||
    typeof raw !== "object" ||
    Array.isArray(raw)
  ) {
    return null;
  }

  return raw as JSONObject;
}

async function postList(body: JSONObject): Promise<ReplayUserSessionsPage> {
  const response: HTTPResponse<JSONObject> | HTTPErrorResponse = await API.post(
    {
      url: URL.fromString(APP_API_URL.toString()).addRoute(
        REPLAY_USER_SESSIONS_LIST_ROUTE,
      ),
      data: body,
      headers: {
        ...ModelAPI.getCommonHeaders(),
      },
    },
  );

  if (response instanceof HTTPErrorResponse) {
    throw response;
  }

  return {
    items: parseReplayUserSessionsResponse(response.data),
    nextCursor: readReplayUserSessionsCursor(response.data),
  };
}

/*
 * The sessions from the watched one up to now, newest first, fetched a
 * page at a time towards the watched session.
 *
 * The list has no ascending sort, so the first page of [session, now] is
 * the NEWEST fifty sessions of the range, not the fifty nearest this
 * one: for a person with more than a page of sessions after this one,
 * the watched session is not on it, and the nearest fetched session -
 * where the "newer" button would go - is some way past the real
 * neighbour. So the cursor is followed until the watched session shows
 * up, at which point the fetched rows are exactly the ones between it
 * and now. Capped at REPLAY_USER_SESSIONS_MAX_PAGES: past that the
 * caller reports the list as truncated and the header stops claiming
 * adjacency, rather than one dropdown issuing an unbounded run of
 * requests. A range that ends (a null cursor) before the session appears
 * is not truncation - every session in it was fetched; the watched
 * session is simply too new for the index, and the merge puts it in.
 */
async function walkNewerSessions(
  base: JSONObject,
  args: FetchReplayUserSessionsArgs,
): Promise<ReplayUserSessionsWalk> {
  const items: Array<ReplayUserSessionItem> = [];
  let cursor: JSONObject | null = null;

  for (let page: number = 0; page < REPLAY_USER_SESSIONS_MAX_PAGES; page++) {
    const result: ReplayUserSessionsPage = await postList({
      ...base,
      startTime: args.anchorTime.toISOString(),
      endTime: args.endTime.toISOString(),
      /* Echoed verbatim; see ReplayUserSessionsPage.nextCursor. */
      ...(cursor ? { cursor: cursor } : {}),
    });

    items.push(...result.items);

    const hasReachedWatchedSession: boolean = result.items.some(
      (item: ReplayUserSessionItem): boolean => {
        return item.sessionId === args.sessionId;
      },
    );

    if (hasReachedWatchedSession || result.nextCursor === null) {
      return { items: items, isTruncated: false };
    }

    cursor = result.nextCursor;
  }

  return { items: items, isTruncated: true };
}

/*
 * Both requests for one key, in parallel. The older side is one page:
 * [thirty days before, session start] newest first puts the nearest
 * older sessions at the top, so its first rows are the right neighbours
 * by construction, and paging it would only lengthen the dropdown.
 */
async function fetchAroundSession(
  base: JSONObject,
  args: FetchReplayUserSessionsArgs,
): Promise<ReplayUserSessionsWalk> {
  const [older, newer]: [ReplayUserSessionsPage, ReplayUserSessionsWalk] =
    await Promise.all([
      postList({
        ...base,
        startTime: args.startTime.toISOString(),
        endTime: args.anchorTime.toISOString(),
      }),
      walkNewerSessions(base, args),
    ]);

  return {
    items: [...newer.items, ...older.items],
    isTruncated: newer.isTruncated,
  };
}

/*
 * The sessions around the watched one, per key the session carries, in
 * parallel: the identified user's and the browser's. Neither filter is
 * identity-gated (both keys are random tokens the list already returns
 * to every caller), so a viewer who may watch the recording may always
 * ask for its siblings.
 *
 * Two requests per key rather than one. A single newest-first page of
 * [thirty days before, now] holds the fifty newest sessions of the
 * range, and for a person with more than that after the watched one it
 * did not hold the watched session at all: the merge then appended it at
 * the very end, "Older" was disabled with the claim that this was the
 * oldest session in the window - false - and the dropdown showed no
 * older neighbour. Anchoring each request on the session's own start
 * (ReplayUserSessionsWindow) makes the older side exact and lets the
 * newer side page towards the session (walkNewerSessions). Bounded: at
 * most 1 + REPLAY_USER_SESSIONS_MAX_PAGES requests per key.
 *
 * Returns the raw per-key lists for mergeReplayUserSessions; an HTTP
 * failure on any request throws, and the shell shows "couldn't load"
 * rather than a half list presented as the whole.
 */
export async function fetchReplayUserSessions(
  args: FetchReplayUserSessionsArgs,
): Promise<ReplayUserSessionsFetchResult> {
  const requests: Array<Promise<ReplayUserSessionsWalk>> = [];
  const base: JSONObject = {
    rumApplicationId: args.rumApplicationId.toString(),
    limit: args.limit ?? REPLAY_USER_SESSIONS_LIMIT,
  };

  if (args.identifiedUserKey.length > 0) {
    requests.push(
      fetchAroundSession(
        { ...base, filters: { identifiedUserKey: args.identifiedUserKey } },
        args,
      ),
    );
  }

  if (args.visitorId.length > 0) {
    requests.push(
      fetchAroundSession(
        { ...base, filters: { visitorId: args.visitorId } },
        args,
      ),
    );
  }

  const walks: Array<ReplayUserSessionsWalk> = await Promise.all(requests);

  return {
    lists: walks.map(
      (walk: ReplayUserSessionsWalk): Array<ReplayUserSessionItem> => {
        return walk.items;
      },
    ),
    isTruncated: walks.some((walk: ReplayUserSessionsWalk): boolean => {
      return walk.isTruncated;
    }),
  };
}
