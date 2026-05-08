import DataMigrationBase from "./DataMigrationBase";
import LogService from "Common/Server/Services/LogService";
import SpanService from "Common/Server/Services/SpanService";
import MetricService from "Common/Server/Services/MetricService";
import ProfileService from "Common/Server/Services/ProfileService";
import logger from "Common/Server/Utils/Logger";

/*
 * Add bloom_filter skip indexes on `attributeKeys` for telemetry
 * tables.
 *
 * Why:
 *   Telemetry rows store user-defined attributes both as a
 *   Map(String, String) (`attributes`) and as a parallel
 *   Array(String) of just the keys (`attributeKeys`). Search-bar
 *   facet endpoints (`getFacetValues`, `getAnalyticsTopList`,
 *   etc.) currently filter rows down to those carrying a given
 *   attribute key by calling `mapKeys(attributes)` /
 *   `arrayExists(... mapKeys(attributes) ...)`, which iterates
 *   every key on every row and cannot use any index.
 *
 *   A bloom_filter on `attributeKeys` lets ClickHouse skip whole
 *   granules where the key isn't present without ever
 *   materializing the Map. Combined with the case-insensitive
 *   equality fast path now used by the dashboard's host filter
 *   (StatementGenerator), this is the structural change that
 *   makes attribute-filtered queries scale.
 *
 *   The index also benefits any future query rewrite that
 *   prefilters via `has(attributeKeys, 'k')` before falling back
 *   to a Map-side check.
 *
 * Scope:
 *   LogItemV2, SpanItemV2, MetricItemV2, ProfileItemV2.
 *   ExceptionItem doesn't carry an `attributeKeys` column today
 *   and is excluded.
 */
export default class AddAttributeKeysSkipIndexToTelemetryTables extends DataMigrationBase {
  public constructor() {
    super("AddAttributeKeysSkipIndexToTelemetryTables");
  }

  public override async migrate(): Promise<void> {
    await this.addAttributeKeysIndex(LogService, "LogItemV2");
    await this.addAttributeKeysIndex(SpanService, "SpanItemV2");
    await this.addAttributeKeysIndex(MetricService, "MetricItemV2");
    await this.addAttributeKeysIndex(ProfileService, "ProfileItemV2");
  }

  private async addAttributeKeysIndex(
    service: { execute: (statement: string) => Promise<unknown> },
    tableName: string,
  ): Promise<void> {
    /*
     * GRANULARITY 1 means the index is consulted at every granule
     * boundary; with the default granularity of 8192 rows that's
     * roughly one bloom check per ~8k rows scanned. params (0.01)
     * is the false-positive rate target — small enough to be
     * useful, big enough that the index stays compact.
     */
    try {
      await service.execute(
        `ALTER TABLE ${tableName} ADD INDEX IF NOT EXISTS idx_attribute_keys attributeKeys TYPE bloom_filter(0.01) GRANULARITY 1`,
      );
      logger.info(
        `Added skip index idx_attribute_keys on ${tableName}.attributeKeys`,
      );
    } catch (err) {
      logger.error(
        `Error adding skip index idx_attribute_keys to ${tableName}: ${err}`,
      );
    }
  }

  public override async rollback(): Promise<void> {
    return;
  }
}
