import DataMigrationBase from "./DataMigrationBase";
import ClickHouseMigrationUtil from "./ClickHouseMigrationUtil";
import AnalyticsTableManagement from "../Utils/AnalyticsDatabase/TableManegement";
import AnalyticsTableColumn from "Common/Types/AnalyticsDatabase/TableColumn";
import TableColumnType from "Common/Types/AnalyticsDatabase/TableColumnType";
import MetricService from "Common/Server/Services/MetricService";
import Metric from "Common/Models/AnalyticsModels/Metric";
import logger from "Common/Server/Utils/Logger";

/**
 * Convert Metric value/sum/min/max from Int (TableColumnType.Number) to
 * Float64 (TableColumnType.Decimal) — June 2024.
 *
 * Rewritten for issue #2497: the original version dropped and re-added
 * the four columns whenever they existed, with no type check. Two
 * invariants have since changed under it:
 *
 *  - Boot-time schema sync (Workers/Index.ts) creates the metric rollup
 *    materialized views BEFORE the migration runner starts, and
 *    ClickHouse refuses to DROP a column referenced by an MV SELECT
 *    (error 524, ALTER_OF_COLUMN_IS_FORBIDDEN). `value` and `sum` are
 *    referenced by all three rollup MVs.
 *  - Any table the current Metric model resolves to is created with
 *    these columns already Float64, so the unconditional drop had no
 *    work to do — it was pure risk.
 *
 * On any install where this migration was not yet recorded in Postgres
 * (fresh install, version-skipping upgrade, restored ledger), the drop
 * threw 524 and — because the runner halts the chain on first failure —
 * permanently wedged every migration after this one, on every boot.
 *
 * Now: a column whose live type already matches the model is skipped.
 * When a conversion is genuinely needed, the dependent MV triggers are
 * dropped first (DROP VIEW removes only the trigger — the TO target
 * tables keep their rows), the columns are dropped and re-added
 * (data-destructive, the trade-off originally accepted for this type
 * change), and the MVs are recreated from the models with the same
 * schema-sync helper the boot path uses, so the definitions stay in
 * lockstep.
 */
export default class ChangeMetricColumnTypeToDecimal extends DataMigrationBase {
  public constructor() {
    super("ChangeMetricColumnTypeToDecimal");
  }

  public override async migrate(): Promise<void> {
    const columnKeys: Array<string> = ["value", "sum", "min", "max"];

    const columnsToConvert: Array<AnalyticsTableColumn> = [];

    for (const columnKey of columnKeys) {
      const column: AnalyticsTableColumn | undefined =
        new Metric().tableColumns.find((column: AnalyticsTableColumn) => {
          return column.key === columnKey;
        });

      if (!column) {
        continue;
      }

      const existingType: TableColumnType | null =
        await MetricService.getColumnTypeInDatabase(column);

      // Column missing entirely: add it from the model, nothing to drop.
      if (!existingType) {
        await MetricService.addColumnInDatabase(column);
        continue;
      }

      if (existingType === column.type) {
        // Already the model's type — nothing to do.
        continue;
      }

      columnsToConvert.push(column);
    }

    if (columnsToConvert.length === 0) {
      return;
    }

    const dependentViews: Array<string> =
      await ClickHouseMigrationUtil.getDependentMaterializedViews(
        new Metric().tableName,
      );

    for (const view of dependentViews) {
      logger.info(
        `ChangeMetricColumnTypeToDecimal: dropping materialized view ${view} so metric columns can be altered`,
      );
      await MetricService.execute(
        `DROP VIEW IF EXISTS ${AnalyticsTableManagement.escapeIdentifier(view)}`,
      );
    }

    for (const column of columnsToConvert) {
      logger.info(
        `ChangeMetricColumnTypeToDecimal: converting column ${column.key} to ${column.type}`,
      );
      await MetricService.dropColumnInDatabase(column.key);
      await MetricService.addColumnInDatabase(column);
    }

    /*
     * Recreate the model-owned views dropped above (idempotent,
     * non-fatal per view; the boot-time sync repairs anything it could
     * not create on the next start). A dependent view that is NOT
     * declared on a model stays dropped — ClickHouse would have refused
     * the column alter while it existed, and we have no definition to
     * rebuild it from.
     */
    await AnalyticsTableManagement.createMaterializedViews();
  }

  public override async rollback(): Promise<void> {
    return;
  }
}
