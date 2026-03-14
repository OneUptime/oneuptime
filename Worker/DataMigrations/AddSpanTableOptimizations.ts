import DataMigrationBase from "./DataMigrationBase";
import AnalyticsTableColumn from "Common/Types/AnalyticsDatabase/TableColumn";
import TableColumnType from "Common/Types/AnalyticsDatabase/TableColumnType";
import Span from "Common/Models/AnalyticsModels/Span";
import SpanService from "Common/Server/Services/SpanService";
import logger from "Common/Server/Utils/Logger";

export default class AddSpanTableOptimizations extends DataMigrationBase {
  public constructor() {
    super("AddSpanTableOptimizations");
  }

  public override async migrate(): Promise<void> {
    // Step 1: Add hasException column
    await this.addColumn("hasException");

    // Step 2: Add skip indexes on kind and parentSpanId
    await this.addSkipIndex(
      "idx_kind",
      "assumeNotNull(kind)",
      "set(5)",
      4,
    );
    await this.addSkipIndex(
      "idx_parent_span_id",
      "assumeNotNull(parentSpanId)",
      "bloom_filter(0.01)",
      1,
    );
    await this.addSkipIndex(
      "idx_has_exception",
      "hasException",
      "set(2)",
      4,
    );

    // Step 3: Apply compression codecs
    await this.applyCodec(
      "startTimeUnixNano",
      "Int128",
      "ZSTD(1)",
    );
    await this.applyCodec(
      "endTimeUnixNano",
      "Int128",
      "ZSTD(1)",
    );
    await this.applyCodec(
      "durationUnixNano",
      "Int128",
      "ZSTD(1)",
    );
    await this.applyCodec(
      "traceId",
      "Nullable(String)",
      "ZSTD(1)",
    );
    await this.applyCodec(
      "spanId",
      "Nullable(String)",
      "ZSTD(1)",
    );
    await this.applyCodec(
      "parentSpanId",
      "Nullable(String)",
      "ZSTD(1)",
    );
    await this.applyCodec(
      "attributes",
      "Nullable(String)",
      "ZSTD(3)",
    );
    await this.applyCodec("events", "Nullable(String)", "ZSTD(3)");
    await this.applyCodec("links", "Nullable(String)", "ZSTD(3)");

    // Step 4: Backfill hasException for existing rows based on events containing exception
    await this.executeWithLogging(
      `ALTER TABLE SpanItem UPDATE hasException = 1 WHERE position(events, '"name":"exception"') > 0 AND hasException = 0 SETTINGS mutations_sync=0`,
      "Backfill hasException for existing SpanItem rows with exception events",
    );
  }

  private async addColumn(columnKey: string): Promise<void> {
    try {
      const model: Span = new Span();
      const column: AnalyticsTableColumn | undefined =
        model.tableColumns.find((item: AnalyticsTableColumn) => {
          return item.key === columnKey;
        });

      if (!column) {
        logger.warn(
          `${columnKey} column not found in Span model`,
        );
        return;
      }

      const columnType: TableColumnType | null =
        await SpanService.getColumnTypeInDatabase(column);

      if (!columnType) {
        await SpanService.addColumnInDatabase(column);
        logger.info(`Added ${columnKey} column to SpanItem`);
      } else {
        logger.info(
          `${columnKey} column already exists in SpanItem`,
        );
      }
    } catch (err) {
      logger.error(`Error adding ${columnKey} column to SpanItem`);
      logger.error(err);
    }
  }

  private async addSkipIndex(
    indexName: string,
    columnExpression: string,
    indexType: string,
    granularity: number,
  ): Promise<void> {
    try {
      await SpanService.execute(
        `ALTER TABLE SpanItem ADD INDEX IF NOT EXISTS ${indexName} ${columnExpression} TYPE ${indexType} GRANULARITY ${granularity}`,
      );
      logger.info(
        `Added skip index ${indexName} on SpanItem.${columnExpression}`,
      );
    } catch (err) {
      logger.error(
        `Error adding skip index ${indexName} to SpanItem: ${err}`,
      );
    }
  }

  private async applyCodec(
    columnName: string,
    columnType: string,
    codec: string,
  ): Promise<void> {
    await this.executeWithLogging(
      `ALTER TABLE SpanItem MODIFY COLUMN ${columnName} ${columnType} CODEC(${codec})`,
      `Apply ${codec} codec to SpanItem.${columnName}`,
    );
  }

  private async executeWithLogging(
    sql: string,
    description: string,
  ): Promise<void> {
    try {
      await SpanService.execute(sql);
      logger.info(`${description} - SUCCESS`);
    } catch (err) {
      logger.error(`${description} - FAILED: ${err}`);
    }
  }
}
