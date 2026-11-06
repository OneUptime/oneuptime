import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration.
 *
 * "UserNotificationSetting"."alertByMattermost": a person's updates in
 * Notification Settings through their connected Mattermost account too, off
 * for everyone until they turn it on. Its constant default lets Postgres add
 * it without rewriting the table, and it has no index to build.
 */
export class AddUserNotificationSettingAlertByMattermost1808992950000
  implements MigrationInterface
{
  public name: string =
    "AddUserNotificationSettingAlertByMattermost1808992950000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "UserNotificationSetting" ADD "alertByMattermost" boolean NOT NULL DEFAULT false`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "UserNotificationSetting" DROP COLUMN "alertByMattermost"`,
    );
  }
}
