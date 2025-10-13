import { MigrationInterface, QueryRunner } from "typeorm";

export class MigrationName1760357680881 implements MigrationInterface {
  public name = "MigrationName1760357680881";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" ADD "metaWhatsAppWebhookVerifyToken" character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" ADD CONSTRAINT "UQ_afe98d53b718f485d3d64b383b8" UNIQUE ("metaWhatsAppWebhookVerifyToken")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" DROP CONSTRAINT "UQ_afe98d53b718f485d3d64b383b8"`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" DROP COLUMN "metaWhatsAppWebhookVerifyToken"`,
    );
  }
}
