import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration, then renumbered after
 * the last registered migration.
 *
 * "Poll Telegram for Messages" (GlobalConfig.telegramPollForUpdates): a
 * server Telegram cannot reach fetches the bot's messages from Telegram
 * itself (TelegramUpdatePolling), instead of waiting for Telegram to call its
 * webhook.
 *
 * Nothing to backfill: the column is off by default, so a server that has a
 * webhook keeps it.
 */
export class AddTelegramPollForUpdates1805750000000
  implements MigrationInterface
{
  public name: string = "AddTelegramPollForUpdates1805750000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" ADD "telegramPollForUpdates" boolean DEFAULT false`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" DROP COLUMN "telegramPollForUpdates"`,
    );
  }
}
