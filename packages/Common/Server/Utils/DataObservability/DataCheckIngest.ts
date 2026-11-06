import {
  FailingRow,
  maskFailingRows,
} from "../../../Types/DataObservability/DataCheckFailingRows";
import DataAsset from "../../../Models/DatabaseModels/DataAsset";
import DataCheck from "../../../Models/DatabaseModels/DataCheck";
import DataObservabilitySetting from "../../../Models/DatabaseModels/DataObservabilitySetting";
import MetricType from "../../../Models/DatabaseModels/MetricType";
import { MetricPointType } from "../../../Models/AnalyticsModels/Metric";
import OneUptimeDate from "../../../Types/Date";
import Dictionary from "../../../Types/Dictionary";
import {
  DATA_CHECK_METRIC_NAME,
  DataCheckAttribute,
} from "../../../Types/DataObservability/DataCheckMetric";
import DataReconciliationCompare from "./DataReconciliationCompare";
import {
  DataCheckRunStatus,
  DEFAULT_DATA_CHECK_INTERVAL_IN_MINUTES,
} from "../../../Types/DataObservability/DataCheckType";
import {
  DataObservabilityAttribute,
  getDataTableKey,
} from "../../../Types/DataObservability/DataObservabilityMetric";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import ServiceType from "../../../Types/Telemetry/ServiceType";
import DataAssetService from "../../Services/DataAssetService";
import DataCheckService from "../../Services/DataCheckService";
import DataObservabilitySettingService from "../../Services/DataObservabilitySettingService";
import MetricService from "../../Services/MetricService";
import QueryHelper from "../../Types/Database/QueryHelper";
import logger from "../Logger";
import MonitorMetricUtil from "../Monitor/MonitorMetricUtil";
import { getNextCollectionTime } from "./DataObservabilityProbeCollect";
import TelemetryUtil from "../Telemetry/Telemetry";
import {
  DataCheckRunResult,
  DataCheckSegmentValue,
  MAX_CHECK_ERROR_LENGTH,
} from "./DataCheckResults";
import { IngestStore } from "./TableHealthIngest";

/*
 * WHAT A COLLECTION'S CHECKS READ, KEPT.
 *
 * Each value a check read becomes one oneuptime.data.check.value row - per
 * segment for a segmented check - tagged with the check, its table and the
 * store, so its monitor can filter on the check and group by segment. The
 * check itself keeps how its last run went and when it runs next. Only
 * checks of the store the results came from are recorded: a probe cannot
 * write another store's checks.
 */

// Kept with the check types; exported here too, where it always was.
export { DataCheckRunStatus };

export const DATA_CHECK_METRIC_DESCRIPTION: string =
  "The value a data check read: a percentage, a count, a minimum, a maximum or an average, per segment when it has one.";

export function buildCheckMetricRow(data: {
  store: IngestStore;
  asset: DataAsset;
  check: DataCheck;
  value: DataCheckSegmentValue;
  collectedAt: Date;
  retentionDays: number;
}): JSONObject {
  const time: string = OneUptimeDate.toClickhouseDateTime(data.collectedAt);
  const attributes: JSONObject = {
    [DataObservabilityAttribute.DataStoreId]: data.store.id.toString(),
    [DataObservabilityAttribute.DataStoreName]: data.store.name,
    [DataObservabilityAttribute.DataStoreKind]: data.store.kind,
    [DataObservabilityAttribute.TableId]: data.asset.id!.toString(),
    [DataObservabilityAttribute.TableKey]: getDataTableKey(
      data.asset.schemaName || "",
      data.asset.name || "",
    ),
    [DataCheckAttribute.CheckId]: data.check.id!.toString(),
    [DataCheckAttribute.CheckName]: data.check.name || "",
    [DataCheckAttribute.CheckType]: data.check.checkType || "",
    ...(data.value.segment !== null
      ? { [DataCheckAttribute.Segment]: data.value.segment }
      : {}),
  };

  return {
    _id: ObjectID.generateTimeOrdered().toString(),
    createdAt: time,
    projectId: data.store.projectId.toString(),
    primaryEntityId: data.store.id.toString(),
    primaryEntityType: ServiceType.DataStore,
    name: DATA_CHECK_METRIC_NAME,
    aggregationTemporality: null,
    metricPointType: MetricPointType.Gauge,
    time: time,
    startTime: null,
    timeUnixNano: OneUptimeDate.toUnixNano(data.collectedAt).toString(),
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
    value: data.value.value,
    retentionDate: OneUptimeDate.toClickhouseDateTime(
      OneUptimeDate.addRemoveDays(data.collectedAt, data.retentionDays),
    ),
  } as JSONObject;
}

/*
 * What a run leaves of a check's failing rows. A project that does not keep them
 * keeps none, whatever a report brings and whatever an earlier run left. An
 * empty list clears the last ones; a report silent about them leaves them.
 */
export function getFailingRowsToWrite(data: {
  keepsFailingRows: boolean;
  failingRows: Array<FailingRow> | undefined;
}): { failingRowsSample?: Array<FailingRow> | null } {
  if (!data.keepsFailingRows) {
    return { failingRowsSample: null };
  }

  return data.failingRows
    ? { failingRowsSample: maskFailingRows(data.failingRows) }
    : {};
}

export default class DataCheckIngest {
  public static async recordResults(data: {
    store: IngestStore;
    results: Array<DataCheckRunResult>;
    collectedAt: Date;
  }): Promise<number> {
    const ids: Array<string> = Array.from(
      new Set(
        data.results
          .map((result: DataCheckRunResult): string => {
            return result.checkId;
          })
          .filter((id: string): boolean => {
            return ObjectID.isValidUUID(id);
          }),
      ),
    );

    if (ids.length === 0) {
      return 0;
    }

    const checks: Array<DataCheck> = await DataCheckService.findBy({
      query: {
        _id: QueryHelper.any(ids),
        dataStoreId: data.store.id,
        projectId: data.store.projectId,
      },
      select: {
        _id: true,
        name: true,
        checkType: true,
        dataAssetId: true,
        intervalInMinutes: true,
        dataReconciliationId: true,
      },
      limit: ids.length,
      skip: 0,
      props: { isRoot: true },
    });
    const checkById: Map<string, DataCheck> = new Map(
      checks.map((check: DataCheck): [string, DataCheck] => {
        return [check.id!.toString(), check];
      }),
    );
    const assetIds: Array<string> = Array.from(
      new Set(
        checks.map((check: DataCheck): string => {
          return check.dataAssetId!.toString();
        }),
      ),
    );
    const assets: Array<DataAsset> =
      assetIds.length > 0
        ? await DataAssetService.findBy({
            query: { _id: QueryHelper.any(assetIds) },
            select: { _id: true, schemaName: true, name: true },
            limit: assetIds.length,
            skip: 0,
            props: { isRoot: true },
          })
        : [];
    const assetById: Map<string, DataAsset> = new Map(
      assets.map((asset: DataAsset): [string, DataAsset] => {
        return [asset.id!.toString(), asset];
      }),
    );
    const retentionDays: number = await MonitorMetricUtil.getRetentionDays();
    const setting: DataObservabilitySetting =
      await DataObservabilitySettingService.getOrCreateForProject(
        data.store.projectId,
      );
    const keepsFailingRows: boolean = setting.keepFailingRows === true;
    const rows: Array<JSONObject> = [];

    for (const result of data.results) {
      const check: DataCheck | undefined = checkById.get(result.checkId);

      if (!check?.id) {
        continue;
      }

      const asset: DataAsset | undefined = assetById.get(
        check.dataAssetId!.toString(),
      );

      if (asset && !result.error) {
        for (const value of result.values) {
          rows.push(
            buildCheckMetricRow({
              store: data.store,
              asset,
              check,
              value,
              collectedAt: data.collectedAt,
              retentionDays,
            }),
          );
        }
      }

      try {
        await DataCheckService.updateColumnsByIdWithoutHooks({
          id: check.id,
          data: {
            lastRunAt: data.collectedAt,
            lastRunStatus: result.error
              ? DataCheckRunStatus.Failed
              : DataCheckRunStatus.Ran,
            lastRunMessage: result.error
              ? result.error.slice(0, MAX_CHECK_ERROR_LENGTH)
              : result.values.length === 0
                ? "The check read no value: the table, or the rows it reads, are empty."
                : null,
            lastValue: result.values[0]?.value ?? null,
            lastSegmentCount: result.values.length,
            ...getFailingRowsToWrite({
              keepsFailingRows,
              failingRows: result.failingRows,
            }),
            nextRunAt: getNextCollectionTime(
              data.collectedAt,
              check.intervalInMinutes || DEFAULT_DATA_CHECK_INTERVAL_IN_MINUTES,
            ),
          } as never,
        });
      } catch (error) {
        logger.error(
          `Data Observability: could not record the run of check ${check.id.toString()}`,
        );
        logger.error(error);
      }
    }

    await this.writeCheckMetricRows(data.store.projectId, rows);

    // A reconciliation compares its sides as soon as both have been read together.
    const reconciliationIds: Array<ObjectID> = checks
      .map((check: DataCheck): ObjectID | undefined => {
        return check.dataReconciliationId;
      })
      .filter((id: ObjectID | undefined): id is ObjectID => {
        return Boolean(id);
      });

    if (reconciliationIds.length > 0) {
      try {
        await DataReconciliationCompare.compareForReconciliations(
          reconciliationIds,
          data.collectedAt,
        );
      } catch (error) {
        logger.error(
          `Data Observability: could not compare the reconciliations of store ${data.store.id.toString()}`,
        );
        logger.error(error);
      }
    }

    return rows.length;
  }

  // The values checks read - or dbt's tests found (DbtIngest) - as metric rows.
  public static async writeCheckMetricRows(
    projectId: ObjectID,
    rows: Array<JSONObject>,
  ): Promise<void> {
    for (let start: number = 0; start < rows.length; start += 5_000) {
      await MetricService.insertJsonRows(rows.slice(start, start + 5_000));
    }

    if (rows.length === 0) {
      return;
    }

    const metricType: MetricType = new MetricType();
    metricType.name = DATA_CHECK_METRIC_NAME;
    metricType.description = DATA_CHECK_METRIC_DESCRIPTION;
    metricType.unit = "";

    const metricTypes: Dictionary<MetricType> = {
      [DATA_CHECK_METRIC_NAME]: metricType,
    };

    TelemetryUtil.indexMetricNameServiceNameMap({
      projectId,
      metricNameServiceNameMap: metricTypes,
    }).catch((error: Error) => {
      logger.error(error);
    });
  }
}
