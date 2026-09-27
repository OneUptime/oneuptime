import { MigrationInterface, QueryRunner } from "typeorm";

export class AddDiscordResourceThreadRetiredThreadIds1795400000001
  implements MigrationInterface
{
  public name: string = "AddDiscordResourceThreadRetiredThreadIds1795400000001";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "DiscordResourceThread" ADD "retiredThreadIds" jsonb`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "DiscordResourceThread" DROP COLUMN "retiredThreadIds"`,
    );
  }
}
