import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration. GlobalConfig gains the
 * moment this installation first booted the Enterprise Edition; an unlicensed
 * Enterprise install gets its 14-day trial counted from it. Nullable with no
 * default: the enterprise module stamps it on its own first boot.
 */
export class AddEnterpriseEditionFirstSeenAt1793900000000
  implements MigrationInterface
{
  public name: string = "AddEnterpriseEditionFirstSeenAt1793900000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" ADD "enterpriseEditionFirstSeenAt" TIMESTAMP WITH TIME ZONE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" DROP COLUMN "enterpriseEditionFirstSeenAt"`,
    );
  }
}
