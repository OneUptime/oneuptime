import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * When a scheduled maintenance event first shows on its status pages
 * (ScheduledMaintenance.publishOnStatusPageAt, GitHub issue #5249): until
 * a time set there has come, the event is on no status page, feed or
 * calendar, and its subscribers hear nothing of it. Generated with npm run
 * generate-postgres-migration. A nullable column with no default, so it is
 * added without rewriting the table; every event has none, which is
 * published as soon as it is created - nothing changes for any event until
 * someone sets a time.
 */
export class AddScheduledMaintenancePublishOnStatusPageAt1807960000000
  implements MigrationInterface
{
  public name: string =
    "AddScheduledMaintenancePublishOnStatusPageAt1807960000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenance" ADD "publishOnStatusPageAt" TIMESTAMP WITH TIME ZONE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenance" DROP COLUMN "publishOnStatusPageAt"`,
    );
  }
}
