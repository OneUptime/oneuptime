import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration, then renumbered after
 * the last registered migration.
 *
 * A repository's switch for failing its production review's check on a
 * leak of sensitive data (CodeRepository.isProductionReviewFailOnLeakEnabled,
 * #10376): a pull request that writes a secret or Restricted data to
 * telemetry, makes a store that may hold sensitive data public, or adds a
 * column for a password or a card security code stored as it is.
 *
 * Nothing to backfill, on purpose: the column starts empty on every
 * repository there is, and empty is off - the check stays neutral, as every
 * review's always was, until someone turns it on. Adding a nullable column
 * without a default rewrites no row.
 */
export class AddCodeRepositoryProductionReviewFailOnLeak1809187470500
  implements MigrationInterface
{
  public name: string =
    "AddCodeRepositoryProductionReviewFailOnLeak1809187470500";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "CodeRepository" ADD "isProductionReviewFailOnLeakEnabled" boolean`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "CodeRepository" DROP COLUMN "isProductionReviewFailOnLeakEnabled"`,
    );
  }
}
