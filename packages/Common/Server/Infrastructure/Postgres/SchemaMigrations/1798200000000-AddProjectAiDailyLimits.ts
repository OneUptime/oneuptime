import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration, then renumbered after
 * the last registered migration.
 *
 * A project's own daily limits on OneUptime AI (Project Settings → AI
 * Features → More settings): the most tokens its AI may use each UTC day,
 * and - where AI is billed - the most AI credits, in whole US dollars, it
 * may spend. Both are nullable with no default: every project, existing or
 * new, starts with no limit, so nothing changes for anyone until a project
 * sets one.
 */
export class AddProjectAiDailyLimits1798200000000
  implements MigrationInterface
{
  public name: string = "AddProjectAiDailyLimits1798200000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "Project" ADD "aiDailyTokenLimit" integer`,
    );
    await queryRunner.query(
      `ALTER TABLE "Project" ADD "aiDailySpendLimitInUSD" integer`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "Project" DROP COLUMN "aiDailySpendLimitInUSD"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Project" DROP COLUMN "aiDailyTokenLimit"`,
    );
  }
}
