import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Two additions to the AI fix pipeline (generated via
 * generate-postgres-migration, trimmed to just these changes):
 *
 *   - Project.enableAutomaticCodeFixes (default false — G11 posture:
 *     autonomous PR creation is strictly opt-in): an investigation that
 *     ends with a CONFIDENT root cause analysis auto-enqueues the
 *     FixFromIncident task that opens a draft fix PR, instead of waiting
 *     for the "Open Fix PR from this analysis" button. No backfill: every
 *     existing project keeps the human-triggered behavior until it opts in.
 *
 *   - The pre-PR build/test verification loop. CodeRepository gains the
 *     operator-authored setup/build/test commands the Runner executes at
 *     the repository root against an AI-authored fix before its PR opens;
 *     AIAgentTaskPullRequest gains the recorded outcome
 *     (runnerVerificationStatus: Passed/Failed/Skipped, plus a
 *     human-readable summary). All nullable, no backfill: repositories
 *     with no commands configured are Skipped and the PR says so, and
 *     PRs recorded before this deploy simply have no verification row —
 *     distinct from ciStatus, which mirrors the repository's own CI after
 *     the PR exists.
 */
export class AddFixVerificationAndAutomaticCodeFixes1785890000000
  implements MigrationInterface
{
  public name = "AddFixVerificationAndAutomaticCodeFixes1785890000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "Project" ADD "enableAutomaticCodeFixes" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "CodeRepository" ADD "setupCommand" character varying(500)`,
    );
    await queryRunner.query(
      `ALTER TABLE "CodeRepository" ADD "buildCommand" character varying(500)`,
    );
    await queryRunner.query(
      `ALTER TABLE "CodeRepository" ADD "testCommand" character varying(500)`,
    );
    await queryRunner.query(
      `ALTER TABLE "AIAgentTaskPullRequest" ADD "runnerVerificationStatus" character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "AIAgentTaskPullRequest" ADD "runnerVerificationSummary" character varying(500)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "AIAgentTaskPullRequest" DROP COLUMN "runnerVerificationSummary"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AIAgentTaskPullRequest" DROP COLUMN "runnerVerificationStatus"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CodeRepository" DROP COLUMN "testCommand"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CodeRepository" DROP COLUMN "buildCommand"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CodeRepository" DROP COLUMN "setupCommand"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Project" DROP COLUMN "enableAutomaticCodeFixes"`,
    );
  }
}
