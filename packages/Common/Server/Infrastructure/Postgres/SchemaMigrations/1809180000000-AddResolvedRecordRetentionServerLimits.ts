import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * The server's limits on how long projects keep resolved incidents and
 * alerts (issue #6941): GlobalConfig's maximum and new-project default for
 * each, empty on every server - no maximum, and new projects at Never - so
 * the upgrade deletes nothing. And which postmortem statuses keep an
 * incident (issue #6945): Project.keepIncidentsInPostmortemStatusIds, empty
 * on every project - the Completed status, as before.
 *
 * Nullable columns with no default: Postgres adds each without rewriting
 * its table.
 */
export class AddResolvedRecordRetentionServerLimits1809180000000
  implements MigrationInterface
{
  public name: string = "AddResolvedRecordRetentionServerLimits1809180000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "Project" ADD "keepIncidentsInPostmortemStatusIds" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" ADD "maxIncidentRetentionInDays" integer`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" ADD "maxAlertRetentionInDays" integer`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" ADD "defaultIncidentRetentionInDays" integer`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" ADD "defaultAlertRetentionInDays" integer`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" DROP COLUMN "defaultAlertRetentionInDays"`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" DROP COLUMN "defaultIncidentRetentionInDays"`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" DROP COLUMN "maxAlertRetentionInDays"`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" DROP COLUMN "maxIncidentRetentionInDays"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Project" DROP COLUMN "keepIncidentsInPostmortemStatusIds"`,
    );
  }
}
