import { MigrationInterface, QueryRunner } from "typeorm";

export class MigrationName1753343522987 implements MigrationInterface {
  public name = "MigrationName1753343522987";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "UserPush" ALTER COLUMN "deviceToken" TYPE text`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "UserPush" ALTER COLUMN "deviceToken" TYPE character varying(500)`,
    );
  }
}
