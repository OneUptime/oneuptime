import AnalyticsDatabaseService from "./AnalyticsDatabaseService";
import ClickhouseDatabase from "../Infrastructure/ClickhouseDatabase";
import MetricItemAggMV1m from "../../Models/AnalyticsModels/MetricItemAggMV1m";

/**
 * Read-side service for the `MetricItemAggMV1m` MV target table —
 * per-minute pre-aggregated metric values populated by an attached MV
 * on every `MetricItemV2` insert.
 *
 * Today's chart aggregation queries (in `MetricService`) build raw SQL
 * against this table by name; this service exists primarily to:
 *   - Register the model in `AnalyticsServices` so the auto-create flow
 *     can create the table on app startup (idempotent with the legacy
 *     `AddMetricMinuteAggregateMaterializedView` migration).
 *   - Provide a typed entry point if we ever need typed reads against
 *     the table (e.g. for diagnostics).
 *
 * AggregateFunction columns can't be read scalar-style — every read
 * must wrap the column in the matching `*Merge()` finalizer. The
 * generic `findBy` path is therefore not useful here and should not
 * be relied on.
 */
export class MetricItemAggMV1mService extends AnalyticsDatabaseService<MetricItemAggMV1m> {
  public constructor(clickhouseDatabase?: ClickhouseDatabase | undefined) {
    super({ modelType: MetricItemAggMV1m, database: clickhouseDatabase });
  }
}

export default new MetricItemAggMV1mService();
