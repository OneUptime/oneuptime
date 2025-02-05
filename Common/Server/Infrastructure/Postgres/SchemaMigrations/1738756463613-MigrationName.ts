import { MigrationInterface, QueryRunner } from "typeorm";

export class MigrationName1738756463613 implements MigrationInterface {
  public name = "MigrationName1738756463613";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "UserAuthToken" DROP COLUMN "serviceType"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProjectAuthToken" DROP COLUMN "serviceType"`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserAuthToken" ADD "serviceProviderUserId" character varying(500) NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserAuthToken" ADD "serviceProviderType" character varying(500) NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProjectAuthToken" ADD "serviceProviderType" character varying(500) NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProjectAuthToken" ADD "serviceProviderProjectId" character varying(500) NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "ProjectAuthToken" DROP COLUMN "serviceProviderProjectId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProjectAuthToken" DROP COLUMN "serviceProviderType"`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserAuthToken" DROP COLUMN "serviceProviderType"`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserAuthToken" DROP COLUMN "serviceProviderUserId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProjectAuthToken" ADD "serviceType" character varying(500) NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserAuthToken" ADD "serviceType" character varying(500) NOT NULL`,
    );
  }
}
