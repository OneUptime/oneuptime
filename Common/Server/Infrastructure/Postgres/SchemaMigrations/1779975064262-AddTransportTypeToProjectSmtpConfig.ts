import { MigrationInterface, QueryRunner } from "typeorm";

export class AddTransportTypeToProjectSmtpConfig1779975064262
  implements MigrationInterface
{
  public name: string = "AddTransportTypeToProjectSmtpConfig1779975064262";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "ProjectSMTPConfig" ADD "transportType" character varying(100) NOT NULL DEFAULT 'SMTP'`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProjectSMTPConfig" ALTER COLUMN "hostname" DROP NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProjectSMTPConfig" ALTER COLUMN "port" DROP NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProjectSMTPConfig" ALTER COLUMN "secure" DROP NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "ProjectSMTPConfig" ALTER COLUMN "secure" SET NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProjectSMTPConfig" ALTER COLUMN "port" SET NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProjectSMTPConfig" ALTER COLUMN "hostname" SET NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProjectSMTPConfig" DROP COLUMN "transportType"`,
    );
  }
}
