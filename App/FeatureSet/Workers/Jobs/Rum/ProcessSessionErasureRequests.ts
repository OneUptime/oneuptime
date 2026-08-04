import RunCron from "../../Utils/Cron";
import { getActiveSessionsKey } from "./FinalizeSessions";
import Redis, { ClientType } from "Common/Server/Infrastructure/Redis";
import {
  ERASURE_TOMBSTONE_TTL_SECONDS,
  getErasedSessionsKey,
  writeErasureTombstones,
} from "Common/Server/Utils/SessionReplay/SessionReplayErasureTombstone";
import RumSessionErasureRequest, {
  RumSessionErasureRequestStatus,
  RumSessionErasureRequestType,
} from "Common/Models/DatabaseModels/RumSessionErasureRequest";
import RumSessionErasureRequestService from "Common/Server/Services/RumSessionErasureRequestService";
import ProjectService from "Common/Server/Services/ProjectService";
import AnalyticsBaseModel from "Common/Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import ExceptionInstanceService from "Common/Server/Services/ExceptionInstanceService";
import LogService from "Common/Server/Services/LogService";
import SpanService from "Common/Server/Services/SpanService";
import RumSessionChunkService from "Common/Server/Services/RumSessionChunkService";
import RumSessionService from "Common/Server/Services/RumSessionService";
import AnalyticsDatabaseService, {
  MigrationExecuteOptions,
} from "Common/Server/Services/AnalyticsDatabaseService";
import {
  getStorageTableName,
  onClusterClause,
} from "Common/Server/Utils/AnalyticsDatabase/ClusterConfig";
import {
  SQL,
  Statement,
} from "Common/Server/Utils/AnalyticsDatabase/Statement";
import QueryHelper from "Common/Server/Types/Database/QueryHelper";
import Select from "Common/Server/Types/Database/Select";
import logger from "Common/Server/Utils/Logger";
import AnalyticsTableName from "Common/Types/AnalyticsDatabase/AnalyticsTableName";
import TableColumnType from "Common/Types/AnalyticsDatabase/TableColumnType";
import Includes from "Common/Types/BaseDatabase/Includes";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import OneUptimeDate from "Common/Types/Date";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import { EVERY_DAY } from "Common/Utils/CronTime";

/*
 * ------------------------------------------------------------------
 * Rum:ProcessSessionErasureRequests
 *
 * Executes GDPR / CCPA style erasure of session recordings. This is the
 * first erasure primitive in the codebase, so a few properties are worth
 * stating explicitly because nothing else here establishes them:
 *
 *  - Erasure removes the LOGS AND SPANS too. An erasure that deletes the
 *    recording and leaves the correlated log lines, spans and exception
 *    instances carrying the same session id is not erasure, it is a
 *    partial delete that still identifies the subject.
 *
 *  - A tombstone is written BEFORE anything is deleted. Chunks live in
 *    Redis staging for hours and the queue retries, so without a
 *    tombstone an in-flight chunk that lands after the mutation would
 *    resurrect part of an erased recording.
 *
 *    Consumers of the tombstone today: Rum:FinalizeSessions refuses to
 *    write a session header for a tombstoned session, and this job takes
 *    the erased sessions off the finalizer's activity queue outright.
 *    STILL MISSING: the chunk INGEST path
 *    (App/FeatureSet/Telemetry/Services/SessionReplayIngestService) does
 *    NOT yet SISMEMBER the tombstone before staging a chunk or before
 *    inserting it from the queue, so a chunk staged before the erasure and
 *    drained afterwards can still land in a new part the mutation will
 *    never see. Use isSessionErased() from
 *    Common/Server/Utils/SessionReplay/SessionReplayErasureTombstone there
 *    and drop the chunk on a hit.
 *
 *  - Deletes route through the MIGRATION connection pool. The app pool's
 *    ClickHouse client enforces request_timeout as a socket-IDLE timer at
 *    58 seconds, and a mutation submission on a busy cluster streams no
 *    bytes at all — so the app pool would destroy the request and the
 *    erasure would look like a failure while possibly having been applied.
 *
 *  - Batched daily, capped per mutation, one project at a time. ALTER ...
 *    DELETE creates a ClickHouse mutation per statement and mutations are
 *    bounded by number_of_mutations_to_throw (default 1000); an
 *    unthrottled erasure over a large date range would exhaust that queue
 *    and start failing ordinary telemetry ALTERs.
 * ------------------------------------------------------------------
 */

const JOB_NAME: string = "Rum:ProcessSessionErasureRequests";

/*
 * Session ids per ALTER ... DELETE. One mutation per 1000 ids keeps each
 * statement's IN list small enough to plan cheaply while keeping the
 * number of queued mutations far below ClickHouse's ceiling.
 */
export const MAX_SESSION_IDS_PER_MUTATION: number = 1000;

/*
 * Ids one request may erase in a single daily run. A request that hits
 * this cap is returned to Pending with its counters accumulated, so an
 * application-wide erasure drains over consecutive days instead of
 * queueing thousands of mutations in one burst. The remaining sessions
 * are found again next run because the erased ones no longer match.
 */
export const MAX_SESSION_IDS_PER_REQUEST_PER_RUN: number = 10000;

/*
 * Appended as raw SQL rather than bound as a parameter: a template
 * substitution in the SQL tag is compiled to an Identifier placeholder,
 * which would render LIMIT as a quoted identifier. The value is a
 * compile-time constant, so there is nothing to inject.
 */
const PER_RUN_LIMIT_CLAUSE: string = ` LIMIT ${MAX_SESSION_IDS_PER_REQUEST_PER_RUN}`;

/* Requests processed per run, to bound the job's wall clock. */
const MAX_REQUESTS_PER_RUN: number = 200;

/*
 * A request left InProgress for longer than this is presumed abandoned by
 * a crashed or evicted worker and is re-processed. Every step of the work
 * is idempotent (the tombstone SADD, the ALTER ... DELETE mutations and
 * the activity-set purge all converge), so re-running costs nothing but a
 * repeated mutation submission, whereas NOT re-running leaves the request
 * stuck in a non-terminal state forever with the subject's data possibly
 * only half deleted.
 *
 * Comfortably longer than the job's own 60 minute timeout, so a run that
 * is merely slow is never treated as dead by the next run.
 */
export const STALE_IN_PROGRESS_RECLAIM_MS: number = 2 * 60 * 60 * 1000;

/*
 * Activity-set members scanned per erased batch when purging the
 * finalizer's work queue. Bounded so a pathological project cannot turn
 * one erasure batch into an unbounded Redis walk.
 */
const MAX_ACTIVITY_PURGE_SCAN_ITERATIONS: number = 200;
const ACTIVITY_PURGE_SCAN_COUNT: number = 500;

/*
 * Shared by the Pending query and the stale-InProgress reclaim query, so
 * the two can never drift into selecting different columns and giving
 * resolveTargetSessionIds a differently-shaped request.
 */
const ERASURE_REQUEST_SELECT: Select<RumSessionErasureRequest> = {
  _id: true,
  projectId: true,
  rumApplicationId: true,
  requestType: true,
  targetValue: true,
  startDate: true,
  endDate: true,
  requestedAt: true,
  sessionsDeleted: true,
  chunksDeleted: true,
  attempts: true,
};

/*
 * How many failed runs an erasure request survives before it is marked
 * Failed for good and the project owners are told. Every step of the
 * erasure is idempotent by design (the job's own header comment insists
 * on it), so retrying is always safe — what is NOT safe is one transient
 * ClickHouse blip terminally killing a legal erasure obligation with
 * nothing but a log line to show for it.
 */
export const MAX_ERASURE_ATTEMPTS: number = 5;

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/*
 * The tombstone key helper and writer live in
 * Common/Server/Utils/SessionReplay/SessionReplayErasureTombstone so the
 * INGEST path can consult them: the ingest service runs in the API
 * process, and importing this cron module there would register a cron in
 * the wrong process. They are re-exported here because this job is where
 * the tombstone is written and callers (and tests) look for them here.
 */
export {
  ERASURE_TOMBSTONE_TTL_SECONDS,
  getErasedSessionsKey,
  writeErasureTombstones,
};

/*
 * The @clickhouse/client types live in Common's node_modules and are not
 * resolvable from App, so result sets are typed structurally here — the
 * same shape App/FeatureSet/BaseAPI/API/NetworkDeviceFlow.ts uses.
 */
interface ClickhouseJsonResultSet {
  json: () => Promise<{ data: Array<JSONObject> }>;
}

async function readSessionIds(statement: Statement): Promise<Array<string>> {
  const resultSet: ClickhouseJsonResultSet =
    (await RumSessionService.executeQuery(
      statement,
    )) as unknown as ClickhouseJsonResultSet;

  const parsed: { data: Array<JSONObject> } = await resultSet.json();
  const rows: Array<JSONObject> = parsed.data || [];

  const sessionIds: Array<string> = [];

  for (const row of rows) {
    const sessionId: unknown = row["sessionId"];

    if (typeof sessionId === "string" && sessionId.length > 0) {
      sessionIds.push(sessionId);
    }
  }

  return sessionIds;
}

/*
 * The optional application scope of a request, as a SQL fragment.
 *
 * RumSessionErasureRequest.rumApplicationId documents itself as "the
 * application this erasure request is scoped to, if any. Null for a
 * project-wide request", and the UI presents it as a scope selector. A
 * scoped request that ignored it would destroy every OTHER application's
 * recordings in the project (and their correlated logs, spans and
 * exception instances) — irreversible over-deletion driven by a field the
 * requester used to NARROW the blast radius.
 *
 * Returns an empty statement for an unscoped request, so a project-wide
 * erasure still matches everything.
 */
export function buildRumApplicationScopeClause(
  request: RumSessionErasureRequest,
): Statement {
  const rumApplicationId: string = request.rumApplicationId
    ? request.rumApplicationId.toString()
    : "";

  if (!rumApplicationId) {
    return SQL``;
  }

  return SQL` AND rumApplicationId = ${{
    type: TableColumnType.Text,
    value: rumApplicationId,
  }}`;
}

/*
 * Resolve the erasure subject to a concrete set of session ids.
 *
 * DISTINCT rather than argMax: ReplacingMergeTree keeps several versions
 * of a header visible until merge, and all we need from the header table
 * is the id set — so collapsing duplicates is enough and no version
 * arithmetic is required.
 */
export async function resolveTargetSessionIds(data: {
  databaseName: string;
  request: RumSessionErasureRequest;
}): Promise<Array<string>> {
  const request: RumSessionErasureRequest = data.request;
  const projectId: ObjectID | undefined = request.projectId;

  if (!projectId) {
    throw new Error("Erasure request has no projectId");
  }

  const requestType: RumSessionErasureRequestType | undefined =
    request.requestType;
  const targetValue: string = (request.targetValue || "").trim();
  const applicationScope: Statement = buildRumApplicationScopeClause(request);

  if (requestType === RumSessionErasureRequestType.BySessionId) {
    /*
     * An explicit id list needs no lookup at all, and must NOT be looked
     * up: the header row may already have expired by TTL while the chunk
     * rows (or correlated logs) live on under a longer retention, and the
     * subject is still entitled to have those removed.
     */
    return Array.from(
      new Set<string>(
        targetValue
          .split(",")
          .map((value: string): string => {
            return value.trim();
          })
          .filter((value: string): boolean => {
            return value.length > 0;
          }),
      ),
    ).slice(0, MAX_SESSION_IDS_PER_REQUEST_PER_RUN);
  }

  if (requestType === RumSessionErasureRequestType.ByIdentifiedUserKey) {
    return await readSessionIds(
      SQL`
        SELECT DISTINCT sessionId AS sessionId
        FROM ${data.databaseName}.${AnalyticsTableName.RumSession}
        WHERE projectId = ${{
          type: TableColumnType.ObjectID,
          value: projectId,
        }} AND identifiedUserKey = ${{
          type: TableColumnType.Text,
          value: targetValue,
        }}`
        .append(applicationScope)
        .append(PER_RUN_LIMIT_CLAUSE),
    );
  }

  if (requestType === RumSessionErasureRequestType.ByRumApplication) {
    /*
     * targetValue carries the application id rather than reading it from
     * the nullable rumApplicationId relation: the relation is set to NULL
     * when the application is deleted, and deleting the application is
     * precisely when this request has to still know what to erase.
     */
    const rumApplicationId: string =
      targetValue || request.rumApplicationId?.toString() || "";

    if (!rumApplicationId) {
      throw new Error(
        "ByRumApplication erasure request carries no application id",
      );
    }

    return await readSessionIds(
      SQL`
        SELECT DISTINCT sessionId AS sessionId
        FROM ${data.databaseName}.${AnalyticsTableName.RumSession}
        WHERE projectId = ${{
          type: TableColumnType.ObjectID,
          value: projectId,
        }} AND rumApplicationId = ${{
          type: TableColumnType.Text,
          value: rumApplicationId,
        }}`.append(PER_RUN_LIMIT_CLAUSE),
    );
  }

  if (requestType === RumSessionErasureRequestType.ByDateRange) {
    if (!request.startDate || !request.endDate) {
      throw new Error("ByDateRange erasure request has no start or end date");
    }

    return await readSessionIds(
      SQL`
        SELECT DISTINCT sessionId AS sessionId
        FROM ${data.databaseName}.${AnalyticsTableName.RumSession}
        WHERE projectId = ${{
          type: TableColumnType.ObjectID,
          value: projectId,
        }} AND startTime >= ${{
          type: TableColumnType.DateTime64,
          value: request.startDate,
        }} AND startTime <= ${{
          type: TableColumnType.DateTime64,
          value: request.endDate,
        }}`
        .append(applicationScope)
        .append(PER_RUN_LIMIT_CLAUSE),
    );
  }

  throw new Error(`Unsupported erasure request type "${String(requestType)}"`);
}

export function buildSessionDeleteStatement(data: {
  databaseName: string;
  tableName: string;
  projectId: ObjectID;
  sessionIds: Array<string>;
}): Statement {
  /*
   * Lightweight DELETE cannot target a Distributed table and does not
   * accept ON CLUSTER, so this is an ALTER on the LOCAL storage table
   * dispatched to every shard (and replicated inside each shard through
   * Keeper) — the same shape AnalyticsDatabaseService.toDeleteStatement
   * uses.
   */
  const localTableName: string = getStorageTableName(data.tableName);

  return SQL`
      ALTER TABLE ${data.databaseName}.${localTableName}`
    .append(onClusterClause())
    .append(
      SQL`
      DELETE WHERE projectId = ${{
        type: TableColumnType.ObjectID,
        value: data.projectId,
      }} AND sessionId IN ${{
        type: TableColumnType.Text,
        value: new Includes(data.sessionIds),
      }}`,
    );
}

/*
 * Erase a batch from one table. Returns false when the table does not
 * carry a sessionId column yet.
 *
 * The guard is not defensive dressing: sessionId is added to the log /
 * span / exception tables by a separate reconcile, and issuing an ALTER
 * against a column that does not exist would fail the whole erasure and
 * leave the recording deleted with the correlated telemetry intact — the
 * worst of both outcomes. Skipping it loudly is strictly better.
 */
async function eraseSessionRowsFromTable(data: {
  service: AnalyticsDatabaseService<AnalyticsBaseModel>;
  databaseName: string;
  projectId: ObjectID;
  sessionIds: Array<string>;
}): Promise<boolean> {
  const tableName: string = data.service.model.tableName;

  if (!data.service.model.getTableColumn("sessionId")) {
    logger.warn(
      `${JOB_NAME}: ${tableName} declares no sessionId column; correlated rows for this erasure were NOT removed.`,
    );
    return false;
  }

  const statement: Statement = buildSessionDeleteStatement({
    databaseName: data.databaseName,
    tableName: tableName,
    projectId: data.projectId,
    sessionIds: data.sessionIds,
  });

  /*
   * mutations_sync is deliberately left at its default, so this returns
   * once the mutation is QUEUED rather than once every part is rewritten.
   * Waiting would hold the connection for hours on a large SpanItemV3 and
   * gains nothing: the mutation is durable in Keeper the moment it is
   * accepted.
   */
  await data.service.execute(statement, MigrationExecuteOptions);

  return true;
}

async function countChunksForSessions(data: {
  databaseName: string;
  projectId: ObjectID;
  sessionIds: Array<string>;
}): Promise<number> {
  const statement: Statement = SQL`
    SELECT count() AS chunkCount
    FROM ${data.databaseName}.${AnalyticsTableName.RumSessionChunk}
    WHERE projectId = ${{
      type: TableColumnType.ObjectID,
      value: data.projectId,
    }} AND sessionId IN ${{
      type: TableColumnType.Text,
      value: new Includes(data.sessionIds),
    }}`;

  const resultSet: ClickhouseJsonResultSet =
    (await RumSessionChunkService.executeQuery(
      statement,
    )) as unknown as ClickhouseJsonResultSet;

  const parsed: { data: Array<JSONObject> } = await resultSet.json();
  const row: JSONObject | undefined = (parsed.data || [])[0];

  return row ? Number(row["chunkCount"]) || 0 : 0;
}

/*
 * Take the erased sessions off the finalizer's work queue.
 *
 * The finalizer derives a session header from the chunk rows and writes it
 * with `version = Date.now()`, and ClickHouse mutations only rewrite the
 * parts that existed when they were submitted. So a session that is still
 * sitting in `replay:active:<projectId>` when the erasure is submitted gets
 * a BRAND NEW header row written by the next finalizer run, carrying
 * identifiedUserKey, entryUrl, routes and countryCode for the subject who
 * asked to be erased — and nothing ever deletes that row again.
 *
 * The finalizer also checks the tombstone, so this is the second of two
 * independent guards rather than the only one. It matters on its own
 * because it stops the session being ENQUEUED at all, which is cheaper and
 * survives a Redis restart differently to the tombstone check.
 *
 * Members are "<sessionId>:<tabId>", so the match is on the sessionId
 * prefix rather than on the whole member: one session can have several
 * tabs and every one of them has to go.
 */
export async function purgeErasedSessionsFromActivitySet(data: {
  projectId: string;
  sessionIds: Array<string>;
}): Promise<number> {
  const client: ClientType | null = Redis.getClient();

  if (!client || !Redis.isConnected()) {
    return 0;
  }

  if (data.sessionIds.length === 0) {
    return 0;
  }

  const erased: Set<string> = new Set<string>(data.sessionIds);
  const activeKey: string = getActiveSessionsKey(data.projectId);

  let removed: number = 0;
  let cursor: string = "0";
  let iterations: number = 0;

  do {
    /*
     * ZSCAN returns a flat [member, score, member, score, ...] array, so
     * the stride is 2. Scanning once over the whole activity set is
     * cheaper than one MATCH per erased session id: a batch carries up to
     * MAX_SESSION_IDS_PER_MUTATION ids while the activity set only ever
     * holds the sessions seen in the last few hours.
     */
    const [nextCursor, entries]: [string, Array<string>] = await client.zscan(
      activeKey,
      cursor,
      "COUNT",
      ACTIVITY_PURGE_SCAN_COUNT,
    );

    cursor = nextCursor;
    iterations++;

    const doomed: Array<string> = [];

    for (let index: number = 0; index < entries.length; index += 2) {
      const member: string | undefined = entries[index];

      if (!member) {
        continue;
      }

      const separatorIndex: number = member.indexOf(":");
      const sessionId: string =
        separatorIndex > 0 ? member.substring(0, separatorIndex) : member;

      if (erased.has(sessionId)) {
        doomed.push(member);
      }
    }

    if (doomed.length > 0) {
      removed += await client.zrem(activeKey, doomed);
    }
  } while (cursor !== "0" && iterations < MAX_ACTIVITY_PURGE_SCAN_ITERATIONS);

  return removed;
}

export async function eraseSessionBatch(data: {
  databaseName: string;
  projectId: ObjectID;
  sessionIds: Array<string>;
}): Promise<number> {
  await writeErasureTombstones({
    projectId: data.projectId.toString(),
    sessionIds: data.sessionIds,
  });

  /*
   * Immediately after the tombstone and before any DELETE: the finalizer
   * runs every 5 minutes and must not be holding a queue entry that would
   * write a fresh header for one of these sessions while the mutations
   * are still draining.
   */
  const activityEntriesRemoved: number =
    await purgeErasedSessionsFromActivitySet({
      projectId: data.projectId.toString(),
      sessionIds: data.sessionIds,
    });

  if (activityEntriesRemoved > 0) {
    logger.info(
      `${JOB_NAME}: removed ${activityEntriesRemoved} pending activity entr(ies) for erased sessions in project ${data.projectId.toString()}`,
    );
  }

  const chunksDeleted: number = await countChunksForSessions({
    databaseName: data.databaseName,
    projectId: data.projectId,
    sessionIds: data.sessionIds,
  });

  /*
   * Chunks first, header second. If the run dies between the two the
   * session is left listed but unplayable, which is a recoverable state
   * the next run finishes; the reverse order would leave orphaned payload
   * rows with no header pointing at them, which nothing would ever find
   * again.
   */
  await eraseSessionRowsFromTable({
    service: RumSessionChunkService,
    databaseName: data.databaseName,
    projectId: data.projectId,
    sessionIds: data.sessionIds,
  });

  await eraseSessionRowsFromTable({
    service: RumSessionService,
    databaseName: data.databaseName,
    projectId: data.projectId,
    sessionIds: data.sessionIds,
  });

  /* The correlated telemetry. Erasure that stops at the video is not erasure. */
  const correlatedTelemetryServices: Array<
    AnalyticsDatabaseService<AnalyticsBaseModel>
  > = [LogService, SpanService, ExceptionInstanceService];

  for (const service of correlatedTelemetryServices) {
    await eraseSessionRowsFromTable({
      service: service,
      databaseName: data.databaseName,
      projectId: data.projectId,
      sessionIds: data.sessionIds,
    });
  }

  return chunksDeleted;
}

export function chunkSessionIds(
  sessionIds: Array<string>,
  batchSize: number,
): Array<Array<string>> {
  const batches: Array<Array<string>> = [];

  for (let index: number = 0; index < sessionIds.length; index += batchSize) {
    batches.push(sessionIds.slice(index, index + batchSize));
  }

  return batches;
}

export async function processErasureRequest(data: {
  databaseName: string;
  request: RumSessionErasureRequest;
}): Promise<void> {
  const request: RumSessionErasureRequest = data.request;
  const requestId: ObjectID | null = request.id;
  const projectId: ObjectID | undefined = request.projectId;

  if (!requestId || !projectId) {
    return;
  }

  /*
   * Claim the request before doing any work. The cron is single-flighted by
   * the queue, but a manual re-run or a duplicated repeatable job must not
   * double-submit mutations for the same subject.
   */
  await RumSessionErasureRequestService.markInProgress({
    requestId: requestId,
  });

  try {
    const sessionIds: Array<string> = await resolveTargetSessionIds({
      databaseName: data.databaseName,
      request: request,
    });

    let chunksDeleted: number = 0;

    /*
     * Batches run one after another, never in parallel: one concurrent
     * erasure per project is the whole point of the throttle. Parallel
     * mutations on the same table multiply merge pressure without
     * finishing any sooner.
     */
    for (const batch of chunkSessionIds(
      sessionIds,
      MAX_SESSION_IDS_PER_MUTATION,
    )) {
      chunksDeleted += await eraseSessionBatch({
        databaseName: data.databaseName,
        projectId: projectId,
        sessionIds: batch,
      });
    }

    const sessionsDeleted: number =
      (request.sessionsDeleted || 0) + sessionIds.length;
    const totalChunksDeleted: number =
      (request.chunksDeleted || 0) + chunksDeleted;

    /*
     * Hitting the per-run cap means more of this subject remains, so the
     * request goes back to Pending with its progress accumulated rather
     * than reporting a completion it has not achieved. The next daily run
     * finds the remainder because the erased sessions no longer match.
     *
     * This is the one status transition the service exposes no helper for -
     * markCompleted / markFailed are both terminal - so it is written
     * directly. completedAt stays unset: a requeued request must not look
     * finished to the UI or to a compliance export.
     */
    if (sessionIds.length >= MAX_SESSION_IDS_PER_REQUEST_PER_RUN) {
      await RumSessionErasureRequestService.updateOneById({
        id: requestId,
        data: {
          status: RumSessionErasureRequestStatus.Pending,
          sessionsDeleted: sessionsDeleted,
          chunksDeleted: totalChunksDeleted,
        },
        props: {
          isRoot: true,
        },
      });

      logger.info(
        `${JOB_NAME}: erased ${sessionIds.length} session(s) and ${chunksDeleted} chunk row(s) for request ${requestId.toString()}; more remains, requeued for the next run`,
      );

      return;
    }

    await RumSessionErasureRequestService.markCompleted({
      requestId: requestId,
      sessionsDeleted: sessionsDeleted,
      chunksDeleted: totalChunksDeleted,
    });

    logger.info(
      `${JOB_NAME}: erased ${sessionIds.length} session(s) and ${chunksDeleted} chunk row(s) for request ${requestId.toString()}`,
    );
  } catch (error) {
    const failureReason: string = getErrorMessage(error);
    const attempts: number = (request.attempts || 0) + 1;

    logger.error(
      `${JOB_NAME}: erasure request ${requestId.toString()} failed (attempt ${attempts} of ${MAX_ERASURE_ATTEMPTS}): ${failureReason}`,
    );

    /*
     * Requeue while attempts remain. Every mutation this job submits is
     * idempotent, so re-running a half-done request is safe — and the
     * alternative was terminal: markFailed rows were never re-examined,
     * so an erasure could die half-done (tombstone written, chunk table
     * deleted, logs and spans intact) on one transient error.
     */
    if (attempts < MAX_ERASURE_ATTEMPTS) {
      await RumSessionErasureRequestService.updateOneById({
        id: requestId,
        data: {
          status: RumSessionErasureRequestStatus.Pending,
          attempts: attempts,
          failureReason: failureReason,
        },
        props: {
          isRoot: true,
        },
      });

      return;
    }

    await RumSessionErasureRequestService.updateOneById({
      id: requestId,
      data: {
        attempts: attempts,
      },
      props: {
        isRoot: true,
      },
    });

    await RumSessionErasureRequestService.markFailed({
      requestId: requestId,
      failureReason: failureReason,
    });

    /*
     * Terminal failure of a right-to-erasure request is a legal problem,
     * not an ops nicety, so it must reach a human — a logger.error line
     * nobody greps is not notice. Best effort: a mail failure must not
     * throw back into the job.
     */
    if (request.projectId) {
      try {
        await ProjectService.sendEmailToProjectOwners(
          request.projectId,
          "A session replay erasure request could not be completed",
          `A session replay erasure request (id ${requestId.toString()}) failed ${MAX_ERASURE_ATTEMPTS} times and has been marked as failed. Last error: ${failureReason}. ` +
            `Parts of the requested erasure may be incomplete. Please review it under RUM > Session Replay, or re-create the request to retry — erasure requests carry a compliance deadline.`,
        );
      } catch (mailError) {
        logger.error(
          `${JOB_NAME}: could not notify project owners about failed erasure request ${requestId.toString()}: ${getErrorMessage(mailError)}`,
        );
      }
    }
  }
}

export async function processPendingErasureRequests(): Promise<void> {
  const databaseName: string | undefined =
    RumSessionService.database.getDatasourceOptions().database;

  if (!databaseName) {
    throw new Error("ClickHouse database name is not configured");
  }

  /*
   * Deliberately not RumSessionErasureRequestService.getPendingRequests():
   * a requeued request has to ACCUMULATE its counters across runs, and that
   * helper does not select sessionsDeleted / chunksDeleted. Everything else
   * about the query is identical.
   */
  const pendingRequests: Array<RumSessionErasureRequest> =
    await RumSessionErasureRequestService.findBy({
      query: {
        status: RumSessionErasureRequestStatus.Pending,
      },
      select: ERASURE_REQUEST_SELECT,
      /* Oldest first, so a request cannot be starved by newer ones. */
      sort: {
        requestedAt: SortOrder.Ascending,
      },
      limit: MAX_REQUESTS_PER_RUN,
      skip: 0,
      props: {
        isRoot: true,
      },
    });

  /*
   * Requests abandoned mid-flight. markInProgress is written before any
   * work happens, so a worker crash, a pod eviction or the job's own 60
   * minute timeout firing leaves a request InProgress with the tombstone
   * written and possibly only the chunk table deleted. Nothing else in the
   * system would ever look at it again, and the erasure SLA would be
   * missed silently.
   *
   * `updatedAt` is the claim timestamp: markInProgress is an update, so it
   * is stamped by the base service on every claim.
   */
  const staleRequests: Array<RumSessionErasureRequest> =
    await RumSessionErasureRequestService.findBy({
      query: {
        status: RumSessionErasureRequestStatus.InProgress,
        updatedAt: QueryHelper.lessThan(
          new Date(
            OneUptimeDate.getCurrentDate().getTime() -
              STALE_IN_PROGRESS_RECLAIM_MS,
          ),
        ),
      },
      select: ERASURE_REQUEST_SELECT,
      sort: {
        requestedAt: SortOrder.Ascending,
      },
      limit: MAX_REQUESTS_PER_RUN,
      skip: 0,
      props: {
        isRoot: true,
      },
    });

  if (staleRequests.length > 0) {
    logger.warn(
      `${JOB_NAME}: reclaiming ${staleRequests.length} erasure request(s) left InProgress by an interrupted run`,
    );
  }

  const requestsToProcess: Array<RumSessionErasureRequest> = [
    ...pendingRequests,
    ...staleRequests,
  ];

  if (requestsToProcess.length === 0) {
    return;
  }

  /*
   * Group by project and walk the groups in order, so a project with a
   * hundred queued requests cannot interleave a hundred concurrent
   * mutation submissions with another project's.
   */
  const requestsByProject: Map<
    string,
    Array<RumSessionErasureRequest>
  > = new Map<string, Array<RumSessionErasureRequest>>();

  for (const request of requestsToProcess) {
    const projectKey: string = request.projectId
      ? request.projectId.toString()
      : "";

    if (!projectKey) {
      continue;
    }

    const existing: Array<RumSessionErasureRequest> | undefined =
      requestsByProject.get(projectKey);

    if (existing) {
      existing.push(request);
    } else {
      requestsByProject.set(projectKey, [request]);
    }
  }

  for (const requests of requestsByProject.values()) {
    for (const request of requests) {
      await processErasureRequest({
        databaseName: databaseName,
        request: request,
      });
    }
  }
}

RunCron(
  JOB_NAME,
  {
    schedule: EVERY_DAY,
    runOnStartup: false,
    timeoutInMS: OneUptimeDate.convertMinutesToMilliseconds(60),
  },
  async (): Promise<void> => {
    try {
      await processPendingErasureRequests();
    } catch (error) {
      logger.error(`${JOB_NAME}: ${getErrorMessage(error)}`);
    }
  },
);
