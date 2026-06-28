import AnalyticsDatabaseService from "./AnalyticsDatabaseService";
import ClickhouseDatabase from "../Infrastructure/ClickhouseDatabase";
import MetricItemAggMV1mByAttributeKeys from "../../Models/AnalyticsModels/MetricItemAggMV1mByAttributeKeys";

/**
 * Read-side service for the `MetricItemAggMV1mByAttributeKeys` MV target table
 * (Phase 3). Registered in AnalyticsServices ONLY when the attribute-key MV
 * flag is on, because its MV fans each metric insert across its attributes
 * (see the model's fan-out warning). Reads go through
 * `MetricService.tryBuildAttributeKeyMVStatement` with raw SQL; this service
 * exists so the auto-create flow manages the table + MV on boot when enabled.
 *
 * AggregateFunction columns require `*Merge()` finalizers at read time, so the
 * generic typed `findBy` path is not useful against this table.
 */
export class MetricItemAggMV1mByAttributeKeysService extends AnalyticsDatabaseService<MetricItemAggMV1mByAttributeKeys> {
  public constructor(clickhouseDatabase?: ClickhouseDatabase | undefined) {
    super({
      modelType: MetricItemAggMV1mByAttributeKeys,
      database: clickhouseDatabase,
    });
  }
}

export default new MetricItemAggMV1mByAttributeKeysService();
