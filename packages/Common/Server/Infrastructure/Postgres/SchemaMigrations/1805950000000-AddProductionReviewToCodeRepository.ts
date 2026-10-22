import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration, then renumbered after
 * the last registered migration.
 *
 * A repository's production review settings (Common/Server/Utils/
 * CodeRepository/ProductionReview): whether OneUptime reviews its pull
 * requests against production on its own (isProductionReviewEnabled), and
 * what a pull request's review comment shows
 * (productionReviewPullRequestContent: Review, Link or ReviewEvenIfPublic).
 *
 * Nothing to backfill, on purpose: both columns start empty on every
 * repository there is. An empty isProductionReviewEnabled is off, so no
 * repository connected before this - whose pull requests never had a
 * comment from OneUptime - gets one unasked; repositories the GitHub App
 * connects from now on start with it on (CodeRepositoryService
 * .getNewRepositoryDefaults). An empty productionReviewPullRequestContent
 * is Review. Adding a nullable column without a default rewrites no row.
 */
export class AddProductionReviewToCodeRepository1805950000000
  implements MigrationInterface
{
  public name: string = "AddProductionReviewToCodeRepository1805950000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "CodeRepository" ADD "isProductionReviewEnabled" boolean`,
    );
    await queryRunner.query(
      `ALTER TABLE "CodeRepository" ADD "productionReviewPullRequestContent" character varying(100)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "CodeRepository" DROP COLUMN "productionReviewPullRequestContent"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CodeRepository" DROP COLUMN "isProductionReviewEnabled"`,
    );
  }
}
