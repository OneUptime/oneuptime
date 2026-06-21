import { MigrationInterface, QueryRunner } from "typeorm";

export class RemoveIsTestedFromGlobalSsoAndOidc1782400000000
  implements MigrationInterface
{
  public name = "RemoveIsTestedFromGlobalSsoAndOidc1782400000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "GlobalSSO" DROP COLUMN "isTested"`);
    await queryRunner.query(`ALTER TABLE "GlobalOIDC" DROP COLUMN "isTested"`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "GlobalOIDC" ADD "isTested" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalSSO" ADD "isTested" boolean NOT NULL DEFAULT false`,
    );
  }
}
