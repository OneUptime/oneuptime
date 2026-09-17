import AnalyticsDatabaseService from "./AnalyticsDatabaseService";
import ClickhouseDatabase from "../Infrastructure/ClickhouseDatabase";
import MetricItemAggMV1mByContainer from "../../Models/AnalyticsModels/MetricItemAggMV1mByContainer";

/**
 * Read-side service for the `MetricItemAggMV1mByContainer` MV target
 * table — per-(container entity key, minute) pre-aggregated metric
 * values for container-scoped chart queries. Sister of
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
export class MetricItemAggMV1mByContainerService extends AnalyticsDatabaseService<MetricItemAggMV1mByContainer> {
  public constructor(clickhouseDatabase?: ClickhouseDatabase | undefined) {
    super({
      modelType: MetricItemAggMV1mByContainer,
      database: clickhouseDatabase,
    });
  }
}

export default new MetricItemAggMV1mByContainerService();
