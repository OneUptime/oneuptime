import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration, then renumbered after
 * the last registered migration.
 *
 *   - "TelemetryException"."aiExplanation": OneUptime AI's explanation of an
 *     exception (summary, likely root cause, suggested fix, confidence,
 *     suspect frames, next steps), kept so the next reader does not pay for
 *     it again.
 *   - "TelemetryException"."aiExplanationGeneratedAt": when it was written.
 *
 * Two nullable columns with no default: adding them rewrites nothing.
 */
export class AddTelemetryExceptionAiExplanation1808580000000
  implements MigrationInterface
{
  public name: string = "AddTelemetryExceptionAiExplanation1808580000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "TelemetryException" ADD "aiExplanation" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "TelemetryException" ADD "aiExplanationGeneratedAt" TIMESTAMP WITH TIME ZONE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "TelemetryException" DROP COLUMN "aiExplanationGeneratedAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "TelemetryException" DROP COLUMN "aiExplanation"`,
    );
  }
}
