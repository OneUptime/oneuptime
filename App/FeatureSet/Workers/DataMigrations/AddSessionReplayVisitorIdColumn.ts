import DataMigrationBase from "./DataMigrationBase";
import AnalyticsTableColumn from "Common/Types/AnalyticsDatabase/TableColumn";
import TableColumnType from "Common/Types/AnalyticsDatabase/TableColumnType";
import RumSession from "Common/Models/AnalyticsModels/RumSession";
import RumSessionService from "Common/Server/Services/RumSessionService";
import logger from "Common/Server/Utils/Logger";

/*
 * The column to add and the logical type it must already have if it is
 * present. `String` reads back from ClickHouse as TableColumnType.Text.
 */
const VISITOR_ID_COLUMN_KEY: string = "visitorId";
const VISITOR_ID_EXPECTED_TYPE: TableColumnType = TableColumnType.Text;

/**
 * Adds the session-replay visitor id column to the ClickHouse header table:
 *
 *   RumSessionV1: visitorId String DEFAULT ''
 *
 * It carries the recorder's per-browser anonymous visitor id (32 lowercase
 * hex, random, minted client-side once per browser profile) so the session
 * list can group an application's sessions by visitor even when its pages
 * never call identify(). It is not an identity, so it sits under the
 * ordinary session ACL beside sessionId.
 *
 * Metadata-only and idempotent: ADD COLUMN IF NOT EXISTS with the model's
 * declared "" default, so every pre-existing row reads "predates the
 * recorder that mints it" and no part is rewritten. Modelled on
 * AddSessionReplayEngagementColumns, and the same two facts apply:
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
 *     failure, so a column that is not (yet) declared on the model is
 *     skipped with a warning instead of throwing: a missing visitor id
 *     column costs a grouping, and freezing every later migration in the
 *     repo over a grouping is the wrong trade.
 */
export default class AddSessionReplayVisitorIdColumn extends DataMigrationBase {
  public constructor() {
    super("AddSessionReplayVisitorIdColumn");
  }

  public override runsInClusterMode(): boolean {
    return false;
  }

  public override async migrate(): Promise<void> {
    const model: RumSession = new RumSession();

    const column: AnalyticsTableColumn | undefined = model.tableColumns.find(
      (item: AnalyticsTableColumn) => {
        return item.key === VISITOR_ID_COLUMN_KEY;
      },
    );

    if (!column) {
      /*
       * See the class comment: skip, never throw, or the chain halts. Warn
       * rather than error because the skip is recoverable: boot schema-sync
       * adds the column the moment the model declares it, so nothing depends
       * on this migration running again.
       */
      logger.warn(
        `AddSessionReplayVisitorIdColumn: ${model.tableName} does not declare ${VISITOR_ID_COLUMN_KEY}; skipping (boot schema-sync adds it once the model declares it).`,
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
        await RumSessionService.getColumnTypeInDatabase(column);

      if (existingType === VISITOR_ID_EXPECTED_TYPE) {
        logger.info(
          `AddSessionReplayVisitorIdColumn: ${model.tableName}.${VISITOR_ID_COLUMN_KEY} already present`,
        );
        return;
      }

      if (existingType !== null) {
        throw new Error(
          `${model.tableName}.${VISITOR_ID_COLUMN_KEY}: exists with unexpected type ${existingType}; expected ${VISITOR_ID_EXPECTED_TYPE}`,
        );
      }

      // Idempotent: ADD COLUMN IF NOT EXISTS.
      await RumSessionService.addColumnInDatabase(column);

      logger.info(
        `AddSessionReplayVisitorIdColumn: added ${model.tableName}.${VISITOR_ID_COLUMN_KEY}`,
      );
    } catch (err) {
      logger.error(
        `AddSessionReplayVisitorIdColumn: failed on ${model.tableName}.${VISITOR_ID_COLUMN_KEY}:`,
      );
      logger.error(err as Error);
      throw new Error(
        `AddSessionReplayVisitorIdColumn: ${model.tableName}.${VISITOR_ID_COLUMN_KEY}: ${(err as Error).message}`,
      );
    }
  }

  public override async rollback(): Promise<void> {
    /*
     * Deliberately a no-op. Dropping the column would discard the visitor
     * link of every session recorded since, to undo a metadata-only add,
     * and a re-run of migrate() is idempotent anyway.
     */
    return;
  }
}
