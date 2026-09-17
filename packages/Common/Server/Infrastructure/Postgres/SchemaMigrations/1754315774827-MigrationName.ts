import { MigrationInterface, QueryRunner } from "typeorm";

export class MigrationName1754315774827 implements MigrationInterface {
  public name = "MigrationName1754315774827";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "ProjectSCIM" DROP COLUMN "isEnabled"`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "ProjectSCIM" ADD "isEnabled" boolean NOT NULL DEFAULT false`,
    );
  }
}
