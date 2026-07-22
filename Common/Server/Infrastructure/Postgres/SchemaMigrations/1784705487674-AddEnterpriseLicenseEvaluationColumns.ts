import { MigrationInterface, QueryRunner } from "typeorm";

export class AddEnterpriseLicenseEvaluationColumns1784705487674
  implements MigrationInterface
{
  public name: string = "AddEnterpriseLicenseEvaluationColumns1784705487674";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "EnterpriseLicense" ADD "isEvaluationLicense" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" ADD "enterpriseLicenseIsEvaluation" boolean DEFAULT false`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" DROP COLUMN "enterpriseLicenseIsEvaluation"`,
    );
    await queryRunner.query(
      `ALTER TABLE "EnterpriseLicense" DROP COLUMN "isEvaluationLicense"`,
    );
  }
}
