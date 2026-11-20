import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * An App Platforms app keeps the Cloud Resource it runs as in its cloud's
 * monitoring - an App Service app's site (#10407) - so the lists, monitors
 * and the AI read the site's Azure Monitor numbers without looking it up
 * again (CloudApp.platformCloudResourceId, set by
 * CloudAppService.linkPlatformResources).
 *
 * The column only, nullable with no default, so no row is rewritten. The
 * index and foreign key generated with it are built online, in
 * AddCloudAppPlatformCloudResourceIndexAndKey1809187383710: the ingest
 * writes "CloudApp" for every app of every environment, at each window.
 * Every app is tied to its site by the next hourly sweep, or sooner.
 */
export class AddCloudAppPlatformCloudResource1809187383700
  implements MigrationInterface
{
  public name: string = "AddCloudAppPlatformCloudResource1809187383700";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "CloudApp" ADD "platformCloudResourceId" uuid`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "CloudApp" DROP COLUMN "platformCloudResourceId"`,
    );
  }
}
