import { MigrationInterface, QueryRunner } from "typeorm";

export class MigrationName1723825511054 implements MigrationInterface {
  public name = "MigrationName1723825511054";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "StatusPage" ADD "showOverallUptimePercentOnStatusPage" boolean NOT NULL DEFAULT false`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "StatusPage" DROP COLUMN "showOverallUptimePercentOnStatusPage"`,
    );
  }
}
