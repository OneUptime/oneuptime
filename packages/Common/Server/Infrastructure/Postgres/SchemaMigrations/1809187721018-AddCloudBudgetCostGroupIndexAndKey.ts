import OnlineDdl from "../OnlineDdl";
import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration alongside
 * AddCloudBudgetScopesPeriodsAndPlans1809187721008, and moved into a
 * migration of its own: "CloudBudget" holds rows, and its budgets are
 * written by the worker every hour. So the index on the new
 * "cloudCostGroupId" column is built online, and its key to
 * "CloudCostGroup" is added NOT VALID and then validated, without blocking
 * those reads and writes meanwhile. Every existing row's column is null, so
 * the validation finds nothing to refuse. Index and key names are
 * TypeORM's own, so the schema drift check finds nothing to change.
 *
 * The key sets a budget's cost group to null when the group is deleted (ON
 * DELETE SET NULL): the budget is kept, unchecked, and its page says the
 * group was deleted, so it can be pointed at another group or deleted.
 *
 * Safe to run again after a stop part way: an index or key that is already
 * there is left as it is.
 */
export class AddCloudBudgetCostGroupIndexAndKey1809187721018
  implements MigrationInterface
{
  public name: string = "AddCloudBudgetCostGroupIndexAndKey1809187721018";

  // CREATE INDEX CONCURRENTLY and the validation run outside a transaction.
  public transaction: boolean = false;

  public async up(queryRunner: QueryRunner): Promise<void> {
    await OnlineDdl.createIndex(
      queryRunner,
      `CREATE INDEX "IDX_58a84782ee4e99699418bd2921" ON "CloudBudget" ("cloudCostGroupId") `,
    );
    await OnlineDdl.addForeignKey(
      queryRunner,
      `ALTER TABLE "CloudBudget" ADD CONSTRAINT "FK_58a84782ee4e99699418bd29211" FOREIGN KEY ("cloudCostGroupId") REFERENCES "CloudCostGroup"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "CloudBudget" DROP CONSTRAINT "FK_58a84782ee4e99699418bd29211"`,
    );
    await OnlineDdl.dropIndex(
      queryRunner,
      `DROP INDEX "public"."IDX_58a84782ee4e99699418bd2921"`,
    );
  }
}
