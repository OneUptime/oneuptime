import { MigrationInterface, QueryRunner } from "typeorm";

export class AddEnterpriseLicenseNotificationColumns1784218257664
  implements MigrationInterface
{
  public name: string = "AddEnterpriseLicenseNotificationColumns1784218257664";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" ADD "enterpriseLicenseNotificationEmail" character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" ADD "enterpriseLicenseExpiryReminderDays" integer`,
    );
    await queryRunner.query(
      `ALTER TABLE "EnterpriseLicenseInstance" ADD "masterAdminEmails" jsonb`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "EnterpriseLicenseInstance" DROP COLUMN "masterAdminEmails"`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" DROP COLUMN "enterpriseLicenseExpiryReminderDays"`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" DROP COLUMN "enterpriseLicenseNotificationEmail"`,
    );
  }
}
