import { MigrationInterface, QueryRunner } from "typeorm";

export class AddUserDiscordUniqueMethod1795300000001
  implements MigrationInterface
{
  public name: string = "AddUserDiscordUniqueMethod1795300000001";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_USER_DISCORD_PROJECT_USER_UNIQUE" ON "UserDiscord" ("projectId", "userId") WHERE "deletedAt" IS NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."IDX_USER_DISCORD_PROJECT_USER_UNIQUE"`,
    );
  }
}
