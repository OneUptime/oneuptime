import { MigrationInterface, QueryRunner } from "typeorm";

export class MigrationName1723828588502 implements MigrationInterface {
  public name = "MigrationName1723828588502";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "StatusPage" ADD "overallUptimePercentPrecision" character varying DEFAULT '99.99% (Two Decimal)'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "StatusPage" DROP COLUMN "overallUptimePercentPrecision"`,
    );
  }
}
