import { MigrationInterface, QueryRunner } from "typeorm";

export class IncreaseSmtpUsernameLength1779125489830
  implements MigrationInterface
{
  public name = "IncreaseSmtpUsernameLength1779125489830";

  public async up(queryRunner: QueryRunner): Promise<void> {
    /*
     * Widen SMTP username columns from varchar(100) to varchar(500) to support
     * longer usernames. Providers such as Oracle Cloud Infrastructure (OCI)
     * issue SMTP usernames that follow RFC 6409 and RFC 4616, which allow up
     * to 255 bytes and can exceed the previous 100 character ceiling.
     */
    await queryRunner.query(
      `ALTER TABLE "ProjectSMTPConfig" ALTER COLUMN "username" TYPE character varying(500)`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" ALTER COLUMN "smtpUsername" TYPE character varying(500)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" ALTER COLUMN "smtpUsername" TYPE character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProjectSMTPConfig" ALTER COLUMN "username" TYPE character varying(100)`,
    );
  }
}
