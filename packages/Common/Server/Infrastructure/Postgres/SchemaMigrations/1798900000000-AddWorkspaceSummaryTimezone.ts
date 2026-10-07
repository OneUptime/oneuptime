import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration, then renumbered after
 * the last registered migration.
 *
 * A workspace summary - the recurring incident, alert and episode summary
 * posted to Slack or Microsoft Teams - now has a time zone, and its schedule
 * is read on that zone's clock, so it goes out at the same time of day all
 * year (WorkspaceSummaryScheduleUtil). Without one, its schedule stepped in
 * UTC: a summary set for 09:00 in Berlin went out at 08:00 there once the
 * clocks went back.
 *
 * Nullable with no default, so this statement only adds the column: a
 * summary with none is read in UTC, exactly as before. The worker's data
 * migration SetWorkspaceSummaryTimezones then gives each existing summary
 * its creator's time zone (UTC when it has no creator with one), in short
 * statements of its own rather than inside this one's lock on the table.
 */
export class AddWorkspaceSummaryTimezone1798900000000
  implements MigrationInterface
{
  public name: string = "AddWorkspaceSummaryTimezone1798900000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "WorkspaceNotificationSummary" ADD "timezone" character varying(100)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "WorkspaceNotificationSummary" DROP COLUMN "timezone"`,
    );
  }
}
