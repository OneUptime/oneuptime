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
 * than usual is an alert of its own (CloudBudgetEvaluator). On for every
 * budget, as the form starts a new one.
 *
 * A nullable column and a constant default add their columns without
 * rewriting either table, and no index or foreign key is added, so nothing
 * scans or locks them.
 */
export class AddCloudRightSizingEvidenceAndBudgetUnusualDays1808992600000
  implements MigrationInterface
{
  public name: string =
    "AddCloudRightSizingEvidenceAndBudgetUnusualDays1808992600000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "CloudBudget" ADD "alertOnAnomaly" boolean NOT NULL DEFAULT true`,
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
