import OnlineDdl from "../OnlineDdl";
import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration, then renumbered after
 * the last registered migration.
 *
 * Workflow.lastSavedByUserId: the person who last saved a workflow's steps,
 * which OneUptime records when a workflow is created and each time its steps
 * are saved (WorkflowService). A workflow's steps are held to that person's
 * read of runbook credentials (RunbookCredentialReaders). Workflows saved
 * before this name nobody until their steps are saved again.
 *
 * The column is nullable with no default, so adding it changes no row. The
 * foreign key checks every workflow, so it goes through
 * OnlineDdl.addForeignKey: added NOT VALID, then validated without blocking
 * the table's writers. Safe to run again after a stop part way: the column
 * is added only when it is missing, and OnlineDdl validates a constraint an
 * earlier run left unvalidated.
 */
export class AddWorkflowLastSavedBy1800400000000 implements MigrationInterface {
  public name: string = "AddWorkflowLastSavedBy1800400000000";

  // OnlineDdl.addForeignKey validates outside a transaction.
  public transaction: boolean = false;

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "Workflow" ADD COLUMN IF NOT EXISTS "lastSavedByUserId" uuid`,
    );
    await OnlineDdl.addForeignKey(
      queryRunner,
      `ALTER TABLE "Workflow" ADD CONSTRAINT "FK_cfb3d733c4f4b78897f3339187b" FOREIGN KEY ("lastSavedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "Workflow" DROP CONSTRAINT IF EXISTS "FK_cfb3d733c4f4b78897f3339187b"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Workflow" DROP COLUMN IF EXISTS "lastSavedByUserId"`,
    );
  }
}
