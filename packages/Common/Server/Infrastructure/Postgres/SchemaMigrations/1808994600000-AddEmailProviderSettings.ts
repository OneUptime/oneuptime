import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration, then renumbered after
 * the last registered migration.
 *
 * Email through a provider's HTTPS API: a project's SMTP config
 * ("ProjectSMTPConfig") can send through Amazon SES, SendGrid, Mailgun,
 * Postmark or Resend, picked as its transportType, and keeps that
 * provider's key - an IAM access key and its Region, an API key, Mailgun's
 * sending domain and region, Postmark's server API token. The instance
 * ("GlobalConfig") can send all of its own email through Amazon SES,
 * Mailgun, Postmark or Resend (its emailServerType), each with its key and
 * its own sender, as it already did with SendGrid. Secrets are text: they
 * are stored encrypted.
 *
 * Every column is nullable with no default, so each is added without
 * rewriting either table, and no index or foreign key is added: nothing
 * scans or locks them.
 */
export class AddEmailProviderSettings1808994600000
  implements MigrationInterface
{
  public name: string = "AddEmailProviderSettings1808994600000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "ProjectSMTPConfig" ADD "amazonSesAccessKeyId" character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProjectSMTPConfig" ADD "amazonSesSecretAccessKey" text`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProjectSMTPConfig" ADD "amazonSesRegion" character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProjectSMTPConfig" ADD "sendgridApiKey" text`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProjectSMTPConfig" ADD "mailgunApiKey" text`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProjectSMTPConfig" ADD "mailgunDomain" character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProjectSMTPConfig" ADD "mailgunRegion" character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProjectSMTPConfig" ADD "postmarkServerToken" text`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProjectSMTPConfig" ADD "resendApiKey" text`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" ADD "amazonSesAccessKeyId" character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" ADD "amazonSesSecretAccessKey" text`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" ADD "amazonSesRegion" character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" ADD "amazonSesFromEmail" character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" ADD "amazonSesFromName" character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" ADD "mailgunApiKey" text`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" ADD "mailgunDomain" character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" ADD "mailgunRegion" character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" ADD "mailgunFromEmail" character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" ADD "mailgunFromName" character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" ADD "postmarkServerToken" text`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" ADD "postmarkFromEmail" character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" ADD "postmarkFromName" character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" ADD "resendApiKey" text`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" ADD "resendFromEmail" character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" ADD "resendFromName" character varying(100)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" DROP COLUMN "resendFromName"`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" DROP COLUMN "resendFromEmail"`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" DROP COLUMN "resendApiKey"`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" DROP COLUMN "postmarkFromName"`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" DROP COLUMN "postmarkFromEmail"`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" DROP COLUMN "postmarkServerToken"`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" DROP COLUMN "mailgunFromName"`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" DROP COLUMN "mailgunFromEmail"`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" DROP COLUMN "mailgunRegion"`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" DROP COLUMN "mailgunDomain"`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" DROP COLUMN "mailgunApiKey"`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" DROP COLUMN "amazonSesFromName"`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" DROP COLUMN "amazonSesFromEmail"`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" DROP COLUMN "amazonSesRegion"`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" DROP COLUMN "amazonSesSecretAccessKey"`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" DROP COLUMN "amazonSesAccessKeyId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProjectSMTPConfig" DROP COLUMN "resendApiKey"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProjectSMTPConfig" DROP COLUMN "postmarkServerToken"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProjectSMTPConfig" DROP COLUMN "mailgunRegion"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProjectSMTPConfig" DROP COLUMN "mailgunDomain"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProjectSMTPConfig" DROP COLUMN "mailgunApiKey"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProjectSMTPConfig" DROP COLUMN "sendgridApiKey"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProjectSMTPConfig" DROP COLUMN "amazonSesRegion"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProjectSMTPConfig" DROP COLUMN "amazonSesSecretAccessKey"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProjectSMTPConfig" DROP COLUMN "amazonSesAccessKeyId"`,
    );
  }
}
