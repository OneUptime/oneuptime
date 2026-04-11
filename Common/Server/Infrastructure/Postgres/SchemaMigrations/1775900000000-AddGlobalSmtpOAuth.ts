import { MigrationInterface, QueryRunner } from "typeorm";

export class AddGlobalSmtpOAuth1775900000000 implements MigrationInterface {
  public name = "AddGlobalSmtpOAuth1775900000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    /*
     * Add OAuth 2.0 columns to GlobalConfig table so global SMTP can be
     * authenticated with providers like Microsoft 365 or Google Workspace.
     */
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" ADD "smtpAuthType" character varying(100) DEFAULT 'Username and Password'`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" ADD "smtpClientId" character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" ADD "smtpClientSecret" text`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" ADD "smtpTokenUrl" text`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" ADD "smtpScope" character varying(500)`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" ADD "smtpOAuthProviderType" character varying(100)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" DROP COLUMN "smtpOAuthProviderType"`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" DROP COLUMN "smtpScope"`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" DROP COLUMN "smtpTokenUrl"`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" DROP COLUMN "smtpClientSecret"`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" DROP COLUMN "smtpClientId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" DROP COLUMN "smtpAuthType"`,
    );
  }
}
