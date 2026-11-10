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

/* One column to add, and the logical type it must have if it is present. */
interface CustomSignalColumn {
  key: string;
  expectedType: TableColumnType;
}

/**
 * Adds the columns that hold a RUM application's own frustration signals
 * (issue #6443) to the two ClickHouse tables session replay reads:
 *
 *   RumSessionV1 and RumSessionChunkV1: customSignalCount Int32,
 *   customSignalFrustrationCount Int32, customSignalNames Array(String).
 *
 * The recorders count each signal by name on the chunk envelope; the ingest
 * writes the chunk's totals and names, and the finalizer sums them into the
 * session. customSignalFrustrationCount is part of the session's frustration
 * total (the Frustration filter, sort and totals); customSignalNames is what
 * "sessions where a signal fired" looks up, through the session table's
 * bloom filter index.
 *
 * Metadata-only and idempotent, exactly like
 * AddSessionReplayEngagementColumns, and for the same two reasons:
 *
 *  1. `runsInClusterMode()` is false, so on a cluster the runner records the
 *     migration without running it: boot schema-sync
 *     (AnalyticsTableManagement.createTables -> reconcileColumns) issues the
 *     additive ADD COLUMN for every column a model declares, and single-node
 *     DDL against the Distributed / *Local split would fail.
 *
 *  2. The runner halts the whole chain at the first failure, so a column a
 *     model does not declare is skipped with a warning rather than thrown
 *     on: a missing signal column costs a badge, not every later migration.
 *
 * Every row written before the columns existed reads 0 / [] - no signals of
 * the application's own - which is what those sessions had.
 */
export default class AddSessionReplayCustomSignalColumns extends DataMigrationBase {
  public constructor() {
    super("AddSessionReplayCustomSignalColumns");
  }

  public override runsInClusterMode(): boolean {
    return false;
  }

  public static readonly columns: Array<CustomSignalColumn> = [
    { key: "customSignalCount", expectedType: TableColumnType.Number },
    {
      key: "customSignalFrustrationCount",
      expectedType: TableColumnType.Number,
    },
    { key: "customSignalNames", expectedType: TableColumnType.ArrayText },
  ];

  public override async migrate(): Promise<void> {
    const errors: Array<string> = [];

    for (const column of AddSessionReplayCustomSignalColumns.columns) {
      await this.addColumn(new RumSession(), RumSessionService, column, errors);
      await this.addColumn(
        new RumSessionChunk(),
        RumSessionChunkService,
        column,
        errors,
      );
    }

    if (errors.length > 0) {
      throw new Error(
        `AddSessionReplayCustomSignalColumns: ${errors.length} failure(s): ${errors.join("; ")}`,
      );
    }
  }

  private async addColumn<TModel extends AnalyticsBaseModel>(
    model: TModel,
    service: AnalyticsDatabaseService<TModel>,
    wanted: CustomSignalColumn,
    errors: Array<string>,
  ): Promise<void> {
    const column: AnalyticsTableColumn | undefined = model.tableColumns.find(
      (item: AnalyticsTableColumn) => {
        return item.key === wanted.key;
      },
    );

    if (!column) {
      /* See the class comment: skip, never throw, or the chain halts. */
      logger.warn(
        `AddSessionReplayCustomSignalColumns: ${model.tableName} does not declare ${wanted.key}; skipping (boot schema-sync adds it once the model declares it).`,
      );
      return;
    }

    try {
      const existingType: TableColumnType | null =
        await service.getColumnTypeInDatabase(column);

      if (existingType === wanted.expectedType) {
        logger.info(
          `AddSessionReplayCustomSignalColumns: ${model.tableName}.${wanted.key} already present`,
        );
        return;
      }

      if (existingType !== null) {
        errors.push(
          `${model.tableName}.${wanted.key}: exists with unexpected type ${existingType}; expected ${wanted.expectedType}`,
        );
        return;
      }

      // Idempotent: ADD COLUMN IF NOT EXISTS.
      await service.addColumnInDatabase(column);

      logger.info(
        `AddSessionReplayCustomSignalColumns: added ${model.tableName}.${wanted.key}`,
      );
    } catch (err) {
      logger.error(
        `AddSessionReplayCustomSignalColumns: failed on ${model.tableName}.${wanted.key}:`,
      );
      logger.error(err as Error);
      errors.push(
        `${model.tableName}.${wanted.key}: ${(err as Error).message}`,
      );
    }
  }

  public override async rollback(): Promise<void> {
    /*
     * Deliberately a no-op, like AddSessionReplayEngagementColumns: dropping
     * the columns would discard every finalized session's signal counts to
     * undo a metadata-only add, and a re-run of migrate() is idempotent.
     */
    return;
  }
}
