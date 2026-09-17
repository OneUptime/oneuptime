import AnalyticsDatabaseService from "./AnalyticsDatabaseService";
import ClickhouseDatabase from "../Infrastructure/ClickhouseDatabase";
import MetricItemAggMV1mByHostV2 from "../../Models/AnalyticsModels/MetricItemAggMV1mByHostV2";

/**
 * Read-side service for the `MetricItemAggMV1mByHostV2` MV target table —
 * per-(host entity key, minute) pre-aggregated metric values for
 * host-detail chart queries. Sister of `MetricItemAggMV1mService` (which
 * is keyed by primaryEntityId rather than host).
 *
 * Today's reads go through `MetricService.tryBuildHostAggregateMVStatement`
 * with raw SQL; this service exists so the model is registered with the
 * analytics framework and the auto-create flow can manage the table + MV
 * on app startup (idempotent with the RekeyMetricHostRollupToEntityKey
 * migration, which also backfills from the dropped V1 table).
 *
 * AggregateFunction columns require `*Merge()` finalizers at read time —
 * the generic typed `findBy` path is therefore not useful and should not
 * be relied on against this table.
 */
export class MetricItemAggMV1mByHostV2Service extends AnalyticsDatabaseService<MetricItemAggMV1mByHostV2> {
  public constructor(clickhouseDatabase?: ClickhouseDatabase | undefined) {
    super({
      modelType: MetricItemAggMV1mByHostV2,
      database: clickhouseDatabase,
    });
  }
}

export default new MetricItemAggMV1mByHostV2Service();
