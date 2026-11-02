import OnlineDdl from "../OnlineDdl";
import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration alongside
 * AddDashboardDarkThemeLogo1808700000000, and moved into a migration of its
 * own: "Dashboard" already exists and is written to all day, so the foreign
 * key from its new "darkThemeLogoFileId" column to "File" is added NOT VALID
 * and then validated, without blocking either table's writes. Every
 * dashboard's column is null, so the validation finds nothing to refuse.
 * Removing the file leaves the dashboard without its dark theme logo (ON
 * DELETE SET NULL), never takes the dashboard with it. Safe to run again
 * after a stop part way: a key that is already there is left as it is.
 */
export class AddDashboardDarkThemeLogoKey1808710000000
  implements MigrationInterface
{
  public name: string = "AddDashboardDarkThemeLogoKey1808710000000";

  // The validation runs outside a transaction.
  public transaction: boolean = false;

  public async up(queryRunner: QueryRunner): Promise<void> {
    await OnlineDdl.addForeignKey(
      queryRunner,
      `ALTER TABLE "Dashboard" ADD CONSTRAINT "FK_2873a646a15f3f93f1c0100993a" FOREIGN KEY ("darkThemeLogoFileId") REFERENCES "File"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "Dashboard" DROP CONSTRAINT "FK_2873a646a15f3f93f1c0100993a"`,
    );
  }
}
