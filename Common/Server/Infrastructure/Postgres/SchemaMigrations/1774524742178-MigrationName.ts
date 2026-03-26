import { MigrationInterface, QueryRunner } from "typeorm";

export class MigrationName1774524742178 implements MigrationInterface {
  public name = "MigrationName1774524742178";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "StatusPage" ADD "showUptimeHistoryInDays" integer NOT NULL DEFAULT 90`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "StatusPage" DROP COLUMN "showUptimeHistoryInDays"`,
    );
  }
}
