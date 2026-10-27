import DataMigrationBase from "./DataMigrationBase";
import ClickHouseMigrationUtil from "./ClickHouseMigrationUtil";
import Span from "Common/Models/AnalyticsModels/Span";
import { MigrationExecuteOptions } from "Common/Server/Services/AnalyticsDatabaseService";
import SpanService from "Common/Server/Services/SpanService";
import StatementGenerator from "Common/Server/Utils/AnalyticsDatabase/StatementGenerator";
import {
  getStorageTableName,
  onClusterClause,
} from "Common/Server/Utils/AnalyticsDatabase/ClusterConfig";
import logger from "Common/Server/Utils/Logger";
import AnalyticsTableColumn from "Common/Types/AnalyticsDatabase/TableColumn";

export const IS_ENTRY_SPAN_COLUMN_KEY: string = "isEntrySpan";

// What a column's default reads like in system.columns.
export interface ColumnDefault {
  kind: string;
  expression: string;
}

// Spaces and parentheses aside, as ClickHouse reformats an expression it stores.
const EXPRESSION_NOISE: RegExp = /[\s()]+/g;

/**
 * Adds `isEntrySpan` to the span table: whether work enters a service at a
 * span - a root span, or a SERVER or CONSUMER span whatever its parent
 * (Common/Utils/Telemetry/EntrySpan). The traces explorer lists these spans
 * by default.
 *
 *   SpanItemV3Local: isEntrySpan Bool DEFAULT isRootSpan OR
 *                    (ifNull(kind, '') IN ('SPAN_KIND_SERVER', 'SPAN_KIND_CONSUMER'))
 *   SpanItemV3:      the same column on the Distributed wrapper
 *
 * No backfill, and none needed: ADD COLUMN is metadata-only, and a part
 * written before the column existed has no file for it, so ClickHouse reads
 * the DEFAULT expression from that row's own isRootSpan and kind - old rows
 * filter exactly as the ones ingest writes the value for. A merge writes the
 * computed value out. (A MATERIALIZED column would read the same, but
 * refuses the INSERT that names it, and ingest writes the value: a pipeline
 * can change a span's kind.)
 *
 * The DEFAULT has to arrive WITH the column: rows read the expression only
 * if the column was added with it. Boot schema-sync (createTables ->
 * reconcileColumns, then the Distributed wrapper's re-sync) runs before
 * data migrations and already adds the column as the model declares it,
 * DEFAULT included, so on a normal upgrade every step below finds the work
 * done. What this migration adds:
 *
 *  1. The local table: the column through the same generator boot uses
 *     (type, DEFAULT, skip index) when it is missing, and the DEFAULT put
 *     back (MODIFY COLUMN ... DEFAULT, metadata-only) on a column that was
 *     added without it - rows stored before it would otherwise read false
 *     and drop out of the default list.
 *  2. The Distributed wrapper: the same. Reads go to the local tables, but
 *     an INSERT through the wrapper that leaves the column out is filled
 *     from the WRAPPER's default before it reaches a shard, so the wrapper
 *     needs the expression too (an older app pod during a rolling upgrade
 *     writes no isEntrySpan).
 *
 * Cluster-aware (`runsInClusterMode` left at true): the analytics schema is
 * always a cluster, and a migration that opted out would be baselined and
 * never check anything. Every statement is ON CLUSTER. Safe to run again,
 * and twice at once: each step is IF NOT EXISTS or a re-statement of the
 * same DEFAULT.
 */
export default class AddIsEntrySpanToSpanTable extends DataMigrationBase {
  public constructor() {
    super("AddIsEntrySpanToSpanTable");
  }

  // The model's isEntrySpan column, which carries the DEFAULT.
  public static getColumn(model: Span): AnalyticsTableColumn | undefined {
    return model.tableColumns.find((column: AnalyticsTableColumn): boolean => {
      return column.key === IS_ENTRY_SPAN_COLUMN_KEY;
    });
  }

  /*
   * The Distributed wrapper's column: the type and DEFAULT of the local one.
   * No codec or index - the wrapper stores nothing.
   */
  public static getDistributedAddColumnStatement(
    model: Span,
    column: AnalyticsTableColumn,
  ): string {
    return `ALTER TABLE ${model.tableName}${onClusterClause()} ADD COLUMN IF NOT EXISTS ${column.key} Bool${StatementGenerator.toDefaultExpressionClause(column)}`;
  }

  // Metadata-only: the type, codec and the values already written stay.
  public static getSetDefaultStatement(
    table: string,
    column: AnalyticsTableColumn,
  ): string {
    return `ALTER TABLE ${table}${onClusterClause()} MODIFY COLUMN ${column.key}${StatementGenerator.toDefaultExpressionClause(column)}`;
  }

  public static hasModelDefault(
    found: ColumnDefault,
    column: AnalyticsTableColumn,
  ): boolean {
    return (
      found.kind === "DEFAULT" &&
      found.expression.replace(EXPRESSION_NOISE, "") ===
        (column.defaultExpression || "").replace(EXPRESSION_NOISE, "")
    );
  }

  public override async migrate(): Promise<void> {
    const model: Span = new Span();
    const column: AnalyticsTableColumn | undefined =
      AddIsEntrySpanToSpanTable.getColumn(model);

    if (!column || !column.defaultExpression) {
      /*
       * The model declares it (a test holds it to that); if it ever stops,
       * there is nothing to add, and halting every later migration over it
       * would be the wrong trade.
       */
      logger.warn(
        `AddIsEntrySpanToSpanTable: ${model.tableName} does not declare ${IS_ENTRY_SPAN_COLUMN_KEY} with its DEFAULT; skipping.`,
      );
      return;
    }

    const failures: Array<string> = [];

    for (const table of [
      getStorageTableName(model.tableName),
      model.tableName,
    ]) {
      const isStorageTable: boolean = table !== model.tableName;

      try {
        /*
         * Boot and the migrate Job create the analytics tables before data
         * migrations run, from a model that already declares the column, so
         * a table that does not exist has nothing to add.
         */
        if (!(await ClickHouseMigrationUtil.tableExists(table))) {
          logger.info(
            `AddIsEntrySpanToSpanTable: ${table} does not exist; nothing to add.`,
          );
          continue;
        }

        const found: ColumnDefault | null =
          await ClickHouseMigrationUtil.getColumnDefault(table, column.key);

        if (!found) {
          if (isStorageTable) {
            // ADD COLUMN IF NOT EXISTS ... DEFAULT, then its skip index.
            await SpanService.addColumnInDatabase(column);
          } else {
            await SpanService.execute(
              AddIsEntrySpanToSpanTable.getDistributedAddColumnStatement(
                model,
                column,
              ),
              MigrationExecuteOptions,
            );
          }

          logger.info(
            `AddIsEntrySpanToSpanTable: added ${table}.${column.key} with its DEFAULT.`,
          );
          continue;
        }

        if (AddIsEntrySpanToSpanTable.hasModelDefault(found, column)) {
          logger.info(
            `AddIsEntrySpanToSpanTable: ${table}.${column.key} is already there with its DEFAULT.`,
          );
          continue;
        }

        await SpanService.execute(
          AddIsEntrySpanToSpanTable.getSetDefaultStatement(table, column),
          MigrationExecuteOptions,
        );

        logger.info(
          `AddIsEntrySpanToSpanTable: ${table}.${column.key} had no DEFAULT (${found.kind || "none"}); set it, so rows stored before the column read it.`,
        );
      } catch (err) {
        logger.error(`AddIsEntrySpanToSpanTable: failed on ${table}:`);
        logger.error(err as Error);

        failures.push(
          `${table}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    /*
     * Both tables are tried before failing, and then the migration does
     * fail rather than be recorded as done with a table whose old rows
     * would read false. The runner stops the chain here and the next run
     * tries again; a step already done is not done twice.
     */
    if (failures.length > 0) {
      throw new Error(
        `AddIsEntrySpanToSpanTable: could not add ${column.key} on ${failures.join("; ")}`,
      );
    }
  }

  public override async rollback(): Promise<void> {
    /*
     * Deliberately a no-op. Dropping the column would discard what ingest
     * wrote since to undo a metadata-only add, and a re-run of migrate() is
     * safe anyway.
     */
    return;
  }
}
