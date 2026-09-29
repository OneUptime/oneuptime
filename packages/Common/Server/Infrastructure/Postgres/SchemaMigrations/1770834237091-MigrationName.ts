import { MigrationInterface, QueryRunner } from "typeorm";

export class MigrationName1770834237091 implements MigrationInterface {
  public name = "MigrationName1770834237091";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" ADD "disableUserProjectCreation" boolean DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" ADD CONSTRAINT "UQ_disableUserProjectCreation" UNIQUE ("disableUserProjectCreation")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" DROP CONSTRAINT "UQ_disableUserProjectCreation"`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" DROP COLUMN "disableUserProjectCreation"`,
    );
  }
}
