import { MigrationInterface, QueryRunner } from "typeorm";

export class AddDiscordStatusPageSubscribers1795500000000
  implements MigrationInterface
{
  public name = "AddDiscordStatusPageSubscribers1795500000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "StatusPage" ADD "enableDiscordSubscribers" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageSubscriber" ADD "discordIncomingWebhookUrl" character varying`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageSubscriber" ADD "discordChannelName" character varying(100)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "StatusPageSubscriber" DROP COLUMN "discordChannelName"`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageSubscriber" DROP COLUMN "discordIncomingWebhookUrl"`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPage" DROP COLUMN "enableDiscordSubscribers"`,
    );
  }
}
