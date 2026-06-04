import { ClickhouseAppInstance } from "Common/Server/Infrastructure/ClickhouseDatabase";
import PostgresAppInstance from "Common/Server/Infrastructure/PostgresDatabase";
import Redis from "Common/Server/Infrastructure/Redis";
import Queue, { QueueName } from "Common/Server/Infrastructure/Queue";
import MasterAdminAuthorization from "Common/Server/Middleware/MasterAdminAuthorization";
import IncidentService from "Common/Server/Services/IncidentService";
import MonitorService from "Common/Server/Services/MonitorService";
import ProjectService from "Common/Server/Services/ProjectService";
import UserService from "Common/Server/Services/UserService";
import Express, {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  NextFunction,
} from "Common/Server/Utils/Express";
import logger from "Common/Server/Utils/Logger";
import Response from "Common/Server/Utils/Response";
import { JSONArray, JSONObject } from "Common/Types/JSON";

const router: ExpressRouter = Express.getRouter();

/*
 * The overview aggregates several DB-introspection queries. Master-admin
 * traffic is low-volume, but the page polls, so we cache the result briefly to
 * keep the queries off the datastores on every refresh.
 */
const CACHE_TTL_MS: number = 15000;
let overviewCache: { data: JSONObject; expiresAt: number } | null = null;

type ClickhouseJsonResult = { data: Array<JSONObject> };

// Parse a possibly-bigint-as-string value (Postgres/ClickHouse return UInt64/bigint as strings in JSON).
function toNumberOrNull(value: unknown): number | null {
  if (value === null || value === undefined) {
    return null;
  }
  const parsed: number = Number(value);
  return isNaN(parsed) ? null : parsed;
}

async function getPostgresStats(): Promise<JSONObject> {
  const result: JSONObject = {
    connected: false,
    databaseSizeInBytes: null,
  };

  try {
    const dataSource: ReturnType<typeof PostgresAppInstance.getDataSource> =
      PostgresAppInstance.getDataSource();

    if (!dataSource) {
      return result;
    }

    const rows: Array<{ size: string }> = await dataSource.query(
      "SELECT pg_database_size(current_database()) AS size",
    );

    result["connected"] = true;
    result["databaseSizeInBytes"] = toNumberOrNull(rows?.[0]?.size);
  } catch (err) {
    logger.error("AdminHealth: failed to read Postgres stats");
    logger.error(err);
  }

  return result;
}

async function getClickhouseStats(): Promise<JSONObject> {
  const result: JSONObject = {
    connected: false,
    dataSizeInBytes: null,
    diskFreeInBytes: null,
    diskTotalInBytes: null,
    topTables: [],
  };

  try {
    const client: ReturnType<typeof ClickhouseAppInstance.getDataSource> =
      ClickhouseAppInstance.getDataSource();

    if (!client) {
      return result;
    }

    // Total size of active parts on disk.
    const sizeResult: ClickhouseJsonResult = (await (
      await client.query({
        query:
          "SELECT sum(bytes_on_disk) AS bytes FROM system.parts WHERE active",
        format: "JSON",
      })
    ).json()) as ClickhouseJsonResult;

    result["connected"] = true;
    result["dataSizeInBytes"] = toNumberOrNull(sizeResult.data?.[0]?.["bytes"]);

    // Underlying volume free/total capacity.
    const diskResult: ClickhouseJsonResult = (await (
      await client.query({
        query:
          "SELECT sum(free_space) AS free, sum(total_space) AS total FROM system.disks",
        format: "JSON",
      })
    ).json()) as ClickhouseJsonResult;

    result["diskFreeInBytes"] = toNumberOrNull(diskResult.data?.[0]?.["free"]);
    result["diskTotalInBytes"] = toNumberOrNull(
      diskResult.data?.[0]?.["total"],
    );

    // Largest tables (usually the telemetry tables) so operators can see what consumes space.
    const tablesResult: ClickhouseJsonResult = (await (
      await client.query({
        query:
          "SELECT table AS name, sum(bytes_on_disk) AS bytes FROM system.parts WHERE active GROUP BY table ORDER BY bytes DESC LIMIT 8",
        format: "JSON",
      })
    ).json()) as ClickhouseJsonResult;

    result["topTables"] = (tablesResult.data || []).map(
      (row: JSONObject): JSONObject => {
        return {
          name: String(row["name"]),
          sizeInBytes: toNumberOrNull(row["bytes"]),
        };
      },
    );
  } catch (err) {
    logger.error("AdminHealth: failed to read ClickHouse stats");
    logger.error(err);
  }

  return result;
}

// Read a single integer field out of the Redis INFO memory section.
function parseRedisInfoValue(info: string, key: string): number | null {
  const line: string | undefined = info
    .split(/\r?\n/)
    .find((current: string): boolean => {
      return current.startsWith(`${key}:`);
    });

  if (!line) {
    return null;
  }

  return toNumberOrNull(line.split(":")[1]);
}

async function getRedisStats(): Promise<JSONObject> {
  const result: JSONObject = {
    connected: false,
    usedMemoryInBytes: null,
    maxMemoryInBytes: null,
  };

  try {
    const client: ReturnType<typeof Redis.getClient> = Redis.getClient();

    if (!client || !Redis.isConnected()) {
      return result;
    }

    const info: string = await client.info("memory");

    result["connected"] = true;
    result["usedMemoryInBytes"] = parseRedisInfoValue(info, "used_memory");
    result["maxMemoryInBytes"] = parseRedisInfoValue(info, "maxmemory");
  } catch (err) {
    logger.error("AdminHealth: failed to read Redis stats");
    logger.error(err);
  }

  return result;
}

async function getQueueStats(): Promise<JSONArray> {
  const queueNames: Array<QueueName> = [
    QueueName.Workflow,
    QueueName.Worker,
    QueueName.Telemetry,
    QueueName.Runbook,
  ];

  const stats: JSONArray = [];

  for (const queueName of queueNames) {
    try {
      const queueStats: {
        waiting: number;
        active: number;
        completed: number;
        failed: number;
        delayed: number;
        total: number;
      } = await Queue.getQueueStats(queueName);

      stats.push({
        name: queueName,
        waiting: queueStats.waiting,
        active: queueStats.active,
        completed: queueStats.completed,
        failed: queueStats.failed,
        delayed: queueStats.delayed,
        total: queueStats.total,
        error: false,
      });
    } catch (err) {
      logger.error(`AdminHealth: failed to read queue stats for ${queueName}`);
      logger.error(err);
      stats.push({ name: queueName, error: true });
    }
  }

  return stats;
}

async function getCounts(): Promise<JSONObject> {
  const result: JSONObject = {
    projects: null,
    users: null,
    monitors: null,
    incidents: null,
  };

  try {
    const [projects, users, monitors, incidents] = await Promise.all([
      ProjectService.countBy({ query: {}, props: { isRoot: true } }),
      UserService.countBy({ query: {}, props: { isRoot: true } }),
      MonitorService.countBy({ query: {}, props: { isRoot: true } }),
      IncidentService.countBy({ query: {}, props: { isRoot: true } }),
    ]);

    result["projects"] = projects.toNumber();
    result["users"] = users.toNumber();
    result["monitors"] = monitors.toNumber();
    result["incidents"] = incidents.toNumber();
  } catch (err) {
    logger.error("AdminHealth: failed to read instance counts");
    logger.error(err);
  }

  return result;
}

router.get(
  "/overview",
  MasterAdminAuthorization.isAuthorizedMasterAdminMiddleware,
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      if (overviewCache && overviewCache.expiresAt > Date.now()) {
        return Response.sendJsonObjectResponse(req, res, overviewCache.data);
      }

      const [postgres, clickhouse, redis, queues, counts] = await Promise.all([
        getPostgresStats(),
        getClickhouseStats(),
        getRedisStats(),
        getQueueStats(),
        getCounts(),
      ]);

      const data: JSONObject = {
        postgres,
        clickhouse,
        redis,
        queues,
        counts,
      };

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

export default router;
