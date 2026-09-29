import { MigrationInterface, QueryRunner } from "typeorm";

export class AddCacheTokenColumnsToLlmLog1783695782697
  implements MigrationInterface
{
  public name = "AddCacheTokenColumnsToLlmLog1783695782697";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "LlmLog" ADD "cachedInputTokens" integer NOT NULL DEFAULT '0'`,
    );
    await queryRunner.query(
      `ALTER TABLE "LlmLog" ADD "cacheCreationTokens" integer NOT NULL DEFAULT '0'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "LlmLog" DROP COLUMN "cacheCreationTokens"`,
    );
    await queryRunner.query(
      `ALTER TABLE "LlmLog" DROP COLUMN "cachedInputTokens"`,
    );
  }
}
