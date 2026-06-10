import DataMigrationBase from "./DataMigrationBase";
import AnalyticsDatabaseService from "Common/Server/Services/AnalyticsDatabaseService";
import LogService from "Common/Server/Services/LogService";
import MetricService from "Common/Server/Services/MetricService";
import SpanService from "Common/Server/Services/SpanService";
import ExceptionInstanceService from "Common/Server/Services/ExceptionInstanceService";
import ProfileService from "Common/Server/Services/ProfileService";
import ProfileSampleService from "Common/Server/Services/ProfileSampleService";
import MonitorLogService from "Common/Server/Services/MonitorLogService";
import AuditLogService from "Common/Server/Services/AuditLogService";
import MetricItemAggMV1mService from "Common/Server/Services/MetricItemAggMV1mService";
import MetricBaselineService from "Common/Server/Services/MetricBaselineService";
import logger from "Common/Server/Utils/Logger";

/**
 * Adds `CODEC(ZSTD(1))` to the `_id` column on every analytics table
 * (signal tables + the MV target tables that gained `_id` in
 * AddIdAndTimestampsToMVTargetTables — hence this must run after it).
 *
 * Why this is worth a migration now: `_id`s switched from random UUIDv4
 * to time-ordered UUIDv7 (`ObjectID.generateTimeOrdered()`), so
 * consecutive rows share their 48-bit unix-ms timestamp prefix and ZSTD
 * finally has redundancy to exploit; random v4 ids were incompressible
 * and `_id` was one of the largest uncompressed columns per row. The
 * model declares the codec for fresh installs (AnalyticsBaseModel); this
 * applies it to already-created tables.
 *
 * CODEC-only ALTER (type re-stated unchanged from system.columns), so it
 * is metadata-only for the column type and safe to re-run —
 * setColumnCodecIfNotSet skips columns that already carry the codec.
 *
 * The deprecated `MetricItemAggMV1mByHost` table is intentionally
 * excluded: the very next migration (RekeyMetricHostRollupToEntityKey)
 * drops it, and its V2 replacement is created with the codec from the
 * model. Failures are collected and re-thrown so a partial run retries.
 */
export default class AddZstdCodecToTelemetryIdColumns extends DataMigrationBase {
  public constructor() {
    super("AddZstdCodecToTelemetryIdColumns");
  }

  public override async migrate(): Promise<void> {
    const services: ReadonlyArray<AnalyticsDatabaseService<any>> = [
      LogService,
      MetricService,
      SpanService,
      ExceptionInstanceService,
      ProfileService,
      ProfileSampleService,
      MonitorLogService,
      AuditLogService,
      MetricItemAggMV1mService,
      MetricBaselineService,
    ];

    const errors: Array<string> = [];

    for (const service of services) {
      const tableName: string = service.model.tableName;
      try {
        const currentType: string =
          await service.getColumnDatabaseType("_id");

        if (!currentType) {
          // Table without _id (or table missing) — nothing to do.
          logger.info(
            `AddZstdCodecToTelemetryIdColumns: ${tableName} has no _id column, skipping`,
          );
          continue;
        }

        await service.setColumnCodecIfNotSet({
          columnName: "_id",
          columnType: currentType,
          codec: "ZSTD(1)",
          expectedCodecValue: "CODEC(ZSTD(1))",
        });
      } catch (err) {
        logger.error(
          `AddZstdCodecToTelemetryIdColumns: failed on ${tableName}._id:`,
        );
        logger.error(err as Error);
        errors.push(`${tableName}._id: ${(err as Error).message}`);
      }
    }

    if (errors.length > 0) {
      throw new Error(
        `AddZstdCodecToTelemetryIdColumns: ${errors.length} failure(s): ${errors.join("; ")}`,
      );
    }
  }

  public override async rollback(): Promise<void> {
    return;
  }
}
