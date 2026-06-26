import DataMigrationBase from "./DataMigrationBase";
import AnalyticsDatabaseService from "Common/Server/Services/AnalyticsDatabaseService";
import LogService from "Common/Server/Services/LogService";
import MetricService from "Common/Server/Services/MetricService";
import SpanService from "Common/Server/Services/SpanService";
import ExceptionInstanceService from "Common/Server/Services/ExceptionInstanceService";
import ProfileService from "Common/Server/Services/ProfileService";
import ProfileSampleService from "Common/Server/Services/ProfileSampleService";
import MonitorLogService from "Common/Server/Services/MonitorLogService";
import logger from "Common/Server/Utils/Logger";

/**
 * Codec + LowCardinality sweep for the V3 telemetry tables, aligning the
 * live schema with what the analytics models now declare. The V3 cut
 * created these tables before several model codecs landed, so live
 * columns diverge from the models (verified against the dev instance via
 * system.columns on 2026-06-10):
 *
 *   - DateTime64 time columns + retentionDate get DoubleDelta+ZSTD(1).
 *     Measured on the same data: codec-less Log.time compressed ~2.5x
 *     while DoubleDelta'd Metric.time hit ~108x — timestamps are the
 *     canonical DoubleDelta case because rows arrive roughly sorted.
 *   - EXCEPTION — Span.endTime / Span.endTimeUnixNano get plain ZSTD(1),
 *     REPLACING the counterproductive DoubleDelta on endTimeUnixNano:
 *     spans sort by startTime, so consecutive endTime deltas jump with
 *     span duration and the double-delta transform inflates instead of
 *     shrinking (measured ~2.9x with DoubleDelta vs ~4-6x plain ZSTD).
 *   - attributes / attributeKeys / entityKeys / body-family blobs
 *     (Span.name, parsedFrames) that are still codec-less get ZSTD(3).
 *   - Log/Exception traceId + spanId get ZSTD(1) (Span/Metric/Profile
 *     already have it).
 *   - Metric.aggregationTemporality (enum-shaped: Delta / Cumulative)
 *     becomes LowCardinality — the only enum-shaped String the V3 cut
 *     missed; primaryEntityType / severityText / kind / metricPointType
 *     are already LowCardinality live. Span.statusCode stays Int32:
 *     LowCardinality over numeric types is prohibited by default in
 *     ClickHouse and buys nothing over plain Int32 compression.
 *
 * Every change is a MODIFY COLUMN that re-states the column's EXACT live
 * type read from system.columns at run time (getColumnDatabaseType), so
 * type strings can never drift from the live schema. Codec-only changes
 * don't touch skip indexes; mutations run async (mutations_sync=0).
 * setColumnCodecIfNotSet skips already-converted columns, so re-running
 * is safe. Failures are collected and re-thrown at the end so a partial
 * sweep is retried on the next boot.
 *
 * Must run after the V3 tables exist (MigrateTelemetryToV3PrimaryEntityId)
 * and after entityKeys exists (AddEntityKeysToTelemetryTables).
 */

const TIMESTAMP_CODEC: string = "DoubleDelta, ZSTD(1)";
const BLOB_CODEC: string = "ZSTD(3)";
const PLAIN_CODEC: string = "ZSTD(1)";

interface CodecChange {
  service: AnalyticsDatabaseService<any>;
  columnName: string;
  codec: string;
}

export default class AddTelemetryV3ColumnCodecs extends DataMigrationBase {
  public constructor() {
    super("AddTelemetryV3ColumnCodecs");
  }

  public override runsInClusterMode(): boolean {
    return false;
  }

  public override async migrate(): Promise<void> {
    const changes: Array<CodecChange> = [
      // LogItemV3
      { service: LogService, columnName: "time", codec: TIMESTAMP_CODEC },
      {
        service: LogService,
        columnName: "retentionDate",
        codec: TIMESTAMP_CODEC,
      },
      { service: LogService, columnName: "entityKeys", codec: BLOB_CODEC },
      { service: LogService, columnName: "traceId", codec: PLAIN_CODEC },
      { service: LogService, columnName: "spanId", codec: PLAIN_CODEC },

      // SpanItemV3
      { service: SpanService, columnName: "startTime", codec: TIMESTAMP_CODEC },
      // Plain ZSTD on the end-time pair — see the header comment.
      { service: SpanService, columnName: "endTime", codec: PLAIN_CODEC },
      {
        service: SpanService,
        columnName: "endTimeUnixNano",
        codec: PLAIN_CODEC,
      },
      {
        service: SpanService,
        columnName: "retentionDate",
        codec: TIMESTAMP_CODEC,
      },
      { service: SpanService, columnName: "attributes", codec: BLOB_CODEC },
      { service: SpanService, columnName: "attributeKeys", codec: BLOB_CODEC },
      { service: SpanService, columnName: "name", codec: BLOB_CODEC },
      { service: SpanService, columnName: "entityKeys", codec: BLOB_CODEC },

      // MetricItemV3 (time/retentionDate/attributes already carry codecs)
      { service: MetricService, columnName: "entityKeys", codec: BLOB_CODEC },

      // ExceptionItemV3
      {
        service: ExceptionInstanceService,
        columnName: "time",
        codec: TIMESTAMP_CODEC,
      },
      {
        service: ExceptionInstanceService,
        columnName: "retentionDate",
        codec: TIMESTAMP_CODEC,
      },
      {
        service: ExceptionInstanceService,
        columnName: "attributes",
        codec: BLOB_CODEC,
      },
      {
        service: ExceptionInstanceService,
        columnName: "entityKeys",
        codec: BLOB_CODEC,
      },
      {
        service: ExceptionInstanceService,
        columnName: "parsedFrames",
        codec: BLOB_CODEC,
      },
      {
        service: ExceptionInstanceService,
        columnName: "traceId",
        codec: PLAIN_CODEC,
      },
      {
        service: ExceptionInstanceService,
        columnName: "spanId",
        codec: PLAIN_CODEC,
      },

      // ProfileItemV3
      {
        service: ProfileService,
        columnName: "startTime",
        codec: TIMESTAMP_CODEC,
      },
      {
        service: ProfileService,
        columnName: "endTime",
        codec: TIMESTAMP_CODEC,
      },
      {
        service: ProfileService,
        columnName: "retentionDate",
        codec: TIMESTAMP_CODEC,
      },
      { service: ProfileService, columnName: "attributes", codec: BLOB_CODEC },
      {
        service: ProfileService,
        columnName: "attributeKeys",
        codec: BLOB_CODEC,
      },
      { service: ProfileService, columnName: "entityKeys", codec: BLOB_CODEC },

      // ProfileSampleItemV3
      {
        service: ProfileSampleService,
        columnName: "time",
        codec: TIMESTAMP_CODEC,
      },
      {
        service: ProfileSampleService,
        columnName: "retentionDate",
        codec: TIMESTAMP_CODEC,
      },
      {
        service: ProfileSampleService,
        columnName: "entityKeys",
        codec: BLOB_CODEC,
      },

      // MonitorLogV3
      {
        service: MonitorLogService,
        columnName: "time",
        codec: TIMESTAMP_CODEC,
      },
      {
        service: MonitorLogService,
        columnName: "retentionDate",
        codec: TIMESTAMP_CODEC,
      },
    ];

    const errors: Array<string> = [];

    for (const change of changes) {
      const tableName: string = change.service.model.tableName;
      try {
        await this.applyCodec(change);
      } catch (err) {
        logger.error(
          `AddTelemetryV3ColumnCodecs: failed on ${tableName}.${change.columnName}:`,
        );
        logger.error(err as Error);
        errors.push(
          `${tableName}.${change.columnName}: ${(err as Error).message}`,
        );
      }
    }

    try {
      await this.makeLowCardinality(MetricService, "aggregationTemporality");
    } catch (err) {
      logger.error(
        "AddTelemetryV3ColumnCodecs: failed converting MetricItemV3.aggregationTemporality to LowCardinality:",
      );
      logger.error(err as Error);
      errors.push(
        `MetricItemV3.aggregationTemporality: ${(err as Error).message}`,
      );
    }

    if (errors.length > 0) {
      throw new Error(
        `AddTelemetryV3ColumnCodecs: ${errors.length} failure(s): ${errors.join("; ")}`,
      );
    }
  }

  /**
   * Re-states the column's exact live type (from system.columns) and sets
   * the codec. Skips missing columns and columns already on the target
   * codec. CODEC-only — skip indexes on the column survive untouched.
   */
  private async applyCodec(change: CodecChange): Promise<void> {
    const currentType: string = await change.service.getColumnDatabaseType(
      change.columnName,
    );

    if (!currentType) {
      logger.info(
        `AddTelemetryV3ColumnCodecs: ${change.service.model.tableName}.${change.columnName} not found, skipping`,
      );
      return;
    }

    await change.service.setColumnCodecIfNotSet({
      columnName: change.columnName,
      columnType: currentType,
      codec: change.codec,
      expectedCodecValue: `CODEC(${change.codec})`,
    });
  }

  /**
   * Wraps a String-typed column in LowCardinality(...), preserving the
   * live Nullable wrapper. Type-changing MODIFY COLUMN — the part rewrite
   * runs as a background mutation (mutations_sync=0). Idempotent: skips
   * when the live type is already LowCardinality.
   */
  private async makeLowCardinality(
    service: AnalyticsDatabaseService<any>,
    columnName: string,
  ): Promise<void> {
    const tableName: string = service.model.tableName;
    const currentType: string = await service.getColumnDatabaseType(columnName);

    if (!currentType) {
      logger.info(
        `AddTelemetryV3ColumnCodecs: ${tableName}.${columnName} not found, skipping LowCardinality conversion`,
      );
      return;
    }

    if (currentType.startsWith("LowCardinality(")) {
      logger.info(
        `AddTelemetryV3ColumnCodecs: ${tableName}.${columnName} is already ${currentType}, skipping`,
      );
      return;
    }

    await service.execute(
      `ALTER TABLE ${tableName} MODIFY COLUMN ${columnName} LowCardinality(${currentType}) SETTINGS mutations_sync=0`,
    );
    logger.info(
      `AddTelemetryV3ColumnCodecs: converting ${tableName}.${columnName} to LowCardinality(${currentType}) (async mutation)`,
    );
  }

  public override async rollback(): Promise<void> {
    return;
  }
}
