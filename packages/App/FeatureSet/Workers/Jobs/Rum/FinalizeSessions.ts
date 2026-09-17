import RunCron from "../../Utils/Cron";
import crypto from "crypto";
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
  SESSION_REPLAY_ACTIVE_CHUNK_MIN_EVENTS,
  SESSION_REPLAY_ENDED_FINALIZE_GRACE_MS,
  SESSION_REPLAY_IDLE_FINALIZE_MS,
  SESSION_REPLAY_MAX_SESSION_MS,
  SESSION_REPLAY_SCHEMA_VERSION,
  SESSION_REPLAY_WIRE_VERSION,
  SessionReplaySealedReason,
} from "Common/Types/Rum/SessionReplay";
import { isSessionReplayStringMap } from "Common/Utils/Rum/SessionReplayStringMap";
import {
  hasSessionRecordingEnded,
  hasTabRecordingEnded,
} from "Common/Utils/Rum/SessionReplayRecordingEnded";
import ChunkMath from "Common/Utils/Rum/ChunkMath";
import {
  EVERY_FIVE_MINUTE,
  EVERY_HOUR,
  EVERY_MINUTE,
} from "Common/Utils/CronTime";

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
 *
 * Two jobs share that finalization path, and differ only in how they
 * decide a session is over:
 *
 *   Rum:FinalizeSessions        (every 5 minutes) no chunk for
 *                               SESSION_REPLAY_IDLE_FINALIZE_MS. The only
 *                               signal for a tab that vanished without a
 *                               word: bfcache, a mobile OS kill, a
 *                               discarded tab, a crash.
 *   Rum:FinalizeEndedSessions   (every minute) every tab of the session
 *                               sent its final chunk, judged from the
 *                               chunk rows by the rule the read path
 *                               shares (Common/Utils/Rum/
 *                               SessionReplayRecordingEnded). This is what
 *                               takes a closed tab's "Recording now" badge
 *                               down in about a minute instead of the idle
 *                               job's 10-15.
 * ------------------------------------------------------------------
 */

const JOB_NAME: string = "Rum:FinalizeSessions";
const ENDED_JOB_NAME: string = "Rum:FinalizeEndedSessions";

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
 *   replay:active:projects            SET  of projectId. The ingest path
 *                                     SADDs on every accepted chunk, so a
 *                                     newly active project is picked up on
 *                                     the next run; the reconcile below is
 *                                     the safety net for a missed SADD.
 *   replay:active:<projectId>         ZSET member "<sessionId>:<tabId>",
 *                                     score = server receive unix ms
 *   replay:ended:<projectId>          ZSET, the same member format
 *                                     "<sessionId>:<tabId>", written ONLY
 *                                     for a frame whose envelope carried
 *                                     isFinal. score = the same server
 *                                     receive unix ms the ingest path wrote
 *                                     to replay:active:<projectId> for that
 *                                     frame, in the same call, with the
 *                                     same TTL. A candidate list for
 *                                     Rum:FinalizeEndedSessions, never a
 *                                     verdict: a tab that sent a final chunk
 *                                     can still be followed by the next page
 *                                     of the session, so the chunk rows are
 *                                     re-checked before anything is
 *                                     finalized. Deliberately outside the
 *                                     replay:active: prefix, which the
 *                                     reconcile below SCANs and reads as
 *                                     project ids.
 *   replay:active:reconcile-cursor    STRING, the SCAN cursor the last
 *                                     reconcile stopped at (see
 *                                     reconcileActiveProjectIndex).
 *   replay:seal:<projectId>:<sessionId>
 *                                     STRING, a SessionReplaySealedReason
 *                                     only the ingest GATE can know
 *                                     ("budget"): the finalizer cannot see
 *                                     a byte budget in chunk rows, so the
 *                                     gate leaves the reason here when it
 *                                     refuses a session for one.
 *
 * Owned by Rum:FinalizeEndedSessions alone, and deliberately outside both
 * prefixes above so neither the reconcile's SCAN nor anything that reads
 * replay:ended:<projectId> can mistake them for a project:
 *
 *   replay:finalize-ended:lock        STRING, a per-run token. The job's
 *                                     single-flight lock (SET NX PX), released
 *                                     by compare-and-delete.
 *   replay:finalize-ended:project-cursor
 *                                     STRING counter, INCRed once per run;
 *                                     where in the sorted project list the
 *                                     run starts.
 * ------------------------------------------------------------------
 */
export const SESSION_REPLAY_ACTIVE_PROJECTS_KEY: string =
  "replay:active:projects";

export const SESSION_REPLAY_ACTIVE_KEY_PREFIX: string = "replay:active:";

export const SESSION_REPLAY_SEAL_HINT_KEY_PREFIX: string = "replay:seal:";

export const SESSION_REPLAY_ENDED_KEY_PREFIX: string = "replay:ended:";

export function getActiveSessionsKey(projectId: string): string {
  return `${SESSION_REPLAY_ACTIVE_KEY_PREFIX}${projectId}`;
}

export function getEndedSessionsKey(projectId: string): string {
  return `${SESSION_REPLAY_ENDED_KEY_PREFIX}${projectId}`;
}

export const SESSION_REPLAY_ENDED_RUN_LOCK_KEY: string =
  "replay:finalize-ended:lock";

export const SESSION_REPLAY_ENDED_PROJECT_CURSOR_KEY: string =
  "replay:finalize-ended:project-cursor";

export function getSessionSealHintKey(
  projectId: string,
  sessionId: string,
): string {
  return `${SESSION_REPLAY_SEAL_HINT_KEY_PREFIX}${projectId}:${sessionId}`;
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
 * Where the bounded SCAN left off. A reconcile that always restarted from
 * cursor "0" walked the SAME first ~100k keys every time, so on a busy
 * install a project whose activity key sat past that horizon was never
 * indexed by the reconcile at all (audit finding workers-lifecycle-6). The
 * cursor persists across runs and replicas; a reconcile that finishes the
 * keyspace stores "0" and the next one starts over. Any failure to read it
 * starts from "0", which is the old behaviour, never worse.
 */
export const PROJECT_INDEX_SCAN_CURSOR_KEY: string =
  "replay:active:reconcile-cursor";
const PROJECT_INDEX_SCAN_CURSOR_TTL_SECONDS: number = 24 * 60 * 60;

/* A SCAN cursor is an unsigned integer rendered as text. */
const SCAN_CURSOR_PATTERN: RegExp = new RegExp("^\\d+$");

/*
 * A session is considered done when no chunk has arrived for this long.
 *
 * 10 minutes, deliberately longer than the recorder's 15s flush cadence
 * and longer than any plausible queue backlog: finalizing early would
 * publish an under-count that the next run silently corrects, and the
 * metering rollup reads finalized headers.
 *
 * The value lives in Common/Types/Rum/SessionReplay now, because the read
 * path reasons about the same window; it is re-exported here so existing
 * imports of it from this module keep working.
 *
 * What that window costs: on a 5-minute cron a member only becomes
 * eligible 10 minutes after its last chunk and is picked up by the first
 * run after that, so an idle session is finalized 10-15 minutes after it
 * went quiet, and every missed or overrun run adds another 5. (An earlier
 * comment here claimed a single missed run could not delay a session; at a
 * 10-minute window on a 5-minute cron it always does.) That latency is
 * acceptable only for tabs that vanished without a word. A tab that said it
 * was closing is finalized by Rum:FinalizeEndedSessions below, within about
 * a minute.
 */
export { SESSION_REPLAY_IDLE_FINALIZE_MS };

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
 * Rum:FinalizeEndedSessions' own limits.
 *
 * The job runs every minute with a one-minute timeout, so its budget sits
 * well under both. Whatever a run leaves over stays queued in Redis, because
 * a candidate is only removed after its session was checked.
 *
 * The budget is checked between sessions and once more right before a
 * session's correlation is resolved (the one slow step inside a check), so
 * it bounds a run loosely, not exactly: a correlation fetch already under
 * way can still take its two ClickHouse reads' worth of time. And the queue
 * runner's timeout does not cancel a job, it only stops waiting for it. So
 * runs are kept from overlapping by a Redis single-flight lock instead
 * (SESSION_REPLAY_ENDED_RUN_LOCK_KEY), whose TTL is well over the worst case
 * of one run: the budget, plus one correlation fetch of two reads at the app
 * pool's 58 s request timeout each, plus the conditional removals. A run
 * that finds the lock held skips; one that overruns even the TTL lets the
 * next run in, which is safe (every write is idempotent, every removal
 * conditional, and a header's version is stamped before its chunk read) but
 * wasted work.
 *
 * The caps count sessions CHECKED, not finalized: a check that ends in
 * "still-recording" costs the same chunk-table read as one that writes a
 * header, and on a multi-page application most checks end that way (every
 * page navigation seals one tab while the next page keeps recording).
 */
export const ENDED_RUN_BUDGET_MS: number = 45 * 1000;
export const MAX_ENDED_CANDIDATES_PER_PROJECT_PER_RUN: number = 1000;
export const MAX_ENDED_SESSIONS_PER_RUN: number = 2000;
export const ENDED_RUN_LOCK_TTL_MS: number = 3 * 60 * 1000;

/*
 * Each project's share of one run, so a busy tenant cannot starve the rest.
 *
 * Projects are walked in sorted order from a start that rotates every run
 * (SESSION_REPLAY_ENDED_PROJECT_CURSOR_KEY), and each one gets an equal
 * slice of what is LEFT of the run - sessions and time, divided by the
 * projects not yet visited - but never less than these floors. Dividing
 * what is left rather than the whole means a project with nothing to do
 * hands its share on to the ones after it. The floors keep a run over many
 * projects doing useful work per project rather than one check each. A
 * project that uses up its share simply drains over several runs, oldest
 * candidates first; its leftovers stay queued.
 */
export const MIN_ENDED_SESSIONS_PER_PROJECT_PER_RUN: number = 50;
export const MIN_ENDED_PROJECT_SLICE_MS: number = 5 * 1000;
const ENDED_PROJECT_CURSOR_TTL_SECONDS: number = 24 * 60 * 60;

/*
 * Batch size for one conditional-removal script call. A Lua script blocks
 * Redis for as long as it runs, so a 5000-member reap is split into several
 * short calls rather than one long one.
 */
const MAX_MEMBERS_PER_REMOVAL_SCRIPT: number = 500;

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

  /*
   * Engagement counters, summed like the frustration counters. A chunk
   * from a recorder that predates them stores 0, so a session recorded by
   * a mix of builds under-counts rather than lies.
   */
  clickCount: number;
  customEventCount: number;

  /*
   * Chunks carrying at least one error, and the session-relative start
   * offset of the earliest such chunk. Both are needed: minIf returns 0
   * when nothing matched, and "first error at 0ms" is a real answer for a
   * page that errors on load, so the count is what says whether the offset
   * means anything.
   */
  erroredChunkCount: number;
  firstErrorOffsetMs: number;

  /*
   * Sum of the spans of chunks holding at least
   * SESSION_REPLAY_ACTIVE_CHUNK_MIN_EVENTS events - the same threshold the
   * player uses for its provisional idle bands, so the list's "idle 40%"
   * and the timeline's hatched stretches agree.
   */
  activeMs: number;

  firstUrl: string;
  lastUrl: string;
  firstUrlAtUnixMs: number;
  lastUrlAtUnixMs: number;
  urlChunkCount: number;
  routes: Array<string>;
  hasFinalChunk: boolean;

  /*
   * Whether this tab has ENDED, in the shape
   * Common/Utils/Rum/SessionReplayRecordingEnded reads (SessionReplayTabEndFacts):
   * the end of the tab's latest final chunk (0 when it sent none) and the
   * start of its latest-starting chunk, final or not. A tab whose last chunk
   * began meaningfully after its final one kept recording, and the session
   * is not over.
   *
   * maxChunkIndex (above) is read by the same rule: a tab that stored its
   * last permitted index can never store another chunk, so it has ended.
   *
   * lastChunkStoredAtUnixMs is the newest chunk row's `version`, which the
   * ingest path stamps from the SERVER clock at insert. The rule measures
   * the ended-session grace on it, so the grace needs nothing from Redis
   * and cannot be skipped by an ended-set ZADD that failed or has not
   * landed yet.
   */
  finalChunkEndUnixMs: number;
  lastChunkStartUnixMs: number;
  lastChunkStoredAtUnixMs: number;

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

  clickCount: number;
  customEventCount: number;

  /*
   * Session-relative offset of the earliest chunk that carries an error;
   * 0 when no chunk does. The list's "first error at 1:42" and the
   * player's "jump to first error" read this without opening a chunk.
   */
  firstErrorOffsetMs: number;

  /* Milliseconds of chunks that held real activity. */
  activeMs: number;

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
  /*
   * From the NEWEST header version, which is the last meta-bearing chunk
   * the ingest processed: a tag set after chunk 0 and traits from a late
   * identify() both reach the finalized row this way. The ingest already
   * gated traits on captureUserIdentity; the finalizer carries what it
   * stored and never re-derives them.
   */
  identifiedUserTraits: Record<string, string>;
  /*
   * The recorder's per-browser anonymous visitor id, "" for a recorder
   * that predates it. The ingest carries it across header versions so the
   * newest one still holds what chunk 0 established; the finalizer, as
   * with identity, carries what was stored and never re-derives it.
   */
  visitorId: string;
  tags: Record<string, string>;
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
 * A Map(String, String) column comes back as a plain object over JSON.
 * Anything else (a server that renders it as an array of pairs, or a row
 * that predates the column) reads as empty rather than poisoning the row.
 */
function toStringMapValue(value: unknown): Record<string, string> {
  if (isSessionReplayStringMap(value)) {
    return { ...value };
  }

  return {};
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

/*
 * ------------------------------------------------------------------
 * Conditional member removal.
 *
 * Every job that reads an activity or ended sorted set, does slow work, and
 * then removes what it read has the same race: the ingest path may ZADD the
 * SAME member again in between, with a newer score, because another chunk
 * of that tab arrived. A plain ZREM then deletes the fresh entry along with
 * the stale one. For the finalizer that was a real defect: a chunk processed
 * while its session was being finalized lost its activity entry, the header
 * the finalizer had just written did not count that chunk, and nothing
 * re-queued the session - it stayed provisional (and "Recording now") until
 * the hourly never-finalized sweep reached it, hours later.
 *
 * So removal is conditional on the score: a member goes only if its score
 * is still no newer than the one the caller acted on. A ZADD that landed in
 * between raises the score, and the member survives for the next run.
 *
 * One script, one key. The read of the score and the removal have to be
 * atomic or the race just moves between them, and EVAL is the atomic
 * primitive every supported Redis has (ZREM has no compare-and-delete
 * form). KEYS holds exactly the one sorted set, so the script hashes to a
 * single slot and stays valid on Redis Cluster; members and their
 * thresholds ride in ARGV as flat pairs.
 *
 * Exported so tests can emulate exactly this script, and nothing else, in
 * their in-memory Redis.
 * ------------------------------------------------------------------
 */
export const SESSION_REPLAY_REMOVE_IF_NOT_NEWER_SCRIPT: string = `
local removed = 0
for index = 1, #ARGV, 2 do
  local score = redis.call('ZSCORE', KEYS[1], ARGV[index])
  if score and tonumber(score) <= tonumber(ARGV[index + 1]) then
    removed = removed + redis.call('ZREM', KEYS[1], ARGV[index])
  end
end
return removed
`;

/*
 * Release half of Rum:FinalizeEndedSessions' single-flight lock: delete the
 * key only while it still holds this run's token. A plain DEL is a race in
 * disguise - a run that overran the TTL would delete the lock a LATER run
 * legitimately took, and let a third run in beside it. One key in KEYS, so
 * it is Redis Cluster safe. Exported so tests can emulate exactly this
 * script in their in-memory Redis.
 */
export const SESSION_REPLAY_ENDED_RUN_LOCK_RELEASE_SCRIPT: string = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0
`;

export interface ConditionalMemberRemoval {
  member: string;
  /*
   * The newest score at which the member may still be removed: normally the
   * score the caller read before it did its work.
   */
  maxScore: number;
}

/*
 * Remove each member whose current score exists and is <= its maxScore.
 * Returns how many were removed. A member that is already gone, or whose
 * score moved past its threshold, is left alone and not counted.
 *
 * An entry whose threshold is not a finite number is dropped rather than
 * sent: tonumber() of "NaN" is nil in Lua and the comparison would raise,
 * failing the whole batch. Not removing is always the safe direction - the
 * member is simply looked at again next run.
 */
export async function removeActivityMembersIfNotNewer(
  client: ClientType,
  key: string,
  entries: Array<ConditionalMemberRemoval>,
): Promise<number> {
  const valid: Array<ConditionalMemberRemoval> = entries.filter(
    (entry: ConditionalMemberRemoval): boolean => {
      return entry.member.length > 0 && Number.isFinite(entry.maxScore);
    },
  );

  let removed: number = 0;

  for (
    let offset: number = 0;
    offset < valid.length;
    offset += MAX_MEMBERS_PER_REMOVAL_SCRIPT
  ) {
    const args: Array<string> = [];

    for (const entry of valid.slice(
      offset,
      offset + MAX_MEMBERS_PER_REMOVAL_SCRIPT,
    )) {
      args.push(entry.member, String(entry.maxScore));
    }

    const result: unknown = await client.eval(
      SESSION_REPLAY_REMOVE_IF_NOT_NEWER_SCRIPT,
      1,
      key,
      ...args,
    );

    removed += toNumberValue(result);
  }

  return removed;
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
   * `ORDER BY version DESC LIMIT 1 BY rumApplicationId, tabId, chunkIndex`
   * keeps the newest write of each chunk identity. projectId and sessionId
   * are pinned by the WHERE clause, so they are constant within the group
   * and are omitted from the LIMIT BY key - but rumApplicationId is NOT:
   * two applications on one origin share the browser-minted sessionId, and
   * without it in the key one application's chunks silently evict the
   * other's from the aggregate. The grouping carries it for the same
   * reason, so the caller can finalize one header per application.
   *
   * The WHERE clause is the (projectId, sessionId) prefix of the chunk
   * table's sort key, which is why this is a key-range read and not a
   * scan.
   *
   * eventCount and errorCount are summed under a DIFFERENT name on purpose.
   * ClickHouse resolves an identifier to a SELECT alias before it resolves
   * it to a column, so `sum(errorCount) AS errorCount` would turn the
   * `errorCount > 0` inside countIf/minIf (and `eventCount >= ...` inside
   * sumIf) into a nested aggregate, and the server rejects the whole query
   * with ILLEGAL_AGGREGATION. Any other column read inside a later
   * aggregate needs the same treatment.
   */
  return SQL`
    SELECT
      tabId AS tabId,
      rumApplicationId AS rumApplicationId,
      count() AS chunkCount,
      max(chunkIndex) AS maxChunkIndex,
      groupArray(chunkIndex) AS chunkIndexes,
      groupArrayIf(chunkIndex, hasFullSnapshot) AS fullSnapshotChunkIndexes,
      sum(eventCount) AS totalEventCount,
      sum(payloadBytes) AS payloadBytes,
      sum(errorCount) AS totalErrorCount,
      sum(rageClickCount) AS rageClickCount,
      sum(deadClickCount) AS deadClickCount,
      sum(errorClickCount) AS errorClickCount,
      sum(refreshRageCount) AS refreshRageCount,
      sum(routeCount) AS routeCount,
      sum(clickCount) AS clickCount,
      sum(customEventCount) AS customEventCount,
      /*
       * The first errored chunk's start offset, guarded by a count because
       * minIf over no rows is 0 and 0 is also a real offset.
       */
      countIf(errorCount > 0) AS erroredChunkCount,
      minIf(chunkStartOffsetMs, errorCount > 0) AS firstErrorOffsetMs,
      /*
       * Coarse activity from the manifest columns alone: a chunk holding
       * fewer than SESSION_REPLAY_ACTIVE_CHUNK_MIN_EVENTS events carried
       * nothing the user did. greatest() guards a chunk whose offsets are
       * inverted by a bad envelope from subtracting from the total.
       */
      sumIf(
        greatest(chunkEndOffsetMs - chunkStartOffsetMs, 0),
        eventCount >= ${{
          type: TableColumnType.Number,
          value: SESSION_REPLAY_ACTIVE_CHUNK_MIN_EVENTS,
        }}
      ) AS activeMs,
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
      /*
       * Has this tab ENDED? The facts hasTabRecordingEnded reads, spelled
       * exactly as Common/Utils/Rum/SessionReplayRecordingEnded documents
       * them so the finalizer and the read path judge the same rows the same
       * way. maxIf over no final chunk returns the epoch, which reads as 0
       * and is ignored because hasFinalChunk is 0 then.
       *
       * The aliases are new names on purpose - see the shadowing note above:
       * isFinal, chunkEndTime and chunkStartTime are all read inside other
       * aggregates of this SELECT, so none of them may become an alias.
       *
       * maxChunkIndex (near the top) is also one of these facts. The newest
       * row's write time is max(version): version is a UInt64 of SERVER
       * unix milliseconds stamped at ingest, already the unit the rule
       * wants, and it comes back as a quoted string on some server versions
       * (the parser coerces it). Aliased to a new name, never "version",
       * which the inner query orders by.
       */
      toUnixTimestamp64Milli(maxIf(chunkEndTime, isFinal)) AS finalChunkEndUnixMs,
      toUnixTimestamp64Milli(max(chunkStartTime)) AS lastChunkStartUnixMs,
      max(version) AS lastChunkStoredAtUnixMs,
      toUnixTimestamp64Milli(min(sessionStartTime)) AS sessionStartUnixMs,
      toUnixTimestamp64Milli(max(chunkEndTime)) AS lastChunkEndUnixMs,
      max(chunkEndOffsetMs) AS maxChunkEndOffsetMs,
      max(schemaVersion) AS schemaVersion,
      any(recorderKind) AS recorderKind,
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
        clickCount,
        customEventCount,
        url,
        routes,
        sessionStartTime,
        chunkStartTime,
        chunkEndTime,
        chunkStartOffsetMs,
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
      LIMIT 1 BY rumApplicationId, tabId, chunkIndex
    )
    GROUP BY rumApplicationId, tabId`;
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
      identifiedUserTraits AS identifiedUserTraits,
      visitorId AS visitorId,
      tags AS tags,
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
    eventCount: toNumberValue(row["totalEventCount"]),
    payloadBytes: toNumberValue(row["payloadBytes"]),
    errorCount: toNumberValue(row["totalErrorCount"]),
    rageClickCount: toNumberValue(row["rageClickCount"]),
    deadClickCount: toNumberValue(row["deadClickCount"]),
    errorClickCount: toNumberValue(row["errorClickCount"]),
    refreshRageCount: toNumberValue(row["refreshRageCount"]),
    routeCount: toNumberValue(row["routeCount"]),
    clickCount: toNumberValue(row["clickCount"]),
    customEventCount: toNumberValue(row["customEventCount"]),
    erroredChunkCount: toNumberValue(row["erroredChunkCount"]),
    firstErrorOffsetMs: toNumberValue(row["firstErrorOffsetMs"]),
    activeMs: toNumberValue(row["activeMs"]),
    firstUrl: toTextValue(row["firstUrl"]),
    lastUrl: toTextValue(row["lastUrl"]),
    firstUrlAtUnixMs: toNumberValue(row["firstUrlAtUnixMs"]),
    lastUrlAtUnixMs: toNumberValue(row["lastUrlAtUnixMs"]),
    urlChunkCount: toNumberValue(row["urlChunkCount"]),
    routes: toTextArrayValue(row["routes"]),
    hasFinalChunk: toBooleanValue(row["hasFinalChunk"]),
    finalChunkEndUnixMs: toNumberValue(row["finalChunkEndUnixMs"]),
    lastChunkStartUnixMs: toNumberValue(row["lastChunkStartUnixMs"]),
    lastChunkStoredAtUnixMs: toNumberValue(row["lastChunkStoredAtUnixMs"]),
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
    identifiedUserTraits: toStringMapValue(row["identifiedUserTraits"]),
    visitorId: toTextValue(row["visitorId"]),
    tags: toStringMapValue(row["tags"]),
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
    clickCount: 0,
    customEventCount: 0,
    firstErrorOffsetMs: 0,
    activeMs: 0,
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
   * The earliest errored chunk across tabs. Offsets are session-relative
   * (every tab measures from the same recorder session start), so they
   * compare directly; a tab with no errored chunk contributes nothing.
   */
  let hasErroredChunk: boolean = false;

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
    combined.clickCount += tab.clickCount;
    combined.customEventCount += tab.customEventCount;
    /*
     * A SUM across tabs, which overlapping tabs can push past the session's
     * own duration. Left as the raw sum here because this function has no
     * duration to clamp against; buildFinalizedSessionRow computes one and
     * clamps there. Nothing may publish this field unclamped.
     */
    combined.activeMs += tab.activeMs;

    if (tab.erroredChunkCount > 0) {
      combined.firstErrorOffsetMs = hasErroredChunk
        ? Math.min(combined.firstErrorOffsetMs, tab.firstErrorOffsetMs)
        : tab.firstErrorOffsetMs;
      hasErroredChunk = true;
    }

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
 * Only the ingest path can know it refused chunks for BUDGET reasons, and
 * it says so through the Redis seal hint (read in finalizeSession and
 * passed here as existingSealedReason); a provisional header already
 * carrying budget or truncated is honoured the same way. Everything else is
 * derivable here, and "idle-timeout" is the honest default: the recorder
 * went away without sending a terminal chunk (browser closed, tab crashed,
 * network died), which is a different statement to the UI than "the
 * recording ended".
 *
 * Truncation is judged PER TAB, against the same rule the ingest gate
 * applies: chunkIndex is minted per tab, so the cap is on the highest index
 * any one tab reached, never on the cross-tab sum - two tabs of 250 chunks
 * each are a 500-chunk session that nothing cut (audit finding
 * workers-lifecycle-7).
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

  if (
    data.aggregate.maxChunkIndex + 1 >=
    MAX_SESSION_REPLAY_CHUNKS_PER_SESSION
  ) {
    return SessionReplaySealedReason.Truncated;
  }

  return SessionReplaySealedReason.IdleTimeout;
}

/*
 * The seal reason the ingest gate left for this session, if any. Best
 * effort in every direction: no Redis, a client without the command, or a
 * failed read all mean "no hint", which falls back to what the header and
 * the chunk rows can say on their own.
 */
export async function readSealHint(data: {
  projectId: string;
  sessionId: string;
}): Promise<string> {
  const client: ClientType | null = Redis.getClient();

  if (!client || !Redis.isConnected()) {
    return "";
  }

  try {
    const hint: string | null = await client.get(
      getSessionSealHintKey(data.projectId, data.sessionId),
    );

    return typeof hint === "string" ? hint : "";
  } catch (error) {
    logger.debug(
      `${JOB_NAME}: could not read the seal hint for session ${data.sessionId}: ${getErrorMessage(error)}`,
    );
    return "";
  }
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
  /*
   * What the ingest gate left in Redis about why uploads stopped ("budget").
   * Takes precedence over the header's own sealedReason because the gate
   * learned it AFTER the provisional header was written.
   */
  sealedReasonHint?: string;
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
      existingSealedReason:
        data.sealedReasonHint || (header ? header.sealedReason : ""),
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

    clickCount: aggregate.clickCount,
    customEventCount: aggregate.customEventCount,
    firstErrorOffsetMs: aggregate.firstErrorOffsetMs,
    /*
     * activeMs is per-session WALL CLOCK, never a per-tab sum.
     *
     * The aggregate adds each tab's active time up, and two tabs recording
     * the same ten minutes contribute twenty. Unclamped, every multi-tab
     * session reported activeMs > durationMs, which the list renders as a
     * negative idle share ("idle -100%") - and would mis-rank sessions the
     * moment anything sorts on it. Clamping to the session's own duration
     * is the honest ceiling: no session can have been active for longer
     * than it existed.
     */
    activeMs: Math.min(Math.max(0, aggregate.activeMs), durationMs),

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
    identifiedUserTraits: header ? header.identifiedUserTraits : {},
    visitorId: header ? header.visitorId : "",
    tags: header ? header.tags : {},

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
 * What the gated variant (requireRecordingEnded) can answer on top of
 * FinalizeSessionOutcome.
 *
 * "still-recording" means the chunk rows show at least one tab of every
 * application still going - no final chunk yet, or a chunk that started
 * after the final one - so NOTHING was written.
 *
 * "settling" means some application's tabs have ALL ended, but its newest
 * chunk was stored less than SESSION_REPLAY_ENDED_FINALIZE_GRACE_MS ago, and
 * no application qualified for a header. Nothing was written. Unlike
 * "still-recording" it resolves by itself within the grace, without a new
 * final chunk, so the caller keeps whatever brought it here queued.
 *
 * "deferred" means the session HAD ended, but the caller's shouldDefer said
 * to stop before the slow part of the write, so nothing was written and the
 * caller keeps the session queued. Only a caller that passes shouldDefer
 * can see it.
 *
 * All three are only ever returned when the caller asked for the gate; the
 * idle path and the sweep never see them.
 */
export type GatedFinalizeSessionOutcome =
  | FinalizeSessionOutcome
  | "still-recording"
  | "settling"
  | "deferred";

export interface FinalizeSessionResult {
  outcome: GatedFinalizeSessionOutcome;
  /*
   * The tab ids whose application got a header in this call, de-duplicated.
   * Empty for every outcome but "written".
   *
   * A tab id that ALSO appears under an application that was not written is
   * left out: the activity member is "<sessionId>:<tabId>" with no
   * application in it, so a caller acting on it on behalf of the finished
   * application would touch the still-recording one's queue entry too.
   */
  writtenTabIds: Array<string>;
}

/*
 * Finalize one session.
 *
 * Returns "no-chunks" when the session has no stored chunks at all — the
 * caller treats that as "nothing to do" and drops the activity entry
 * rather than retrying forever.
 *
 * The idle path and the never-finalized sweep call this. It is the
 * ungated form of finalizeSessionWithTabs below and never returns
 * "still-recording", "settling" or "deferred".
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
  const result: FinalizeSessionResult = await finalizeSessionWithTabs({
    projectId: data.projectId,
    sessionId: data.sessionId,
    databaseName: data.databaseName,
    correlation: data.correlation,
    requireRecordingEnded: false,
  });

  if (
    result.outcome === "still-recording" ||
    result.outcome === "settling" ||
    result.outcome === "deferred"
  ) {
    /*
     * Unreachable: only the gated call answers these.
     * Thrown rather than mapped to an outcome, because every caller's catch
     * leaves the session queued for a retry, which is the one response that
     * cannot lose data.
     */
    throw new Error(
      `ungated finalization of session ${data.sessionId} reported ${result.outcome}`,
    );
  }

  return result.outcome;
}

/*
 * Finalize one session, optionally only if its recording has ENDED.
 *
 * With requireRecordingEnded, a header is written only for the applications
 * whose every tab has ended by the shared rule
 * (Common/Utils/Rum/SessionReplayRecordingEnded.hasSessionRecordingEnded),
 * judged from the same chunk rows the aggregate is built from - so the check
 * and the numbers it publishes can never disagree. When no application
 * qualifies the answer is "still-recording" and nothing is inserted.
 *
 * That is per application because the header is: two applications on one
 * origin share the browser-minted sessionId, and one of them closing says
 * nothing about the other.
 *
 * The rule also applies the ended-session grace, on the chunk rows' own
 * server write times: an application whose newest chunk (of any of its
 * tabs) was stored less than SESSION_REPLAY_ENDED_FINALIZE_GRACE_MS before
 * this check is held back. The job reads only candidates older than the
 * grace, but a session's OTHER tabs are found through the chunk rows, not
 * the candidates. Without the grace, a user who spent under a minute on
 * page B of a multi-page app would have the session finalized off page A's
 * old candidate the instant B's final chunk landed - before page C's first
 * chunk registered - and page C would re-open it. The read path applies the
 * same grace the same way, so the Dashboard never calls a session "ended"
 * that this would still hold back. Measured on rows rather than on
 * ended-set scores, the grace cannot be skipped by a tab whose ZADD failed
 * or has not landed yet.
 */
export async function finalizeSessionWithTabs(data: {
  projectId: ObjectID;
  sessionId: string;
  databaseName: string;
  correlation?: SessionCorrelation | undefined;
  /*
   * Lazy alternative to `correlation`, called at most once and only when a
   * header is actually about to be written. Rum:FinalizeEndedSessions checks
   * far more sessions than it finalizes (every page navigation of a
   * multi-page application seals a tab while the next page records on), so
   * paying for the grouped Span / ExceptionInstance reads up front would
   * spend them mostly on sessions that turn out to be still recording.
   */
  resolveCorrelation?:
    | (() => Promise<SessionCorrelation | undefined>)
    | undefined;
  requireRecordingEnded?: boolean | undefined;
  /*
   * Asked once, after the gate has passed and right before correlation is
   * resolved: true answers "deferred" and writes nothing. Lets a run near
   * the end of its budget leave the session queued instead of starting the
   * slow correlation reads, which the run budget cannot interrupt.
   */
  shouldDefer?: (() => boolean) | undefined;
}): Promise<FinalizeSessionResult> {
  /*
   * The erasure tombstone is checked FIRST, before a single chunk row is
   * read - and before the recording-ended gate, which reads chunk rows too.
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
   * It is checked a SECOND time right before the insert (below), because
   * everything in between - the chunk and header reads, and above all a
   * lazily resolved batch correlation - can take long enough for an
   * erasure to tombstone the session and submit its mutations meanwhile.
   *
   * isSessionErased fails CLOSED by THROWING when Redis cannot answer.
   * That propagates to the calling job's per-session catch, which counts a
   * failure and leaves the activity entries in place, so the session is
   * retried next run instead of either being resurrected or being silently
   * dropped off the queue on a transient blip.
   */
  const erased: boolean = await isSessionErased({
    projectId: data.projectId.toString(),
    sessionId: data.sessionId,
  });

  if (erased) {
    logger.info(
      `${JOB_NAME}: session ${data.sessionId} in project ${data.projectId.toString()} is tombstoned as erased; refusing to write a header.`,
    );
    return { outcome: "erased", writtenTabIds: [] };
  }

  /*
   * The header's version, stamped BEFORE the chunk rows are read.
   *
   * RumSession is a ReplacingMergeTree(version), so the highest version
   * wins. Stamped after the slow steps below (correlation above all), an
   * overlapping or stalled finalization that read the chunk rows EARLIER
   * could stamp a HIGHER version than a later one that saw more chunks, and
   * its stale aggregate would replace the complete header for good. Stamped
   * here, a header built from a later snapshot of the rows always wins.
   *
   * The same instant is the server "now" the recording-ended grace is
   * measured against: taken before the read, it can only make the grace
   * stricter, never skip it.
   */
  const writtenAt: Date = OneUptimeDate.getCurrentDate();

  const tabRows: Array<JSONObject> = await readRows(
    buildTabAggregateStatement({
      databaseName: data.databaseName,
      projectId: data.projectId,
      sessionId: data.sessionId,
    }),
  );

  if (tabRows.length === 0) {
    return { outcome: "no-chunks", writtenTabIds: [] };
  }

  /*
   * One finalized header PER APPLICATION, not one per session.
   *
   * sessionId is minted in the browser from sessionStorage, which is
   * shared by every RUM application served from one origin - so two
   * applications on one origin legitimately record under one id. The read
   * path was hardened for exactly that (getSessionHeader refuses an
   * ambiguous id unless the caller names an application); the writer was
   * not, and folded both applications into a single header under whichever
   * id `any()` happened to pick. That header carried both applications'
   * error, click and payload totals and both route sets, while the other
   * application's session never finalized at all - it stayed provisional,
   * and therefore "live", forever.
   *
   * The chunk rows already carry rumApplicationId, so the split needs
   * nothing from the activity ZSET: the aggregate statement groups by
   * (rumApplicationId, tabId) and dedupes redeliveries within an
   * application, and the rows are partitioned here.
   */
  const tabsByApplication: Map<string, Array<TabChunkAggregate>> = new Map<
    string,
    Array<TabChunkAggregate>
  >();

  for (const tabRow of tabRows) {
    const tab: TabChunkAggregate = parseTabAggregateRow(tabRow);
    const key: string = tab.rumApplicationId;

    const existing: Array<TabChunkAggregate> | undefined =
      tabsByApplication.get(key);

    if (existing) {
      existing.push(tab);
      continue;
    }

    tabsByApplication.set(key, [tab]);
  }

  /*
   * Which applications get a header in this call. Ungated, all of them -
   * the idle path and the sweep have already decided the session is over.
   * Gated, only those whose tabs have all ended and settled.
   */
  let applicationsToWrite: Array<Array<TabChunkAggregate>> = Array.from(
    tabsByApplication.values(),
  );

  if (data.requireRecordingEnded) {
    const nowUnixMs: number = writtenAt.getTime();

    /*
     * Ended (every tab), then settled (the shared rule, which also applies
     * the grace). The first set only decides between "settling" and
     * "still-recording" when nothing qualifies.
     */
    const endedApplications: Array<Array<TabChunkAggregate>> =
      applicationsToWrite.filter((tabs: Array<TabChunkAggregate>): boolean => {
        return tabs.every((tab: TabChunkAggregate): boolean => {
          return hasTabRecordingEnded(tab);
        });
      });

    applicationsToWrite = endedApplications.filter(
      (tabs: Array<TabChunkAggregate>): boolean => {
        return hasSessionRecordingEnded(tabs, nowUnixMs);
      },
    );

    if (applicationsToWrite.length === 0) {
      return {
        outcome: endedApplications.length > 0 ? "settling" : "still-recording",
        writtenTabIds: [],
      };
    }
  }

  if (data.shouldDefer && data.shouldDefer()) {
    return { outcome: "deferred", writtenTabIds: [] };
  }

  /*
   * Read once for the whole session: the seal hint is keyed on
   * (projectId, sessionId) and describes why UPLOADS stopped, which is a
   * per-session fact even when two applications shared the id.
   */
  const sealedReasonHint: string = await readSealHint({
    projectId: data.projectId.toString(),
    sessionId: data.sessionId,
  });

  const correlation: SessionCorrelation | undefined =
    data.correlation ??
    (data.resolveCorrelation ? await data.resolveCorrelation() : undefined);

  const rows: Array<JSONObject> = [];

  for (const tabs of applicationsToWrite) {
    const aggregate: SessionChunkAggregate = combineTabAggregates(tabs);

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
       * finalizer synthesises one. It is worth a warning: it means a
       * chunk-0 header write was lost.
       */
      logger.warn(
        `${JOB_NAME}: no provisional header for session ${data.sessionId}; writing a chunk-derived header`,
      );
    }

    rows.push(
      buildFinalizedSessionRow({
        projectId: data.projectId,
        sessionId: data.sessionId,
        aggregate: aggregate,
        header: header,
        /*
         * The batch's grouped queries over Span and ExceptionInstance (see
         * fetchSessionCorrelation) are the reverse-correlation producer:
         * the provisional header only ever carries what the FIRST chunk's
         * envelope declared, so everything observed in chunks 1..N arrives
         * here and is merged (deduped, capped) on top of the header's ids.
         *
         * Correlation is keyed on the sessionId alone, so on the rare
         * shared-id session both applications are handed the same trace and
         * exception ids. Over-attributing a correlation is a far smaller
         * error than the merged header this split replaced, and the ids are
         * the session's, not the application's.
         */
        traceIds: correlation ? correlation.traceIds : [],
        exceptionFingerprints: correlation
          ? correlation.exceptionFingerprints
          : [],
        writtenAt: writtenAt,
        sealedReasonHint: sealedReasonHint,
      }),
    );
  }

  /*
   * The tombstone again, as the last thing before the write.
   *
   * The first check ran before every read above, and the lazy correlation
   * in particular is two grouped ClickHouse reads over a whole batch that
   * can take seconds on a busy cluster. An erasure that tombstoned the
   * session and submitted its ALTER DELETE on RumSession during that time
   * would never see the row inserted here, and the erasure job does not
   * revisit a session it has already tombstoned - so that row, carrying the
   * subject's identity, would outlive the erasure until TTL. Re-checking
   * shrinks the window to this one Redis round trip. Fails closed, like the
   * first check.
   */
  const erasedWhileFinalizing: boolean = await isSessionErased({
    projectId: data.projectId.toString(),
    sessionId: data.sessionId,
  });

  if (erasedWhileFinalizing) {
    logger.info(
      `${JOB_NAME}: session ${data.sessionId} in project ${data.projectId.toString()} was tombstoned as erased while its header was being built; refusing to write it.`,
    );
    return { outcome: "erased", writtenTabIds: [] };
  }

  /*
   * wait_for_async_insert is forced on for this one row.
   *
   * insertJsonRows defaults to wait_for_async_insert: 0, where the await
   * resolves as soon as ClickHouse has accepted the row into its
   * async-insert buffer — NOT when it is durable. The caller removes the
   * session's queue entries immediately after this resolves, so a buffer
   * flush failure would silently lose the header while the session is
   * already off the queue, leaving it provisional (zeroed aggregates) and
   * unmetered forever. Finalization is one small row per session and
   * application, not a hot ingest path, so paying for the durability ack
   * is cheap and it is what makes the remove-only-on-success contract
   * below actually true.
   */
  await RumSessionService.insertJsonRows(rows, {
    clickhouseSettings: {
      wait_for_async_insert: 1,
    },
  });

  const writtenTabIds: Set<string> = new Set<string>();

  for (const tabs of applicationsToWrite) {
    for (const tab of tabs) {
      writtenTabIds.add(tab.tabId);
    }
  }

  for (const tabs of tabsByApplication.values()) {
    if (applicationsToWrite.includes(tabs)) {
      continue;
    }

    for (const tab of tabs) {
      writtenTabIds.delete(tab.tabId);
    }
  }

  return { outcome: "written", writtenTabIds: Array.from(writtenTabIds) };
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

  let cursor: string = await readPersistedScanCursor(client);
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
        key === PROJECT_INDEX_RECONCILE_LOCK_KEY ||
        key === PROJECT_INDEX_SCAN_CURSOR_KEY
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

  /*
   * Persisted whether the walk finished ("0": start over next time) or hit
   * the iteration cap (resume from here), so every key is reached within a
   * bounded number of reconciles regardless of keyspace size.
   */
  await persistScanCursor(client, cursor);

  if (discovered.size > 0) {
    await client.sadd(
      SESSION_REPLAY_ACTIVE_PROJECTS_KEY,
      Array.from(discovered),
    );
  }

  return Array.from(discovered);
}

/*
 * Both cursor helpers are best-effort and never throw: a cursor that cannot
 * be read starts the walk at "0", and one that cannot be written costs a
 * repeated walk next time. Neither is worse than what the job did before.
 */
async function readPersistedScanCursor(client: ClientType): Promise<string> {
  try {
    const stored: string | null = await client.get(
      PROJECT_INDEX_SCAN_CURSOR_KEY,
    );

    if (typeof stored === "string" && SCAN_CURSOR_PATTERN.test(stored)) {
      return stored;
    }
  } catch (error) {
    logger.debug(
      `${JOB_NAME}: could not read the reconcile scan cursor; starting from 0: ${getErrorMessage(error)}`,
    );
  }

  return "0";
}

async function persistScanCursor(
  client: ClientType,
  cursor: string,
): Promise<void> {
  try {
    await client.set(
      PROJECT_INDEX_SCAN_CURSOR_KEY,
      cursor,
      "EX",
      PROJECT_INDEX_SCAN_CURSOR_TTL_SECONDS,
    );
  } catch (error) {
    logger.debug(
      `${JOB_NAME}: could not persist the reconcile scan cursor: ${getErrorMessage(error)}`,
    );
  }
}

/*
 * Projects with sessions that may need finalizing.
 *
 * The index is the fast path: the ingest path SADDs the project on every
 * accepted chunk. The reconcile below is what makes a missed SADD (a Redis
 * blip on the ingest side, an index key evicted) a delay rather than
 * permanent data loss.
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
       * Safe to be wrong: the ingest path's SADD puts a project back the
       * moment it accepts a chunk for it, and the periodic reconcile above
       * catches whatever that misses.
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
         *
         * And only if nothing re-queued them meanwhile: each member goes
         * only while its score is still the one read above. A chunk of that
         * tab processed during the finalization raised the score, was not
         * counted in the header just written, and has to stay queued so a
         * later run re-derives the session including it. The unconditional
         * ZREM this replaces deleted exactly those entries.
         */
        const removals: Array<ConditionalMemberRemoval> = members.map(
          (member: string): ConditionalMemberRemoval => {
            return {
              member: member,
              maxScore: lastActivityUnixMsByMember.get(member) ?? cutoffUnixMs,
            };
          },
        );

        await removeActivityMembersIfNotNewer(client, activeKey, removals);

        /*
         * The same members leave the ended set too, under the same
         * thresholds, or Rum:FinalizeEndedSessions would read the candidate
         * a minute later and finalize this session a second time. An ended
         * candidate's score is the receive time of the tab's final chunk,
         * which is never newer than the tab's activity score read above -
         * unless another final chunk landed during this finalization, and
         * then the candidate rightly stays for the ended job to re-check.
         */
        await removeActivityMembersIfNotNewer(
          client,
          getEndedSessionsKey(projectId),
          removals,
        );
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
 * Rum:FinalizeEndedSessions
 *
 * Finalizes a session as soon as its recording is over, instead of 10-15
 * minutes later.
 *
 * The recorder sends a final chunk when a tab closes (pagehide). The ingest
 * path used to treat that only as a label, so a closed tab sat in the list
 * as "Recording now" until the idle path above noticed nothing had arrived
 * for SESSION_REPLAY_IDLE_FINALIZE_MS. The ingest path now also records the
 * tab in replay:ended:<projectId>, and this job turns those candidates into
 * finalized headers:
 *
 *   1. Read candidates older than SESSION_REPLAY_ENDED_FINALIZE_GRACE_MS.
 *      That is only a cheap prefilter: the grace itself is applied by the
 *      shared rule in step 2, on the chunk rows' server write times. It
 *      covers the next page of a multi-page application registering its
 *      first chunk under the same session id, and a queue backlog between
 *      the two.
 *   2. Group them by session, and ask the gated finalize whether every tab
 *      of the session has ended and settled, judged from the chunk rows by
 *      the rule the read path shares. Only then is a header written.
 *   3. Remove the candidates that were checked, conditionally, so nothing a
 *      newer final chunk re-queued is lost. The ACTIVITY entries stay, so
 *      the idle path finalizes every early-finalized session once more (see
 *      the removal below for why).
 *
 * One run at a time (a Redis single-flight lock), and a fair share of each
 * run per project, from a start that rotates between runs - see the limits
 * near the top of this module.
 *
 * Tabs that never send a final chunk (bfcache, a mobile OS kill, a
 * discarded tab) are not this job's business: they have no candidate and
 * stay with the idle path. So does project discovery - this job reads the
 * project index as it stands and never reconciles it, because the idle job
 * already does, and a SCAN every minute would cost five times as much.
 * ------------------------------------------------------------------
 */

export interface FinalizeEndedSessionsSummary {
  candidates: number;
  checked: number;
  finalized: number;
  stillRecording: number;
  /* Sessions whose tabs had all ended, held back by the grace; kept queued. */
  settling: number;
  /* Sessions that had ended but were left queued for the next run's budget. */
  deferred: number;
  failed: number;
  budgetExhausted: boolean;
  /* The run did nothing because an earlier run still holds the lock. */
  skippedLockHeld: boolean;
}

interface EndedSessionCandidate {
  member: string;
  score: number;
}

/*
 * The run's project order: the indexed projects, de-duplicated and SORTED,
 * then rotated to start at `cursor` (modulo the count).
 *
 * SMEMBERS answers in an order that is stable for as long as the set is
 * (insertion order for a small set, hash-bucket order for a large one), so
 * walking it as returned put the same project first every single minute. A
 * busy project there spent the run budget on its own backlog and every
 * project after it waited for the idle path, 10-15 minutes, which is the
 * bug this job exists to fix. Sorting makes the order independent of
 * Redis' encoding, and the rotating start makes every project first in
 * turn. Exported so tests can pin the rotation itself.
 */
export function rotateEndedProjectOrder(
  projectIds: Array<string>,
  cursor: number,
): Array<string> {
  const sorted: Array<string> = Array.from(new Set<string>(projectIds)).sort();

  if (sorted.length <= 1) {
    return sorted;
  }

  const safeCursor: number = Number.isFinite(cursor) ? Math.floor(cursor) : 0;
  const start: number =
    ((safeCursor % sorted.length) + sorted.length) % sorted.length;

  return sorted.slice(start).concat(sorted.slice(0, start));
}

/*
 * Advance the persisted project cursor and return where this run starts.
 *
 * A counter in Redis rather than the wall clock, so a skipped or overlapping
 * run still moves the start on by exactly one. If Redis cannot answer, the
 * minute number stands in: still a rotation, just not a gapless one. The
 * TTL only keeps an abandoned counter from living forever; a counter that
 * expires restarts from 1, which is as good a start as any.
 */
async function nextEndedProjectCursor(
  client: ClientType,
  nowUnixMs: number,
): Promise<number> {
  try {
    const cursor: number = Number(
      await client.incr(SESSION_REPLAY_ENDED_PROJECT_CURSOR_KEY),
    );

    await client.expire(
      SESSION_REPLAY_ENDED_PROJECT_CURSOR_KEY,
      ENDED_PROJECT_CURSOR_TTL_SECONDS,
    );

    if (Number.isFinite(cursor)) {
      return cursor;
    }
  } catch (error) {
    logger.debug(
      `${ENDED_JOB_NAME}: could not advance the project cursor, rotating by the minute instead: ${getErrorMessage(error)}`,
    );
  }

  return Math.floor(nowUnixMs / (60 * 1000));
}

function createEndedSessionsSummary(): FinalizeEndedSessionsSummary {
  return {
    candidates: 0,
    checked: 0,
    finalized: 0,
    stillRecording: 0,
    settling: 0,
    deferred: 0,
    failed: 0,
    budgetExhausted: false,
    skippedLockHeld: false,
  };
}

export async function finalizeEndedSessions(): Promise<FinalizeEndedSessionsSummary> {
  const summary: FinalizeEndedSessionsSummary = createEndedSessionsSummary();

  const client: ClientType | null = Redis.getClient();

  if (!client || !Redis.isConnected()) {
    logger.warn(
      `${ENDED_JOB_NAME}: Redis is not connected; skipping this run. Ended sessions are found through Redis, and the idle finalizer picks them up once it is back.`,
    );
    return summary;
  }

  /*
   * Single flight, across replicas.
   *
   * The queue runner's one-minute timeout stops WAITING for a run, it does
   * not cancel it, and the worker queue runs many jobs at once. So without
   * this a run stalled in a slow correlation fetch had the next minute's
   * run start on the same candidates, repeating the same heavy Span and
   * ExceptionInstance scans on a cluster that was already slow - load
   * amplification exactly when it hurts most. The token makes the release
   * safe: a run that overran the TTL cannot delete the lock a later run
   * took (see SESSION_REPLAY_ENDED_RUN_LOCK_RELEASE_SCRIPT).
   */
  const lockToken: string = crypto.randomUUID();

  let lockAcquired: "OK" | null = null;

  try {
    lockAcquired = await client.set(
      SESSION_REPLAY_ENDED_RUN_LOCK_KEY,
      lockToken,
      "PX",
      ENDED_RUN_LOCK_TTL_MS,
      "NX",
    );
  } catch (error) {
    logger.warn(
      `${ENDED_JOB_NAME}: could not take the run lock; skipping this run: ${getErrorMessage(error)}`,
    );
    return summary;
  }

  if (lockAcquired !== "OK") {
    summary.skippedLockHeld = true;
    logger.debug(
      `${ENDED_JOB_NAME}: an earlier run still holds the lock; skipping this run.`,
    );
    return summary;
  }

  try {
    await runFinalizeEndedSessions(client, summary);
  } finally {
    try {
      await client.eval(
        SESSION_REPLAY_ENDED_RUN_LOCK_RELEASE_SCRIPT,
        1,
        SESSION_REPLAY_ENDED_RUN_LOCK_KEY,
        lockToken,
      );
    } catch (error) {
      /* The TTL releases it instead; the next run or two may skip. */
      logger.warn(
        `${ENDED_JOB_NAME}: could not release the run lock; it expires on its own: ${getErrorMessage(error)}`,
      );
    }
  }

  if (summary.budgetExhausted) {
    logger.warn(
      `${ENDED_JOB_NAME}: run budget exhausted after checking ${summary.checked} session(s); the remaining candidates are picked up next run.`,
    );
  }

  if (summary.candidates > 0 || summary.failed > 0) {
    logger.debug(
      `${ENDED_JOB_NAME}: read ${summary.candidates} ended candidate(s), checked ${summary.checked} session(s): finalized ${summary.finalized}, still recording ${summary.stillRecording}, settling ${summary.settling}, deferred ${summary.deferred}, ${summary.failed} failure(s)`,
    );
  }

  return summary;
}

async function runFinalizeEndedSessions(
  client: ClientType,
  summary: FinalizeEndedSessionsSummary,
): Promise<void> {
  const databaseName: string = getDatabaseName();
  const runStartedAt: number = Date.now();
  const runDeadlineUnixMs: number = runStartedAt + ENDED_RUN_BUDGET_MS;

  /*
   * Only a prefilter now. The grace is applied by hasSessionRecordingEnded
   * on the chunk rows' write times, for every tab of the session; reading
   * only candidates at least that old just spares a chunk-table read for a
   * final chunk that could not pass it yet.
   */
  const cutoffUnixMs: number =
    runStartedAt - SESSION_REPLAY_ENDED_FINALIZE_GRACE_MS;

  const indexedProjectIds: Array<string> = await client.smembers(
    SESSION_REPLAY_ACTIVE_PROJECTS_KEY,
  );

  /*
   * No cursor round trip when there is nothing to rotate: on most installs
   * the index holds no project, or one.
   */
  const projectIds: Array<string> = rotateEndedProjectOrder(
    indexedProjectIds,
    new Set<string>(indexedProjectIds).size > 1
      ? await nextEndedProjectCursor(client, runStartedAt)
      : 0,
  );

  for (
    let position: number = 0;
    position < projectIds.length && !summary.budgetExhausted;
    position++
  ) {
    const projectId: string = projectIds[position]!;
    const projectStartedAt: number = Date.now();

    if (projectStartedAt > runDeadlineUnixMs) {
      summary.budgetExhausted = true;
      break;
    }

    const checksLeft: number = MAX_ENDED_SESSIONS_PER_RUN - summary.checked;

    if (checksLeft <= 0) {
      break;
    }

    /*
     * An equal share of what is LEFT of the run, over the projects not yet
     * visited (this one included), with floors - see the limits near the top
     * of this module.
     */
    const projectsLeft: number = projectIds.length - position;

    const sessionShare: number = Math.min(
      checksLeft,
      Math.max(
        MIN_ENDED_SESSIONS_PER_PROJECT_PER_RUN,
        Math.floor(checksLeft / projectsLeft),
      ),
    );

    const projectDeadlineUnixMs: number = Math.min(
      runDeadlineUnixMs,
      projectStartedAt +
        Math.max(
          MIN_ENDED_PROJECT_SLICE_MS,
          Math.floor((runDeadlineUnixMs - projectStartedAt) / projectsLeft),
        ),
    );

    await finalizeEndedSessionsOfProject({
      client: client,
      summary: summary,
      databaseName: databaseName,
      projectId: projectId,
      cutoffUnixMs: cutoffUnixMs,
      runDeadlineUnixMs: runDeadlineUnixMs,
      projectDeadlineUnixMs: projectDeadlineUnixMs,
      sessionShare: sessionShare,
    });
  }
}

async function finalizeEndedSessionsOfProject(data: {
  client: ClientType;
  summary: FinalizeEndedSessionsSummary;
  databaseName: string;
  projectId: string;
  cutoffUnixMs: number;
  runDeadlineUnixMs: number;
  projectDeadlineUnixMs: number;
  sessionShare: number;
}): Promise<void> {
  const client: ClientType = data.client;
  const summary: FinalizeEndedSessionsSummary = data.summary;
  const projectId: string = data.projectId;
  const endedKey: string = getEndedSessionsKey(projectId);

  const candidatesBySessionId: Map<
    string,
    Array<EndedSessionCandidate>
  > = new Map<string, Array<EndedSessionCandidate>>();

  try {
    /*
     * Oldest first, so a project with more settled candidates than its share
     * drains in arrival order across runs.
     */
    const membersWithScores: Array<string> = await client.zrangebyscore(
      endedKey,
      "-inf",
      data.cutoffUnixMs,
      "WITHSCORES",
      "LIMIT",
      0,
      MAX_ENDED_CANDIDATES_PER_PROJECT_PER_RUN,
    );

    for (
      let index: number = 0;
      index + 1 < membersWithScores.length;
      index += 2
    ) {
      const member: string = membersWithScores[index]!;
      const score: number = toNumberValue(membersWithScores[index + 1]);
      const parsed: { sessionId: string; tabId: string } | null =
        parseActiveSessionMember(member);

      if (!parsed) {
        logger.warn(
          `${ENDED_JOB_NAME}: dropping malformed ended member "${member}" for project ${projectId}`,
        );
        await client.zrem(endedKey, member);
        continue;
      }

      summary.candidates++;

      const candidate: EndedSessionCandidate = {
        member: member,
        score: score,
      };

      const existing: Array<EndedSessionCandidate> | undefined =
        candidatesBySessionId.get(parsed.sessionId);

      if (existing) {
        existing.push(candidate);
      } else {
        candidatesBySessionId.set(parsed.sessionId, [candidate]);
      }
    }
  } catch (error) {
    logger.error(
      `${ENDED_JOB_NAME}: could not read the ended set for project ${projectId}: ${getErrorMessage(error)}`,
    );
    return;
  }

  /*
   * This project's share of the run, oldest sessions first (a Map keeps
   * insertion order, and the candidates arrived oldest first). The rest stay
   * queued. Cut BEFORE the correlation window is derived, so the batch's
   * grouped reads cover only the sessions this run can actually check.
   */
  const sessionsInShare: Array<[string, Array<EndedSessionCandidate>]> =
    Array.from(candidatesBySessionId.entries()).slice(0, data.sessionShare);

  if (sessionsInShare.length === 0) {
    return;
  }

  let batchOldestUnixMs: number = Number.MAX_SAFE_INTEGER;
  let batchNewestUnixMs: number = 0;

  for (const [, candidates] of sessionsInShare) {
    for (const candidate of candidates) {
      batchOldestUnixMs = Math.min(batchOldestUnixMs, candidate.score);
      batchNewestUnixMs = Math.max(batchNewestUnixMs, candidate.score);
    }
  }

  const projectObjectId: ObjectID = new ObjectID(projectId);

  /*
   * One grouped read per telemetry table for the whole batch, exactly as
   * the idle path does it and over the same kind of window: the scores are
   * the receive times of each tab's LAST chunk, so the window opens a full
   * session length before the oldest of them.
   *
   * Fetched lazily, on the first session that actually gets a header, and
   * then shared by the rest of the batch. Most checks here end in
   * "still-recording" and need no correlation at all.
   */
  let correlationForBatch: Promise<Map<string, SessionCorrelation>> | null =
    null;

  const sessionIdsInBatch: Array<string> = sessionsInShare.map(
    ([sessionId]: [string, Array<EndedSessionCandidate>]): string => {
      return sessionId;
    },
  );

  const getCorrelationForBatch: () => Promise<
    Map<string, SessionCorrelation>
  > = (): Promise<Map<string, SessionCorrelation>> => {
    if (!correlationForBatch) {
      correlationForBatch = fetchSessionCorrelation({
        databaseName: data.databaseName,
        projectId: projectObjectId,
        sessionIds: sessionIdsInBatch,
        windowStartUnixMs:
          batchOldestUnixMs -
          SESSION_REPLAY_MAX_SESSION_MS -
          SESSION_CORRELATION_WINDOW_PADDING_MS,
        windowEndUnixMs:
          batchNewestUnixMs + SESSION_CORRELATION_WINDOW_PADDING_MS,
      });
    }

    return correlationForBatch;
  };

  /*
   * Past the project's slice (which never outlasts the run's budget). Checked
   * between sessions, and handed to the finalize as its defer check so a
   * session that has ended but would start the slow correlation reads past
   * the slice stays queued instead.
   */
  const isPastProjectSlice: () => boolean = (): boolean => {
    return Date.now() > data.projectDeadlineUnixMs;
  };

  for (const [sessionId, candidates] of sessionsInShare) {
    if (Date.now() > data.runDeadlineUnixMs) {
      summary.budgetExhausted = true;
      break;
    }

    if (summary.checked >= MAX_ENDED_SESSIONS_PER_RUN) {
      break;
    }

    if (isPastProjectSlice()) {
      logger.debug(
        `${ENDED_JOB_NAME}: project ${projectId} used its share of this run; its remaining candidates are picked up next run.`,
      );
      break;
    }

    summary.checked++;

    const candidateRemovals: Array<ConditionalMemberRemoval> = candidates.map(
      (candidate: EndedSessionCandidate): ConditionalMemberRemoval => {
        return { member: candidate.member, maxScore: candidate.score };
      },
    );

    try {
      const result: FinalizeSessionResult = await finalizeSessionWithTabs({
        projectId: projectObjectId,
        sessionId: sessionId,
        databaseName: data.databaseName,
        requireRecordingEnded: true,
        shouldDefer: isPastProjectSlice,
        resolveCorrelation: async (): Promise<
          SessionCorrelation | undefined
        > => {
          return (await getCorrelationForBatch()).get(sessionId);
        },
      });

      if (result.outcome === "deferred") {
        /*
         * The session had ended, but writing it would have started past the
         * slice. Nothing was written and nothing is removed: the candidates
         * are the only thing that brings the session back here next run.
         */
        summary.deferred++;

        if (Date.now() > data.runDeadlineUnixMs) {
          summary.budgetExhausted = true;
        }

        break;
      }

      if (result.outcome === "settling") {
        /*
         * Every tab has ended, but the newest chunk is younger than the grace.
         * Nothing new has to happen for this to pass, so the candidates stay
         * and the session is re-checked next run. Removing them would leave
         * it to the idle path whenever no fresher candidate exists to bring
         * it back: a tab that reached the chunk cap (it sends no final
         * chunk), a final chunk whose ended-set ZADD failed, or an older
         * recorder's trailing chunk stored just after the final one.
         */
        summary.settling++;
        continue;
      }

      if (result.outcome === "written") {
        summary.finalized++;
      } else if (result.outcome === "still-recording") {
        summary.stillRecording++;
      } else if (result.outcome === "no-chunks") {
        logger.debug(
          `${ENDED_JOB_NAME}: session ${sessionId} in project ${projectId} has no stored chunks yet; leaving it to the idle finalizer.`,
        );
      }

      /*
       * Whatever the answer, the candidates that were checked leave the ended
       * set, each under the score it was read with, and the ACTIVITY entries
       * stay where they are.
       *
       * "still-recording", "erased" or "no-chunks": nothing was written, or
       * may be, or can be yet. Removing the candidates is right, not lossy: a
       * session can only BECOME all-ended when one of its still-live tabs
       * sends a final chunk, and that final chunk adds a fresh candidate
       * which brings the session back here. Keeping the checked candidates
       * instead would re-read the chunk table every minute, for as long as
       * the session lives, for every session of a multi-page application -
       * every page navigation seals one tab while the next page records on.
       *
       * "written": the header is finalized, and the Dashboard's "Recording
       * now" badge is down, which is this job's whole purpose. The activity
       * entries are STILL left for the idle path, which finalizes the session
       * once more SESSION_REPLAY_IDLE_FINALIZE_MS after its last chunk. That
       * second pass is deliberate, not waste: the trace ids and exception
       * fingerprints on the header come from a correlation read taken about a
       * minute after the tab closed, and spans and exceptions from the same
       * page can land later than that (a different exporter schedule, a
       * queue retry with backoff). The idle pass re-reads correlation once
       * that telemetry has settled, and buildFinalizedSessionRow merges it
       * with the ids the first header already carries, so nothing is lost
       * and the late ids are added. It also re-counts any chunk that landed
       * after this run's read, on a header whose version - stamped before
       * that read - it outranks.
       */
      await removeActivityMembersIfNotNewer(
        client,
        endedKey,
        candidateRemovals,
      );
    } catch (error) {
      /*
       * Everything stays where it is: the candidate is re-checked next
       * minute and the activity entry still backs it with the idle path.
       */
      summary.failed++;
      logger.error(
        `${ENDED_JOB_NAME}: failed to finalize ended session ${sessionId} in project ${projectId}: ${getErrorMessage(error)}`,
      );
    }
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
     * Never seeded on the provisional header (the finalizer's GROUP BY owns
     * them), so there is nothing to carry: zero is the truth for a session
     * whose chunks are gone.
     */
    clickCount: 0,
    customEventCount: 0,
    firstErrorOffsetMs: 0,
    activeMs: 0,
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

/*
 * Every minute, because this job's whole purpose is latency: a closed tab
 * should stop saying "Recording now" within about a minute. The timeout is
 * one interval; the run's own budget (ENDED_RUN_BUDGET_MS) keeps it well
 * inside that.
 */
RunCron(
  ENDED_JOB_NAME,
  {
    schedule: EVERY_MINUTE,
    runOnStartup: false,
    timeoutInMS: OneUptimeDate.convertMinutesToMilliseconds(1),
  },
  async (): Promise<void> => {
    try {
      await finalizeEndedSessions();
    } catch (error) {
      logger.error(`${ENDED_JOB_NAME}: ${getErrorMessage(error)}`);
    }
  },
);
