import { CloudAddedMetric } from "../../../Types/Cloud/CloudAddedMetrics";
import { CloudProvider } from "../../../Types/Cloud/CloudPlatform";
import MonitorType from "../../../Types/Monitor/MonitorType";
import ObjectID from "../../../Types/ObjectID";
import { findRetiredCloudMetricQueriesOfDashboard } from "../../../Utils/Metrics/RetiredCloudMetricChartMoves";
import {
  RetiredCloudMetricQuery,
  findRetiredCloudMetricQueries,
} from "../../../Utils/Metrics/RetiredCloudMetricMoves";
import { getRetiredCloudMetricReads } from "../../../Utils/Metrics/RetiredCloudMetricReads";
import DashboardService from "../../Services/DashboardService";
import MonitorService from "../../Services/MonitorService";

/*
 * WHICH DEPRECATED METRICS A PROJECT'S CONNECTIONS STILL READ, AND OF WHAT
 * (RetiredCloudMetricReads, #9739's gap).
 *
 * A Metrics monitor or a dashboard's widget still on Cosmos DB's
 * ServerSideLatency or Pub/Sub's send_message_operation_count - one the
 * moves could not move yet - keeps the metric read of the resources it
 * reads, so it is never left with nothing new to judge or draw. Found from
 * the project's monitors and dashboards whose stored queries name one (a
 * LIKE on their JSON, then the queries themselves), at most
 * CLOUD_RETIRED_READ_SOURCES_MAX of each, and kept for
 * CLOUD_RETIRED_READS_MEMO_MS: a connection read every few minutes asks
 * Postgres once in that time, and a monitor moved or saved is read as it is
 * within it.
 *
 * Only Azure's and Google Cloud's connections read either; any other's
 * gets none, and asks nothing.
 */

export const CLOUD_RETIRED_READS_MEMO_MS: number = 10 * 60 * 1000;
export const CLOUD_RETIRED_READ_SOURCES_MAX: number = 1000;
// Projects whose reads are kept at once, at most: past it, the oldest go.
export const CLOUD_RETIRED_READS_MEMO_MAX_PROJECTS: number = 5000;

/*
 * What a stored query's text holds when it may name one: wide on purpose,
 * as the moves' own are (an ILIKE, "_" any one character); which query
 * reads a deprecated metric is the module's to say.
 */
export const NAMES_RETIRED_PUBSUB_METRIC: string =
  "%send_message_operation_count%";
export const NAMES_RETIRED_COSMOS_METRIC: string = "%serversidelatency\\_%";

// The providers whose connections read a deprecated metric for what still reads it.
const PROVIDERS_WITH_RETIRED_READS: ReadonlySet<string> = new Set<string>([
  CloudProvider.Azure,
  CloudProvider.GCP,
]);

export type RetiredCloudMetricQueryFinder = (data: {
  projectId: ObjectID;
}) => Promise<Array<RetiredCloudMetricQuery>>;

interface MemoEntry {
  at: number;
  reads: Array<CloudAddedMetric>;
}

const memo: Map<string, MemoEntry> = new Map<string, MemoEntry>();

function readJSON(value: unknown): unknown {
  if (typeof value !== "string") {
    return value;
  }

  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

/*
 * Every query of a deprecated metric in the project's Metrics monitors and
 * dashboards: the ones not deleted whose stored JSON names one.
 */
export async function findRetiredCloudMetricQueriesOfProject(data: {
  projectId: ObjectID;
}): Promise<Array<RetiredCloudMetricQuery>> {
  const monitors: Array<{ monitorSteps: unknown }> =
    (await MonitorService.getRepository().manager.query(
      `SELECT "monitorSteps" FROM "Monitor" WHERE "projectId" = $1 AND "deletedAt" IS NULL AND "monitorType" = $2 AND "monitorSteps" IS NOT NULL AND ("monitorSteps"::text ILIKE $3 OR "monitorSteps"::text ILIKE $4) LIMIT $5`,
      [
        data.projectId.toString(),
        MonitorType.Metrics,
        NAMES_RETIRED_PUBSUB_METRIC,
        NAMES_RETIRED_COSMOS_METRIC,
        CLOUD_RETIRED_READ_SOURCES_MAX,
      ],
    )) as Array<{ monitorSteps: unknown }>;
  const dashboards: Array<{ dashboardViewConfig: unknown }> =
    (await DashboardService.getRepository().manager.query(
      `SELECT "dashboardViewConfig" FROM "Dashboard" WHERE "projectId" = $1 AND "deletedAt" IS NULL AND "dashboardViewConfig" IS NOT NULL AND ("dashboardViewConfig"::text ILIKE $2 OR "dashboardViewConfig"::text ILIKE $3) LIMIT $4`,
      [
        data.projectId.toString(),
        NAMES_RETIRED_PUBSUB_METRIC,
        NAMES_RETIRED_COSMOS_METRIC,
        CLOUD_RETIRED_READ_SOURCES_MAX,
      ],
    )) as Array<{ dashboardViewConfig: unknown }>;

  return [
    ...(monitors || []).flatMap(
      (row: { monitorSteps: unknown }): Array<RetiredCloudMetricQuery> => {
        return findRetiredCloudMetricQueries(readJSON(row.monitorSteps));
      },
    ),
    ...(dashboards || []).flatMap(
      (row: {
        dashboardViewConfig: unknown;
      }): Array<RetiredCloudMetricQuery> => {
        return findRetiredCloudMetricQueriesOfDashboard(
          readJSON(row.dashboardViewConfig),
        );
      },
    ),
  ];
}

export default class CloudRetiredMetricReads {
  // What finds a project's queries of a deprecated metric; replaced in tests.
  public static findQueries: RetiredCloudMetricQueryFinder =
    findRetiredCloudMetricQueriesOfProject;

  /*
   * What a connection of the project reads besides its key metrics, for
   * what still reads a deprecated metric: none for a provider that reads
   * neither. Kept for CLOUD_RETIRED_READS_MEMO_MS.
   */
  public static async find(data: {
    projectId: ObjectID;
    provider: CloudProvider | string | undefined;
    now: Date;
  }): Promise<Array<CloudAddedMetric>> {
    if (!data.provider || !PROVIDERS_WITH_RETIRED_READS.has(data.provider)) {
      return [];
    }

    const key: string = data.projectId.toString();
    const known: MemoEntry | undefined = memo.get(key);
    const now: number = data.now.getTime();

    if (
      known &&
      now - known.at >= 0 &&
      now - known.at < CLOUD_RETIRED_READS_MEMO_MS
    ) {
      return known.reads.filter((read: CloudAddedMetric): boolean => {
        return read.provider === data.provider;
      });
    }

    const reads: Array<CloudAddedMetric> = getRetiredCloudMetricReads(
      await CloudRetiredMetricReads.findQueries({ projectId: data.projectId }),
    );

    memo.delete(key);

    if (memo.size >= CLOUD_RETIRED_READS_MEMO_MAX_PROJECTS) {
      const oldest: string | undefined = memo.keys().next().value;

      if (oldest !== undefined) {
        memo.delete(oldest);
      }
    }

    memo.set(key, { at: now, reads });

    return reads.filter((read: CloudAddedMetric): boolean => {
      return read.provider === data.provider;
    });
  }

  // A project's reads are found again at its next read: a query just moved, or saved.
  public static forget(projectId?: ObjectID | undefined): void {
    if (projectId) {
      memo.delete(projectId.toString());
      return;
    }

    memo.clear();
  }
}
