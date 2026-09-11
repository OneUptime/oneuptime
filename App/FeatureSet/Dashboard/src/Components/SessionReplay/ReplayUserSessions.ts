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
 * Rows per request. Two requests at most (one per key), so the menu tops
 * out at a hundred sessions - beyond that a person's history is a list
 * page problem, not a dropdown's.
 */
export const REPLAY_USER_SESSIONS_LIMIT: number = 50;

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
}

export interface ReplayUserSessionsWindow {
  startTime: Date;
  endTime: Date;
}

/*
 * The time range the list is asked for: thirty days before THIS session
 * started, up to now. Anchored on the session rather than on now because
 * a viewer opening a three-week-old recording wants the sessions around
 * it, not only the ones since. The end is never earlier than the
 * session's own start (a device clock that runs ahead of the server's
 * could otherwise put the session outside its own window), and a start
 * the manifest could not supply falls back to a window ending now.
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
 * only inserted when neither request returned it, which happens when
 * the session is too new for the list's index or too old for the
 * window.
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
    newer: index > 0 ? (sessions[index - 1] ?? null) : null,
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
  identifiedUserKey: string;
  visitorId: string;
  startTime: Date;
  endTime: Date;
  limit?: number | undefined;
}

async function postList(
  body: JSONObject,
): Promise<Array<ReplayUserSessionItem>> {
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

  return parseReplayUserSessionsResponse(response.data);
}

/*
 * One list request per key the session carries, in parallel: the
 * identified user's sessions and the browser's sessions. Neither filter
 * is identity-gated (both keys are random tokens the list already
 * returns to every caller), so a viewer who may watch the recording may
 * always ask for its siblings. Returns the raw per-key lists for
 * mergeReplayUserSessions; an HTTP failure on either throws, and the
 * shell shows "couldn't load" rather than a half list presented as the
 * whole.
 */
export async function fetchReplayUserSessions(
  args: FetchReplayUserSessionsArgs,
): Promise<Array<Array<ReplayUserSessionItem>>> {
  const requests: Array<Promise<Array<ReplayUserSessionItem>>> = [];
  const base: JSONObject = {
    rumApplicationId: args.rumApplicationId.toString(),
    startTime: args.startTime.toISOString(),
    endTime: args.endTime.toISOString(),
    limit: args.limit ?? REPLAY_USER_SESSIONS_LIMIT,
  };

  if (args.identifiedUserKey.length > 0) {
    requests.push(
      postList({
        ...base,
        filters: { identifiedUserKey: args.identifiedUserKey },
      }),
    );
  }

  if (args.visitorId.length > 0) {
    requests.push(
      postList({
        ...base,
        filters: { visitorId: args.visitorId },
      }),
    );
  }

  return await Promise.all(requests);
}
