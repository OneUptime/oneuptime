import OnlineDdl from "../OnlineDdl";
import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration alongside
 * AddComplianceSettingTurnedOffBy1809185300000, and moved into a migration
 * of its own: a key on a table that holds rows takes a lock on "User" too
 * while every row is checked, so it is added NOT VALID, then validated,
 * without blocking either table's readers or writers
 * (Docs/migrations/README.md).
 *
 *   - The key from a setting to the user who last turned it off (#9629),
 *     ON DELETE SET NULL: the setting stays, and says nobody turned it off.
 *     Every existing row names nobody.
 *
 * The name is the one the generator gave it, so the drift check finds
 * nothing to change. Safe to run again after a stop part way.
 */
export class AddComplianceSettingTurnedOffByKey1809185300100
  implements MigrationInterface
{
  public name: string = "AddComplianceSettingTurnedOffByKey1809185300100";

  // VALIDATE CONSTRAINT runs outside a transaction.
  public transaction: boolean = false;

  public async up(queryRunner: QueryRunner): Promise<void> {
    await OnlineDdl.addForeignKey(
      queryRunner,
      `ALTER TABLE "DataSecurityComplianceSetting" ADD CONSTRAINT "FK_71bfa8bb0d9ac1d8d57f7cf4bb2" FOREIGN KEY ("turnedOffByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "DataSecurityComplianceSetting" DROP CONSTRAINT "FK_71bfa8bb0d9ac1d8d57f7cf4bb2"`,
    );
  }
}
