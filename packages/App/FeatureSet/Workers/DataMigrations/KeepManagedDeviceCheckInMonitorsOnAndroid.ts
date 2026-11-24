import DataMigrationBase from "./DataMigrationBase";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import { MonitorFeedEventType } from "Common/Models/DatabaseModels/MonitorFeed";
import DatabaseService from "Common/Server/Services/DatabaseService";
import MonitorFeedService from "Common/Server/Services/MonitorFeedService";
import MonitorService from "Common/Server/Services/MonitorService";
import logger from "Common/Server/Utils/Logger";
import { Gray500 } from "Common/Types/BrandColors";
import {
  MANAGED_DEVICE_CHECK_IN_AGE_METRIC_NAME,
  ManagedDeviceCheckInAttribute,
} from "Common/Types/DeviceManagement/ManagedDeviceCheckIn";
import { ManagedDevicePlatform } from "Common/Types/DeviceManagement/ManagedDevicePlatform";
import { JSONObject } from "Common/Types/JSON";
import MonitorType from "Common/Types/Monitor/MonitorType";
import ObjectID from "Common/Types/ObjectID";
import MetricQueryCloudAggregation from "Common/Utils/Metrics/MetricQueryCloudAggregation";

/*
 * A Metrics monitor over a device management connection's check-ins
 * (oneuptime.managed_device.check_in.age, #9835) was made while an Esper
 * connection imported Android devices only, so it reads every device of the
 * connection. Since #9837 a connection imports its tenant's Apple devices
 * too, and an iPad checks in when Apple's push service wakes it, hours
 * apart: read by such a monitor - "Esper Device Stopped Checking In", more
 * than an hour - every iPad would open an alert within the hour.
 *
 * So each stored query of that metric that names a connection and no
 * platform reads the connection's Android devices
 * (oneuptime.managed_device.platform = "android"), which is every device it
 * read when it was made: it keeps alerting as it did, and still covers the
 * Android template it was made from (ManagedDeviceAlertTemplates). The
 * connection's Apple devices are a recommendation of their own. Each
 * monitor changed says so in its feed.
 *
 * Postgres only. Idempotent: a query that names a platform is never changed
 * again. A row is written only while it still holds what was read, so a
 * save made meanwhile is never overwritten, and only a row written gets a
 * feed entry.
 */

// Taken from Common's service so App does not resolve its own typeorm copy.
type ModelRepository = ReturnType<DatabaseService<BaseModel>["getRepository"]>;

interface MonitorRow {
  _id: string;
  projectId: string;
  monitorSteps: JSONObject | string | null;
}

export const PAGE_SIZE: number = 500;

// Only rows whose steps name the metric can hold such a query.
export const NAMES_THE_CHECK_IN_METRIC: string = `%"${MANAGED_DEVICE_CHECK_IN_AGE_METRIC_NAME}"%`;

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : undefined;
}

/*
 * Pins each query of one stored metric monitor that reads a connection's
 * check-ins, and names no platform, to the connection's Android devices,
 * in place. Answers how many it pinned. Pure but for the monitor handed in.
 */
export function pinCheckInQueriesToAndroid(
  metricMonitor: UnknownRecord,
): number {
  const queryConfigs: unknown = asRecord(metricMonitor["metricViewConfig"])?.[
    "queryConfigs"
  ];

  if (!Array.isArray(queryConfigs)) {
    return 0;
  }

  let pinned: number = 0;

  for (const queryConfig of queryConfigs) {
    const filterData: UnknownRecord | undefined = asRecord(
      asRecord(asRecord(queryConfig)?.["metricQueryData"])?.["filterData"],
    );

    if (
      !filterData ||
      filterData["metricName"] !== MANAGED_DEVICE_CHECK_IN_AGE_METRIC_NAME
    ) {
      continue;
    }

    const attributes: UnknownRecord | undefined = asRecord(
      filterData["attributes"],
    );

    if (
      !attributes ||
      !attributes[ManagedDeviceCheckInAttribute.ConnectionId] ||
      attributes[ManagedDeviceCheckInAttribute.Platform] !== undefined
    ) {
      continue;
    }

    attributes[ManagedDeviceCheckInAttribute.Platform] =
      ManagedDevicePlatform.Android;
    pinned++;
  }

  return pinned;
}

// The rows an `UPDATE ... RETURNING` touched, however the driver shapes them.
function countWrittenRows(result: unknown): number {
  if (!Array.isArray(result)) {
    return 0;
  }

  // pg returns [rows, rowCount] for UPDATE ... RETURNING through TypeORM.
  if (
    result.length === 2 &&
    Array.isArray(result[0]) &&
    typeof result[1] === "number"
  ) {
    return result[1];
  }

  return result.length;
}

// What a changed monitor's feed says: what it reads now, and why.
export const FEED_MARKDOWN: string = `📱 **This monitor now reads its connection's Android devices.**

The connection imports its Apple devices too since this release, and an Apple device checks in hours apart, when Apple's push service wakes it. This monitor reads the devices it read before, so it alerts as it did; the connection's **Set up alerts** offers its Apple devices a monitor of their own. Its criteria are unchanged.`;

export default class KeepManagedDeviceCheckInMonitorsOnAndroid extends DataMigrationBase {
  public constructor() {
    super("KeepManagedDeviceCheckInMonitorsOnAndroid");
  }

  public override async migrate(): Promise<void> {
    const repository: ModelRepository = (
      MonitorService as unknown as DatabaseService<BaseModel>
    ).getRepository();
    const tableName: string = repository.metadata.tableName;
    let lastId: string | null = null;
    let pinned: number = 0;
    let failed: number = 0;

    while (true) {
      const rows: Array<MonitorRow> = (await repository.manager.query(
        `SELECT "_id", "projectId", "monitorSteps" FROM "${tableName}" WHERE "monitorSteps" IS NOT NULL AND "monitorType" = $2 AND "monitorSteps"::text LIKE $3${
          lastId ? ` AND "_id" > $4` : ""
        } ORDER BY "_id" ASC LIMIT $1`,
        lastId
          ? [PAGE_SIZE, MonitorType.Metrics, NAMES_THE_CHECK_IN_METRIC, lastId]
          : [PAGE_SIZE, MonitorType.Metrics, NAMES_THE_CHECK_IN_METRIC],
      )) as Array<MonitorRow>;

      for (const row of rows) {
        try {
          const stored: JSONObject | null =
            KeepManagedDeviceCheckInMonitorsOnAndroid.parse(row.monitorSteps);

          if (!stored || !row.projectId) {
            continue;
          }

          const before: string = JSON.stringify(stored);
          const monitorSteps: JSONObject = JSON.parse(before) as JSONObject;
          let changed: number = 0;

          for (const metricMonitor of MetricQueryCloudAggregation.getStoredMetricMonitors(
            monitorSteps,
          )) {
            changed += pinCheckInQueriesToAndroid(metricMonitor);
          }

          if (changed === 0) {
            continue;
          }

          const written: unknown = await repository.manager.query(
            `UPDATE "${tableName}" SET "monitorSteps" = $1 WHERE "_id" = $2 AND "monitorSteps" = $3::jsonb RETURNING "_id"`,
            [JSON.stringify(monitorSteps), row._id, before],
          );

          // Saved again since it was read: its next save is its own.
          if (countWrittenRows(written) === 0) {
            continue;
          }

          pinned++;

          try {
            await MonitorFeedService.createMonitorFeedItem({
              monitorId: new ObjectID(row._id),
              projectId: new ObjectID(row.projectId),
              monitorFeedEventType: MonitorFeedEventType.MonitorUpdated,
              displayColor: Gray500,
              feedInfoInMarkdown: FEED_MARKDOWN,
            });
          } catch (err) {
            // It reads its Android devices either way; only its feed misses the word.
            logger.error(
              `KeepManagedDeviceCheckInMonitorsOnAndroid: could not tell monitor ${row._id}'s feed:`,
            );
            logger.error(err);
          }
        } catch (err) {
          /*
           * One monitor that cannot be changed must not hold the others
           * back: a person can add the platform on its form.
           */
          failed++;
          logger.error(
            `KeepManagedDeviceCheckInMonitorsOnAndroid: could not change monitor ${row._id}:`,
          );
          logger.error(err);
        }
      }

      if (rows.length < PAGE_SIZE) {
        break;
      }

      lastId = rows[rows.length - 1]!._id;
    }

    logger.info(
      `KeepManagedDeviceCheckInMonitorsOnAndroid: ${pinned} monitor(s) read their connection's Android devices${
        failed ? `; ${failed} could not be written` : ""
      }.`,
    );
  }

  public override async rollback(): Promise<void> {
    /*
     * Nothing to undo: the filter says what the monitor read, and taking it
     * off would read the connection's Apple devices too.
     */
  }

  // jsonb comes back parsed; a driver configured otherwise hands back text.
  public static parse(value: JSONObject | string | null): JSONObject | null {
    if (!value) {
      return null;
    }

    if (typeof value === "string") {
      try {
        return JSON.parse(value) as JSONObject;
      } catch {
        return null;
      }
    }

    return value;
  }
}
