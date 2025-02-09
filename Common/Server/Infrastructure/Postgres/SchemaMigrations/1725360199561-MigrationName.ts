import { MigrationInterface, QueryRunner } from "typeorm";

export class MigrationName1725360199561 implements MigrationInterface {
  public name = "MigrationName1725360199561";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "CopilotAction" ADD "logs" text`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "CopilotAction" DROP COLUMN "logs"`);
  }
}
