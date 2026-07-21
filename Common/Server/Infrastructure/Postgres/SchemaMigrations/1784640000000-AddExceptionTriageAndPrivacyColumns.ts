import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * AI exception triage + privacy columns:
 *
 * - TelemetryException.unhandled: sticky rollup of OTel exception.escaped
 *   (maintained by the ingest upsert with OR semantics).
 * - TelemetryException.aiClassification: triage verdict (code-fault,
 *   user-error, expected-denial, infrastructure, unknown).
 * - TelemetryException.aiFixDeclinedAt: stamped when a human closes an
 *   AI fix PR without merging; suppresses further automatic fix attempts.
 * - AIInsight.classification: the same triage verdict on the insight row.
 * - Project.autoArchiveNonActionableExceptions: opt-in auto-archive of
 *   expected-denial exception groups.
 */
export class AddExceptionTriageAndPrivacyColumns1784640000000
  implements MigrationInterface
{
  public name: string = "AddExceptionTriageAndPrivacyColumns1784640000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "TelemetryException" ADD "unhandled" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "TelemetryException" ADD "aiClassification" character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "TelemetryException" ADD "aiFixDeclinedAt" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "AIInsight" ADD "classification" character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "Project" ADD "autoArchiveNonActionableExceptions" boolean NOT NULL DEFAULT false`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "Project" DROP COLUMN "autoArchiveNonActionableExceptions"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AIInsight" DROP COLUMN "classification"`,
    );
    await queryRunner.query(
      `ALTER TABLE "TelemetryException" DROP COLUMN "aiFixDeclinedAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "TelemetryException" DROP COLUMN "aiClassification"`,
    );
    await queryRunner.query(
      `ALTER TABLE "TelemetryException" DROP COLUMN "unhandled"`,
    );
  }
}
