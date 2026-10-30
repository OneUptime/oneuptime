import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration, then renumbered after
 * the last registered migration.
 *
 * The daily update check (Workers/Jobs/InstanceUpdate) also reads the
 * security advisories OneUptime publishes on GitHub. GlobalConfig keeps:
 *
 *   - "securityAdvisories": the published advisories, as of the last check;
 *   - "securityAdvisoriesCheckedAt": when GitHub last answered with them;
 *   - "securityAdvisoriesEmailed": which advisories the owners were emailed
 *     about, and when - each one once;
 *   - "updateCheckLastAttemptAt" / "updateCheckLastFailure": when the check
 *     last asked GitHub, and why that failed, if it did.
 *
 * Nullable columns added to the one-row GlobalConfig table: no index, no
 * foreign key, nothing to backfill.
 */
export class AddUpdateCheckSecurityAdvisoryColumns1808510000000
  implements MigrationInterface
{
  public name: string = "AddUpdateCheckSecurityAdvisoryColumns1808510000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" ADD "securityAdvisories" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" ADD "securityAdvisoriesCheckedAt" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" ADD "securityAdvisoriesEmailed" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" ADD "updateCheckLastAttemptAt" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" ADD "updateCheckLastFailure" character varying(100)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" DROP COLUMN "updateCheckLastFailure"`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" DROP COLUMN "updateCheckLastAttemptAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" DROP COLUMN "securityAdvisoriesEmailed"`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" DROP COLUMN "securityAdvisoriesCheckedAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" DROP COLUMN "securityAdvisories"`,
    );
  }
}
