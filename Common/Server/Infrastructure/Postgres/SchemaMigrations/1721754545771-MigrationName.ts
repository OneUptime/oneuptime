import { MigrationInterface, QueryRunner } from "typeorm";

export class MigrationName1721754545771 implements MigrationInterface {
  public name = "MigrationName1721754545771";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "StatusPage" ADD "isReportEnabled" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPage" ADD "reportStartDateTime" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPage" ADD "reportRecurringInterval" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPage" ADD "sendNextReportBy" TIMESTAMP WITH TIME ZONE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "StatusPage" DROP COLUMN "sendNextReportBy"`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPage" DROP COLUMN "reportRecurringInterval"`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPage" DROP COLUMN "reportStartDateTime"`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPage" DROP COLUMN "isReportEnabled"`,
    );
  }
}
