import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Calendars from outside a project, drawn on its scheduled maintenance
 * calendar (issue #5084), and their events.
 *
 * Two new tables:
 *
 *   - ScheduledMaintenanceExternalCalendar: a calendar's name, colour, its
 *     iCalendar link (encrypted by the service before it is written, never
 *     read back) and the link's host, whether it is on and how often it is
 *     read, and what its last read found. Indexed for the Workers' job that
 *     reads the calendars that are due (isEnabled, nextReadAt).
 *   - ScheduledMaintenanceExternalCalendarEvent: the events of the window a
 *     calendar's last read kept, indexed by calendar and start for the
 *     calendar page's reads of a period, and deleted with their calendar.
 *
 * Generated with `typeorm migration:generate` against a fully migrated
 * throwaway database; only the file/class name, this comment and the
 * formatting are hand-written. The indexes and foreign keys are on the
 * tables this migration creates, so they hold no lock on rows anyone writes.
 */
export class AddScheduledMaintenanceExternalCalendars1805120000000
  implements MigrationInterface
{
  public name: string = "AddScheduledMaintenanceExternalCalendars1805120000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "ScheduledMaintenanceExternalCalendar" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "name" character varying(100) NOT NULL, "calendarUrl" text NOT NULL, "calendarHost" character varying(100), "color" character varying(10) NOT NULL, "isEnabled" boolean NOT NULL DEFAULT true, "refreshIntervalInMinutes" integer NOT NULL DEFAULT '60', "lastReadAt" TIMESTAMP WITH TIME ZONE, "lastReadAttemptAt" TIMESTAMP WITH TIME ZONE, "lastReadError" character varying(100), "lastReadHttpStatus" integer, "eventCount" integer NOT NULL DEFAULT '0', "hasMoreEvents" boolean NOT NULL DEFAULT false, "nextReadAt" TIMESTAMP WITH TIME ZONE, "contentDigest" character varying(100), "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_978b050e3432835bc457f7a322b" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_0090a8e02f4b93969881c8cab0" ON "ScheduledMaintenanceExternalCalendar" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_34083404f13a8564000db0b73d" ON "ScheduledMaintenanceExternalCalendar" ("isEnabled") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_a779ff3476b2a26284dafcba60" ON "ScheduledMaintenanceExternalCalendar" ("nextReadAt") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_20ce698675689ee8c9dcb47c96" ON "ScheduledMaintenanceExternalCalendar" ("projectId", "name") `,
    );
    await queryRunner.query(
      `CREATE TABLE "ScheduledMaintenanceExternalCalendarEvent" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "scheduledMaintenanceExternalCalendarId" uuid NOT NULL, "title" character varying(500), "startsAt" TIMESTAMP WITH TIME ZONE NOT NULL, "endsAt" TIMESTAMP WITH TIME ZONE NOT NULL, "isAllDay" boolean NOT NULL DEFAULT false, CONSTRAINT "PK_26a3fdbf3cd29066462308cf03f" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_10832a616de1442aa719ab57b7" ON "ScheduledMaintenanceExternalCalendarEvent" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_a1b598c16eec543ab1120954d9" ON "ScheduledMaintenanceExternalCalendarEvent" ("scheduledMaintenanceExternalCalendarId", "startsAt") `,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceExternalCalendar" ADD CONSTRAINT "FK_0090a8e02f4b93969881c8cab0b" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceExternalCalendar" ADD CONSTRAINT "FK_148bfc3ad7eea6c57f64de604e1" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceExternalCalendar" ADD CONSTRAINT "FK_4e86740b5a1e58507dd8d8384c7" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceExternalCalendarEvent" ADD CONSTRAINT "FK_10832a616de1442aa719ab57b79" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceExternalCalendarEvent" ADD CONSTRAINT "FK_e781d562787003d21bc65405424" FOREIGN KEY ("scheduledMaintenanceExternalCalendarId") REFERENCES "ScheduledMaintenanceExternalCalendar"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceExternalCalendarEvent" DROP CONSTRAINT "FK_e781d562787003d21bc65405424"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceExternalCalendarEvent" DROP CONSTRAINT "FK_10832a616de1442aa719ab57b79"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceExternalCalendar" DROP CONSTRAINT "FK_4e86740b5a1e58507dd8d8384c7"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceExternalCalendar" DROP CONSTRAINT "FK_148bfc3ad7eea6c57f64de604e1"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceExternalCalendar" DROP CONSTRAINT "FK_0090a8e02f4b93969881c8cab0b"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_a1b598c16eec543ab1120954d9"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_10832a616de1442aa719ab57b7"`,
    );
    await queryRunner.query(
      `DROP TABLE "ScheduledMaintenanceExternalCalendarEvent"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_20ce698675689ee8c9dcb47c96"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_a779ff3476b2a26284dafcba60"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_34083404f13a8564000db0b73d"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_0090a8e02f4b93969881c8cab0"`,
    );
    await queryRunner.query(
      `DROP TABLE "ScheduledMaintenanceExternalCalendar"`,
    );
  }
}
