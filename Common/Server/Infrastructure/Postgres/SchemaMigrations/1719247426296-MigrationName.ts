import { MigrationInterface, QueryRunner } from "typeorm";

export class MigrationName1719247426296 implements MigrationInterface {
  public name = "MigrationName1719247426296";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "Project" DROP COLUMN "enterpriseAnnualContractValue"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Project" ADD "enterpriseAnnualContractValue" integer`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "Project" DROP COLUMN "enterpriseAnnualContractValue"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Project" ADD "enterpriseAnnualContractValue" character varying(100)`,
    );
  }
}
