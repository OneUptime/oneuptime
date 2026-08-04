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
 * merge-amplification trap, so correlation arrays are capped. 50 is
 * enough for "which traces did this session touch"; the exact set is
 * always reachable from the telemetry side by sessionId.
 */
export const MAX_CORRELATION_ARRAY_LENGTH: number = 50;

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
  hasFinalChunk: boolean;
  sessionStartUnixMs: number;
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
        sessionStartTime,
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
    hasFinalChunk: toBooleanValue(row["hasFinalChunk"]),
    sessionStartUnixMs: toNumberValue(row["sessionStartUnixMs"]),
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

function mergeCappedArray(
  existing: Array<string>,
  additional: Array<string>,
): Array<string> {
  const merged: Set<string> = new Set<string>(existing);

  for (const value of additional) {
    if (merged.size >= MAX_CORRELATION_ARRAY_LENGTH) {
      break;
    }
    merged.add(value);
  }

  return Array.from(merged).slice(0, MAX_CORRELATION_ARRAY_LENGTH);
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

    entryUrl: header ? header.entryUrl : "",
    exitUrl: header ? header.exitUrl : "",
    routes: header ? header.routes : [],

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

    traceIds: mergeCappedArray(header ? header.traceIds : [], data.traceIds),
    /*
     * Exception fingerprints are computed on the exception INGEST path,
     * not by the recorder, and the join key is ExceptionInstance.sessionId
     * — so they are carried forward here rather than recomputed. Once that
     * column ships, a batched groupUniqArray over the exception table for
     * the finalized batch is the right place to fill this in.
     */
    exceptionFingerprints: header ? header.exceptionFingerprints : [],
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
     * No additional trace ids to merge in. The reverse-correlation set the
     * design describes (traces observed in chunks 1..N) has no producer:
     * the chunk table carries no traceIds column and nothing writes a
     * per-session Redis set, so the only trace ids that exist are the ones
     * the FIRST chunk's envelope put on the provisional header. This
     * parameter is the seam for that producer when it lands; reading a
     * Redis key nobody writes was a guaranteed-empty round trip per
     * finalized session and has been removed.
     */
    traceIds: [],
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

    let expiredMembers: Array<string> = [];

    try {
      /*
       * The whole point of the sorted set: this reads only the range that
       * has actually gone idle, so the cost of a run scales with the number
       * of sessions ENDING, not with the number recorded.
       */
      expiredMembers = await client.zrangebyscore(
        activeKey,
        "-inf",
        cutoffUnixMs,
        "LIMIT",
        0,
        MAX_SESSIONS_PER_PROJECT_PER_RUN,
      );
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

      const existing: Array<string> | undefined = membersBySessionId.get(
        parsed.sessionId,
      );

      if (existing) {
        existing.push(member);
      } else {
        membersBySessionId.set(parsed.sessionId, [member]);
      }
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
      sessionId AS sessionId
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
    errorCount: 0,
    rageClickCount: 0,
    deadClickCount: 0,
    errorClickCount: 0,
    refreshRageCount: 0,
    pageCount: 0,
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

  for (const row of rows) {
    if (Date.now() - runStartedAt > SWEEP_RUN_BUDGET_MS) {
      logger.warn(
        `${SWEEP_JOB_NAME}: run budget exhausted after ${finalized + sealedLost} session(s); the rest are picked up next hour.`,
      );
      break;
    }

    const ref: NeverFinalizedSessionRef = {
      projectId: toTextValue(row["projectId"]),
      rumApplicationId: toTextValue(row["rumApplicationId"]),
      sessionId: toTextValue(row["sessionId"]),
    };

    if (!ref.projectId || !ref.sessionId) {
      continue;
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
