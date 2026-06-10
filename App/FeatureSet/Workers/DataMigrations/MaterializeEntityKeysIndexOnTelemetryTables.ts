import DataMigrationBase from "./DataMigrationBase";
import MetricService from "Common/Server/Services/MetricService";
import logger from "Common/Server/Utils/Logger";

/**
 * Materializes the `idx_entity_keys` bloom-filter skip index on every
 * signal table for parts written BEFORE the index existed.
 *
 * `ADD INDEX` (AddEntityKeysToTelemetryTables) only indexes parts written
 * after it ran — granules in older parts have no bloom data, so a
 * `has(entityKeys, :key)` read still scans them in full. MATERIALIZE
 * INDEX builds the index files for existing parts in a background
 * mutation (mutations_sync=0 — same pattern as
 * AddHistogramProjectionToSpanTable; a synchronous materialization on a
 * billions-of-rows table would time the migration out).
 *
 * Old rows carry `entityKeys = []` (no backfill, by decision), so for
 * them the index "matches nothing" — exactly right, the bloom probe
 * skips those granules for any key lookup.
 *
 * Must run after AddEntityKeysToTelemetryTables (index must exist).
 * Idempotent: re-materializing an already-materialized index is a no-op
 * mutation. All statements run through MetricService — every analytics
 * service shares one ClickHouse connection, and each statement names its
 * own table.
 */
export default class MaterializeEntityKeysIndexOnTelemetryTables extends DataMigrationBase {
  public constructor() {
    super("MaterializeEntityKeysIndexOnTelemetryTables");
  }

  private static readonly signalTables: ReadonlyArray<string> = [
    "LogItemV3",
    "MetricItemV3",
    "SpanItemV3",
    "ExceptionItemV3",
    "ProfileItemV3",
    "ProfileSampleItemV3",
  ];

  public override async migrate(): Promise<void> {
    for (const tableName of MaterializeEntityKeysIndexOnTelemetryTables.signalTables) {
      await MetricService.execute(
        `ALTER TABLE ${tableName} MATERIALIZE INDEX idx_entity_keys SETTINGS mutations_sync=0`,
      );
      logger.info(
        `MaterializeEntityKeysIndexOnTelemetryTables: started async materialization of idx_entity_keys on ${tableName}`,
      );
    }
  }

  public override async rollback(): Promise<void> {
    return;
  }
}
