import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration, then renumbered after
 * the last registered migration.
 *
 * The public note posted with a state change - "Add a public note" in the
 * state change dialogs, the Change State bulk action, or
 * `miscDataProps.publicNote` on a state timeline create - now carries the
 * state its incident or scheduled maintenance event moved to, so the
 * messages subscribers get for it can name it ("Status: Resolved").
 *
 * Both columns are nullable with no default, so every note already posted -
 * and every note posted on its own from now on - has none, and its messages
 * read as they always have. A state that is deleted only clears the column
 * (ON DELETE SET NULL): the note stays.
 */
export class AddPublicNotePostedWithState1798400000000
  implements MigrationInterface
{
  public name: string = "AddPublicNotePostedWithState1798400000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "IncidentPublicNote" ADD "postedWithIncidentStateId" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenancePublicNote" ADD "postedWithScheduledMaintenanceStateId" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentPublicNote" ADD CONSTRAINT "FK_9a4587dd87c6a5d311330ce2047" FOREIGN KEY ("postedWithIncidentStateId") REFERENCES "IncidentState"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenancePublicNote" ADD CONSTRAINT "FK_42c99ea57184760261a21b6b721" FOREIGN KEY ("postedWithScheduledMaintenanceStateId") REFERENCES "ScheduledMaintenanceState"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenancePublicNote" DROP CONSTRAINT "FK_42c99ea57184760261a21b6b721"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentPublicNote" DROP CONSTRAINT "FK_9a4587dd87c6a5d311330ce2047"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenancePublicNote" DROP COLUMN "postedWithScheduledMaintenanceStateId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentPublicNote" DROP COLUMN "postedWithIncidentStateId"`,
    );
  }
}
