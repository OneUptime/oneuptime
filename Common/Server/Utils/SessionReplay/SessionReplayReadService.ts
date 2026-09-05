import { SQL, Statement } from "../AnalyticsDatabase/Statement";
import { getQuerySettings } from "../AnalyticsDatabase/QuerySettingsHelper";
import RumSessionService from "../../Services/RumSessionService";
import RumSessionChunkService from "../../Services/RumSessionChunkService";
import ExceptionInstanceService from "../../Services/ExceptionInstanceService";
import {
  DbJSONResponse,
  Results,
} from "../../Services/AnalyticsDatabaseService";
import logger from "../Logger";
import AnalyticsTableName from "../../../Types/AnalyticsDatabase/AnalyticsTableName";
import TableColumnType from "../../../Types/AnalyticsDatabase/TableColumnType";
import Includes from "../../../Types/BaseDatabase/Includes";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import OneUptimeDate from "../../../Types/Date";
import ChunkMath from "../../../Utils/Rum/ChunkMath";
import {
  MAX_SESSION_REPLAY_CHUNKS_PER_READ,
  MAX_SESSION_REPLAY_READ_BYTES,
  SESSION_REPLAY_LIST_SEARCH_MAX_LENGTH,
  SESSION_REPLAY_MAX_SESSION_MS,
  SESSION_REPLAY_MAX_TAG_KEYS,
  SESSION_REPLAY_RECORDER_CAPABILITIES,
  SessionReplayChunkManifestEntry,
  SessionReplayGap,
  SessionReplaySealedReason,
} from "../../../Types/Rum/SessionReplay";
import {
  SESSION_REPLAY_SORT_BY_VALUES,
  SessionReplaySortBy,
  SessionReplaySortedListCursorDto,
} from "../../../Types/Rum/SessionReplayApi";
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
 *     getChunks is the one read that names it, and it measures
 *     `length(payload)` in the same statement that ships the bytes, so
 *     the column is decompressed exactly once per page.
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
 * Default window for the exception -> replay lookup when the caller gives
 * none. RumSession is partitioned by day, so an unbounded lookup scans
 * every partition the project has ever written; 30 days covers every
 * retention tier a recording can still be played under.
 */
export const DEFAULT_SESSION_REPLAY_FOR_EXCEPTION_WINDOW_DAYS: number = 30;

/*
 * Sessions the exception-instance side index may name. The instance table
 * carries the session id of the page that threw, which is how a session
 * is found BEFORE the finalizer has written its fingerprint list.
 */
const MAX_EXCEPTION_INSTANCE_SESSION_IDS: number = 100;

/*
 * Padding around an exception's own timestamp when the caller pins the
 * lookup to a moment: a session that contains the error started at most
 * SESSION_REPLAY_MAX_SESSION_MS before it, and clock skew between the
 * browser and the server is bounded far below this.
 */
export const SESSION_REPLAY_EXCEPTION_WINDOW_PADDING_MS: number = 5 * 60 * 1000;

/*
 * Row ceiling on one manifest. A session is capped at
 * MAX_SESSION_REPLAY_CHUNKS_PER_SESSION (480) chunks PER TAB, and a
 * session can legitimately span several tabs, so the manifest is bounded
 * separately. Hitting it is reported rather than silently truncating the
 * timeline.
 */
const MAX_MANIFEST_ROWS: number = 4096;

/*
 * How long one application's activity summary is served from memory. The
 * health card polls every 10-60s per viewer and the summary is a small
 * aggregate over a day of headers, so a 30s cache turns N viewers into
 * one ClickHouse query per pod per half minute.
 */
export const SESSION_REPLAY_ACTIVITY_SUMMARY_CACHE_TTL_MS: number = 30 * 1000;
const MAX_ACTIVITY_SUMMARY_CACHE_ENTRIES: number = 1000;

/* The header attribute the ingest writes chunk 0's capability list into. */
export const RECORDER_CAPABILITIES_ATTRIBUTE: string = "recorder.capabilities";

/*
 * The keyset cursor the list accepts and emits. The legacy
 * {startTimeUnixMs, sessionId} shape is normalised to this by
 * parseSessionReplayListCursor before it reaches the service.
 */
export type SessionReplayListCursor = SessionReplaySortedListCursorDto;

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
  /*
   * Free text: sessionId prefix, entry/exit URL and routes substring, exact
   * trace id, and the identified user label when the caller may read it.
   * Capped at SESSION_REPLAY_LIST_SEARCH_MAX_LENGTH by the handler.
   */
  search?: string | undefined;
  /* startsWith over the routes array and the entry URL. */
  urlPrefix?: string | undefined;
  /* Every pair must match the session's tag map. */
  tags?: Record<string, string> | undefined;
  hasIdentifiedUser?: boolean | undefined;
  /* (not finalized OR has chunks) AND not recording-lost. */
  isPlayable?: boolean | undefined;
  hasTraces?: boolean | undefined;
}

export interface SessionReplayListRequest {
  projectId: ObjectID;
  rumApplicationId: ObjectID;
  startTime: Date;
  endTime: Date;
  filters: SessionReplayListFilters;
  limit: number;
  cursor?: SessionReplayListCursor | undefined;
  /* Absent means "startTime", which is what the list always did. */
  sortBy?: SessionReplaySortBy | undefined;
  /*
   * The raw end-user identifier has its own, narrower column ACL than the
   * rest of the header row. This raw-SQL path never invokes
   * ModelPermission, so the caller decides column-by-column and the
   * column is simply not named in the SELECT when it is not permitted.
   * Gates the traits column and the label half of the search predicate
   * as well.
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
  identifiedUserTraits?: Record<string, string> | undefined;
  samplePercentageAtCapture: number;
  /* First MAX_LIST_ROUTES routes, in order. */
  routes: Array<string>;
  traceCount: number;
  exceptionGroupCount: number;
  /*
   * The first exception fingerprint of the session, "" when there is none.
   * The list's errors badge links at the exception group with it.
   */
  topExceptionFingerprint: string;
  clickCount: number;
  activeMs: number;
  firstErrorOffsetMs: number;
  expiresAtUnixMs: number;
  tags: Record<string, string>;
  startTimeUnixMs: number;
  endTimeUnixMs: number;
}

export interface SessionReplayListResult {
  sessions: Array<SessionReplayListItem>;
  nextCursor: SessionReplayListCursor | null;
}

/* Routes projected onto a list row; the table shows three and says "(N pages)". */
export const MAX_LIST_ROUTES: number = 5;

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
  /*
   * The session clock as numbers, so the player places every telemetry
   * row at rowUnixMs - startTimeUnixMs without re-parsing an ISO string.
   */
  startTimeUnixMs: number;
  endTimeUnixMs: number;
  /* The recorder's own start clock, before the server clamped it. */
  clientReportedStartUnixMs: number;
  tags: Record<string, string>;
  expiresAtUnixMs: number;
  clickCount: number;
  customEventCount: number;
  activeMs: number;
  firstErrorOffsetMs: number;
  /*
   * From chunk 0's envelope (attributes["recorder.capabilities"]); empty
   * for recordings that predate the field.
   */
  recorderCapabilities: Array<string>;
  /*
   * Never populated by getSessionHeader. The manifest handler fills them
   * from getSessionIdentity ONLY after canReadIdentifiedUserLabel passes,
   * so no statement names the identity columns for a caller who may not
   * read them.
   */
  identifiedUserLabel?: string | undefined;
  identifiedUserTraits?: Record<string, string> | undefined;
}

/* The two identity columns, read separately behind the identity ACL. */
export interface SessionReplaySessionIdentity {
  identifiedUserLabel: string;
  identifiedUserTraits: Record<string, string>;
}

/*
 * What is still knowable about a session whose header has aged out of
 * retention (or was never finalized), for the "this recording expired on
 * <date>" answer instead of a bare "not found".
 */
export interface SessionReplayExpiredSessionInfo {
  rumApplicationId: string;
  startTime: Date;
  expiresAt: Date;
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
  /* Where this tab's footage begins on the session clock. */
  firstChunkStartOffsetMs: number;
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

export interface SessionReplayChunkReadResult {
  /* The longest contiguous prefix of the requested chunks under the cap. */
  chunks: Array<SessionReplayChunkPayload>;
  /*
   * Chunks that exist and were requested but did not fit under
   * MAX_SESSION_REPLAY_READ_BYTES behind the ones served. A chunk absent
   * from storage is NOT listed here: that is a gap, not an omission.
   */
  omittedChunkIndexes: Array<number>;
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

export interface SessionReplayApplicationActivitySummary {
  /* null when ClickHouse could not answer; the UI renders "unknown". */
  sessionsLast24h: number | null;
  playableSessionsLast24h: number | null;
  /* null when the application has no session in retention. */
  lastSessionStartedAt: Date | null;
  /*
   * What the NEWEST session's recorder said it could capture, filtered to
   * the known vocabulary. null when there is no session in retention, when
   * that session predates the attribute, or when the query failed - all
   * three render as "not reported yet", which is the honest answer.
   *
   * This is how an operator spots a stale cached recorder artifact
   * ("click labels: no") without opening a recording, which would write an
   * audit row. It rides on the last-session query that is already run for
   * lastSessionStartedAt, so it costs no extra round trip.
   */
  recorderCapabilities: Array<string> | null;
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

/* A Date column (retentionDate) as unix milliseconds. */
function argMaxDate(column: string): string {
  return `toFloat64(toUnixTimestamp(${argMaxColumn(column)})) * 1000`;
}

/*
 * Duration that stays honest for a session the finalizer has not reached.
 *
 * The provisional header is written on chunk 0 with durationMs 0 and
 * endTime = chunk 0's end, and it stays that way for the 10+ minutes of
 * idleness the finalizer waits for. Reported verbatim, every live or
 * recently finished session read "0s" in the list and a "longer than"
 * filter hid all of them - the first thing a person testing their install
 * sees is a session that claims to be empty. Until the finalized row
 * exists, the span the header itself asserts (endTime - startTime) is the
 * best lower bound there is, so the live value is the larger of the two.
 * The finalized row's durationMs is authoritative and is used as-is.
 */
/*
 * durationMs is Int128 on disk while the clock arithmetic is Int64; both
 * branches are cast to Int64 (a session is capped at four hours, so the
 * cast cannot overflow) so `if` and `greatest` see one type.
 */
const LIVE_DURATION_EXPRESSION: string = `toFloat64(if(${argMaxColumn(
  "isFinalized",
)}, toInt64(${argMaxColumn("durationMs")}), greatest(toInt64(${argMaxColumn(
  "durationMs",
)}), toUnixTimestamp64Milli(${argMaxColumn(
  "endTime",
)}) - toUnixTimestamp64Milli(${argMaxColumn("startTime")}))))`;

/*
 * The frustration total, shared by the hasFrustration predicate and the
 * "frustration" sort so the two can never disagree about what counts.
 */
const FRUSTRATION_TOTAL_EXPRESSION: string =
  "(aggRageClickCount + aggDeadClickCount + aggErrorClickCount + aggRefreshRageCount)";

/*
 * Aliases deliberately differ from the physical column names. See the
 * ILLEGAL_AGGREGATION note in the file header.
 */
const HEADER_AGGREGATES: Array<AggregatedColumn> = [
  { alias: "aggStartTime", expression: argMaxDateTime("startTime") },
  { alias: "aggEndTime", expression: argMaxDateTime("endTime") },
  { alias: "aggDurationMs", expression: LIVE_DURATION_EXPRESSION },
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
  /*
   * The full routes array: the list projects the first MAX_LIST_ROUTES and
   * the urlPrefix / search predicates run over the argMax'd whole, never
   * the raw column (which would match a superseded header version).
   */
  { alias: "aggRoutes", expression: argMaxColumn("routes") },
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
  /*
   * Counts rather than the arrays themselves: the list only says "3 traces"
   * and "2 exception groups", and the hasTraces predicate needs a number.
   */
  {
    alias: "aggTraceCount",
    expression: `toFloat64(length(${argMaxColumn("traceIds")}))`,
  },
  {
    alias: "aggExceptionGroupCount",
    expression: `toFloat64(length(${argMaxColumn("exceptionFingerprints")}))`,
  },
  /*
   * The first fingerprint, so the list's "3 errors" badge can link at the
   * exception group instead of at an unfiltered Exceptions page. Empty
   * string when the session recorded no exception group; arrayElement on
   * an empty array returns the type's default, which for String is ''.
   */
  {
    alias: "aggTopExceptionFingerprint",
    expression: `arrayElement(${argMaxColumn("exceptionFingerprints")}, 1)`,
  },
  { alias: "aggClickCount", expression: argMaxNumeric("clickCount") },
  { alias: "aggActiveMs", expression: argMaxNumeric("activeMs") },
  {
    alias: "aggFirstErrorOffsetMs",
    expression: argMaxNumeric("firstErrorOffsetMs"),
  },
  { alias: "aggExpiresAt", expression: argMaxDate("retentionDate") },
  { alias: "aggTags", expression: argMaxColumn("tags") },
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
  {
    alias: "aggClientReportedStart",
    expression: argMaxDateTime("clientReportedStartTime"),
  },
  {
    alias: "aggCustomEventCount",
    expression: argMaxNumeric("customEventCount"),
  },
  { alias: "aggAttributes", expression: argMaxColumn("attributes") },
];

/*
 * The two columns under the identity ACL. Named in a statement ONLY when
 * the caller has already passed canReadIdentifiedUserLabel for the
 * application the statement is pinned to.
 */
const IDENTITY_AGGREGATES: Array<AggregatedColumn> = [
  {
    alias: "aggIdentifiedUserLabel",
    expression: argMaxColumn("identifiedUserLabel"),
  },
  {
    alias: "aggIdentifiedUserTraits",
    expression: argMaxColumn("identifiedUserTraits"),
  },
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
 * A Map(String, String) column. ClickHouse serialises it as a JSON object;
 * anything else (including an array, or a row that predates the column)
 * reads as an empty map.
 */
function readStringMap(row: JSONObject, key: string): Record<string, string> {
  const value: unknown = row[key];
  const result: Record<string, string> = {};

  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return result;
  }

  for (const entryKey of Object.keys(value as Record<string, unknown>)) {
    const entry: unknown = (value as Record<string, unknown>)[entryKey];

    if (typeof entry === "string") {
      result[entryKey] = entry;
    } else if (typeof entry === "number" || typeof entry === "boolean") {
      result[entryKey] = String(entry);
    }
  }

  return result;
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

/*
 * The capability list chunk 0 declared, filtered to the vocabulary this
 * build knows so a stored typo never reaches the player as a capability.
 */
function readRecorderCapabilities(row: JSONObject): Array<string> {
  const attributes: Record<string, string> = readStringMap(
    row,
    "aggAttributes",
  );
  const raw: string | undefined = attributes[RECORDER_CAPABILITIES_ATTRIBUTE];

  if (!raw) {
    return [];
  }

  return raw
    .split(",")
    .map((capability: string): string => {
      return capability.trim();
    })
    .filter((capability: string): boolean => {
      return SESSION_REPLAY_RECORDER_CAPABILITIES.includes(capability);
    });
}

interface ActivitySummaryCacheEntry {
  summary: SessionReplayApplicationActivitySummary;
  expiresAt: number;
}

const activitySummaryCache: Map<string, ActivitySummaryCacheEntry> = new Map<
  string,
  ActivitySummaryCacheEntry
>();

/*
 * Where the published recorder version comes from. The recorder manifest
 * is read by App/FeatureSet/BrowserRecorder/Manifest.ts, which lives in
 * the App tree and cannot be imported from Common; the feature set that
 * mounts the read routes registers the reader at boot. Until it does, the
 * ingest-status route answers null - "unknown", never a guessed version.
 */
type PublishedRecorderVersionProvider = () => string | null;

let publishedRecorderVersionProvider: PublishedRecorderVersionProvider | null =
  null;

export default class SessionReplayReadService {
  public static setPublishedRecorderVersionProvider(
    provider: PublishedRecorderVersionProvider | null,
  ): void {
    publishedRecorderVersionProvider = provider;
  }

  public static getPublishedRecorderVersion(): string | null {
    if (!publishedRecorderVersionProvider) {
      return null;
    }

    try {
      const version: string | null = publishedRecorderVersionProvider();

      return typeof version === "string" && version.length > 0 ? version : null;
    } catch {
      return null;
    }
  }

  /* Test seam: the summary cache is process-local. */
  public static clearActivitySummaryCache(): void {
    activitySummaryCache.clear();
  }

  /*
   * Session list.
   *
   * projectId / rumApplicationId / startTime go in the WHERE because they
   * are the first three elements of the sort key AND they are part of the
   * ReplacingMergeTree replace key, so they are byte-identical on every
   * duplicate row of a session. Filtering on them before the GROUP BY is
   * therefore both index-friendly and safe. Nothing else is ever added to
   * the WHERE: any other predicate would have to run over raw rows and
   * would either match a superseded header version or force a scan that
   * the (projectId, rumApplicationId, startTime) prefix cannot prune.
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

    const sortBy: SessionReplaySortBy = request.sortBy || "startTime";

    if (!SESSION_REPLAY_SORT_BY_VALUES.includes(sortBy)) {
      throw new BadDataException(
        `sortBy must be one of ${SESSION_REPLAY_SORT_BY_VALUES.join(", ")}.`,
      );
    }

    if (request.cursor && request.cursor.sortBy !== sortBy) {
      /*
       * A cursor is a position in ONE ordering. Applying a "most errors"
       * cursor to a "newest" list would silently skip or repeat sessions.
       */
      throw new BadDataException(
        `The cursor belongs to a list sorted by ${request.cursor.sortBy}, not ${sortBy}. Start from the first page.`,
      );
    }

    const selectList: string = toSelectList(HEADER_AGGREGATES);

    const statement: Statement = SQL`
      SELECT
        sessionId,
        toString(rumApplicationId) AS applicationId,
    `;

    statement.append(`    ${selectList}`);

    if (request.includeIdentifiedUserLabel) {
      statement.append(`,\n        ${toSelectList(IDENTITY_AGGREGATES)}`);
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
     * startTime, sessionId) and the newest-first list is ordered by the
     * same tuple descending, so the previous page's last startTime is a
     * valid WHERE-level upper bound: it prunes granules instead of paging
     * with OFFSET, which on a wide time window would re-read and
     * re-aggregate everything already returned. The exact ties are
     * removed by the HAVING tiebreak below - the WHERE bound is
     * deliberately inclusive so a row sharing the boundary timestamp is
     * not skipped.
     *
     * Only for the startTime sort: for any other key the cursor value is
     * an aggregate, and a WHERE on startTime would drop sessions that
     * belong on later pages.
     */
    if (request.cursor && sortBy === "startTime") {
      statement.append(
        SQL` AND startTime <= ${{
          type: TableColumnType.DateTime64,
          value: new Date(request.cursor.sortValue),
        }}`,
      );
    }

    statement.append(
      " GROUP BY projectId, rumApplicationId, sessionId\n      HAVING 1 = 1",
    );

    SessionReplayReadService.appendListHavingFilters(
      statement,
      request.filters,
      request.includeIdentifiedUserLabel,
    );

    const sortExpression: string =
      SessionReplayReadService.getSortExpression(sortBy);

    if (request.cursor) {
      statement.append(` AND (${sortExpression} < `);
      statement.append(
        SQL`${{
          type: TableColumnType.Decimal,
          value: request.cursor.sortValue,
        }}`,
      );
      statement.append(` OR (${sortExpression} = `);
      statement.append(
        SQL`${{
          type: TableColumnType.Decimal,
          value: request.cursor.sortValue,
        }} AND sessionId < ${{
          type: TableColumnType.Text,
          value: request.cursor.sessionId,
        }}))`,
      );
    }

    statement.append(` ORDER BY ${sortExpression} DESC, sessionId DESC`);
    statement.append(
      SQL` LIMIT ${{
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
        const startTime: Date = readDate(row, "aggStartTime");
        const endTime: Date = readDate(row, "aggEndTime");

        const item: SessionReplayListItem = {
          sessionId: readString(row, "sessionId"),
          rumApplicationId: readString(row, "applicationId"),
          startTime: startTime,
          endTime: endTime,
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
          routes: readStringArray(row, "aggRoutes").slice(0, MAX_LIST_ROUTES),
          traceCount: readNumber(row, "aggTraceCount"),
          exceptionGroupCount: readNumber(row, "aggExceptionGroupCount"),
          topExceptionFingerprint: readString(
            row,
            "aggTopExceptionFingerprint",
          ),
          clickCount: readNumber(row, "aggClickCount"),
          activeMs: readNumber(row, "aggActiveMs"),
          firstErrorOffsetMs: readNumber(row, "aggFirstErrorOffsetMs"),
          expiresAtUnixMs: readNumber(row, "aggExpiresAt"),
          tags: readStringMap(row, "aggTags"),
          startTimeUnixMs: startTime.getTime(),
          endTimeUnixMs: endTime.getTime(),
        };

        if (request.includeIdentifiedUserLabel) {
          item.identifiedUserLabel = readString(row, "aggIdentifiedUserLabel");
          item.identifiedUserTraits = readStringMap(
            row,
            "aggIdentifiedUserTraits",
          );
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
              sortBy: sortBy,
              sortValue: SessionReplayReadService.getSortValue(
                sortBy,
                lastSession,
              ),
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
   * on (projectId, sessionId) and the optional rumApplicationId is a
   * DISAMBIGUATOR, never a substitute for the check: a supplied id only
   * narrows which header row is read, and the handler still authorizes
   * the application that row names.
   */
  @CaptureSpan()
  public static async getSessionHeader(data: {
    projectId: ObjectID;
    sessionId: string;
    /*
     * Which application's recording to read when the same browser-minted
     * sessionId was recorded under more than one application (an
     * appIdentifier rename, two apps on one origin). Without it an
     * ambiguous id is refused.
     */
    rumApplicationId?: ObjectID | undefined;
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

    if (data.rumApplicationId) {
      statement.append(
        SQL` AND rumApplicationId = ${{
          type: TableColumnType.ObjectID,
          value: data.rumApplicationId,
        }}`,
      );
    }

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
     * check. An ambiguous sessionId is refused outright unless the caller
     * named the application it wants (which is then authorized on its own
     * merits): it is either an attack or a collision, and neither has a
     * single correct recording to return.
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
        "This session id was recorded under more than one application in this project. Open it from the session list of the application you want to watch, which passes rumApplicationId to choose the recording.",
      );
    }

    const row: JSONObject | undefined = rows[0];

    if (!row) {
      return null;
    }

    const startTime: Date = readDate(row, "aggStartTime");
    const endTime: Date = readDate(row, "aggEndTime");

    return {
      sessionId: readString(row, "sessionId"),
      projectId: readString(row, "headerProjectId"),
      rumApplicationId: readString(row, "applicationId"),
      startTime: startTime,
      endTime: endTime,
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
      startTimeUnixMs: startTime.getTime(),
      endTimeUnixMs: endTime.getTime(),
      clientReportedStartUnixMs: readNumber(row, "aggClientReportedStart"),
      tags: readStringMap(row, "aggTags"),
      expiresAtUnixMs: readNumber(row, "aggExpiresAt"),
      clickCount: readNumber(row, "aggClickCount"),
      customEventCount: readNumber(row, "aggCustomEventCount"),
      activeMs: readNumber(row, "aggActiveMs"),
      firstErrorOffsetMs: readNumber(row, "aggFirstErrorOffsetMs"),
      recorderCapabilities: readRecorderCapabilities(row),
    };
  }

  /*
   * The identity columns for one session, pinned to the application the
   * caller was authorized against. This is the ONLY statement outside the
   * identity-gated list projection that names identifiedUserLabel or
   * identifiedUserTraits, and the manifest handler calls it strictly
   * after canReadIdentifiedUserLabel has passed for this application. It
   * is a separate, tiny read rather than two more columns on
   * getSessionHeader because the header is resolved BEFORE the
   * application (and therefore the identity decision) is known.
   */
  @CaptureSpan()
  public static async getSessionIdentity(data: {
    projectId: ObjectID;
    rumApplicationId: ObjectID;
    sessionId: string;
  }): Promise<SessionReplaySessionIdentity> {
    const statement: Statement = SQL`
      SELECT
    `;

    statement.append(`    ${toSelectList(IDENTITY_AGGREGATES)}`);

    statement.append(SQL`
      FROM ${AnalyticsTableName.RumSession}
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
    `);

    statement.append(RETENTION_FILTER);
    statement.append(
      " GROUP BY projectId, rumApplicationId, sessionId LIMIT 1",
    );
    statement.append(READ_QUERY_SETTINGS);

    const dbResult: Results = await RumSessionService.executeQuery(statement);
    const response: DbJSONResponse = await dbResult.json<{
      data?: Array<JSONObject>;
    }>();

    const row: JSONObject | undefined = (response.data || [])[0];

    if (!row) {
      return { identifiedUserLabel: "", identifiedUserTraits: {} };
    }

    return {
      identifiedUserLabel: readString(row, "aggIdentifiedUserLabel"),
      identifiedUserTraits: readStringMap(row, "aggIdentifiedUserTraits"),
    };
  }

  /*
   * For a sessionId that getSessionHeader could not find: did a header
   * ever exist, and when did (or does) it expire? Runs WITHOUT the
   * retention filter, which is safe only because it returns dates and an
   * application id and never a row's content - it lets the handler say
   * "this recording expired on <date>" instead of "not found".
   *
   * null when no row exists at all (never recorded, or already dropped by
   * the ClickHouse TTL, or erased).
   */
  @CaptureSpan()
  public static async getExpiredSessionInfo(data: {
    projectId: ObjectID;
    sessionId: string;
    rumApplicationId?: ObjectID | undefined;
  }): Promise<SessionReplayExpiredSessionInfo | null> {
    const statement: Statement = SQL`
      SELECT
        toString(rumApplicationId) AS applicationId,
        toFloat64(toUnixTimestamp(max(retentionDate))) * 1000 AS expiresAtUnixMs,
        toFloat64(toUnixTimestamp64Milli(min(startTime))) AS startTimeUnixMs
      FROM ${AnalyticsTableName.RumSession}
      WHERE projectId = ${{
        type: TableColumnType.ObjectID,
        value: data.projectId,
      }}
        AND sessionId = ${{
          type: TableColumnType.Text,
          value: data.sessionId,
        }}
    `;

    if (data.rumApplicationId) {
      statement.append(
        SQL` AND rumApplicationId = ${{
          type: TableColumnType.ObjectID,
          value: data.rumApplicationId,
        }}`,
      );
    }

    statement.append(
      " GROUP BY rumApplicationId ORDER BY expiresAtUnixMs DESC LIMIT 1",
    );
    statement.append(READ_QUERY_SETTINGS);

    const dbResult: Results = await RumSessionService.executeQuery(statement);
    const response: DbJSONResponse = await dbResult.json<{
      data?: Array<JSONObject>;
    }>();

    const row: JSONObject | undefined = (response.data || [])[0];

    if (!row) {
      return null;
    }

    return {
      rumApplicationId: readString(row, "applicationId"),
      startTime: readDate(row, "startTimeUnixMs"),
      expiresAt: readDate(row, "expiresAtUnixMs"),
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
     *
     * clickCount and url are narrow columns: the activity lane and the
     * URL bar read them before any chunk is decoded. payloadBytes stays
     * the WIRE size the recorder posted; the stored size is only ever
     * measured by getChunks, which is the read the cap actually bounds.
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
        routeCount,
        clickCount,
        url
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

    let liveDurationMs: number = 0;
    let liveEventCount: number = 0;
    let liveMaxChunkIndex: number = 0;

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
        clickCount: readNumber(row, "clickCount"),
        url: readString(row, "url"),
      };

      liveDurationMs = Math.max(liveDurationMs, entry.chunkEndOffsetMs);
      liveEventCount += entry.eventCount;
      liveMaxChunkIndex = Math.max(liveMaxChunkIndex, entry.chunkIndex);

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
        firstChunkStartOffsetMs: entries.reduce(
          (min: number, entry: SessionReplayChunkManifestEntry): number => {
            return Math.min(min, entry.chunkStartOffsetMs);
          },
          Number.POSITIVE_INFINITY,
        ),
      });
    }

    for (const tab of tabs) {
      if (!Number.isFinite(tab.firstChunkStartOffsetMs)) {
        tab.firstChunkStartOffsetMs = 0;
      }
    }

    return {
      header: SessionReplayReadService.reconcileLiveHeader({
        header: data.header,
        chunkRowCount: rows.length,
        liveDurationMs: liveDurationMs,
        liveEventCount: liveEventCount,
        liveMaxChunkIndex: liveMaxChunkIndex,
      }),
      tabs: tabs,
      isChunkIndexTruncated: rows.length >= MAX_MANIFEST_ROWS,
    };
  }

  /*
   * A provisional header (isFinalized false) says durationMs 0, chunkCount
   * 0 and eventCount 0 while its chunk rows say otherwise; the manifest
   * has just read every chunk row, so it reports what the rows prove. A
   * finalized header is authoritative and returned untouched.
   */
  private static reconcileLiveHeader(data: {
    header: SessionReplaySessionHeader;
    chunkRowCount: number;
    liveDurationMs: number;
    liveEventCount: number;
    liveMaxChunkIndex: number;
  }): SessionReplaySessionHeader {
    if (data.header.isFinalized || data.chunkRowCount === 0) {
      return data.header;
    }

    const durationMs: number = Math.max(
      data.header.durationMs,
      data.liveDurationMs,
    );
    const endTimeUnixMs: number = Math.max(
      data.header.endTimeUnixMs,
      data.header.startTimeUnixMs + durationMs,
    );

    return {
      ...data.header,
      durationMs: durationMs,
      endTime: new Date(endTimeUnixMs),
      endTimeUnixMs: endTimeUnixMs,
      chunkCount: Math.max(data.header.chunkCount, data.chunkRowCount),
      eventCount: Math.max(data.header.eventCount, data.liveEventCount),
      maxChunkIndex: Math.max(
        data.header.maxChunkIndex,
        data.liveMaxChunkIndex,
      ),
    };
  }

  /*
   * The payload read. The only query in the system that names the
   * `payload` column.
   *
   * The byte cap is measured on `length(payload)` - the DECOMPRESSED
   * stored JSON that is actually returned - in the SAME statement that
   * ships the bytes, so the column is decompressed once per page rather
   * than once for a pre-check and again for the read. `payloadBytes` is
   * the post-gzip WIRE size the recorder uploaded; rrweb JSON gzips
   * 10-20x, so a cap on it bounds a number an order of magnitude smaller
   * than the response and therefore bounds nothing useful.
   *
   * Prefix semantics rather than refusal. A page that does not fit is
   * answered with the longest prefix of whole chunks that does, and ALWAYS
   * with at least the first chunk: the ingest cap
   * (SESSION_REPLAY_MAX_DECOMPRESSED_FRAME_BYTES) already bounds a single
   * frame, so a lone chunk can never exceed what the ingest let in, and a
   * single oversized snapshot that could never be served would dead-end
   * playback at that chunk forever. The player plans pages against the
   * wire size it has, requests, and reads back whichever chunks arrived.
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
  }): Promise<SessionReplayChunkReadResult> {
    if (data.chunkIndexes.length === 0) {
      return { chunks: [], omittedChunkIndexes: [] };
    }

    if (data.chunkIndexes.length > MAX_SESSION_REPLAY_CHUNKS_PER_READ) {
      throw new BadDataException(
        `A maximum of ${MAX_SESSION_REPLAY_CHUNKS_PER_READ} chunks may be requested at a time.`,
      );
    }

    /*
     * Innermost: the de-duplicated rows. A retried delivery is two
     * physically present rows on a ReplacingMergeTree until a merge runs.
     * Feeding both to the player would replay the same mutations twice,
     * which rrweb resolves against node ids and would either throw or
     * render a DOM that never existed.
     *
     * Middle: a running total of stored bytes in chunk order. Outermost:
     * a row is SERVED when the total up to and including it is under the
     * cap, or when it is the first row; a row that is not served keeps
     * its index (so the caller can name what was omitted) but ships an
     * empty payload, so the bytes crossing the wire are bounded inside
     * ClickHouse and never in the application.
     *
     * The outer projection is aliased servedPayload rather than payload:
     * an alias that names the column its own expression reads is a
     * cyclic alias to ClickHouse.
     */
    const statement: Statement = SQL`
      SELECT
        chunkIndex,
        if(isServed, payload, '') AS servedPayload,
        isServed
      FROM (
        SELECT
          chunkIndex,
          payload,
          (sum(length(payload)) OVER (ORDER BY chunkIndex ASC ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) <= ${{
            type: TableColumnType.Decimal,
            value: MAX_SESSION_REPLAY_READ_BYTES,
          }}
            OR row_number() OVER (ORDER BY chunkIndex ASC) = 1) AS isServed
        FROM (
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

    statement.append(
      " ORDER BY chunkIndex ASC, version DESC LIMIT 1 BY chunkIndex\n        )\n      )\n      ORDER BY chunkIndex ASC",
    );

    statement.append(READ_QUERY_SETTINGS);

    const dbResult: Results =
      await RumSessionChunkService.executeQuery(statement);
    const response: DbJSONResponse = await dbResult.json<{
      data?: Array<JSONObject>;
    }>();

    /*
     * The cap is re-applied to the bytes actually being handed back, not
     * only to what ClickHouse computed: any future change to how stored
     * size is derived would otherwise silently unbound the response. The
     * prefix is also re-established here - a served row behind an
     * unserved one would be a hole the player cannot play across, so the
     * served set stops at the first omission.
     */
    let totalReturnedBytes: number = 0;
    const chunks: Array<SessionReplayChunkPayload> = [];
    const omittedChunkIndexes: Array<number> = [];

    const chunkRows: Array<JSONObject> = response.data || [];

    for (const row of chunkRows) {
      const chunkIndex: number = readNumber(row, "chunkIndex");
      const payload: string = readString(row, "servedPayload");
      const isServed: boolean =
        row["isServed"] === undefined ? true : readBoolean(row, "isServed");

      const payloadBytes: number = Buffer.byteLength(payload, "utf8");

      const fits: boolean =
        chunks.length === 0 ||
        totalReturnedBytes + payloadBytes <= MAX_SESSION_REPLAY_READ_BYTES;

      if (!isServed || !fits || omittedChunkIndexes.length > 0) {
        omittedChunkIndexes.push(chunkIndex);
        continue;
      }

      totalReturnedBytes += payloadBytes;

      chunks.push({
        chunkIndex: chunkIndex,
        payload: payload,
      });
    }

    return { chunks: chunks, omittedChunkIndexes: omittedChunkIndexes };
  }

  /*
   * Sessions that observed a given exception fingerprint.
   *
   * Two sources, one header query. The header's exceptionFingerprints
   * array is written by the finalizer, so for the first 10+ minutes after
   * the error - the whole incident, from the reporter's point of view -
   * the session's header knows nothing about it. The exception instance
   * table, however, carries the session id of the page that threw, from
   * the moment the exception is ingested. Those ids are looked up first
   * (cheap: bloom-indexed fingerprint, bounded window) and OR-ed into the
   * header predicate, so a live session is found as soon as its error is.
   *
   * hasAny() appears twice on purpose. In the WHERE it is a bloom-pruned
   * pre-filter over physical rows; a group survives it if ANY of its rows
   * carries the fingerprint, which necessarily includes the case where
   * the winning (highest version) row does - so the pre-filter cannot
   * drop a true match. The HAVING then re-checks the argMax'd array so a
   * fingerprint present only on a superseded row does not produce a false
   * positive.
   *
   * Always windowed. RumSession is partitioned by day, so without a
   * window this scanned every partition the project ever wrote on every
   * exception page load.
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
    /* Pin to the one session the caller already knows threw. */
    sessionId?: string | undefined;
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

    const endTime: Date = data.endTime || OneUptimeDate.getCurrentDate();
    const startTime: Date =
      data.startTime ||
      OneUptimeDate.addRemoveDays(
        endTime,
        -DEFAULT_SESSION_REPLAY_FOR_EXCEPTION_WINDOW_DAYS,
      );

    const instanceSessionIds: Array<string> =
      await SessionReplayReadService.getSessionIdsForExceptionInstances({
        projectId: data.projectId,
        exceptionFingerprint: data.exceptionFingerprint,
        startTime: startTime,
        endTime: endTime,
        sessionId: data.sessionId,
      });

    const selectList: string = toSelectList([
      { alias: "aggStartTime", expression: argMaxDateTime("startTime") },
      { alias: "aggEndTime", expression: argMaxDateTime("endTime") },
      { alias: "aggDurationMs", expression: LIVE_DURATION_EXPRESSION },
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
    `);

    if (data.accessibleRumApplicationIds) {
      statement.append(
        SQL` AND rumApplicationId IN (${{
          type: TableColumnType.ObjectID,
          value: new Includes(data.accessibleRumApplicationIds),
        }})`,
      );
    }

    statement.append(
      SQL` AND startTime >= ${{
        type: TableColumnType.DateTime64,
        value: startTime,
      }} AND startTime <= ${{
        type: TableColumnType.DateTime64,
        value: endTime,
      }}`,
    );

    statement.append(RETENTION_FILTER);

    if (data.sessionId) {
      statement.append(
        SQL` AND sessionId = ${{
          type: TableColumnType.Text,
          value: data.sessionId,
        }}`,
      );
    }

    statement.append(
      SQL` AND (hasAny(exceptionFingerprints, [${{
        type: TableColumnType.Text,
        value: data.exceptionFingerprint,
      }}])`,
    );

    if (instanceSessionIds.length > 0) {
      statement.append(
        SQL` OR sessionId IN (${{
          type: TableColumnType.Text,
          value: new Includes(instanceSessionIds),
        }})`,
      );
    }

    statement.append(")");

    statement.append(
      SQL` GROUP BY projectId, rumApplicationId, sessionId
           HAVING (hasAny(aggExceptionFingerprints, [${{
             type: TableColumnType.Text,
             value: data.exceptionFingerprint,
           }}])`,
    );

    if (instanceSessionIds.length > 0) {
      statement.append(
        SQL` OR sessionId IN (${{
          type: TableColumnType.Text,
          value: new Includes(instanceSessionIds),
        }})`,
      );
    }

    statement.append(")");

    statement.append(
      SQL` ORDER BY aggStartTime DESC
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

  /*
   * Session ids of the pages that threw this exception, from the
   * exception instance table. The instance's `time` sits inside its
   * session, so a session that started inside the window threw inside
   * [startTime, endTime + max session length].
   *
   * Best-effort: the side index only ADDS live sessions to the answer, so
   * a failure here degrades to the finalized-only lookup with a warning
   * rather than failing the exception page's replay card.
   *
   * A caller-pinned sessionId narrows the lookup rather than bypassing it,
   * so the pin can never assert that a session threw something the
   * instance table has no record of it throwing.
   */
  private static async getSessionIdsForExceptionInstances(data: {
    projectId: ObjectID;
    exceptionFingerprint: string;
    startTime: Date;
    endTime: Date;
    sessionId?: string | undefined;
  }): Promise<Array<string>> {
    const statement: Statement = SQL`
      SELECT DISTINCT sessionId
      FROM ${AnalyticsTableName.ExceptionInstance}
      WHERE projectId = ${{
        type: TableColumnType.ObjectID,
        value: data.projectId,
      }}
        AND fingerprint = ${{
          type: TableColumnType.Text,
          value: data.exceptionFingerprint,
        }}
        AND sessionId != ''
        AND time >= ${{
          type: TableColumnType.DateTime64,
          value: data.startTime,
        }}
        AND time <= ${{
          type: TableColumnType.DateTime64,
          value: new Date(
            data.endTime.getTime() + SESSION_REPLAY_MAX_SESSION_MS,
          ),
        }}
    `;

    /*
     * A pinned sessionId narrows this lookup; it does NOT replace it.
     *
     * Returning the pinned id unchecked made the caller's statement read
     * `sessionId = X AND (hasAny(fingerprints, [f]) OR sessionId IN (X))`,
     * whose second arm is trivially true - so the fingerprint constrained
     * nothing and the "Watch what the user saw" card would present any
     * accessible session as having observed this exception, on nothing but
     * a stale occurrence row. Asking the instance table whether THAT
     * session threw THIS fingerprint keeps the pin's real purpose (a live
     * session whose header has no fingerprints yet) while keeping the
     * claim true. A failure here answers [] and the header's mandatory
     * hasAny() predicate decides alone - fail closed.
     */
    if (data.sessionId) {
      statement.append(
        SQL` AND sessionId = ${{
          type: TableColumnType.Text,
          value: data.sessionId,
        }}`,
      );
    }

    statement.append(SQL`
      ORDER BY sessionId ASC
      LIMIT ${{
        type: TableColumnType.Number,
        value: MAX_EXCEPTION_INSTANCE_SESSION_IDS,
      }}
    `);

    statement.append(READ_QUERY_SETTINGS);

    try {
      const dbResult: Results =
        await ExceptionInstanceService.executeQuery(statement);
      const response: DbJSONResponse = await dbResult.json<{
        data?: Array<JSONObject>;
      }>();

      return (response.data || [])
        .map((row: JSONObject): string => {
          return readString(row, "sessionId");
        })
        .filter((sessionId: string): boolean => {
          return sessionId.length > 0;
        });
    } catch (err: unknown) {
      logger.warn(
        "SessionReplayReadService: could not look up exception instances by session; answering from finalized headers only",
      );
      logger.warn(err);

      return [];
    }
  }

  /*
   * Recording activity for one application over the last 24 hours, for
   * the health surface. No GROUP BY and no payload: uniqExact over the
   * sort-key range for the counts, and an ORDER BY startTime DESC LIMIT 1
   * (read in sort-key order, stops after one granule) for the most recent
   * start, which is NOT bounded to 24h so "the most recent was 3 days
   * ago" can be said when today is quiet.
   *
   * "Playable" is counted by subtraction: a session is unplayable only
   * when its FINALIZED row says it holds no chunks or was sealed as
   * recording-lost. Every other session - live, or finalized with footage
   * - can be watched. Counted that way because a finalized session still
   * has its provisional row on disk until a merge runs, and that row
   * would otherwise count a lost recording as live.
   *
   * ClickHouse trouble answers null (the UI says "unknown"), never 0:
   * "no sessions" and "could not count" are different diagnoses.
   */
  @CaptureSpan()
  public static async getApplicationActivitySummary(data: {
    projectId: ObjectID;
    rumApplicationId: ObjectID;
    nowUnixMs?: number | undefined;
  }): Promise<SessionReplayApplicationActivitySummary> {
    const nowUnixMs: number = data.nowUnixMs ?? Date.now();
    const cacheKey: string = `${data.projectId.toString()}:${data.rumApplicationId.toString()}`;

    const cached: ActivitySummaryCacheEntry | undefined =
      activitySummaryCache.get(cacheKey);

    if (cached && cached.expiresAt > nowUnixMs) {
      return cached.summary;
    }

    const summary: SessionReplayApplicationActivitySummary =
      await SessionReplayReadService.readApplicationActivitySummary({
        projectId: data.projectId,
        rumApplicationId: data.rumApplicationId,
        nowUnixMs: nowUnixMs,
      });

    /*
     * Coarse LRU: evict the oldest entry when full and the key is new, so
     * a burst of distinct applications cannot grow the map without bound.
     */
    if (
      activitySummaryCache.size >= MAX_ACTIVITY_SUMMARY_CACHE_ENTRIES &&
      !activitySummaryCache.has(cacheKey)
    ) {
      const oldest: string | undefined = activitySummaryCache
        .keys()
        .next().value;

      if (oldest !== undefined) {
        activitySummaryCache.delete(oldest);
      }
    }

    activitySummaryCache.delete(cacheKey);
    activitySummaryCache.set(cacheKey, {
      summary: summary,
      expiresAt: nowUnixMs + SESSION_REPLAY_ACTIVITY_SUMMARY_CACHE_TTL_MS,
    });

    return summary;
  }

  private static async readApplicationActivitySummary(data: {
    projectId: ObjectID;
    rumApplicationId: ObjectID;
    nowUnixMs: number;
  }): Promise<SessionReplayApplicationActivitySummary> {
    const countsStatement: Statement = SQL`
      SELECT
        toFloat64(uniqExact(sessionId)) AS sessionCount,
        toFloat64(uniqExactIf(sessionId, isFinalized AND (chunkCount = 0 OR sealedReason = ${{
          type: TableColumnType.Text,
          value: SessionReplaySealedReason.RecordingLost,
        }}))) AS unplayableCount
      FROM ${AnalyticsTableName.RumSession}
      WHERE projectId = ${{
        type: TableColumnType.ObjectID,
        value: data.projectId,
      }}
        AND rumApplicationId = ${{
          type: TableColumnType.ObjectID,
          value: data.rumApplicationId,
        }}
        AND startTime >= ${{
          type: TableColumnType.DateTime64,
          value: new Date(data.nowUnixMs - 24 * 60 * 60 * 1000),
        }}
    `;

    countsStatement.append(RETENTION_FILTER);
    countsStatement.append(READ_QUERY_SETTINGS);

    const lastStartStatement: Statement = SQL`
      SELECT
        toFloat64(toUnixTimestamp64Milli(startTime)) AS lastStartUnixMs,
        /*
         * The newest session's recorder capabilities, read off the same row
         * that answers "when did recording last start". Named directly (not
         * through the argMax alias set) because this statement has no GROUP
         * BY: it is one row, read in sort-key order, LIMIT 1.
         */
        attributes AS aggAttributes
      FROM ${AnalyticsTableName.RumSession}
      WHERE projectId = ${{
        type: TableColumnType.ObjectID,
        value: data.projectId,
      }}
        AND rumApplicationId = ${{
          type: TableColumnType.ObjectID,
          value: data.rumApplicationId,
        }}
    `;

    lastStartStatement.append(RETENTION_FILTER);
    lastStartStatement.append(" ORDER BY startTime DESC LIMIT 1");
    lastStartStatement.append(READ_QUERY_SETTINGS);

    try {
      const [countsResult, lastStartResult]: [Results, Results] =
        await Promise.all([
          RumSessionService.executeQuery(countsStatement),
          RumSessionService.executeQuery(lastStartStatement),
        ]);

      const countsResponse: DbJSONResponse = await countsResult.json<{
        data?: Array<JSONObject>;
      }>();
      const lastStartResponse: DbJSONResponse = await lastStartResult.json<{
        data?: Array<JSONObject>;
      }>();

      const countsRow: JSONObject | undefined = (countsResponse.data || [])[0];
      const lastStartRow: JSONObject | undefined = (lastStartResponse.data ||
        [])[0];

      const sessionCount: number = countsRow
        ? readNumber(countsRow, "sessionCount")
        : 0;
      const unplayableCount: number = countsRow
        ? readNumber(countsRow, "unplayableCount")
        : 0;

      const lastStartUnixMs: number = lastStartRow
        ? readNumber(lastStartRow, "lastStartUnixMs")
        : 0;

      /*
       * An empty list means "the newest session declared none" (an old
       * recorder artifact), which is not the same as "we could not tell" -
       * but the health copy renders both as "not reported yet", and
       * claiming a recorder has NO capabilities would be a stronger
       * statement than the row supports. So an empty list answers null and
       * only a non-empty one is reported.
       */
      const recorderCapabilities: Array<string> = lastStartRow
        ? readRecorderCapabilities(lastStartRow)
        : [];

      return {
        sessionsLast24h: sessionCount,
        playableSessionsLast24h: Math.max(0, sessionCount - unplayableCount),
        lastSessionStartedAt:
          lastStartUnixMs > 0 ? new Date(lastStartUnixMs) : null,
        recorderCapabilities:
          recorderCapabilities.length > 0 ? recorderCapabilities : null,
      };
    } catch (err: unknown) {
      logger.warn(
        "SessionReplayReadService: could not read the application activity summary",
      );
      logger.warn(err);

      return {
        sessionsLast24h: null,
        playableSessionsLast24h: null,
        lastSessionStartedAt: null,
        recorderCapabilities: null,
      };
    }
  }

  /* The HAVING/ORDER BY expression for a sort key. */
  private static getSortExpression(sortBy: SessionReplaySortBy): string {
    switch (sortBy) {
      case "durationMs":
        return "aggDurationMs";
      case "errorCount":
        return "aggErrorCount";
      case "frustration":
        return FRUSTRATION_TOTAL_EXPRESSION;
      case "startTime":
      default:
        return "aggStartTime";
    }
  }

  /* The cursor value of a row under a sort key: what the expression above yields. */
  private static getSortValue(
    sortBy: SessionReplaySortBy,
    item: SessionReplayListItem,
  ): number {
    switch (sortBy) {
      case "durationMs":
        return item.durationMs;
      case "errorCount":
        return item.errorCount;
      case "frustration":
        return (
          item.rageClickCount +
          item.deadClickCount +
          item.errorClickCount +
          item.refreshRageCount
        );
      case "startTime":
      default:
        return item.startTime.getTime();
    }
  }

  /*
   * Every list predicate, in cost order: booleans and equality over
   * aliases first, IN lists next, array membership after, and the
   * substring predicates (tags, urlPrefix, search) LAST. ClickHouse
   * evaluates HAVING per group after aggregation, so the order does not
   * change what is scanned, but a cheap predicate that fails first spares
   * the string work for every group it eliminates.
   */
  private static appendListHavingFilters(
    statement: Statement,
    filters: SessionReplayListFilters,
    includeIdentifiedUserLabel: boolean,
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
      statement.append(
        filters.hasFrustration
          ? ` AND ${FRUSTRATION_TOTAL_EXPRESSION} > 0`
          : ` AND ${FRUSTRATION_TOTAL_EXPRESSION} = 0`,
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

    if (filters.hasIdentifiedUser !== undefined) {
      /*
       * The digest column, not the label: it is under the ordinary session
       * ACL, and "did somebody identify" discloses nothing about who.
       */
      statement.append(
        filters.hasIdentifiedUser
          ? " AND aggIdentifiedUserKey != ''"
          : " AND aggIdentifiedUserKey = ''",
      );
    }

    if (filters.isPlayable !== undefined) {
      /*
       * A live session is playable (its chunks are being written); a
       * finalized one only when the finalizer counted chunks and did not
       * seal it as lost.
       */
      const playable: string = `((aggIsFinalized = 0 OR aggChunkCount > 0) AND aggSealedReason != '${SessionReplaySealedReason.RecordingLost}')`;

      statement.append(
        filters.isPlayable ? ` AND ${playable}` : ` AND NOT ${playable}`,
      );
    }

    if (filters.hasTraces !== undefined) {
      statement.append(
        filters.hasTraces ? " AND aggTraceCount > 0" : " AND aggTraceCount = 0",
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
       * `has`, not a Search/LIKE: exact membership is the cheap array
       * path. Over the argMax alias, never the raw column.
       */
      statement.append(" AND has(aggRoutes, ");
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

    if (filters.tags) {
      /*
       * Every pair must match. mapContains first so an absent key never
       * matches the empty string a Map subscript returns for it. Bounded
       * by the number of tags a session can even carry.
       */
      const pairs: Array<[string, string]> = Object.entries(filters.tags)
        .filter(([key, value]: [string, string]): boolean => {
          return key.length > 0 && typeof value === "string";
        })
        .slice(0, SESSION_REPLAY_MAX_TAG_KEYS);

      for (const [key, value] of pairs) {
        statement.append(" AND mapContains(aggTags, ");
        statement.append(
          SQL`${{
            type: TableColumnType.Text,
            value: key,
          }}) AND aggTags[${{
            type: TableColumnType.Text,
            value: key,
          }}] = ${{
            type: TableColumnType.Text,
            value: value,
          }}`,
        );
      }
    }

    if (filters.urlPrefix) {
      /*
       * "sessions that touched /checkout/*": a prefix over every route the
       * session visited and over the entry URL, which for a pre-migration
       * session is the only URL the header holds.
       *
       * The stored values are scrubbed ABSOLUTE urls (https://host/path),
       * but the filter a human types is a PATH - the search box routes any
       * value beginning with "/" here, and the docs promise `url:/checkout`
       * outright. Matching only the full string meant that documented
       * search never matched anything, in any project, with no error to
       * say so. So the path of each route and of the entry URL is matched
       * as well as the whole URL: an absolute prefix still matches on the
       * first arm, a path prefix on the second. ClickHouse's path() returns
       * the path component without host or query, which is exactly the
       * shape the recorder's route list is scrubbed down to.
       */
      const prefixParameter: { type: TableColumnType; value: string } = {
        type: TableColumnType.Text,
        value: filters.urlPrefix,
      };

      statement.append(" AND (arrayExists(r -> startsWith(r, ");
      statement.append(SQL`${prefixParameter}`);
      statement.append(") OR startsWith(path(r), ");
      statement.append(SQL`${prefixParameter}`);
      statement.append("), aggRoutes) OR startsWith(aggEntryUrl, ");
      statement.append(SQL`${prefixParameter}`);
      statement.append(") OR startsWith(path(aggEntryUrl), ");
      statement.append(SQL`${prefixParameter}`);
      statement.append("))");
    }

    if (filters.search) {
      SessionReplayReadService.appendSearchPredicate(
        statement,
        filters.search,
        includeIdentifiedUserLabel,
      );
    }
  }

  /*
   * Free-text search, last of the predicates because it is the only one
   * that does substring work per group. The identified user label is
   * searched ONLY when the caller may read it: without that gate a caller
   * denied the label could ask "is jane@example.com here" and read every
   * other field of the answer.
   */
  private static appendSearchPredicate(
    statement: Statement,
    search: string,
    includeIdentifiedUserLabel: boolean,
  ): void {
    const term: string = search
      .trim()
      .substring(0, SESSION_REPLAY_LIST_SEARCH_MAX_LENGTH);

    if (!term) {
      return;
    }

    const textParameter: { type: TableColumnType; value: string } = {
      type: TableColumnType.Text,
      value: term,
    };

    statement.append(" AND (startsWith(sessionId, ");
    statement.append(SQL`${textParameter})`);
    statement.append(" OR positionCaseInsensitiveUTF8(aggEntryUrl, ");
    statement.append(SQL`${textParameter}) > 0`);
    statement.append(" OR positionCaseInsensitiveUTF8(aggExitUrl, ");
    statement.append(SQL`${textParameter}) > 0`);
    statement.append(" OR arrayExists(r -> positionCaseInsensitiveUTF8(r, ");
    statement.append(SQL`${textParameter}) > 0, aggRoutes)`);
    statement.append(` OR has(${argMaxColumn("traceIds")}, `);
    statement.append(SQL`${textParameter})`);

    if (includeIdentifiedUserLabel) {
      statement.append(
        " OR positionCaseInsensitiveUTF8(aggIdentifiedUserLabel, ",
      );
      statement.append(SQL`${textParameter}) > 0`);
    }

    statement.append(")");
  }
}
