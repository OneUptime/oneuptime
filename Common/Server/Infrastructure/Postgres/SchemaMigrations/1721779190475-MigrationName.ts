import { MigrationInterface, QueryRunner } from "typeorm";

export class MigrationName1721779190475 implements MigrationInterface {
  public name = "MigrationName1721779190475";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "StatusPage" ADD "reportDataInDays" integer DEFAULT '30'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "StatusPage" DROP COLUMN "reportDataInDays"`,
    );
  }
}
