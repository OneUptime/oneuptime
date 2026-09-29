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
 * counted; its tail is dropped. Far more than any flow map draws.
 */
export const USER_FLOW_MAX_PAGES_PER_JOURNEY: number = 100;

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
  };
}
