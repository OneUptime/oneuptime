import { MigrationInterface, QueryRunner } from "typeorm";

export class MigrationName1718618155447 implements MigrationInterface {
  public name = "MigrationName1718618155447";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "StatusPage" ADD "subscriberTimezones" jsonb`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "StatusPage" DROP COLUMN "subscriberTimezones"`,
    );
  }
}
