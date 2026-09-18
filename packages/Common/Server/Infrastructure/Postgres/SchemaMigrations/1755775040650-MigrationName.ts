import { MigrationInterface, QueryRunner } from "typeorm";

export class MigrationName1755775040650 implements MigrationInterface {
  public name = "MigrationName1755775040650";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "StatusPage" ADD "enableMicrosoftTeamsSubscribers" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageSubscriber" ADD "microsoftTeamsIncomingWebhookUrl" character varying`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageSubscriber" ADD "microsoftTeamsWorkspaceName" character varying(100)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "StatusPageSubscriber" DROP COLUMN "microsoftTeamsWorkspaceName"`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageSubscriber" DROP COLUMN "microsoftTeamsIncomingWebhookUrl"`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPage" DROP COLUMN "enableMicrosoftTeamsSubscribers"`,
    );
  }
}
