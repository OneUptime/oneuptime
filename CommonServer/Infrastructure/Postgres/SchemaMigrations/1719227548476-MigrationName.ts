import { MigrationInterface, QueryRunner } from "typeorm";

export class MigrationName1719227548476 implements MigrationInterface {
  public name = "MigrationName1719227548476";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "Project" ADD "enterpriseAnnualContractValue" character varying(100)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "Project" DROP COLUMN "enterpriseAnnualContractValue"`,
    );
  }
}
