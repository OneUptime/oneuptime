import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration, then renumbered after
 * the last registered migration.
 *
 * GlobalConfig.branding*: the name and images an installation may go by in
 * place of OneUptime's (Types/Branding/ProductBranding.ts). Nullable with no
 * default: every installation keeps OneUptime's own until its enterprise
 * module says otherwise.
 *
 * EnterpriseLicense.canBeWhiteLabelled: the license server's switch for it.
 * False for every license that exists, so no license changes.
 *
 * Adding a nullable column, or one with a constant default, rewrites no rows
 * on Postgres 11 and later.
 */
export class AddInstanceBranding1800200000000 implements MigrationInterface {
  public name: string = "AddInstanceBranding1800200000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" ADD "brandingProductName" character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" ADD "brandingWebsiteUrl" character varying(500)`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" ADD "brandingLogo" text`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" ADD "brandingDarkLogo" text`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" ADD "brandingFavicon" text`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" ADD "brandingUpdatedAt" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "EnterpriseLicense" ADD "canBeWhiteLabelled" boolean NOT NULL DEFAULT false`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "EnterpriseLicense" DROP COLUMN "canBeWhiteLabelled"`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" DROP COLUMN "brandingUpdatedAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" DROP COLUMN "brandingFavicon"`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" DROP COLUMN "brandingDarkLogo"`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" DROP COLUMN "brandingLogo"`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" DROP COLUMN "brandingWebsiteUrl"`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" DROP COLUMN "brandingProductName"`,
    );
  }
}
