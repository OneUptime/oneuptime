import { MigrationInterface, QueryRunner } from "typeorm";

export class MigrationName1778521361934 implements MigrationInterface {
  public name = "MigrationName1778521361934";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "StatusPage" ADD "enableWebhookSubscribers" boolean NOT NULL DEFAULT false`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "StatusPage" DROP COLUMN "enableWebhookSubscribers"`,
    );
  }
}
