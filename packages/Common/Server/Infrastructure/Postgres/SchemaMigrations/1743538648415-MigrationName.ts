import { MigrationInterface, QueryRunner } from "typeorm";

export class MigrationName1743538648415 implements MigrationInterface {
  public name = "MigrationName1743538648415";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "MetricType" ADD "description" text`);
    await queryRunner.query(
      `ALTER TABLE "MetricType" ADD "unit" character varying(100)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "MetricType" DROP COLUMN "unit"`);
    await queryRunner.query(
      `ALTER TABLE "MetricType" DROP COLUMN "description"`,
    );
  }
}
