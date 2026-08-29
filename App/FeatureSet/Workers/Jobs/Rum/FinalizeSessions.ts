import RunCron from "../../Utils/Cron";
import Redis, { ClientType } from "Common/Server/Infrastructure/Redis";
import RumSessionChunkService from "Common/Server/Services/RumSessionChunkService";
import RumSessionService from "Common/Server/Services/RumSessionService";
import {
  SQL,
  Statement,
} from "Common/Server/Utils/AnalyticsDatabase/Statement";
import { isSessionErased } from "Common/Server/Utils/SessionReplay/SessionReplayErasureTombstone";
import logger from "Common/Server/Utils/Logger";
import AnalyticsTableName from "Common/Types/AnalyticsDatabase/AnalyticsTableName";
import TableColumnType from "Common/Types/AnalyticsDatabase/TableColumnType";
import OneUptimeDate from "Common/Types/Date";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import ServiceType from "Common/Types/Telemetry/ServiceType";
import {
  MAX_SESSION_REPLAY_CHUNKS_PER_SESSION,
  SESSION_REPLAY_MAX_SESSION_MS,
  SESSION_REPLAY_SCHEMA_VERSION,
  SESSION_REPLAY_WIRE_VERSION,
  SessionReplaySealedReason,
} from "Common/Types/Rum/SessionReplay";
import ChunkMath from "Common/Utils/Rum/ChunkMath";
import { EVERY_FIVE_MINUTE, EVERY_HOUR } from "Common/Utils/CronTime";

/*
 * ------------------------------------------------------------------
 * Rum:FinalizeSessions
 *
 * The one job that makes session-replay aggregates correct.
 *
 * Both replay tables are ReplacingMergeTree, which ClusterConfig
 * resolves to ReplicatedReplacingMergeTree(version) — pure
 * last-write-wins with NO accumulation. So a per-chunk
 * read-modify-write increment onto the session header ("header.
 * eventCount += chunk.eventCount") is a lost-update bug the moment two
 * chunks of one session are processed concurrently, which at
 * TELEMETRY_CONCURRENCY is the normal case, not the edge case. The
 * ingest path therefore writes ONLY chunk-invariant identity onto the
 * header, and every aggregate is derived here, exactly once, from a
 * single GROUP BY over the chunk table's own key range.
 *
 * That makes finalization idempotent and race-free: re-running it
 * recomputes the same numbers from the same rows and writes a header
 * version with a strictly larger `version`, which the engine collapses
 * onto the previous one at merge. There is no state to corrupt.
 *
 * Expired sessions are found through a per-project Redis sorted set that
 * the ingest service ZADDs on every accepted chunk, so the scan is
 * O(expired) rather than O(every session ever recorded) — the difference
 * between a 5-minute cron and a full table scan of the fattest table in
 * the system.
 * ------------------------------------------------------------------
 */

const JOB_NAME: string = "Rum:FinalizeSessions";

/*
 * ------------------------------------------------------------------
 * Redis activity contract, shared with the ingest path.
 *
 * These literals are mirrored by App/FeatureSet/Telemetry (the chunk
 * ingest service) — see the handoff note in that service. They are
 * spelled out here rather than imported from Common because the
 * finalizer is the only consumer and the producer is a different
 * feature set; if a shared helper lands in
 * Common/Server/Utils/SessionReplay, both sides should move to it.
 *
 *   replay:active:projects            SET  of projectId, SADD per chunk
 *   replay:active:<projectId>         ZSET member "<sessionId>:<tabId>",
 *                                     score = server receive unix ms
 *
 * Only the per-project sorted set is written by the ingest path today.
 * The project SET is the index that lets this job avoid SCANning the
 * keyspace on every run; it is maintained here by a periodic reconcile,
 * and the ingest path SHOULD also SADD the project on every accepted
 * chunk so a newly active project is picked up immediately rather than at
 * the next reconcile.
 * ------------------------------------------------------------------
 */
export const SESSION_REPLAY_ACTIVE_PROJECTS_KEY: string =
  "replay:active:projects";

export const SESSION_REPLAY_ACTIVE_KEY_PREFIX: string = "replay:active:";

export function getActiveSessionsKey(projectId: string): string {
  return `${SESSION_REPLAY_ACTIVE_KEY_PREFIX}${projectId}`;
}

/*
 * How often the project index is reconciled against the real keyspace, and
 * how many SCAN iterations that reconcile may spend.
 *
 * The reconcile is the safety net for a missed SADD: an index holding one
 * stale project would otherwise hide every project that started recording
 * afterwards, and those sessions would stay provisional forever. It also
 * carries this job entirely for as long as the ingest path does not
 * maintain the index at all.
 *
 * Every 10 minutes rather than every run, because SCAN walks COUNT keys per
 * iteration whether they match or not and this Redis also holds the chunk
 * staging keys and the whole BullMQ keyspace. The cost of that interval is
 * bounded: a project whose index entry was pruned waits at most one
 * reconcile before its ended sessions are finalized.
 */
const PROJECT_INDEX_RECONCILE_LOCK_KEY: string = "replay:active:reconcile-lock";
const PROJECT_INDEX_RECONCILE_INTERVAL_SECONDS: number = 10 * 60;
const PROJECT_INDEX_SCAN_COUNT: number = 500;
const MAX_PROJECT_INDEX_SCAN_ITERATIONS: number = 200;

/*
 * A session is considered done when no chunk has arrived for this long.
 *
 * 10 minutes, deliberately longer than the recorder's 15s flush cadence
 * and longer than any plausible queue backlog: finalizing early would
 * publish an under-count that the next run silently corrects, and the
 * metering rollup reads finalized headers. Two runs of a 5-minute cron
 * fit inside the window, so a single missed run does not delay a session.
 */
export const SESSION_REPLAY_IDLE_FINALIZE_MS: number = 10 * 60 * 1000;

/*
 * A member older than this can never produce a useful header: its chunks
 * have either already TTL-dropped or never arrived. CleanupStaleResources
 * reaps those; this job leaves them alone so the two jobs cannot fight.
 *
 * The margin over SESSION_REPLAY_MAX_SESSION_MS has to sit strictly INSIDE
 * the ingest path's activity-key TTL (6h, refreshed on every accepted
 * chunk). At the old +2h it was exactly equal to that TTL, so Redis
 * dropped the whole per-project ZSET at or before the moment its oldest
 * member crossed the cutoff and the reap could never actually fire — which
 * also meant its "recordings were lost" warning could never be emitted.
 * 30 minutes is comfortably longer than the 10 minute idle window the
 * finalizer owns, so the two jobs still cannot fight over a member, and
 * comfortably shorter than the 6h TTL, so the reap runs and its diagnostic
 * is real.
 */
export const SESSION_REPLAY_ACTIVITY_ABANDON_MS: number =
  SESSION_REPLAY_MAX_SESSION_MS + 30 * 60 * 1000;

/* Per-run work caps. Both exist to keep one run inside the job timeout. */
export const MAX_SESSIONS_PER_PROJECT_PER_RUN: number = 2000;
export const MAX_SESSIONS_PER_RUN: number = 10000;

/*
 * Unbounded arrays on a repeatedly-rewritten ReplacingMergeTree row are a
 * merge-amplification trap, so correlation arrays are capped. The caps
 * are generous rather than exact — the full sets are always reachable
 * from the telemetry side by sessionId; these arrays only have to be
 * good enough for "which traces / exception groups did this session
 * touch".
 */
export const MAX_TRACE_IDS_PER_SESSION: number = 200;
export const MAX_EXCEPTION_FINGERPRINTS_PER_SESSION: number = 100;

/*
 * Matches MAX_ROUTES_RECORDED in the recorder's RouteRecorder, which is the
 * per-page-load cap on route events. A session that genuinely visited more
 * distinct pages than this is not one anybody reads a route list for, and
 * the column feeds a bloom index that wants bounded cardinality.
 */
export const MAX_ROUTES_PER_SESSION: number = 500;

/*
 * Padding on both ends of the correlation queries' time window. The
 * window is derived from SERVER receive times (activity-set scores /
 * header startTime) while Span.startTime and ExceptionInstance.time are
 * EVENT times from the SDK, so the pad absorbs clock skew and ingest
 * delay. It only widens partition pruning — sessionId IN (...) is what
 * actually scopes the read.
 */
export const SESSION_CORRELATION_WINDOW_PADDING_MS: number = 30 * 60 * 1000;

/*
 * Wall-clock budget for one run, under the 5-minute cron interval and the
 * job's own timeout. Sessions left over are picked up next run — their
 * sorted-set members are only removed on success.
 */
const RUN_BUDGET_MS: number = 4 * 60 * 1000;

/*
 * Narrow chunk columns the aggregate reads, spelled out literally in the
 * SQL below.
 *
 * `payload` is deliberately absent: it is the fattest column in the system
 * and finalization never needs a byte of it, so naming the columns instead
 * of SELECT * is what keeps this job from decompressing every recording it
 * finalizes. They cannot be built from a joined array either — a template
 * substitution in the SQL tag compiles to a single Identifier placeholder,
 * which would render the whole list as one quoted identifier.
 */

/* One row of the per-tab GROUP BY over the chunk table. */
export interface TabChunkAggregate {
  tabId: string;
  chunkCount: number;
  maxChunkIndex: number;
  chunkIndexes: Array<number>;
  fullSnapshotChunkIndexes: Array<number>;
  eventCount: number;
  payloadBytes: number;
  errorCount: number;
  rageClickCount: number;
  deadClickCount: number;
  errorClickCount: number;
  refreshRageCount: number;
  routeCount: number;
  firstUrl: string;
  lastUrl: string;
  firstUrlAtUnixMs: number;
  lastUrlAtUnixMs: number;
  urlChunkCount: number;
  routes: Array<string>;
  hasFinalChunk: boolean;
  sessionStartUnixMs: number;

  /*
   * When this TAB started. sessionStartUnixMs cannot answer that - it is the
   * SESSION's start, written from the recorder's localStorage record, so it
   * is identical across every tab of the session.
   */
  firstChunkStartUnixMs: number;

  lastChunkEndUnixMs: number;
  maxChunkEndOffsetMs: number;
  schemaVersion: number;
  recorderKind: string;
  rumApplicationId: string;
  primaryEntityId: string;
  primaryEntityType: string;
  retentionDate: string;
}

/* The whole-session aggregate, combined across the session's tabs. */
export interface SessionChunkAggregate {
  tabCount: number;
  chunkCount: number;
  maxChunkIndex: number;
  missingChunkCount: number;
  fullSnapshotChunkIndexes: Array<number>;
  eventCount: number;
  payloadBytes: number;
  errorCount: number;
  rageClickCount: number;
  deadClickCount: number;
  errorClickCount: number;
  refreshRageCount: number;
  pageCount: number;

  /*
   * Derived from the chunk rows, not carried forward from the provisional
   * header. The header only ever knew chunk 0's URL, which for a single-page
   * app is the landing page for the whole session.
   */
  firstUrl: string;
  lastUrl: string;
  routes: Array<string>;

  /*
   * Whether firstUrl is the URL the SESSION began on rather than the
   * earliest one that happens to be stored. False for a session whose
   * opening chunks predate the url column, where the header is authoritative.
   */
  firstUrlCoversSessionStart: boolean;

  hasFinalChunk: boolean;
  sessionStartUnixMs: number;
  lastChunkEndUnixMs: number;
  schemaVersion: number;
  recorderKind: string;
  rumApplicationId: string;
  primaryEntityId: string;
  primaryEntityType: string;
  retentionDate: string;
}

/*
 * The provisional header written by the ingest path on the session's
 * first chunk. Everything here is chunk-invariant capture metadata the
 * finalizer cannot derive from chunk rows and therefore carries forward
 * verbatim.
 *
 * startTimeText is the RAW ClickHouse rendering of startTime, not a
 * JavaScript Date. startTime is both the 3rd sort-key element and the
 * partition key, so a value that differs by a single sub-millisecond
 * digit writes a SECOND row instead of replacing the first — which is
 * exactly the duplicate-header bug the argMax read path exists to hide.
 * Round-tripping through Date would truncate DateTime64 precision, so
 * the text is preserved byte for byte.
 */
export interface ProvisionalSessionHeader {
  startTimeText: string;
  startTimeUnixMs: number;
  clientReportedStartTimeText: string;
  retentionDateText: string;
  rumApplicationId: string;
  primaryEntityId: string;
  primaryEntityType: string;
  sealedReason: string;
  triggerReason: string;
  samplePercentageAtCapture: number;
  clockSkewMs: number;
  errorCount: number;
  rageClickCount: number;
  deadClickCount: number;
  errorClickCount: number;
  refreshRageCount: number;
  pageCount: number;
  entryUrl: string;
  exitUrl: string;
  routes: Array<string>;
  browserName: string;
  browserVersion: string;
  osName: string;
  deviceType: string;
  viewportWidth: number;
  viewportHeight: number;
  maskingMode: string;
  consentState: string;
  recorderKind: string;
  recorderVersion: string;
  rrwebVersion: string;
  countryCode: string;
  identifiedUserKey: string;
  identifiedUserLabel: string;
  traceIds: Array<string>;
  exceptionFingerprints: Array<string>;
  fidelityNotices: Array<string>;
  schemaVersion: number;
  wireVersion: number;
  isLegalHold: boolean;
  isPinnedCopy: boolean;
  attributes: JSONObject;
  attributeKeys: Array<string>;
  entityKeys: Array<string>;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/*
 * ClickHouse renders 64-bit integers and Decimals as JSON strings on some
 * server versions and as numbers on others, so every numeric read goes
 * through this rather than a cast.
 */
function toNumberValue(value: unknown): number {
  const parsed: number = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function toTextValue(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  if (value === null || value === undefined) {
    return "";
  }

  return String(value);
}

function toBooleanValue(value: unknown): boolean {
  return value === true || value === 1 || value === "1" || value === "true";
}

function toNumberArrayValue(value: unknown): Array<number> {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((item: unknown): number => {
    return toNumberValue(item);
  });
}

function toTextArrayValue(value: unknown): Array<string> {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item: unknown): string => {
      return toTextValue(item);
    })
    .filter((item: string): boolean => {
      return item.length > 0;
    });
}

/*
 * Members are "<sessionId>:<tabId>". sessionId is 32 hex characters and
 * tabId is opaque and may itself contain a colon, so the split is on the
 * FIRST separator only.
 */
export function parseActiveSessionMember(member: string): {
  sessionId: string;
  tabId: string;
} | null {
  const separatorIndex: number = member.indexOf(":");

  if (separatorIndex <= 0 || separatorIndex === member.length - 1) {
    return null;
  }

  return {
    sessionId: member.substring(0, separatorIndex),
    tabId: member.substring(separatorIndex + 1),
  };
}

export function buildTabAggregateStatement(data: {
  databaseName: string;
  projectId: ObjectID;
  sessionId: string;
}): Statement {
  /*
   * The inner query dedupes ReplacingMergeTree redeliveries: this repo has
   * no FINAL support anywhere, so a retried chunk POST is visible as two
   * rows with the same sort key until a merge collapses them, and
   * sum(payloadBytes) over both would double-count the metering signal.
   * `ORDER BY version DESC LIMIT 1 BY tabId, chunkIndex` keeps the newest
   * write of each chunk identity. projectId and sessionId are pinned by
   * the WHERE clause, so they are constant within the group and are
   * omitted from the LIMIT BY key.
   *
   * The WHERE clause is the (projectId, sessionId) prefix of the chunk
   * table's sort key, which is why this is a key-range read and not a
   * scan.
   */
  return SQL`
    SELECT
      tabId AS tabId,
      count() AS chunkCount,
      max(chunkIndex) AS maxChunkIndex,
      groupArray(chunkIndex) AS chunkIndexes,
      groupArrayIf(chunkIndex, hasFullSnapshot) AS fullSnapshotChunkIndexes,
      sum(eventCount) AS eventCount,
      sum(payloadBytes) AS payloadBytes,
      sum(errorCount) AS errorCount,
      sum(rageClickCount) AS rageClickCount,
      sum(deadClickCount) AS deadClickCount,
      sum(errorClickCount) AS errorClickCount,
      sum(refreshRageCount) AS refreshRageCount,
      sum(routeCount) AS routeCount,
      /*
       * WHERE this tab started and ended, and every page in between.
       *
       * argMin/argMax over chunkStartTime pick the actual first and last
       * chunk rather than relying on chunkIndex, which restarts at 0 for
       * every tab and so cannot order across one.
       *
       * The route union is a SET, not a path: groupArray's element order is
       * unspecified under parallel aggregation, so it is sorted to make the
       * value DETERMINISTIC. That matters beyond tidiness - the header is a
       * ReplacingMergeTree row that the sweep can rewrite, and two runs over
       * identical chunks must produce identical bytes or they churn versions
       * forever. Consumers treat it as membership ("did this session reach
       * /checkout"); entryUrl and exitUrl are what answer the ordered
       * questions, and they come from the argMin/argMax above.
       */
      argMinIf(url, chunkStartTime, url != '') AS firstUrl,
      argMaxIf(url, chunkEndTime, url != '') AS lastUrl,
      /*
       * WHEN the first and last URL-bearing chunks were, which is what
       * orders firstUrl/lastUrl across tabs - and, for firstUrl, what says
       * whether the derivation can be trusted at all. A session live across
       * the deploy that added these columns has early chunks with url = ''
       * and later ones without, so argMinIf returns a MID-session page;
       * comparing it against the tab's real start is how that case falls
       * back to the provisional header, which still holds the landing page.
       *
       * countIf guards the "no chunk has a url" case, where minIf/maxIf
       * return 0 rather than anything meaningful.
       */
      minIf(toUnixTimestamp64Milli(chunkStartTime), url != '') AS firstUrlAtUnixMs,
      maxIf(toUnixTimestamp64Milli(chunkEndTime), url != '') AS lastUrlAtUnixMs,
      countIf(url != '') AS urlChunkCount,
      /*
       * When this TAB started, url or no url. sessionStartTime cannot answer
       * that: it is the SESSION's start, written from the recorder's
       * localStorage record, so it is identical across every tab.
       * Comparing it with firstUrlAtUnixMs is what detects a session whose
       * opening chunks predate the url column.
       */
      toUnixTimestamp64Milli(min(chunkStartTime)) AS firstChunkStartUnixMs,
      arraySort(arrayDistinct(arrayFlatten(groupArray(routes)))) AS routes,
      max(toUInt8(isFinal)) AS hasFinalChunk,
      toUnixTimestamp64Milli(min(sessionStartTime)) AS sessionStartUnixMs,
      toUnixTimestamp64Milli(max(chunkEndTime)) AS lastChunkEndUnixMs,
      max(chunkEndOffsetMs) AS maxChunkEndOffsetMs,
      max(schemaVersion) AS schemaVersion,
      any(recorderKind) AS recorderKind,
      any(rumApplicationId) AS rumApplicationId,
      any(primaryEntityId) AS primaryEntityId,
      any(primaryEntityType) AS primaryEntityType,
      toString(max(retentionDate)) AS retentionDate
    FROM (
      SELECT
        tabId,
        chunkIndex,
        version,
        hasFullSnapshot,
        isFinal,
        eventCount,
        payloadBytes,
        errorCount,
        rageClickCount,
        deadClickCount,
        errorClickCount,
        refreshRageCount,
        routeCount,
        url,
        routes,
        sessionStartTime,
        chunkStartTime,
        chunkEndTime,
        chunkEndOffsetMs,
        schemaVersion,
        recorderKind,
        rumApplicationId,
        primaryEntityId,
        primaryEntityType,
        retentionDate
      FROM ${data.databaseName}.${AnalyticsTableName.RumSessionChunk}
      WHERE projectId = ${{
        type: TableColumnType.ObjectID,
        value: data.projectId,
      }} AND sessionId = ${{
        type: TableColumnType.Text,
        value: data.sessionId,
      }}
      ORDER BY version DESC
      LIMIT 1 BY tabId, chunkIndex
    )
    GROUP BY tabId`;
}

export function buildProvisionalHeaderStatement(data: {
  databaseName: string;
  projectId: ObjectID;
  rumApplicationId: string;
  sessionId: string;
}): Statement {
  /*
   * rumApplicationId is in the WHERE clause purely for key-range pruning
   * — it is the 2nd sort-key element, so including it turns a
   * project-wide scan into an application-scoped one. It is read from the
   * chunk rows, which carry the same value the header does.
   *
   * ORDER BY version DESC LIMIT 1 is the same no-FINAL dedupe as above:
   * an earlier finalization (or a retried provisional write) leaves older
   * versions visible until merge, and reading one of those would resurrect
   * stale metadata.
   */
  return SQL`
    SELECT
      toString(startTime) AS startTimeText,
      toUnixTimestamp64Milli(startTime) AS startTimeUnixMs,
      toString(clientReportedStartTime) AS clientReportedStartTimeText,
      toString(retentionDate) AS retentionDateText,
      rumApplicationId AS rumApplicationId,
      primaryEntityId AS primaryEntityId,
      primaryEntityType AS primaryEntityType,
      sealedReason AS sealedReason,
      triggerReason AS triggerReason,
      samplePercentageAtCapture AS samplePercentageAtCapture,
      clockSkewMs AS clockSkewMs,
      /*
       * The provisional signal counts, carried so sealLostSession can keep
       * them. That path builds an all-zero aggregate because the session's
       * chunks are GONE, and buildFinalizedSessionRow takes every counter
       * from the aggregate - so without these the seal would overwrite real
       * numbers the ingest recorded from chunk 0 with zeroes, and publish a
       * row whose Signals column says "Clean" about a session that errored.
       */
      errorCount AS errorCount,
      rageClickCount AS rageClickCount,
      deadClickCount AS deadClickCount,
      errorClickCount AS errorClickCount,
      refreshRageCount AS refreshRageCount,
      pageCount AS pageCount,
      entryUrl AS entryUrl,
      exitUrl AS exitUrl,
      routes AS routes,
      browserName AS browserName,
      browserVersion AS browserVersion,
      osName AS osName,
      deviceType AS deviceType,
      viewportWidth AS viewportWidth,
      viewportHeight AS viewportHeight,
      maskingMode AS maskingMode,
      consentState AS consentState,
      recorderKind AS recorderKind,
      recorderVersion AS recorderVersion,
      rrwebVersion AS rrwebVersion,
      countryCode AS countryCode,
      identifiedUserKey AS identifiedUserKey,
      identifiedUserLabel AS identifiedUserLabel,
      traceIds AS traceIds,
      exceptionFingerprints AS exceptionFingerprints,
      fidelityNotices AS fidelityNotices,
      schemaVersion AS schemaVersion,
      wireVersion AS wireVersion,
      isLegalHold AS isLegalHold,
      isPinnedCopy AS isPinnedCopy,
      attributes AS attributes,
      attributeKeys AS attributeKeys,
      entityKeys AS entityKeys
    FROM ${data.databaseName}.${AnalyticsTableName.RumSession}
    WHERE projectId = ${{
      type: TableColumnType.ObjectID,
      value: data.projectId,
    }} AND rumApplicationId = ${{
      type: TableColumnType.Text,
      value: data.rumApplicationId,
    }} AND sessionId = ${{
      type: TableColumnType.Text,
      value: data.sessionId,
    }}
    ORDER BY version DESC
    LIMIT 1`;
}

/*
 * ------------------------------------------------------------------
 * Correlation producers.
 *
 * The provisional header only ever carries what the FIRST chunk's
 * envelope declared: the trace ids observed before chunk 0 flushed, and
 * no exception fingerprints at all (fingerprints are computed on the
 * exception INGEST path, never by the recorder). The full sets exist
 * only in the telemetry tables, keyed by the sessionId both ingest paths
 * stamp — Span.sessionId (bloom-indexed) and ExceptionInstance.sessionId.
 *
 * They are read here, at finalize time, as ONE grouped query per table
 * per finalize batch: groupUniqArray by sessionId over the batch's
 * sessionIds, bounded to the batch's padded time window so partition
 * pruning holds. Per-session queries would turn a 2000-session batch
 * into 4000 round trips.
 * ------------------------------------------------------------------
 */

/* What the grouped correlation queries yield for one session. */
export interface SessionCorrelation {
  traceIds: Array<string>;
  exceptionFingerprints: Array<string>;
}

export function buildSessionExceptionFingerprintStatement(data: {
  databaseName: string;
  projectId: ObjectID;
  sessionIds: Array<string>;
  windowStartUnixMs: number;
  windowEndUnixMs: number;
}): Statement {
  /*
   * groupUniqArray's inline max-size parameter caps the transfer inside
   * ClickHouse; it must be appended as trusted SQL because aggregate
   * function PARAMETERS (unlike arguments) cannot be query parameters.
   * mergeCappedArray re-caps after the header merge, so the two bounds
   * cannot drift apart in effect, only in wasted bytes.
   */
  const statement: Statement = SQL`
    SELECT
      sessionId AS sessionId,
      groupUniqArray(`;

  statement.append(String(MAX_EXCEPTION_FINGERPRINTS_PER_SESSION));

  statement.append(SQL`)(fingerprint) AS exceptionFingerprints
    FROM ${data.databaseName}.${AnalyticsTableName.ExceptionInstance}
    WHERE projectId = ${{
      type: TableColumnType.ObjectID,
      value: data.projectId,
    }} AND time >= ${{
      type: TableColumnType.DateTime64,
      value: new Date(data.windowStartUnixMs),
    }} AND time <= ${{
      type: TableColumnType.DateTime64,
      value: new Date(data.windowEndUnixMs),
    }} AND sessionId IN ${{
      type: TableColumnType.ArrayText,
      value: data.sessionIds,
    }} AND fingerprint != ''
    GROUP BY sessionId`);

  return statement;
}

export function buildSessionTraceIdStatement(data: {
  databaseName: string;
  projectId: ObjectID;
  sessionIds: Array<string>;
  windowStartUnixMs: number;
  windowEndUnixMs: number;
}): Statement {
  const statement: Statement = SQL`
    SELECT
      sessionId AS sessionId,
      groupUniqArray(`;

  statement.append(String(MAX_TRACE_IDS_PER_SESSION));

  statement.append(SQL`)(traceId) AS traceIds
    FROM ${data.databaseName}.${AnalyticsTableName.Span}
    WHERE projectId = ${{
      type: TableColumnType.ObjectID,
      value: data.projectId,
    }} AND startTime >= ${{
      type: TableColumnType.DateTime64,
      value: new Date(data.windowStartUnixMs),
    }} AND startTime <= ${{
      type: TableColumnType.DateTime64,
      value: new Date(data.windowEndUnixMs),
    }} AND sessionId IN ${{
      type: TableColumnType.ArrayText,
      value: data.sessionIds,
    }} AND traceId != ''
    GROUP BY sessionId`);

  return statement;
}

export function parseTabAggregateRow(row: JSONObject): TabChunkAggregate {
  return {
    tabId: toTextValue(row["tabId"]),
    chunkCount: toNumberValue(row["chunkCount"]),
    maxChunkIndex: toNumberValue(row["maxChunkIndex"]),
    chunkIndexes: toNumberArrayValue(row["chunkIndexes"]),
    fullSnapshotChunkIndexes: toNumberArrayValue(
      row["fullSnapshotChunkIndexes"],
    ),
    eventCount: toNumberValue(row["eventCount"]),
    payloadBytes: toNumberValue(row["payloadBytes"]),
    errorCount: toNumberValue(row["errorCount"]),
    rageClickCount: toNumberValue(row["rageClickCount"]),
    deadClickCount: toNumberValue(row["deadClickCount"]),
    errorClickCount: toNumberValue(row["errorClickCount"]),
    refreshRageCount: toNumberValue(row["refreshRageCount"]),
    routeCount: toNumberValue(row["routeCount"]),
    firstUrl: toTextValue(row["firstUrl"]),
    lastUrl: toTextValue(row["lastUrl"]),
    firstUrlAtUnixMs: toNumberValue(row["firstUrlAtUnixMs"]),
    lastUrlAtUnixMs: toNumberValue(row["lastUrlAtUnixMs"]),
    urlChunkCount: toNumberValue(row["urlChunkCount"]),
    routes: toTextArrayValue(row["routes"]),
    hasFinalChunk: toBooleanValue(row["hasFinalChunk"]),
    sessionStartUnixMs: toNumberValue(row["sessionStartUnixMs"]),
    firstChunkStartUnixMs: toNumberValue(row["firstChunkStartUnixMs"]),
    lastChunkEndUnixMs: toNumberValue(row["lastChunkEndUnixMs"]),
    maxChunkEndOffsetMs: toNumberValue(row["maxChunkEndOffsetMs"]),
    schemaVersion: toNumberValue(row["schemaVersion"]),
    recorderKind: toTextValue(row["recorderKind"]),
    rumApplicationId: toTextValue(row["rumApplicationId"]),
    primaryEntityId: toTextValue(row["primaryEntityId"]),
    primaryEntityType: toTextValue(row["primaryEntityType"]),
    retentionDate: toTextValue(row["retentionDate"]),
  };
}

export function parseProvisionalHeaderRow(
  row: JSONObject,
): ProvisionalSessionHeader {
  return {
    startTimeText: toTextValue(row["startTimeText"]),
    startTimeUnixMs: toNumberValue(row["startTimeUnixMs"]),
    clientReportedStartTimeText: toTextValue(
      row["clientReportedStartTimeText"],
    ),
    retentionDateText: toTextValue(row["retentionDateText"]),
    rumApplicationId: toTextValue(row["rumApplicationId"]),
    primaryEntityId: toTextValue(row["primaryEntityId"]),
    primaryEntityType: toTextValue(row["primaryEntityType"]),
    sealedReason: toTextValue(row["sealedReason"]),
    triggerReason: toTextValue(row["triggerReason"]),
    samplePercentageAtCapture: toNumberValue(row["samplePercentageAtCapture"]),
    clockSkewMs: toNumberValue(row["clockSkewMs"]),
    errorCount: toNumberValue(row["errorCount"]),
    rageClickCount: toNumberValue(row["rageClickCount"]),
    deadClickCount: toNumberValue(row["deadClickCount"]),
    errorClickCount: toNumberValue(row["errorClickCount"]),
    refreshRageCount: toNumberValue(row["refreshRageCount"]),
    pageCount: toNumberValue(row["pageCount"]),
    entryUrl: toTextValue(row["entryUrl"]),
    exitUrl: toTextValue(row["exitUrl"]),
    routes: toTextArrayValue(row["routes"]),
    browserName: toTextValue(row["browserName"]),
    browserVersion: toTextValue(row["browserVersion"]),
    osName: toTextValue(row["osName"]),
    deviceType: toTextValue(row["deviceType"]),
    viewportWidth: toNumberValue(row["viewportWidth"]),
    viewportHeight: toNumberValue(row["viewportHeight"]),
    maskingMode: toTextValue(row["maskingMode"]),
    consentState: toTextValue(row["consentState"]),
    recorderKind: toTextValue(row["recorderKind"]),
    recorderVersion: toTextValue(row["recorderVersion"]),
    rrwebVersion: toTextValue(row["rrwebVersion"]),
    countryCode: toTextValue(row["countryCode"]),
    identifiedUserKey: toTextValue(row["identifiedUserKey"]),
    identifiedUserLabel: toTextValue(row["identifiedUserLabel"]),
    traceIds: toTextArrayValue(row["traceIds"]),
    exceptionFingerprints: toTextArrayValue(row["exceptionFingerprints"]),
    fidelityNotices: toTextArrayValue(row["fidelityNotices"]),
    schemaVersion: toNumberValue(row["schemaVersion"]),
    wireVersion: toNumberValue(row["wireVersion"]),
    isLegalHold: toBooleanValue(row["isLegalHold"]),
    isPinnedCopy: toBooleanValue(row["isPinnedCopy"]),
    attributes:
      row["attributes"] && typeof row["attributes"] === "object"
        ? (row["attributes"] as JSONObject)
        : {},
    attributeKeys: toTextArrayValue(row["attributeKeys"]),
    entityKeys: toTextArrayValue(row["entityKeys"]),
  };
}

/*
 * Combine the per-tab GROUP BY rows into one session-level aggregate.
 *
 * The grouping is per tab because chunkIndex is minted per tab:
 * sessionStorage is COPIED on tab duplication, so two live tabs can share
 * a sessionId and both count from 0. Detecting gaps over the union of
 * both index sets would mask one tab's real hole behind the other tab's
 * indexes, so the missing-index set difference is computed per tab and
 * summed.
 */
export function combineTabAggregates(
  tabs: Array<TabChunkAggregate>,
): SessionChunkAggregate {
  const combined: SessionChunkAggregate = {
    tabCount: tabs.length,
    chunkCount: 0,
    maxChunkIndex: 0,
    missingChunkCount: 0,
    fullSnapshotChunkIndexes: [],
    eventCount: 0,
    payloadBytes: 0,
    errorCount: 0,
    rageClickCount: 0,
    deadClickCount: 0,
    errorClickCount: 0,
    refreshRageCount: 0,
    pageCount: 0,
    firstUrl: "",
    lastUrl: "",
    routes: [],
    firstUrlCoversSessionStart: false,
    hasFinalChunk: false,
    sessionStartUnixMs: 0,
    lastChunkEndUnixMs: 0,
    schemaVersion: 0,
    recorderKind: "",
    rumApplicationId: "",
    primaryEntityId: "",
    primaryEntityType: "",
    retentionDate: "",
  };

  const snapshotIndexes: Set<number> = new Set<number>();

  /*
   * Route union across tabs. A Set keyed on the URL is the whole
   * de-duplication: a user who bounces between two pages ten times
   * contributes two routes, not twenty. Sorted on the way out - see the SQL
   * note about determinism; the merge order of tabs is no more defined than
   * groupArray's element order.
   */
  const routes: Set<string> = new Set<string>();

  /*
   * The session's first and last URLs are the first URL of the EARLIEST tab
   * and the last URL of the LATEST tab, so both are tracked with the clock
   * that decides them rather than with tab iteration order - the tabs array
   * arrives in whatever order ClickHouse grouped it, and a merge that
   * depended on that order would churn ReplacingMergeTree versions on every
   * re-finalization of identical chunks.
   *
   * The clocks are per-CHUNK times (min chunkStartTime, max chunkEndTime),
   * NOT sessionStartTime: that column is the session's own start, written
   * from the recorder's localStorage record, so it is byte-identical for
   * every tab and orders none of them. The tabId tie-break makes the result
   * total even when two tabs share a millisecond.
   */
  let firstUrlAtUnixMs: number = 0;
  let firstUrlTabId: string = "";
  let lastUrlAtUnixMs: number = 0;
  let lastUrlTabId: string = "";

  /*
   * The earliest chunk of the session, url-bearing or not. Comparing it with
   * firstUrlAtUnixMs is what detects a session whose opening chunks predate
   * the url column: there, the derived firstUrl is a MID-session page and
   * the provisional header is the only thing that still knows the landing
   * page, so buildFinalizedSessionRow must prefer it.
   */
  let earliestChunkStartUnixMs: number = 0;

  for (const tab of tabs) {
    combined.chunkCount += tab.chunkCount;
    combined.maxChunkIndex = Math.max(
      combined.maxChunkIndex,
      tab.maxChunkIndex,
    );

    /*
     * Set difference, not "expected minus stored": a duplicate delivery
     * that survived the SQL dedupe would inflate a counter but cannot
     * make a set difference drift.
     */
    combined.missingChunkCount += ChunkMath.findMissingChunkIndexes(
      tab.chunkIndexes,
      tab.maxChunkIndex,
    ).length;

    for (const index of tab.fullSnapshotChunkIndexes) {
      snapshotIndexes.add(index);
    }

    combined.eventCount += tab.eventCount;
    combined.payloadBytes += tab.payloadBytes;
    combined.errorCount += tab.errorCount;
    combined.rageClickCount += tab.rageClickCount;
    combined.deadClickCount += tab.deadClickCount;
    combined.errorClickCount += tab.errorClickCount;
    combined.refreshRageCount += tab.refreshRageCount;
    /* routeCount is the per-chunk name for what the header calls pageCount. */
    combined.pageCount += tab.routeCount;

    for (const route of tab.routes) {
      if (route && routes.size < MAX_ROUTES_PER_SESSION) {
        routes.add(route);
      }
    }

    if (
      tab.firstChunkStartUnixMs > 0 &&
      (earliestChunkStartUnixMs === 0 ||
        tab.firstChunkStartUnixMs < earliestChunkStartUnixMs)
    ) {
      earliestChunkStartUnixMs = tab.firstChunkStartUnixMs;
    }

    if (tab.firstUrl && tab.urlChunkCount > 0) {
      const isEarlier: boolean =
        combined.firstUrl === "" ||
        tab.firstUrlAtUnixMs < firstUrlAtUnixMs ||
        (tab.firstUrlAtUnixMs === firstUrlAtUnixMs &&
          tab.tabId < firstUrlTabId);

      if (isEarlier) {
        combined.firstUrl = tab.firstUrl;
        firstUrlAtUnixMs = tab.firstUrlAtUnixMs;
        firstUrlTabId = tab.tabId;
      }
    }

    if (tab.lastUrl && tab.urlChunkCount > 0) {
      const isLater: boolean =
        combined.lastUrl === "" ||
        tab.lastUrlAtUnixMs > lastUrlAtUnixMs ||
        (tab.lastUrlAtUnixMs === lastUrlAtUnixMs && tab.tabId > lastUrlTabId);

      if (isLater) {
        combined.lastUrl = tab.lastUrl;
        lastUrlAtUnixMs = tab.lastUrlAtUnixMs;
        lastUrlTabId = tab.tabId;
      }
    }

    combined.hasFinalChunk = combined.hasFinalChunk || tab.hasFinalChunk;

    if (
      tab.sessionStartUnixMs > 0 &&
      (combined.sessionStartUnixMs === 0 ||
        tab.sessionStartUnixMs < combined.sessionStartUnixMs)
    ) {
      combined.sessionStartUnixMs = tab.sessionStartUnixMs;
    }

    combined.lastChunkEndUnixMs = Math.max(
      combined.lastChunkEndUnixMs,
      tab.lastChunkEndUnixMs,
    );

    combined.schemaVersion = Math.max(
      combined.schemaVersion,
      tab.schemaVersion,
    );

    if (!combined.recorderKind && tab.recorderKind) {
      combined.recorderKind = tab.recorderKind;
    }

    if (!combined.rumApplicationId && tab.rumApplicationId) {
      combined.rumApplicationId = tab.rumApplicationId;
    }

    if (!combined.primaryEntityId && tab.primaryEntityId) {
      combined.primaryEntityId = tab.primaryEntityId;
    }

    if (!combined.primaryEntityType && tab.primaryEntityType) {
      combined.primaryEntityType = tab.primaryEntityType;
    }

    /*
     * Every chunk of a session shares one retentionDate by design (it is
     * derived from the clamped session start, not the ingest time), so the
     * latest one wins only as a tie-break if that ever drifts.
     */
    if (tab.retentionDate > combined.retentionDate) {
      combined.retentionDate = tab.retentionDate;
    }
  }

  combined.fullSnapshotChunkIndexes = Array.from(snapshotIndexes).sort(
    (a: number, b: number): number => {
      return a - b;
    },
  );

  /* Sorted, so re-finalizing identical chunks produces an identical row. */
  combined.routes = Array.from(routes).sort();

  /*
   * Only trust the derived entry URL when the session's very first chunk
   * carried one. Otherwise the earliest URL we hold is a mid-session page -
   * a session live across the deploy that added the column - and the
   * provisional header, written from chunk 0, still knows where it began.
   *
   * exitUrl needs no equivalent test: url-less chunks are always
   * chronologically earlier than url-bearing ones, so the LAST url is
   * correct whenever any url exists at all.
   */
  combined.firstUrlCoversSessionStart =
    combined.firstUrl !== "" &&
    earliestChunkStartUnixMs > 0 &&
    firstUrlAtUnixMs <= earliestChunkStartUnixMs;

  return combined;
}

/*
 * Why the session stopped accumulating chunks.
 *
 * Only the ingest path can know it refused chunks for budget or cap
 * reasons, so a provisional header already carrying one of those reasons
 * is authoritative and preserved. Everything else is derivable here, and
 * "idle-timeout" is the honest default: the recorder went away without
 * sending a terminal chunk (browser closed, tab crashed, network died),
 * which is a different statement to the UI than "the recording ended".
 */
export function resolveSealedReason(data: {
  aggregate: SessionChunkAggregate;
  durationMs: number;
  existingSealedReason: string;
}): SessionReplaySealedReason {
  if (
    data.existingSealedReason === SessionReplaySealedReason.Budget ||
    data.existingSealedReason === SessionReplaySealedReason.Truncated
  ) {
    return data.existingSealedReason as SessionReplaySealedReason;
  }

  if (data.aggregate.hasFinalChunk) {
    return SessionReplaySealedReason.FinalChunk;
  }

  if (data.durationMs >= SESSION_REPLAY_MAX_SESSION_MS) {
    return SessionReplaySealedReason.DurationCap;
  }

  if (data.aggregate.chunkCount >= MAX_SESSION_REPLAY_CHUNKS_PER_SESSION) {
    return SessionReplaySealedReason.Truncated;
  }

  return SessionReplaySealedReason.IdleTimeout;
}

/*
 * Header-declared values keep their slots ahead of batch-derived ones:
 * the first chunk's envelope ids are the ones the UI already showed while
 * the session was live, and dropping THOSE under cap pressure would make
 * a session's correlation appear to go backwards at finalization.
 */
function mergeCappedArray(
  existing: Array<string>,
  additional: Array<string>,
  cap: number,
): Array<string> {
  const merged: Set<string> = new Set<string>(existing);

  for (const value of additional) {
    if (merged.size >= cap) {
      break;
    }
    merged.add(value);
  }

  return Array.from(merged).slice(0, cap);
}

/*
 * Build the ONE authoritative header row.
 *
 * `_id` and `createdAt` are supplied explicitly because insertJsonRows
 * goes down the JSONEachRow path, where sanitizeCreate never runs and
 * nothing auto-fills them.
 */
export function buildFinalizedSessionRow(data: {
  projectId: ObjectID;
  sessionId: string;
  aggregate: SessionChunkAggregate;
  header: ProvisionalSessionHeader | null;
  traceIds: Array<string>;
  exceptionFingerprints: Array<string>;
  writtenAt: Date;
  /*
   * Used only by the never-finalized sweep, whose chunkless sessions have
   * no aggregate to resolve a reason FROM: the honest answer is
   * "recording-lost", which no combination of zeroed aggregates produces.
   */
  sealedReasonOverride?: SessionReplaySealedReason;
}): JSONObject {
  const aggregate: SessionChunkAggregate = data.aggregate;
  const header: ProvisionalSessionHeader | null = data.header;

  /*
   * startTime must be byte-identical to the provisional header's, because
   * it is both a sort-key element and the partition key: a different
   * rendering inserts a second row rather than replacing the first. When
   * no header exists (chunk 0's header write was lost, or the session was
   * only ever provisional) the clamped sessionStartTime the ingest path
   * stamped on every chunk is the same value, so it is a safe fallback.
   */
  const startTimeUnixMs: number =
    header && header.startTimeUnixMs > 0
      ? header.startTimeUnixMs
      : aggregate.sessionStartUnixMs;

  const startTimeText: string =
    header && header.startTimeText
      ? header.startTimeText
      : OneUptimeDate.toClickhouseDateTime64(new Date(startTimeUnixMs));

  /* A session can never end before it started, however skewed the input. */
  const endTimeUnixMs: number = Math.max(
    startTimeUnixMs,
    aggregate.lastChunkEndUnixMs,
  );
  const durationMs: number = endTimeUnixMs - startTimeUnixMs;

  const sealedReason: SessionReplaySealedReason =
    data.sealedReasonOverride ??
    resolveSealedReason({
      aggregate: aggregate,
      durationMs: durationMs,
      existingSealedReason: header ? header.sealedReason : "",
    });

  const retentionDateText: string =
    header && header.retentionDateText
      ? header.retentionDateText
      : aggregate.retentionDate;

  return {
    _id: ObjectID.generateTimeOrdered().toString(),
    createdAt: OneUptimeDate.toClickhouseDateTime(data.writtenAt),

    projectId: data.projectId.toString(),
    rumApplicationId:
      aggregate.rumApplicationId || (header ? header.rumApplicationId : ""),
    primaryEntityId:
      aggregate.primaryEntityId || (header ? header.primaryEntityId : ""),
    primaryEntityType:
      aggregate.primaryEntityType ||
      (header ? header.primaryEntityType : ServiceType.RealUserMonitor),
    startTime: startTimeText,
    sessionId: data.sessionId,

    /*
     * Unix MILLIseconds. Nanoseconds (~1.75e18) exceed
     * Number.MAX_SAFE_INTEGER and would lose precision crossing JSON,
     * making the ReplacingMergeTree replace order non-deterministic.
     */
    version: data.writtenAt.getTime(),

    isFinalized: true,
    sealedReason: sealedReason,
    endTime: OneUptimeDate.toClickhouseDateTime64(new Date(endTimeUnixMs)),
    clientReportedStartTime:
      header && header.clientReportedStartTimeText
        ? header.clientReportedStartTimeText
        : startTimeText,

    durationMs: durationMs,
    chunkCount: aggregate.chunkCount,
    maxChunkIndex: aggregate.maxChunkIndex,
    missingChunkCount: aggregate.missingChunkCount,
    eventCount: aggregate.eventCount,
    payloadBytes: aggregate.payloadBytes,
    viewportWidth: header ? header.viewportWidth : 0,
    viewportHeight: header ? header.viewportHeight : 0,
    clockSkewMs: header ? header.clockSkewMs : 0,

    errorCount: aggregate.errorCount,
    rageClickCount: aggregate.rageClickCount,
    deadClickCount: aggregate.deadClickCount,
    errorClickCount: aggregate.errorClickCount,
    refreshRageCount: aggregate.refreshRageCount,
    pageCount: aggregate.pageCount,

    hasError: aggregate.errorCount > 0,
    triggerReason: header ? header.triggerReason : "",
    samplePercentageAtCapture: header ? header.samplePercentageAtCapture : 0,

    /*
     * Derived from the chunk rows, falling back to the provisional header.
     *
     * These three used to be copied straight from the header, which is
     * written once on chunk 0 - so a single-page app reported its landing
     * page as its exit URL forever, routes[] could never hold more than one
     * element (making the "Exit page URL (exact)" filter unable to match a
     * page the user demonstrably reached), and a session spanning two page
     * loads had its entryUrl overwritten by the LAST load's URL.
     *
     * The fallback is what keeps sessions recorded before the chunk table
     * carried url/routes rendering exactly as they do today.
     */
    entryUrl:
      (aggregate.firstUrlCoversSessionStart ? aggregate.firstUrl : "") ||
      (header ? header.entryUrl : ""),
    exitUrl: aggregate.lastUrl || (header ? header.exitUrl : ""),
    /*
     * Derived list first, with the header's copy appended only as a fallback
     * for sessions whose chunks predate the url/routes columns - for
     * everything else it is already in the derived list and de-duplicates
     * away. Sorted for the determinism reason in the SQL comment: the two
     * inputs are each sorted, but concatenating them is not.
     */
    routes: mergeCappedArray(
      aggregate.routes,
      header ? header.routes : [],
      MAX_ROUTES_PER_SESSION,
    ).sort(),

    browserName: header ? header.browserName : "",
    browserVersion: header ? header.browserVersion : "",
    osName: header ? header.osName : "",
    deviceType: header ? header.deviceType : "",
    maskingMode: header ? header.maskingMode : "",
    consentState: header ? header.consentState : "",
    recorderKind: aggregate.recorderKind || (header ? header.recorderKind : ""),
    recorderVersion: header ? header.recorderVersion : "",
    rrwebVersion: header ? header.rrwebVersion : "",

    countryCode: header ? header.countryCode : "",
    identifiedUserKey: header ? header.identifiedUserKey : "",
    identifiedUserLabel: header ? header.identifiedUserLabel : "",

    traceIds: mergeCappedArray(
      header ? header.traceIds : [],
      data.traceIds,
      MAX_TRACE_IDS_PER_SESSION,
    ),
    exceptionFingerprints: mergeCappedArray(
      header ? header.exceptionFingerprints : [],
      data.exceptionFingerprints,
      MAX_EXCEPTION_FINGERPRINTS_PER_SESSION,
    ),
    fidelityNotices: header ? header.fidelityNotices : [],
    fullSnapshotChunkIndexes: aggregate.fullSnapshotChunkIndexes,

    schemaVersion:
      aggregate.schemaVersion ||
      (header && header.schemaVersion
        ? header.schemaVersion
        : SESSION_REPLAY_SCHEMA_VERSION),
    wireVersion:
      header && header.wireVersion
        ? header.wireVersion
        : SESSION_REPLAY_WIRE_VERSION,

    isLegalHold: header ? header.isLegalHold : false,
    /*
     * Always false from the finalizer: a pinned COPY is written only by
     * the materializer, and a re-finalization of a pinned session writes
     * an ordinary-retention header that the materializer's far-future
     * copy supersedes on version.
     */
    isPinnedCopy: false,
    attributes: header ? header.attributes : {},
    attributeKeys: header ? header.attributeKeys : [],
    entityKeys: header ? header.entityKeys : [],
    retentionDate: retentionDateText,
  };
}

function getDatabaseName(): string {
  const databaseName: string | undefined =
    RumSessionChunkService.database.getDatasourceOptions().database;

  if (!databaseName) {
    throw new Error("ClickHouse database name is not configured");
  }

  return databaseName;
}

/*
 * The @clickhouse/client types are a Common dependency and are not
 * resolvable from App, so the result set is typed structurally — the same
 * shape App/FeatureSet/BaseAPI/API/NetworkDeviceFlow.ts uses.
 */
interface ClickhouseJsonResultSet {
  json: () => Promise<{ data: Array<JSONObject> }>;
}

async function readRows(statement: Statement): Promise<Array<JSONObject>> {
  const resultSet: ClickhouseJsonResultSet =
    (await RumSessionChunkService.executeQuery(
      statement,
    )) as unknown as ClickhouseJsonResultSet;

  const parsed: { data: Array<JSONObject> } = await resultSet.json();

  return parsed.data || [];
}

/*
 * Run both grouped correlation queries for one finalize batch and fold
 * the rows into a per-session map. Sessions with no spans / no
 * exceptions simply have no row and no map entry — the caller treats a
 * missing entry as empty.
 *
 * Failure here is DEGRADED ENRICHMENT, not a finalization failure: the
 * header (and with it metering) must still be written even when the
 * telemetry tables cannot be read, so each query catches its own errors
 * and contributes nothing rather than throwing. The two signals fail
 * independently for the same reason.
 */
export async function fetchSessionCorrelation(data: {
  databaseName: string;
  projectId: ObjectID;
  sessionIds: Array<string>;
  windowStartUnixMs: number;
  windowEndUnixMs: number;
}): Promise<Map<string, SessionCorrelation>> {
  const correlationBySessionId: Map<string, SessionCorrelation> = new Map<
    string,
    SessionCorrelation
  >();

  if (data.sessionIds.length === 0) {
    return correlationBySessionId;
  }

  const getOrCreate: (sessionId: string) => SessionCorrelation = (
    sessionId: string,
  ): SessionCorrelation => {
    const existing: SessionCorrelation | undefined =
      correlationBySessionId.get(sessionId);

    if (existing) {
      return existing;
    }

    const created: SessionCorrelation = {
      traceIds: [],
      exceptionFingerprints: [],
    };
    correlationBySessionId.set(sessionId, created);
    return created;
  };

  try {
    const fingerprintRows: Array<JSONObject> = await readRows(
      buildSessionExceptionFingerprintStatement({
        databaseName: data.databaseName,
        projectId: data.projectId,
        sessionIds: data.sessionIds,
        windowStartUnixMs: data.windowStartUnixMs,
        windowEndUnixMs: data.windowEndUnixMs,
      }),
    );

    for (const row of fingerprintRows) {
      const rowSessionId: string = toTextValue(row["sessionId"]);

      if (!rowSessionId) {
        continue;
      }

      getOrCreate(rowSessionId).exceptionFingerprints = toTextArrayValue(
        row["exceptionFingerprints"],
      ).slice(0, MAX_EXCEPTION_FINGERPRINTS_PER_SESSION);
    }
  } catch (error) {
    logger.error(
      `${JOB_NAME}: could not read exception fingerprints for ${data.sessionIds.length} session(s) in project ${data.projectId.toString()}; finalizing without them: ${getErrorMessage(error)}`,
    );
  }

  try {
    const traceRows: Array<JSONObject> = await readRows(
      buildSessionTraceIdStatement({
        databaseName: data.databaseName,
        projectId: data.projectId,
        sessionIds: data.sessionIds,
        windowStartUnixMs: data.windowStartUnixMs,
        windowEndUnixMs: data.windowEndUnixMs,
      }),
    );

    for (const row of traceRows) {
      const rowSessionId: string = toTextValue(row["sessionId"]);

      if (!rowSessionId) {
        continue;
      }

      getOrCreate(rowSessionId).traceIds = toTextArrayValue(
        row["traceIds"],
      ).slice(0, MAX_TRACE_IDS_PER_SESSION);
    }
  } catch (error) {
    logger.error(
      `${JOB_NAME}: could not read span trace ids for ${data.sessionIds.length} session(s) in project ${data.projectId.toString()}; finalizing without them: ${getErrorMessage(error)}`,
    );
  }

  return correlationBySessionId;
}

/*
 * Outcome of one finalization attempt.
 *
 * "erased" is not a failure and not "nothing to do": the caller still
 * drops the activity entries, but it must NOT be logged as a lost
 * recording, and no header may be written.
 */
export type FinalizeSessionOutcome = "written" | "no-chunks" | "erased";

/*
 * Finalize one session.
 *
 * Returns "no-chunks" when the session has no stored chunks at all — the
 * caller treats that as "nothing to do" and drops the activity entry
 * rather than retrying forever.
 */
export async function finalizeSession(data: {
  projectId: ObjectID;
  sessionId: string;
  databaseName: string;
  /*
   * Batch-derived correlation from fetchSessionCorrelation. Optional
   * because the caller fetches it once per BATCH — a per-session fetch
   * here would defeat the grouped query. Absent means "none found".
   */
  correlation?: SessionCorrelation | undefined;
}): Promise<FinalizeSessionOutcome> {
  /*
   * The erasure tombstone is checked FIRST, before a single chunk row is
   * read.
   *
   * The erasure job submits `ALTER ... DELETE` mutations and deliberately
   * does not wait for them, and a ClickHouse mutation only ever rewrites
   * the parts that existed when it was submitted. So between the erasure
   * at T and the mutation finishing, the chunk rows are still visible from
   * here. Without this check the finalizer reads them, derives a header
   * and writes a brand new RumSessionV1 row at `version = Date.now()`
   * carrying identifiedUserKey, entryUrl, exitUrl, routes and countryCode
   * for the subject who asked to be erased — a row no mutation will ever
   * see and nothing will ever delete again.
   *
   * isSessionErased fails CLOSED by THROWING when Redis cannot answer.
   * That propagates to finalizeExpiredSessions' per-session catch, which
   * counts a failure and leaves the activity entries in place, so the
   * session is retried next run instead of either being resurrected or
   * being silently dropped off the queue on a transient blip.
   */
  const erased: boolean = await isSessionErased({
    projectId: data.projectId.toString(),
    sessionId: data.sessionId,
  });

  if (erased) {
    logger.info(
      `${JOB_NAME}: session ${data.sessionId} in project ${data.projectId.toString()} is tombstoned as erased; refusing to write a header.`,
    );
    return "erased";
  }

  const tabRows: Array<JSONObject> = await readRows(
    buildTabAggregateStatement({
      databaseName: data.databaseName,
      projectId: data.projectId,
      sessionId: data.sessionId,
    }),
  );

  if (tabRows.length === 0) {
    return "no-chunks";
  }

  const aggregate: SessionChunkAggregate = combineTabAggregates(
    tabRows.map(parseTabAggregateRow),
  );

  let header: ProvisionalSessionHeader | null = null;

  if (aggregate.rumApplicationId) {
    const headerRows: Array<JSONObject> = await readRows(
      buildProvisionalHeaderStatement({
        databaseName: data.databaseName,
        projectId: data.projectId,
        rumApplicationId: aggregate.rumApplicationId,
        sessionId: data.sessionId,
      }),
    );

    const headerRow: JSONObject | undefined = headerRows[0];

    if (headerRow) {
      header = parseProvisionalHeaderRow(headerRow);
    }
  }

  if (!header) {
    /*
     * A session whose provisional header never landed would otherwise be
     * invisible in the list despite having playable chunks, so the
     * finalizer synthesises one. It is worth a warning: it means a chunk-0
     * header write was lost.
     */
    logger.warn(
      `${JOB_NAME}: no provisional header for session ${data.sessionId}; writing a chunk-derived header`,
    );
  }

  const row: JSONObject = buildFinalizedSessionRow({
    projectId: data.projectId,
    sessionId: data.sessionId,
    aggregate: aggregate,
    header: header,
    /*
     * The batch's grouped queries over Span and ExceptionInstance (see
     * fetchSessionCorrelation) are the reverse-correlation producer: the
     * provisional header only ever carries what the FIRST chunk's
     * envelope declared, so everything observed in chunks 1..N arrives
     * here and is merged (deduped, capped) on top of the header's ids.
     */
    traceIds: data.correlation ? data.correlation.traceIds : [],
    exceptionFingerprints: data.correlation
      ? data.correlation.exceptionFingerprints
      : [],
    writtenAt: OneUptimeDate.getCurrentDate(),
  });

  /*
   * wait_for_async_insert is forced on for this one row.
   *
   * insertJsonRows defaults to wait_for_async_insert: 0, where the await
   * resolves as soon as ClickHouse has accepted the row into its
   * async-insert buffer — NOT when it is durable. The caller ZREMs the
   * session's activity entries immediately after this resolves, so a
   * buffer flush failure would silently lose the header while the session
   * is already off the queue, leaving it provisional (zeroed aggregates)
   * and unmetered forever. Finalization is one small row per session, not
   * a hot ingest path, so paying for the durability ack is cheap and it is
   * what makes the ZREM-only-on-success contract below actually true.
   */
  await RumSessionService.insertJsonRows([row], {
    clickhouseSettings: {
      wait_for_async_insert: 1,
    },
  });

  return "written";
}

/*
 * Walk the keyspace for per-project activity sets and fold them into the
 * project index.
 *
 * Returns the project ids found. Bounded by MAX_PROJECT_INDEX_SCAN_
 * ITERATIONS so a huge keyspace degrades to "some projects reconciled this
 * hour, the rest next hour" instead of blowing the job's time budget.
 */
export async function reconcileActiveProjectIndex(
  client: ClientType,
): Promise<Array<string>> {
  const discovered: Set<string> = new Set<string>();

  let cursor: string = "0";
  let iterations: number = 0;

  do {
    const [nextCursor, keys]: [string, Array<string>] = await client.scan(
      cursor,
      "MATCH",
      `${SESSION_REPLAY_ACTIVE_KEY_PREFIX}*`,
      "COUNT",
      PROJECT_INDEX_SCAN_COUNT,
    );

    cursor = nextCursor;
    iterations++;

    for (const key of keys) {
      /*
       * The index itself and the reconcile lock share the prefix, and
       * neither is a project id.
       */
      if (
        key === SESSION_REPLAY_ACTIVE_PROJECTS_KEY ||
        key === PROJECT_INDEX_RECONCILE_LOCK_KEY
      ) {
        continue;
      }

      const projectId: string = key.substring(
        SESSION_REPLAY_ACTIVE_KEY_PREFIX.length,
      );

      if (projectId.length > 0) {
        discovered.add(projectId);
      }
    }
  } while (cursor !== "0" && iterations < MAX_PROJECT_INDEX_SCAN_ITERATIONS);

  if (discovered.size > 0) {
    await client.sadd(
      SESSION_REPLAY_ACTIVE_PROJECTS_KEY,
      Array.from(discovered),
    );
  }

  return Array.from(discovered);
}

/*
 * Projects with sessions that may need finalizing.
 *
 * The index is the fast path and is what the ingest path is expected to
 * maintain. The reconcile below is what makes a missed SADD a delay rather
 * than permanent data loss, and it also carries the whole job on its own
 * for as long as the ingest path does not maintain the index at all.
 */
export async function discoverActiveProjectIds(
  client: ClientType,
): Promise<Array<string>> {
  const indexed: Array<string> = await client.smembers(
    SESSION_REPLAY_ACTIVE_PROJECTS_KEY,
  );

  /*
   * The lock is taken UNCONDITIONALLY, including when the index is empty.
   *
   * An empty index is the NORMAL state, not an anomaly: session replay is
   * opt-in, so on the overwhelming majority of installs no project ever
   * records and the index is permanently empty. Exempting the empty case
   * from the rate limit therefore made every single 5-minute run perform a
   * full SCAN of up to MAX_PROJECT_INDEX_SCAN_ITERATIONS x
   * PROJECT_INDEX_SCAN_COUNT keys against a Redis that also holds the
   * chunk staging keys and the entire BullMQ keyspace — the exact cost the
   * rate limit exists to avoid.
   *
   * Losing the race just means this run finalizes nothing on an install
   * that had nothing to finalize; the replica holding the lock does the
   * reconcile, and the idle window is 10 minutes anyway.
   *
   * The lock is taken in Redis rather than in process memory so it holds
   * across worker replicas and restarts.
   */
  const lockAcquired: "OK" | null = await client.set(
    PROJECT_INDEX_RECONCILE_LOCK_KEY,
    "1",
    "EX",
    PROJECT_INDEX_RECONCILE_INTERVAL_SECONDS,
    "NX",
  );

  if (lockAcquired !== "OK") {
    return indexed;
  }

  const discovered: Array<string> = await reconcileActiveProjectIndex(client);

  return Array.from(new Set<string>([...indexed, ...discovered]));
}

export async function finalizeExpiredSessions(): Promise<void> {
  const client: ClientType | null = Redis.getClient();

  if (!client || !Redis.isConnected()) {
    logger.warn(
      `${JOB_NAME}: Redis is not connected; skipping this run. Ingest stages through Redis too, so there is nothing to finalize while it is down.`,
    );
    return;
  }

  const databaseName: string = getDatabaseName();
  const runStartedAt: number = Date.now();
  const cutoffUnixMs: number = runStartedAt - SESSION_REPLAY_IDLE_FINALIZE_MS;

  const projectIds: Array<string> = await discoverActiveProjectIds(client);

  let finalizedCount: number = 0;
  let failedCount: number = 0;

  for (const projectId of projectIds) {
    if (Date.now() - runStartedAt > RUN_BUDGET_MS) {
      logger.warn(
        `${JOB_NAME}: run budget exhausted with ${projectIds.length} project(s) enumerated; remaining sessions are picked up next run.`,
      );
      break;
    }

    if (finalizedCount >= MAX_SESSIONS_PER_RUN) {
      break;
    }

    const activeKey: string = getActiveSessionsKey(projectId);

    const expiredMembers: Array<string> = [];
    const lastActivityUnixMsByMember: Map<string, number> = new Map<
      string,
      number
    >();

    try {
      /*
       * The whole point of the sorted set: this reads only the range that
       * has actually gone idle, so the cost of a run scales with the number
       * of sessions ENDING, not with the number recorded.
       *
       * WITHSCORES because the score IS the last-chunk receive time —
       * exactly the batch's activity envelope, from which the correlation
       * queries below derive their time window without another read.
       */
      const membersWithScores: Array<string> = await client.zrangebyscore(
        activeKey,
        "-inf",
        cutoffUnixMs,
        "WITHSCORES",
        "LIMIT",
        0,
        MAX_SESSIONS_PER_PROJECT_PER_RUN,
      );

      for (
        let index: number = 0;
        index + 1 < membersWithScores.length;
        index += 2
      ) {
        const member: string = membersWithScores[index]!;
        expiredMembers.push(member);
        lastActivityUnixMsByMember.set(
          member,
          toNumberValue(membersWithScores[index + 1]),
        );
      }
    } catch (error) {
      logger.error(
        `${JOB_NAME}: could not read the activity set for project ${projectId}: ${getErrorMessage(error)}`,
      );
      continue;
    }

    if (expiredMembers.length === 0) {
      /*
       * Drop the project from the index once its sorted set has drained, so
       * a run does not pay a round trip per project that has EVER recorded.
       * Safe to be wrong: the periodic reconcile above (and the ingest
       * path's SADD, once it maintains the index) puts a project back the
       * moment it has sessions again.
       */
      try {
        const remaining: number = await client.zcard(activeKey);

        if (remaining === 0) {
          await client.srem(SESSION_REPLAY_ACTIVE_PROJECTS_KEY, projectId);
        }
      } catch (error) {
        logger.warn(
          `${JOB_NAME}: could not prune the project index for ${projectId}: ${getErrorMessage(error)}`,
        );
      }
      continue;
    }

    /*
     * One header covers all of a session's tabs, so members are collapsed
     * by sessionId and finalized once. A tab that is still recording under
     * the same sessionId simply gets picked up by a later run, which
     * recomputes every aggregate from scratch and wins on version — the
     * reason deriving instead of accumulating matters.
     */
    const membersBySessionId: Map<string, Array<string>> = new Map<
      string,
      Array<string>
    >();

    let batchOldestActivityUnixMs: number = Number.MAX_SAFE_INTEGER;
    let batchNewestActivityUnixMs: number = 0;

    for (const member of expiredMembers) {
      const parsed: { sessionId: string; tabId: string } | null =
        parseActiveSessionMember(member);

      if (!parsed) {
        logger.warn(
          `${JOB_NAME}: dropping malformed activity member "${member}" for project ${projectId}`,
        );
        await client.zrem(activeKey, member);
        continue;
      }

      const lastActivityUnixMs: number =
        lastActivityUnixMsByMember.get(member) || cutoffUnixMs;

      batchOldestActivityUnixMs = Math.min(
        batchOldestActivityUnixMs,
        lastActivityUnixMs,
      );
      batchNewestActivityUnixMs = Math.max(
        batchNewestActivityUnixMs,
        lastActivityUnixMs,
      );

      const existing: Array<string> | undefined = membersBySessionId.get(
        parsed.sessionId,
      );

      if (existing) {
        existing.push(member);
      } else {
        membersBySessionId.set(parsed.sessionId, [member]);
      }
    }

    /*
     * One grouped read per telemetry table for the WHOLE batch. The
     * window opens a full session length before the batch's oldest
     * activity because the score marks a session's LAST chunk — its
     * spans and exceptions started up to SESSION_REPLAY_MAX_SESSION_MS
     * earlier.
     */
    let correlationBySessionId: Map<string, SessionCorrelation> = new Map<
      string,
      SessionCorrelation
    >();

    if (membersBySessionId.size > 0) {
      correlationBySessionId = await fetchSessionCorrelation({
        databaseName: databaseName,
        projectId: new ObjectID(projectId),
        sessionIds: Array.from(membersBySessionId.keys()),
        windowStartUnixMs:
          batchOldestActivityUnixMs -
          SESSION_REPLAY_MAX_SESSION_MS -
          SESSION_CORRELATION_WINDOW_PADDING_MS,
        windowEndUnixMs:
          batchNewestActivityUnixMs + SESSION_CORRELATION_WINDOW_PADDING_MS,
      });
    }

    for (const [sessionId, members] of membersBySessionId.entries()) {
      if (Date.now() - runStartedAt > RUN_BUDGET_MS) {
        break;
      }

      try {
        const outcome: FinalizeSessionOutcome = await finalizeSession({
          projectId: new ObjectID(projectId),
          sessionId: sessionId,
          databaseName: databaseName,
          correlation: correlationBySessionId.get(sessionId),
        });

        if (outcome === "written") {
          finalizedCount++;
        } else if (outcome === "no-chunks") {
          logger.warn(
            `${JOB_NAME}: session ${sessionId} in project ${projectId} has no stored chunks; dropping its activity entry.`,
          );
        }

        /*
         * Only remove the activity entries after a successful write, so a
         * ClickHouse blip leaves the session queued instead of leaving it
         * permanently provisional.
         */
        await client.zrem(activeKey, members);
      } catch (error) {
        failedCount++;
        logger.error(
          `${JOB_NAME}: failed to finalize session ${sessionId} in project ${projectId}: ${getErrorMessage(error)}`,
        );
      }
    }
  }

  if (finalizedCount > 0 || failedCount > 0) {
    logger.debug(
      `${JOB_NAME}: finalized ${finalizedCount} session(s) with ${failedCount} failure(s)`,
    );
  }
}

/*
 * ------------------------------------------------------------------
 * The never-finalized sweep.
 *
 * The 5-minute finalizer above discovers work EXCLUSIVELY through Redis
 * sorted sets — and this deployment runs Redis with persistence off. A
 * Redis restart or eviction therefore used to orphan every in-flight
 * session permanently: the header stayed provisional forever (zeroed
 * aggregates, invisible duration), and because metering reads only
 * finalized headers, the session was never billed either. Nothing could
 * ever recover it, and CleanupStaleResources' own log line said so.
 *
 * This sweep is the ClickHouse-side safety net: an hourly scan of the
 * header table itself for provisional sessions old enough that no chunk
 * can still arrive, each re-finalized through the exact same idempotent
 * finalizeSession path. Redis loss becomes bounded finalization delay.
 *
 * A provisional header whose chunks never landed (or TTL-dropped before
 * the sweep reached it) cannot be finalized from chunks and would be
 * re-selected every hour forever; it is sealed instead with
 * sealedReason "recording-lost" — an honest terminal record that a
 * recording existed and was lost.
 * ------------------------------------------------------------------
 */

const SWEEP_JOB_NAME: string = "Rum:SweepNeverFinalizedSessions";

/*
 * A provisional header older than the abandon window can no longer
 * receive chunks (the recorder's hard session cap plus margin), so
 * finalizing it cannot publish an under-count the way finalizing an
 * ACTIVE session early would.
 */
export const SWEEP_MIN_SESSION_AGE_MS: number =
  SESSION_REPLAY_ACTIVITY_ABANDON_MS;

/*
 * How far back one sweep looks. Bounded so the hourly GROUP BY prunes to
 * a fixed number of partitions instead of walking the whole table; wide
 * enough (35 days) that even a Redis loss discovered late is still
 * recovered for every retention tier except the 90-day one's tail — and
 * those sessions are found too, for as long as they remain in the window.
 */
export const SWEEP_LOOKBACK_MS: number = 35 * 24 * 60 * 60 * 1000;

/*
 * Per-run cap. The sweep is a safety net that converges over successive
 * hourly runs after a mass loss, not a bulk migrator that must finish in
 * one pass.
 */
export const MAX_SWEEP_SESSIONS_PER_RUN: number = 500;

const SWEEP_RUN_BUDGET_MS: number = 4 * 60 * 1000;

export interface NeverFinalizedSessionRef {
  projectId: string;
  rumApplicationId: string;
  sessionId: string;
  /*
   * Milliseconds, from the header's startTime. Carried so the sweep can
   * derive a correlation window for its batch without re-reading headers;
   * 0 when the rendering could not be parsed.
   */
  startTimeUnixMs: number;
}

/*
 * Provisional sessions old enough to sweep.
 *
 * The isFinalized test MUST be argMax over version, in HAVING: until a
 * background merge collapses the ReplacingMergeTree versions, a finalized
 * session still has its old provisional row visible, and a bare
 * `WHERE isFinalized = 0` would re-finalize every recently-finalized
 * session in the window on every run.
 */
export function buildNeverFinalizedStatement(data: {
  databaseName: string;
  nowUnixMs: number;
  limit: number;
}): Statement {
  const cutoff: Date = new Date(data.nowUnixMs - SWEEP_MIN_SESSION_AGE_MS);
  const floor: Date = new Date(data.nowUnixMs - SWEEP_LOOKBACK_MS);

  return SQL`
    SELECT
      toString(projectId) AS projectId,
      toString(rumApplicationId) AS rumApplicationId,
      sessionId AS sessionId,
      toUnixTimestamp64Milli(max(startTime)) AS startTimeUnixMs
    FROM ${data.databaseName}.${AnalyticsTableName.RumSession}
    WHERE startTime >= ${{
      type: TableColumnType.DateTime64,
      value: floor,
    }}
      AND startTime < ${{
        type: TableColumnType.DateTime64,
        value: cutoff,
      }}
      AND retentionDate >= now()
    GROUP BY projectId, rumApplicationId, sessionId
    HAVING argMax(toUInt8(isFinalized), version) = 0
    ORDER BY max(startTime) DESC
    LIMIT ${{
      type: TableColumnType.Number,
      value: data.limit,
    }}`;
}

/*
 * Seal a provisional header whose chunks are gone, so it stops being
 * re-swept every hour and the list can render "recording lost" instead of
 * a session that looks like it is still recording.
 */
async function sealLostSession(data: {
  databaseName: string;
  projectId: ObjectID;
  rumApplicationId: string;
  sessionId: string;
}): Promise<boolean> {
  const headerRows: Array<JSONObject> = await readRows(
    buildProvisionalHeaderStatement({
      databaseName: data.databaseName,
      projectId: data.projectId,
      rumApplicationId: data.rumApplicationId,
      sessionId: data.sessionId,
    }),
  );

  const headerRow: JSONObject | undefined = headerRows[0];

  if (!headerRow) {
    return false;
  }

  const header: ProvisionalSessionHeader = parseProvisionalHeaderRow(headerRow);

  /*
   * A zeroed aggregate carrying the header's own identity: the sealed row
   * must share the exact ReplacingMergeTree replace key (projectId,
   * rumApplicationId, startTime, sessionId) or it would sit BESIDE the
   * provisional row instead of replacing it.
   */
  const emptyAggregate: SessionChunkAggregate = {
    tabCount: 0,
    chunkCount: 0,
    maxChunkIndex: 0,
    missingChunkCount: 0,
    fullSnapshotChunkIndexes: [],
    eventCount: 0,
    payloadBytes: 0,
    /*
     * Carried from the header, not zeroed.
     *
     * The chunks are gone - that is what "recording lost" means - but the
     * ingest recorded what chunk 0 saw before they were, and those counts
     * are the only remaining evidence about the session. Zeroing them here
     * would publish a sealed row whose Signals column reads "Clean" for a
     * session that errored, which is a worse answer than "we lost the
     * footage of a session that errored".
     */
    errorCount: header.errorCount,
    rageClickCount: header.rageClickCount,
    deadClickCount: header.deadClickCount,
    errorClickCount: header.errorClickCount,
    refreshRageCount: header.refreshRageCount,
    pageCount: header.pageCount,
    /*
     * Empty on purpose: this session has NO chunk rows, so there is nothing
     * to derive from and buildFinalizedSessionRow falls back to the
     * provisional header's own URLs.
     */
    firstUrl: "",
    lastUrl: "",
    routes: [],
    firstUrlCoversSessionStart: false,
    hasFinalChunk: false,
    sessionStartUnixMs: header.startTimeUnixMs,
    lastChunkEndUnixMs: header.startTimeUnixMs,
    schemaVersion: header.schemaVersion,
    recorderKind: header.recorderKind,
    rumApplicationId: header.rumApplicationId,
    primaryEntityId: header.primaryEntityId,
    primaryEntityType: header.primaryEntityType,
    retentionDate: header.retentionDateText,
  };

  const row: JSONObject = buildFinalizedSessionRow({
    projectId: data.projectId,
    sessionId: data.sessionId,
    aggregate: emptyAggregate,
    header: header,
    traceIds: [],
    exceptionFingerprints: [],
    writtenAt: OneUptimeDate.getCurrentDate(),
    sealedReasonOverride: SessionReplaySealedReason.RecordingLost,
  });

  await RumSessionService.insertJsonRows([row], {
    clickhouseSettings: {
      wait_for_async_insert: 1,
    },
  });

  return true;
}

export async function sweepNeverFinalizedSessions(): Promise<{
  scanned: number;
  finalized: number;
  sealedLost: number;
  failed: number;
}> {
  const databaseName: string = getDatabaseName();
  const runStartedAt: number = Date.now();

  const rows: Array<JSONObject> = await readRows(
    buildNeverFinalizedStatement({
      databaseName: databaseName,
      nowUnixMs: runStartedAt,
      limit: MAX_SWEEP_SESSIONS_PER_RUN,
    }),
  );

  let finalized: number = 0;
  let sealedLost: number = 0;
  let failed: number = 0;

  /*
   * Grouped by project so the correlation queries stay one-per-table
   * per project rather than one per session — the same batching contract
   * the 5-minute finalizer keeps. Row order within a project (newest
   * first) is preserved.
   */
  const refsByProjectId: Map<string, Array<NeverFinalizedSessionRef>> = new Map<
    string,
    Array<NeverFinalizedSessionRef>
  >();

  for (const row of rows) {
    const ref: NeverFinalizedSessionRef = {
      projectId: toTextValue(row["projectId"]),
      rumApplicationId: toTextValue(row["rumApplicationId"]),
      sessionId: toTextValue(row["sessionId"]),
      startTimeUnixMs: toNumberValue(row["startTimeUnixMs"]),
    };

    if (!ref.projectId || !ref.sessionId) {
      continue;
    }

    const existing: Array<NeverFinalizedSessionRef> | undefined =
      refsByProjectId.get(ref.projectId);

    if (existing) {
      existing.push(ref);
    } else {
      refsByProjectId.set(ref.projectId, [ref]);
    }
  }

  let budgetExhausted: boolean = false;

  for (const [projectIdText, projectRefs] of refsByProjectId.entries()) {
    if (budgetExhausted) {
      break;
    }

    /*
     * The sweep knows session START times (from the headers), not last
     * activity, so the window closes a full session length after the
     * newest start. Sessions whose startTime failed to parse contribute
     * nothing to the window and simply find no correlation.
     */
    let oldestStartUnixMs: number = Number.MAX_SAFE_INTEGER;
    let newestStartUnixMs: number = 0;

    for (const ref of projectRefs) {
      if (ref.startTimeUnixMs > 0) {
        oldestStartUnixMs = Math.min(oldestStartUnixMs, ref.startTimeUnixMs);
        newestStartUnixMs = Math.max(newestStartUnixMs, ref.startTimeUnixMs);
      }
    }

    let correlationBySessionId: Map<string, SessionCorrelation> = new Map<
      string,
      SessionCorrelation
    >();

    if (newestStartUnixMs > 0) {
      correlationBySessionId = await fetchSessionCorrelation({
        databaseName: databaseName,
        projectId: new ObjectID(projectIdText),
        sessionIds: projectRefs.map((ref: NeverFinalizedSessionRef): string => {
          return ref.sessionId;
        }),
        windowStartUnixMs:
          oldestStartUnixMs - SESSION_CORRELATION_WINDOW_PADDING_MS,
        windowEndUnixMs:
          newestStartUnixMs +
          SESSION_REPLAY_MAX_SESSION_MS +
          SESSION_CORRELATION_WINDOW_PADDING_MS,
      });
    }

    for (const ref of projectRefs) {
      if (Date.now() - runStartedAt > SWEEP_RUN_BUDGET_MS) {
        logger.warn(
          `${SWEEP_JOB_NAME}: run budget exhausted after ${finalized + sealedLost} session(s); the rest are picked up next hour.`,
        );
        budgetExhausted = true;
        break;
      }

      try {
        /*
         * The same idempotent, tombstone-checked path the 5-minute job
         * uses. If the session was finalized by that job between our scan
         * and now, this simply recomputes the same numbers and writes a
         * newer identical header — safe by construction.
         */
        const outcome: FinalizeSessionOutcome = await finalizeSession({
          projectId: new ObjectID(ref.projectId),
          sessionId: ref.sessionId,
          databaseName: databaseName,
          correlation: correlationBySessionId.get(ref.sessionId),
        });

        if (outcome === "written") {
          finalized++;
        } else if (outcome === "no-chunks") {
          const sealed: boolean = await sealLostSession({
            databaseName: databaseName,
            projectId: new ObjectID(ref.projectId),
            rumApplicationId: ref.rumApplicationId,
            sessionId: ref.sessionId,
          });

          if (sealed) {
            sealedLost++;
            logger.warn(
              `${SWEEP_JOB_NAME}: session ${ref.sessionId} in project ${ref.projectId} had a provisional header but no stored chunks; sealed as recording-lost.`,
            );
          }
        }
      } catch (error) {
        failed++;
        logger.error(
          `${SWEEP_JOB_NAME}: failed to recover session ${ref.sessionId} in project ${ref.projectId}: ${getErrorMessage(error)}`,
        );
      }
    }
  }

  if (rows.length > 0) {
    logger.info(
      `${SWEEP_JOB_NAME}: scanned ${rows.length} provisional session(s); finalized ${finalized}, sealed ${sealedLost} as lost, ${failed} failure(s).`,
    );
  }

  return {
    scanned: rows.length,
    finalized: finalized,
    sealedLost: sealedLost,
    failed: failed,
  };
}

RunCron(
  SWEEP_JOB_NAME,
  {
    schedule: EVERY_HOUR,
    runOnStartup: false,
    timeoutInMS: OneUptimeDate.convertMinutesToMilliseconds(5),
  },
  async (): Promise<void> => {
    try {
      await sweepNeverFinalizedSessions();
    } catch (error) {
      logger.error(`${SWEEP_JOB_NAME}: ${getErrorMessage(error)}`);
    }
  },
);

RunCron(
  JOB_NAME,
  {
    schedule: EVERY_FIVE_MINUTE,
    runOnStartup: false,
    timeoutInMS: OneUptimeDate.convertMinutesToMilliseconds(5),
  },
  async (): Promise<void> => {
    try {
      await finalizeExpiredSessions();
    } catch (error) {
      logger.error(`${JOB_NAME}: ${getErrorMessage(error)}`);
    }
  },
);
