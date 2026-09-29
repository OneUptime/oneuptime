import { MigrationInterface, QueryRunner } from "typeorm";

export class AddAiDailyAutonomousTokenLimitToProject1783702431535
  implements MigrationInterface
{
  public name = "AddAiDailyAutonomousTokenLimitToProject1783702431535";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "Project" ADD "aiDailyAutonomousTokenLimit" integer`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "Project" DROP COLUMN "aiDailyAutonomousTokenLimit"`,
    );
  }
}
