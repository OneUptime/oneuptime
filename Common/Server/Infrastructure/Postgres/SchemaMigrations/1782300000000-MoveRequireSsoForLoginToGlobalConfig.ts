import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * "Force SSO for Login" moved from a per-provider flag on GlobalSSO/GlobalOIDC
 * to a single instance-wide flag on GlobalConfig. This adds the GlobalConfig
 * column and drops the now-unused per-provider columns added by
 * 1782200000000 (DROP ... IF EXISTS so it is safe whether or not that
 * migration was applied).
 */
export class MoveRequireSsoForLoginToGlobalConfig1782300000000
  implements MigrationInterface
{
  public name = "MoveRequireSsoForLoginToGlobalConfig1782300000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" ADD "requireSsoForLogin" boolean DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalSSO" DROP COLUMN IF EXISTS "requireSsoForLogin"`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalOIDC" DROP COLUMN IF EXISTS "requireSsoForLogin"`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "GlobalOIDC" ADD "requireSsoForLogin" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalSSO" ADD "requireSsoForLogin" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" DROP COLUMN "requireSsoForLogin"`,
    );
  }
}
