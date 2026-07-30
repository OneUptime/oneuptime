import RunCron from "../../Utils/Cron";
import Redis, { ClientType } from "Common/Server/Infrastructure/Redis";
import RumSessionErasureRequest, {
  RumSessionErasureRequestStatus,
  RumSessionErasureRequestType,
} from "Common/Models/DatabaseModels/RumSessionErasureRequest";
import RumSessionErasureRequestService from "Common/Server/Services/RumSessionErasureRequestService";
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
 *    resurrect part of an erased recording. The ingest path checks the
 *    tombstone before every insert.
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
 * Tombstone lifetime. Must comfortably outlast the chunk staging TTL plus
 * the queue's maximum retry window, or a delayed redelivery could
 * reinstate an erased session. Refreshed on every write.
 */
export const ERASURE_TOMBSTONE_TTL_SECONDS: number = 7 * 24 * 60 * 60;

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/*
 * Redis tombstone key, mirrored by the session-replay ingest service —
 * which MUST SISMEMBER this set before staging or inserting a chunk. The
 * durable record of the erasure is the RumSessionErasureRequest row; this
 * set is the fast path the hot ingest loop can afford.
 */
export function getErasedSessionsKey(projectId: string): string {
  return `replay:erased:${projectId}`;
}

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
        }}`.append(PER_RUN_LIMIT_CLAUSE),
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
        }}`.append(PER_RUN_LIMIT_CLAUSE),
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
 * Write the tombstone before deleting anything, and treat a Redis failure
 * as fatal for the batch. Deleting first and tombstoning afterwards would
 * leave a window in which a staged chunk can be inserted back into a
 * recording the subject asked to have destroyed.
 */
export async function writeErasureTombstones(data: {
  projectId: string;
  sessionIds: Array<string>;
}): Promise<void> {
  const client: ClientType | null = Redis.getClient();

  if (!client || !Redis.isConnected()) {
    throw new Error(
      "Redis is not connected; refusing to erase sessions without a tombstone the ingest path can check",
    );
  }

  const key: string = getErasedSessionsKey(data.projectId);

  await client.sadd(key, data.sessionIds);
  await client.expire(key, ERASURE_TOMBSTONE_TTL_SECONDS);
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

async function processErasureRequest(data: {
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

    logger.error(
      `${JOB_NAME}: erasure request ${requestId.toString()} failed: ${failureReason}`,
    );

    await RumSessionErasureRequestService.markFailed({
      requestId: requestId,
      failureReason: failureReason,
    });
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
      select: {
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
      },
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

  if (pendingRequests.length === 0) {
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

  for (const request of pendingRequests) {
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
