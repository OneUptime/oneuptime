import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * GlobalConfig.enterpriseMarketplaceBilling: how a self-hosted Enterprise
 * installation bought on a cloud marketplace bills its users there - the
 * hourly reports the marketplace has not taken yet, the last one it took and
 * when it last confirmed or refused the subscription (see
 * Types/EnterpriseLicense/EnterpriseMarketplaceBilling.ts). Null on every
 * installation that is not billed through a marketplace, which is every
 * installation that exists today.
 */
export class AddEnterpriseMarketplaceBilling1803300000000
  implements MigrationInterface
{
  public name: string = "AddEnterpriseMarketplaceBilling1803300000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" ADD "enterpriseMarketplaceBilling" jsonb`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" DROP COLUMN "enterpriseMarketplaceBilling"`,
    );
  }
}
