import DataMigrationBase from "./DataMigrationBase";
import AnalyticsDatabaseService from "Common/Server/Services/AnalyticsDatabaseService";
import LogService from "Common/Server/Services/LogService";
import SpanService from "Common/Server/Services/SpanService";
import MetricService from "Common/Server/Services/MetricService";
import logger from "Common/Server/Utils/Logger";

/*
 * Retrofits compression onto the high-volume telemetry tables that were
 * created without it:
 *
 *   1. Column CODECs on the Metric table (every numeric/array/map/timestamp
 *      column was uncompressed) and on the Log `attributes` map.
 *   2. Column CODECs on the Span table. The Span model already declares these
 *      codecs, but the migration that was meant to apply them to existing
 *      tables was never registered, so existing SpanItemV2 tables are still
 *      uncompressed on those columns.
 *
 * A CODEC-only change leaves the column TYPE unchanged, so it is a fast,
 * metadata-only ALTER (new and merged parts pick up the codec) and does NOT
 * require dropping the column's skip index — that is why the skip-indexed
 * columns (Span traceId / spanId / parentSpanId; Metric name / traceId /
 * spanId / attributeKeys) are handled by the same plain codec path as
 * everything else. Every statement is idempotent and runs with
 * mutations_sync=0.
 *
 * NOTE: this migration intentionally does NOT convert the low-distinct-value
 * String columns (serviceType, severityText, span kind, metricPointType) to
 * LowCardinality on existing tables. The models still declare isLowCardinality,
 * so freshly created tables are dictionary-encoded; but retrofitting it onto
 * the existing multi-hundred-GB telemetry tables required a type-changing
 * MODIFY COLUMN that could not acquire the table's alter lock (contended by the
 * constant delete-mutation stream) within the ClickHouse client request
 * timeout, so the migration timed out and never recorded as executed.
 * LowCardinality is query-transparent, so leaving those columns as String on
 * existing clusters changes no behaviour — only the storage / GROUP-BY-memory
 * optimization is forgone there.
 */
export default class AddTelemetryStorageCompression extends DataMigrationBase {
  public constructor() {
    super("AddTelemetryStorageCompression");
  }

  public override runsInClusterMode(): boolean {
    return false;
  }

  public override async migrate(): Promise<void> {
    await this.applyMetricCodecs();
    await this.applyLogCodecs();
    await this.applySpanCodecs();
  }

  private async applyMetricCodecs(): Promise<void> {
    /*
     * Timestamp columns that are fixed-width (<= 8 bytes) take DoubleDelta
     * before ZSTD. timeUnixNano / startTimeUnixNano are Int128 (16 bytes),
     * which DoubleDelta does not support, so they get plain ZSTD.
     */
    const timestampCodec: string = "DoubleDelta, ZSTD(1)";

    await this.applyCodec(MetricService, "time", timestampCodec);
    await this.applyCodec(MetricService, "retentionDate", timestampCodec);

    const zstd1Columns: Array<string> = [
      "startTime",
      "timeUnixNano",
      "startTimeUnixNano",
      "count",
      "sum",
      "value",
      "min",
      "max",
      "bucketCounts",
      "explicitBounds",
      "scale",
      "zeroCount",
      "positiveOffset",
      "positiveBucketCounts",
      "negativeOffset",
      "negativeBucketCounts",
      "summaryQuantiles",
      "summaryValues",
      /*
       * These carry skip indexes (idx_name tokenbf, idx_trace_id /
       * idx_span_id bloom). A CODEC-only change leaves the type unchanged, so
       * the index does not need to be dropped.
       */
      "name",
      "traceId",
      "spanId",
    ];

    for (const columnName of zstd1Columns) {
      await this.applyCodec(MetricService, columnName, "ZSTD(1)");
    }

    // The attributes map + attribute-keys array compress well at a higher level.
    await this.applyCodec(MetricService, "attributes", "ZSTD(3)");
    await this.applyCodec(MetricService, "attributeKeys", "ZSTD(3)");
  }

  private async applyLogCodecs(): Promise<void> {
    // attributes has no skip index, so this is a plain codec change.
    await this.applyCodec(LogService, "attributes", "ZSTD(3)");
  }

  private async applySpanCodecs(): Promise<void> {
    /*
     * Matches the codecs declared on the Span model. traceId / spanId /
     * parentSpanId carry bloom_filter skip indexes, but because these are
     * CODEC-only changes (type unchanged) the index does not need to be
     * dropped first.
     */
    const zstd1Columns: Array<string> = [
      "startTimeUnixNano",
      "endTimeUnixNano",
      "durationUnixNano",
      "traceId",
      "spanId",
      "parentSpanId",
      "statusMessage",
    ];

    for (const columnName of zstd1Columns) {
      await this.applyCodec(SpanService, columnName, "ZSTD(1)");
    }

    // events / links are JSON-as-String blobs that compress well at level 3.
    await this.applyCodec(SpanService, "events", "ZSTD(3)");
    await this.applyCodec(SpanService, "links", "ZSTD(3)");
  }

  /**
   * Adds a CODEC to a column that has NO skip index. Reads the column's exact
   * current type from system.columns and re-states it unchanged so only the
   * codec is added. Idempotent (skips if the codec is already set) and async.
   */
  private async applyCodec(
    service: AnalyticsDatabaseService<any>,
    columnName: string,
    codec: string,
  ): Promise<void> {
    const currentType: string = await service.getColumnDatabaseType(columnName);

    if (!currentType) {
      logger.info(`Column ${columnName} not found, skipping codec change`, {
        service: "workers",
      });
      return;
    }

    await service.setColumnCodecIfNotSet({
      columnName,
      columnType: currentType,
      codec,
      expectedCodecValue: `CODEC(${codec})`,
    });
  }

  public override async rollback(): Promise<void> {
    return;
  }
}
