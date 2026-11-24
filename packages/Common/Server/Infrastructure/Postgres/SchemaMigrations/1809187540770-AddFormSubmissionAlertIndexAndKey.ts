import OnlineDdl from "../OnlineDdl";
import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration alongside
 * AddFormSubmissionAlert1809187540760, and moved into a migration of its
 * own: "Alert" is written whenever a monitor opens, changes or resolves an
 * alert, and "FormSubmission" whenever a form is submitted. So the index on
 * the new "alertId" column is built online, and its key to "Alert" is added
 * NOT VALID and then validated, without blocking those reads and writes
 * meanwhile. Every existing row's column is null, so the validation finds
 * nothing to refuse. Index and key names are TypeORM's own, so the schema
 * drift check finds nothing to change.
 *
 * The key sets a submission's alert to null when the alert is deleted (ON
 * DELETE SET NULL): the submission is kept, and its Created column says the
 * alert was deleted since, as it does for an incident or an event.
 *
 * Safe to run again after a stop part way: an index or key that is already
 * there is left as it is.
 */
export class AddFormSubmissionAlertIndexAndKey1809187540770
  implements MigrationInterface
{
  public name: string = "AddFormSubmissionAlertIndexAndKey1809187540770";

  // CREATE INDEX CONCURRENTLY and the validation run outside a transaction.
  public transaction: boolean = false;

  public async up(queryRunner: QueryRunner): Promise<void> {
    await OnlineDdl.createIndex(
      queryRunner,
      `CREATE INDEX "IDX_b957fb0496ef67035df877587d" ON "FormSubmission" ("alertId") `,
    );
    await OnlineDdl.addForeignKey(
      queryRunner,
      `ALTER TABLE "FormSubmission" ADD CONSTRAINT "FK_b957fb0496ef67035df877587d3" FOREIGN KEY ("alertId") REFERENCES "Alert"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "FormSubmission" DROP CONSTRAINT "FK_b957fb0496ef67035df877587d3"`,
    );
    await OnlineDdl.dropIndex(
      queryRunner,
      `DROP INDEX "public"."IDX_b957fb0496ef67035df877587d"`,
    );
  }
}
