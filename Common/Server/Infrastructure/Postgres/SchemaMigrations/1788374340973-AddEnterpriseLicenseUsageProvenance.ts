import { MigrationInterface, QueryRunner } from "typeorm";

export class AddEnterpriseLicenseUsageProvenance1788374340973
  implements MigrationInterface
{
  public name: string = "AddEnterpriseLicenseUsageProvenance1788374340973";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "EnterpriseLicense" ADD "userCountSource" character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "EnterpriseLicense" ADD "legacyUserCount" integer`,
    );
    await queryRunner.query(
      `ALTER TABLE "EnterpriseLicense" ADD "legacyUserCountUpdatedAt" TIMESTAMP WITH TIME ZONE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "EnterpriseLicense" DROP COLUMN "legacyUserCountUpdatedAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "EnterpriseLicense" DROP COLUMN "legacyUserCount"`,
    );
    await queryRunner.query(
      `ALTER TABLE "EnterpriseLicense" DROP COLUMN "userCountSource"`,
    );
  }
}
