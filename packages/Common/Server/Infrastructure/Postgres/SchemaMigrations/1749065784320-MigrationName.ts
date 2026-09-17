import { MigrationInterface, QueryRunner } from "typeorm";

export class MigrationName1749065784320 implements MigrationInterface {
  public name = "MigrationName1749065784320";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "StatusPage" ADD "enableSlackSubscribers" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageSubscriber" ADD "slackIncomingWebhookUrl" character varying`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "StatusPageSubscriber" DROP COLUMN "slackIncomingWebhookUrl"`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPage" DROP COLUMN "enableSlackSubscribers"`,
    );
  }
}
