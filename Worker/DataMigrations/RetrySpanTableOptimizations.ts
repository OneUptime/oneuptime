import DataMigrationBase from "./DataMigrationBase";
import AnalyticsTableColumn from "Common/Types/AnalyticsDatabase/TableColumn";
import Span from "Common/Models/AnalyticsModels/Span";
import SpanService from "Common/Server/Services/SpanService";
import logger from "Common/Server/Utils/Logger";

export default class RetrySpanTableOptimizations extends DataMigrationBase {
  public constructor() {
    super("RetrySpanTableOptimizations");
  }

  public override async migrate(): Promise<void> {
    // Step 1: Add hasException column (failed in previous migration due to INDEX being bundled in ADD COLUMN)
    const model: Span = new Span();
    const hasExceptionColumn: AnalyticsTableColumn | undefined =
      model.tableColumns.find((item: AnalyticsTableColumn) => {
        return item.key === "hasException";
      });

    if (hasExceptionColumn) {
      await SpanService.addColumnInDatabase(hasExceptionColumn);
      logger.info("Added hasException column to SpanItem");
    }

    // Step 2: Apply codecs to traceId and spanId (requires dropping and re-adding bloom_filter indexes)
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

    // Step 3: Apply codecs to events and links (timed out previously, use correct non-nullable types)
    await SpanService.execute(
      `ALTER TABLE SpanItem MODIFY COLUMN events String CODEC(ZSTD(3))`,
    );
    logger.info("Applied ZSTD(3) codec to SpanItem.events");

    await SpanService.execute(
      `ALTER TABLE SpanItem MODIFY COLUMN links String CODEC(ZSTD(3))`,
    );
    logger.info("Applied ZSTD(3) codec to SpanItem.links");

    // Step 4: Backfill hasException for existing rows
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
    // Drop the index first so the column can be modified
    await SpanService.execute(
      `ALTER TABLE SpanItem DROP INDEX IF EXISTS ${indexName}`,
    );
    logger.info(`Dropped index ${indexName} on SpanItem`);

    // Apply the codec
    await SpanService.execute(
      `ALTER TABLE SpanItem MODIFY COLUMN ${columnName} ${columnType} CODEC(${codec})`,
    );
    logger.info(`Applied ${codec} codec to SpanItem.${columnName}`);

    // Re-add the index
    await SpanService.execute(
      `ALTER TABLE SpanItem ADD INDEX IF NOT EXISTS ${indexName} ${indexExpr} TYPE ${indexType} GRANULARITY ${granularity}`,
    );
    logger.info(`Re-added index ${indexName} on SpanItem`);
  }

  public override async rollback(): Promise<void> {
    return;
  }
}
