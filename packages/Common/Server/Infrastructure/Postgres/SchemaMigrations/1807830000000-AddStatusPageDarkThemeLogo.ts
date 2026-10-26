import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * A status page's logo for its dark theme (StatusPage.darkThemeLogoFile):
 * shown instead of the logo wherever the page is dark, where without it the
 * logo sits on a light backdrop. Generated with npm run
 * generate-postgres-migration; every page has none, so nothing changes for
 * any page until its owner uploads one. The foreign key to "File" is added
 * by AddStatusPageDarkThemeLogoKey1807840000000, online: "StatusPage"
 * already exists and is written to all day.
 */
export class AddStatusPageDarkThemeLogo1807830000000
  implements MigrationInterface
{
  public name: string = "AddStatusPageDarkThemeLogo1807830000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "StatusPage" ADD "darkThemeLogoFileId" uuid`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "StatusPage" DROP COLUMN "darkThemeLogoFileId"`,
    );
  }
}
