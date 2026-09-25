import Metric from "Common/Models/AnalyticsModels/Metric";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import Includes from "Common/Types/BaseDatabase/Includes";
import OneUptimeDate from "Common/Types/Date";
import {
  DATABASE_SERVER_ID_SCOPE_ATTRIBUTE,
  getDatabaseAlertTemplates,
} from "Common/Types/Monitor/DatabaseAlertTemplates";
import ObjectID from "Common/Types/ObjectID";
import AnalyticsModelAPI, {
  ListResult,
} from "Common/UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI";
import { keyForDatabaseServerRow } from "Common/Utils/Telemetry/EntityKey";

/*
 * Whether a database's recommended monitors would ever see a point: has
 * any metric they read arrived stamped with the database's id?
 *
 * The recommended monitors (DatabaseAlertTemplates) read one collector
 * receiver's metric names, each filtered on `oneuptime.database.server.id`.
 * The database row's collector heartbeat (collectorLastSeenAt) is no proof
 * of those: ingest stamps it for ANY batch it attributes to the row — the
 * database's logs, a postgres_exporter, a MongoDB Atlas database reported
 * by the `mongodbatlas` receiver (whose engine is MongoDB, but which sends
 * `mongodbatlas.*`, never the `mongodb.*` the MongoDB monitors read). On
 * such a database "Engine Metrics Stopped" opens a Critical incident ten
 * minutes after it is created and never clears. So the Recommendations tab
 * asks the telemetry itself — ONE row, the exact filter the monitors use —
 * before it offers them.
 *
 * The row key (every row stamped with the id also carries it) narrows the
 * read through the entity-key skip index; the id attribute keeps it exact.
 */

// How far back an arrived metric counts — past the default retention.
export const DATABASE_ENGINE_METRICS_LOOKBACK_DAYS: number = 30;

/** Every metric name the engine's recommended monitors read, deduplicated. */
export function getDatabaseRecommendationMetricNames(
  engine: string | null | undefined,
): Array<string> {
  const names: Array<string> = [];
  for (const template of getDatabaseAlertTemplates(engine || "")) {
    for (const metricName of template.metricNames) {
      const name: string = (metricName || "").trim();
      if (name && !names.includes(name)) {
        names.push(name);
      }
    }
  }
  return names;
}

/** The collector receivers whose metrics the engine's monitors read. */
export function getDatabaseRecommendationReceivers(
  engine: string | null | undefined,
): Array<string> {
  const receivers: Array<string> = [];
  for (const template of getDatabaseAlertTemplates(engine || "")) {
    if (template.receiver && !receivers.includes(template.receiver)) {
      receivers.push(template.receiver);
    }
  }
  return receivers;
}

function idText(value: unknown): string {
  if (value instanceof ObjectID) {
    return value.toString().trim();
  }
  return typeof value === "string" ? value.trim() : "";
}

/**
 * The Metric query for one point of the engine's recommended-monitor
 * metrics stamped with the database's id in the lookback window, or null
 * when there is nothing to ask (no project, no id, no templates).
 */
export function buildDatabaseEngineMetricsProbeQuery(data: {
  projectId: unknown;
  databaseServerId: unknown;
  engine: string | null | undefined;
  now: Date;
}): Record<string, unknown> | null {
  const projectId: string = idText(data.projectId);
  const databaseServerId: string = idText(data.databaseServerId);
  const metricNames: Array<string> = getDatabaseRecommendationMetricNames(
    data.engine,
  );
  if (!projectId || !databaseServerId || metricNames.length === 0) {
    return null;
  }

  return {
    projectId: new ObjectID(projectId),
    time: new InBetween<Date>(
      OneUptimeDate.addRemoveDays(
        data.now,
        -DATABASE_ENGINE_METRICS_LOOKBACK_DAYS,
      ),
      data.now,
    ),
    name:
      metricNames.length === 1 ? metricNames[0]! : new Includes(metricNames),
    entityKeys: new Includes([
      keyForDatabaseServerRow(projectId, databaseServerId),
    ]),
    attributes: { [DATABASE_SERVER_ID_SCOPE_ATTRIBUTE]: databaseServerId },
  };
}

/**
 * True when a metric the engine's recommended monitors read has arrived
 * stamped with the database's id in the lookback window, false when none
 * has, null when it cannot be told (nothing to ask, or the read failed) —
 * an unknown is never held against the database.
 */
export async function fetchDatabaseEngineMetricsArrived(data: {
  projectId: unknown;
  databaseServerId: unknown;
  engine: string | null | undefined;
}): Promise<boolean | null> {
  const query: Record<string, unknown> | null =
    buildDatabaseEngineMetricsProbeQuery({
      ...data,
      now: OneUptimeDate.getCurrentDate(),
    });
  if (!query) {
    return null;
  }
  try {
    const result: ListResult<Metric> = await AnalyticsModelAPI.getList<Metric>({
      modelType: Metric,
      query: query,
      select: { time: true },
      sort: {},
      skip: 0,
      limit: 1,
    });
    return (result.data || []).length > 0;
  } catch {
    return null;
  }
}
