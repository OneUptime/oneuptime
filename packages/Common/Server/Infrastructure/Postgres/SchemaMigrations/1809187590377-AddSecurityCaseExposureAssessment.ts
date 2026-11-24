import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Written as npm run generate-postgres-migration writes a nullable jsonb
 * column, numbered after the last registered migration.
 *
 * Data Security assesses an exposure (#10377): "SecurityCase" gains
 * "exposureAssessment" - which store a case's exposure assessment is
 * about, where a person said the people live, and OneUptime AI's write-up
 * and drafted notices, with the facts each rests on. Its own route serves
 * it; the generic API never reads it.
 *
 * Nullable with no default, so adding it rewrites nothing and takes no lock
 * a reader or a writer waits behind: an existing case has no assessment
 * until one is made.
 */
export class AddSecurityCaseExposureAssessment1809187590377
  implements MigrationInterface
{
  public name: string = "AddSecurityCaseExposureAssessment1809187590377";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "SecurityCase" ADD "exposureAssessment" jsonb`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "SecurityCase" DROP COLUMN "exposureAssessment"`,
    );
  }
}
