import logger from "../Logger";
import CaptureSpan from "../Telemetry/CaptureSpan";
import TelemetryUtil from "../Telemetry/Telemetry";
import GlobalConfigService from "../../Services/GlobalConfigService";
import MetricService from "../../Services/MetricService";
import { MetricPointType } from "../../../Models/AnalyticsModels/Metric";
import GlobalConfig from "../../../Models/DatabaseModels/GlobalConfig";
import Label from "../../../Models/DatabaseModels/Label";
import MetricType from "../../../Models/DatabaseModels/MetricType";
import OneUptimeDate from "../../../Types/Date";
import Dictionary from "../../../Types/Dictionary";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import SloMetricType from "../../../Types/ServiceLevelObjective/SloMetricType";
import ServiceType from "../../../Types/Telemetry/ServiceType";
import MetricResourceAttributeUtil from "../../../Utils/Metrics/MetricResourceAttributeUtil";
import SloMetricTypeUtil, {
  SLO_METRIC_PROJECT_ID_ATTRIBUTE,
  SLO_METRIC_SLO_ID_ATTRIBUTE,
  SLO_METRIC_SLO_NAME_ATTRIBUTE,
} from "../../../Utils/Slo/SloMetricType";

/*
 * Posts one SLO evaluation as `oneuptime.slo.*` metrics, so an SLO can be
 * charted, filtered and dashboarded like any monitor series.
 *
 * Modelled on NetworkDeviceMetricUtil: append-only MetricItemV3 rows keyed to
 * the SLO itself (primaryEntityId = the SLO id, primaryEntityType =
 * ServiceType.ServiceLevelObjective), not to any of its monitors. The names
 * start with `oneuptime.slo.`, which MutableMetricService does NOT route to
 * the mutable table, so reads find these rows in MetricItemV3 where they are
 * written.
 *
 * This does not replace SloHistory. SloHistory keeps 400 days in monthly
 * partitions for the long-range error-budget charts; these rows follow the
 * monitor-metric retention (daily partitions with ttl_only_drop_parts), which
 * is why they must never be given a history-length retention - every row
 * would pin its daily partition for a year.
 */
export default class SloMetricUtil {
  // Retention handling mirrors MonitorMetricUtil (shared GlobalConfig knob).
  private static readonly DEFAULT_RETENTION_DAYS: number = 30;

  /*
   * The worker evaluates every SLO every few minutes, so thousands of SLOs
   * would otherwise read GlobalConfig hundreds of times a minute for a value
   * an admin changes a few times a year.
   */
  private static cachedRetentionDays: number | null = null;
  private static lastCacheRefresh: Date | null = null;
  private static readonly CACHE_TTL_MS: number = 5 * 60 * 1000;

  private static async getRetentionDays(): Promise<number> {
    const now: Date = OneUptimeDate.getCurrentDate();

    if (
      this.cachedRetentionDays !== null &&
      this.lastCacheRefresh !== null &&
      now.getTime() - this.lastCacheRefresh.getTime() < this.CACHE_TTL_MS
    ) {
      return this.cachedRetentionDays;
    }

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

      /*
       * Zero or a negative number would stamp a retention date at or before
       * the row's own timestamp, and ClickHouse would drop the evaluation the
       * moment the part merged. Treat it as unset, as MonitorMetricUtil does.
       */
      if (
        globalConfig &&
        globalConfig.monitorMetricRetentionInDays !== undefined &&
        globalConfig.monitorMetricRetentionInDays !== null &&
        globalConfig.monitorMetricRetentionInDays > 0
      ) {
        this.cachedRetentionDays = globalConfig.monitorMetricRetentionInDays;
      } else {
        this.cachedRetentionDays = this.DEFAULT_RETENTION_DAYS;
      }
    } catch (err) {
      logger.error(
        "Error fetching monitor metric retention config for SLO metrics, using default:",
      );
      logger.error(err);
      this.cachedRetentionDays = this.DEFAULT_RETENTION_DAYS;
    }

    this.lastCacheRefresh = now;
    return this.cachedRetentionDays;
  }

  @CaptureSpan()
  public static async saveSloMetrics(data: {
    projectId: ObjectID;
    sloId: ObjectID;
    sloName?: string | undefined;
    labels?: Array<Label> | undefined;
    // null, undefined and non-finite values are skipped, never written as 0.
    values: Partial<Record<SloMetricType, number | null | undefined>>;
  }): Promise<void> {
    const metricsToWrite: Array<{ metricType: SloMetricType; value: number }> =
      [];

    /*
     * Walk the util's list rather than the caller's object, so the rows come
     * out in one stable order and only names that have catalog metadata can
     * ever be written.
     */
    for (const metricType of SloMetricTypeUtil.getAll()) {
      const value: number | null | undefined = data.values[metricType];

      /*
       * A NaN burn rate or an Infinity budget percentage (a zero-length
       * window) has no meaningful point to chart, and ClickHouse would store
       * it as a value every aggregate then has to step around.
       */
      if (typeof value !== "number" || !isFinite(value)) {
        continue;
      }

      metricsToWrite.push({ metricType: metricType, value: value });
    }

    if (metricsToWrite.length === 0) {
      return;
    }

    const baseAttributes: JSONObject = {
      [SLO_METRIC_SLO_ID_ATTRIBUTE]: data.sloId.toString(),
      [SLO_METRIC_PROJECT_ID_ATTRIBUTE]: data.projectId.toString(),
    };

    if (data.sloName && data.sloName.trim().length > 0) {
      baseAttributes[SLO_METRIC_SLO_NAME_ATTRIBUTE] = data.sloName;
    }

    /*
     * Labels are merged LAST (oneuptime.label.* cannot collide with the bare
     * keys above anyway) and attributeKeys is computed from the merged set,
     * because the dashboard's attribute pickers read attributeKeys, not the
     * attributes map.
     */
    const attributes: JSONObject =
      MetricResourceAttributeUtil.mergeResourceAttributes(
        baseAttributes,
        MetricResourceAttributeUtil.getResourceAttributes({
          labels: data.labels,
        }),
      );

    const retentionDays: number = await SloMetricUtil.getRetentionDays();

    /*
     * One timestamp for the whole evaluation, so the SLI and its target (and
     * every other series) land on exactly the same x and overlay cleanly.
     */
    const ingestionDate: Date = OneUptimeDate.getCurrentDate();
    const retentionDate: Date = OneUptimeDate.addRemoveDays(
      ingestionDate,
      retentionDays,
    );

    const metricRows: Array<JSONObject> = [];
    const metricNameServiceNameMap: Dictionary<MetricType> = {};

    for (const metricToWrite of metricsToWrite) {
      metricRows.push(
        SloMetricUtil.buildSloMetricRow({
          projectId: data.projectId,
          sloId: data.sloId,
          metricName: metricToWrite.metricType,
          value: metricToWrite.value,
          attributes: attributes,
          ingestionDate: ingestionDate,
          retentionDate: retentionDate,
        }),
      );

      /*
       * Registering the name is what puts the series in the dashboard metric
       * picker (it reads MetricType rows, not any enum). Description and unit
       * come from the same util the SLO Metrics page charts with.
       */
      const metricType: MetricType = new MetricType();
      metricType.name = metricToWrite.metricType;
      metricType.description = SloMetricTypeUtil.getDescription(
        metricToWrite.metricType,
      );
      metricType.unit = SloMetricTypeUtil.getUnit(metricToWrite.metricType);

      metricNameServiceNameMap[metricToWrite.metricType] = metricType;
    }

    // One insert per evaluation, however many series it carries.
    await MetricService.insertJsonRows(metricRows);

    /*
     * Fire-and-forget: the catalog is fenced by a cache and reconciles on the
     * next evaluation, so a slow or failed index write must not hold up the
     * worker's notifications and burn-rate rules.
     */
    TelemetryUtil.indexMetricNameServiceNameMap({
      projectId: data.projectId,
      metricNameServiceNameMap: metricNameServiceNameMap,
    }).catch((err: Error) => {
      logger.error(err);
    });
  }

  // Row shape must stay in lockstep with MonitorMetricUtil.buildMonitorMetricRow.
  private static buildSloMetricRow(data: {
    projectId: ObjectID;
    sloId: ObjectID;
    metricName: string;
    value: number;
    attributes: JSONObject;
    ingestionDate: Date;
    retentionDate: Date;
  }): JSONObject {
    const ingestionTimestamp: string = OneUptimeDate.toClickhouseDateTime(
      data.ingestionDate,
    );
    const timeUnixNano: string = OneUptimeDate.toUnixNano(
      data.ingestionDate,
    ).toString();

    // A copy per row, so no two rows share (and can mutate) one object.
    const attributes: JSONObject = { ...data.attributes };
    const attributeKeys: Array<string> =
      TelemetryUtil.getAttributeKeys(attributes);

    return {
      _id: ObjectID.generateTimeOrdered().toString(),
      createdAt: ingestionTimestamp,
      projectId: data.projectId.toString(),
      primaryEntityId: data.sloId.toString(),
      primaryEntityType: ServiceType.ServiceLevelObjective,
      name: data.metricName,
      aggregationTemporality: null,
      /*
       * Every SLO series is a point-in-time reading, i.e. a Gauge. Monitor
       * rows use Sum, but MetricService aggregates Sum and Gauge identically
       * for scalar queries, so the honest type costs nothing.
       */
      metricPointType: MetricPointType.Gauge,
      time: ingestionTimestamp,
      startTime: null,
      timeUnixNano: timeUnixNano,
      startTimeUnixNano: null,
      attributes: attributes,
      attributeKeys: attributeKeys,
      isMonotonic: null,
      count: null,
      sum: null,
      min: null,
      max: null,
      bucketCounts: [],
      explicitBounds: [],
      value: data.value,
      retentionDate: OneUptimeDate.toClickhouseDateTime(data.retentionDate),
    } as JSONObject;
  }
}
