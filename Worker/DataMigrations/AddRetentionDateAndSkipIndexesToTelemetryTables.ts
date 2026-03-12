import DataMigrationBase from "./DataMigrationBase";
import AnalyticsTableColumn from "Common/Types/AnalyticsDatabase/TableColumn";
import TableColumnType from "Common/Types/AnalyticsDatabase/TableColumnType";
import Log from "Common/Models/AnalyticsModels/Log";
import Span from "Common/Models/AnalyticsModels/Span";
import Metric from "Common/Models/AnalyticsModels/Metric";
import ExceptionInstance from "Common/Models/AnalyticsModels/ExceptionInstance";
import MonitorLog from "Common/Models/AnalyticsModels/MonitorLog";
import LogService from "Common/Server/Services/LogService";
import SpanService from "Common/Server/Services/SpanService";
import MetricService from "Common/Server/Services/MetricService";
import ExceptionInstanceService from "Common/Server/Services/ExceptionInstanceService";
import MonitorLogService from "Common/Server/Services/MonitorLogService";
import logger from "Common/Server/Utils/Logger";

export default class AddRetentionDateAndSkipIndexesToTelemetryTables extends DataMigrationBase {
  public constructor() {
    super("AddRetentionDateAndSkipIndexesToTelemetryTables");
  }

  public override async migrate(): Promise<void> {
    // Step 1: Add retentionDate column to all telemetry tables
    await this.addRetentionDateColumn(new Log(), LogService, "LogItem");
    await this.addRetentionDateColumn(new Span(), SpanService, "SpanItem");
    await this.addRetentionDateColumn(
      new Metric(),
      MetricService,
      "MetricItem",
    );
    await this.addRetentionDateColumn(
      new ExceptionInstance(),
      ExceptionInstanceService,
      "ExceptionItem",
    );
    await this.addRetentionDateColumn(
      new MonitorLog(),
      MonitorLogService,
      "MonitorLog",
    );

    // Step 2: Add skip indexes to Log table
    await this.addSkipIndex(
      LogService,
      "LogItem",
      "idx_severity",
      "severityText",
      "set(10)",
      4,
    );
    await this.addSkipIndex(
      LogService,
      "LogItem",
      "idx_trace_id",
      "traceId",
      "bloom_filter(0.01)",
      1,
    );
    await this.addSkipIndex(
      LogService,
      "LogItem",
      "idx_span_id",
      "spanId",
      "bloom_filter(0.01)",
      1,
    );
    // tokenbf_v1 requires assumeNotNull() wrapper for Nullable columns
    await this.addSkipIndex(
      LogService,
      "LogItem",
      "idx_body",
      "assumeNotNull(body)",
      "tokenbf_v1(10240, 3, 0)",
      4,
    );

    // Step 3: Add skip indexes to Span table
    await this.addSkipIndex(
      SpanService,
      "SpanItem",
      "idx_trace_id",
      "traceId",
      "bloom_filter(0.01)",
      1,
    );
    await this.addSkipIndex(
      SpanService,
      "SpanItem",
      "idx_span_id",
      "spanId",
      "bloom_filter(0.01)",
      1,
    );
    await this.addSkipIndex(
      SpanService,
      "SpanItem",
      "idx_status_code",
      "statusCode",
      "set(5)",
      4,
    );
    await this.addSkipIndex(
      SpanService,
      "SpanItem",
      "idx_name",
      "assumeNotNull(name)",
      "tokenbf_v1(10240, 3, 0)",
      4,
    );

    // Step 4: Add skip indexes to Metric table
    await this.addSkipIndex(
      MetricService,
      "MetricItem",
      "idx_name",
      "name",
      "bloom_filter(0.01)",
      1,
    );
    await this.addSkipIndex(
      MetricService,
      "MetricItem",
      "idx_service_type",
      "serviceType",
      "set(5)",
      4,
    );

    // Step 5: Add skip indexes to Exception table
    await this.addSkipIndex(
      ExceptionInstanceService,
      "ExceptionItem",
      "idx_exception_type",
      "exceptionType",
      "bloom_filter(0.01)",
      1,
    );
    await this.addSkipIndex(
      ExceptionInstanceService,
      "ExceptionItem",
      "idx_trace_id",
      "traceId",
      "bloom_filter(0.01)",
      1,
    );
    await this.addSkipIndex(
      ExceptionInstanceService,
      "ExceptionItem",
      "idx_span_id",
      "spanId",
      "bloom_filter(0.01)",
      1,
    );
    await this.addSkipIndex(
      ExceptionInstanceService,
      "ExceptionItem",
      "idx_fingerprint",
      "fingerprint",
      "bloom_filter(0.01)",
      1,
    );

    // Step 6: Apply ZSTD codecs to large text columns
    await this.executeWithLogging(
      LogService,
      `ALTER TABLE LogItem MODIFY COLUMN body Nullable(String) CODEC(ZSTD(3))`,
      "Apply ZSTD(3) codec to LogItem.body",
    );
    await this.executeWithLogging(
      ExceptionInstanceService,
      `ALTER TABLE ExceptionItem MODIFY COLUMN stackTrace Nullable(String) CODEC(ZSTD(3))`,
      "Apply ZSTD(3) codec to ExceptionItem.stackTrace",
    );
    await this.executeWithLogging(
      ExceptionInstanceService,
      `ALTER TABLE ExceptionItem MODIFY COLUMN message Nullable(String) CODEC(ZSTD(3))`,
      "Apply ZSTD(3) codec to ExceptionItem.message",
    );

    // Step 7: Set TTL on all tables
    await this.setTTL(LogService, "LogItem");
    await this.setTTL(SpanService, "SpanItem");
    await this.setTTL(MetricService, "MetricItem");
    await this.setTTL(ExceptionInstanceService, "ExceptionItem");
    await this.setTTL(MonitorLogService, "MonitorLog");

    /*
     * Step 8: Fix retentionDate for pre-existing rows that have epoch-zero value.
     * Without this fix, TTL would delete all pre-existing data on next merge.
     */
    await this.executeWithLogging(
      LogService,
      `ALTER TABLE LogItem UPDATE retentionDate = time + INTERVAL 15 DAY WHERE retentionDate = toDateTime('1970-01-01 00:00:00') SETTINGS mutations_sync=0`,
      "Fix retentionDate for existing LogItem rows",
    );
    await this.executeWithLogging(
      SpanService,
      `ALTER TABLE SpanItem UPDATE retentionDate = startTime + INTERVAL 15 DAY WHERE retentionDate = toDateTime('1970-01-01 00:00:00') SETTINGS mutations_sync=0`,
      "Fix retentionDate for existing SpanItem rows",
    );
    await this.executeWithLogging(
      MetricService,
      `ALTER TABLE MetricItem UPDATE retentionDate = time + INTERVAL 15 DAY WHERE retentionDate = toDateTime('1970-01-01 00:00:00') SETTINGS mutations_sync=0`,
      "Fix retentionDate for existing MetricItem rows",
    );
    await this.executeWithLogging(
      ExceptionInstanceService,
      `ALTER TABLE ExceptionItem UPDATE retentionDate = time + INTERVAL 15 DAY WHERE retentionDate = toDateTime('1970-01-01 00:00:00') SETTINGS mutations_sync=0`,
      "Fix retentionDate for existing ExceptionItem rows",
    );
    await this.executeWithLogging(
      MonitorLogService,
      `ALTER TABLE MonitorLog UPDATE retentionDate = time + INTERVAL 1 DAY WHERE retentionDate = toDateTime('1970-01-01 00:00:00') SETTINGS mutations_sync=0`,
      "Fix retentionDate for existing MonitorLog rows",
    );
  }

  private async addRetentionDateColumn(
    model: { tableColumns: Array<AnalyticsTableColumn> },
    service: {
      addColumnInDatabase: (column: AnalyticsTableColumn) => Promise<void>;
      getColumnTypeInDatabase: (
        column: AnalyticsTableColumn,
      ) => Promise<TableColumnType | null>;
    },
    tableName: string,
  ): Promise<void> {
    try {
      const column: AnalyticsTableColumn | undefined = model.tableColumns.find(
        (item: AnalyticsTableColumn) => {
          return item.key === "retentionDate";
        },
      );

      if (!column) {
        logger.warn(`retentionDate column not found in model for ${tableName}`);
        return;
      }

      const columnType: TableColumnType | null =
        await service.getColumnTypeInDatabase(column);

      if (!columnType) {
        await service.addColumnInDatabase(column);
        logger.info(`Added retentionDate column to ${tableName}`);
      }
    } catch (err) {
      logger.error(`Error adding retentionDate column to ${tableName}`);
      logger.error(err);
    }
  }

  private async addSkipIndex(
    service: { execute: (statement: string) => Promise<unknown> },
    tableName: string,
    indexName: string,
    columnExpression: string,
    indexType: string,
    granularity: number,
  ): Promise<void> {
    try {
      await service.execute(
        `ALTER TABLE ${tableName} ADD INDEX IF NOT EXISTS ${indexName} ${columnExpression} TYPE ${indexType} GRANULARITY ${granularity}`,
      );
      logger.info(
        `Added skip index ${indexName} on ${tableName}.${columnExpression}`,
      );
    } catch (err) {
      logger.error(
        `Error adding skip index ${indexName} to ${tableName}: ${err}`,
      );
    }
  }

  private async setTTL(
    service: { execute: (statement: string) => Promise<unknown> },
    tableName: string,
  ): Promise<void> {
    try {
      await service.execute(
        `ALTER TABLE ${tableName} MODIFY TTL retentionDate DELETE`,
      );
      logger.info(`Set TTL on ${tableName} using retentionDate column`);
    } catch (err) {
      logger.error(`Error setting TTL on ${tableName}: ${err}`);
    }
  }

  private async executeWithLogging(
    service: { execute: (statement: string) => Promise<unknown> },
    sql: string,
    description: string,
  ): Promise<void> {
    try {
      await service.execute(sql);
      logger.info(`${description} - SUCCESS`);
    } catch (err) {
      logger.error(`${description} - FAILED: ${err}`);
    }
  }

  public override async rollback(): Promise<void> {
    return;
  }
}
