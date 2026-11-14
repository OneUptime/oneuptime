import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration, then renumbered after
 * the last registered migration and rewritten to ALTER the columns' types in
 * place.
 *
 * The server's credentials in GlobalConfig are now stored encrypted, as its
 * newer provider keys already were (#7739): the SMTP password and OAuth
 * client secret, the Twilio auth token, the call and SMS gateway's signing
 * secret, the Meta WhatsApp and Telegram tokens and secrets, the SendGrid
 * API key and the Enterprise license key and token.
 *
 *   - A ciphertext is longer than the value it holds, so each column that
 *     was a varchar becomes text, as the newer ones are. The generator
 *     emitted a DROP COLUMN + ADD COLUMN for each, which would throw the
 *     stored value away before the EncryptGlobalConfigCredentials data
 *     migration can encrypt it; an ALTER COLUMN TYPE keeps it (and from a
 *     varchar to text rewrites no row).
 *   - Their unique constraints go: each write stores a different
 *     ciphertext, so a unique constraint on one compares nothing.
 *
 * The end state is the one the generator wanted, so the schema-drift check
 * sees nothing to generate. down() puts back the types and constraints as
 * they were, which holds only values that fit them, as before this ran.
 */
export class GlobalConfigCredentialsEncryptedColumns1809126000000
  implements MigrationInterface
{
  public name: string = "GlobalConfigCredentialsEncryptedColumns1809126000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" DROP CONSTRAINT "UQ_26512a721317adaa03d37eb00d4"`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" ALTER COLUMN "smtpPassword" TYPE text`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" DROP CONSTRAINT "UQ_bc4b634ed3ed8854b06872115a0"`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" ALTER COLUMN "twilioAuthToken" TYPE text`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" ALTER COLUMN "callAndSmsGatewaySecret" TYPE text`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" DROP CONSTRAINT "UQ_83bd5d0c54a21bfe12316fa6520"`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" DROP CONSTRAINT "UQ_d4669bf754f937bae16c4a1837c"`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" DROP CONSTRAINT "UQ_afe98d53b718f485d3d64b383b8"`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" ALTER COLUMN "metaWhatsAppWebhookVerifyToken" TYPE text`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" DROP CONSTRAINT "UQ_31520e25e0cb9d1e8c8efb66a59"`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" DROP CONSTRAINT "UQ_cab6bddc355be1d75097f372eff"`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" ALTER COLUMN "telegramWebhookSecretToken" TYPE text`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" DROP CONSTRAINT "UQ_1489dd2e4879912dd7caa0dee5c"`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" ALTER COLUMN "sendgridApiKey" TYPE text`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" DROP CONSTRAINT "UQ_89f80e8a18c3372ee150a3812c1"`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" ALTER COLUMN "enterpriseLicenseKey" TYPE text`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" DROP CONSTRAINT "UQ_b0b9322c111c0cc629fedbb4eb3"`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" ADD CONSTRAINT "UQ_b0b9322c111c0cc629fedbb4eb3" UNIQUE ("enterpriseLicenseToken")`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" ALTER COLUMN "enterpriseLicenseKey" TYPE character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" ADD CONSTRAINT "UQ_89f80e8a18c3372ee150a3812c1" UNIQUE ("enterpriseLicenseKey")`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" ALTER COLUMN "sendgridApiKey" TYPE character varying`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" ADD CONSTRAINT "UQ_1489dd2e4879912dd7caa0dee5c" UNIQUE ("sendgridApiKey")`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" ALTER COLUMN "telegramWebhookSecretToken" TYPE character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" ADD CONSTRAINT "UQ_cab6bddc355be1d75097f372eff" UNIQUE ("telegramWebhookSecretToken")`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" ADD CONSTRAINT "UQ_31520e25e0cb9d1e8c8efb66a59" UNIQUE ("telegramBotToken")`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" ALTER COLUMN "metaWhatsAppWebhookVerifyToken" TYPE character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" ADD CONSTRAINT "UQ_afe98d53b718f485d3d64b383b8" UNIQUE ("metaWhatsAppWebhookVerifyToken")`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" ADD CONSTRAINT "UQ_d4669bf754f937bae16c4a1837c" UNIQUE ("metaWhatsAppAppSecret")`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" ADD CONSTRAINT "UQ_83bd5d0c54a21bfe12316fa6520" UNIQUE ("metaWhatsAppAccessToken")`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" ALTER COLUMN "callAndSmsGatewaySecret" TYPE character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" ALTER COLUMN "twilioAuthToken" TYPE character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" ADD CONSTRAINT "UQ_bc4b634ed3ed8854b06872115a0" UNIQUE ("twilioAuthToken")`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" ALTER COLUMN "smtpPassword" TYPE character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" ADD CONSTRAINT "UQ_26512a721317adaa03d37eb00d4" UNIQUE ("smtpPassword")`,
    );
  }
}
