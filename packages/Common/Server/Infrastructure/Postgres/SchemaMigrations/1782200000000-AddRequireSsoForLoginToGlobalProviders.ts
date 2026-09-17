import { MigrationInterface, QueryRunner } from "typeorm";

export class AddRequireSsoForLoginToGlobalProviders1782200000000
  implements MigrationInterface
{
  public name = "AddRequireSsoForLoginToGlobalProviders1782200000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "GlobalSSO" ADD "requireSsoForLogin" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalOIDC" ADD "requireSsoForLogin" boolean NOT NULL DEFAULT false`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "GlobalOIDC" DROP COLUMN "requireSsoForLogin"`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalSSO" DROP COLUMN "requireSsoForLogin"`,
    );
  }
}
