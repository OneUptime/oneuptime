import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration, then renumbered after
 * the last registered migration. Its foreign key is added online, in a
 * migration of its own (AddWorkflowLastSavedByForeignKey1800450000000).
 *
 * Workflow.lastSavedByUserId: the person who last saved a workflow's steps,
 * which OneUptime records when a workflow is created and each time its steps
 * are saved (WorkflowService). A workflow's steps are held to that person's
 * read of runbook credentials (RunbookCredentialReaders). Workflows saved
 * before this name nobody until their steps are saved again.
 *
 * The column is nullable with no default, so adding it changes no row.
 */
export class AddWorkflowLastSavedBy1800400000000 implements MigrationInterface {
  public name: string = "AddWorkflowLastSavedBy1800400000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "Workflow" ADD "lastSavedByUserId" uuid`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "Workflow" DROP COLUMN "lastSavedByUserId"`,
    );
  }
}
