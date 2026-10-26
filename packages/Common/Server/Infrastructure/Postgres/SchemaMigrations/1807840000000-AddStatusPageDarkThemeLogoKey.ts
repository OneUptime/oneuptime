import OnlineDdl from "../OnlineDdl";
import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration alongside
 * AddStatusPageDarkThemeLogo1807830000000, and moved into a migration of its
 * own: "StatusPage" already exists and is written to all day, so the foreign
 * key from its new "darkThemeLogoFileId" column to "File" is added NOT VALID
 * and then validated, without blocking either table's writes. Every page's
 * column is null, so the validation finds nothing to refuse. Removing the
 * file leaves the page without its dark theme logo (ON DELETE SET NULL),
 * never takes the page with it. Safe to run again after a stop part way: a
 * key that is already there is left as it is.
 */
export class AddStatusPageDarkThemeLogoKey1807840000000
  implements MigrationInterface
{
  public name: string = "AddStatusPageDarkThemeLogoKey1807840000000";

  // The validation runs outside a transaction.
  public transaction: boolean = false;

  public async up(queryRunner: QueryRunner): Promise<void> {
    await OnlineDdl.addForeignKey(
      queryRunner,
      `ALTER TABLE "StatusPage" ADD CONSTRAINT "FK_c8f8f9fa4709d006c31bda09c0a" FOREIGN KEY ("darkThemeLogoFileId") REFERENCES "File"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "StatusPage" DROP CONSTRAINT "FK_c8f8f9fa4709d006c31bda09c0a"`,
    );
  }
}
