import DataMigrationBase from "./DataMigrationBase";
import AnalyticsTableColumn from "Common/Types/AnalyticsDatabase/TableColumn";
import Span from "Common/Models/AnalyticsModels/Span";
import SpanService from "Common/Server/Services/SpanService";
import logger from "Common/Server/Utils/Logger";

export default class AddSpanTableOptimizations extends DataMigrationBase {
  public constructor() {
    super("AddSpanTableOptimizations");
  }

  public override async migrate(): Promise<void> {
    // Step 1: Add hasException column (with its skip index added separately via addColumnInDatabase)
    const model: Span = new Span();
    const hasExceptionColumn: AnalyticsTableColumn | undefined =
      model.tableColumns.find((item: AnalyticsTableColumn) => {
        return item.key === "hasException";
      });

    if (hasExceptionColumn) {
      await SpanService.addColumnInDatabase(hasExceptionColumn);
      logger.info("Added hasException column to SpanItem");
    }

    // Step 2: Add skip indexes on kind and parentSpanId
    await SpanService.execute(
      `ALTER TABLE SpanItem ADD INDEX IF NOT EXISTS idx_kind assumeNotNull(kind) TYPE set(5) GRANULARITY 4`,
    );
    logger.info("Added skip index idx_kind on SpanItem");

    await SpanService.execute(
      `ALTER TABLE SpanItem ADD INDEX IF NOT EXISTS idx_parent_span_id assumeNotNull(parentSpanId) TYPE bloom_filter(0.01) GRANULARITY 1`,
    );
    logger.info("Added skip index idx_parent_span_id on SpanItem");

    // Step 3: Apply compression codecs
    // Use mutations_sync=0 so these operations return immediately and complete asynchronously.
    // On large tables (76GB+), synchronous MODIFY COLUMN CODEC would time out.
    await SpanService.execute(
      `ALTER TABLE SpanItem MODIFY COLUMN startTimeUnixNano Int128 CODEC(ZSTD(1)) SETTINGS mutations_sync=0`,
    );
    logger.info("Applied ZSTD(1) codec to SpanItem.startTimeUnixNano (async)");

    await SpanService.execute(
      `ALTER TABLE SpanItem MODIFY COLUMN endTimeUnixNano Int128 CODEC(ZSTD(1)) SETTINGS mutations_sync=0`,
    );
    logger.info("Applied ZSTD(1) codec to SpanItem.endTimeUnixNano (async)");

    await SpanService.execute(
      `ALTER TABLE SpanItem MODIFY COLUMN durationUnixNano Int128 CODEC(ZSTD(1)) SETTINGS mutations_sync=0`,
    );
    logger.info("Applied ZSTD(1) codec to SpanItem.durationUnixNano (async)");

    // traceId and spanId have bloom_filter indexes — must drop index, apply codec, re-add index
    await this.applyCodecWithIndex(
      "traceId",
      "String",
      "ZSTD(1)",
      "idx_trace_id",
      "traceId",
      "bloom_filter(0.01)",
      1,
    );

    await this.applyCodecWithIndex(
      "spanId",
      "String",
      "ZSTD(1)",
      "idx_span_id",
      "spanId",
      "bloom_filter(0.01)",
      1,
    );

    await SpanService.execute(
      `ALTER TABLE SpanItem MODIFY COLUMN parentSpanId Nullable(String) CODEC(ZSTD(1)) SETTINGS mutations_sync=0`,
    );
    logger.info("Applied ZSTD(1) codec to SpanItem.parentSpanId (async)");

    await SpanService.execute(
      `ALTER TABLE SpanItem MODIFY COLUMN attributes String CODEC(ZSTD(3)) SETTINGS mutations_sync=0`,
    );
    logger.info("Applied ZSTD(3) codec to SpanItem.attributes (async)");

    await SpanService.execute(
      `ALTER TABLE SpanItem MODIFY COLUMN events String CODEC(ZSTD(3)) SETTINGS mutations_sync=0`,
    );
    logger.info("Applied ZSTD(3) codec to SpanItem.events (async)");

    await SpanService.execute(
      `ALTER TABLE SpanItem MODIFY COLUMN links String CODEC(ZSTD(3)) SETTINGS mutations_sync=0`,
    );
    logger.info("Applied ZSTD(3) codec to SpanItem.links (async)");

    // Step 4: Backfill hasException for existing rows containing exception events
    await SpanService.execute(
      `ALTER TABLE SpanItem UPDATE hasException = 1 WHERE position(events, '"name":"exception"') > 0 AND hasException = 0 SETTINGS mutations_sync=0`,
    );
    logger.info(
      "Started async backfill of hasException for existing SpanItem rows",
    );
  }

  private async applyCodecWithIndex(
    columnName: string,
    columnType: string,
    codec: string,
    indexName: string,
    indexExpr: string,
    indexType: string,
    granularity: number,
  ): Promise<void> {
    // Drop the index first so the column can be modified (async to avoid timeout)
    await SpanService.execute(
      `ALTER TABLE SpanItem DROP INDEX IF EXISTS ${indexName} SETTINGS mutations_sync=0`,
    );
    logger.info(`Dropped index ${indexName} on SpanItem (async)`);

    // Apply the codec (async)
    await SpanService.execute(
      `ALTER TABLE SpanItem MODIFY COLUMN ${columnName} ${columnType} CODEC(${codec}) SETTINGS mutations_sync=0`,
    );
    logger.info(`Applied ${codec} codec to SpanItem.${columnName} (async)`);

    // Re-add the index (async)
    await SpanService.execute(
      `ALTER TABLE SpanItem ADD INDEX IF NOT EXISTS ${indexName} ${indexExpr} TYPE ${indexType} GRANULARITY ${granularity} SETTINGS mutations_sync=0`,
    );
    logger.info(`Re-added index ${indexName} on SpanItem (async)`);
  }

  public override async rollback(): Promise<void> {
    return;
  }
}
