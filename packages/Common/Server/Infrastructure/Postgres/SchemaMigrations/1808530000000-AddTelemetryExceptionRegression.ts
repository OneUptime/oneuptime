import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration, then renumbered after
 * the last registered migration.
 *
 *   - "TelemetryException"."regressedAt": when a resolved exception last came
 *     back - the ingest upsert stamps it as it reopens the exception, and
 *     resolving or reopening it by hand clears it.
 *   - "TelemetryException"."resolvedInReleaseAfter": "Resolve in next
 *     release" - the release an exception was resolved after, whose own
 *     occurrences do not reopen it.
 *
 * Two nullable columns with no default: adding them rewrites nothing, and
 * every existing exception reads as it did (never regressed, a plain
 * resolve).
 */
export class AddTelemetryExceptionRegression1808530000000
  implements MigrationInterface
{
  public name: string = "AddTelemetryExceptionRegression1808530000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "TelemetryException" ADD "regressedAt" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "TelemetryException" ADD "resolvedInReleaseAfter" character varying(500)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "TelemetryException" DROP COLUMN "resolvedInReleaseAfter"`,
    );
    await queryRunner.query(
      `ALTER TABLE "TelemetryException" DROP COLUMN "regressedAt"`,
    );
  }
}
