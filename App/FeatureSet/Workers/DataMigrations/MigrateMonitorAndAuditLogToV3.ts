import DataMigrationBase from "./DataMigrationBase";
import ClickHouseMigrationUtil from "./ClickHouseMigrationUtil";
import AnalyticsTableManagement from "../Utils/AnalyticsDatabase/TableManegement";
import logger from "Common/Server/Utils/Logger";

/**
 * Time-partition the last two telemetry tables. `MonitorLog` and `AuditLog`
 * were `sipHash64(projectId) % 16` partitioned; the models now use
 * `toYYYYMMDD(time)` (daily) and `toYYYYMM(createdAt)` (monthly) respectively
 * (+ `ttl_only_drop_parts`). The partition key is fixed at table creation, so
 * they are cut to new names (`MonitorLogV3`, `AuditLogV2`) and data is copied.
 *
 * No column rename here, so the copy uses an explicit name-matched column
 * list (robust to physical column-order drift from past ALTERs) restricted to
 * columns present on both tables. The copy runs partition-by-partition with
 * progress recorded in `TelemetryV3CopyProgress`; any failure is re-thrown so
 * the migration is NOT marked executed and the next boot resumes from the
 * partitions that are still missing. The old tables are retained as a
 * rollback window (TTL self-drains).
 */
export default class MigrateMonitorAndAuditLogToV3 extends DataMigrationBase {
  public constructor() {
    super("MigrateMonitorAndAuditLogToV3");
  }

  public override async migrate(): Promise<void> {
    // Ensure the new time-partitioned tables exist (idempotent).
    await AnalyticsTableManagement.createTables();

    const copies: Array<[string, string]> = [
      ["MonitorLogV2", "MonitorLogV3"],
      ["AuditLogV1", "AuditLogV2"],
    ];

    const errors: Array<string> = [];

    for (const [src, dst] of copies) {
      if (!(await ClickHouseMigrationUtil.tableExists(src))) {
        logger.info(
          `MigrateMonitorAndAuditLogToV3: ${src} not present — skipping copy.`,
        );
        continue;
      }

      errors.push(
        ...(await ClickHouseMigrationUtil.copyTablePartitionwise({
          sourceTable: src,
          destinationTable: dst,
          logPrefix: "MigrateMonitorAndAuditLogToV3",
        })),
      );
    }

    /*
     * Throw on any failed copy so the runner does NOT mark this migration
     * executed — the next boot retries it, and the progress marker limits
     * the rework to the partitions that are still missing.
     */
    if (errors.length > 0) {
      throw new Error(
        `MigrateMonitorAndAuditLogToV3: ${errors.length} copy step(s) failed:\n${errors.join("\n")}`,
      );
    }
  }

  public override async rollback(): Promise<void> {
    return;
  }
}
