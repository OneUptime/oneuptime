import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * A project's own limits on each OneUptime AI run (issue #6440, Project
 * Settings → AI → AI Features → More settings → Limits per run): the most
 * model calls, tool calls and tokens one run may use, and its time limit
 * (Types/AI/ProjectAiRunLimits).
 *
 * All four are nullable with no default: every project, existing or new,
 * starts with none set - no cap, and the default time limit. The limits
 * runs had before were constants in the code, never stored, so there is
 * nothing to carry over. Adding a nullable column without a default
 * rewrites no row.
 *
 * Written as npm run generate-postgres-migration writes a nullable integer
 * column, and numbered in the range this change was given
 * (18090802xxxxx), after main's newest.
 */
export class AddProjectAiRunLimits1809080210000 implements MigrationInterface {
  public name: string = "AddProjectAiRunLimits1809080210000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "Project" ADD "aiRunMaxModelCalls" integer`,
    );
    await queryRunner.query(
      `ALTER TABLE "Project" ADD "aiRunMaxToolCalls" integer`,
    );
    await queryRunner.query(
      `ALTER TABLE "Project" ADD "aiRunMaxTokens" integer`,
    );
    await queryRunner.query(
      `ALTER TABLE "Project" ADD "aiRunTimeLimitInMinutes" integer`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "Project" DROP COLUMN "aiRunTimeLimitInMinutes"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Project" DROP COLUMN "aiRunMaxTokens"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Project" DROP COLUMN "aiRunMaxToolCalls"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Project" DROP COLUMN "aiRunMaxModelCalls"`,
    );
  }
}
