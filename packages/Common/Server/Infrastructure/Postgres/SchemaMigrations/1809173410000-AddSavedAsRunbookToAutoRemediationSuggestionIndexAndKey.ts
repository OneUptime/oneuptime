import OnlineDdl from "../OnlineDdl";
import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration alongside
 * AddSavedAsRunbookToAutoRemediationSuggestion1809173400000, and moved into
 * a migration of its own: "AutoRemediationSuggestion" holds every fix
 * OneUptime AI proposed or ran, and fixes are written to it while incidents
 * and alerts open, so the index on its new "savedAsRunbookId" column is
 * built online, and the foreign key to "Runbook" is added NOT VALID and then
 * validated, without blocking those writes meanwhile. Every existing fix's
 * column is null, so the validation finds nothing to refuse. Index and key
 * names are TypeORM's own, so the schema drift check finds nothing to
 * change.
 *
 * Safe to run again after a stop part way: an index or key that is already
 * there is left as it is.
 */
export class AddSavedAsRunbookToAutoRemediationSuggestionIndexAndKey1809173410000
  implements MigrationInterface
{
  public name: string =
    "AddSavedAsRunbookToAutoRemediationSuggestionIndexAndKey1809173410000";

  // CREATE INDEX CONCURRENTLY and the validation run outside a transaction.
  public transaction: boolean = false;

  public async up(queryRunner: QueryRunner): Promise<void> {
    await OnlineDdl.createIndex(
      queryRunner,
      `CREATE INDEX "IDX_7f6300814c9bba8834a9ce27f8" ON "AutoRemediationSuggestion" ("savedAsRunbookId") `,
    );
    await OnlineDdl.addForeignKey(
      queryRunner,
      `ALTER TABLE "AutoRemediationSuggestion" ADD CONSTRAINT "FK_7f6300814c9bba8834a9ce27f84" FOREIGN KEY ("savedAsRunbookId") REFERENCES "Runbook"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "AutoRemediationSuggestion" DROP CONSTRAINT "FK_7f6300814c9bba8834a9ce27f84"`,
    );
    await OnlineDdl.dropIndex(
      queryRunner,
      `DROP INDEX "public"."IDX_7f6300814c9bba8834a9ce27f8"`,
    );
  }
}
