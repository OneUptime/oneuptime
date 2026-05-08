import AnalyticsDatabaseService from "./AnalyticsDatabaseService";
import ClickhouseDatabase from "../Infrastructure/ClickhouseDatabase";
import MetricItemAggMV1mByHost from "../../Models/AnalyticsModels/MetricItemAggMV1mByHost";

/**
 * Read-side service for the `MetricItemAggMV1mByHost` MV target table —
 * per-(host, minute) pre-aggregated metric values for host-detail
 * chart queries. Sister of `MetricItemAggMV1mService` (which is keyed
 * by service rather than host).
 *
 * Today's reads go through `MetricService.tryBuildHostAggregateMVStatement`
 * with raw SQL; this service exists so the model is registered with
 * the analytics framework and the auto-create flow can manage the
 * table on app startup (idempotent with the legacy
 * `AddMetricMinuteAggregateByHostMaterializedView` migration).
 *
 * AggregateFunction columns require `*Merge()` finalizers at read
 * time — the generic typed `findBy` path is therefore not useful and
 * should not be relied on against this table.
 */
export class MetricItemAggMV1mByHostService extends AnalyticsDatabaseService<MetricItemAggMV1mByHost> {
  public constructor(clickhouseDatabase?: ClickhouseDatabase | undefined) {
    super({
      modelType: MetricItemAggMV1mByHost,
      database: clickhouseDatabase,
    });
  }
}

export default new MetricItemAggMV1mByHostService();
