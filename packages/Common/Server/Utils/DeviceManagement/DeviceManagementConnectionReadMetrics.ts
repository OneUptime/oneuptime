import { MetricPointType } from "../../../Models/AnalyticsModels/Metric";
import MetricType from "../../../Models/DatabaseModels/MetricType";
import OneUptimeDate from "../../../Types/Date";
import Dictionary from "../../../Types/Dictionary";
import {
  DeviceManagementConnectionReading,
  DeviceManagementConnectionReadingInput,
  MANAGED_DEVICE_CONNECTION_READ_AGE_DESCRIPTION,
  MANAGED_DEVICE_CONNECTION_READ_AGE_METRIC_NAME,
  MANAGED_DEVICE_CONNECTION_READ_AGE_UNIT,
  getDeviceManagementConnectionReading,
} from "../../../Types/DeviceManagement/DeviceManagementConnectionReading";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import ServiceType from "../../../Types/Telemetry/ServiceType";
import MetricService from "../../Services/MetricService";
import logger from "../Logger";
import MonitorMetricUtil from "../Monitor/MonitorMetricUtil";
import TelemetryUtil from "../Telemetry/Telemetry";

/*
 * WRITES HOW LONG SINCE A DEVICE MANAGEMENT CONNECTION LAST READ (#10006).
 *
 * One metric row per reading (DeviceManagementConnectionReading says when a
 * reading is taken, and what it says), keyed to the connection as its
 * devices' readings are (primaryEntityId = its id, type
 * DeviceManagementConnection, never billed as ingested telemetry) and kept
 * for the monitor metric retention. A connection is no host, so a row names
 * no entity: the connection's own monitor reads it by the connection's id.
 */

// Rows per insert, as the other metric writers insert them.
const INSERT_BATCH_SIZE: number = 5000;

export interface DeviceManagementConnectionReadRecord {
  projectId: ObjectID;
  connectionId: ObjectID;
  // What the reading is of, at `asOf` (its connectionId is the one above).
  reading: Omit<DeviceManagementConnectionReadingInput, "connectionId">;
}

// One reading's row: the minutes since the connection last read. Pure.
export function buildDeviceManagementConnectionReadRow(data: {
  projectId: ObjectID;
  connectionId: ObjectID;
  reading: DeviceManagementConnectionReading;
  asOf: Date;
  retentionDate: Date;
}): JSONObject {
  const time: string = OneUptimeDate.toClickhouseDateTime(data.asOf);
  const attributes: JSONObject = { ...data.reading.attributes } as JSONObject;

  return {
    _id: ObjectID.generateTimeOrdered().toString(),
    createdAt: time,
    projectId: data.projectId.toString(),
    primaryEntityId: data.connectionId.toString(),
    primaryEntityType: ServiceType.DeviceManagementConnection,
    name: MANAGED_DEVICE_CONNECTION_READ_AGE_METRIC_NAME,
    aggregationTemporality: null,
    // How long, at one moment: a Gauge.
    metricPointType: MetricPointType.Gauge,
    time: time,
    startTime: null,
    timeUnixNano: OneUptimeDate.toUnixNano(data.asOf).toString(),
    startTimeUnixNano: null,
    attributes: attributes,
    attributeKeys: TelemetryUtil.getAttributeKeys(attributes),
    isMonotonic: null,
    count: null,
    sum: null,
    min: null,
    max: null,
    bucketCounts: [],
    explicitBounds: [],
    value: data.reading.ageInMinutes,
    retentionDate: OneUptimeDate.toClickhouseDateTime(data.retentionDate),
  } as JSONObject;
}

// The row of one record, at a retention. Pure.
export function buildDeviceManagementConnectionReadRecordRow(
  record: DeviceManagementConnectionReadRecord,
  retentionDays: number,
): JSONObject {
  const reading: DeviceManagementConnectionReading =
    getDeviceManagementConnectionReading({
      ...record.reading,
      connectionId: record.connectionId.toString(),
    });

  return buildDeviceManagementConnectionReadRow({
    projectId: record.projectId,
    connectionId: record.connectionId,
    reading,
    asOf: record.reading.asOf,
    retentionDate: OneUptimeDate.addRemoveDurationInDays(
      record.reading.asOf,
      retentionDays,
    ),
  });
}

export default class DeviceManagementConnectionReadMetrics {
  /*
   * Writes the readings of one or more connections, and puts the metric in
   * each of their projects' catalogs. Throws on a failed write: the callers
   * keep it a warning, never a failed read or a connection left unqueued.
   */
  public static async record(
    records: ReadonlyArray<DeviceManagementConnectionReadRecord>,
  ): Promise<number> {
    if (records.length === 0) {
      return 0;
    }

    const retentionDays: number = await MonitorMetricUtil.getRetentionDays();
    const rows: Array<JSONObject> = records.map(
      (record: DeviceManagementConnectionReadRecord): JSONObject => {
        return buildDeviceManagementConnectionReadRecordRow(
          record,
          retentionDays,
        );
      },
    );

    for (
      let start: number = 0;
      start < rows.length;
      start += INSERT_BATCH_SIZE
    ) {
      await MetricService.insertJsonRows(
        rows.slice(start, start + INSERT_BATCH_SIZE),
      );
    }

    const projectIds: Map<string, ObjectID> = new Map<string, ObjectID>();

    for (const record of records) {
      projectIds.set(record.projectId.toString(), record.projectId);
    }

    for (const projectId of projectIds.values()) {
      await DeviceManagementConnectionReadMetrics.registerMetricName(projectId);
    }

    return rows.length;
  }

  /*
   * Puts the metric in the project's catalog, so the metric picker and a
   * Metrics monitor's builder offer it with its unit. A failure only delays
   * that until a later reading: the rows are written.
   */
  private static async registerMetricName(projectId: ObjectID): Promise<void> {
    const metricType: MetricType = new MetricType();
    metricType.name = MANAGED_DEVICE_CONNECTION_READ_AGE_METRIC_NAME;
    metricType.description = MANAGED_DEVICE_CONNECTION_READ_AGE_DESCRIPTION;
    metricType.unit = MANAGED_DEVICE_CONNECTION_READ_AGE_UNIT;

    const metricNameServiceNameMap: Dictionary<MetricType> = {
      [MANAGED_DEVICE_CONNECTION_READ_AGE_METRIC_NAME]: metricType,
    };

    try {
      await TelemetryUtil.indexMetricNameServiceNameMap({
        projectId,
        metricNameServiceNameMap,
      });
    } catch (error) {
      logger.error(
        `Device management connections of project ${projectId.toString()}: their read metric could not be put in the catalog; a later reading tries again: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}
