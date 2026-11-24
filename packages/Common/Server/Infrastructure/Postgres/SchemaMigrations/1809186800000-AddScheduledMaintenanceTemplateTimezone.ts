import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration, then renumbered after
 * the last registered migration.
 *
 * A scheduled maintenance template now has a time zone, and its recurring
 * schedule is read on that zone's calendar (MaintenanceTemplateSchedule,
 * #10037): every event is the first one moved on whole days, weeks, months
 * or years there, so a 02:00 window stays at 02:00 when the clocks change
 * and a monthly window on the 1st stays on the 1st. Until now the next
 * event was the last one plus a fixed number of milliseconds - a day of 24
 * hours, a month of 30.4375 days.
 *
 * Every template saved before this reads UTC. That is the clock its events
 * were stepped on all along - a UTC day is 24 hours - so no hourly, daily
 * or weekly template's upcoming event moves; only monthly and yearly ones
 * go back to their first event's day of the month. A template whose times
 * were meant on a local clock that changes for daylight saving time is set
 * to that zone on its form. A new template takes its creator's time zone.
 *
 * Adding a column with a constant default writes no row (Postgres 11 and
 * later keep the default in the catalogue), so this holds the table's lock
 * only for an instant. Nothing else about a template changes, and no next
 * event time is moved.
 */
export class AddScheduledMaintenanceTemplateTimezone1809186800000
  implements MigrationInterface
{
  public name: string = "AddScheduledMaintenanceTemplateTimezone1809186800000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceTemplate" ADD "timezone" character varying(100) NOT NULL DEFAULT 'UTC'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceTemplate" DROP COLUMN "timezone"`,
    );
  }
}
