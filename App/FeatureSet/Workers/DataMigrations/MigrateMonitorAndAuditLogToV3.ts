import DataMigrationBase from "./DataMigrationBase";
import ClickHouseMigrationUtil, {
  ChunkedCopyResult,
} from "./ClickHouseMigrationUtil";
import AnalyticsTableManagement from "../Utils/AnalyticsDatabase/TableManegement";
import logger from "Common/Server/Utils/Logger";
import AuditLog from "Common/Models/AnalyticsModels/AuditLog";
import MonitorLog from "Common/Models/AnalyticsModels/MonitorLog";

/**
 * Time-partition the last two telemetry tables. `MonitorLog` and `AuditLog`
 * were `sipHash64(projectId) % 16` partitioned; the models now use
 * `toYYYYMMDD(time)` (daily) and `toYYYYMM(createdAt)` (monthly) respectively
 * (+ `ttl_only_drop_parts`). The partition key is fixed at table creation, so
 * they are cut to new names (`MonitorLogV3`, `AuditLogV2`) and data is copied.
 *
 * Unlike the six OTLP signal tables (whose far larger copy is owned by the
 * Telemetry:BackfillTelemetryV3 cron), these two are small enough to copy
 * inline — but through the same chunked engine: (partition × month) chunks,
 * deterministic ORDER BY + per-chunk insert_deduplication_token (so a
 * retried chunk dedups instead of duplicating), HTTP progress headers (so
 * the client's 58s socket idle timer cannot kill a long statement), and
 * system.processes / system.query_log recovery for attempts whose client
 * died. Sort keys / time columns come from the destination models. Chunk
 * progress lands in `TelemetryV3CopyProgress`; any copy failure is re-thrown
 * so the migration is NOT marked executed and the next boot resumes from the
 * chunks that are still missing.
 *
 * Rows old-code pods write to the OLD tables after their chunk was copied
 * (the rolling-deploy tail) are not swept here — a short gap in monitor/audit
 * history bounded by the deploy window, accepted since this table pair's
 * original design. The old tables are retained as a rollback window (TTL
 * self-drains).
 */
export default class MigrateMonitorAndAuditLogToV3 extends DataMigrationBase {
  public constructor() {
    super("MigrateMonitorAndAuditLogToV3");
  }

  public override async migrate(): Promise<void> {
    // Ensure the new time-partitioned tables exist (idempotent).
    await AnalyticsTableManagement.createTables();
    await ClickHouseMigrationUtil.ensureCopyProgressTable();

    const monitorLogModel: MonitorLog = new MonitorLog();
    const auditLogModel: AuditLog = new AuditLog();

    const copies: Array<{
      sourceTable: string;
      destinationTable: string;
      timeColumn: string;
      destinationSortKeys: Array<string>;
    }> = [
      {
        sourceTable: "MonitorLogV2",
        destinationTable: monitorLogModel.tableName,
        timeColumn:
          ClickHouseMigrationUtil.getPartitionTimeColumn(monitorLogModel),
        destinationSortKeys: monitorLogModel.sortKeys,
      },
      {
        sourceTable: "AuditLogV1",
        destinationTable: auditLogModel.tableName,
        timeColumn:
          ClickHouseMigrationUtil.getPartitionTimeColumn(auditLogModel),
        destinationSortKeys: auditLogModel.sortKeys,
      },
    ];

    const errors: Array<string> = [];

    for (const copy of copies) {
      if (!(await ClickHouseMigrationUtil.tableExists(copy.sourceTable))) {
        logger.info(
          `MigrateMonitorAndAuditLogToV3: ${copy.sourceTable} not present — skipping copy.`,
        );
        continue;
      }

      const result: ChunkedCopyResult =
        await ClickHouseMigrationUtil.copyTableChunked({
          sourceTable: copy.sourceTable,
          destinationTable: copy.destinationTable,
          timeColumn: copy.timeColumn,
          destinationSortKeys: copy.destinationSortKeys,
          logPrefix: "MigrateMonitorAndAuditLogToV3",
        });

      logger.info(
        `MigrateMonitorAndAuditLogToV3: ${copy.sourceTable} -> ${copy.destinationTable}: ${result.chunksAlreadyCopied + result.chunksCopiedNow + result.chunksRecovered}/${result.totalChunks} chunks done (${result.chunksCopiedNow} copied now, ${result.chunksRecovered} recovered, ${result.chunksSkippedStillRunning} still running).`,
      );

      errors.push(...result.errors);

      if (result.chunksSkippedStillRunning > 0) {
        errors.push(
          `${copy.sourceTable}: ${result.chunksSkippedStillRunning} chunk(s) still running from a previous attempt — retry next boot.`,
        );
      }
    }

    /*
     * Throw on any failed/deferred chunk so the runner does NOT mark this
     * migration executed — the next boot retries it, and the progress
     * marker plus per-chunk dedup tokens limit the rework to the chunks
     * that are still missing (without duplicating rows).
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
