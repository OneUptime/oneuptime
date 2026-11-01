import { SQL, Statement } from "../AnalyticsDatabase/Statement";
import { getQuerySettings } from "../AnalyticsDatabase/QuerySettingsHelper";
import RumSessionService from "../../Services/RumSessionService";
import RumSessionChunkService from "../../Services/RumSessionChunkService";
import {
  DbJSONResponse,
  Results,
} from "../../Services/AnalyticsDatabaseService";
import AnalyticsTableName from "../../../Types/AnalyticsDatabase/AnalyticsTableName";
import TableColumnType from "../../../Types/AnalyticsDatabase/TableColumnType";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import { SessionReplaySealedReason } from "../../../Types/Rum/SessionReplay";
import {
  USER_FLOW_DEFAULT_MAX_SESSIONS,
  USER_FLOW_MAX_PAGES_PER_JOURNEY,
  USER_FLOW_MAX_SESSIONS,
  UserFlowJourneysResponseDto,
  UserFlowScopeDto,
  UserFlowSessionDto,
} from "../../../Types/Rum/UserFlow";
import CaptureSpan from "../Telemetry/CaptureSpan";

/*
 * The read behind the User Flows page: the ordered page journey of every
 * recorded session in a window.
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
 * Recordings from before the recorders kept returns hold each page of a
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
 * A read can be narrowed to one person or one session (UserFlowJourneysScope):
 * every statement takes the same narrowing, so the three still agree. Only a
 * narrowed read names who the sessions belong to - a read over everyone has
 * no use for it - and the label among those columns only for a caller who may
 * read it.
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

export type UserFlowJourneysScope =
  | { kind: "user"; identifiedUserKey: string }
  | { kind: "visitor"; visitorId: string }
  | { kind: "session"; sessionId: string };

export interface UserFlowJourneysRequest {
  projectId: ObjectID;
  rumApplicationId: ObjectID;
  startTime: Date;
  endTime: Date;
  maxSessions?: number | undefined;
  /* Absent reads everyone in the window. */
  scope?: UserFlowJourneysScope | undefined;
  /*
   * The label has a narrower ACL than the rest of the header, and this
   * raw-SQL path never invokes ModelPermission, so the handler decides and
   * the column is simply not named when it is not permitted.
   */
  includeIdentifiedUserLabel?: boolean | undefined;
}

interface HeaderRow {
  sessionId: string;
  startUnixMs: number;
  deviceType: string;
  browserName: string;
  countryCode: string;
  entryUrl: string;
  /* Read on a narrowed read only, like everything below. */
  identifiedUserKey?: string | undefined;
  visitorId?: string | undefined;
  identifiedUserLabel?: string | undefined;
  hasRecording?: boolean | undefined;
}

interface ChunkRollupRow {
  pages: Array<string>;
  signals: Array<[string, number, number]>;
  errorCount: number;
  frustrationCount: number;
  spanMs: number;
}

function readString(row: JSONObject, key: string): string {
  const value: unknown = row[key];

  return value === null || value === undefined ? "" : String(value);
}

function readNumber(row: JSONObject, key: string): number {
  const parsed: number = Number(row[key]);

  return Number.isFinite(parsed) ? parsed : 0;
}

function readBoolean(row: JSONObject, key: string): boolean {
  const value: unknown = row[key];

  return value === true || value === 1 || value === "1" || value === "true";
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

/*
 * The session list's own rule (getSessionReplayPlayability): a lost recording
 * has nothing to play, and neither has a finalized session that stored no
 * chunks. An unfinalized header's zero only means "not counted yet".
 */
function readHasRecording(row: JSONObject): boolean {
  if (
    readString(row, "flowSealedReason") ===
    SessionReplaySealedReason.RecordingLost
  ) {
    return false;
  }

  return (
    !readBoolean(row, "flowIsFinalized") ||
    readNumber(row, "flowChunkCount") > 0
  );
}

export default class SessionReplayUserFlowReadService {
  /*
   * WHERE for the header table: the sort-key prefix plus retention. Shared
   * by the header read, the chunk read's IN-subquery and the count so the
   * three can never disagree about which sessions are in the window.
   *
   * A session id never changes between header versions, so it is safe here,
   * and it is the end of the sort key. A person is not: see appendScopeHaving.
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

    if (request.scope?.kind === "session") {
      statement.append(
        SQL`
          AND sessionId = ${{
            type: TableColumnType.Text,
            value: request.scope.sessionId,
          }}`,
      );
    }

    statement.append(RETENTION_FILTER);
  }

  /*
   * After GROUP BY sessionId: whose session it is, judged on the newest
   * header version. Never a WHERE on the raw columns, which would match a
   * superseded version, and miss a session whose provisional header was
   * written before the recorder's first meta chunk carried the identity.
   */
  private static appendScopeHaving(
    statement: Statement,
    request: UserFlowJourneysRequest,
  ): void {
    if (request.scope?.kind === "user") {
      statement.append(
        SQL`
        HAVING argMax(identifiedUserKey, version) = ${{
          type: TableColumnType.Text,
          value: request.scope.identifiedUserKey,
        }}`,
      );
    }

    if (request.scope?.kind === "visitor") {
      statement.append(
        SQL`
        HAVING argMax(visitorId, version) = ${{
          type: TableColumnType.Text,
          value: request.scope.visitorId,
        }}`,
      );
    }
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
    SessionReplayUserFlowReadService.appendScopeHaving(statement, request);
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

    if (request.scope) {
      statement.append(`,
        argMax(identifiedUserKey, version) AS flowIdentifiedUserKey,
        argMax(visitorId, version) AS flowVisitorId,
        argMax(isFinalized, version) AS flowIsFinalized,
        argMax(chunkCount, version) AS flowChunkCount,
        argMax(sealedReason, version) AS flowSealedReason`);

      if (request.includeIdentifiedUserLabel) {
        statement.append(`,
        argMax(identifiedUserLabel, version) AS flowIdentifiedUserLabel`);
      }
    }

    SessionReplayUserFlowReadService.appendHeaderWindow(statement, request);

    statement.append(`
        GROUP BY sessionId`);
    SessionReplayUserFlowReadService.appendScopeHaving(statement, request);
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
    if (request.scope) {
      /* One row per session first: the narrowing is judged per session. */
      const narrowed: Statement = SQL`
      SELECT toFloat64(count()) AS flowSessionCount
      FROM (
        SELECT sessionId`;

      SessionReplayUserFlowReadService.appendHeaderWindow(narrowed, request);
      narrowed.append(`
        GROUP BY sessionId`);
      SessionReplayUserFlowReadService.appendScopeHaving(narrowed, request);
      narrowed.append(`
      )`);
      narrowed.append(READ_QUERY_SETTINGS);

      return narrowed;
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
     * were flushed from; totals and the recorded span.
     * Outer: back-to-back repeats collapsed and the journey capped, one
     * page over the cap, which is how toResponse knows the journey was cut.
     */
    const statement: Statement = SQL`
      SELECT
        flowSessionId,
        arraySlice(
          arrayFilter(
            (flowRoute, flowAt) -> flowAt = 1 OR flowRoute != flowRawRoutes[flowAt - 1],
            flowRawRoutes,
            arrayEnumerate(flowRawRoutes)
          ),
          1,
          ${{
            type: TableColumnType.Number,
            value: USER_FLOW_MAX_PAGES_PER_JOURNEY + 1,
          }}
        ) AS flowPages,
        flowSignals,
        flowErrorTotal,
        flowFrustrationTotal,
        flowSpanMs
      FROM (
        SELECT
          sessionId AS flowSessionId,
          arraySlice(
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
            ),
            1,
            ${{
              type: TableColumnType.Number,
              value: MAX_RAW_ROUTES_PER_SESSION,
            }}
          ) AS flowRawRoutes,
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

    const headers: Array<HeaderRow> = (headerJson.data || []).map(
      (row: JSONObject): HeaderRow => {
        return {
          sessionId: readString(row, "flowSessionId"),
          startUnixMs: readNumber(row, "flowStartUnixMs"),
          deviceType: readString(row, "flowDeviceType"),
          browserName: readString(row, "flowBrowserName"),
          countryCode: readString(row, "flowCountryCode"),
          entryUrl: readString(row, "flowEntryUrl"),
          ...(request.scope && {
            identifiedUserKey: readString(row, "flowIdentifiedUserKey"),
            visitorId: readString(row, "flowVisitorId"),
            identifiedUserLabel: readString(row, "flowIdentifiedUserLabel"),
            hasRecording: readHasRecording(row),
          }),
        };
      },
    );

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
      const pageIndexes: Array<number> = urls
        .slice(0, USER_FLOW_MAX_PAGES_PER_JOURNEY)
        .map((url: string): number => {
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
        ...(urls.length > USER_FLOW_MAX_PAGES_PER_JOURNEY && {
          isTruncated: true,
        }),
        ...(header.hasRecording !== undefined && {
          hasRecording: header.hasRecording,
        }),
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
      scope: SessionReplayUserFlowReadService.toScope(
        data.request,
        data.headers,
      ),
    };
  }

  /*
   * What the read was narrowed to, and who that is. Headers are newest first,
   * so the first one that says is the latest word on it: a session recorded
   * before identify() has no label to give.
   */
  private static toScope(
    request: UserFlowJourneysRequest,
    headers: Array<HeaderRow>,
  ): UserFlowScopeDto | null {
    const scope: UserFlowJourneysScope | undefined = request.scope;

    if (!scope) {
      return null;
    }

    const label: { identifiedUserLabel?: string } =
      request.includeIdentifiedUserLabel && scope.kind !== "visitor"
        ? {
            identifiedUserLabel:
              headers.find((header: HeaderRow): boolean => {
                return Boolean(header.identifiedUserLabel);
              })?.identifiedUserLabel ?? "",
          }
        : {};

    switch (scope.kind) {
      case "user":
        return {
          kind: "user",
          identifiedUserKey: scope.identifiedUserKey,
          visitorId: "",
          sessionId: "",
          ...label,
        };
      case "visitor":
        return {
          kind: "visitor",
          identifiedUserKey: "",
          visitorId: scope.visitorId,
          sessionId: "",
        };
      case "session":
        return {
          kind: "session",
          identifiedUserKey: headers[0]?.identifiedUserKey ?? "",
          visitorId: headers[0]?.visitorId ?? "",
          sessionId: scope.sessionId,
          ...label,
        };
    }
  }
}
