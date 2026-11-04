import DataAsset from "../../../Models/DatabaseModels/DataAsset";
import DataProduct from "../../../Models/DatabaseModels/DataProduct";
import MetricType from "../../../Models/DatabaseModels/MetricType";
import { MetricPointType } from "../../../Models/AnalyticsModels/Metric";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import OneUptimeDate from "../../../Types/Date";
import Dictionary from "../../../Types/Dictionary";
import {
  DataProductFreshness,
  DataProductStatus,
  getDataProductFreshness,
  readDataProductSla,
} from "../../../Types/DataObservability/DataProductFreshness";
import {
  DATA_PRODUCT_METRICS,
  DataProductAttribute,
  DataProductMetricName,
} from "../../../Types/DataObservability/DataProductMetric";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import ServiceType from "../../../Types/Telemetry/ServiceType";
import DataProductService from "../../Services/DataProductService";
import MetricService from "../../Services/MetricService";
import logger from "../Logger";
import MonitorMetricUtil from "../Monitor/MonitorMetricUtil";
import TelemetryUtil from "../Telemetry/Telemetry";

/*
 * EVERY DATA PRODUCT AGAINST ITS SLA, EVERY FIVE MINUTES.
 *
 * Each product's tables are read as the last collection left them (their
 * lastChangedAt) and checked against the product's SLA
 * (DataProductFreshness): which are late, and what the product's data is as
 * of. The product writes oneuptime.data.product.late_tables and
 * oneuptime.data.product.data_age - its monitor reads the first, so it is
 * Degraded while a table is late, and so are its monitor group and its
 * status page component - and its row keeps the status for its page and
 * its badge, written only when something changed.
 */

const PRODUCTS_PER_PAGE: number = 200;
// The most products checked in one run: well beyond any project's.
const MAX_PRODUCTS_PER_RUN: number = 20_000;
// How often a product's row is written when nothing changed but the time it was checked.
const CHECKED_AT_PRECISION_IN_MS: number = 60 * 60 * 1000;

function sameTime(a: Date | null | undefined, b: Date | null): boolean {
  return (a ? new Date(a).getTime() : null) === (b ? b.getTime() : null);
}

function sameIds(a: Array<string> | undefined, b: Array<string>): boolean {
  const kept: Array<string> = (a || []).map((value: unknown) => {
    return String(value);
  });

  return (
    kept.length === b.length &&
    kept.every((id: string, index: number) => {
      return id === b[index];
    })
  );
}

export function buildDataProductMetricRow(data: {
  projectId: ObjectID;
  dataProductId: ObjectID;
  productName: string;
  metricName: DataProductMetricName;
  value: number;
  at: Date;
  retentionDays: number;
}): JSONObject {
  const time: string = OneUptimeDate.toClickhouseDateTime(data.at);
  const attributes: JSONObject = {
    [DataProductAttribute.ProductId]: data.dataProductId.toString(),
    [DataProductAttribute.ProductName]: data.productName,
  };

  return {
    _id: ObjectID.generateTimeOrdered().toString(),
    createdAt: time,
    projectId: data.projectId.toString(),
    primaryEntityId: data.dataProductId.toString(),
    primaryEntityType: ServiceType.DataProduct,
    name: data.metricName,
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

// What a product's row must be written with, or null when it is as it was.
export function planDataProductUpdate(data: {
  product: Pick<
    DataProduct,
    | "status"
    | "lateTableCount"
    | "lateDataAssetIds"
    | "dataAsOf"
    | "statusCheckedAt"
  >;
  freshness: DataProductFreshness;
  now: Date;
}): JSONObject | null {
  const { product, freshness, now } = data;
  const statusChanged: boolean = product.status !== freshness.status;
  const changed: boolean =
    statusChanged ||
    (product.lateTableCount ?? null) !== freshness.lateDataAssetIds.length ||
    !sameIds(product.lateDataAssetIds, freshness.lateDataAssetIds) ||
    !sameTime(product.dataAsOf, freshness.dataAsOf);
  const checkedLongAgo: boolean =
    !product.statusCheckedAt ||
    now.getTime() - new Date(product.statusCheckedAt).getTime() >=
      CHECKED_AT_PRECISION_IN_MS;

  if (!changed && !checkedLongAgo) {
    return null;
  }

  return {
    status: freshness.status,
    lateTableCount: freshness.lateDataAssetIds.length,
    lateDataAssetIds: freshness.lateDataAssetIds,
    dataAsOf: freshness.dataAsOf,
    statusCheckedAt: now,
    ...(statusChanged ? { statusChangedAt: now } : {}),
  };
}

export default class DataProductCheck {
  public static async checkAll(now: Date): Promise<number> {
    const retentionDays: number = await MonitorMetricUtil.getRetentionDays();
    const rowsByProject: Map<string, Array<JSONObject>> = new Map();
    let checked: number = 0;

    for (
      let skip: number = 0;
      skip < MAX_PRODUCTS_PER_RUN;
      skip += PRODUCTS_PER_PAGE
    ) {
      const products: Array<DataProduct> = await DataProductService.findBy({
        query: {},
        select: {
          _id: true,
          projectId: true,
          name: true,
          freshByTimeOfDay: true,
          maxDataAgeInMinutes: true,
          status: true,
          lateTableCount: true,
          lateDataAssetIds: true,
          dataAsOf: true,
          statusCheckedAt: true,
          dataAssets: { _id: true, lastChangedAt: true },
        },
        sort: { createdAt: SortOrder.Ascending },
        skip,
        limit: PRODUCTS_PER_PAGE,
        props: { isRoot: true },
      });

      for (const product of products) {
        try {
          const rows: Array<JSONObject> = await this.checkProduct({
            product,
            now,
            retentionDays,
          });
          const projectRows: Array<JSONObject> =
            rowsByProject.get(product.projectId!.toString()) || [];

          projectRows.push(...rows);
          rowsByProject.set(product.projectId!.toString(), projectRows);
          checked++;
        } catch (error) {
          logger.error(
            `Data Observability: could not check data product ${product.id?.toString()}`,
          );
          logger.error(error);
        }
      }

      if (products.length < PRODUCTS_PER_PAGE) {
        break;
      }
    }

    for (const [projectId, rows] of rowsByProject) {
      await this.writeMetricRows(new ObjectID(projectId), rows);
    }

    return checked;
  }

  // One product: its row, when it changed, and the metric rows it writes.
  public static async checkProduct(data: {
    product: DataProduct;
    now: Date;
    retentionDays: number;
  }): Promise<Array<JSONObject>> {
    const { product, now } = data;

    if (!product.id || !product.projectId) {
      return [];
    }

    const freshness: DataProductFreshness = getDataProductFreshness({
      tables: (product.dataAssets || [])
        .filter((asset: DataAsset) => {
          return Boolean(asset.id);
        })
        .map((asset: DataAsset) => {
          return {
            dataAssetId: asset.id!.toString(),
            lastChangedAt: asset.lastChangedAt
              ? new Date(asset.lastChangedAt)
              : null,
          };
        }),
      now,
      sla: readDataProductSla(product),
    });
    const update: JSONObject | null = planDataProductUpdate({
      product,
      freshness,
      now,
    });

    if (update) {
      await DataProductService.updateColumnsByIdWithoutHooks({
        id: product.id,
        data: update as never,
      });
    }

    const rows: Array<JSONObject> = [
      buildDataProductMetricRow({
        projectId: product.projectId,
        dataProductId: product.id,
        productName: product.name || "",
        metricName: DataProductMetricName.LateTables,
        // Unknown counts no table late: a product no table of which was seen changing is never Degraded for it.
        value: freshness.lateDataAssetIds.length,
        at: now,
        retentionDays: data.retentionDays,
      }),
    ];

    if (freshness.dataAsOf && freshness.status !== DataProductStatus.Unknown) {
      rows.push(
        buildDataProductMetricRow({
          projectId: product.projectId,
          dataProductId: product.id,
          productName: product.name || "",
          metricName: DataProductMetricName.DataAge,
          value: Math.max(
            0,
            Math.floor((now.getTime() - freshness.dataAsOf.getTime()) / 1000),
          ),
          at: now,
          retentionDays: data.retentionDays,
        }),
      );
    }

    return rows;
  }

  private static async writeMetricRows(
    projectId: ObjectID,
    rows: Array<JSONObject>,
  ): Promise<void> {
    if (rows.length === 0) {
      return;
    }

    for (let start: number = 0; start < rows.length; start += 5_000) {
      await MetricService.insertJsonRows(rows.slice(start, start + 5_000));
    }

    const metricTypes: Dictionary<MetricType> = {};

    for (const definition of DATA_PRODUCT_METRICS) {
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
