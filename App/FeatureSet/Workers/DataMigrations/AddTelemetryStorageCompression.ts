import DataMigrationBase from "./DataMigrationBase";
import AnalyticsDatabaseService from "Common/Server/Services/AnalyticsDatabaseService";
import AnalyticsTableName from "Common/Types/AnalyticsDatabase/AnalyticsTableName";
import LogService from "Common/Server/Services/LogService";
import SpanService from "Common/Server/Services/SpanService";
import MetricService from "Common/Server/Services/MetricService";
import ExceptionInstanceService from "Common/Server/Services/ExceptionInstanceService";
import ProfileService from "Common/Server/Services/ProfileService";
import ProfileSampleService from "Common/Server/Services/ProfileSampleService";
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
 *   3. LowCardinality(...) on the low-distinct-value String columns
 *      (serviceType, severityText, span kind, metricPointType) across the
 *      telemetry tables — dictionary-encodes them, which shrinks storage and,
 *      more importantly, slashes the memory cost of GROUP BY / filters on
 *      those columns.
 *
 * Every statement is idempotent and runs with mutations_sync=0 so it returns
 * immediately and ClickHouse rewrites the affected parts in the background.
 * On large tables these background mutations consume CPU/IO/disk while they
 * run — schedule the deploy that carries this migration for an off-peak
 * window and make sure ClickHouse has free disk headroom.
 *
 * NOTE on indexes: a CODEC-only change leaves the column TYPE unchanged, so it
 * does NOT require dropping the column's skip index — that is why the
 * bloom-indexed Span columns (traceId / spanId / parentSpanId) are handled by
 * the same plain codec path as everything else. Only a TYPE change needs the
 * index dance, which is why the LowCardinality conversions below drop,
 * re-create and re-materialize their set index. Metric's own indexed columns
 * (name / traceId / spanId / attributeKeys) get their codecs on newly created
 * tables via the model; retrofitting them onto existing tables is a trivial
 * follow-up (same plain codec path) if desired.
 */
export default class AddTelemetryStorageCompression extends DataMigrationBase {
  public constructor() {
    super("AddTelemetryStorageCompression");
  }

  public override async migrate(): Promise<void> {
    await this.applyMetricCodecs();
    await this.applyLogCodecs();
    await this.applySpanCodecs();
    await this.applyLowCardinalityColumns();
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
    ];

    for (const columnName of zstd1Columns) {
      await this.applyCodec(MetricService, columnName, "ZSTD(1)");
    }

    // The attributes map compresses well at a higher level.
    await this.applyCodec(MetricService, "attributes", "ZSTD(3)");
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

  private async applyLowCardinalityColumns(): Promise<void> {
    // [service, tableName, columnName, skipIndexName, set() param, granularity]
    const targets: Array<
      [AnalyticsDatabaseService<any>, string, string, string, number, number]
    > = [
      [
        LogService,
        AnalyticsTableName.Log,
        "serviceType",
        "idx_service_type",
        10,
        4,
      ],
      [
        LogService,
        AnalyticsTableName.Log,
        "severityText",
        "idx_severity",
        10,
        4,
      ],
      [
        SpanService,
        AnalyticsTableName.Span,
        "serviceType",
        "idx_service_type",
        10,
        4,
      ],
      [SpanService, AnalyticsTableName.Span, "kind", "idx_kind", 5, 4],
      [
        MetricService,
        AnalyticsTableName.Metric,
        "serviceType",
        "idx_service_type",
        5,
        4,
      ],
      [
        MetricService,
        AnalyticsTableName.Metric,
        "metricPointType",
        "idx_metric_point_type",
        5,
        4,
      ],
      [
        ExceptionInstanceService,
        AnalyticsTableName.ExceptionInstance,
        "serviceType",
        "idx_service_type",
        10,
        4,
      ],
      [
        ProfileService,
        AnalyticsTableName.Profile,
        "serviceType",
        "idx_service_type",
        10,
        4,
      ],
      [
        ProfileSampleService,
        AnalyticsTableName.ProfileSample,
        "serviceType",
        "idx_service_type",
        10,
        4,
      ],
    ];

    for (const [
      service,
      tableName,
      columnName,
      indexName,
      setParam,
      granularity,
    ] of targets) {
      await this.applyLowCardinality(
        service,
        tableName,
        columnName,
        indexName,
        setParam,
        granularity,
      );
    }
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

  /**
   * Converts a String column to LowCardinality(...) on an existing table.
   * The column's current type is read from the DB and wrapped, so both
   * `String` -> `LowCardinality(String)` and `Nullable(String)` ->
   * `LowCardinality(Nullable(String))` are handled correctly.
   *
   * The column carries a `set` skip index, so the index is dropped before the
   * type change and re-created + re-materialized afterwards. All steps are
   * async (mutations_sync=0) and idempotent.
   */
  private async applyLowCardinality(
    service: AnalyticsDatabaseService<any>,
    tableName: string,
    columnName: string,
    indexName: string,
    setParam: number,
    granularity: number,
  ): Promise<void> {
    const currentType: string = await service.getColumnDatabaseType(columnName);

    if (!currentType) {
      logger.info(
        `${tableName}.${columnName} not found, skipping LowCardinality conversion`,
        { service: "workers" },
      );
      return;
    }

    const indexDef: string = `${columnName} TYPE set(${setParam}) GRANULARITY ${granularity}`;

    if (currentType.startsWith("LowCardinality")) {
      /*
       * Already converted. Ensure the skip index exists and is materialized
       * (covers the case where a previous run failed after the type change).
       */
      await service.execute(
        `ALTER TABLE ${tableName} ADD INDEX IF NOT EXISTS ${indexName} ${indexDef}`,
      );
      await service.execute(
        `ALTER TABLE ${tableName} MATERIALIZE INDEX ${indexName} SETTINGS mutations_sync=0`,
      );
      logger.info(
        `${tableName}.${columnName} is already LowCardinality, ensured skip index`,
        { service: "workers" },
      );
      return;
    }

    const newType: string = `LowCardinality(${currentType})`;

    // Drop the skip index so the column type can be changed.
    await service.execute(
      `ALTER TABLE ${tableName} DROP INDEX IF EXISTS ${indexName} SETTINGS mutations_sync=0`,
    );

    // Change the column type (async background mutation rewrites the column).
    await service.execute(
      `ALTER TABLE ${tableName} MODIFY COLUMN ${columnName} ${newType} SETTINGS mutations_sync=0`,
    );

    // Re-create the skip index (metadata) and rebuild it on existing parts.
    await service.execute(
      `ALTER TABLE ${tableName} ADD INDEX IF NOT EXISTS ${indexName} ${indexDef}`,
    );
    await service.execute(
      `ALTER TABLE ${tableName} MATERIALIZE INDEX ${indexName} SETTINGS mutations_sync=0`,
    );

    logger.info(`Converting ${tableName}.${columnName} to ${newType} (async)`, {
      service: "workers",
    });
  }

  public override async rollback(): Promise<void> {
    return;
  }
}
