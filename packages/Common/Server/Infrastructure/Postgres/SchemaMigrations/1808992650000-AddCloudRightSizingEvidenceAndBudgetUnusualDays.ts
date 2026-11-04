import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration, then renumbered after
 * the last registered migration.
 *
 * "CloudCostRecommendation" gains "evidence": the readings a right-sizing
 * OneUptime worked out from its own CPU and memory readings stood on (its
 * CPU's 95th percentile and highest reading, its memory's peak, the days
 * read), shown with the way to spend less (CloudRightSizingWriter). Empty
 * for a cloud recommender's.
 *
 * "CloudBudget" gains "alertOnAnomaly": whether a day that cost far more
 * than usual is an alert of its own (CloudBudgetEvaluator). A budget made
 * from now on starts with it on, as the form does. A budget made before
 * it keeps alerting as it did - its thresholds and its projection - so
 * nobody is paged for a new kind of alert they never chose: the column is
 * added as false for the rows already there, then defaults to true. Its
 * owner turns it on under Edit.
 *
 * A nullable column and a constant default add their columns without
 * rewriting either table, a column default changes no row, and no index or
 * foreign key is added, so nothing scans or locks them.
 */
export class AddCloudRightSizingEvidenceAndBudgetUnusualDays1808992650000
  implements MigrationInterface
{
  public name: string =
    "AddCloudRightSizingEvidenceAndBudgetUnusualDays1808992650000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "CloudBudget" ADD "alertOnAnomaly" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudBudget" ALTER COLUMN "alertOnAnomaly" SET DEFAULT true`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudCostRecommendation" ADD "evidence" jsonb`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "CloudCostRecommendation" DROP COLUMN "evidence"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudBudget" DROP COLUMN "alertOnAnomaly"`,
    );
  }
}
