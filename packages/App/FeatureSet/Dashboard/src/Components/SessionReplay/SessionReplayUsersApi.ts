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
  readDtoNumber,
  readDtoOptionalNumber,
  readDtoString,
  readDtoStringMap,
  SessionReplayUserKind,
  SessionReplayUsersCursorDto,
} from "Common/Types/Rum/SessionReplayApi";

/*
 * The client half of /telemetry/rum/session-replay/users: the session list
 * rolled up by person. See the /users section of
 * Common/Types/Rum/SessionReplayApi.ts for the contract; this module reads
 * the untyped body back with the same defensive readers the list uses,
 * because the route answers a hand-written ClickHouse projection in which
 * 64-bit counters arrive as strings and any field may be absent on a
 * server mid-rollout.
 */

export const SESSION_REPLAY_USERS_ROUTE: string =
  "/telemetry/rum/session-replay/users";

/* One row per person: an identified user, a linked browser, or the anonymous bucket. */
export interface SessionReplayUserRollup {
  /* "u:<key>", "v:<visitorId>", or "" for the anonymous bucket. Opaque. */
  groupKey: string;
  kind: SessionReplayUserKind;
  identifiedUserKey: string;
  visitorId: string;
  /* Present only for roles with the identity permission. */
  identifiedUserLabel?: string | undefined;
  identifiedUserTraits?: Record<string, string> | undefined;
  /*
   * Whether the identity column was in the payload at all, exactly as the
   * list decides it: an absent label on an identified group means "hidden
   * from you", never "anonymous".
   */
  isIdentityVisible: boolean;
  sessionCount: number;
  liveSessionCount: number;
  firstSeenUnixMs: number;
  lastSeenUnixMs: number;
  totalDurationMs: number;
  errorCount: number;
  frustrationCount: number;
  errorSessionCount: number;
  pageCount: number;
  lastSessionId: string;
  lastEntryUrl: string;
  browserName: string;
  browserVersion: string;
  osName: string;
  deviceType: string;
  countryCode: string;
}

export interface SessionReplayUsersResult {
  users: Array<SessionReplayUserRollup>;
  /* Null on the last page; there is no total, only prev/next. */
  nextCursor: SessionReplayUsersCursorDto | null;
}

const USER_KINDS: ReadonlyArray<SessionReplayUserKind> = [
  "identified",
  "visitor",
  "anonymous",
];

/*
 * The group kind, from the server's own field when it sends one, else from
 * the group key's prefix. The prefix is part of the contract ("u:", "v:",
 * "") so a server that predates the kind column still rolls up correctly.
 */
export function readUserRollupKind(
  row: Record<string, unknown>,
): SessionReplayUserKind {
  const kind: unknown = row["kind"];

  if (
    typeof kind === "string" &&
    (USER_KINDS as ReadonlyArray<string>).includes(kind)
  ) {
    return kind as SessionReplayUserKind;
  }

  const groupKey: string = readDtoString(row, "groupKey");

  if (groupKey.startsWith("u:")) {
    return "identified";
  }

  if (groupKey.startsWith("v:")) {
    return "visitor";
  }

  return "anonymous";
}

export function parseSessionReplayUserRollup(
  row: JSONObject,
): SessionReplayUserRollup {
  const record: Record<string, unknown> = row as Record<string, unknown>;

  return {
    groupKey: readDtoString(record, "groupKey"),
    kind: readUserRollupKind(record),
    identifiedUserKey: readDtoString(record, "identifiedUserKey"),
    visitorId: readDtoString(record, "visitorId"),
    identifiedUserLabel:
      record["identifiedUserLabel"] === undefined ||
      record["identifiedUserLabel"] === null
        ? undefined
        : readDtoString(record, "identifiedUserLabel"),
    identifiedUserTraits:
      record["identifiedUserTraits"] === undefined ||
      record["identifiedUserTraits"] === null
        ? undefined
        : readDtoStringMap(record, "identifiedUserTraits"),
    isIdentityVisible:
      record["identifiedUserLabel"] !== undefined &&
      record["identifiedUserLabel"] !== null,
    sessionCount: readDtoNumber(record, "sessionCount"),
    liveSessionCount: readDtoNumber(record, "liveSessionCount"),
    firstSeenUnixMs: readDtoNumber(record, "firstSeenUnixMs"),
    lastSeenUnixMs: readDtoNumber(record, "lastSeenUnixMs"),
    totalDurationMs: readDtoNumber(record, "totalDurationMs"),
    errorCount: readDtoNumber(record, "errorCount"),
    frustrationCount: readDtoNumber(record, "frustrationCount"),
    errorSessionCount: readDtoNumber(record, "errorSessionCount"),
    pageCount: readDtoNumber(record, "pageCount"),
    lastSessionId: readDtoString(record, "lastSessionId"),
    lastEntryUrl: readDtoString(record, "lastEntryUrl"),
    browserName: readDtoString(record, "browserName"),
    browserVersion: readDtoString(record, "browserVersion"),
    osName: readDtoString(record, "osName"),
    deviceType: readDtoString(record, "deviceType"),
    countryCode: readDtoString(record, "countryCode"),
  };
}

/*
 * The cursor off an untyped body, or null. Both halves have to be there:
 * the server refuses a cursor with an empty tiebreak, and a lastSeen of 0
 * would page from the epoch.
 */
export function parseSessionReplayUsersCursor(
  value: unknown,
): SessionReplayUsersCursorDto | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const row: Record<string, unknown> = value as Record<string, unknown>;
  const lastSeenUnixMs: number | undefined = readDtoOptionalNumber(
    row,
    "lastSeenUnixMs",
  );
  const groupKey: unknown = row["groupKey"];

  /*
   * The anonymous bucket's group key is "" and it is a real row, so an
   * empty string is a valid tiebreak here - which is why this reads the
   * raw field rather than readDtoOptionalString (empty -> undefined).
   */
  if (lastSeenUnixMs === undefined || typeof groupKey !== "string") {
    return null;
  }

  return { lastSeenUnixMs: lastSeenUnixMs, groupKey: groupKey };
}

export async function fetchSessionReplayUsers(request: {
  rumApplicationId: ObjectID;
  startTime: Date;
  endTime: Date;
  limit: number;
  cursor?: SessionReplayUsersCursorDto | undefined;
}): Promise<SessionReplayUsersResult> {
  const response: HTTPResponse<JSONObject> | HTTPErrorResponse = await API.post(
    {
      url: URL.fromString(APP_API_URL.toString()).addRoute(
        SESSION_REPLAY_USERS_ROUTE,
      ),
      data: {
        rumApplicationId: request.rumApplicationId.toString(),
        startTime: OneUptimeDate.toString(request.startTime),
        endTime: OneUptimeDate.toString(request.endTime),
        limit: request.limit,
        /*
         * Echoed verbatim, like the list's: the server owns the cursor
         * shape. Spread into a plain object because a declared interface
         * has no index signature to satisfy JSONObject.
         */
        ...(request.cursor
          ? { cursor: { ...request.cursor } as JSONObject }
          : {}),
      },
      headers: {
        ...ModelAPI.getCommonHeaders(),
      },
    },
  );

  if (response instanceof HTTPErrorResponse) {
    throw response;
  }

  const rows: JSONArray = (response.data["users"] as JSONArray) || [];

  return {
    users: rows.map((row: JSONObject): SessionReplayUserRollup => {
      return parseSessionReplayUserRollup(row);
    }),
    nextCursor: parseSessionReplayUsersCursor(response.data["nextCursor"]),
  };
}
