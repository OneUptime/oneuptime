import DataMigrationBase from "./DataMigrationBase";
import ClickHouseMigrationUtil from "./ClickHouseMigrationUtil";
import MetricService from "Common/Server/Services/MetricService";
import logger from "Common/Server/Utils/Logger";

/*
 * Reconcile the schema of every MV target table with `AnalyticsBaseModel`.
 *
 * The base model auto-appends three columns to every analytics table —
 * `_id`, `createdAt`, `updatedAt` — and the auto-create flow that runs
 * on app startup (when a service is registered in `AnalyticsServices`)
 * emits them as part of the CREATE TABLE statement.
 *
 * The three MV target tables here were originally created by their
 * `Add*MaterializedView` data migrations (which only declared the
 * functional columns and the `retentionDate`). After landing the
 * declarative models for these tables we now have three concrete
 * deployment scenarios that may all coexist across environments:
 *
 *   - Scenario A — legacy migration ran first: tables have only the
 *     functional columns. Auto-create sees `IF NOT EXISTS` and no-ops.
 *     The model knows about three more columns the table doesn't have.
 *   - Scenario B — auto-create ran first (e.g. fresh deploy of the new
 *     code on a project that hadn't run prior migrations yet): tables
 *     include `_id String`, `createdAt DateTime`, `updatedAt DateTime`,
 *     all required, all without defaults. The attached MV's INSERT
 *     does not write these columns — so MV writes fail with "no value
 *     for required column".
 *   - Future fresh deploys: same as scenario B but we now want them to
 *     succeed (the columns must have defaults).
 *
 * This migration converges all three to the same end state:
 *
 *     _id        String   DEFAULT generateUUIDv4()
 *     createdAt  DateTime DEFAULT now()
 *     updatedAt  DateTime DEFAULT now()
 *
 * Pattern per column:
 *   1. `ALTER TABLE … ADD COLUMN IF NOT EXISTS …` — adds the column
 *      with the default in scenario A, no-ops elsewhere.
 *   2. `ALTER TABLE … MODIFY COLUMN …` — sets the default expression
 *      in scenario B (where the column existed without one), idempotent
 *      everywhere else.
 *
 * After this runs, the MV INSERTs (which only write the functional
 * columns) succeed everywhere — ClickHouse fills the auto columns from
 * their DEFAULT expressions.
 *
 * Out of scope: backfilling legacy rows that were inserted before this
 * migration (they keep their existing values, including empty `_id`s
 * if the MV briefly broke under scenario B). Those rows are still
 * usable by the `*Merge()` read paths.
 */

const TARGET_TABLES: ReadonlyArray<string> = [
  "MetricItemAggMV1m",
  "MetricItemAggMV1mByHost",
  "MetricBaselineHourly",
];

export default class AddIdAndTimestampsToMVTargetTables extends DataMigrationBase {
  public constructor() {
    super("AddIdAndTimestampsToMVTargetTables");
  }

  public override runsInClusterMode(): boolean {
    return false;
  }

  public override async migrate(): Promise<void> {
    for (const table of TARGET_TABLES) {
      /*
       * Legacy tables may not exist: on fresh V3 installs the deprecated
       * MetricItemAggMV1mByHost is never created (superseded by the
       * model-owned ...ByHostV2), and an unguarded ALTER would throw
       * UNKNOWN_TABLE and wedge the migration chain.
       */
      if (!(await ClickHouseMigrationUtil.tableExists(table))) {
        logger.info(
          `AddIdAndTimestampsToMVTargetTables: ${table} not present — skipping.`,
        );
        continue;
      }
      await this.ensureColumn(table, "_id", "String", "generateUUIDv4()");
      await this.ensureColumn(table, "createdAt", "DateTime", "now()");
      /*
       * updatedAt was dropped from all telemetry tables in the V3 cut
       * (DropUpdatedAtFromTelemetryTables); re-adding it here only to
       * drop it again later is pointless churn, so it is no longer
       * ensured. Legacy installs that still carry it lose nothing.
       */
    }
  }

  private async ensureColumn(
    table: string,
    column: string,
    type: string,
    defaultExpr: string,
  ): Promise<void> {
    /*
     * `ADD COLUMN IF NOT EXISTS` covers the case where the column is
     * missing (legacy migration created the table). It's a no-op when
     * the column is already present.
     */
    await MetricService.execute(
      `ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS ${column} ${type} DEFAULT ${defaultExpr}`,
    );

    /*
     * `MODIFY COLUMN` covers the case where the column is present but
     * has no default (auto-create from `AnalyticsBaseModel` declared it
     * required without one). After the ADD above, the column always
     * exists, so this MODIFY is safe to run unconditionally; it sets
     * the DEFAULT expression we want and is idempotent when the
     * default is already correct.
     */
    await MetricService.execute(
      `ALTER TABLE ${table} MODIFY COLUMN ${column} ${type} DEFAULT ${defaultExpr}`,
    );

    logger.info(
      `Ensured column ${column} ${type} DEFAULT ${defaultExpr} on ${table}`,
    );
  }

  public override async rollback(): Promise<void> {
    return;
  }
}
