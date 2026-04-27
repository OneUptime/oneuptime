import { MigrationInterface, QueryRunner } from "typeorm";

export class MigrationName1776886248361 implements MigrationInterface {
  public name = "MigrationName1776886248361";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "Project" ALTER COLUMN "financeAccountingEmail" TYPE character varying(500)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "Project" ALTER COLUMN "financeAccountingEmail" TYPE character varying(100)`,
    );
  }
}
