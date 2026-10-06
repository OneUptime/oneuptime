import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration, then renumbered after
 * the last registered migration.
 *
 * When each of a project's own daily AI limits (Project Settings → AI
 * Features → More settings) last stopped OneUptime AI: the first time on
 * the latest UTC day it did. The conditional UPDATE that writes one, once a
 * day, decides that the project's owners are emailed
 * (ProjectAiDailyLimitOwnerNotice), and the investigation catch-up reads
 * them to find the projects whose skipped incidents and alerts may be
 * waiting for the reset (InvestigationLimitCatchUp).
 *
 * Nullable with no default, so this only adds the columns: every project
 * starts as "never reached", and nothing changes for anyone until a limit
 * it set stops AI.
 */
export class AddProjectAiDailyLimitReachedAt1799000000000
  implements MigrationInterface
{
  public name: string = "AddProjectAiDailyLimitReachedAt1799000000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "Project" ADD "aiDailyTokenLimitReachedAt" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "Project" ADD "aiDailySpendLimitReachedAt" TIMESTAMP WITH TIME ZONE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "Project" DROP COLUMN "aiDailySpendLimitReachedAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Project" DROP COLUMN "aiDailyTokenLimitReachedAt"`,
    );
  }
}
