import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Cloud budgets for any scope and period, with plans and their own people
 * to tell (#11008).
 *
 * Generated with npm run generate-postgres-migration, then renumbered after
 * the last registered migration. "CloudBudget" gains:
 *
 *   - "scope", "cloudCostGroupId" and "filterRules": what it counts - every
 *     account, one account, a cost group or a filter of services, Regions
 *     and tags;
 *   - "period", "fiscalYearStartMonth", "planSplit" and "monthlyPlan": a
 *     month, a quarter or a year from the fiscal year's first month, and a
 *     yearly budget split by month;
 *   - "unusualDayThreshold" and "unusualDayThresholdUnit": a budget's own
 *     unusual day, judged on its scope's daily spend;
 *   - "notifyCostGroupTeam", and the "CloudBudgetNotifyUser" and
 *     "CloudBudgetNotifyTeam" tables: who is told below 100% with no alert,
 *     and owns the alert from 100%;
 *   - "spentThisPeriod" and "projectedThisPeriod": the period's figures, for
 *     the Budgets page.
 *
 * Every budget made before is a monthly one with no plan, as each default
 * says, and keeps behaving exactly as it did. Its scope is every account's,
 * or - a budget that names an account - that account's: the UPDATE below,
 * run with the schema migrations so it is in place before any server reads
 * a budget's scope. A server of the release before, still running while
 * this one rolls out, writes no scope; CloudBudgetScope's reader takes a
 * budget that names an account as that account's whatever its scope says,
 * and CloudBudgetService writes the scope on every save from now on.
 *
 * Nullable columns and constant defaults add their columns without
 * rewriting the table. The two new tables are empty, so their indexes and
 * keys lock nothing for long. The index and the key on "cloudCostGroupId",
 * a column of a table that holds rows, are built online in
 * AddCloudBudgetCostGroupIndexAndKey1809187761018.
 */
export const CLOUD_BUDGET_ACCOUNT_SCOPE_UPDATE: string = `UPDATE "CloudBudget" SET "scope" = 'account' WHERE "cloudAccountId" IS NOT NULL`;

export class AddCloudBudgetScopesPeriodsAndPlans1809187761008
  implements MigrationInterface
{
  public name: string = "AddCloudBudgetScopesPeriodsAndPlans1809187761008";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "CloudBudgetNotifyUser" ("cloudBudgetId" uuid NOT NULL, "userId" uuid NOT NULL, CONSTRAINT "PK_812a0108ec8b87903612d36bb5f" PRIMARY KEY ("cloudBudgetId", "userId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_6182365040f52eb4265ae2cc95" ON "CloudBudgetNotifyUser" ("cloudBudgetId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_4edeb860b0eac562177923b40a" ON "CloudBudgetNotifyUser" ("userId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "CloudBudgetNotifyTeam" ("cloudBudgetId" uuid NOT NULL, "teamId" uuid NOT NULL, CONSTRAINT "PK_979ba9bace599cccc6ea890c701" PRIMARY KEY ("cloudBudgetId", "teamId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_6634d814ff91910f56e093ebf0" ON "CloudBudgetNotifyTeam" ("cloudBudgetId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_01234e6405cf630769b50c6623" ON "CloudBudgetNotifyTeam" ("teamId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudBudget" ADD "scope" character varying(100) NOT NULL DEFAULT 'allAccounts'`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudBudget" ADD "cloudCostGroupId" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudBudget" ADD "filterRules" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudBudget" ADD "period" character varying(100) NOT NULL DEFAULT 'month'`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudBudget" ADD "fiscalYearStartMonth" integer NOT NULL DEFAULT '1'`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudBudget" ADD "planSplit" character varying(100) NOT NULL DEFAULT 'none'`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudBudget" ADD "monthlyPlan" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudBudget" ADD "unusualDayThreshold" numeric`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudBudget" ADD "unusualDayThresholdUnit" character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudBudget" ADD "notifyCostGroupTeam" boolean NOT NULL DEFAULT true`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudBudget" ADD "spentThisPeriod" numeric`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudBudget" ADD "projectedThisPeriod" numeric`,
    );
    await queryRunner.query(CLOUD_BUDGET_ACCOUNT_SCOPE_UPDATE);
    await queryRunner.query(
      `ALTER TABLE "CloudBudgetNotifyUser" ADD CONSTRAINT "FK_6182365040f52eb4265ae2cc95b" FOREIGN KEY ("cloudBudgetId") REFERENCES "CloudBudget"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudBudgetNotifyUser" ADD CONSTRAINT "FK_4edeb860b0eac562177923b40ad" FOREIGN KEY ("userId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudBudgetNotifyTeam" ADD CONSTRAINT "FK_6634d814ff91910f56e093ebf0e" FOREIGN KEY ("cloudBudgetId") REFERENCES "CloudBudget"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudBudgetNotifyTeam" ADD CONSTRAINT "FK_01234e6405cf630769b50c66237" FOREIGN KEY ("teamId") REFERENCES "Team"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "CloudBudgetNotifyTeam" DROP CONSTRAINT "FK_01234e6405cf630769b50c66237"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudBudgetNotifyTeam" DROP CONSTRAINT "FK_6634d814ff91910f56e093ebf0e"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudBudgetNotifyUser" DROP CONSTRAINT "FK_4edeb860b0eac562177923b40ad"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudBudgetNotifyUser" DROP CONSTRAINT "FK_6182365040f52eb4265ae2cc95b"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudBudget" DROP COLUMN "projectedThisPeriod"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudBudget" DROP COLUMN "spentThisPeriod"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudBudget" DROP COLUMN "notifyCostGroupTeam"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudBudget" DROP COLUMN "unusualDayThresholdUnit"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudBudget" DROP COLUMN "unusualDayThreshold"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudBudget" DROP COLUMN "monthlyPlan"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudBudget" DROP COLUMN "planSplit"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudBudget" DROP COLUMN "fiscalYearStartMonth"`,
    );
    await queryRunner.query(`ALTER TABLE "CloudBudget" DROP COLUMN "period"`);
    await queryRunner.query(
      `ALTER TABLE "CloudBudget" DROP COLUMN "filterRules"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudBudget" DROP COLUMN "cloudCostGroupId"`,
    );
    await queryRunner.query(`ALTER TABLE "CloudBudget" DROP COLUMN "scope"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_01234e6405cf630769b50c6623"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_6634d814ff91910f56e093ebf0"`,
    );
    await queryRunner.query(`DROP TABLE "CloudBudgetNotifyTeam"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_4edeb860b0eac562177923b40a"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_6182365040f52eb4265ae2cc95"`,
    );
    await queryRunner.query(`DROP TABLE "CloudBudgetNotifyUser"`);
  }
}
