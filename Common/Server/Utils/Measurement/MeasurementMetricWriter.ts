import MetricType from "../../../Models/DatabaseModels/MetricType";
import MutableMetric from "../../../Models/AnalyticsModels/MutableMetric";
import { MetricPointType } from "../../../Models/AnalyticsModels/Metric";
import GlobalConfigService from "../../Services/GlobalConfigService";
import MutableMetricService from "../../Services/MutableMetricService";
import GlobalConfig from "../../../Models/DatabaseModels/GlobalConfig";
import ObjectID from "../../../Types/ObjectID";
import OneUptimeDate from "../../../Types/Date";
import ServiceType from "../../../Types/Telemetry/ServiceType";
import TelemetryUtil from "../Telemetry/Telemetry";
import { JSONObject } from "../../../Types/JSON";
import logger from "../Logger";

export interface MeasurementMetricPoint {
  metricName: string;
  measurementId: string;
  measurementKey: string;
  measurementName: string;
  description?: string | undefined;
  unit?: string | undefined;
  valueInSeconds: number;
  time: Date;
}

const DEFAULT_METRIC_RETENTION_IN_DAYS: number = 180;

/*
 * Writes measurement values into the existing mutable-metric pipeline.
 *
 * The one thing this must get right is the tombstone scope.
 * MutableMetricService.replaceEntityMetrics tombstones every live metric
 * point whose name is in `metricNames` and which is not in the desired set it
 * was handed. So the measurement writer owns its OWN name list -- the
 * project's measurement metric names, and nothing else -- and never appends
 * those names to the built-in refresh's replace list. Doing the latter would
 * make every state change tombstone every measurement point, silently, since
 * the built-in refresh has no measurement points in its desired set.
 */
export default class MeasurementMetricWriter {
  public static async write(data: {
    projectId: ObjectID;
    primaryEntityId: ObjectID;
    primaryEntityType: ServiceType;
    // Every measurement metric name in the project, enabled or not.
    allMeasurementMetricNames: Array<string>;
    // Only the points that actually have a value; disabled ones are omitted.
    points: Array<MeasurementMetricPoint>;
    baseAttributes: JSONObject;
  }): Promise<void> {
    if (data.allMeasurementMetricNames.length === 0) {
      return;
    }

    const retentionDate: Date = OneUptimeDate.addRemoveDays(
      OneUptimeDate.getCurrentDate(),
      await MeasurementMetricWriter.getMetricRetentionInDays(),
    );

    const metrics: Array<MutableMetric> = [];
    const metricTypesMap: Record<string, MetricType> = {};

    for (const point of data.points) {
      const metric: MutableMetric = new MutableMetric();

      metric.projectId = data.projectId;
      metric.primaryEntityId = data.primaryEntityId;
      metric.primaryEntityType = data.primaryEntityType;
      metric.name = point.metricName;

      /*
       * Per-definition point identity, mirroring the built-in
       * `time-in-state:<timelineRowId>` shape. Sharing one identity across
       * definitions would make each refresh overwrite the others.
       */
      metric.metricPointId = `measurement:${point.measurementId}`;
      metric.value = point.valueInSeconds;
      metric.time = point.time;
      metric.timeUnixNano = OneUptimeDate.toUnixNano(point.time);
      metric.metricPointType = MetricPointType.Sum;
      metric.retentionDate = retentionDate;

      metric.attributes = {
        ...data.baseAttributes,
        /*
         * Namespaced, following the oneuptime.label.* / oneuptime.customField.*
         * convention, so they cannot collide with the unprefixed camelCase
         * dimensions the built-in metrics carry.
         */
        "oneuptime.measurement.id": point.measurementId,
        "oneuptime.measurement.key": point.measurementKey,
        "oneuptime.measurement.name": point.measurementName,
      };
      metric.attributeKeys = TelemetryUtil.getAttributeKeys(metric.attributes);

      metrics.push(metric);

      const metricType: MetricType = new MetricType();
      metricType.name = point.metricName;
      metricType.description =
        point.description ||
        `${point.measurementName}, a measurement defined for this project`;
      metricType.unit = point.unit || "seconds";
      metricTypesMap[point.metricName] = metricType;
    }

    await MutableMetricService.replaceEntityMetrics({
      projectId: data.projectId,
      primaryEntityId: data.primaryEntityId,
      primaryEntityType: data.primaryEntityType,
      metricNames: data.allMeasurementMetricNames,
      metrics: metrics,
      retentionDate: retentionDate,
    });

    if (Object.keys(metricTypesMap).length === 0) {
      return;
    }

    /*
     * Registering the name is what makes a measurement appear in the
     * dashboard chart picker -- the picker reads MetricType rows, not any
     * enum, so no dashboard code is needed for a new measurement.
     */
    TelemetryUtil.indexMetricNameServiceNameMap({
      metricNameServiceNameMap: metricTypesMap,
      projectId: data.projectId,
    }).catch((err: Error) => {
      logger.error(err);
    });
  }

  /*
   * Tombstones every measurement point for one entity. Used when the entity
   * is deleted, so its points leave the charts rather than lingering until
   * the retention date.
   */
  public static async tombstoneAll(data: {
    projectId: ObjectID;
    primaryEntityId: ObjectID;
    primaryEntityType: ServiceType;
    allMeasurementMetricNames: Array<string>;
  }): Promise<void> {
    if (data.allMeasurementMetricNames.length === 0) {
      return;
    }

    const retentionDate: Date = OneUptimeDate.addRemoveDays(
      OneUptimeDate.getCurrentDate(),
      await MeasurementMetricWriter.getMetricRetentionInDays(),
    );

    await MutableMetricService.tombstoneEntityMetrics({
      projectId: data.projectId,
      primaryEntityId: data.primaryEntityId,
      primaryEntityType: data.primaryEntityType,
      metricNames: data.allMeasurementMetricNames,
      retentionDate: retentionDate,
    });
  }

  private static async getMetricRetentionInDays(): Promise<number> {
    try {
      const globalConfig: GlobalConfig | null =
        await GlobalConfigService.findOneBy({
          query: {
            _id: ObjectID.getZeroObjectID().toString(),
          },
          props: {
            isRoot: true,
          },
          select: {
            monitorMetricRetentionInDays: true,
          },
        });

      if (
        globalConfig &&
        globalConfig.monitorMetricRetentionInDays !== undefined &&
        globalConfig.monitorMetricRetentionInDays !== null
      ) {
        return globalConfig.monitorMetricRetentionInDays;
      }
    } catch (err) {
      logger.error(err as Error);
    }

    return DEFAULT_METRIC_RETENTION_IN_DAYS;
  }
}
