import { MigrationInterface, QueryRunner } from "typeorm";

export class MigrationName1787156982416 implements MigrationInterface {
  public name = "MigrationName1787156982416";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "UserPush" ADD "isCriticalAlertEnabled" boolean NOT NULL DEFAULT false`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "UserPush" DROP COLUMN "isCriticalAlertEnabled"`,
    );
  }
}
