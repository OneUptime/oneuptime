import { ClickhouseAppInstance } from "Common/Server/Infrastructure/ClickhouseDatabase";
import PostgresAppInstance from "Common/Server/Infrastructure/PostgresDatabase";
import Queue, { QueueName } from "Common/Server/Infrastructure/Queue";
import EnterpriseEdition from "Common/Server/Enterprise/EnterpriseEdition";
import EnterpriseFeature from "Common/Server/Enterprise/EnterpriseFeature";
import MasterAdminAuthorization from "Common/Server/Middleware/MasterAdminAuthorization";
import Express, {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  NextFunction,
} from "Common/Server/Utils/Express";
import logger from "Common/Server/Utils/Logger";
import Response from "Common/Server/Utils/Response";
import BadDataException from "Common/Types/Exception/BadDataException";
import { JSONArray, JSONObject } from "Common/Types/JSON";
import {
  attachProjectNames,
  getTelemetryIngestionByProject,
  MAX_PROJECTS_PER_SIGNAL,
  TelemetryProjectIngestion,
  TelemetryProjectIngestionResult,
} from "Common/Server/Utils/InstanceHealth/TelemetryIngestion";
import ProjectService from "Common/Server/Services/ProjectService";
import Project from "Common/Models/DatabaseModels/Project";
import QueryHelper from "Common/Server/Types/Database/QueryHelper";
import LIMIT_MAX from "Common/Types/Database/LimitMax";
import {
  CH_DIAG_QUERY_SETTINGS,
  getClickhouseDiagnostics,
  getClickhouseTelemetryIngestion,
  getDiagnosticLogs,
  getFailedJobsForQueue,
  getPostgresClusterHealth,
  getPostgresStats,
  getQueueStats,
  getRedisStats,
  SUPPORT_QUEUE_NAMES,
  toNumberOrNull,
} from "App/API/AdminHealthProbes";

/*
 * ---------------------------------------------------------------------------
 * The live OneUptime Health dashboards (OneUptime Enterprise Edition)
 *
 * The GET routes behind the Health screens of the enterprise Admin Dashboard
 * plugin: the overview, background queues and their failed jobs, Valkey,
 * diagnostic logs, the ClickHouse cluster, telemetry ingestion (by signal and
 * by project), the Postgres cluster and live Postgres activity.
 *
 * Every handler asks EnterpriseEdition.assertFeatureAvailable(InstanceHealth)
 * first, so an Enterprise install whose license is missing, invalid, expired
 * past its grace period or does not include instance health answers 402 on
 * the next request, without a restart. OneUptime Cloud (billing on) always
 * passes.
 *
 * The probes the support bundle also reads come from core
 * (App/API/AdminHealthProbes), so a dashboard and the downloaded bundle never
 * disagree; the probes only these dashboards read live here.
 *
 * Served by the enterprise module's admin-health router (see ./Index.ts),
 * mounted at /api/admin/health ahead of core's router, which answers these
 * paths with 402 when this module is not loaded.
 * ---------------------------------------------------------------------------
 */

/*
 * The overview polls background-queue state. Master-admin traffic is
 * low-volume, but queue introspection still crosses Redis, so cache it briefly.
 */
const CACHE_TTL_MS: number = 15000;
let overviewCache: { data: JSONObject; expiresAt: number } | null = null;
let queuesCache: { data: JSONObject; expiresAt: number } | null = null;

// Tests only: forget the cached overview and queue stats.
export const resetHealthDashboardCachesForTests: () => void = (): void => {
  overviewCache = null;
  queuesCache = null;
};

/*
 * A cheap ClickHouse reachability probe for the overview summary. The full
 * capacity read (getClickhouseStats) crosses the cluster and is far too heavy
 * for an at-a-glance health tile, so here we only answer "can we reach it".
 */
export async function getClickhouseHealthSummary(): Promise<JSONObject> {
  const result: JSONObject = { connected: false };

  try {
    const client: ReturnType<typeof ClickhouseAppInstance.getDataSource> =
      ClickhouseAppInstance.getDataSource();

    if (!client) {
      return result;
    }

    await (
      await client.query({
        query: "SELECT 1" + CH_DIAG_QUERY_SETTINGS,
        format: "JSON",
      })
    ).json();

    result["connected"] = true;
  } catch (err) {
    logger.error("AdminHealth: failed to reach ClickHouse for health summary");
    logger.error(err);
  }

  return result;
}

/*
 * A compact, at-a-glance roll-up of the whole instance's health for the
 * overview page: datastore reachability (Postgres / ClickHouse / Redis) plus a
 * background-queue summary. Each datastore probe already fails soft (returns
 * connected:false rather than throwing), so one unreachable datastore never
 * blanks the others. Kept deliberately lightweight — the deep introspection
 * lives on each subsystem's own page.
 */
export async function getHealthSummary(): Promise<JSONObject> {
  const [postgres, clickhouse, redis, queues] = await Promise.all([
    getPostgresStats(),
    getClickhouseHealthSummary(),
    getRedisStats(),
    getQueueStats(),
  ]);

  let totalQueues: number = 0;
  let healthyQueues: number = 0;
  let failingQueues: number = 0;
  let unavailableQueues: number = 0;
  let failedJobs: number = 0;
  let waitingJobs: number = 0;
  let delayedJobs: number = 0;

  for (const queue of queues) {
    const queueObject: JSONObject = queue as JSONObject;
    totalQueues++;

    if (queueObject["error"]) {
      unavailableQueues++;
      continue;
    }

    const failed: number = toNumberOrNull(queueObject["failed"]) || 0;
    failedJobs += failed;
    waitingJobs += toNumberOrNull(queueObject["waiting"]) || 0;
    delayedJobs += toNumberOrNull(queueObject["delayed"]) || 0;

    if (failed > 0) {
      failingQueues++;
    } else {
      healthyQueues++;
    }
  }

  return {
    postgres: {
      connected: Boolean(postgres["connected"]),
      databaseSizeInBytes: postgres["databaseSizeInBytes"] ?? null,
    },
    clickhouse: {
      connected: Boolean(clickhouse["connected"]),
    },
    redis: {
      connected: Boolean(redis["connected"]),
      usedMemoryInBytes: redis["usedMemoryInBytes"] ?? null,
      maxMemoryInBytes: redis["maxMemoryInBytes"] ?? null,
    },
    queues: {
      totalQueues,
      healthyQueues,
      failingQueues,
      unavailableQueues,
      failedJobs,
      waitingJobs,
      delayedJobs,
    },
  };
}

// How much statement text the activity probe returns per query, in characters.
export const ACTIVITY_QUERY_TEXT_LENGTH: number = 500;

/*
 * Live Postgres activity for interactive debugging: the queries running right
 * now (longest-running first), lock blocking pairs (who is stuck behind whom),
 * cumulative statement statistics (pg_stat_statements, when installed) and
 * autovacuum progress. Unlike getPostgresClusterHealth() in
 * App/API/AdminHealthProbes, this DOES
 * return statement text: pg_stat_activity queries verbatim (truncated) and
 * pg_stat_statements queries normalized by Postgres (constants become $n
 * placeholders). Statement text is what an operator needs to debug a slow or
 * stuck instance, and the master-admin audience already holds query-console
 * access — but it can embed customer data in literals, which is why this probe
 * is deliberately NOT included in the downloadable support bundle, which is
 * meant to stay shareable.
 */
export async function getPostgresActivity(): Promise<JSONObject> {
  const result: JSONObject = {
    connected: false,
    activeQueries: [],
    blockedSessions: [],
    statementsAvailable: false,
    topStatements: [],
    vacuumProgress: [],
  };

  try {
    const dataSource: ReturnType<typeof PostgresAppInstance.getDataSource> =
      PostgresAppInstance.getDataSource();

    if (!dataSource) {
      return result;
    }

    result["connected"] = true;

    /*
     * 1. Running queries, longest-running first. Excludes idle sessions and
     * this probe's own backend; includes idle-in-transaction sessions because
     * their last statement is the one holding the transaction (and its locks)
     * open.
     */
    try {
      const activityRows: Array<{
        pid: string;
        username: string | null;
        application_name: string | null;
        client_addr: string | null;
        state: string | null;
        wait_event_type: string | null;
        wait_event: string | null;
        query_age_seconds: string | null;
        transaction_age_seconds: string | null;
        query: string | null;
      }> = await dataSource.query(
        `SELECT
           a.pid,
           a.usename AS username,
           a.application_name,
           host(a.client_addr) AS client_addr,
           a.state,
           a.wait_event_type,
           a.wait_event,
           ROUND(EXTRACT(EPOCH FROM (now() - a.query_start))) AS query_age_seconds,
           ROUND(EXTRACT(EPOCH FROM (now() - a.xact_start))) AS transaction_age_seconds,
           LEFT(a.query, ${ACTIVITY_QUERY_TEXT_LENGTH}) AS query
         FROM pg_stat_activity a
         WHERE a.backend_type = 'client backend'
           AND a.state IS NOT NULL
           AND a.state <> 'idle'
           AND a.pid <> pg_backend_pid()
         ORDER BY a.query_start ASC NULLS LAST
         LIMIT 20`,
      );

      result["activeQueries"] = activityRows.map(
        (row: (typeof activityRows)[number]): JSONObject => {
          return {
            pid: toNumberOrNull(row.pid),
            username: row.username ? String(row.username) : null,
            applicationName: row.application_name
              ? String(row.application_name)
              : null,
            clientAddr: row.client_addr ? String(row.client_addr) : null,
            state: row.state ? String(row.state) : null,
            waitEventType: row.wait_event_type
              ? String(row.wait_event_type)
              : null,
            waitEvent: row.wait_event ? String(row.wait_event) : null,
            queryAgeSeconds: toNumberOrNull(row.query_age_seconds),
            transactionAgeSeconds: toNumberOrNull(row.transaction_age_seconds),
            query: row.query ? String(row.query) : null,
          };
        },
      );
    } catch (err) {
      logger.debug("AdminHealth: postgres active-query probe failed");
      logger.debug(err);
    }

    /*
     * 2. Lock blocking pairs — each blocked session joined to every session
     * blocking it, so a lock convoy reads as "PID a waits on PID b" with both
     * statements visible. unnest(pg_blocking_pids()) produces no rows for
     * unblocked sessions, so this is empty on a healthy instance.
     */
    try {
      const blockedRows: Array<{
        blocked_pid: string;
        blocked_user: string | null;
        blocked_for_seconds: string | null;
        blocked_query: string | null;
        blocking_pid: string;
        blocking_user: string | null;
        blocking_state: string | null;
        blocking_query: string | null;
      }> = await dataSource.query(
        `SELECT
           blocked.pid AS blocked_pid,
           blocked.usename AS blocked_user,
           ROUND(EXTRACT(EPOCH FROM (now() - blocked.query_start))) AS blocked_for_seconds,
           LEFT(blocked.query, ${ACTIVITY_QUERY_TEXT_LENGTH}) AS blocked_query,
           blocker.pid AS blocking_pid,
           blocker.usename AS blocking_user,
           blocker.state AS blocking_state,
           LEFT(blocker.query, ${ACTIVITY_QUERY_TEXT_LENGTH}) AS blocking_query
         FROM pg_stat_activity blocked
         JOIN LATERAL unnest(pg_blocking_pids(blocked.pid)) AS b(pid) ON true
         JOIN pg_stat_activity blocker ON blocker.pid = b.pid
         ORDER BY blocked_for_seconds DESC NULLS LAST
         LIMIT 10`,
      );

      result["blockedSessions"] = blockedRows.map(
        (row: (typeof blockedRows)[number]): JSONObject => {
          return {
            blockedPid: toNumberOrNull(row.blocked_pid),
            blockedUser: row.blocked_user ? String(row.blocked_user) : null,
            blockedForSeconds: toNumberOrNull(row.blocked_for_seconds),
            blockedQuery: row.blocked_query ? String(row.blocked_query) : null,
            blockingPid: toNumberOrNull(row.blocking_pid),
            blockingUser: row.blocking_user ? String(row.blocking_user) : null,
            blockingState: row.blocking_state
              ? String(row.blocking_state)
              : null,
            blockingQuery: row.blocking_query
              ? String(row.blocking_query)
              : null,
          };
        },
      );
    } catch (err) {
      logger.debug("AdminHealth: postgres blocking probe failed");
      logger.debug(err);
    }

    /*
     * 3. Cumulative statement statistics. pg_stat_statements needs both
     * CREATE EXTENSION and shared_preload_libraries, and querying the view is
     * the only check that covers both — so probe by querying and treat any
     * failure as "not installed" (the dashboard then shows setup instructions
     * instead of an error).
     */
    try {
      const statementRows: Array<{
        query: string | null;
        calls: string;
        total_ms: string | null;
        mean_ms: string | null;
        max_ms: string | null;
        rows: string;
        cache_hit_ratio: string | null;
      }> = await dataSource.query(
        `SELECT
           LEFT(s.query, ${ACTIVITY_QUERY_TEXT_LENGTH}) AS query,
           s.calls,
           ROUND(s.total_exec_time::numeric) AS total_ms,
           ROUND(s.mean_exec_time::numeric, 2) AS mean_ms,
           ROUND(s.max_exec_time::numeric) AS max_ms,
           s.rows,
           CASE WHEN (s.shared_blks_hit + s.shared_blks_read) > 0
                THEN ROUND(s.shared_blks_hit::numeric / (s.shared_blks_hit + s.shared_blks_read) * 100, 1)
                ELSE NULL END AS cache_hit_ratio
         FROM pg_stat_statements s
         JOIN pg_database d ON d.oid = s.dbid
         WHERE d.datname = current_database()
         ORDER BY s.total_exec_time DESC
         LIMIT 10`,
      );

      result["statementsAvailable"] = true;
      result["topStatements"] = statementRows.map(
        (row: (typeof statementRows)[number]): JSONObject => {
          return {
            query: row.query ? String(row.query) : null,
            calls: toNumberOrNull(row.calls),
            totalMilliseconds: toNumberOrNull(row.total_ms),
            meanMilliseconds: toNumberOrNull(row.mean_ms),
            maxMilliseconds: toNumberOrNull(row.max_ms),
            rows: toNumberOrNull(row.rows),
            cacheHitRatio: toNumberOrNull(row.cache_hit_ratio),
          };
        },
      );
    } catch (err) {
      logger.debug(
        "AdminHealth: pg_stat_statements unavailable (extension not installed?)",
      );
      logger.debug(err);
    }

    // 4. Vacuum / autovacuum progress — pairs with the dead-tuple hotspots list.
    try {
      const vacuumRows: Array<{
        pid: string;
        table_name: string | null;
        phase: string | null;
        heap_blks_total: string | null;
        heap_blks_scanned: string | null;
        percent_scanned: string | null;
      }> = await dataSource.query(
        `SELECT
           p.pid,
           c.relname AS table_name,
           p.phase,
           p.heap_blks_total,
           p.heap_blks_scanned,
           CASE WHEN p.heap_blks_total > 0
                THEN ROUND(p.heap_blks_scanned::numeric / p.heap_blks_total * 100, 1)
                ELSE NULL END AS percent_scanned
         FROM pg_stat_progress_vacuum p
         LEFT JOIN pg_class c ON c.oid = p.relid
         WHERE p.datname = current_database()`,
      );

      result["vacuumProgress"] = vacuumRows.map(
        (row: (typeof vacuumRows)[number]): JSONObject => {
          return {
            pid: toNumberOrNull(row.pid),
            tableName: row.table_name ? String(row.table_name) : null,
            phase: row.phase ? String(row.phase) : null,
            heapBlocksTotal: toNumberOrNull(row.heap_blks_total),
            heapBlocksScanned: toNumberOrNull(row.heap_blks_scanned),
            percentScanned: toNumberOrNull(row.percent_scanned),
          };
        },
      );
    } catch (err) {
      logger.debug("AdminHealth: pg_stat_progress_vacuum probe failed");
      logger.debug(err);
    }
  } catch (err) {
    logger.error("AdminHealth: failed to read Postgres activity");
    logger.error(err);
  }

  return result;
}

/*
 * The same three windows split per tenant, for the Telemetry diagnostics page.
 * ClickHouse only knows tenants by id, so the project names are resolved here
 * against Postgres — in ONE query over exactly the ids that reported ingestion,
 * never a full project listing. A project deleted while its telemetry is still
 * inside the retention window resolves to no name and is labelled by id, so it
 * still shows up against the volume it is still responsible for.
 */
export async function getClickhouseTelemetryIngestionByProject(): Promise<JSONObject> {
  const ingestion: TelemetryProjectIngestionResult =
    await getTelemetryIngestionByProject();

  const projectIds: Array<string> = ingestion.projects.map(
    (project: TelemetryProjectIngestion): string => {
      return project.projectId;
    },
  );

  const namesByProjectId: Map<string, string> = new Map<string, string>();

  if (projectIds.length > 0) {
    try {
      const projects: Array<Project> = await ProjectService.findBy({
        query: {
          _id: QueryHelper.any(projectIds),
        },
        select: {
          _id: true,
          name: true,
        },
        skip: 0,
        limit: LIMIT_MAX,
        props: {
          isRoot: true,
        },
      });

      for (const project of projects) {
        if (project.id && project.name) {
          namesByProjectId.set(project.id.toString(), project.name);
        }
      }
    } catch (err) {
      /*
       * Names are a nicety; the volumes are the point. A Postgres hiccup leaves
       * every row labelled by project id rather than failing the whole page.
       */
      logger.error("AdminHealth: failed to resolve telemetry project names");
      logger.error(err);
    }
  }

  return {
    connected: ingestion.connected,
    truncated: ingestion.truncated,
    maxProjectsPerSignal: MAX_PROJECTS_PER_SIGNAL,
    signals: ingestion.signals,
    projects: attachProjectNames(ingestion.projects, namesByProjectId),
  } as unknown as JSONObject;
}

/*
 * Registers the dashboard routes on the enterprise admin-health router. They
 * are routes only - never router.use() - because that router is mounted
 * ahead of core's, where a path-less middleware would run for every core
 * health request too.
 */
export function registerHealthDashboardRoutes(router: ExpressRouter): void {
  router.get(
    "/overview",
    MasterAdminAuthorization.isAuthorizedMasterAdminOrMasterApiKeyMiddleware,
    async (
      req: ExpressRequest,
      res: ExpressResponse,
      next: NextFunction,
    ): Promise<void> => {
      try {
        await EnterpriseEdition.assertFeatureAvailable(
          EnterpriseFeature.InstanceHealth,
        );

        if (overviewCache && overviewCache.expiresAt > Date.now()) {
          return Response.sendJsonObjectResponse(req, res, overviewCache.data);
        }

        const summary: JSONObject = await getHealthSummary();

        const data: JSONObject = { summary };

        overviewCache = {
          data,
          expiresAt: Date.now() + CACHE_TTL_MS,
        };

        return Response.sendJsonObjectResponse(req, res, data);
      } catch (err) {
        return next(err);
      }
    },
  );

  /*
   * Full per-queue background-queue stats for the dedicated Background Queues
   * page. The overview above only carries the compact queue roll-up, so the drill
   * -in page reads the detailed breakdown here. Cached like the overview since the
   * introspection crosses Redis.
   */
  router.get(
    "/queues",
    MasterAdminAuthorization.isAuthorizedMasterAdminOrMasterApiKeyMiddleware,
    async (
      req: ExpressRequest,
      res: ExpressResponse,
      next: NextFunction,
    ): Promise<void> => {
      try {
        await EnterpriseEdition.assertFeatureAvailable(
          EnterpriseFeature.InstanceHealth,
        );

        if (queuesCache && queuesCache.expiresAt > Date.now()) {
          return Response.sendJsonObjectResponse(req, res, queuesCache.data);
        }

        const queues: JSONArray = await getQueueStats();

        const data: JSONObject = { queues };

        queuesCache = {
          data,
          expiresAt: Date.now() + CACHE_TTL_MS,
        };

        return Response.sendJsonObjectResponse(req, res, data);
      } catch (err) {
        return next(err);
      }
    },
  );

  router.get(
    "/redis",
    MasterAdminAuthorization.isAuthorizedMasterAdminOrMasterApiKeyMiddleware,
    async (
      req: ExpressRequest,
      res: ExpressResponse,
      next: NextFunction,
    ): Promise<void> => {
      try {
        await EnterpriseEdition.assertFeatureAvailable(
          EnterpriseFeature.InstanceHealth,
        );

        return Response.sendJsonObjectResponse(req, res, await getRedisStats());
      } catch (err) {
        return next(err);
      }
    },
  );

  /*
   * Recent failed jobs for a single queue, fetched on demand by the health
   * dashboard when an operator expands a queue. Like the overview it backs, it is
   * an Enterprise Edition feature and master-admin only. Each job includes its
   * full (redacted, size-capped) body, options, return value and per-job logs for
   * debugging — see redactFullFailedJob. Sensitive-looking fields and credential
   * patterns are scrubbed, but the body can still contain customer data.
   */
  router.get(
    "/queues/:queueName/failed-jobs",
    MasterAdminAuthorization.isAuthorizedMasterAdminOrMasterApiKeyMiddleware,
    async (
      req: ExpressRequest,
      res: ExpressResponse,
      next: NextFunction,
    ): Promise<void> => {
      try {
        await EnterpriseEdition.assertFeatureAvailable(
          EnterpriseFeature.InstanceHealth,
        );

        const requestedQueue: string = String(req.params["queueName"]);

        // Only allow the known queue names — never feed arbitrary input to BullMQ.
        const queueName: QueueName | undefined = SUPPORT_QUEUE_NAMES.find(
          (name: QueueName): boolean => {
            return name === requestedQueue;
          },
        );

        if (!queueName) {
          throw new BadDataException(`Unknown queue: ${requestedQueue}`);
        }

        const [stats, failedJobs] = await Promise.all([
          Queue.getQueueStats(queueName),
          getFailedJobsForQueue(queueName),
        ]);

        return Response.sendJsonObjectResponse(req, res, {
          name: queueName,
          stats,
          failedJobs,
        });
      } catch (err) {
        return next(err);
      }
    },
  );

  /*
   * Diagnostic logs for the health dashboard: this app instance's own recent log
   * lines plus what we can read from the datastores (Postgres log tail when
   * collected, ClickHouse system-table errors/logs, Redis SLOWLOG + counters).
   * Enterprise Edition + master-admin only, matching the overview it sits beside.
   * Everything is scrubbed for credentials but logs can contain customer data.
   */
  router.get(
    "/logs",
    MasterAdminAuthorization.isAuthorizedMasterAdminOrMasterApiKeyMiddleware,
    async (
      req: ExpressRequest,
      res: ExpressResponse,
      next: NextFunction,
    ): Promise<void> => {
      try {
        await EnterpriseEdition.assertFeatureAvailable(
          EnterpriseFeature.InstanceHealth,
        );

        const data: JSONObject = await getDiagnosticLogs();
        return Response.sendJsonObjectResponse(req, res, data);
      } catch (err) {
        return next(err);
      }
    },
  );

  /*
   * ClickHouse cluster health for the dashboard: shard reachability, the
   * distributed-DDL queue, replica / replication-queue state and the Keeper
   * connection — the signals that reveal a wedged ON CLUSTER schema sync (where
   * the migrate Job or boot schema-sync times
   * out because a DDL task never finishes on some shards). Enterprise Edition +
   * master-admin only, like the overview and logs beside it. Reuses the support
   * bundle's diagnostics so the dashboard and the downloaded bundle never disagree.
   */
  router.get(
    "/clickhouse-cluster",
    MasterAdminAuthorization.isAuthorizedMasterAdminOrMasterApiKeyMiddleware,
    async (
      req: ExpressRequest,
      res: ExpressResponse,
      next: NextFunction,
    ): Promise<void> => {
      try {
        await EnterpriseEdition.assertFeatureAvailable(
          EnterpriseFeature.InstanceHealth,
        );

        const diagnostics: JSONObject = await getClickhouseDiagnostics();
        const clusterHealth: JSONObject = (diagnostics["clusterHealth"] ||
          {}) as JSONObject;

        return Response.sendJsonObjectResponse(req, res, {
          connected: Boolean(diagnostics["connected"]),
          ...clusterHealth,
        });
      } catch (err) {
        return next(err);
      }
    },
  );

  /*
   * Telemetry ingestion rate for the dashboard: how many log / metric / trace rows
   * landed in ClickHouse over the last minute, hour and day, so an operator can
   * see the live ingestion throughput and spot a stalled or flooding pipeline.
   * Enterprise Edition + master-admin only, like the ClickHouse cluster endpoint
   * beside it. Counts only — no telemetry row data leaves the process.
   */
  router.get(
    "/clickhouse-telemetry-ingestion",
    MasterAdminAuthorization.isAuthorizedMasterAdminOrMasterApiKeyMiddleware,
    async (
      req: ExpressRequest,
      res: ExpressResponse,
      next: NextFunction,
    ): Promise<void> => {
      try {
        await EnterpriseEdition.assertFeatureAvailable(
          EnterpriseFeature.InstanceHealth,
        );

        const data: JSONObject = await getClickhouseTelemetryIngestion();
        return Response.sendJsonObjectResponse(req, res, data);
      } catch (err) {
        return next(err);
      }
    },
  );

  /*
   * Telemetry ingestion split by project, for the Telemetry diagnostics page:
   * which tenants are sending logs, metrics and traces, and how much of each over
   * the last minute, hour and day. Counts and project names only — no telemetry
   * row data. Same Enterprise Edition + master-admin gate as the by-signal
   * endpoint above.
   */
  router.get(
    "/clickhouse-telemetry-ingestion-by-project",
    MasterAdminAuthorization.isAuthorizedMasterAdminOrMasterApiKeyMiddleware,
    async (
      req: ExpressRequest,
      res: ExpressResponse,
      next: NextFunction,
    ): Promise<void> => {
      try {
        await EnterpriseEdition.assertFeatureAvailable(
          EnterpriseFeature.InstanceHealth,
        );

        const data: JSONObject =
          await getClickhouseTelemetryIngestionByProject();
        return Response.sendJsonObjectResponse(req, res, data);
      } catch (err) {
        return next(err);
      }
    },
  );

  /*
   * Postgres cluster health for the dashboard: streaming-replication lag, slot
   * health, connection saturation, lock/blocking pressure, cache-hit ratio and
   * transaction-ID wraparound headroom — the signals behind a failed
   * CloudNativePG failover or a stalled primary. Enterprise Edition + master-admin
   * only, like the ClickHouse cluster endpoint beside it. Reuses the same probe
   * used by the support bundle so the dashboard and the downloaded bundle agree.
   */
  router.get(
    "/postgres-cluster",
    MasterAdminAuthorization.isAuthorizedMasterAdminOrMasterApiKeyMiddleware,
    async (
      req: ExpressRequest,
      res: ExpressResponse,
      next: NextFunction,
    ): Promise<void> => {
      try {
        await EnterpriseEdition.assertFeatureAvailable(
          EnterpriseFeature.InstanceHealth,
        );

        const data: JSONObject = await getPostgresClusterHealth();
        return Response.sendJsonObjectResponse(req, res, data);
      } catch (err) {
        return next(err);
      }
    },
  );

  /*
   * Live Postgres activity for the dashboard: running queries, lock blocking
   * pairs, pg_stat_statements and vacuum progress. This is the only health GET
   * endpoint that returns statement text (see getPostgresActivity), so — like
   * the query console routes (./QueryConsole.ts) — it stays on the JWT-only
   * middleware (no static master API key) and is intentionally excluded from
   * both the downloadable support bundle and the master-admin API docs.
   */
  router.get(
    "/postgres-activity",
    MasterAdminAuthorization.isAuthorizedMasterAdminMiddleware,
    async (
      req: ExpressRequest,
      res: ExpressResponse,
      next: NextFunction,
    ): Promise<void> => {
      try {
        await EnterpriseEdition.assertFeatureAvailable(
          EnterpriseFeature.InstanceHealth,
        );

        const data: JSONObject = await getPostgresActivity();
        return Response.sendJsonObjectResponse(req, res, data);
      } catch (err) {
        return next(err);
      }
    },
  );
}

// A router serving the dashboards alone.
export function createHealthDashboardsRouter(): ExpressRouter {
  const router: ExpressRouter = Express.getRouter();
  registerHealthDashboardRoutes(router);
  return router;
}
