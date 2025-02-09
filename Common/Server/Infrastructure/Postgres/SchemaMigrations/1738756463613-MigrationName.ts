import { MigrationInterface, QueryRunner } from "typeorm";

export class MigrationName1738756463613 implements MigrationInterface {
  public name = "MigrationName1738756463613";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "ServiceProviderUserAuthToken" DROP COLUMN "serviceType"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceProviderProjectAuthToken" DROP COLUMN "serviceType"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceProviderUserAuthToken" ADD "serviceProviderUserId" character varying(500) NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceProviderUserAuthToken" ADD "serviceProviderType" character varying(500) NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceProviderProjectAuthToken" ADD "serviceProviderType" character varying(500) NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceProviderProjectAuthToken" ADD "serviceProviderProjectId" character varying(500) NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "ServiceProviderProjectAuthToken" DROP COLUMN "serviceProviderProjectId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceProviderProjectAuthToken" DROP COLUMN "serviceProviderType"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceProviderUserAuthToken" DROP COLUMN "serviceProviderType"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceProviderUserAuthToken" DROP COLUMN "serviceProviderUserId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceProviderProjectAuthToken" ADD "serviceType" character varying(500) NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceProviderUserAuthToken" ADD "serviceType" character varying(500) NOT NULL`,
    );
  }
}
