import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration, then renumbered after
 * the last registered migration.
 *
 * OneUptime AI analyses Data Security issues (#10369), and "Not an issue"
 * says why:
 *
 *   - "DataSecurityIssue" gains "aiVerdict", "aiAnalysis",
 *     "aiAnalyzedAt", "aiAnalysisInputHash" and "aiAnalysisLlmLogId": the
 *     analysis an issue keeps, what it was written from (hashed) and the AI
 *     Logs row of the call that wrote it;
 *   - and "notAnIssueReason": why a person said the finding was wrong.
 *
 * Each column is nullable with no default, so adding it rewrites nothing:
 * an existing issue has no analysis until OneUptime AI writes one.
 */
export class AddDataSecurityIssueAiAnalysis1809187410369
  implements MigrationInterface
{
  public name: string = "AddDataSecurityIssueAiAnalysis1809187410369";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "DataSecurityIssue" ADD "notAnIssueReason" character varying(500)`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataSecurityIssue" ADD "aiVerdict" character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataSecurityIssue" ADD "aiAnalysis" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataSecurityIssue" ADD "aiAnalyzedAt" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataSecurityIssue" ADD "aiAnalysisInputHash" character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataSecurityIssue" ADD "aiAnalysisLlmLogId" uuid`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "DataSecurityIssue" DROP COLUMN "aiAnalysisLlmLogId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataSecurityIssue" DROP COLUMN "aiAnalysisInputHash"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataSecurityIssue" DROP COLUMN "aiAnalyzedAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataSecurityIssue" DROP COLUMN "aiAnalysis"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataSecurityIssue" DROP COLUMN "aiVerdict"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataSecurityIssue" DROP COLUMN "notAnIssueReason"`,
    );
  }
}
