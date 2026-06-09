import DataMigrationBase from "./DataMigrationBase";
import MetricService from "Common/Server/Services/MetricService";
import logger from "Common/Server/Utils/Logger";

/**
 * Drops the `updatedAt` column from the analytics tables. Telemetry is
 * append-only — rows are never updated — so `updatedAt` was dead weight on
 * every row (always equal to `createdAt`). It has been removed from
 * `AnalyticsBaseModel`, so new installs never create it; this migration
 * drops it from already-created tables. `_id`/`createdAt` are retained.
 *
 * `DROP COLUMN IF EXISTS` is idempotent. None of the Span projections
 * reference `updatedAt`, so the drop is unobstructed.
 */
export default class DropUpdatedAtFromTelemetryTables extends DataMigrationBase {
  public constructor() {
    super("DropUpdatedAtFromTelemetryTables");
  }

  public override async migrate(): Promise<void> {
    const tables: Array<string> = [
      "LogItemV3",
      "MetricItemV3",
      "SpanItemV3",
      "ExceptionItemV3",
      "ProfileItemV3",
      "ProfileSampleItemV3",
      "MonitorLogV3",
      "AuditLogV2",
      "MetricItemAggMV1m",
      "MetricItemAggMV1mByHost",
      "MetricBaselineHourly",
    ];
    for (const table of tables) {
      try {
        await MetricService.execute(
          `ALTER TABLE ${table} DROP COLUMN IF EXISTS updatedAt`,
        );
        logger.info(`DropUpdatedAtFromTelemetryTables: dropped updatedAt from ${table}`);
      } catch (err) {
        logger.error(`DropUpdatedAtFromTelemetryTables: failed on ${table}:`);
        logger.error(err as Error);
      }
    }
  }

  public override async rollback(): Promise<void> {
    return;
  }
}
