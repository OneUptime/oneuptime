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
import Includes from "../../../Types/BaseDatabase/Includes";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import ChunkMath from "../../../Utils/Rum/ChunkMath";
import {
  MAX_SESSION_REPLAY_CHUNKS_PER_READ,
  MAX_SESSION_REPLAY_READ_BYTES,
  SessionReplayChunkManifestEntry,
  SessionReplayGap,
} from "../../../Types/Rum/SessionReplay";
import BadDataException from "../../../Types/Exception/BadDataException";
import CaptureSpan from "../Telemetry/CaptureSpan";

/*
 * Bespoke ClickHouse reads for session-replay playback.
 *
 * Why this exists at all instead of BaseAnalyticsAPI / the generic ORM
 * read path:
 *
 *  1. There is NO `FINAL` support anywhere in this repo — neither
 *     StatementGenerator nor AnalyticsDatabaseService ever emits it. Both
 *     replay tables are ReplacingMergeTree, so until a background merge
 *     runs a session is physically several rows: a provisional header
 *     written on chunk 0 and a finalized header written minutes later,
 *     plus one extra chunk row per retried delivery. A naive SELECT shows
 *     every one of them. That is worst for the NEWEST sessions, which are
 *     exactly the rows a session list sorts first. Every read here
 *     therefore collapses duplicates itself: `argMax(col, version)` over
 *     the replace key for the header table (the convention
 *     SloHistoryService documents), and `ORDER BY ... version DESC LIMIT
 *     1 BY ...` for the chunk table where whole rows, not aggregates, are
 *     wanted.
 *
 *  2. `toFindStatement` clamps limit to LIMIT_PER_PROJECT, has no cursor,
 *     and runs with `timeout_overflow_mode = 'break'`, which returns
 *     PARTIAL RESULTS WITHOUT ERRORING. A silently short session list is
 *     merely annoying; a silently short chunk page renders a DOM the user
 *     never saw. Every statement here uses 'throw' instead.
 *
 *  3. The manifest read must never name the `payload` column, so
 *     ClickHouse never touches (and never decompresses) the only column
 *     in the system that holds a recording of a real person's screen.
 *     The byte-cap pre-check is the one exception, and it measures
 *     `length(payload)` inside ClickHouse without ever shipping the
 *     bytes: the cap has to bound the size of what is actually returned,
 *     and the only honest measure of that is the stored column itself.
 *
 * NOTE on aliases: ClickHouse substitutes SELECT aliases into same-level
 * unqualified WHERE references, and an aggregate alias there is an
 * ILLEGAL_AGGREGATION error. Every aggregate below is therefore aliased
 * to a name that does NOT collide with a real column, so WHERE keeps
 * referring to the physical column and HAVING/ORDER BY can safely use the
 * alias.
 */

/* Both replay tables carry retentionDate, so both reads need the filter. */
const RETENTION_FILTER: string = " AND retentionDate >= now()";

/*
 * Wall-clock cap. 'throw' rather than 'break': see (2) above. 30s is well
 * inside the App pool's 58s request_timeout, so a query that blows the
 * budget surfaces as an error the player can retry rather than as a
 * truncated recording.
 */
const READ_QUERY_SETTINGS: string = getQuerySettings({
  maxExecutionTimeInSeconds: 30,
  timeoutOverflowMode: "throw",
});

/* Page sizes for the session list. */
export const DEFAULT_SESSION_REPLAY_LIST_LIMIT: number = 50;
export const MAX_SESSION_REPLAY_LIST_LIMIT: number = 200;

/* Sessions returned by the exception -> replay lookup. */
export const MAX_SESSION_REPLAY_FOR_EXCEPTION_LIMIT: number = 20;

/*
 * Row ceiling on one manifest. A session is capped at
 * MAX_SESSION_REPLAY_CHUNKS_PER_SESSION (480) chunks PER TAB, and a
 * session can legitimately span several tabs, so the manifest is bounded
 * separately. Hitting it is reported rather than silently truncating the
 * timeline.
 */
const MAX_MANIFEST_ROWS: number = 4096;

export interface SessionReplayListCursor {
  /* Server-clamped session start of the last row of the previous page. */
  startTimeUnixMs: number;
  sessionId: string;
}

export interface SessionReplayListFilters {
  hasError?: boolean | undefined;
  /*
   * Any frustration signal (rage/dead/error clicks, refresh rage).
   * Server-side, so "frustration" filters the whole table — the old
   * client-side version filtered only the fetched page, silently showing
   * an empty list for a project whose frustrated sessions sat on page 2.
   */
  hasFrustration?: boolean | undefined;
  isFinalized?: boolean | undefined;
  triggerReasons?: Array<string> | undefined;
  browserNames?: Array<string> | undefined;
  osNames?: Array<string> | undefined;
  deviceTypes?: Array<string> | undefined;
  countryCodes?: Array<string> | undefined;
  identifiedUserKey?: string | undefined;
  /* "sessions that hit /checkout" - matches the routes array. */
  route?: string | undefined;
  minDurationMs?: number | undefined;
}

export interface SessionReplayListRequest {
  projectId: ObjectID;
  rumApplicationId: ObjectID;
  startTime: Date;
  endTime: Date;
  filters: SessionReplayListFilters;
  limit: number;
  cursor?: SessionReplayListCursor | undefined;
  /*
   * The raw end-user identifier has its own, narrower column ACL than the
   * rest of the header row. This raw-SQL path never invokes
   * ModelPermission, so the caller decides column-by-column and the
   * column is simply not named in the SELECT when it is not permitted.
   */
  includeIdentifiedUserLabel: boolean;
}

export interface SessionReplayListItem {
  sessionId: string;
  rumApplicationId: string;
  startTime: Date;
  endTime: Date;
  durationMs: number;
  isFinalized: boolean;
  sealedReason: string;
  chunkCount: number;
  maxChunkIndex: number;
  missingChunkCount: number;
  eventCount: number;
  payloadBytes: number;
  hasError: boolean;
  errorCount: number;
  rageClickCount: number;
  deadClickCount: number;
  errorClickCount: number;
  refreshRageCount: number;
  pageCount: number;
  triggerReason: string;
  entryUrl: string;
  exitUrl: string;
  browserName: string;
  browserVersion: string;
  osName: string;
  deviceType: string;
  countryCode: string;
  viewportWidth: number;
  viewportHeight: number;
  identifiedUserKey: string;
  /* Present only when the caller holds the narrower identity permission. */
  identifiedUserLabel?: string | undefined;
  samplePercentageAtCapture: number;
}

export interface SessionReplayListResult {
  sessions: Array<SessionReplayListItem>;
  nextCursor: SessionReplayListCursor | null;
}

export interface SessionReplaySessionHeader {
  sessionId: string;
  projectId: string;
  rumApplicationId: string;
  startTime: Date;
  endTime: Date;
  durationMs: number;
  isFinalized: boolean;
  sealedReason: string;
  chunkCount: number;
  maxChunkIndex: number;
  missingChunkCount: number;
  eventCount: number;
  payloadBytes: number;
  hasError: boolean;
  errorCount: number;
  rageClickCount: number;
  deadClickCount: number;
  errorClickCount: number;
  refreshRageCount: number;
  pageCount: number;
  triggerReason: string;
  maskingMode: string;
  consentState: string;
  recorderKind: string;
  recorderVersion: string;
  rrwebVersion: string;
  schemaVersion: number;
  wireVersion: number;
  entryUrl: string;
  exitUrl: string;
  routes: Array<string>;
  browserName: string;
  browserVersion: string;
  osName: string;
  deviceType: string;
  countryCode: string;
  viewportWidth: number;
  viewportHeight: number;
  fidelityNotices: Array<string>;
  fullSnapshotChunkIndexes: Array<number>;
  traceIds: Array<string>;
  exceptionFingerprints: Array<string>;
  clockSkewMs: number;
}

/*
 * One tab's slice of the manifest. chunkIndex is minted PER TAB by the
 * recorder (sessionStorage is copied on tab duplication, so two live tabs
 * legitimately both start at 0), which means gap detection and seek
 * anchors are only meaningful within a tab.
 */
export interface SessionReplayManifestTab {
  tabId: string;
  chunks: Array<SessionReplayChunkManifestEntry>;
  chunkIndexes: Array<number>;
  fullSnapshotChunkIndexes: Array<number>;
  gaps: Array<SessionReplayGap>;
  maxChunkIndex: number;
  totalPayloadBytes: number;
}

export interface SessionReplayManifest {
  header: SessionReplaySessionHeader;
  tabs: Array<SessionReplayManifestTab>;
  /*
   * True when the chunk index itself was cut short by MAX_MANIFEST_ROWS.
   * Surfaced so the player can say the timeline is incomplete rather than
   * presenting a short recording as a whole one.
   */
  isChunkIndexTruncated: boolean;
}

export interface SessionReplayChunkPayload {
  chunkIndex: number;
  payload: string;
}

export interface SessionReplayExceptionSession {
  sessionId: string;
  rumApplicationId: string;
  startTime: Date;
  endTime: Date;
  durationMs: number;
  hasError: boolean;
  errorCount: number;
  rageClickCount: number;
  deadClickCount: number;
  errorClickCount: number;
  refreshRageCount: number;
  maskingMode: string;
  triggerReason: string;
  entryUrl: string;
  browserName: string;
  osName: string;
  deviceType: string;
  isFinalized: boolean;
}

/*
 * Header columns that are aggregated with argMax and their SELECT alias.
 * Kept as data rather than a hand-written SELECT list so the list, header
 * and exception-lookup queries cannot drift apart on which columns they
 * de-duplicate.
 *
 * `expression` wraps 64-bit and 128-bit columns in toFloat64: the
 * ClickHouse JSON format quotes Int64/UInt64/Int128 as strings by
 * default, and unix-millisecond and byte-count magnitudes are far inside
 * Float64's exact-integer range.
 */
interface AggregatedColumn {
  alias: string;
  expression: string;
}

function argMaxColumn(column: string): string {
  return `argMax(${column}, version)`;
}

function argMaxNumeric(column: string): string {
  return `toFloat64(${argMaxColumn(column)})`;
}

function argMaxDateTime(column: string): string {
  return `toFloat64(toUnixTimestamp64Milli(${argMaxColumn(column)}))`;
}

/*
 * Aliases deliberately differ from the physical column names. See the
 * ILLEGAL_AGGREGATION note in the file header.
 */
const HEADER_AGGREGATES: Array<AggregatedColumn> = [
  { alias: "aggStartTime", expression: argMaxDateTime("startTime") },
  { alias: "aggEndTime", expression: argMaxDateTime("endTime") },
  { alias: "aggDurationMs", expression: argMaxNumeric("durationMs") },
  { alias: "aggIsFinalized", expression: argMaxColumn("isFinalized") },
  { alias: "aggSealedReason", expression: argMaxColumn("sealedReason") },
  { alias: "aggChunkCount", expression: argMaxNumeric("chunkCount") },
  { alias: "aggMaxChunkIndex", expression: argMaxNumeric("maxChunkIndex") },
  {
    alias: "aggMissingChunkCount",
    expression: argMaxNumeric("missingChunkCount"),
  },
  { alias: "aggEventCount", expression: argMaxNumeric("eventCount") },
  { alias: "aggPayloadBytes", expression: argMaxNumeric("payloadBytes") },
  { alias: "aggHasError", expression: argMaxColumn("hasError") },
  { alias: "aggErrorCount", expression: argMaxNumeric("errorCount") },
  { alias: "aggRageClickCount", expression: argMaxNumeric("rageClickCount") },
  { alias: "aggDeadClickCount", expression: argMaxNumeric("deadClickCount") },
  { alias: "aggErrorClickCount", expression: argMaxNumeric("errorClickCount") },
  {
    alias: "aggRefreshRageCount",
    expression: argMaxNumeric("refreshRageCount"),
  },
  { alias: "aggPageCount", expression: argMaxNumeric("pageCount") },
  { alias: "aggTriggerReason", expression: argMaxColumn("triggerReason") },
  { alias: "aggEntryUrl", expression: argMaxColumn("entryUrl") },
  { alias: "aggExitUrl", expression: argMaxColumn("exitUrl") },
  { alias: "aggBrowserName", expression: argMaxColumn("browserName") },
  { alias: "aggBrowserVersion", expression: argMaxColumn("browserVersion") },
  { alias: "aggOsName", expression: argMaxColumn("osName") },
  { alias: "aggDeviceType", expression: argMaxColumn("deviceType") },
  { alias: "aggCountryCode", expression: argMaxColumn("countryCode") },
  { alias: "aggViewportWidth", expression: argMaxNumeric("viewportWidth") },
  { alias: "aggViewportHeight", expression: argMaxNumeric("viewportHeight") },
  {
    alias: "aggIdentifiedUserKey",
    expression: argMaxColumn("identifiedUserKey"),
  },
  {
    alias: "aggSamplePercentage",
    expression: argMaxNumeric("samplePercentageAtCapture"),
  },
];

/* Only the manifest needs these; the list never renders them. */
const HEADER_DETAIL_AGGREGATES: Array<AggregatedColumn> = [
  { alias: "aggMaskingMode", expression: argMaxColumn("maskingMode") },
  { alias: "aggConsentState", expression: argMaxColumn("consentState") },
  { alias: "aggRecorderKind", expression: argMaxColumn("recorderKind") },
  { alias: "aggRecorderVersion", expression: argMaxColumn("recorderVersion") },
  { alias: "aggRrwebVersion", expression: argMaxColumn("rrwebVersion") },
  { alias: "aggSchemaVersion", expression: argMaxNumeric("schemaVersion") },
  { alias: "aggWireVersion", expression: argMaxNumeric("wireVersion") },
  { alias: "aggRoutes", expression: argMaxColumn("routes") },
  { alias: "aggFidelityNotices", expression: argMaxColumn("fidelityNotices") },
  {
    alias: "aggFullSnapshotChunkIndexes",
    expression: argMaxColumn("fullSnapshotChunkIndexes"),
  },
  { alias: "aggTraceIds", expression: argMaxColumn("traceIds") },
  {
    alias: "aggExceptionFingerprints",
    expression: argMaxColumn("exceptionFingerprints"),
  },
  { alias: "aggClockSkewMs", expression: argMaxNumeric("clockSkewMs") },
];

function toSelectList(columns: Array<AggregatedColumn>): string {
  return columns
    .map((column: AggregatedColumn): string => {
      return `${column.expression} AS ${column.alias}`;
    })
    .join(",\n        ");
}

function readNumber(row: JSONObject, key: string): number {
  const value: unknown = row[key];

  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  /*
   * ClickHouse quotes 64-bit integers in JSON. Everything wide is wrapped
   * in toFloat64 above, but parse defensively so one un-wrapped column
   * added later degrades to a number rather than to NaN in the UI.
   */
  if (typeof value === "string" && value.length > 0) {
    const parsed: number = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  return 0;
}

function readBoolean(row: JSONObject, key: string): boolean {
  const value: unknown = row[key];

  if (typeof value === "boolean") {
    return value;
  }

  return value === 1 || value === "1" || value === "true";
}

function readString(row: JSONObject, key: string): string {
  const value: unknown = row[key];

  return typeof value === "string" ? value : "";
}

function readStringArray(row: JSONObject, key: string): Array<string> {
  const value: unknown = row[key];

  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((item: unknown): item is string => {
      return typeof item === "string";
    })
    .map((item: string): string => {
      return item;
    });
}

function readNumberArray(row: JSONObject, key: string): Array<number> {
  const value: unknown = row[key];

  if (!Array.isArray(value)) {
    return [];
  }

  const numbers: Array<number> = [];

  for (const item of value) {
    const parsed: number = typeof item === "number" ? item : Number(item);

    if (Number.isFinite(parsed)) {
      numbers.push(parsed);
    }
  }

  return numbers;
}

/*
 * Unix millis -> Date. The queries return epoch milliseconds as a Float64
 * precisely so no ClickHouse datetime string ever has to be re-parsed
 * (its "YYYY-MM-DD hh:mm:ss.nnnnnnnnn" form has no timezone and is a
 * long-standing source of off-by-hours bugs).
 */
function readDate(row: JSONObject, key: string): Date {
  return new Date(readNumber(row, key));
}

export default class SessionReplayReadService {
  /*
   * Session list.
   *
   * projectId / rumApplicationId / startTime go in the WHERE because they
   * are the first three elements of the sort key AND they are part of the
   * ReplacingMergeTree replace key, so they are byte-identical on every
   * duplicate row of a session. Filtering on them before the GROUP BY is
   * therefore both index-friendly and safe.
   *
   * Everything else is filtered in HAVING against the argMax'd value.
   * That is not a style choice: a provisional header (written on chunk 0,
   * before anything is known) reports hasError = false and errorCount = 0
   * for a session the finalizer later marks as errored. A WHERE on those
   * columns would match the stale row and the argMax would then report
   * the truth - or, worse, would drop the group entirely.
   */
  @CaptureSpan()
  public static async listSessions(
    request: SessionReplayListRequest,
  ): Promise<SessionReplayListResult> {
    const limit: number = Math.max(
      1,
      Math.min(request.limit, MAX_SESSION_REPLAY_LIST_LIMIT),
    );

    const selectList: string = toSelectList(HEADER_AGGREGATES);

    const statement: Statement = SQL`
      SELECT
        sessionId,
        toString(rumApplicationId) AS applicationId,
    `;

    statement.append(`    ${selectList}`);

    if (request.includeIdentifiedUserLabel) {
      statement.append(
        `,\n        ${argMaxColumn("identifiedUserLabel")} AS aggIdentifiedUserLabel`,
      );
    }

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
        }}
    `);

    statement.append(RETENTION_FILTER);

    /*
     * Keyset cursor. The sort key is (projectId, rumApplicationId,
     * startTime, sessionId) and the list is ordered by the same tuple
     * descending, so the previous page's last startTime is a valid
     * WHERE-level upper bound: it prunes granules instead of paging with
     * OFFSET, which on a wide time window would re-read and re-aggregate
     * everything already returned. The exact ties are removed by the
     * HAVING tiebreak below - the WHERE bound is deliberately inclusive
     * so a row sharing the boundary timestamp is not skipped.
     */
    if (request.cursor) {
      statement.append(
        SQL` AND startTime <= ${{
          type: TableColumnType.DateTime64,
          value: new Date(request.cursor.startTimeUnixMs),
        }}`,
      );
    }

    statement.append(
      " GROUP BY projectId, rumApplicationId, sessionId\n      HAVING 1 = 1",
    );

    SessionReplayReadService.appendListHavingFilters(
      statement,
      request.filters,
    );

    if (request.cursor) {
      statement.append(
        SQL` AND (aggStartTime < ${{
          type: TableColumnType.Decimal,
          value: request.cursor.startTimeUnixMs,
        }} OR (aggStartTime = ${{
          type: TableColumnType.Decimal,
          value: request.cursor.startTimeUnixMs,
        }} AND sessionId < ${{
          type: TableColumnType.Text,
          value: request.cursor.sessionId,
        }}))`,
      );
    }

    statement.append(
      SQL` ORDER BY aggStartTime DESC, sessionId DESC
           LIMIT ${{
             type: TableColumnType.Number,
             value: limit + 1,
           }}`,
    );

    statement.append(READ_QUERY_SETTINGS);

    const dbResult: Results = await RumSessionService.executeQuery(statement);
    const response: DbJSONResponse = await dbResult.json<{
      data?: Array<JSONObject>;
    }>();

    const rows: Array<JSONObject> = response.data || [];

    /*
     * One row over the page size is fetched purely to learn whether a
     * next page exists without a second COUNT query over the same
     * aggregation.
     */
    const hasMore: boolean = rows.length > limit;
    const pageRows: Array<JSONObject> = hasMore ? rows.slice(0, limit) : rows;

    const sessions: Array<SessionReplayListItem> = pageRows.map(
      (row: JSONObject): SessionReplayListItem => {
        const item: SessionReplayListItem = {
          sessionId: readString(row, "sessionId"),
          rumApplicationId: readString(row, "applicationId"),
          startTime: readDate(row, "aggStartTime"),
          endTime: readDate(row, "aggEndTime"),
          durationMs: readNumber(row, "aggDurationMs"),
          isFinalized: readBoolean(row, "aggIsFinalized"),
          sealedReason: readString(row, "aggSealedReason"),
          chunkCount: readNumber(row, "aggChunkCount"),
          maxChunkIndex: readNumber(row, "aggMaxChunkIndex"),
          missingChunkCount: readNumber(row, "aggMissingChunkCount"),
          eventCount: readNumber(row, "aggEventCount"),
          payloadBytes: readNumber(row, "aggPayloadBytes"),
          hasError: readBoolean(row, "aggHasError"),
          errorCount: readNumber(row, "aggErrorCount"),
          rageClickCount: readNumber(row, "aggRageClickCount"),
          deadClickCount: readNumber(row, "aggDeadClickCount"),
          errorClickCount: readNumber(row, "aggErrorClickCount"),
          refreshRageCount: readNumber(row, "aggRefreshRageCount"),
          pageCount: readNumber(row, "aggPageCount"),
          triggerReason: readString(row, "aggTriggerReason"),
          entryUrl: readString(row, "aggEntryUrl"),
          exitUrl: readString(row, "aggExitUrl"),
          browserName: readString(row, "aggBrowserName"),
          browserVersion: readString(row, "aggBrowserVersion"),
          osName: readString(row, "aggOsName"),
          deviceType: readString(row, "aggDeviceType"),
          countryCode: readString(row, "aggCountryCode"),
          viewportWidth: readNumber(row, "aggViewportWidth"),
          viewportHeight: readNumber(row, "aggViewportHeight"),
          identifiedUserKey: readString(row, "aggIdentifiedUserKey"),
          samplePercentageAtCapture: readNumber(row, "aggSamplePercentage"),
        };

        if (request.includeIdentifiedUserLabel) {
          item.identifiedUserLabel = readString(row, "aggIdentifiedUserLabel");
        }

        return item;
      },
    );

    const lastSession: SessionReplayListItem | undefined =
      sessions[sessions.length - 1];

    return {
      sessions: sessions,
      nextCursor:
        hasMore && lastSession
          ? {
              startTimeUnixMs: lastSession.startTime.getTime(),
              sessionId: lastSession.sessionId,
            }
          : null,
    };
  }

  /*
   * The single header row for one session, de-duplicated the same way the
   * list is.
   *
   * This is also what resolves a sessionId to its owning RUM application
   * for the handler-level authorization check, which is why it is keyed
   * on (projectId, sessionId) only and never accepts an application id
   * from the caller: an application id supplied in the request body would
   * make the check circular.
   */
  @CaptureSpan()
  public static async getSessionHeader(data: {
    projectId: ObjectID;
    sessionId: string;
  }): Promise<SessionReplaySessionHeader | null> {
    const selectList: string = toSelectList([
      ...HEADER_AGGREGATES,
      ...HEADER_DETAIL_AGGREGATES,
    ]);

    const statement: Statement = SQL`
      SELECT
        sessionId,
        toString(projectId) AS headerProjectId,
        toString(rumApplicationId) AS applicationId,
    `;

    statement.append(`    ${selectList}`);

    statement.append(SQL`
      FROM ${AnalyticsTableName.RumSession}
      WHERE projectId = ${{
        type: TableColumnType.ObjectID,
        value: data.projectId,
      }}
        AND sessionId = ${{
          type: TableColumnType.Text,
          value: data.sessionId,
        }}
    `);

    statement.append(RETENTION_FILTER);

    /*
     * Grouped by the full replace-key identity minus startTime, so one
     * group per (application, session).
     *
     * LIMIT 2, not LIMIT 1. sessionId is minted by the browser and is
     * therefore fully caller-controlled, while the chunk table's replace
     * key is (projectId, sessionId, tabId, chunkIndex) with
     * rumApplicationId a plain column - two applications sharing a
     * sessionId share a key space. Picking the newest group would let
     * anyone who can write to application A resolve a sessionId belonging
     * to application B onto their own application and pass the label
     * check. An ambiguous sessionId is refused outright instead: it is
     * either an attack or a collision, and neither has a correct
     * recording to return.
     */
    statement.append(
      " GROUP BY projectId, rumApplicationId, sessionId ORDER BY aggStartTime DESC LIMIT 2",
    );

    statement.append(READ_QUERY_SETTINGS);

    const dbResult: Results = await RumSessionService.executeQuery(statement);
    const response: DbJSONResponse = await dbResult.json<{
      data?: Array<JSONObject>;
    }>();

    const rows: Array<JSONObject> = response.data || [];

    if (rows.length > 1) {
      throw new BadDataException(
        "This session id resolves to more than one RUM application and cannot be played back.",
      );
    }

    const row: JSONObject | undefined = rows[0];

    if (!row) {
      return null;
    }

    return {
      sessionId: readString(row, "sessionId"),
      projectId: readString(row, "headerProjectId"),
      rumApplicationId: readString(row, "applicationId"),
      startTime: readDate(row, "aggStartTime"),
      endTime: readDate(row, "aggEndTime"),
      durationMs: readNumber(row, "aggDurationMs"),
      isFinalized: readBoolean(row, "aggIsFinalized"),
      sealedReason: readString(row, "aggSealedReason"),
      chunkCount: readNumber(row, "aggChunkCount"),
      maxChunkIndex: readNumber(row, "aggMaxChunkIndex"),
      missingChunkCount: readNumber(row, "aggMissingChunkCount"),
      eventCount: readNumber(row, "aggEventCount"),
      payloadBytes: readNumber(row, "aggPayloadBytes"),
      hasError: readBoolean(row, "aggHasError"),
      errorCount: readNumber(row, "aggErrorCount"),
      rageClickCount: readNumber(row, "aggRageClickCount"),
      deadClickCount: readNumber(row, "aggDeadClickCount"),
      errorClickCount: readNumber(row, "aggErrorClickCount"),
      refreshRageCount: readNumber(row, "aggRefreshRageCount"),
      pageCount: readNumber(row, "aggPageCount"),
      triggerReason: readString(row, "aggTriggerReason"),
      maskingMode: readString(row, "aggMaskingMode"),
      consentState: readString(row, "aggConsentState"),
      recorderKind: readString(row, "aggRecorderKind"),
      recorderVersion: readString(row, "aggRecorderVersion"),
      rrwebVersion: readString(row, "aggRrwebVersion"),
      schemaVersion: readNumber(row, "aggSchemaVersion"),
      wireVersion: readNumber(row, "aggWireVersion"),
      entryUrl: readString(row, "aggEntryUrl"),
      exitUrl: readString(row, "aggExitUrl"),
      routes: readStringArray(row, "aggRoutes"),
      browserName: readString(row, "aggBrowserName"),
      browserVersion: readString(row, "aggBrowserVersion"),
      osName: readString(row, "aggOsName"),
      deviceType: readString(row, "aggDeviceType"),
      countryCode: readString(row, "aggCountryCode"),
      viewportWidth: readNumber(row, "aggViewportWidth"),
      viewportHeight: readNumber(row, "aggViewportHeight"),
      fidelityNotices: readStringArray(row, "aggFidelityNotices"),
      fullSnapshotChunkIndexes: readNumberArray(
        row,
        "aggFullSnapshotChunkIndexes",
      ),
      traceIds: readStringArray(row, "aggTraceIds"),
      exceptionFingerprints: readStringArray(row, "aggExceptionFingerprints"),
      clockSkewMs: readNumber(row, "aggClockSkewMs"),
    };
  }

  /*
   * Playback manifest: everything the player needs to draw a complete,
   * honest timeline without fetching one payload byte.
   *
   * The `payload` column is deliberately absent from this SELECT. That is
   * the entire performance story of the feature: a 14-chunk session is
   * one 128-row granule of a handful of narrow columns (~2 KB) instead of
   * megabytes of decompressed recording.
   */
  @CaptureSpan()
  public static async getManifest(data: {
    header: SessionReplaySessionHeader;
    projectId: ObjectID;
    /*
     * The application the caller was actually authorized against, always
     * the one resolved from the session header server-side. Every chunk
     * read is pinned to it: the chunk table's replace key does not
     * include rumApplicationId, so (projectId, sessionId) alone is not a
     * tenant-safe key once a sessionId can be reused across
     * applications.
     */
    rumApplicationId: ObjectID;
    sessionId: string;
  }): Promise<SessionReplayManifest> {
    /*
     * LIMIT 1 BY (tabId, chunkIndex) after ORDER BY ... version DESC
     * keeps exactly the highest-version row per chunk. tabId is part of
     * the group because chunkIndex is minted per tab. Ordering by
     * tabId/chunkIndex first (rather than by version alone) leaves the
     * output already sorted for the caller - LIMIT BY runs after ORDER
     * BY, so the version DESC tiebreak still selects the right row.
     */
    const statement: Statement = SQL`
      SELECT
        tabId,
        chunkIndex,
        chunkStartOffsetMs,
        chunkEndOffsetMs,
        eventCount,
        hasFullSnapshot,
        toFloat64(payloadBytes) AS chunkPayloadBytes,
        errorCount,
        rageClickCount,
        deadClickCount,
        errorClickCount,
        refreshRageCount,
        routeCount
      FROM ${AnalyticsTableName.RumSessionChunk}
      WHERE projectId = ${{
        type: TableColumnType.ObjectID,
        value: data.projectId,
      }}
        AND rumApplicationId = ${{
          type: TableColumnType.ObjectID,
          value: data.rumApplicationId,
        }}
        AND sessionId = ${{
          type: TableColumnType.Text,
          value: data.sessionId,
        }}
    `;

    statement.append(RETENTION_FILTER);

    statement.append(
      SQL` ORDER BY tabId ASC, chunkIndex ASC, version DESC
           LIMIT 1 BY tabId, chunkIndex
           LIMIT ${{
             type: TableColumnType.Number,
             value: MAX_MANIFEST_ROWS,
           }}`,
    );

    statement.append(READ_QUERY_SETTINGS);

    const dbResult: Results =
      await RumSessionChunkService.executeQuery(statement);
    const response: DbJSONResponse = await dbResult.json<{
      data?: Array<JSONObject>;
    }>();

    const rows: Array<JSONObject> = response.data || [];

    const tabsById: Map<
      string,
      Array<SessionReplayChunkManifestEntry>
    > = new Map<string, Array<SessionReplayChunkManifestEntry>>();

    for (const row of rows) {
      const tabId: string = readString(row, "tabId");

      const entry: SessionReplayChunkManifestEntry = {
        chunkIndex: readNumber(row, "chunkIndex"),
        tabId: tabId,
        chunkStartOffsetMs: readNumber(row, "chunkStartOffsetMs"),
        chunkEndOffsetMs: readNumber(row, "chunkEndOffsetMs"),
        eventCount: readNumber(row, "eventCount"),
        hasFullSnapshot: readBoolean(row, "hasFullSnapshot"),
        payloadBytes: readNumber(row, "chunkPayloadBytes"),
        errorCount: readNumber(row, "errorCount"),
        rageClickCount: readNumber(row, "rageClickCount"),
        deadClickCount: readNumber(row, "deadClickCount"),
        errorClickCount: readNumber(row, "errorClickCount"),
        refreshRageCount: readNumber(row, "refreshRageCount"),
        routeCount: readNumber(row, "routeCount"),
      };

      const existing: Array<SessionReplayChunkManifestEntry> | undefined =
        tabsById.get(tabId);

      if (existing) {
        existing.push(entry);
      } else {
        tabsById.set(tabId, [entry]);
      }
    }

    const tabs: Array<SessionReplayManifestTab> = [];

    for (const [tabId, entries] of tabsById) {
      tabs.push({
        tabId: tabId,
        chunks: entries,
        chunkIndexes: entries.map(
          (entry: SessionReplayChunkManifestEntry): number => {
            return entry.chunkIndex;
          },
        ),
        /*
         * Seek anchors come from the chunk rows rather than from the
         * header's fullSnapshotChunkIndexes: the header is only written
         * by the finalizer, so a still-recording session would otherwise
         * have no anchors at all and could not be scrubbed.
         */
        fullSnapshotChunkIndexes: entries
          .filter((entry: SessionReplayChunkManifestEntry): boolean => {
            return entry.hasFullSnapshot;
          })
          .map((entry: SessionReplayChunkManifestEntry): number => {
            return entry.chunkIndex;
          }),
        gaps: ChunkMath.detectGaps(entries),
        maxChunkIndex: entries.reduce(
          (max: number, entry: SessionReplayChunkManifestEntry): number => {
            return Math.max(max, entry.chunkIndex);
          },
          0,
        ),
        totalPayloadBytes: entries.reduce(
          (total: number, entry: SessionReplayChunkManifestEntry): number => {
            return total + entry.payloadBytes;
          },
          0,
        ),
      });
    }

    return {
      header: data.header,
      tabs: tabs,
      isChunkIndexTruncated: rows.length >= MAX_MANIFEST_ROWS,
    };
  }

  /*
   * Total STORED bytes for a specific set of chunks, without shipping the
   * payload column to the application.
   *
   * `length(payload)`, deliberately NOT `payloadBytes`. Those are two
   * different quantities: payloadBytes is the post-gzip WIRE size the
   * recorder uploaded (the metering signal), while the payload column
   * holds the DECOMPRESSED JSON and is what this endpoint actually
   * returns. rrweb JSON gzips 10-20x, so a cap applied to payloadBytes
   * bounds a number an order of magnitude smaller than the response and
   * therefore bounds nothing useful.
   *
   * The cost is that ClickHouse has to decompress the column to measure
   * it, which is exactly what naming `payload` was meant to avoid. It is
   * still worth doing before the read rather than after: the bytes are
   * measured inside ClickHouse and never cross the wire, and the marks
   * the following read needs are warm by the time it runs.
   */
  @CaptureSpan()
  public static async getChunkStoredBytes(data: {
    projectId: ObjectID;
    rumApplicationId: ObjectID;
    sessionId: string;
    tabId: string;
    chunkIndexes: Array<number>;
  }): Promise<number> {
    if (data.chunkIndexes.length === 0) {
      return 0;
    }

    const statement: Statement = SQL`
      SELECT
        chunkIndex,
        toFloat64(length(payload)) AS chunkStoredBytes
      FROM ${AnalyticsTableName.RumSessionChunk}
      WHERE projectId = ${{
        type: TableColumnType.ObjectID,
        value: data.projectId,
      }}
        AND rumApplicationId = ${{
          type: TableColumnType.ObjectID,
          value: data.rumApplicationId,
        }}
        AND sessionId = ${{
          type: TableColumnType.Text,
          value: data.sessionId,
        }}
        AND tabId = ${{
          type: TableColumnType.Text,
          value: data.tabId,
        }}
        AND chunkIndex IN (${{
          type: TableColumnType.Number,
          value: new Includes(data.chunkIndexes),
        }})
    `;

    statement.append(RETENTION_FILTER);

    /*
     * Deduplicated exactly like the payload read, so the pre-check and
     * the read it guards can never disagree about which rows count.
     * Summed in TypeScript rather than in SQL because the row count is
     * bounded by MAX_SESSION_REPLAY_CHUNKS_PER_READ, and a wrapping
     * aggregate would need a subquery whose LIMIT BY semantics are
     * easier to get subtly wrong than to read.
     */
    statement.append(
      " ORDER BY chunkIndex ASC, version DESC LIMIT 1 BY chunkIndex",
    );

    statement.append(READ_QUERY_SETTINGS);

    const dbResult: Results =
      await RumSessionChunkService.executeQuery(statement);
    const response: DbJSONResponse = await dbResult.json<{
      data?: Array<JSONObject>;
    }>();

    return (response.data || []).reduce(
      (total: number, row: JSONObject): number => {
        return total + readNumber(row, "chunkStoredBytes");
      },
      0,
    );
  }

  /*
   * The payload read. The only query in the system that names the
   * `payload` column.
   *
   * Both caps are enforced here rather than only at the route so no
   * future caller can reach the payload column without them.
   */
  @CaptureSpan()
  public static async getChunks(data: {
    projectId: ObjectID;
    rumApplicationId: ObjectID;
    sessionId: string;
    tabId: string;
    chunkIndexes: Array<number>;
  }): Promise<Array<SessionReplayChunkPayload>> {
    if (data.chunkIndexes.length === 0) {
      return [];
    }

    if (data.chunkIndexes.length > MAX_SESSION_REPLAY_CHUNKS_PER_READ) {
      throw new BadDataException(
        `A maximum of ${MAX_SESSION_REPLAY_CHUNKS_PER_READ} chunks may be requested at a time.`,
      );
    }

    const totalBytes: number =
      await SessionReplayReadService.getChunkStoredBytes(data);

    if (totalBytes > MAX_SESSION_REPLAY_READ_BYTES) {
      throw new BadDataException(
        `The requested chunks total ${totalBytes} bytes, which exceeds the ${MAX_SESSION_REPLAY_READ_BYTES} byte limit for a single read. Request fewer chunks.`,
      );
    }

    const statement: Statement = SQL`
      SELECT
        chunkIndex,
        payload
      FROM ${AnalyticsTableName.RumSessionChunk}
      WHERE projectId = ${{
        type: TableColumnType.ObjectID,
        value: data.projectId,
      }}
        AND rumApplicationId = ${{
          type: TableColumnType.ObjectID,
          value: data.rumApplicationId,
        }}
        AND sessionId = ${{
          type: TableColumnType.Text,
          value: data.sessionId,
        }}
        AND tabId = ${{
          type: TableColumnType.Text,
          value: data.tabId,
        }}
        AND chunkIndex IN (${{
          type: TableColumnType.Number,
          value: new Includes(data.chunkIndexes),
        }})
    `;

    statement.append(RETENTION_FILTER);

    /*
     * A retried delivery is two physically present rows on a
     * ReplacingMergeTree until a merge runs. Feeding both to the player
     * would replay the same mutations twice, which rrweb resolves against
     * node ids and would either throw or render a DOM that never existed.
     */
    statement.append(
      " ORDER BY chunkIndex ASC, version DESC LIMIT 1 BY chunkIndex",
    );

    statement.append(READ_QUERY_SETTINGS);

    const dbResult: Results =
      await RumSessionChunkService.executeQuery(statement);
    const response: DbJSONResponse = await dbResult.json<{
      data?: Array<JSONObject>;
    }>();

    /*
     * The cap is re-applied to the bytes actually being handed back, not
     * only to what the pre-check believed. The pre-check reads a
     * different snapshot of a ReplacingMergeTree than the read it guards,
     * and any future change to how stored size is derived would otherwise
     * silently unbound the response. Accumulated as the rows are mapped
     * so an oversized read fails before the caller ever holds the whole
     * set.
     */
    let totalReturnedBytes: number = 0;
    const chunks: Array<SessionReplayChunkPayload> = [];

    for (const row of response.data || []) {
      const payload: string = readString(row, "payload");

      totalReturnedBytes += Buffer.byteLength(payload, "utf8");

      if (totalReturnedBytes > MAX_SESSION_REPLAY_READ_BYTES) {
        throw new BadDataException(
          `The requested chunks exceed the ${MAX_SESSION_REPLAY_READ_BYTES} byte limit for a single read. Request fewer chunks.`,
        );
      }

      chunks.push({
        chunkIndex: readNumber(row, "chunkIndex"),
        payload: payload,
      });
    }

    return chunks;
  }

  /*
   * Sessions that observed a given exception fingerprint.
   *
   * hasAny() appears twice on purpose. In the WHERE it is a bloom-pruned
   * pre-filter over physical rows; a group survives it if ANY of its rows
   * carries the fingerprint, which necessarily includes the case where
   * the winning (highest version) row does - so the pre-filter cannot
   * drop a true match. The HAVING then re-checks the argMax'd array so a
   * fingerprint present only on a superseded row does not produce a false
   * positive.
   */
  @CaptureSpan()
  public static async getSessionsForException(data: {
    projectId: ObjectID;
    exceptionFingerprint: string;
    /*
     * null means "no label restriction". An EMPTY array means the caller
     * can reach no applications at all and must get no rows - the two are
     * not the same and collapsing them would leak every session in the
     * project.
     */
    accessibleRumApplicationIds: Array<ObjectID> | null;
    startTime?: Date | undefined;
    endTime?: Date | undefined;
    limit: number;
  }): Promise<Array<SessionReplayExceptionSession>> {
    if (
      data.accessibleRumApplicationIds &&
      data.accessibleRumApplicationIds.length === 0
    ) {
      return [];
    }

    const limit: number = Math.max(
      1,
      Math.min(data.limit, MAX_SESSION_REPLAY_FOR_EXCEPTION_LIMIT),
    );

    const selectList: string = toSelectList([
      { alias: "aggStartTime", expression: argMaxDateTime("startTime") },
      { alias: "aggEndTime", expression: argMaxDateTime("endTime") },
      { alias: "aggDurationMs", expression: argMaxNumeric("durationMs") },
      { alias: "aggHasError", expression: argMaxColumn("hasError") },
      { alias: "aggErrorCount", expression: argMaxNumeric("errorCount") },
      /*
       * The frustration counters and masking mode feed the "Watch what the
       * user saw" card: the signals line ("2 rage clicks before the error")
       * and the up-front masking disclosure both come from here. Omitting
       * them renders the card with empty signals and "unknown" masking.
       */
      {
        alias: "aggRageClickCount",
        expression: argMaxNumeric("rageClickCount"),
      },
      {
        alias: "aggDeadClickCount",
        expression: argMaxNumeric("deadClickCount"),
      },
      {
        alias: "aggErrorClickCount",
        expression: argMaxNumeric("errorClickCount"),
      },
      {
        alias: "aggRefreshRageCount",
        expression: argMaxNumeric("refreshRageCount"),
      },
      { alias: "aggMaskingMode", expression: argMaxColumn("maskingMode") },
      { alias: "aggTriggerReason", expression: argMaxColumn("triggerReason") },
      { alias: "aggEntryUrl", expression: argMaxColumn("entryUrl") },
      { alias: "aggBrowserName", expression: argMaxColumn("browserName") },
      { alias: "aggOsName", expression: argMaxColumn("osName") },
      { alias: "aggDeviceType", expression: argMaxColumn("deviceType") },
      { alias: "aggIsFinalized", expression: argMaxColumn("isFinalized") },
      {
        alias: "aggExceptionFingerprints",
        expression: argMaxColumn("exceptionFingerprints"),
      },
    ]);

    const statement: Statement = SQL`
      SELECT
        sessionId,
        toString(rumApplicationId) AS applicationId,
    `;

    statement.append(`    ${selectList}`);

    statement.append(SQL`
      FROM ${AnalyticsTableName.RumSession}
      WHERE projectId = ${{
        type: TableColumnType.ObjectID,
        value: data.projectId,
      }}
        AND hasAny(exceptionFingerprints, [${{
          type: TableColumnType.Text,
          value: data.exceptionFingerprint,
        }}])
    `);

    statement.append(RETENTION_FILTER);

    if (data.accessibleRumApplicationIds) {
      statement.append(
        SQL` AND rumApplicationId IN (${{
          type: TableColumnType.ObjectID,
          value: new Includes(data.accessibleRumApplicationIds),
        }})`,
      );
    }

    if (data.startTime) {
      statement.append(
        SQL` AND startTime >= ${{
          type: TableColumnType.DateTime64,
          value: data.startTime,
        }}`,
      );
    }

    if (data.endTime) {
      statement.append(
        SQL` AND startTime <= ${{
          type: TableColumnType.DateTime64,
          value: data.endTime,
        }}`,
      );
    }

    statement.append(
      SQL` GROUP BY projectId, rumApplicationId, sessionId
           HAVING hasAny(aggExceptionFingerprints, [${{
             type: TableColumnType.Text,
             value: data.exceptionFingerprint,
           }}])
           ORDER BY aggStartTime DESC
           LIMIT ${{
             type: TableColumnType.Number,
             value: limit,
           }}`,
    );

    statement.append(READ_QUERY_SETTINGS);

    const dbResult: Results = await RumSessionService.executeQuery(statement);
    const response: DbJSONResponse = await dbResult.json<{
      data?: Array<JSONObject>;
    }>();

    return (response.data || []).map(
      (row: JSONObject): SessionReplayExceptionSession => {
        return {
          sessionId: readString(row, "sessionId"),
          rumApplicationId: readString(row, "applicationId"),
          startTime: readDate(row, "aggStartTime"),
          endTime: readDate(row, "aggEndTime"),
          durationMs: readNumber(row, "aggDurationMs"),
          hasError: readBoolean(row, "aggHasError"),
          errorCount: readNumber(row, "aggErrorCount"),
          rageClickCount: readNumber(row, "aggRageClickCount"),
          deadClickCount: readNumber(row, "aggDeadClickCount"),
          errorClickCount: readNumber(row, "aggErrorClickCount"),
          refreshRageCount: readNumber(row, "aggRefreshRageCount"),
          maskingMode: readString(row, "aggMaskingMode"),
          triggerReason: readString(row, "aggTriggerReason"),
          entryUrl: readString(row, "aggEntryUrl"),
          browserName: readString(row, "aggBrowserName"),
          osName: readString(row, "aggOsName"),
          deviceType: readString(row, "aggDeviceType"),
          isFinalized: readBoolean(row, "aggIsFinalized"),
        };
      },
    );
  }

  private static appendListHavingFilters(
    statement: Statement,
    filters: SessionReplayListFilters,
  ): void {
    if (filters.hasError !== undefined) {
      statement.append(
        SQL` AND aggHasError = ${{
          type: TableColumnType.Boolean,
          value: filters.hasError,
        }}`,
      );
    }

    if (filters.hasFrustration !== undefined) {
      /*
       * Over the argMax aliases, like every HAVING predicate here — the
       * raw columns would sum across ReplacingMergeTree versions.
       *
       * `!== undefined` rather than `=== true`, so `false` means "sessions
       * with NO frustration signals" instead of being silently dropped. The
       * route admits any boolean, and hasError / isFinalized beside it both
       * honour false, so accepting the value and ignoring it returned the
       * whole unfiltered list with a 200 and no indication why.
       */
      const total: string =
        "(aggRageClickCount + aggDeadClickCount + aggErrorClickCount + aggRefreshRageCount)";

      statement.append(
        filters.hasFrustration ? ` AND ${total} > 0` : ` AND ${total} = 0`,
      );
    }

    if (filters.isFinalized !== undefined) {
      statement.append(
        SQL` AND aggIsFinalized = ${{
          type: TableColumnType.Boolean,
          value: filters.isFinalized,
        }}`,
      );
    }

    if (filters.triggerReasons && filters.triggerReasons.length > 0) {
      statement.append(
        SQL` AND aggTriggerReason IN (${{
          type: TableColumnType.Text,
          value: new Includes(filters.triggerReasons),
        }})`,
      );
    }

    if (filters.browserNames && filters.browserNames.length > 0) {
      statement.append(
        SQL` AND aggBrowserName IN (${{
          type: TableColumnType.Text,
          value: new Includes(filters.browserNames),
        }})`,
      );
    }

    if (filters.osNames && filters.osNames.length > 0) {
      statement.append(
        SQL` AND aggOsName IN (${{
          type: TableColumnType.Text,
          value: new Includes(filters.osNames),
        }})`,
      );
    }

    if (filters.deviceTypes && filters.deviceTypes.length > 0) {
      statement.append(
        SQL` AND aggDeviceType IN (${{
          type: TableColumnType.Text,
          value: new Includes(filters.deviceTypes),
        }})`,
      );
    }

    if (filters.countryCodes && filters.countryCodes.length > 0) {
      statement.append(
        SQL` AND aggCountryCode IN (${{
          type: TableColumnType.Text,
          value: new Includes(filters.countryCodes),
        }})`,
      );
    }

    if (filters.identifiedUserKey) {
      statement.append(
        SQL` AND aggIdentifiedUserKey = ${{
          type: TableColumnType.Text,
          value: filters.identifiedUserKey,
        }}`,
      );
    }

    if (filters.route) {
      /*
       * `has`, not a Search/LIKE. StatementGenerator's own comment calls
       * restoring the exact-match array fast path "the single biggest
       * performance fix" - a lowerUTF8 arrayExists has no bloom
       * pre-filter and full-scans the table.
       *
       * The argMax expression is appended as raw SQL rather than
       * interpolated into the template: a plain string substituted into
       * an SQL`` literal is bound as an Identifier and would be quoted.
       */
      statement.append(` AND has(${argMaxColumn("routes")}, `);
      statement.append(
        SQL`${{
          type: TableColumnType.Text,
          value: filters.route,
        }})`,
      );
    }

    if (
      filters.minDurationMs !== undefined &&
      Number.isFinite(filters.minDurationMs)
    ) {
      statement.append(
        SQL` AND aggDurationMs >= ${{
          type: TableColumnType.Decimal,
          value: filters.minDurationMs,
        }}`,
      );
    }
  }
}
