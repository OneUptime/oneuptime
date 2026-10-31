import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * A public dashboard's logo for its dark theme (Dashboard.darkThemeLogoFile):
 * shown instead of the logo wherever the public dashboard is dark, where
 * without it the logo sits on a light backdrop. Generated with npm run
 * generate-postgres-migration; every dashboard has none, so nothing changes
 * for any dashboard until its owner uploads one. The foreign key to "File" is
 * added by AddDashboardDarkThemeLogoKey1808710000000, online: "Dashboard"
 * already exists and is written to all day.
 */
export class AddDashboardDarkThemeLogo1808700000000
  implements MigrationInterface
{
  public name: string = "AddDashboardDarkThemeLogo1808700000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "Dashboard" ADD "darkThemeLogoFileId" uuid`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "Dashboard" DROP COLUMN "darkThemeLogoFileId"`,
    );
  }
}
