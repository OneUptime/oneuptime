import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration, then renumbered after
 * the last registered migration, and given the backfill below.
 *
 * "notificationChannels": the channels an on-call compliance rule insists on,
 * as a list - a member needs a rule on every one of them. Empty (or NULL) is
 * "any channel". It replaces "notificationChannel", which could hold only one
 * channel, as what a rule checks.
 *
 * "notificationChannel" is kept, not dropped. Everything that only knows that
 * column - API clients from before the list, and a replica of the previous
 * build still serving while this one rolls out - keeps reading and writing
 * it, and TeamComplianceSettingService keeps it equal to the first channel of
 * the list. See TeamComplianceSettingService.getStoredChannels for how a row
 * is read when the two disagree.
 */
export class AddTeamComplianceRuleNotificationChannels1796500000000
  implements MigrationInterface
{
  public name: string =
    "AddTeamComplianceRuleNotificationChannels1796500000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "TeamComplianceSetting" ADD "notificationChannels" jsonb`,
    );

    /*
     * Every rule that insists on a channel gets it as a one-item list, so it
     * checks exactly what it checked before - and opens in the edit form,
     * which reads only the list, with its channel still selected. A rule on
     * any channel is left NULL, which reads as "any channel" too.
     */
    await queryRunner.query(
      `UPDATE "TeamComplianceSetting" SET "notificationChannels" = jsonb_build_array("notificationChannel") WHERE "notificationChannel" IS NOT NULL AND "notificationChannels" IS NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    /*
     * "notificationChannel" still holds each rule's first channel, so going
     * back leaves every rule checking that one channel - never widened to
     * "any channel". A rule on several channels loses the rest, the
     * unavoidable cost of a schema that cannot hold them.
     */
    await queryRunner.query(
      `ALTER TABLE "TeamComplianceSetting" DROP COLUMN "notificationChannels"`,
    );
  }
}
