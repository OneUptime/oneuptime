import { MigrationInterface, QueryRunner } from "typeorm";

export class MigrationName1725811636668 implements MigrationInterface {
  public name = "MigrationName1725811636668";
  public async down(queryRunner: QueryRunner): Promise<any> {
    await queryRunner.query(
      `ALTER TABLE "Workflow" DROP COLUMN "interactiveData"`,
    );
  }

  public async up(queryRunner: QueryRunner): Promise<any> {
    await queryRunner.query(
      `ALTER TABLE "Workflow" ADD "interactiveData" jsonb`,
    );
  }
}
