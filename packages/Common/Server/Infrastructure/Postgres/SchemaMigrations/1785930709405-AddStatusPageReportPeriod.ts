import { MigrationInterface, QueryRunner } from "typeorm";

export class AddStatusPageReportPeriod1785930709405
  implements MigrationInterface
{
  public name = "AddStatusPageReportPeriod1785930709405";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "StatusPage" ADD "reportPeriodType" character varying DEFAULT 'Rolling'`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPage" ADD "reportTimezone" character varying DEFAULT 'UTC'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "StatusPage" DROP COLUMN "reportTimezone"`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPage" DROP COLUMN "reportPeriodType"`,
    );
  }
}
