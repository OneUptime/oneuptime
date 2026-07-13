import { MigrationInterface, QueryRunner } from "typeorm";

export class AddAdditionalParamsToLlmProvider1783650000000
  implements MigrationInterface
{
  public name = "AddAdditionalParamsToLlmProvider1783650000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "LlmProvider" ADD COLUMN IF NOT EXISTS "additionalParams" jsonb`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "LlmProvider" DROP COLUMN IF EXISTS "additionalParams"`,
    );
  }
}
