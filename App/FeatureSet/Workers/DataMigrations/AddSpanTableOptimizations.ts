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
    // Step 1: Add hasException column if it doesn't exist
    const hasColumnAlready: boolean =
      await SpanService.doesColumnExist("hasException");

    if (!hasColumnAlready) {
      const model: Span = new Span();
      const hasExceptionColumn: AnalyticsTableColumn | undefined =
        model.tableColumns.find((item: AnalyticsTableColumn) => {
          return item.key === "hasException";
        });

      if (hasExceptionColumn) {
        await SpanService.addColumnInDatabase(hasExceptionColumn);
        logger.info("Added hasException column to SpanItem", { service: "workers" });
      }
    } else {
      logger.info(
        "hasException column already exists on SpanItem, skipping add",
        { service: "workers" },
      );
    }

    // Step 2: Add skip indexes on kind and parentSpanId (IF NOT EXISTS makes these safe to re-run)
    await SpanService.execute(
      `ALTER TABLE SpanItem ADD INDEX IF NOT EXISTS idx_kind assumeNotNull(kind) TYPE set(5) GRANULARITY 4`,
    );
    logger.info("Added skip index idx_kind on SpanItem", { service: "workers" });

    await SpanService.execute(
      `ALTER TABLE SpanItem ADD INDEX IF NOT EXISTS idx_parent_span_id assumeNotNull(parentSpanId) TYPE bloom_filter(0.01) GRANULARITY 1`,
    );
    logger.info("Added skip index idx_parent_span_id on SpanItem", { service: "workers" });

    /*
     * Step 3: Apply compression codecs (only if not already applied)
     * Use mutations_sync=0 so these operations return immediately and complete asynchronously.
     * On large tables (76GB+), synchronous MODIFY COLUMN CODEC would time out.
     */
    await SpanService.setColumnCodecIfNotSet({
      columnName: "startTimeUnixNano",
      columnType: "Int128",
      codec: "ZSTD(1)",
      expectedCodecValue: "CODEC(ZSTD(1))",
    });
    await SpanService.setColumnCodecIfNotSet({
      columnName: "endTimeUnixNano",
      columnType: "Int128",
      codec: "ZSTD(1)",
      expectedCodecValue: "CODEC(ZSTD(1))",
    });
    await SpanService.setColumnCodecIfNotSet({
      columnName: "durationUnixNano",
      columnType: "Int128",
      codec: "ZSTD(1)",
      expectedCodecValue: "CODEC(ZSTD(1))",
    });

    // traceId and spanId have bloom_filter indexes — must drop index, apply codec, re-add index
    await this.applyCodecWithIndex(
      "traceId",
      "String",
      "ZSTD(1)",
      "CODEC(ZSTD(1))",
      "idx_trace_id",
      "traceId",
      "bloom_filter(0.01)",
      1,
    );

    await this.applyCodecWithIndex(
      "spanId",
      "String",
      "ZSTD(1)",
      "CODEC(ZSTD(1))",
      "idx_span_id",
      "spanId",
      "bloom_filter(0.01)",
      1,
    );

    await SpanService.setColumnCodecIfNotSet({
      columnName: "parentSpanId",
      columnType: "Nullable(String)",
      codec: "ZSTD(1)",
      expectedCodecValue: "CODEC(ZSTD(1))",
    });
    await SpanService.setColumnCodecIfNotSet({
      columnName: "attributes",
      columnType: "String",
      codec: "ZSTD(3)",
      expectedCodecValue: "CODEC(ZSTD(3))",
    });
    await SpanService.setColumnCodecIfNotSet({
      columnName: "events",
      columnType: "String",
      codec: "ZSTD(3)",
      expectedCodecValue: "CODEC(ZSTD(3))",
    });
    await SpanService.setColumnCodecIfNotSet({
      columnName: "links",
      columnType: "String",
      codec: "ZSTD(3)",
      expectedCodecValue: "CODEC(ZSTD(3))",
    });

    // Step 4: Backfill hasException for existing rows containing exception events
    await SpanService.execute(
      `ALTER TABLE SpanItem UPDATE hasException = 1 WHERE position(events, '"name":"exception"') > 0 AND hasException = 0 SETTINGS mutations_sync=0`,
    );
    logger.info(
      "Started async backfill of hasException for existing SpanItem rows",
      { service: "workers" },
    );
  }

  private async applyCodecWithIndex(
    columnName: string,
    columnType: string,
    codec: string,
    expectedCodecValue: string,
    indexName: string,
    indexExpr: string,
    indexType: string,
    granularity: number,
  ): Promise<void> {
    const currentCodec: string = await SpanService.getColumnCodec(columnName);

    if (currentCodec === expectedCodecValue) {
      logger.info(
        `SpanItem.${columnName} already has ${expectedCodecValue}, skipping codec change`,
        { service: "workers" },
      );
      // Still ensure the index exists (IF NOT EXISTS is safe to re-run)
      await SpanService.execute(
        `ALTER TABLE SpanItem ADD INDEX IF NOT EXISTS ${indexName} ${indexExpr} TYPE ${indexType} GRANULARITY ${granularity}`,
      );
      return;
    }

    // Drop the index first so the column can be modified (async to avoid timeout)
    await SpanService.execute(
      `ALTER TABLE SpanItem DROP INDEX IF EXISTS ${indexName} SETTINGS mutations_sync=0`,
    );
    logger.info(`Dropped index ${indexName} on SpanItem (async)`, { service: "workers" });

    // Apply the codec (async)
    await SpanService.execute(
      `ALTER TABLE SpanItem MODIFY COLUMN ${columnName} ${columnType} CODEC(${codec}) SETTINGS mutations_sync=0`,
    );
    logger.info(`Applied ${codec} codec to SpanItem.${columnName} (async)`, { service: "workers" });

    // Re-add the index (async)
    await SpanService.execute(
      `ALTER TABLE SpanItem ADD INDEX IF NOT EXISTS ${indexName} ${indexExpr} TYPE ${indexType} GRANULARITY ${granularity} SETTINGS mutations_sync=0`,
    );
    logger.info(`Re-added index ${indexName} on SpanItem (async)`, { service: "workers" });
  }

  public override async rollback(): Promise<void> {
    return;
  }
}
