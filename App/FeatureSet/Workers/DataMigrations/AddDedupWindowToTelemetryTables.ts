import DataMigrationBase from "./DataMigrationBase";
import MetricService from "Common/Server/Services/MetricService";
import logger from "Common/Server/Utils/Logger";

/**
 * Sets `non_replicated_deduplication_window = 10000` on the six OTLP
 * signal tables. The telemetry queue worker stamps an
 * `insert_deduplication_token` per (job, table, chunk) so a stalled-job
 * requeue re-inserting the same chunk is dropped instead of
 * double-counted — but on plain (non-replicated) MergeTree the token is
 * ignored unless this window is > 0 (image default 0). Verified
 * empirically on dev CH 25.7: with the window set, duplicate tokens
 * dedup for both sync and async (wait_for_async_insert=1 +
 * async_insert_deduplicate=1) inserts.
 *
 * Window sizing: one entry per inserted block (~750-1000 rows/chunk);
 * 10000 entries of block hashes are negligible memory but cover several
 * minutes of high-rate ingest — enough for BullMQ's 10-minute stalled
 * lock to expire and the retry to land inside the window on all but the
 * very hottest tables (token eviction degrades to today's
 * double-count, never to data loss).
 *
 * New installs get this from the model `tableSettings` at CREATE time;
 * this migration applies it to already-created tables. MODIFY SETTING
 * is idempotent and metadata-only.
 */
export default class AddDedupWindowToTelemetryTables extends DataMigrationBase {
  public constructor() {
    super("AddDedupWindowToTelemetryTables");
  }

  public override async migrate(): Promise<void> {
    const tables: Array<string> = [
      "LogItemV3",
      "MetricItemV3",
      "SpanItemV3",
      "ExceptionItemV3",
      "ProfileItemV3",
      "ProfileSampleItemV3",
    ];
    for (const table of tables) {
      try {
        await MetricService.execute(
          `ALTER TABLE ${table} MODIFY SETTING non_replicated_deduplication_window = 10000`,
        );
        logger.info(
          `AddDedupWindowToTelemetryTables: set non_replicated_deduplication_window=10000 on ${table}`,
        );
      } catch (err) {
        logger.error(`AddDedupWindowToTelemetryTables: failed on ${table}:`);
        logger.error(err as Error);
      }
    }
  }

  public override async rollback(): Promise<void> {
    return;
  }
}
