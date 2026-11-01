import {
  readDtoBoolean,
  readDtoNumber,
  readDtoString,
} from "./SessionReplayApi";

/*
 * Wire contract for the User Flows page:
 * POST /telemetry/rum/session-replay/user-flow.
 *
 * The endpoint answers with the ordered page JOURNEY of each recorded
 * session in the window, not with a finished graph. Every view on the page -
 * the flow map from the session start, the paths into or out of one page,
 * grouping /product/8842 as /product/:id, hiding a page, filtering to
 * frustrated sessions - is then a pure fold over the same journeys
 * (Common/Utils/Rum/UserFlow.ts), so a control change re-draws instantly
 * instead of re-running a ClickHouse read.
 *
 * Pages travel as a dictionary: `pages` holds each distinct scrubbed URL
 * once and a journey is a list of indexes into it. A few thousand sessions
 * share a few dozen pages, so this is what keeps the response small.
 *
 * The read can be narrowed to one person - a user, a browser or a session -
 * with a filter from USER_FLOW_PERSON_FILTER_KEYS. It has to be the server
 * that narrows it: the response holds only the newest sessions of the
 * window, so a person's sessions may not be in the everyone read at all, and
 * that read names nobody. Only a narrowed read carries a session's `detail`.
 */

/*
 * Newest sessions read per request. The journeys of this many sessions fit
 * in a response of a few hundred kilobytes, and a flow map drawn from them
 * is already stable; the response says when the window held more.
 */
export const USER_FLOW_DEFAULT_MAX_SESSIONS: number = 5000;
export const USER_FLOW_MAX_SESSIONS: number = 10000;

/*
 * Pages kept per journey. A session that navigates more than this is still
 * counted; its tail is dropped, and the page it ended on is kept apart in
 * `exitPage`. Far more than any flow map draws.
 */
export const USER_FLOW_MAX_PAGES_PER_JOURNEY: number = 100;

/*
 * The filters that narrow the read to one person, on the body's `filters`.
 * One at most: each names a person, and two would be a question with no
 * single answer.
 *
 *   identifier         what someone typed: a user reference, a visitor id or
 *                      a session id, whichever it turns out to be. Matches
 *                      exactly. Never written in a URL (see the page's
 *                      UserFlowUrlState): a reference is typically an email.
 *   identifiedUserKey  the pseudonymous digest a link carries.
 *   visitorId          every session from one browser.
 *   sessionId          one session.
 */
export const USER_FLOW_PERSON_FILTER_KEYS: ReadonlyArray<string> = [
  "identifier",
  "identifiedUserKey",
  "visitorId",
  "sessionId",
];

/*
 * Named in `ignoredFilters` when the caller's role may not look people up by
 * their reference: the identifier was not tried as one. The session list's
 * name for the same refusal.
 */
export const USER_FLOW_IGNORED_USER_REFERENCE: string = "identifiedUserRef";

/*
 * What only one person's journeys need: who the session belongs to, so a
 * page can say so, and whether there is footage to send anyone to.
 */
export interface UserFlowSessionDetailDto {
  /* The pseudonymous digest. Empty when the session named nobody. */
  identifiedUserKey: string;
  /* Empty from a recorder that predates visitor ids. */
  visitorId: string;
  /* Absent unless the caller's role may read end-user identity. */
  identifiedUserLabel?: string | undefined;
  isFinalized: boolean;
  /* Every tab has ended; only the finalizer's counting is pending. */
  hasRecordingEnded: boolean;
  sealedReason: string;
  chunkCount: number;
}

/* One recorded session, reduced to what the flow map needs. */
export interface UserFlowSessionDto {
  sessionId: string;
  startUnixMs: number;
  durationMs: number;
  deviceType: string;
  browserName: string;
  countryCode: string;
  /* Session totals, from the header. */
  errorCount: number;
  frustrationCount: number;
  /*
   * The pages visited, in order, as indexes into the response's `pages`.
   * A page repeated back to back (a reload, a chunk boundary) appears once;
   * a return to a page after another one appears again.
   */
  pages: Array<number>;
  /*
   * Where the session's errors and frustration signals happened, as
   * [pageIndex, errorCount, frustrationCount]. Attributed to the page a
   * recording chunk was flushed from, so it is per page, never per visit.
   * Pages with nothing to report are left out.
   */
  pageSignals: Array<[number, number, number]>;
  /*
   * Only when `pages` was cut: the page the session really ended on, as an
   * index into the response's `pages`.
   */
  exitPage?: number | undefined;
  /* Only on a read narrowed to one person. */
  detail?: UserFlowSessionDetailDto | undefined;
}

export interface UserFlowJourneysResponseDto {
  /* Distinct scrubbed page URLs ("https://shop.example.com/cart"). */
  pages: Array<string>;
  /* Newest first. */
  sessions: Array<UserFlowSessionDto>;
  /* Recorded sessions that started in the window. */
  sessionsInWindow: number;
  /* True when sessionsInWindow is larger than the sessions returned. */
  isSampled: boolean;
  maxSessions: number;
  startUnixMs: number;
  endUnixMs: number;
  /*
   * Filters understood but not applied for this caller, so "no sessions" can
   * be told apart from "you may not ask that". Empty when all were applied.
   */
  ignoredFilters: Array<string>;
}

function readIndexArray(value: unknown, pageCount: number): Array<number> {
  if (!Array.isArray(value)) {
    return [];
  }

  const indexes: Array<number> = [];

  for (const entry of value) {
    const index: number = Number(entry);

    if (Number.isInteger(index) && index >= 0 && index < pageCount) {
      indexes.push(index);
    }
  }

  return indexes;
}

function readSignalTriples(
  value: unknown,
  pageCount: number,
): Array<[number, number, number]> {
  if (!Array.isArray(value)) {
    return [];
  }

  const triples: Array<[number, number, number]> = [];

  for (const entry of value) {
    if (!Array.isArray(entry) || entry.length < 3) {
      continue;
    }

    const index: number = Number(entry[0]);
    const errors: number = Number(entry[1]);
    const frustration: number = Number(entry[2]);

    if (!Number.isInteger(index) || index < 0 || index >= pageCount) {
      continue;
    }

    triples.push([
      index,
      Number.isFinite(errors) && errors > 0 ? errors : 0,
      Number.isFinite(frustration) && frustration > 0 ? frustration : 0,
    ]);
  }

  return triples;
}

/* An index into the dictionary, or undefined: an optional page never guesses. */
function readPageIndex(value: unknown, pageCount: number): number | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  const index: number = Number(value);

  return Number.isInteger(index) && index >= 0 && index < pageCount
    ? index
    : undefined;
}

function readSessionDetail(
  value: unknown,
): UserFlowSessionDetailDto | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const detail: Record<string, unknown> = value as Record<string, unknown>;
  const label: unknown = detail["identifiedUserLabel"];

  return {
    identifiedUserKey: readDtoString(detail, "identifiedUserKey"),
    visitorId: readDtoString(detail, "visitorId"),
    /*
     * Absent stays absent: it means "not for your role", which an empty
     * label ("nobody was identified") must never read as.
     */
    ...(label === undefined || label === null
      ? {}
      : { identifiedUserLabel: readDtoString(detail, "identifiedUserLabel") }),
    isFinalized: readDtoBoolean(detail, "isFinalized"),
    hasRecordingEnded: readDtoBoolean(detail, "hasRecordingEnded"),
    sealedReason: readDtoString(detail, "sealedReason"),
    chunkCount: readDtoNumber(detail, "chunkCount"),
  };
}

/*
 * Parses the endpoint's JSON without trusting it: an index outside the
 * dictionary is dropped rather than rendered as "undefined", and every
 * number is coerced because ClickHouse quotes 64-bit integers.
 */
export function readUserFlowJourneysResponse(
  value: unknown,
): UserFlowJourneysResponseDto {
  const row: Record<string, unknown> =
    value && typeof value === "object"
      ? (value as Record<string, unknown>)
      : {};

  const pages: Array<string> = Array.isArray(row["pages"])
    ? (row["pages"] as Array<unknown>).map((page: unknown): string => {
        return typeof page === "string" ? page : String(page ?? "");
      })
    : [];

  const sessions: Array<UserFlowSessionDto> = [];

  if (Array.isArray(row["sessions"])) {
    for (const entry of row["sessions"] as Array<unknown>) {
      if (!entry || typeof entry !== "object") {
        continue;
      }

      const session: Record<string, unknown> = entry as Record<string, unknown>;
      const sessionId: string = readDtoString(session, "sessionId");

      if (!sessionId) {
        continue;
      }

      const exitPage: number | undefined = readPageIndex(
        session["exitPage"],
        pages.length,
      );
      const detail: UserFlowSessionDetailDto | undefined = readSessionDetail(
        session["detail"],
      );

      sessions.push({
        sessionId: sessionId,
        startUnixMs: readDtoNumber(session, "startUnixMs"),
        durationMs: readDtoNumber(session, "durationMs"),
        deviceType: readDtoString(session, "deviceType"),
        browserName: readDtoString(session, "browserName"),
        countryCode: readDtoString(session, "countryCode"),
        errorCount: readDtoNumber(session, "errorCount"),
        frustrationCount: readDtoNumber(session, "frustrationCount"),
        pages: readIndexArray(session["pages"], pages.length),
        pageSignals: readSignalTriples(session["pageSignals"], pages.length),
        ...(exitPage === undefined ? {} : { exitPage: exitPage }),
        ...(detail ? { detail: detail } : {}),
      });
    }
  }

  return {
    pages: pages,
    sessions: sessions,
    sessionsInWindow: readDtoNumber(row, "sessionsInWindow"),
    isSampled: readDtoBoolean(row, "isSampled"),
    maxSessions: readDtoNumber(row, "maxSessions"),
    startUnixMs: readDtoNumber(row, "startUnixMs"),
    endUnixMs: readDtoNumber(row, "endUnixMs"),
    ignoredFilters: Array.isArray(row["ignoredFilters"])
      ? (row["ignoredFilters"] as Array<unknown>).filter(
          (filter: unknown): filter is string => {
            return typeof filter === "string";
          },
        )
      : [],
  };
}
