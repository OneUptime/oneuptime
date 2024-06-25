import { MigrationInterface, QueryRunner } from "typeorm";

export class MigrationName1719348009053 implements MigrationInterface {
  public name = "MigrationName1719348009053";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "Project" ADD "letCustomerSupportAccessProject" boolean DEFAULT false`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "Project" DROP COLUMN "letCustomerSupportAccessProject"`,
    );
  }
}
