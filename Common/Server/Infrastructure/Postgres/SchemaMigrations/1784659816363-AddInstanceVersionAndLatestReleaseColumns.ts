import { MigrationInterface, QueryRunner } from "typeorm";

export class AddInstanceVersionAndLatestReleaseColumns1784659816363
  implements MigrationInterface
{
  public name: string =
    "AddInstanceVersionAndLatestReleaseColumns1784659816363";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "EnterpriseLicenseInstance" ADD "oneuptimeVersion" character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" ADD "latestReleaseVersion" character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" ADD "latestReleasePublishedAt" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" ADD "latestReleaseCheckedAt" TIMESTAMP WITH TIME ZONE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" DROP COLUMN "latestReleaseCheckedAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" DROP COLUMN "latestReleasePublishedAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" DROP COLUMN "latestReleaseVersion"`,
    );
    await queryRunner.query(
      `ALTER TABLE "EnterpriseLicenseInstance" DROP COLUMN "oneuptimeVersion"`,
    );
  }
}
