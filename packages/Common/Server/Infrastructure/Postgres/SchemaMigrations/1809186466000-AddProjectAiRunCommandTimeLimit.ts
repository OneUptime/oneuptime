import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * How long one command of a code task may run on a Runner of the project's
 * own (issue #6532, Project Settings → AI → AI Features → More settings →
 * Limits per run → Time Limit per Command): a slow install, build or test
 * suite was stopped at ten minutes, however long it needed
 * (Types/AI/ProjectAiRunLimits).
 *
 * Nullable with no default: every project, existing or new, starts with
 * none set - the default, ten minutes, as a command always had. Adding a
 * nullable column without a default rewrites no row.
 *
 * Written as npm run generate-postgres-migration writes a nullable integer
 * column, numbered after main's newest.
 */
export class AddProjectAiRunCommandTimeLimit1809186466000
  implements MigrationInterface
{
  public name: string = "AddProjectAiRunCommandTimeLimit1809186466000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "Project" ADD "aiRunCommandTimeLimitInMinutes" integer`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "Project" DROP COLUMN "aiRunCommandTimeLimitInMinutes"`,
    );
  }
}
