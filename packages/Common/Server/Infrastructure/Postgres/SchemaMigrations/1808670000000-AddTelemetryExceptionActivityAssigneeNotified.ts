import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration, then renumbered after
 * the last registered migration. Its index is built online by
 * AddTelemetryExceptionActivityAssigneeNotifiedIndex1808680000000.
 *
 *   - "TelemetryExceptionActivity"."isAssigneeNotified": whether the people
 *     an Assigned entry hands the exception to were told
 *     (ExceptionAssignmentNotifications). Every entry already there reads
 *     true: an assignment made before assignments were told is not told
 *     late.
 *
 * A boolean with a constant default: adding it rewrites nothing.
 */
export class AddTelemetryExceptionActivityAssigneeNotified1808670000000
  implements MigrationInterface
{
  public name: string =
    "AddTelemetryExceptionActivityAssigneeNotified1808670000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "TelemetryExceptionActivity" ADD "isAssigneeNotified" boolean NOT NULL DEFAULT true`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "TelemetryExceptionActivity" DROP COLUMN "isAssigneeNotified"`,
    );
  }
}
