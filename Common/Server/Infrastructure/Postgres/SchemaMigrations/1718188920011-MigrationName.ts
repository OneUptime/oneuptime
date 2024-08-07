import { MigrationInterface, QueryRunner } from "typeorm";

export class MigrationName1718188920011 implements MigrationInterface {
  public name = "MigrationName1718188920011";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "CodeRepository" ADD "mainBranchName" character varying(100) NOT NULL DEFAULT 'master'`,
    );
    await queryRunner.query(
      `ALTER TABLE "CodeRepository" ADD "repositoryHostedAt" character varying(100) NOT NULL DEFAULT 'GitHub'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "CodeRepository" DROP COLUMN "repositoryHostedAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CodeRepository" DROP COLUMN "mainBranchName"`,
    );
  }
}
