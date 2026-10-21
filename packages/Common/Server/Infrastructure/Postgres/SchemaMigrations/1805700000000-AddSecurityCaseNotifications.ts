import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration, then renumbered after
 * the last registered migration.
 *
 * Security cases now notify people (SecurityCaseNotifications): a case that
 * opens or rises at the priority a person chose, a case assigned to them or
 * their team, a playbook step waiting for their approval. A case keeps the
 * highest priority people were told about it at (notifiedPriority), so a
 * rise is told only to the people it newly reaches, and a person's New
 * Security Case setting keeps the priority they chose
 * (minimumSecurityCasePriority).
 *
 * Nothing to backfill: both columns are nullable. An empty choice reads as
 * High, the default, and a case nobody was told about yet tells the people
 * its priority reaches the first time it rises.
 */
export class AddSecurityCaseNotifications1805700000000
  implements MigrationInterface
{
  public name: string = "AddSecurityCaseNotifications1805700000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "SecurityCase" ADD "notifiedPriority" character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserNotificationSetting" ADD "minimumSecurityCasePriority" character varying(100)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "UserNotificationSetting" DROP COLUMN "minimumSecurityCasePriority"`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityCase" DROP COLUMN "notifiedPriority"`,
    );
  }
}
