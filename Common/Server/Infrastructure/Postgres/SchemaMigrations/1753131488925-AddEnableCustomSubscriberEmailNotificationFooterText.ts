import { MigrationInterface, QueryRunner } from "typeorm";

export class AddEnableCustomSubscriberEmailNotificationFooterText1753131488925
  implements MigrationInterface
{
  public name =
    "AddEnableCustomSubscriberEmailNotificationFooterText1753131488925";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "StatusPage" ADD "enableCustomSubscriberEmailNotificationFooterText" boolean NOT NULL DEFAULT false`,
    );

    // Data migration: Set existing status pages to have enableCustomSubscriberEmailNotificationFooterText = true
    // This ensures backward compatibility for existing status pages that already have custom footer text
    await queryRunner.query(
      `UPDATE "StatusPage" SET "enableCustomSubscriberEmailNotificationFooterText" = true WHERE "subscriberEmailNotificationFooterText" IS NOT NULL AND "subscriberEmailNotificationFooterText" != ''`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "StatusPage" DROP COLUMN "enableCustomSubscriberEmailNotificationFooterText"`,
    );
  }
}
