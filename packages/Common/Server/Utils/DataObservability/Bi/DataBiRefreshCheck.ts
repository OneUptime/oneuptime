import DataBiConnection from "../../../../Models/DatabaseModels/DataBiConnection";
import MetricType from "../../../../Models/DatabaseModels/MetricType";
import { MetricPointType } from "../../../../Models/AnalyticsModels/Metric";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import OneUptimeDate from "../../../../Types/Date";
import {
  DATA_BI_METRICS,
  DataBiAttribute,
  DataBiFailedRefresh,
  DataBiMetricName,
  getDataBiRefreshFailedValue,
  readDataBiFailedRefreshes,
} from "../../../../Types/DataObservability/DataBiRefreshAlert";
import DataBiTool from "../../../../Types/DataObservability/DataBiTool";
import Dictionary from "../../../../Types/Dictionary";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import ServiceType from "../../../../Types/Telemetry/ServiceType";
import QueryHelper from "../../../Types/Database/QueryHelper";
import DataBiConnectionService from "../../../Services/DataBiConnectionService";
import MetricService from "../../../Services/MetricService";
import logger from "../../Logger";
import MonitorMetricUtil from "../../Monitor/MonitorMetricUtil";
import TelemetryUtil from "../../Telemetry/Telemetry";

/*
 * EVERY POWER BI DATASET WHOSE REFRESH FAILED, CHECKED EVERY FIVE MINUTES.
 *
 * Power BI is read once an hour, and a refresh read an hour late would fall
 * outside a monitor's window, or make a frequently refreshed dataset flap.
 * So the hourly read only keeps the datasets failing (DataBiRefreshAlert),
 * and every five minutes each one kept writes
 * oneuptime.data.bi.refresh_failed from what was kept - 1 while it fails, 0
 * for the hour after a later refresh completed - stamped now. Its tool's
 * monitor reads them (DataBiRefreshMonitorStep): one alert per dataset,
 * open while it fails, resolved once a later refresh completes. Nothing is
 * asked of Power BI here. A tool turned off is not read, and writes nothing.
 */

const CONNECTIONS_PER_PAGE: number = 500;

export function buildBiRefreshMetricRow(data: {
  projectId: ObjectID;
  dataBiConnectionId: ObjectID;
  connectionName: string;
  refresh: DataBiFailedRefresh;
  value: number;
  at: Date;
  retentionDays: number;
}): JSONObject {
  const time: string = OneUptimeDate.toClickhouseDateTime(data.at);
  const attributes: JSONObject = {
    [DataBiAttribute.ConnectionId]: data.dataBiConnectionId.toString(),
    [DataBiAttribute.ConnectionName]: data.connectionName,
    [DataBiAttribute.DatasetId]: data.refresh.datasetId,
    [DataBiAttribute.DatasetName]: data.refresh.datasetName,
    [DataBiAttribute.Workspace]: data.refresh.workspace || "",
  };

  return {
    _id: ObjectID.generateTimeOrdered().toString(),
    createdAt: time,
    projectId: data.projectId.toString(),
    primaryEntityId: data.dataBiConnectionId.toString(),
    primaryEntityType: ServiceType.DataBiConnection,
    name: DataBiMetricName.RefreshFailed,
    aggregationTemporality: null,
    metricPointType: MetricPointType.Gauge,
    time: time,
    startTime: null,
    timeUnixNano: OneUptimeDate.toUnixNano(data.at).toString(),
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
    value: data.value,
    retentionDate: OneUptimeDate.toClickhouseDateTime(
      OneUptimeDate.addRemoveDays(data.at, data.retentionDays),
    ),
  } as JSONObject;
}

// The rows one tool writes now: one per dataset kept, while it still writes.
export function getBiRefreshMetricRows(data: {
  connection: DataBiConnection;
  now: Date;
  retentionDays: number;
}): Array<JSONObject> {
  const { connection } = data;

  if (!connection.id || !connection.projectId) {
    return [];
  }

  const rows: Array<JSONObject> = [];

  for (const refresh of readDataBiFailedRefreshes(connection.failedRefreshes)) {
    const value: number | null = getDataBiRefreshFailedValue(refresh, data.now);

    if (value === null) {
      continue;
    }

    rows.push(
      buildBiRefreshMetricRow({
        projectId: connection.projectId,
        dataBiConnectionId: connection.id,
        connectionName: connection.name || "",
        refresh,
        value,
        at: data.now,
        retentionDays: data.retentionDays,
      }),
    );
  }

  return rows;
}

export default class DataBiRefreshCheck {
  // Returns how many metric rows were written.
  public static async checkAll(now: Date): Promise<number> {
    const retentionDays: number = await MonitorMetricUtil.getRetentionDays();
    let written: number = 0;
    let skip: number = 0;

    while (true) {
      const connections: Array<DataBiConnection> =
        await DataBiConnectionService.findBy({
          query: {
            tool: DataBiTool.PowerBI,
            isEnabled: true,
            failedRefreshes: QueryHelper.notNull(),
          },
          select: {
            _id: true,
            projectId: true,
            name: true,
            failedRefreshes: true,
          },
          sort: { createdAt: SortOrder.Ascending },
          limit: CONNECTIONS_PER_PAGE,
          skip,
          props: { isRoot: true },
        });

      for (const connection of connections) {
        const rows: Array<JSONObject> = getBiRefreshMetricRows({
          connection,
          now,
          retentionDays,
        });

        if (rows.length === 0) {
          continue;
        }

        try {
          await DataBiRefreshCheck.writeMetricRows(connection.projectId!, rows);
          written += rows.length;
        } catch (error) {
          logger.error(
            `Data Observability: could not write the failed refreshes of BI tool ${connection.id?.toString()}`,
          );
          logger.error(error);
        }
      }

      if (connections.length < CONNECTIONS_PER_PAGE) {
        break;
      }

      skip += connections.length;
    }

    return written;
  }

  public static async writeMetricRows(
    projectId: ObjectID,
    rows: Array<JSONObject>,
  ): Promise<void> {
    if (rows.length === 0) {
      return;
    }

    await MetricService.insertJsonRows(rows);

    const metricTypes: Dictionary<MetricType> = {};

    for (const definition of DATA_BI_METRICS) {
      const metricType: MetricType = new MetricType();
      metricType.name = definition.name;
      metricType.description = definition.description;
      metricType.unit = definition.unit;
      metricTypes[definition.name] = metricType;
    }

    TelemetryUtil.indexMetricNameServiceNameMap({
      projectId,
      metricNameServiceNameMap: metricTypes,
    }).catch((error: Error) => {
      logger.error(error);
    });
  }
}
