import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * A measurement's backfill walks a project's incidents, alerts or scheduled
 * maintenance events in (createdAt, _id) order, and its cursor is the last
 * record it worked out: backfillCursorCreatedAt and, with this,
 * backfillCursorId. With the createdAt alone, more than a page of records
 * created at one moment (one transaction's now()) stopped the walk for good
 * (#8171).
 *
 * Nullable with no default, so each table only gains a column in its
 * catalog: no row is rewritten, and nothing waits on the tables beyond the
 * moment the ALTER takes. A walk under way when this runs has no id yet:
 * its next page reads from its createdAt on, as it did, and saves both.
 */
export class AddMeasurementBackfillCursorId1809178200000
  implements MigrationInterface
{
  public name: string = "AddMeasurementBackfillCursorId1809178200000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "IncidentMeasurement" ADD "backfillCursorId" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertMeasurement" ADD "backfillCursorId" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceMeasurement" ADD "backfillCursorId" uuid`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceMeasurement" DROP COLUMN "backfillCursorId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertMeasurement" DROP COLUMN "backfillCursorId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentMeasurement" DROP COLUMN "backfillCursorId"`,
    );
  }
}
