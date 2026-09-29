import AnalyticsDatabaseService from "./AnalyticsDatabaseService";
import ClickhouseDatabase from "../Infrastructure/ClickhouseDatabase";
import MetricItemAggMV1mByService from "../../Models/AnalyticsModels/MetricItemAggMV1mByService";

/**
 * Read-side service for the `MetricItemAggMV1mByService` MV target table —
 * per-(service entity key, minute) pre-aggregated metric values for
 * service-detail chart queries. Sister of
 * `MetricItemAggMV1mByHostV2Service` (which is keyed by hostEntityKey).
 *
 * Today's reads go through
 * `MetricService.tryBuildEntityAggregateMVStatement` with raw SQL; this
 * service exists so the model is registered with the analytics framework
 * and the auto-create flow can manage the table + MV on app startup
 * (idempotent with the AddMetricEntityMinuteAggregateMaterializedViews
 * migration, which also backfills from MetricItemV3).
 *
 * AggregateFunction columns require `*Merge()` finalizers at read time —
 * the generic typed `findBy` path is therefore not useful and should not
 * be relied on against this table.
 */
export class MetricItemAggMV1mByServiceService extends AnalyticsDatabaseService<MetricItemAggMV1mByService> {
  public constructor(clickhouseDatabase?: ClickhouseDatabase | undefined) {
    super({
      modelType: MetricItemAggMV1mByService,
      database: clickhouseDatabase,
    });
  }
}

export default new MetricItemAggMV1mByServiceService();
