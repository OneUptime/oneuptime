import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Existing code-fix runs get their repository back, so they appear on their
 * repository's page in Code rather than under Other tasks.
 *
 * A run that recorded a pull request takes that pull request's repository:
 * its latest record, and only when the record is in the run's own project.
 * The record's "codeRepositoryId" is a foreign key, so the repository exists.
 */
export const CODE_TASK_BACKFILL_FROM_PULL_REQUESTS: string = `UPDATE "AIRun" AS "run" SET "codeRepositoryId" = "pullRequest"."codeRepositoryId" FROM (SELECT DISTINCT ON ("aiRunId") "aiRunId", "projectId", "codeRepositoryId" FROM "AIAgentTaskPullRequest" WHERE "aiRunId" IS NOT NULL AND "codeRepositoryId" IS NOT NULL AND "deletedAt" IS NULL ORDER BY "aiRunId", "createdAt" DESC) AS "pullRequest" WHERE "run"."_id" = "pullRequest"."aiRunId" AND "run"."projectId" = "pullRequest"."projectId" AND "run"."runType" = 'CodeFix' AND "run"."codeRepositoryId" IS NULL`;

/*
 * A GitHub-triggered run takes the repository its command came from, when
 * that repository is still in the run's project. Text is compared with text,
 * so a malformed value in the JSON context cannot fail the migration.
 */
export const CODE_TASK_BACKFILL_FROM_GITHUB_COMMANDS: string = `UPDATE "AIRun" AS "run" SET "codeRepositoryId" = "repository"."_id" FROM "CodeRepository" AS "repository" WHERE "run"."runType" = 'CodeFix' AND "run"."codeRepositoryId" IS NULL AND ("run"."taskContext" -> 'github' ->> 'codeRepositoryId') = "repository"."_id"::text AND "repository"."projectId" = "run"."projectId" AND "repository"."deletedAt" IS NULL`;

/*
 * Generated with npm run generate-postgres-migration; its index and foreign
 * key moved into AddCodeTaskIndexesAndKey1804100000000, which builds them
 * online.
 *
 * Code: the Tasks product became Code, where a repository holds its tasks
 * and a task is a conversation of runs (Types/AI/CodeTask). New columns on
 * "AIRun":
 *
 *  - "codeRepositoryId": the repository a code task works in.
 *  - "codeTaskId": for a reply in a task's conversation, the task's first run.
 *  - "title": a request's title (server-only).
 *  - "needsUserInput": the run ended by asking the person a question.
 *  - "taskOutcome" / "codeChanges": what a turn ended with, and its diff.
 *
 * All of them are nullable or carry a constant default, which Postgres adds
 * without rewriting the table. Then the two backfills above give existing
 * code-fix runs their repository; only code-fix runs are touched, through
 * the "runType" index.
 */
export class AddCodeTasks1804050000000 implements MigrationInterface {
  public name: string = "AddCodeTasks1804050000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "AIRun" ADD "codeRepositoryId" uuid`);
    await queryRunner.query(`ALTER TABLE "AIRun" ADD "codeTaskId" uuid`);
    await queryRunner.query(
      `ALTER TABLE "AIRun" ADD "title" character varying(500)`,
    );
    await queryRunner.query(
      `ALTER TABLE "AIRun" ADD "needsUserInput" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(`ALTER TABLE "AIRun" ADD "taskOutcome" jsonb`);
    await queryRunner.query(`ALTER TABLE "AIRun" ADD "codeChanges" jsonb`);

    await queryRunner.query(CODE_TASK_BACKFILL_FROM_PULL_REQUESTS);
    await queryRunner.query(CODE_TASK_BACKFILL_FROM_GITHUB_COMMANDS);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "AIRun" DROP COLUMN "codeChanges"`);
    await queryRunner.query(`ALTER TABLE "AIRun" DROP COLUMN "taskOutcome"`);
    await queryRunner.query(`ALTER TABLE "AIRun" DROP COLUMN "needsUserInput"`);
    await queryRunner.query(`ALTER TABLE "AIRun" DROP COLUMN "title"`);
    await queryRunner.query(`ALTER TABLE "AIRun" DROP COLUMN "codeTaskId"`);
    await queryRunner.query(
      `ALTER TABLE "AIRun" DROP COLUMN "codeRepositoryId"`,
    );
  }
}
