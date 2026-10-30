import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration, then renumbered after
 * the last registered migration. Its indexes and foreign keys are built
 * online by AddTelemetryExceptionMergeIndexesAndKeys1808630000000.
 *
 *   - "TelemetryException"."mergedIntoTelemetryExceptionId": the exception
 *     this one was merged into as the same bug (TelemetryExceptionMerge);
 *     its fingerprint is then an alias of that one.
 *   - "TelemetryException"."mergedAt" and "mergedByUserId": when, and who.
 *
 * Three nullable columns with no default: adding them rewrites nothing.
 */
export class AddTelemetryExceptionMerge1808620000000
  implements MigrationInterface
{
  public name: string = "AddTelemetryExceptionMerge1808620000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "TelemetryException" ADD "mergedIntoTelemetryExceptionId" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "TelemetryException" ADD "mergedAt" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "TelemetryException" ADD "mergedByUserId" uuid`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "TelemetryException" DROP COLUMN "mergedByUserId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "TelemetryException" DROP COLUMN "mergedAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "TelemetryException" DROP COLUMN "mergedIntoTelemetryExceptionId"`,
    );
  }
}
