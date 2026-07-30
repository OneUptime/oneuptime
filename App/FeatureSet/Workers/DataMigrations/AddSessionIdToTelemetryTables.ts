import DataMigrationBase from "./DataMigrationBase";
import AnalyticsTableColumn from "Common/Types/AnalyticsDatabase/TableColumn";
import TableColumnType from "Common/Types/AnalyticsDatabase/TableColumnType";
import AnalyticsBaseModel from "Common/Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import AnalyticsDatabaseService from "Common/Server/Services/AnalyticsDatabaseService";
import Log from "Common/Models/AnalyticsModels/Log";
import Span from "Common/Models/AnalyticsModels/Span";
import ExceptionInstance from "Common/Models/AnalyticsModels/ExceptionInstance";
import LogService from "Common/Server/Services/LogService";
import SpanService from "Common/Server/Services/SpanService";
import ExceptionInstanceService from "Common/Server/Services/ExceptionInstanceService";
import logger from "Common/Server/Utils/Logger";

/**
 * Adds the `sessionId` correlation column to the three signal tables a
 * session replay has to join against: Log / Span / ExceptionInstance.
 *
 * `sessionId` is the join key for the whole feature — "show me the logs
 * this recording produced", "show me the recording behind this exception".
 * It is a non-Nullable `String CODEC(ZSTD(1))` with a `bloom_filter(0.01)
 * GRANULARITY 1` skip index, whose type default '' doubles as "this row
 * predates session replay". There is deliberately NO backfill: historical
 * rows read '' by design (same discipline as the scalar entity-key
 * columns), and Nullable is not an option because StatementGenerator has
 * to assumeNotNull-wrap Nullable columns for indexes and an ADD COLUMN can
 * never join the sort key anyway.
 *
 * Metadata-only and idempotent: ADD COLUMN IF NOT EXISTS + ADD INDEX IF
 * NOT EXISTS, no part rewrite, sort keys untouched. Modelled on
 * AddScalarEntityKeysToTelemetryTables.
 *
 * Two things a future reader needs to know, because getting either wrong
 * is expensive:
 *
 *  1. `runsInClusterMode()` is false, so the runner RECORDS this migration
 *     as executed without running it. That is correct rather than lazy:
 *     the analytics schema is always a cluster, boot schema-sync
 *     (AnalyticsTableManagement.createTables -> reconcileColumns) already
 *     issues the additive ADD COLUMN / ADD INDEX for every column declared
 *     on a model, and single-node DDL against the Distributed / *Local
 *     split would fail. The migration exists so the intent is recorded and
 *     so a non-cluster path still converges.
 *
 *  2. The data-migration runner HALTS THE ENTIRE CHAIN at the first
 *     failure, so a column that is not (yet) declared on a model is
 *     skipped with a warning instead of throwing. The models are owned by
 *     the correlation slice of this feature; if this migration ran ahead
 *     of them, throwing would freeze every later migration in the repo to
 *     fix a column that adds nothing but a correlation shortcut.
 */
export default class AddSessionIdToTelemetryTables extends DataMigrationBase {
  public constructor() {
    super("AddSessionIdToTelemetryTables");
  }

  public override runsInClusterMode(): boolean {
    return false;
  }

  private static readonly sessionIdColumnKey: string = "sessionId";

  public override async migrate(): Promise<void> {
    const errors: Array<string> = [];

    await this.addSessionIdColumn(new Log(), LogService, errors);
    await this.addSessionIdColumn(new Span(), SpanService, errors);
    await this.addSessionIdColumn(
      new ExceptionInstance(),
      ExceptionInstanceService,
      errors,
    );

    if (errors.length > 0) {
      throw new Error(
        `AddSessionIdToTelemetryTables: ${errors.length} failure(s): ${errors.join("; ")}`,
      );
    }
  }

  private async addSessionIdColumn<TModel extends AnalyticsBaseModel>(
    model: TModel,
    service: AnalyticsDatabaseService<TModel>,
    errors: Array<string>,
  ): Promise<void> {
    const columnKey: string = AddSessionIdToTelemetryTables.sessionIdColumnKey;

    const column: AnalyticsTableColumn | undefined = model.tableColumns.find(
      (item: AnalyticsTableColumn) => {
        return item.key === columnKey;
      },
    );

    if (!column) {
      // See the class comment: skip, never throw, or the chain halts.
      logger.warn(
        `AddSessionIdToTelemetryTables: ${model.tableName} does not declare ${columnKey}; skipping. Session replay correlation from this table will not work until the column is declared on the model.`,
      );
      return;
    }

    /*
     * Guard on the live schema first. addColumnInDatabase is already
     * idempotent, but reading the type back also catches the case that
     * actually hurts: a column of the WRONG type (a Nullable(String) left
     * by an earlier hand-run) which would silently defeat the skip index.
     */
    try {
      const existingType: TableColumnType | null =
        await service.getColumnTypeInDatabase(column);

      if (existingType === TableColumnType.Text) {
        logger.info(
          `AddSessionIdToTelemetryTables: ${model.tableName}.${columnKey} already present`,
        );
        return;
      }

      if (existingType !== null) {
        errors.push(
          `${model.tableName}.${columnKey}: exists with unexpected type ${existingType}; expected ${TableColumnType.Text}`,
        );
        return;
      }

      // Idempotent: ADD COLUMN IF NOT EXISTS + ADD INDEX IF NOT EXISTS.
      await service.addColumnInDatabase(column);

      logger.info(
        `AddSessionIdToTelemetryTables: added ${model.tableName}.${columnKey}`,
      );
    } catch (err) {
      logger.error(
        `AddSessionIdToTelemetryTables: failed on ${model.tableName}.${columnKey}:`,
      );
      logger.error(err as Error);
      errors.push(`${model.tableName}.${columnKey}: ${(err as Error).message}`);
    }
  }

  public override async rollback(): Promise<void> {
    /*
     * Deliberately a no-op. Dropping the column would destroy the
     * correlation key on billions of rows to undo a metadata-only add,
     * and a re-run of migrate() is idempotent anyway.
     */
    return;
  }
}
