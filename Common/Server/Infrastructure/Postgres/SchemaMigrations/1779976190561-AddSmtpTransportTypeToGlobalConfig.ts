import { MigrationInterface, QueryRunner } from "typeorm";

export class AddSmtpTransportTypeToGlobalConfig1779976190561
  implements MigrationInterface
{
  public name: string = "AddSmtpTransportTypeToGlobalConfig1779976190561";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" ADD "smtpTransportType" character varying(100) DEFAULT 'SMTP'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" DROP COLUMN "smtpTransportType"`,
    );
  }
}
