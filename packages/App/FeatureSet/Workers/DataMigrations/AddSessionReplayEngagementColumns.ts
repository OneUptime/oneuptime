import DataMigrationBase from "./DataMigrationBase";
import AnalyticsTableColumn from "Common/Types/AnalyticsDatabase/TableColumn";
import TableColumnType from "Common/Types/AnalyticsDatabase/TableColumnType";
import AnalyticsBaseModel from "Common/Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import AnalyticsDatabaseService from "Common/Server/Services/AnalyticsDatabaseService";
import RumSession from "Common/Models/AnalyticsModels/RumSession";
import RumSessionChunk from "Common/Models/AnalyticsModels/RumSessionChunk";
import RumSessionService from "Common/Server/Services/RumSessionService";
import RumSessionChunkService from "Common/Server/Services/RumSessionChunkService";
import logger from "Common/Server/Utils/Logger";

/*
 * One column to add, and the logical type it must already have if it is
 * present. Declared as data so the header and chunk lists cannot drift
 * from what the models declare.
 */
interface EngagementColumn {
  key: string;
  expectedType: TableColumnType;
}

/**
 * Adds the session-replay engagement columns to the two ClickHouse tables
 * the feature reads:
 *
 *   RumSessionV1: tags Map(String, String), identifiedUserTraits
 *   Map(String, String), clickCount Int32, customEventCount Int32,
 *   firstErrorOffsetMs Int64, activeMs Int64.
 *   RumSessionChunkV1: clickCount Int32, customEventCount Int32.
 *
 * They carry what identify()/setTags()/track() and the click recorder put
 * on the wire, and what the finalizer sums: the list's "41 clicks" cell,
 * "Watch from first error", "idle 40%", the tag:key=value search and the
 * identity-gated traits column all read them.
 *
 * Metadata-only and idempotent: ADD COLUMN IF NOT EXISTS with the models'
 * declared 0 / {} defaults, so every pre-existing row reads "not counted"
 * and no part is rewritten. Modelled on AddSessionIdToTelemetryTables,
 * and the same two facts apply:
 *
 *  1. `runsInClusterMode()` is false, so the runner RECORDS this migration
 *     as executed without running it on a cluster. Boot schema-sync
 *     (AnalyticsTableManagement.createTables -> reconcileColumns) already
 *     issues the additive ADD COLUMN for every column declared on a model,
 *     and single-node DDL against the Distributed / *Local split would
 *     fail. The migration exists so the intent is recorded and so a
 *     non-cluster path still converges.
 *
 *  2. The data-migration runner HALTS THE ENTIRE CHAIN at the first
 *     failure, so a column that is not (yet) declared on a model is
 *     skipped with a warning instead of throwing: a missing engagement
 *     column costs a badge, and freezing every later migration in the
 *     repo over a badge is the wrong trade.
 */
export default class AddSessionReplayEngagementColumns extends DataMigrationBase {
  public constructor() {
    super("AddSessionReplayEngagementColumns");
  }

  public override runsInClusterMode(): boolean {
    return false;
  }

  private static readonly headerColumns: Array<EngagementColumn> = [
    { key: "tags", expectedType: TableColumnType.MapStringString },
    {
      key: "identifiedUserTraits",
      expectedType: TableColumnType.MapStringString,
    },
    { key: "clickCount", expectedType: TableColumnType.Number },
    { key: "customEventCount", expectedType: TableColumnType.Number },
    { key: "firstErrorOffsetMs", expectedType: TableColumnType.BigNumber },
    { key: "activeMs", expectedType: TableColumnType.BigNumber },
  ];

  private static readonly chunkColumns: Array<EngagementColumn> = [
    { key: "clickCount", expectedType: TableColumnType.Number },
    { key: "customEventCount", expectedType: TableColumnType.Number },
  ];

  public override async migrate(): Promise<void> {
    const errors: Array<string> = [];

    for (const column of AddSessionReplayEngagementColumns.headerColumns) {
      await this.addColumn(new RumSession(), RumSessionService, column, errors);
    }

    for (const column of AddSessionReplayEngagementColumns.chunkColumns) {
      await this.addColumn(
        new RumSessionChunk(),
        RumSessionChunkService,
        column,
        errors,
      );
    }

    if (errors.length > 0) {
      throw new Error(
        `AddSessionReplayEngagementColumns: ${errors.length} failure(s): ${errors.join("; ")}`,
      );
    }
  }

  private async addColumn<TModel extends AnalyticsBaseModel>(
    model: TModel,
    service: AnalyticsDatabaseService<TModel>,
    engagementColumn: EngagementColumn,
    errors: Array<string>,
  ): Promise<void> {
    const columnKey: string = engagementColumn.key;

    const column: AnalyticsTableColumn | undefined = model.tableColumns.find(
      (item: AnalyticsTableColumn) => {
        return item.key === columnKey;
      },
    );

    if (!column) {
      /*
       * See the class comment: skip, never throw, or the chain halts. Warn
       * rather than error because the skip is recoverable: boot schema-sync
       * adds the column the moment a model declares it, so nothing depends
       * on this migration running again.
       */
      logger.warn(
        `AddSessionReplayEngagementColumns: ${model.tableName} does not declare ${columnKey}; skipping (boot schema-sync adds it once the model declares it).`,
      );
      return;
    }

    /*
     * Guard on the live schema first. addColumnInDatabase is already
     * idempotent; reading the type back additionally catches a column left
     * behind at a genuinely different LOGICAL type from an unrelated
     * hand-run and reports it, instead of layering an ADD COLUMN IF NOT
     * EXISTS on top that would silently do nothing.
     */
    try {
      const existingType: TableColumnType | null =
        await service.getColumnTypeInDatabase(column);

      if (existingType === engagementColumn.expectedType) {
        logger.info(
          `AddSessionReplayEngagementColumns: ${model.tableName}.${columnKey} already present`,
        );
        return;
      }

      if (existingType !== null) {
        errors.push(
          `${model.tableName}.${columnKey}: exists with unexpected type ${existingType}; expected ${engagementColumn.expectedType}`,
        );
        return;
      }

      // Idempotent: ADD COLUMN IF NOT EXISTS.
      await service.addColumnInDatabase(column);

      logger.info(
        `AddSessionReplayEngagementColumns: added ${model.tableName}.${columnKey}`,
      );
    } catch (err) {
      logger.error(
        `AddSessionReplayEngagementColumns: failed on ${model.tableName}.${columnKey}:`,
      );
      logger.error(err as Error);
      errors.push(`${model.tableName}.${columnKey}: ${(err as Error).message}`);
    }
  }

  public override async rollback(): Promise<void> {
    /*
     * Deliberately a no-op. Dropping the columns would discard the
     * engagement aggregates of every finalized session to undo a
     * metadata-only add, and a re-run of migrate() is idempotent anyway.
     */
    return;
  }
}
