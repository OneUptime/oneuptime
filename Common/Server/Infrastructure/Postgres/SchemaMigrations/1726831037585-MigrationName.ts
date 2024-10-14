import { MigrationInterface, QueryRunner } from "typeorm";

export class MigrationName1726831037585 implements MigrationInterface {
  public name = "MigrationName1726831037585";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "StatusPageGroup" ADD "showCurrentStatus" boolean NOT NULL DEFAULT true`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageGroup" ADD "showUptimePercent" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageGroup" ADD "uptimePercentPrecision" character varying`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "StatusPageGroup" DROP COLUMN "uptimePercentPrecision"`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageGroup" DROP COLUMN "showUptimePercent"`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageGroup" DROP COLUMN "showCurrentStatus"`,
    );
  }
}
