import { MigrationInterface, QueryRunner } from "typeorm";

export class MigrationName1767896933148 implements MigrationInterface {
  public name = "MigrationName1767896933148";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "ProjectSMTPConfig" ADD "authType" character varying(100) NOT NULL DEFAULT 'Username and Password'`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProjectSMTPConfig" ADD "clientId" character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProjectSMTPConfig" ADD "clientSecret" character varying(500)`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProjectSMTPConfig" ADD "tokenUrl" text`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProjectSMTPConfig" ADD "scope" character varying(500)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "ProjectSMTPConfig" DROP COLUMN "scope"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProjectSMTPConfig" DROP COLUMN "tokenUrl"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProjectSMTPConfig" DROP COLUMN "clientSecret"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProjectSMTPConfig" DROP COLUMN "clientId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProjectSMTPConfig" DROP COLUMN "authType"`,
    );
  }
}
