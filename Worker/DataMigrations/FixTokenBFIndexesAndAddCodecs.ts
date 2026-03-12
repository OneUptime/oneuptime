import DataMigrationBase from "./DataMigrationBase";
import LogService from "Common/Server/Services/LogService";
import SpanService from "Common/Server/Services/SpanService";
import MetricService from "Common/Server/Services/MetricService";
import ExceptionInstanceService from "Common/Server/Services/ExceptionInstanceService";
import MonitorLogService from "Common/Server/Services/MonitorLogService";
import logger from "Common/Server/Utils/Logger";

export default class FixTokenBFIndexesAndAddCodecs extends DataMigrationBase {
  public constructor() {
    super("FixTokenBFIndexesAndAddCodecs");
  }

  public override async migrate(): Promise<void> {
    /*
     * Fix tokenbf_v1 indexes on Nullable columns by using assumeNotNull() wrapper.
     * The original migration failed silently because ClickHouse does not support
     * tokenbf_v1 on Nullable columns.
     */

    // Fix LogItem.body tokenbf_v1 index
    await this.executeWithLogging(
      LogService,
      `ALTER TABLE LogItem ADD INDEX IF NOT EXISTS idx_body assumeNotNull(body) TYPE tokenbf_v1(10240, 3, 0) GRANULARITY 4`,
      "Add tokenbf_v1 index on LogItem.body with assumeNotNull",
    );

    // Fix SpanItem.name tokenbf_v1 index
    await this.executeWithLogging(
      SpanService,
      `ALTER TABLE SpanItem ADD INDEX IF NOT EXISTS idx_name assumeNotNull(name) TYPE tokenbf_v1(10240, 3, 0) GRANULARITY 4`,
      "Add tokenbf_v1 index on SpanItem.name with assumeNotNull",
    );

    /*
     * Apply ZSTD codecs to existing columns.
     * The codec was defined in the model but never applied to existing tables via migration.
     */

    // LogItem.body -> ZSTD(3)
    await this.executeWithLogging(
      LogService,
      `ALTER TABLE LogItem MODIFY COLUMN body Nullable(String) CODEC(ZSTD(3))`,
      "Apply ZSTD(3) codec to LogItem.body",
    );

    // ExceptionItem.stackTrace -> ZSTD(3)
    await this.executeWithLogging(
      ExceptionInstanceService,
      `ALTER TABLE ExceptionItem MODIFY COLUMN stackTrace Nullable(String) CODEC(ZSTD(3))`,
      "Apply ZSTD(3) codec to ExceptionItem.stackTrace",
    );

    // ExceptionItem.message -> ZSTD(3)
    await this.executeWithLogging(
      ExceptionInstanceService,
      `ALTER TABLE ExceptionItem MODIFY COLUMN message Nullable(String) CODEC(ZSTD(3))`,
      "Apply ZSTD(3) codec to ExceptionItem.message",
    );

    /*
     * Fix retentionDate for pre-existing data.
     * The retentionDate column was added without a DEFAULT expression, so all
     * rows ingested before the migration have retentionDate = 1970-01-01 (epoch zero).
     * With TTL retentionDate DELETE, ClickHouse would delete all these rows on merge.
     * We fix this by setting retentionDate = time + 15 days (default retention) for
     * all rows that still have the epoch-zero value.
     */

    // Fix LogItem retentionDate
    await this.executeWithLogging(
      LogService,
      `ALTER TABLE LogItem UPDATE retentionDate = time + INTERVAL 15 DAY WHERE retentionDate = toDateTime('1970-01-01 00:00:00') SETTINGS mutations_sync=0`,
      "Fix retentionDate for existing LogItem rows",
    );

    // Fix SpanItem retentionDate
    await this.executeWithLogging(
      SpanService,
      `ALTER TABLE SpanItem UPDATE retentionDate = startTime + INTERVAL 15 DAY WHERE retentionDate = toDateTime('1970-01-01 00:00:00') SETTINGS mutations_sync=0`,
      "Fix retentionDate for existing SpanItem rows",
    );

    // Fix MetricItem retentionDate
    await this.executeWithLogging(
      MetricService,
      `ALTER TABLE MetricItem UPDATE retentionDate = time + INTERVAL 15 DAY WHERE retentionDate = toDateTime('1970-01-01 00:00:00') SETTINGS mutations_sync=0`,
      "Fix retentionDate for existing MetricItem rows",
    );

    // Fix ExceptionItem retentionDate
    await this.executeWithLogging(
      ExceptionInstanceService,
      `ALTER TABLE ExceptionItem UPDATE retentionDate = time + INTERVAL 15 DAY WHERE retentionDate = toDateTime('1970-01-01 00:00:00') SETTINGS mutations_sync=0`,
      "Fix retentionDate for existing ExceptionItem rows",
    );

    // Fix MonitorLog retentionDate
    await this.executeWithLogging(
      MonitorLogService,
      `ALTER TABLE MonitorLog UPDATE retentionDate = time + INTERVAL 1 DAY WHERE retentionDate = toDateTime('1970-01-01 00:00:00') SETTINGS mutations_sync=0`,
      "Fix retentionDate for existing MonitorLog rows",
    );
  }

  private async executeWithLogging(
    service: { execute: (statement: string) => Promise<unknown> },
    sql: string,
    description: string,
  ): Promise<void> {
    try {
      await service.execute(sql);
      logger.info(`FixTokenBFIndexesAndAddCodecs: ${description} - SUCCESS`);
    } catch (err) {
      logger.error(
        `FixTokenBFIndexesAndAddCodecs: ${description} - FAILED: ${err}`,
      );
    }
  }

  public override async rollback(): Promise<void> {
    return;
  }
}
