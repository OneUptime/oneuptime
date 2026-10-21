import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration, then renumbered after
 * the last registered migration.
 *
 * The calendar event of a Microsoft Teams incident call OneUptime put on its
 * organizer's calendar, as it does while Record and transcribe incident
 * calls is on, so that it can read the meeting's transcript
 * (IncidentVideoCall.externalCalendarEventId). One nullable column: no table
 * is rewritten, and no index or foreign key is built.
 */
export class AddIncidentVideoCallCalendarEvent1804150000000
  implements MigrationInterface
{
  public name: string = "AddIncidentVideoCallCalendarEvent1804150000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "IncidentVideoCall" ADD "externalCalendarEventId" character varying(500)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "IncidentVideoCall" DROP COLUMN "externalCalendarEventId"`,
    );
  }
}
