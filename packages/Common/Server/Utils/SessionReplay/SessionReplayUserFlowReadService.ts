import { SQL, Statement } from "../AnalyticsDatabase/Statement";
import { getQuerySettings } from "../AnalyticsDatabase/QuerySettingsHelper";
import RumSessionService from "../../Services/RumSessionService";
import RumSessionChunkService from "../../Services/RumSessionChunkService";
import {
  DbJSONResponse,
  Results,
} from "../../Services/AnalyticsDatabaseService";
import SessionReplayIdentity from "./SessionReplayIdentity";
import SessionReplayReadService from "./SessionReplayReadService";
import AnalyticsTableName from "../../../Types/AnalyticsDatabase/AnalyticsTableName";
import TableColumnType from "../../../Types/AnalyticsDatabase/TableColumnType";
import BadDataException from "../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import { SESSION_REPLAY_MAX_USER_REF_LENGTH } from "../../../Types/Rum/SessionReplay";
import {
  SESSION_REPLAY_SESSION_ID_BATCH_MAX,
  SESSION_REPLAY_SESSION_ID_MAX_LENGTH,
} from "../../../Types/Rum/SessionReplayApi";
import {
  USER_FLOW_DEFAULT_MAX_SESSIONS,
  USER_FLOW_IGNORED_USER_REFERENCE,
  USER_FLOW_MAX_PAGES_PER_JOURNEY,
  USER_FLOW_MAX_SESSIONS,
  USER_FLOW_PERSON_FILTER_KEYS,
  UserFlowJourneysResponseDto,
  UserFlowSessionDetailDto,
  UserFlowSessionDto,
} from "../../../Types/Rum/UserFlow";
import SessionIdentity from "../../../Utils/Rum/SessionIdentity";
import CaptureSpan from "../Telemetry/CaptureSpan";

/*
 * The read behind the User Flows page: the ordered page journey of every
 * recorded session in a window, or of one person's.
 *
 * Where the order comes from. The session header's routes[] is a sorted
 * SET (the finalizer sorts it so re-finalization is byte-stable), so it
 * cannot say "/cart came before /checkout". Each CHUNK row, though, carries
 * the pages visited while it was open, in the order they were visited.
 * Chunks sorted by start time (tabs interleave by wall clock, which is how
 * one person lived them) and flattened give the journey; back-to-back
 * repeats are collapsed in the same statement, so the payload is one short
 * array per session rather than one row per chunk.
 *
 * Every chunk's list is closed with the page the chunk was flushed from.
 * Recordings from before the recorder kept returns hold each page of a
 * chunk once, in first-seen order, so A -> B -> A in a session's last chunk
 * would otherwise read as leaving from B. Inside a chunk of such a recording
 * a return that was not the last page is still lost, which is why the map
 * says "journeys" and never claims an exact page-view count.
 *
 * Nothing here names the `payload` column; everything comes from the
 * manifest-level columns the session list already exposes, which is why the
 * route is guarded by the list permission, not the payload one.
 *
 * Two statements run side by side, plus a count:
 *  - headers: the newest N sessions that started in the window (the sort
 *    key prefix projectId, rumApplicationId, startTime prunes this), with
 *    the device facts the page filters on.
 *  - chunks: the same N sessions' chunk rows, selected by `sessionId IN
 *    (<the same header query>)` - sessionId is the chunk table's second
 *    key column, so this reads only those sessions' granules instead of
 *    scanning a table that has no time in its key.
 * A session that started between the two reads is simply absent from the
 * chunk side and falls back to its entry URL, so the race costs nothing.
 *
 * One person. The same three statements with one more predicate, in all
 * three so they can never disagree about whose sessions these are. The
 * everyone read names no identity column; only a narrowed one does, and the
 * label only for a role that may read it (includeIdentifiedUserLabel).
 */

const RETENTION_FILTER: string = " AND retentionDate >= now()";

const READ_QUERY_SETTINGS: string = getQuerySettings({
  maxExecutionTimeInSeconds: 30,
  timeoutOverflowMode: "throw",
});

/*
 * A per-session bound on the flattened route list before repeats are
 * collapsed, so one pathological session (a page that rewrites its URL on
 * every keystroke) cannot make the array function quadratic.
 */
const MAX_RAW_ROUTES_PER_SESSION: number = 2000;

/*
 * The sessions of one person: those matching ANY of these. A link names one
 * of them; what someone typed may be any of the three, so it names each one
 * it could be.
 */
export interface UserFlowPersonFilter {
  identifiedUserKey?: string | undefined;
  visitorId?: string | undefined;
  sessionId?: string | undefined;
}

export interface UserFlowJourneysRequest {
  projectId: ObjectID;
  rumApplicationId: ObjectID;
  startTime: Date;
  endTime: Date;
  maxSessions?: number | undefined;
  /* Absent reads everyone. */
  person?: UserFlowPersonFilter | undefined;
  /*
   * Decided by the route against the identity permission, and enforced by
   * not naming the column. Only read on a narrowed request.
   */
  includeIdentifiedUserLabel?: boolean | undefined;
  /*
   * Server "now" in unix ms for the hasRecordingEnded grace. Absent means
   * Date.now(); a test seam, like the session list's.
   */
  nowUnixMs?: number | undefined;
}

interface HeaderRow {
  sessionId: string;
  startUnixMs: number;
  deviceType: string;
  browserName: string;
  countryCode: string;
  entryUrl: string;
  /* Only on a narrowed read. */
  detail?: UserFlowSessionDetailDto | undefined;
}

interface ChunkRollupRow {
  pages: Array<string>;
  signals: Array<[string, number, number]>;
  errorCount: number;
  frustrationCount: number;
  spanMs: number;
  /* The last page of the whole journey, before any cap. */
  exitUrl: string;
  /* `pages` stopped before the journey did. */
  isCut: boolean;
}

export interface UserFlowPersonFilterResult {
  /* Undefined when the body names no person: the read is everyone's. */
  person: UserFlowPersonFilter | undefined;
  ignoredFilters: Array<string>;
}

function readString(row: JSONObject, key: string): string {
  const value: unknown = row[key];

  return value === null || value === undefined ? "" : String(value);
}

function readNumber(row: JSONObject, key: string): number {
  const parsed: number = Number(row[key]);

  return Number.isFinite(parsed) ? parsed : 0;
}

/* ClickHouse UInt8 booleans arrive as 0/1, sometimes as the strings "0"/"1". */
function readBoolean(row: JSONObject, key: string): boolean {
  const value: unknown = row[key];

  return value === true || value === 1 || value === "1";
}

function readStringArray(row: JSONObject, key: string): Array<string> {
  const value: unknown = row[key];

  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry: unknown): string => {
      return typeof entry === "string" ? entry : String(entry ?? "");
    })
    .filter((entry: string): boolean => {
      return entry.length > 0;
    });
}

/* ClickHouse JSON renders a Tuple as an array. */
function readSignalTuples(
  row: JSONObject,
  key: string,
): Array<[string, number, number]> {
  const value: unknown = row[key];

  if (!Array.isArray(value)) {
    return [];
  }

  const tuples: Array<[string, number, number]> = [];

  for (const entry of value) {
    if (!Array.isArray(entry) || entry.length < 3) {
      continue;
    }

    const url: string = typeof entry[0] === "string" ? entry[0] : "";
    const errors: number = Number(entry[1]);
    const frustration: number = Number(entry[2]);

    if (!url) {
      continue;
    }

    tuples.push([
      url,
      Number.isFinite(errors) ? errors : 0,
      Number.isFinite(frustration) ? frustration : 0,
    ]);
  }

  return tuples;
}

export function clampUserFlowMaxSessions(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) {
    return USER_FLOW_DEFAULT_MAX_SESSIONS;
  }

  return Math.max(1, Math.min(Math.floor(value), USER_FLOW_MAX_SESSIONS));
}

function isPresent(value: unknown): boolean {
  return value !== undefined && value !== null;
}

/* Whether the body names a person at all, so the route asks about identity. */
export function hasUserFlowPersonFilter(filters: JSONObject): boolean {
  return USER_FLOW_PERSON_FILTER_KEYS.some((key: string): boolean => {
    return isPresent(filters[key]);
  });
}

function readBoundedFilter(
  filters: JSONObject,
  key: string,
  maxLength: number,
): string {
  const value: unknown = filters[key];
  const text: string = typeof value === "string" ? value.trim() : "";

  if (!text || text.length > maxLength) {
    throw new BadDataException(
      `${key} must be a non-empty string of at most ${maxLength} characters.`,
    );
  }

  return text;
}

/*
 * The person a request's filters name, or none.
 *
 * Anything unusable is a 400, never a filter that quietly disappears: this
 * read without its filter is EVERYONE's journeys, and a question about one
 * person must never be answered with other people's activity.
 *
 * A reference is hashed only for a role that may read identity. Otherwise a
 * caller denied the label could still ask "does jane@example.com have
 * sessions here" and read the answer, which is the dictionary attack the
 * session list's gate closes. The digest and the visitor id need no gate:
 * neither names anyone, and the list hands both to every caller.
 */
export function readUserFlowPersonFilter(data: {
  filters: JSONObject;
  projectId: ObjectID;
  canReadIdentity: boolean;
}): UserFlowPersonFilterResult {
  const { filters, projectId, canReadIdentity } = data;

  const named: Array<string> = USER_FLOW_PERSON_FILTER_KEYS.filter(
    (key: string): boolean => {
      return isPresent(filters[key]);
    },
  );

  if (named.length === 0) {
    return { person: undefined, ignoredFilters: [] };
  }

  if (named.length > 1) {
    throw new BadDataException(
      `Send one of ${USER_FLOW_PERSON_FILTER_KEYS.join(", ")}, not ${named.join(" and ")}.`,
    );
  }

  if (isPresent(filters["identifier"])) {
    const identifier: string = readBoundedFilter(
      filters,
      "identifier",
      SESSION_REPLAY_MAX_USER_REF_LENGTH,
    );

    return {
      person: {
        ...(canReadIdentity && {
          identifiedUserKey: SessionReplayIdentity.buildUserKey({
            projectId: projectId,
            userRef: identifier,
          }),
        }),
        ...(SessionIdentity.isVisitorId(identifier) && {
          visitorId: identifier,
        }),
        ...(identifier.length <= SESSION_REPLAY_SESSION_ID_MAX_LENGTH && {
          sessionId: identifier,
        }),
      },
      ignoredFilters: canReadIdentity ? [] : [USER_FLOW_IGNORED_USER_REFERENCE],
    };
  }

  if (isPresent(filters["visitorId"])) {
    if (!SessionIdentity.isVisitorId(filters["visitorId"])) {
      throw new BadDataException(
        "visitorId must be a 32-character lowercase hex visitor id.",
      );
    }

    return {
      person: { visitorId: filters["visitorId"] },
      ignoredFilters: [],
    };
  }

  if (isPresent(filters["sessionId"])) {
    return {
      person: {
        sessionId: readBoundedFilter(
          filters,
          "sessionId",
          SESSION_REPLAY_SESSION_ID_MAX_LENGTH,
        ),
      },
      ignoredFilters: [],
    };
  }

  return {
    person: {
      identifiedUserKey: readBoundedFilter(
        filters,
        "identifiedUserKey",
        SESSION_REPLAY_MAX_USER_REF_LENGTH,
      ),
    },
    ignoredFilters: [],
  };
}

export default class SessionReplayUserFlowReadService {
  /*
   * WHERE for the header table: the sort-key prefix plus retention. Shared
   * by the header read, the chunk read's IN-subquery and the count so the
   * three can never disagree about which sessions are in the window.
   */
  private static appendHeaderWindow(
    statement: Statement,
    request: UserFlowJourneysRequest,
  ): void {
    statement.append(SQL`
        FROM ${AnalyticsTableName.RumSession}
        WHERE projectId = ${{
          type: TableColumnType.ObjectID,
          value: request.projectId,
        }}
          AND rumApplicationId = ${{
            type: TableColumnType.ObjectID,
            value: request.rumApplicationId,
          }}
          AND startTime >= ${{
            type: TableColumnType.DateTime64,
            value: request.startTime,
          }}
          AND startTime <= ${{
            type: TableColumnType.DateTime64,
            value: request.endTime,
          }}`);
    statement.append(RETENTION_FILTER);
  }

  /*
   * Whose sessions, after the GROUP BY and over the argMax'd values. Not a
   * WHERE: that would run over raw rows, so a superseded header version would
   * still match (a session re-identified as someone else stayed in the first
   * person's journeys) and a provisional row, written before the recorder's
   * first meta chunk, would decide what the group reports. Shared by all
   * three statements so they can never disagree.
   *
   * A person with nothing left to match on matches nobody. It must never
   * fall through to the everyone read.
   */
  private static appendPersonHaving(
    statement: Statement,
    request: UserFlowJourneysRequest,
  ): void {
    if (!request.person) {
      return;
    }

    const { identifiedUserKey, visitorId, sessionId } = request.person;
    const clauses: Array<Statement> = [];

    if (identifiedUserKey) {
      clauses.push(SQL`argMax(identifiedUserKey, version) = ${{
        type: TableColumnType.Text,
        value: identifiedUserKey,
      }}`);
    }

    if (visitorId) {
      clauses.push(SQL`argMax(visitorId, version) = ${{
        type: TableColumnType.Text,
        value: visitorId,
      }}`);
    }

    if (sessionId) {
      clauses.push(SQL`sessionId = ${{
        type: TableColumnType.Text,
        value: sessionId,
      }}`);
    }

    if (clauses.length === 0) {
      statement.append(`
        HAVING 0`);
      return;
    }

    statement.append(`
        HAVING (`);

    clauses.forEach((clause: Statement, index: number): void => {
      if (index > 0) {
        statement.append(" OR ");
      }

      statement.append(clause);
    });

    statement.append(")");
  }

  /*
   * The newest-N selection, as a statement fragment returning one column,
   * sessionId. Ordered by the argMax'd start so a provisional and a
   * finalized header row of one session count once.
   */
  private static appendNewestSessionIds(
    statement: Statement,
    request: UserFlowJourneysRequest,
    maxSessions: number,
  ): void {
    statement.append(`
      SELECT sessionId FROM (
        SELECT sessionId, argMax(startTime, version) AS flowNewestStart`);
    SessionReplayUserFlowReadService.appendHeaderWindow(statement, request);
    statement.append(`
        GROUP BY sessionId`);
    SessionReplayUserFlowReadService.appendPersonHaving(statement, request);
    statement.append(`
        ORDER BY flowNewestStart DESC, sessionId DESC`);
    statement.append(
      SQL`
        LIMIT ${{
          type: TableColumnType.Number,
          value: maxSessions,
        }}`,
    );
    statement.append(`
      )`);
  }

  public static buildHeaderStatement(
    request: UserFlowJourneysRequest,
    maxSessions: number,
  ): Statement {
    /*
     * Aliases avoid every physical column name: see the ILLEGAL_AGGREGATION
     * note in SessionReplayReadService.
     */
    const statement: Statement = SQL`
      SELECT
        sessionId AS flowSessionId,
        toFloat64(toUnixTimestamp64Milli(argMax(startTime, version))) AS flowStartUnixMs,
        argMax(deviceType, version) AS flowDeviceType,
        argMax(browserName, version) AS flowBrowserName,
        argMax(countryCode, version) AS flowCountryCode,
        argMax(entryUrl, version) AS flowEntryUrl`;

    if (request.person) {
      statement.append(`,
        argMax(identifiedUserKey, version) AS flowUserKey,
        argMax(visitorId, version) AS flowVisitorId,
        argMax(isFinalized, version) AS flowIsFinalized,
        argMax(sealedReason, version) AS flowSealedReason,
        toFloat64(argMax(chunkCount, version)) AS flowChunkCount`);

      /*
       * Enforced by not naming the column: there is no ModelPermission on
       * this path to strip it after the fact.
       */
      if (request.includeIdentifiedUserLabel) {
        statement.append(`,
        argMax(identifiedUserLabel, version) AS flowUserLabel`);
      }
    }

    SessionReplayUserFlowReadService.appendHeaderWindow(statement, request);

    statement.append(`
        GROUP BY sessionId`);
    SessionReplayUserFlowReadService.appendPersonHaving(statement, request);
    statement.append(`
        ORDER BY flowStartUnixMs DESC, flowSessionId DESC`);
    statement.append(
      SQL`
        LIMIT ${{
          type: TableColumnType.Number,
          value: maxSessions,
        }}`,
    );
    statement.append(READ_QUERY_SETTINGS);

    return statement;
  }

  public static buildCountStatement(
    request: UserFlowJourneysRequest,
  ): Statement {
    /*
     * uniqExact over raw rows cannot see a HAVING, so a person's count goes
     * through the same groups the header read picks from.
     */
    if (request.person) {
      const statement: Statement = SQL`
      SELECT toFloat64(count()) AS flowSessionCount FROM (
        SELECT sessionId`;

      SessionReplayUserFlowReadService.appendHeaderWindow(statement, request);
      statement.append(`
        GROUP BY sessionId`);
      SessionReplayUserFlowReadService.appendPersonHaving(statement, request);
      statement.append(`
      )`);
      statement.append(READ_QUERY_SETTINGS);

      return statement;
    }

    const statement: Statement = SQL`
      SELECT toFloat64(uniqExact(sessionId)) AS flowSessionCount`;

    SessionReplayUserFlowReadService.appendHeaderWindow(statement, request);
    statement.append(READ_QUERY_SETTINGS);

    return statement;
  }

  public static buildChunkStatement(
    request: UserFlowJourneysRequest,
    maxSessions: number,
  ): Statement {
    /*
     * Inner: one row per chunk (the newest delivery of each; pinned copies
     * and retried deliveries collapse), manifest columns only, with each
     * chunk's route list closed by the page it was flushed from.
     * Middle: per session, chunks sorted by (start, tab, index) and their
     * route lists flattened; signal-bearing chunks kept with the page they
     * were flushed from; totals and the recorded span. The exit is read
     * here, before any cap can reach it.
     * Outer: back-to-back repeats collapsed and the journey capped.
     */
    const statement: Statement = SQL`
      WITH arrayFilter(
        (flowRoute, flowAt) -> flowAt = 1 OR flowRoute != flowRawRoutes[flowAt - 1],
        flowRawRoutes,
        arrayEnumerate(flowRawRoutes)
      ) AS flowJourney
      SELECT
        flowSessionId,
        arraySlice(
          flowJourney,
          1,
          ${{
            type: TableColumnType.Number,
            value: USER_FLOW_MAX_PAGES_PER_JOURNEY,
          }}
        ) AS flowPages,
        flowExitRoute,
        toUInt8(
          flowRouteCount > length(flowRawRoutes)
            OR length(flowJourney) > ${{
              type: TableColumnType.Number,
              value: USER_FLOW_MAX_PAGES_PER_JOURNEY,
            }}
        ) AS flowIsCut,
        flowSignals,
        flowErrorTotal,
        flowFrustrationTotal,
        flowSpanMs
      FROM (
        SELECT
          sessionId AS flowSessionId,
          arrayFilter(
            flowRoute -> flowRoute != '',
            arrayFlatten(
              arrayMap(
                flowChunk -> flowChunk.4,
                arraySort(
                  flowChunk -> (flowChunk.1, flowChunk.2, flowChunk.3),
                  groupArray((chunkStartTime, tabId, chunkIndex, flowChunkRoutes))
                )
              )
            )
          ) AS flowAllRoutes,
          arraySlice(
            flowAllRoutes,
            1,
            ${{
              type: TableColumnType.Number,
              value: MAX_RAW_ROUTES_PER_SESSION,
            }}
          ) AS flowRawRoutes,
          length(flowAllRoutes) AS flowRouteCount,
          flowAllRoutes[-1] AS flowExitRoute,
          groupArrayIf(
            (url, toFloat64(errorCount), toFloat64(rageClickCount + deadClickCount + errorClickCount + refreshRageCount)),
            url != '' AND (errorCount + rageClickCount + deadClickCount + errorClickCount + refreshRageCount) > 0
          ) AS flowSignals,
          toFloat64(sum(errorCount)) AS flowErrorTotal,
          toFloat64(sum(rageClickCount + deadClickCount + errorClickCount + refreshRageCount)) AS flowFrustrationTotal,
          toFloat64(toUnixTimestamp64Milli(max(chunkEndTime)) - toUnixTimestamp64Milli(min(chunkStartTime))) AS flowSpanMs
        FROM (
          SELECT
            sessionId,
            tabId,
            chunkIndex,
            chunkStartTime,
            chunkEndTime,
            url,
            if(url = '' OR routes[-1] = url, routes, arrayPushBack(routes, url)) AS flowChunkRoutes,
            errorCount,
            rageClickCount,
            deadClickCount,
            errorClickCount,
            refreshRageCount
          FROM ${AnalyticsTableName.RumSessionChunk}
          WHERE projectId = ${{
            type: TableColumnType.ObjectID,
            value: request.projectId,
          }}
            AND rumApplicationId = ${{
              type: TableColumnType.ObjectID,
              value: request.rumApplicationId,
            }}
            AND sessionId IN (`;

    SessionReplayUserFlowReadService.appendNewestSessionIds(
      statement,
      request,
      maxSessions,
    );

    statement.append(`
            )`);
    statement.append(RETENTION_FILTER);
    statement.append(`
          ORDER BY version DESC
          LIMIT 1 BY sessionId, tabId, chunkIndex
        )
        GROUP BY sessionId
      )`);
    statement.append(READ_QUERY_SETTINGS);

    return statement;
  }

  @CaptureSpan()
  public static async readJourneys(
    request: UserFlowJourneysRequest,
  ): Promise<UserFlowJourneysResponseDto> {
    const maxSessions: number = clampUserFlowMaxSessions(request.maxSessions);

    const [headerResult, chunkResult, countResult]: [
      Results,
      Results,
      Results,
    ] = await Promise.all([
      RumSessionService.executeQuery(
        SessionReplayUserFlowReadService.buildHeaderStatement(
          request,
          maxSessions,
        ),
      ),
      RumSessionChunkService.executeQuery(
        SessionReplayUserFlowReadService.buildChunkStatement(
          request,
          maxSessions,
        ),
      ),
      RumSessionService.executeQuery(
        SessionReplayUserFlowReadService.buildCountStatement(request),
      ),
    ]);

    const [headerJson, chunkJson, countJson]: [
      DbJSONResponse,
      DbJSONResponse,
      DbJSONResponse,
    ] = await Promise.all([
      headerResult.json<{ data?: Array<JSONObject> }>(),
      chunkResult.json<{ data?: Array<JSONObject> }>(),
      countResult.json<{ data?: Array<JSONObject> }>(),
    ]);

    const isNarrowed: boolean = Boolean(request.person);

    const headers: Array<HeaderRow> = (headerJson.data || []).map(
      (row: JSONObject): HeaderRow => {
        return {
          sessionId: readString(row, "flowSessionId"),
          startUnixMs: readNumber(row, "flowStartUnixMs"),
          deviceType: readString(row, "flowDeviceType"),
          browserName: readString(row, "flowBrowserName"),
          countryCode: readString(row, "flowCountryCode"),
          entryUrl: readString(row, "flowEntryUrl"),
          ...(isNarrowed && {
            detail: SessionReplayUserFlowReadService.toSessionDetail(
              row,
              request,
            ),
          }),
        };
      },
    );

    if (isNarrowed) {
      await SessionReplayUserFlowReadService.markEndedRecordings(
        headers,
        request,
      );
    }

    const chunks: Map<string, ChunkRollupRow> = new Map<
      string,
      ChunkRollupRow
    >();

    for (const row of chunkJson.data || []) {
      chunks.set(readString(row, "flowSessionId"), {
        pages: readStringArray(row, "flowPages"),
        signals: readSignalTuples(row, "flowSignals"),
        errorCount: readNumber(row, "flowErrorTotal"),
        frustrationCount: readNumber(row, "flowFrustrationTotal"),
        spanMs: readNumber(row, "flowSpanMs"),
        exitUrl: readString(row, "flowExitRoute"),
        isCut: readBoolean(row, "flowIsCut"),
      });
    }

    const sessionsInWindow: number = readNumber(
      (countJson.data || [])[0] || {},
      "flowSessionCount",
    );

    return SessionReplayUserFlowReadService.toResponse({
      headers: headers,
      chunks: chunks,
      sessionsInWindow: sessionsInWindow,
      maxSessions: maxSessions,
      request: request,
    });
  }

  private static toSessionDetail(
    row: JSONObject,
    request: UserFlowJourneysRequest,
  ): UserFlowSessionDetailDto {
    return {
      identifiedUserKey: readString(row, "flowUserKey"),
      visitorId: readString(row, "flowVisitorId"),
      ...(request.includeIdentifiedUserLabel && {
        identifiedUserLabel: readString(row, "flowUserLabel"),
      }),
      isFinalized: readBoolean(row, "flowIsFinalized"),
      hasRecordingEnded: false,
      sealedReason: readString(row, "flowSealedReason"),
      chunkCount: readNumber(row, "flowChunkCount"),
    };
  }

  /*
   * "Not finalized" is not "still recording": a closed tab must not read as
   * live for the minutes the finalizer takes. The one rule the list and the
   * player judge this by, for the sessions it can matter to. Bounded like
   * the summaries' batch: a person with more sessions than that still
   * unfinalized is a bot, and reading those few as live costs nothing.
   */
  private static async markEndedRecordings(
    headers: Array<HeaderRow>,
    request: UserFlowJourneysRequest,
  ): Promise<void> {
    const unfinalized: Array<HeaderRow> = headers.filter(
      (header: HeaderRow): boolean => {
        return header.detail ? !header.detail.isFinalized : false;
      },
    );

    if (unfinalized.length === 0) {
      return;
    }

    const endedSessionIds: Set<string> =
      await SessionReplayReadService.readRecordingEndedSessionIds({
        projectId: request.projectId,
        rumApplicationId: request.rumApplicationId,
        sessionIds: unfinalized
          .slice(0, SESSION_REPLAY_SESSION_ID_BATCH_MAX)
          .map((header: HeaderRow): string => {
            return header.sessionId;
          }),
        nowUnixMs: request.nowUnixMs ?? Date.now(),
      });

    for (const header of unfinalized) {
      if (header.detail) {
        header.detail.hasRecordingEnded = endedSessionIds.has(header.sessionId);
      }
    }
  }

  /*
   * Rows -> the dictionary-encoded wire shape. Exposed for tests; no I/O.
   */
  public static toResponse(data: {
    headers: Array<HeaderRow>;
    chunks: Map<string, ChunkRollupRow>;
    sessionsInWindow: number;
    maxSessions: number;
    request: UserFlowJourneysRequest;
  }): UserFlowJourneysResponseDto {
    const pages: Array<string> = [];
    const pageIndex: Map<string, number> = new Map<string, number>();

    const indexOf: (url: string) => number = (url: string): number => {
      let index: number | undefined = pageIndex.get(url);

      if (index === undefined) {
        index = pages.length;
        pages.push(url);
        pageIndex.set(url, index);
      }

      return index;
    };

    const sessions: Array<UserFlowSessionDto> = [];

    for (const header of data.headers) {
      if (!header.sessionId) {
        continue;
      }

      const rollup: ChunkRollupRow | undefined = data.chunks.get(
        header.sessionId,
      );

      /*
       * A header without chunk rows (the session started between the two
       * reads, or its chunks were erased) still has a landing page.
       */
      const urls: Array<string> =
        rollup && rollup.pages.length > 0
          ? rollup.pages
          : header.entryUrl
            ? [header.entryUrl]
            : [];

      if (urls.length === 0) {
        continue;
      }

      /* The journey first, so the dictionary reads in visiting order. */
      const pageIndexes: Array<number> = urls.map((url: string): number => {
        return indexOf(url);
      });

      /* Several chunks flushed from one page fold into one entry. */
      const signalsByPage: Map<number, [number, number]> = new Map<
        number,
        [number, number]
      >();

      for (const [url, errors, frustration] of rollup?.signals || []) {
        const index: number = indexOf(url);
        const current: [number, number] = signalsByPage.get(index) || [0, 0];

        signalsByPage.set(index, [
          current[0] + errors,
          current[1] + frustration,
        ]);
      }

      /* A cut journey still knows where it ended. */
      const exitPage: number | undefined =
        rollup?.isCut && rollup.exitUrl ? indexOf(rollup.exitUrl) : undefined;

      sessions.push({
        sessionId: header.sessionId,
        startUnixMs: header.startUnixMs,
        durationMs: Math.max(0, rollup?.spanMs || 0),
        deviceType: header.deviceType,
        browserName: header.browserName,
        countryCode: header.countryCode,
        errorCount: rollup?.errorCount || 0,
        frustrationCount: rollup?.frustrationCount || 0,
        pages: pageIndexes,
        pageSignals: Array.from(signalsByPage.entries()).map(
          ([index, [errors, frustration]]: [number, [number, number]]): [
            number,
            number,
            number,
          ] => {
            return [index, errors, frustration];
          },
        ),
        ...(exitPage === undefined ? {} : { exitPage: exitPage }),
        ...(header.detail ? { detail: header.detail } : {}),
      });
    }

    return {
      pages: pages,
      sessions: sessions,
      sessionsInWindow: Math.max(data.sessionsInWindow, sessions.length),
      isSampled: data.sessionsInWindow > data.headers.length,
      maxSessions: data.maxSessions,
      startUnixMs: data.request.startTime.getTime(),
      endUnixMs: data.request.endTime.getTime(),
      ignoredFilters: [],
    };
  }
}
