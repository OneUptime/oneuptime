import AnalyticsDatabaseService from "./AnalyticsDatabaseService";
import ClickhouseDatabase from "../Infrastructure/ClickhouseDatabase";
import MetricItemAttributeAggMV1m from "../../Models/AnalyticsModels/MetricItemAttributeAggMV1m";

/**
 * Read-side service for the selected-attribute metric rollup MV target table.
 * Registration in AnalyticsServices makes boot-time schema sync create both the
 * AggregatingMergeTree target and its materialized view idempotently.
 */
export class MetricItemAttributeAggMV1mService extends AnalyticsDatabaseService<MetricItemAttributeAggMV1m> {
  public constructor(clickhouseDatabase?: ClickhouseDatabase | undefined) {
    super({
      modelType: MetricItemAttributeAggMV1m,
      database: clickhouseDatabase,
    });
  }
}

export default new MetricItemAttributeAggMV1mService();
